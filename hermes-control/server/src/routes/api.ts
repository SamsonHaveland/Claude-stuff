import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { audit } from '../lib/audit.js';
import { resolveTargets, type RoutableAgent } from '../services/routing.js';
import { keyEnvFor, baseUrlFor, HermesError } from '../hermes/client.js';
import type { KanbanTask } from '../hermes/kanban.js';
import { characterPrompt, loadPortrait, parseCharacter } from '../services/character.js';
import { writeFile } from 'node:fs/promises';

interface WsRow { id: number; slug: string; name: string; role: string }

const AVATAR_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ATTACH_MAX = 25 * 1024 * 1024;

/** A one-to-one chat counts as long after this many turns or this much visible text since its last fresh start. */
const LONG_CHAT_TURNS = 30;
const LONG_CHAT_CHARS = 60_000;

export async function registerApi(app: FastifyInstance, ctx: AppContext) {
  const { db, bus, runs, hermes, kanban, cfg } = ctx;
  const auth = { preHandler: app.authenticate };

  /** Workspace authorization: every workspace-scoped route goes through this. */
  function requireWorkspace(req: FastifyRequest, reply: FastifyReply, minRole: 'viewer' | 'member' | 'owner' = 'viewer'): WsRow | null {
    const slug = (req.params as { ws: string }).ws;
    const ws = db.prepare(
      `SELECT w.id, w.slug, w.name, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ? WHERE w.slug = ?`,
    ).get(req.user!.id, slug) as WsRow | undefined;
    // Same 404 whether the workspace is missing or not yours: no existence oracle.
    if (!ws) { reply.code(404).send({ error: 'not_found' }); return null; }
    const rank = { viewer: 0, member: 1, owner: 2 } as const;
    if (rank[ws.role as keyof typeof rank] < rank[minRole]) { reply.code(403).send({ error: 'forbidden' }); return null; }
    return ws;
  }

  function convInWorkspace(wsId: number, convId: number) {
    return db.prepare('SELECT * FROM conversations WHERE id = ? AND workspace_id = ?').get(convId, wsId) as any;
  }

  function workspaceAgents(wsId: number): RoutableAgent[] {
    return (db.prepare(
      `SELECT a.id, a.profile_name AS profileName, a.display_name AS displayName FROM agents a JOIN workspace_agents wa ON wa.agent_id = a.id WHERE wa.workspace_id = ?`,
    ).all(wsId) as unknown) as RoutableAgent[];
  }

  function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
    if (req.user!.role !== 'admin') { reply.code(403).send({ error: 'forbidden' }); return false; }
    return true;
  }

  // ---- me / workspaces --------------------------------------------------------------
  app.get('/api/me', auth, async (req) => {
    const workspaces = db.prepare(
      `SELECT w.slug, w.name, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY w.id`,
    ).all(req.user!.id);
    return { user: { id: req.user!.id, username: req.user!.username, displayName: req.user!.display_name, role: req.user!.role }, csrf: req.user!.csrf, workspaces, hermesMode: cfg.hermes.mode };
  });

  // ---- conversations -------------------------------------------------------------------
  app.get('/api/w/:ws/conversations', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const convs = db.prepare(
      `SELECT c.id, c.kind, c.name, c.topic, c.dm_agent_id AS dmAgentId, c.default_agent_id AS defaultAgentId,
              (SELECT MAX(id) FROM messages m WHERE m.conversation_id = c.id) AS lastMessageId,
              (SELECT json_object('body', substr(m.body, 1, 140), 'at', COALESCE(m.origin_ts, m.created_at), 'authorKind', m.author_kind, 'state', m.state)
                 FROM messages m WHERE m.conversation_id = c.id AND m.parent_id IS NULL
                 ORDER BY COALESCE(m.origin_ts, m.created_at) DESC, m.id DESC LIMIT 1) AS lastJson,
              (SELECT COUNT(*) FROM runs r WHERE r.conversation_id = c.id AND r.request_message_id >
                 COALESCE((SELECT MAX(f.id) FROM messages f WHERE f.conversation_id = c.id AND f.author_kind = 'system' AND f.author_label = 'fresh-start'), 0)) AS turnsSinceFresh,
              (SELECT COALESCE(SUM(length(m.body)), 0) FROM messages m WHERE m.conversation_id = c.id AND m.source IN ('hc','hermes_run') AND m.id >
                 COALESCE((SELECT MAX(f.id) FROM messages f WHERE f.conversation_id = c.id AND f.author_kind = 'system' AND f.author_label = 'fresh-start'), 0)) AS charsSinceFresh
       FROM conversations c WHERE c.workspace_id = ? AND c.archived = 0
         AND (c.kind <> 'dm' OR c.dm_agent_id IN (SELECT agent_id FROM workspace_agents WHERE workspace_id = c.workspace_id))
       ORDER BY c.kind, c.name`,
    ).all(ws.id) as any[];
    const members = db.prepare('SELECT conversation_id AS c, agent_id AS a FROM conversation_agents ca JOIN conversations c ON c.id = ca.conversation_id WHERE c.workspace_id = ?').all(ws.id) as { c: number; a: number }[];
    // Hermes resends the whole conversation on every turn and never starts a new one by itself, so
    // long chats get slower and cost more. Flag them so the app can offer a fresh start.
    return convs.map(({ lastJson, turnsSinceFresh, charsSinceFresh, ...c }) => ({ ...c, long: c.kind !== 'channel' && (turnsSinceFresh >= LONG_CHAT_TURNS || charsSinceFresh >= LONG_CHAT_CHARS), last: lastJson ? JSON.parse(lastJson) : null, agentIds: members.filter((m) => m.c === c.id).map((m) => m.a), readOnly: !ctx.mirror.writable(c), twoWay: c.kind === 'telegram_mirror' && ctx.mirror.writable(c) }));
  });

  app.get('/api/w/:ws/conversations/:id/messages', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const { id } = req.params as { id: string };
    const conv = convInWorkspace(ws.id, Number(id));
    if (!conv) return reply.code(404).send({ error: 'not_found' });
    const q = z.object({ before: z.coerce.number().optional(), limit: z.coerce.number().min(1).max(200).default(80), thread: z.coerce.number().optional() }).parse(req.query);
    const rows = db.prepare(
      `SELECT m.*, r.id AS run_id, r.status AS run_status FROM messages m LEFT JOIN runs r ON r.reply_message_id = m.id
       WHERE m.conversation_id = ? AND m.workspace_id = ? AND (? IS NULL OR m.id < ?)
         AND ((? IS NULL AND m.parent_id IS NULL) OR m.parent_id = ? OR m.id = ?)
       ORDER BY COALESCE(m.origin_ts, m.created_at) DESC, m.id DESC LIMIT ?`,
    ).all(conv.id, ws.id, q.before ?? null, q.before ?? null, q.thread ?? null, q.thread ?? null, q.thread ?? null, q.limit) as any[];
    const ids = rows.map((r) => r.id);
    const atts = ids.length ? db.prepare(`SELECT id, message_id, filename, mime, size FROM attachments WHERE workspace_id = ? AND message_id IN (${ids.map(() => '?').join(',')})`).all(ws.id, ...ids) as any[] : [];
    const replyCounts = ids.length ? db.prepare(`SELECT parent_id, COUNT(*) n FROM messages WHERE parent_id IN (${ids.map(() => '?').join(',')}) GROUP BY parent_id`).all(...ids) as any[] : [];
    return rows.reverse().map((m) => ({ ...m, attachments: atts.filter((a) => a.message_id === m.id), replyCount: replyCounts.find((r) => r.parent_id === m.id)?.n ?? 0 }));
  });

  // Start the agent(s) of this chat on a new Hermes session. History stays in Hermes Control and in
  // Hermes; only the binding is dropped, so the next message opens a fresh session.
  app.post('/api/w/:ws/conversations/:id/fresh', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply, 'member'); if (!ws) return;
    const conv = convInWorkspace(ws.id, Number((req.params as any).id));
    if (!conv) return reply.code(404).send({ error: 'not_found' });
    if (!ctx.mirror.writable(conv)) return reply.code(409).send({ error: 'read_only', message: 'This chat is read-only.' });
    const open = db.prepare(`SELECT COUNT(*) n FROM runs WHERE conversation_id = ? AND status NOT IN ('completed','failed','cancelled','interrupted','unknown')`).get(conv.id) as { n: number };
    if (open.n > 0) return reply.code(409).send({ error: 'busy', message: 'Wait for the current reply to finish (or stop it) first.' });
    const dropped = db.prepare('DELETE FROM hermes_bindings WHERE conversation_id = ?').run(conv.id).changes;
    const now = Date.now();
    const r = db.prepare(
      `INSERT INTO messages (conversation_id, workspace_id, author_kind, author_user_id, author_label, body, state, source, created_at, updated_at) VALUES (?,?,'system',?,'fresh-start','New conversation','final','hc',?,?)`,
    ).run(conv.id, ws.id, req.user!.id, now, now);
    runs.publishMessage(Number(r.lastInsertRowid));
    audit(db, { userId: req.user!.id, workspaceId: ws.id, action: 'conversation.fresh', target: `conversation:${conv.id}`, detail: { sessionsDropped: dropped } });
    return { ok: true, sessionsDropped: Number(dropped) };
  });

  const SendBody = z.object({ body: z.string().trim().min(1).max(20_000), parentId: z.number().int().optional(), attachmentIds: z.array(z.number().int()).max(10).default([]) });

  app.post('/api/w/:ws/conversations/:id/messages', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply, 'member'); if (!ws) return;
    const conv = convInWorkspace(ws.id, Number((req.params as any).id));
    if (!conv) return reply.code(404).send({ error: 'not_found' });
    if (!ctx.mirror.writable(conv)) return reply.code(409).send({ error: 'read_only', message: 'This Telegram copy is read-only. Switch on two-way in Settings, or reply in Telegram.' });
    const body = SendBody.parse(req.body);
    if (body.parentId && !db.prepare('SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?').get(body.parentId, conv.id)) return reply.code(400).send({ error: 'bad_parent' });
    const now = Date.now();
    const r = db.prepare(
      `INSERT INTO messages (conversation_id, workspace_id, parent_id, author_kind, author_user_id, author_label, body, state, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'final', 'hc', ?, ?)`,
    ).run(conv.id, ws.id, body.parentId ?? null, 'user', req.user!.id, req.user!.display_name, body.body, now, now);
    const msgId = Number(r.lastInsertRowid);
    let attachmentNote = '';
    for (const aid of body.attachmentIds) {
      // Attachments must belong to this workspace and this uploader, and be unattached.
      const ok = db.prepare('UPDATE attachments SET message_id = ? WHERE id = ? AND workspace_id = ? AND uploader_user_id = ? AND message_id IS NULL').run(msgId, aid, ws.id, req.user!.id);
      if (ok.changes) {
        const a = db.prepare('SELECT filename, mime, size FROM attachments WHERE id = ?').get(aid) as any;
        attachmentNote += `\n[Attachment in Hermes Control: ${a.filename} (${a.mime}, ${a.size} bytes) — file contents are not forwarded to Hermes]`;
      }
    }
    runs.publishMessage(msgId);
    // Route only to agents that are BOTH channel members and allowed in this workspace.
    const allowed = new Set(workspaceAgents(ws.id).map((a) => a.id));
    const members = (db.prepare('SELECT a.id, a.profile_name AS profileName, a.display_name AS displayName FROM agents a JOIN conversation_agents ca ON ca.agent_id = a.id WHERE ca.conversation_id = ?').all(conv.id) as unknown as RoutableAgent[]).filter((a) => allowed.has(a.id));
    const targets = resolveTargets(body.body, { kind: conv.kind, dmAgentId: conv.dm_agent_id, defaultAgentId: conv.default_agent_id }, members);
    if (attachmentNote) db.prepare('UPDATE messages SET body = body || ? WHERE id = ?').run(attachmentNote, msgId);
    const runIds = targets.map((t) => runs.enqueue({ workspaceId: ws.id, conversationId: conv.id, requestMessageId: msgId, agentId: t.id, label: t.displayName, parentId: body.parentId ?? null }));
    audit(db, { userId: req.user!.id, workspaceId: ws.id, action: 'message.send', target: `conversation:${conv.id}`, detail: { messageId: msgId, routedTo: targets.map((t) => t.profileName) } });
    return { messageId: msgId, routedTo: targets.map((t) => ({ agentId: t.id, profile: t.profileName })), runIds };
  });

  app.post('/api/w/:ws/runs/:id/retry', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply, 'member'); if (!ws) return;
    const run = db.prepare('SELECT * FROM runs WHERE id = ? AND workspace_id = ?').get(Number((req.params as any).id), ws.id) as any;
    if (!run) return reply.code(404).send({ error: 'not_found' });
    if (run.status !== 'failed' && run.status !== 'unknown') return reply.code(409).send({ error: 'not_retryable' });
    audit(db, { userId: req.user!.id, workspaceId: ws.id, action: 'run.retry', target: `run:${run.id}` });
    runs.retry(run.id); // only this run; never re-drives other workspaces' runs
    return { ok: true };
  });

  app.post('/api/w/:ws/runs/:id/stop', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply, 'member'); if (!ws) return;
    const run = db.prepare('SELECT id FROM runs WHERE id = ? AND workspace_id = ?').get(Number((req.params as any).id), ws.id) as any;
    if (!run) return reply.code(404).send({ error: 'not_found' });
    audit(db, { userId: req.user!.id, workspaceId: ws.id, action: 'run.stop', target: `run:${run.id}` });
    return runs.stop(run.id);
  });

  // ---- agents ---------------------------------------------------------------------------
  const healthCache = new Map<string, { ok: boolean; at: number }>();
  async function gatewayHealth(profile: string) {
    const c = healthCache.get(profile);
    if (c && Date.now() - c.at < 15_000) return c.ok;
    const ok = await hermes.health(profile);
    healthCache.set(profile, { ok, at: Date.now() });
    return ok;
  }

  async function agentView(a: any, wsId: number) {
    const activeRuns = (db.prepare(`SELECT COUNT(*) n FROM runs WHERE agent_id = ? AND workspace_id = ? AND status IN ('submitting','started','queued','running','waiting_for_approval')`).get(a.id, wsId) as any).n;
    const reachable = cfg.hermes.mode === 'live' && hermes.hasKey(a.profile_name) ? await gatewayHealth(a.profile_name) : null;
    // Status is derived ONLY from telemetry we actually have.
    const status = cfg.hermes.mode !== 'live' ? 'integration_disabled' : !a.discovered ? 'not_found' : !hermes.hasKey(a.profile_name) ? 'not_configured' : reachable ? (activeRuns ? 'working' : 'online') : 'unreachable';
    return {
      id: a.id, profileName: a.profile_name, displayName: a.display_name, role: a.role, description: a.description,
      avatarUrl: a.avatar_file ? `/api/avatars/${a.avatar_file}` : null, discovered: Boolean(a.discovered), status, activeRuns,
    };
  }

  app.get('/api/w/:ws/agents', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const rows = db.prepare('SELECT a.* FROM agents a JOIN workspace_agents wa ON wa.agent_id = a.id WHERE wa.workspace_id = ? ORDER BY a.display_name').all(ws.id) as any[];
    return Promise.all(rows.map((a) => agentView(a, ws.id)));
  });

  app.get('/api/w/:ws/agents/:id', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const a = db.prepare('SELECT a.* FROM agents a JOIN workspace_agents wa ON wa.agent_id = a.id WHERE wa.workspace_id = ? AND a.id = ?').get(ws.id, Number((req.params as any).id)) as any;
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const view = await agentView(a, ws.id);
    const recent = db.prepare(
      `SELECT r.id, r.status, r.error, r.created_at, r.updated_at, r.last_event, c.name AS conversation, c.kind FROM runs r JOIN conversations c ON c.id = r.conversation_id WHERE r.agent_id = ? AND r.workspace_id = ? ORDER BY r.id DESC LIMIT 20`,
    ).all(a.id, ws.id);
    let capabilities: unknown = null;
    if (view.status === 'online' || view.status === 'working') capabilities = await hermes.capabilities(a.profile_name).catch(() => null);
    return { ...view, recentRuns: recent, capabilities };
  });

  app.patch('/api/agents/:id', auth, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = z.object({ displayName: z.string().trim().min(1).max(60).optional(), role: z.string().trim().max(80).nullable().optional(), description: z.string().trim().max(2000).nullable().optional() }).parse(req.body);
    const id = Number((req.params as any).id);
    const a = db.prepare('SELECT id FROM agents WHERE id = ?').get(id);
    if (!a) return reply.code(404).send({ error: 'not_found' });
    // Presentation only. profile_name (the execution identity) is immutable here.
    if (body.displayName !== undefined) db.prepare('UPDATE agents SET display_name = ? WHERE id = ?').run(body.displayName, id);
    if (body.role !== undefined) db.prepare('UPDATE agents SET role = ? WHERE id = ?').run(body.role, id);
    if (body.description !== undefined) db.prepare('UPDATE agents SET description = ? WHERE id = ?').run(body.description, id);
    audit(db, { userId: req.user!.id, action: 'agent.update', target: `agent:${id}`, detail: body });
    return { ok: true };
  });

  app.post('/api/agents/:id/avatar', auth, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as any).id);
    const agent = db.prepare('SELECT avatar_file FROM agents WHERE id = ?').get(id) as any;
    if (!agent) return reply.code(404).send({ error: 'not_found' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no_file' });
    const ext = AVATAR_MIME[file.mimetype];
    if (!ext) return reply.code(415).send({ error: 'unsupported_type', message: 'Use JPEG, PNG or WebP' });
    const name = `agent-${id}-${randomBytes(6).toString('hex')}.${ext}`;
    const dest = join(ctx.avatarsDir, name);
    await pipeline(file.file, createWriteStream(dest));
    if (file.file.truncated) { await unlink(dest).catch(() => {}); return reply.code(413).send({ error: 'too_large' }); }
    if (!(await looksLikeImage(dest, ext))) { await unlink(dest).catch(() => {}); return reply.code(415).send({ error: 'not_an_image' }); }
    db.prepare('UPDATE agents SET avatar_file = ? WHERE id = ?').run(name, id);
    if (agent.avatar_file) await unlink(join(ctx.avatarsDir, agent.avatar_file)).catch(() => {});
    audit(db, { userId: req.user!.id, action: 'agent.avatar', target: `agent:${id}` });
    return { avatarUrl: `/api/avatars/${name}` };
  });

  app.get('/api/avatars/:file', auth, async (req, reply) => {
    const f = (req.params as any).file as string;
    if (!/^agent-\d+-[a-f0-9]{12}\.(jpg|png|webp)$/.test(f)) return reply.code(404).send({ error: 'not_found' });
    const ext = f.split('.').pop()!;
    reply.header('Content-Type', ext === 'jpg' ? 'image/jpeg' : `image/${ext}`).header('Cache-Control', 'private, max-age=86400');
    return reply.send(createReadStream(join(ctx.avatarsDir, f)).on('error', () => reply.code(404).send()));
  });

  // ---- attachments -----------------------------------------------------------------------
  app.post('/api/w/:ws/uploads', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply, 'member'); if (!ws) return;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no_file' });
    const key = `${ws.id}/${randomBytes(16).toString('hex')}`;
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(ctx.uploadsDir, String(ws.id)), { recursive: true });
    const dest = join(ctx.uploadsDir, key);
    await pipeline(file.file, createWriteStream(dest));
    if (file.file.truncated) { await unlink(dest).catch(() => {}); return reply.code(413).send({ error: 'too_large' }); }
    const { stat } = await import('node:fs/promises');
    const size = (await stat(dest)).size;
    const safeName = file.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
    const r = db.prepare('INSERT INTO attachments (workspace_id, uploader_user_id, filename, mime, size, storage_key, created_at) VALUES (?,?,?,?,?,?,?)').run(ws.id, req.user!.id, safeName, file.mimetype.slice(0, 100), size, key, Date.now());
    audit(db, { userId: req.user!.id, workspaceId: ws.id, action: 'attachment.upload', target: `attachment:${r.lastInsertRowid}`, detail: { size, mime: file.mimetype } });
    return { id: Number(r.lastInsertRowid), filename: safeName, size, mime: file.mimetype, maxBytes: ATTACH_MAX };
  });

  app.get('/api/w/:ws/attachments/:id', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND workspace_id = ?').get(Number((req.params as any).id), ws.id) as any;
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const inline = /^image\/(png|jpeg|webp|gif)$/.test(a.mime);
    reply.header('Content-Type', inline ? a.mime : 'application/octet-stream');
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${a.filename.replace(/"/g, '')}"`);
    return reply.send(createReadStream(join(ctx.uploadsDir, a.storage_key)));
  });

  // ---- approvals ------------------------------------------------------------------------
  app.get('/api/w/:ws/approvals', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const status = (req.query as any).status === 'all' ? null : 'pending';
    return db.prepare(
      `SELECT ap.id, ap.status, ap.command, ap.description, ap.choices, ap.decision, ap.decided_at, ap.created_at, ap.hermes_response,
              a.display_name AS agent, a.id AS agentId, r.conversation_id AS conversationId, c.name AS conversation, c.kind,
              (SELECT body FROM messages WHERE id = r.request_message_id) AS requestText
       FROM approvals ap JOIN runs r ON r.id = ap.run_id JOIN agents a ON a.id = ap.agent_id JOIN conversations c ON c.id = r.conversation_id
       WHERE ap.workspace_id = ? AND (? IS NULL OR ap.status IN ('pending','submitted')) ORDER BY ap.id DESC LIMIT 200`,
    ).all(ws.id, status).map((r: any) => ({ ...r, choices: JSON.parse(r.choices), hermes_response: r.hermes_response ? JSON.parse(r.hermes_response) : null }));
  });

  app.post('/api/w/:ws/approvals/:id/decision', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply, 'owner'); if (!ws) return;
    const { choice } = z.object({ choice: z.enum(['once', 'session', 'always', 'deny']) }).parse(req.body);
    const ap = db.prepare('SELECT id FROM approvals WHERE id = ? AND workspace_id = ?').get(Number((req.params as any).id), ws.id) as any;
    if (!ap) return reply.code(404).send({ error: 'not_found' });
    audit(db, { userId: req.user!.id, workspaceId: ws.id, action: 'approval.decide', target: `approval:${ap.id}`, detail: { choice } });
    return runs.decide(ap.id, choice, req.user!.id);
  });

  // ---- tasks (Hermes Kanban via CLI) ------------------------------------------------------
  const wsCfg = (slug: string) => cfg.workspaces.find((w) => w.slug === slug);
  function taskVisible(t: KanbanTask, wsId: number, slug: string) {
    const tenant = wsCfg(slug)?.kanbanTenant;
    if (tenant) return t.tenant === tenant;
    const names = new Set(workspaceAgents(wsId).map((a) => a.profileName));
    return !!t.assignee && names.has(t.assignee) && !t.tenant;
  }

  app.get('/api/w/:ws/tasks', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const q = z.object({ status: z.string().regex(/^[a-z_]+$/).optional(), archived: z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1').optional() }).parse(req.query);
    const tenant = wsCfg(ws.slug)?.kanbanTenant;
    const tasks = await kanban.list({ status: q.status, archived: q.archived, tenant });
    return tasks.filter((t) => taskVisible(t, ws.id, ws.slug));
  });

  app.get('/api/w/:ws/tasks/:id', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const d = await kanban.show((req.params as any).id);
    if (!d?.task || !taskVisible(d.task, ws.id, ws.slug)) return reply.code(404).send({ error: 'not_found' });
    return d;
  });

  app.post('/api/w/:ws/tasks', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply, 'member'); if (!ws) return;
    const b = z.object({ title: z.string().trim().min(1).max(300), body: z.string().max(20_000).optional(), assignee: z.string().optional(), priority: z.number().int().min(0).max(10).optional(), clientKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }).parse(req.body);
    if (b.assignee && !workspaceAgents(ws.id).some((a) => a.profileName === b.assignee)) return reply.code(400).send({ error: 'assignee_not_in_workspace' });
    if (!b.assignee && !wsCfg(ws.slug)?.kanbanTenant) return reply.code(400).send({ error: 'assignee_required', message: 'This workspace has no Kanban tenant; assign the task to an agent so it stays visible here.' });
    const task = await kanban.create({ title: b.title, body: b.body, assignee: b.assignee, priority: b.priority, tenant: wsCfg(ws.slug)?.kanbanTenant, idempotencyKey: `hc-${ws.slug}-${b.clientKey}` });
    audit(db, { userId: req.user!.id, workspaceId: ws.id, action: 'task.create', target: `task:${task?.id}`, detail: { assignee: b.assignee } });
    return task;
  });

  async function guardTask(req: FastifyRequest, reply: FastifyReply, minRole: 'member' | 'owner') {
    const ws = requireWorkspace(req, reply, minRole); if (!ws) return null;
    const id = (req.params as any).id as string;
    const d = await kanban.show(id);
    if (!d?.task || !taskVisible(d.task, ws.id, ws.slug)) { reply.code(404).send({ error: 'not_found' }); return null; }
    return { ws, id };
  }

  app.post('/api/w/:ws/tasks/:id/comment', auth, async (req, reply) => {
    const g = await guardTask(req, reply, 'member'); if (!g) return;
    const { text } = z.object({ text: z.string().trim().min(1).max(10_000) }).parse(req.body);
    await kanban.comment(g.id, text, `hermes-control:${req.user!.username}`);
    audit(db, { userId: req.user!.id, workspaceId: g.ws.id, action: 'task.comment', target: `task:${g.id}` });
    return { ok: true };
  });

  app.post('/api/w/:ws/tasks/:id/assign', auth, async (req, reply) => {
    const g = await guardTask(req, reply, 'member'); if (!g) return;
    const { profile } = z.object({ profile: z.string().nullable() }).parse(req.body);
    if (profile && !workspaceAgents(g.ws.id).some((a) => a.profileName === profile)) return reply.code(400).send({ error: 'assignee_not_in_workspace' });
    await kanban.assign(g.id, profile);
    audit(db, { userId: req.user!.id, workspaceId: g.ws.id, action: 'task.assign', target: `task:${g.id}`, detail: { profile } });
    return { ok: true };
  });

  app.post('/api/w/:ws/tasks/:id/transition', auth, async (req, reply) => {
    const g = await guardTask(req, reply, 'owner'); if (!g) return;
    const { action, reason } = z.object({ action: z.enum(['block', 'unblock', 'complete', 'archive']), reason: z.string().max(2000).optional() }).parse(req.body);
    const out = await kanban.transition(g.id, action, reason);
    audit(db, { userId: req.user!.id, workspaceId: g.ws.id, action: `task.${action}`, target: `task:${g.id}` });
    return { ok: true, output: out.slice(0, 2000) };
  });

  // ---- activity ---------------------------------------------------------------------------
  app.get('/api/w/:ws/activity', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    return db.prepare(
      `SELECT e.seq, e.event, e.created_at, e.payload, r.id AS runId, a.display_name AS agent, a.id AS agentId, c.name AS conversation, c.kind
       FROM run_events e JOIN runs r ON r.id = e.run_id JOIN agents a ON a.id = r.agent_id JOIN conversations c ON c.id = r.conversation_id
       WHERE r.workspace_id = ? AND e.event NOT IN ('message.delta','reasoning.available') ORDER BY e.created_at DESC LIMIT 100`,
    ).all(ws.id).map((r: any) => {
      const p = JSON.parse(r.payload);
      return { ...r, payload: undefined, tool: p.tool ?? null, preview: typeof p.preview === 'string' ? p.preview.slice(0, 300) : null, error: p.error ?? null };
    });
  });

  // ---- real-time: ONE multiplexed SSE stream per client ------------------------------------
  app.get('/api/events', auth, async (req, reply) => {
    const wsIds = (db.prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ?').all(req.user!.id) as any[]).map((r) => r.workspace_id);
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write(': open\n\n');
    const unsub = bus.subscribe(wsIds, (e) => reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify({ workspaceId: e.workspaceId, conversationId: e.conversationId, payload: e.payload })}\n\n`));
    const ka = setInterval(() => reply.raw.write(': keepalive\n\n'), 15_000);
    req.raw.on('close', () => { clearInterval(ka); unsub(); });
    reply.hijack();
  });

  // ---- system status (admin) -----------------------------------------------------------------
  app.get('/api/system/status', auth, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const agents = db.prepare('SELECT * FROM agents ORDER BY profile_name').all() as any[];
    const profiles = await Promise.all(agents.map(async (a) => ({
      profile: a.profile_name, discovered: Boolean(a.discovered), keyEnv: keyEnvFor(a.profile_name, cfg), keyPresent: hermes.hasKey(a.profile_name),
      baseUrl: baseUrlFor(a.profile_name, cfg), reachable: cfg.hermes.mode === 'live' ? await gatewayHealth(a.profile_name) : null,
    })));
    return {
      hermesMode: cfg.hermes.mode, hermesHome: cfg.hermes.home, profiles,
      telegramMirror: cfg.telegramMirror.map((t) => ({ ...t, twoWay: t.enabled && ctx.mirror.twoWay(t.profile), status: ctx.mirror.lastStatus.get(`${t.profile}@${t.workspace}`) ?? null, lastCopy: ctx.mirror.lastCopy.get(t.profile) ?? null })),
      autoUpdate: readAutoUpdate(cfg.autoUpdate.statusFile),
      taskFeed: ctx.taskFeed.lastStatus,
      openRuns: (db.prepare(`SELECT COUNT(*) n FROM runs WHERE status NOT IN ('completed','failed','cancelled','interrupted')`).get() as any).n,
      sseClients: bus.size,
    };
  });

  app.post('/api/system/telegram/:profile/two-way', auth, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { profile } = req.params as { profile: string };
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    try { ctx.mirror.setTwoWay(profile, on); } catch (e) { return reply.code(404).send({ error: 'not_configured', message: (e as Error).message }); }
    audit(db, { userId: req.user!.id, action: 'telegram.two_way', target: `profile:${profile}`, detail: { on } });
    return { profile, twoWay: ctx.mirror.twoWay(profile) };
  });

  app.get('/api/admin/audit', auth, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').all();
  });

  // ---- "Create Character": the agent designs its own card + portrait (presentation only) ----
  function agentInWs(wsId: number, agentId: number) {
    return db.prepare('SELECT a.* FROM agents a JOIN workspace_agents wa ON wa.agent_id = a.id WHERE wa.workspace_id = ? AND a.id = ?').get(wsId, agentId) as any;
  }
  function characterRun(wsId: number, agentId: number, runId: number) {
    return db.prepare(
      `SELECT r.id, r.status, r.error, m.body AS reply, m.state FROM runs r JOIN messages m ON m.id = r.reply_message_id
       WHERE r.id = ? AND r.workspace_id = ? AND r.agent_id = ?`,
    ).get(runId, wsId, agentId) as any;
  }

  app.post('/api/w/:ws/agents/:id/character', auth, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const ws = requireWorkspace(req, reply, 'owner'); if (!ws) return;
    const a = agentInWs(ws.id, Number((req.params as any).id));
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const dm = db.prepare(`SELECT id FROM conversations WHERE workspace_id = ? AND kind = 'dm' AND dm_agent_id = ?`).get(ws.id, a.id) as any;
    if (!dm) return reply.code(409).send({ error: 'no_dm' });
    const body = characterPrompt({ displayName: a.display_name, role: a.role, profileName: a.profile_name });
    const now = Date.now();
    const r = db.prepare(`INSERT INTO messages (conversation_id, workspace_id, author_kind, author_user_id, author_label, body, state, source, created_at, updated_at) VALUES (?,?,?,?,?,?, 'final', 'hc', ?, ?)`)
      .run(dm.id, ws.id, 'user', req.user!.id, req.user!.display_name, body, now, now);
    const msgId = Number(r.lastInsertRowid);
    runs.publishMessage(msgId);
    const runId = runs.enqueue({ workspaceId: ws.id, conversationId: dm.id, requestMessageId: msgId, agentId: a.id, label: a.display_name });
    audit(db, { userId: req.user!.id, workspaceId: ws.id, action: 'agent.character.request', target: `agent:${a.id}`, detail: { runId } });
    return { runId, conversationId: dm.id };
  });

  app.get('/api/w/:ws/agents/:id/character/:runId', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const p = req.params as any;
    const run = characterRun(ws.id, Number(p.id), Number(p.runId));
    if (!run) return reply.code(404).send({ error: 'not_found' });
    const done = ['completed', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(run.status);
    return { status: run.status, done, error: run.error, proposal: run.status === 'completed' ? parseCharacter(run.reply ?? '') : null };
  });

  app.get('/api/w/:ws/agents/:id/character/:runId/picture', auth, async (req, reply) => {
    const ws = requireWorkspace(req, reply); if (!ws) return;
    const p = req.params as any;
    const run = characterRun(ws.id, Number(p.id), Number(p.runId));
    const c = run?.status === 'completed' ? parseCharacter(run.reply ?? '') : null;
    if (!c?.image) return reply.code(404).send({ error: 'no_picture' });
    try {
      const { buf, ext } = await loadPortrait(c.image, cfg.hermes.home);
      return reply.header('Content-Type', ext === 'jpg' ? 'image/jpeg' : `image/${ext}`).header('Cache-Control', 'private, max-age=600').send(buf);
    } catch (e) { return reply.code(422).send({ error: 'picture_rejected', message: (e as Error).message }); }
  });

  app.post('/api/w/:ws/agents/:id/character/:runId/apply', auth, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const ws = requireWorkspace(req, reply, 'owner'); if (!ws) return;
    const p = req.params as any;
    const a = agentInWs(ws.id, Number(p.id));
    const run = a && characterRun(ws.id, a.id, Number(p.runId));
    if (!run) return reply.code(404).send({ error: 'not_found' });
    if (run.status !== 'completed') return reply.code(409).send({ error: 'not_ready' });
    // Re-parse server-side from the stored reply: the client never supplies the values.
    const c = parseCharacter(run.reply ?? '');
    if (!c) return reply.code(422).send({ error: 'no_character', message: `${a.display_name}'s reply didn't include a character.` });
    let avatarUrl: string | null = null;
    let pictureError: string | null = null;
    if (c.image) {
      try {
        const { buf, ext } = await loadPortrait(c.image, cfg.hermes.home);
        const name = `agent-${a.id}-${randomBytes(6).toString('hex')}.${ext}`;
        await writeFile(join(ctx.avatarsDir, name), buf);
        if (a.avatar_file) await unlink(join(ctx.avatarsDir, a.avatar_file)).catch(() => {});
        db.prepare('UPDATE agents SET avatar_file = ? WHERE id = ?').run(name, a.id);
        avatarUrl = `/api/avatars/${name}`;
      } catch (e) { pictureError = (e as Error).message; }
    }
    if (c.name) db.prepare('UPDATE agents SET display_name = ? WHERE id = ?').run(c.name, a.id);
    if (c.role) db.prepare('UPDATE agents SET role = ? WHERE id = ?').run(c.role, a.id);
    if (c.bio) db.prepare('UPDATE agents SET description = ? WHERE id = ?').run(c.bio, a.id);
    audit(db, { userId: req.user!.id, workspaceId: ws.id, action: 'agent.character.apply', target: `agent:${a.id}`, detail: { runId: run.id, picture: !!avatarUrl, pictureError } });
    return { ok: true, avatarUrl, pictureError };
  });

  void HermesError;
}

async function looksLikeImage(path: string, ext: string): Promise<boolean> {
  const { open } = await import('node:fs/promises');
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(12);
    await fh.read(buf, 0, 12, 0);
    if (ext === 'jpg') return buf[0] === 0xff && buf[1] === 0xd8;
    if (ext === 'png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (ext === 'webp') return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
    return false;
  } finally {
    await fh.close();
  }
}

/** Last result written by deploy/hermes-autoupdate.sh; null if the updater was never installed/run. */
export function readAutoUpdate(file: string): Record<string, unknown> | null {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    const pick = ['result', 'exit_code', 'version_before', 'version_after', 'note', 'warnings', 'started_at', 'finished_at', 'channel'];
    return Object.fromEntries(pick.filter((k) => k in d).map((k) => [k, d[k]]));
  } catch {
    return null;
  }
}
