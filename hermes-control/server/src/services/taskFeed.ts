import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import type { KanbanAdapter, KanbanTask } from '../hermes/kanban.js';
import type { EventBus } from './bus.js';

/**
 * Shows Kanban work in the chats, so delegated work is visible where you talk to the agent.
 *
 * Hermes runs a Kanban card in the assignee's own background session; nothing reaches a chat by
 * itself. This polls the board through the supported CLI (`hermes kanban list --json`, read-only)
 * and, when a card's status changes, posts a line into the assignee's one-to-one chat: received,
 * started, finished (with the result) or stuck (with the reason). A finished or stuck card is
 * also posted into the chat of the agent that created it, so "Jeff, ask Harry…" comes back to Jeff.
 *
 * It only writes Hermes Control's own messages table. Each (card, status) is posted at most once
 * (UNIQUE source + external_id). Cards that already existed when the feed first ran are recorded
 * silently, so installing this does not flood the chats with old work.
 * Business separation: a card with a tenant only appears in the workspace that owns that tenant;
 * a card without one only in a workspace that has no tenant.
 */
const RESULT_MAX = 6000;
const SHOWN = new Set(['todo', 'ready', 'scheduled', 'triage', 'running', 'review', 'blocked', 'done']);

export class TaskFeed {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  public lastStatus: { ok: boolean; at: number; error?: string; tasks?: number } | null = null;

  constructor(private db: DB, private cfg: Config, private kanban: KanbanAdapter, private bus: EventBus, private log: (m: string, x?: unknown) => void = () => {}) {}

  start(pollSeconds = 30) {
    const tick = () => void this.pollOnce();
    tick();
    this.timer = setInterval(tick, pollSeconds * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private workspaceFor(task: KanbanTask): { id: number; slug: string } | null {
    const w = task.tenant
      ? this.cfg.workspaces.find((x) => x.kanbanTenant === task.tenant)
      : this.cfg.workspaces.find((x) => !x.kanbanTenant);
    if (!w) return null;
    const row = this.db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(w.slug) as { id: number } | undefined;
    return row ? { id: row.id, slug: w.slug } : null;
  }

  /** The agent's one-to-one chat in a workspace, only if the agent is allowed there. */
  private dm(workspaceId: number, profile: string): { conversationId: number; agentId: number; name: string } | null {
    const r = this.db.prepare(
      `SELECT c.id AS conversationId, a.id AS agentId, a.display_name AS name FROM agents a
       JOIN workspace_agents wa ON wa.agent_id = a.id AND wa.workspace_id = ?
       JOIN conversations c ON c.workspace_id = wa.workspace_id AND c.kind = 'dm' AND c.dm_agent_id = a.id
       WHERE a.profile_name = ?`,
    ).get(workspaceId, profile) as { conversationId: number; agentId: number; name: string } | undefined;
    return r ?? null;
  }

  private post(workspaceId: number, conversationId: number, agentId: number, body: string, externalId: string): boolean {
    const now = Date.now();
    const r = this.db.prepare(
      `INSERT OR IGNORE INTO messages (conversation_id, workspace_id, author_kind, author_agent_id, body, state, source, external_id, created_at, updated_at)
       VALUES (?, ?, 'agent', ?, ?, 'final', 'kanban', ?, ?, ?)`,
    ).run(conversationId, workspaceId, agentId, body, externalId, now, now);
    if (!r.changes) return false;
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid));
    this.bus.publish({ type: 'message.upsert', workspaceId, conversationId, payload: row });
    return true;
  }

  private remember(id: string, status: string) {
    this.db.prepare('INSERT INTO mirror_cursors (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(`kb:${id}`, status, Date.now());
  }

  /** Exposed for tests. Returns the number of chat lines posted. */
  async pollOnce(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    let posted = 0;
    try {
      const tasks = await this.kanban.list({});
      const first = !this.db.prepare(`SELECT 1 FROM mirror_cursors WHERE key = 'kb:_started'`).get();
      for (const t of tasks) {
        if (!t?.id || !SHOWN.has(t.status)) continue;
        const prev = (this.db.prepare('SELECT value FROM mirror_cursors WHERE key = ?').get(`kb:${t.id}`) as { value: string } | undefined)?.value;
        if (prev === t.status) continue;
        this.remember(t.id, t.status);
        if (first) continue; // baseline: existing cards are not announced
        posted += await this.announce(t, prev);
      }
      if (first) this.db.prepare(`INSERT OR IGNORE INTO mirror_cursors (key, value, updated_at) VALUES ('kb:_started', '1', ?)`).run(Date.now());
      this.lastStatus = { ok: true, at: Date.now(), tasks: tasks.length };
    } catch (e) {
      this.lastStatus = { ok: false, at: Date.now(), error: (e as Error).message.slice(0, 300) };
      this.log('task feed poll failed', { error: (e as Error).message });
    } finally {
      this.busy = false;
    }
    return posted;
  }

  private async announce(t: KanbanTask, prev: string | undefined): Promise<number> {
    if (!t.assignee) return 0;
    const ws = this.workspaceFor(t);
    if (!ws) return 0;
    const worker = this.dm(ws.id, t.assignee);
    if (!worker) return 0;
    const creatorProfile = typeof t.created_by === 'string' ? t.created_by.replace(/^(profile|bot|agent):/, '') : '';
    const creator = creatorProfile && creatorProfile !== t.assignee ? this.dm(ws.id, creatorProfile) : null;
    const from = creator ? ` from ${creator.name}` : '';
    const title = String(t.title ?? 'Untitled task').slice(0, 300);
    let n = 0;
    const say = (body: string, kind: string) => { if (this.post(ws.id, worker.conversationId, worker.agentId, body, `task:${t.id}:${kind}`)) n++; };

    if (prev === undefined && t.status !== 'done' && t.status !== 'blocked') say(`📋 **New task${from}:** ${title}${t.body ? `\n\n${String(t.body).slice(0, 1500)}` : ''}`, 'new');
    if (t.status === 'running') say(`⏳ **Working on:** ${title}`, 'running');
    if (t.status === 'review') say(`🔎 **Ready for review:** ${title}`, 'review');
    if (t.status === 'done' || t.status === 'blocked') {
      const detail = await this.detail(t);
      const body = t.status === 'done'
        ? `✅ **Finished:** ${title}${detail ? `\n\n${detail}` : '\n\n_(No written result was saved on the card.)_'}`
        : `⛔ **Stuck on:** ${title}${detail ? `\n\n${detail}` : ''}\n\nOpen To-Dos to unblock it.`;
      say(body, t.status);
      // Bring the outcome back to whoever asked for it.
      if (creator && this.post(ws.id, creator.conversationId, worker.agentId, `${t.status === 'done' ? '✅' : '⛔'} **${worker.name} ${t.status === 'done' ? 'finished' : 'is stuck on'}:** ${title}${detail ? `\n\n${detail}` : ''}`, `task:${t.id}:${t.status}:to:${creatorProfile}`)) n++;
    }
    return n;
  }

  /** Result or blocking reason: from the list row when present, else from `kanban show`. */
  private async detail(t: KanbanTask): Promise<string> {
    const pick = (...xs: unknown[]) => xs.find((x) => typeof x === 'string' && x.trim()) as string | undefined;
    let text = pick(t.result, t.status === 'blocked' ? t.last_failure_error : undefined, (t as any).summary, (t as any).block_reason);
    if (!text) {
      try {
        const d = await this.kanban.show(t.id);
        const run = Array.isArray(d.runs) && d.runs.length ? (d.runs[d.runs.length - 1] as any) : null;
        text = pick(d.task?.result, run?.summary, run?.result, run?.error, d.task?.last_failure_error, d.comments?.length ? d.comments[d.comments.length - 1].body : undefined);
      } catch { /* the line is still posted without detail */ }
    }
    if (!text) return '';
    return text.length > RESULT_MAX ? text.slice(0, RESULT_MAX).trimEnd() + '\n\n… (full result on the card in To-Dos)' : text;
  }
}
