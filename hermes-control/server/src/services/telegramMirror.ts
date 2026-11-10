import { spawn } from 'node:child_process';
import type { DB } from '../db/index.js';
import type { HermesClient, HermesMessageRow } from '../hermes/client.js';
import type { EventBus } from './bus.js';

/**
 * Mirror of a profile's Telegram chat into Hermes Control, optionally two-way.
 *
 * Telegram -> Hermes Control (always, when enabled): GET /api/sessions?source=telegram and
 * GET /api/sessions/{id}/messages on the profile's API server. Read-only; no Telegram poller.
 * Idempotency: each Hermes message row maps to external_id "<profile>:<session>:<message id>"
 * with a UNIQUE index, so re-polls never duplicate.
 *
 * Hermes Control -> Telegram (two-way, off by default): Hermes refuses API writes into a
 * Telegram-owned session (409 permission_denied), so a message typed in the mirror chat runs
 * in Hermes Control's own API session for that chat, with the recent Telegram turns supplied as
 * context. When the reply completes, a copy of the exchange is posted to the profile's Telegram
 * home chat with `hermes -p <profile> send --to telegram`. That command uses the gateway's own
 * bot config (no token here, no second poller) and records the copy in the agent's Telegram
 * session transcript (verified on hermes-pi v0.23.0). It shows in Telegram as sent by the bot.
 * Copies start with COPY_MARK so the poller never mirrors them back (no echo loop).
 */
export interface MirrorTarget {
  profile: string;
  workspace: string;
  pollSeconds: number;
  twoWay?: boolean;
}

export const COPY_MARK = '💻 From Hermes Control';
const TELEGRAM_COPY_MAX = 3800; // Telegram's per-message limit is 4096
const CONTEXT_MAX_CHARS = 4000;
const CONTEXT_MAX_MESSAGES = 20;

export type TelegramSender = (profile: string, text: string) => Promise<void>;

/** Runs `hermes -p <profile> send --to telegram --quiet --file -` with the text on stdin. */
export function cliSender(cliPath: string, timeoutMs = 60_000): TelegramSender {
  return (profile, text) => new Promise((resolve, reject) => {
    const child = spawn(cliPath, ['-p', profile, 'send', '--to', 'telegram', '--quiet', '--file', '-'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stderr.on('data', (d) => { if (err.length < 2000) err += String(d); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `hermes send exited with ${code}`)); });
    child.stdin.end(text);
  });
}

/** Never let a copy attach local files or change delivery mode: those directives are Hermes syntax. */
function neutralize(text: string) {
  return text.replace(/MEDIA:\s*\S+/g, '[image in Hermes Control]').replace(/\[\[as_document\]\]/g, '');
}

export function formatCopy(agentName: string, userText: string, replyText: string) {
  let out = `${COPY_MARK}\n\nYou: ${neutralize(userText.trim())}\n\n${agentName}: ${neutralize(replyText.trim())}`;
  if (out.length > TELEGRAM_COPY_MAX) out = out.slice(0, TELEGRAM_COPY_MAX - 40).trimEnd() + '\n\n… (full reply in Hermes Control)';
  return out;
}

export function isCopy(text: string) {
  return text.trimStart().startsWith(COPY_MARK);
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === 'string' ? p : p?.type === 'text' || p?.type === 'input_text' || p?.type === 'output_text' ? p.text ?? '' : p?.type?.includes('image') ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export class TelegramMirror {
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();
  public lastStatus = new Map<string, { ok: boolean; at: number; error?: string; sessions?: number }>();

  public lastCopy = new Map<string, { ok: boolean; at: number; error?: string }>();
  private targets: MirrorTarget[] = [];

  constructor(
    private db: DB,
    private hermes: HermesClient,
    private bus: EventBus,
    private log: (m: string, x?: unknown) => void = () => {},
    private sender: TelegramSender = async () => { throw new Error('Telegram sending is not configured'); },
  ) {}

  /** Targets from config (enabled ones). Two-way also needs this so writability is known before start. */
  configure(targets: MirrorTarget[]) {
    this.targets = targets;
  }

  /** Two-way state: the Settings switch wins; otherwise the config's twoWay (default off). */
  twoWay(profile: string): boolean {
    const t = this.targets.find((x) => x.profile === profile);
    if (!t) return false;
    const s = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(`telegram.twoWay.${profile}`) as { value: string } | undefined;
    return s ? s.value === 'on' : Boolean(t.twoWay);
  }

  setTwoWay(profile: string, on: boolean) {
    if (!this.targets.some((x) => x.profile === profile)) throw new Error(`No Telegram mirror is configured for ${profile}`);
    this.db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(`telegram.twoWay.${profile}`, on ? 'on' : 'off', Date.now());
  }

  /** A mirror chat accepts messages only while two-way is on for its agent. */
  writable(conv: { kind: string; dm_agent_id?: number | null; dmAgentId?: number | null }): boolean {
    if (conv.kind !== 'telegram_mirror') return true;
    const agentId = conv.dm_agent_id ?? conv.dmAgentId;
    const a = agentId ? this.db.prepare('SELECT profile_name FROM agents WHERE id = ?').get(agentId) as { profile_name: string } | undefined : undefined;
    return !!a && this.twoWay(a.profile_name);
  }

  /**
   * Input for a turn typed in a mirror chat: the Telegram messages since the last turn sent from
   * Hermes Control, so the agent's API session knows what was said in Telegram.
   */
  buildInput(conversationId: number, requestMessageId: number, body: string): string {
    const conv = this.db.prepare('SELECT kind FROM conversations WHERE id = ?').get(conversationId) as { kind: string } | undefined;
    if (conv?.kind !== 'telegram_mirror') return body;
    const lastHc = this.db.prepare(`SELECT COALESCE(MAX(COALESCE(origin_ts, created_at)), 0) t FROM messages WHERE conversation_id = ? AND source = 'hc' AND id <> ?`).get(conversationId, requestMessageId) as { t: number };
    const rows = (this.db.prepare(
      `SELECT author_kind, author_label, body FROM messages WHERE conversation_id = ? AND source = 'telegram_mirror' AND COALESCE(origin_ts, created_at) > ?
       ORDER BY COALESCE(origin_ts, created_at) DESC, id DESC LIMIT ?`,
    ).all(conversationId, lastHc.t, CONTEXT_MAX_MESSAGES) as { author_kind: string; author_label: string | null; body: string }[]).reverse();
    if (!rows.length) return body;
    const lines: string[] = [];
    let used = 0;
    for (const r of [...rows].reverse()) {
      const line = `${r.author_kind === 'agent' ? 'You' : 'Me'}: ${r.body}`;
      if (used + line.length > CONTEXT_MAX_CHARS) break;
      lines.unshift(line);
      used += line.length;
    }
    if (!lines.length) return body;
    return `[Context: our most recent messages in Telegram, oldest first. Hermes Control shows this chat and Telegram together.]\n${lines.join('\n')}\n[End of Telegram context]\n\n${body}`;
  }

  /** After a completed reply in a mirror chat, post the exchange to Telegram once. Never throws. */
  async copyToTelegram(run: { id: number; conversation_id: number; agent_id: number; request_message_id: number; workspace_id: number }, replyText: string): Promise<void> {
    try {
      const conv = this.db.prepare('SELECT kind FROM conversations WHERE id = ?').get(run.conversation_id) as { kind: string } | undefined;
      if (conv?.kind !== 'telegram_mirror' || !replyText.trim()) return;
      const a = this.db.prepare('SELECT profile_name, display_name FROM agents WHERE id = ?').get(run.agent_id) as { profile_name: string; display_name: string };
      if (!this.twoWay(a.profile_name)) return;
      // Once per run, even across restarts or a retried stream.
      const claim = this.db.prepare('INSERT OR IGNORE INTO mirror_cursors (key, value, updated_at) VALUES (?,?,?)').run(`tgcopy:run:${run.id}`, 'sending', Date.now());
      if (!claim.changes) return;
      const req = this.db.prepare('SELECT body FROM messages WHERE id = ?').get(run.request_message_id) as { body: string };
      try {
        await this.sender(a.profile_name, formatCopy(a.display_name, req.body, replyText));
        this.db.prepare('UPDATE mirror_cursors SET value = ?, updated_at = ? WHERE key = ?').run('sent', Date.now(), `tgcopy:run:${run.id}`);
        this.lastCopy.set(a.profile_name, { ok: true, at: Date.now() });
        this.audit(run.workspace_id, 'telegram.copy', a.profile_name, { runId: run.id, ok: true });
      } catch (e) {
        const error = (e as Error).message.slice(0, 300);
        this.db.prepare('UPDATE mirror_cursors SET value = ?, updated_at = ? WHERE key = ?').run('failed', Date.now(), `tgcopy:run:${run.id}`);
        this.lastCopy.set(a.profile_name, { ok: false, at: Date.now(), error });
        this.audit(run.workspace_id, 'telegram.copy', a.profile_name, { runId: run.id, ok: false, error });
        this.log('telegram copy failed', { runId: run.id, error });
      }
    } catch (e) {
      this.log('telegram copy skipped after error', { runId: run.id, error: (e as Error).message });
    }
  }

  private audit(workspaceId: number, action: string, target: string, detail: unknown) {
    this.db.prepare('INSERT INTO audit_log (ts, workspace_id, action, target, detail) VALUES (?,?,?,?,?)').run(Date.now(), workspaceId, action, `profile:${target}`, JSON.stringify(detail));
  }

  start(targets: MirrorTarget[]) {
    this.configure(targets);
    for (const t of targets) {
      const tick = () => void this.pollOnce(t);
      tick();
      this.timers.push(setInterval(tick, t.pollSeconds * 1000));
    }
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  private conversationFor(t: MirrorTarget): { conversationId: number; workspaceId: number; agentId: number } | null {
    const ws = this.db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(t.workspace) as { id: number } | undefined;
    const agent = this.db.prepare('SELECT id, display_name FROM agents WHERE profile_name = ?').get(t.profile) as { id: number; display_name: string } | undefined;
    if (!ws || !agent) return null;
    const name = `telegram-${t.profile}`;
    this.db.prepare(
      `INSERT OR IGNORE INTO conversations (workspace_id, kind, name, topic, dm_agent_id, created_at) VALUES (?, 'telegram_mirror', ?, ?, ?, ?)`,
    ).run(ws.id, name, `${agent.display_name}'s Telegram chat (via Hermes API)`, agent.id, Date.now());
    const conv = this.db.prepare(`SELECT id FROM conversations WHERE workspace_id = ? AND kind = 'telegram_mirror' AND name = ?`).get(ws.id, name) as { id: number };
    this.db.prepare('INSERT OR IGNORE INTO conversation_agents (conversation_id, agent_id) VALUES (?, ?)').run(conv.id, agent.id);
    return { conversationId: conv.id, workspaceId: ws.id, agentId: agent.id };
  }

  async pollOnce(t: MirrorTarget): Promise<number> {
    const key = `${t.profile}@${t.workspace}`;
    if (this.running.has(key)) return 0;
    this.running.add(key);
    let inserted = 0;
    try {
      const target = this.conversationFor(t);
      if (!target) throw new Error(`workspace "${t.workspace}" or agent "${t.profile}" not found`);
      const sessions = await this.hermes.listSessions(t.profile, { source: 'telegram', limit: 20 });
      for (const s of sessions) {
        const cursorKey = `tg:${t.profile}:${s.id}:last_active`;
        const prev = this.db.prepare('SELECT value FROM mirror_cursors WHERE key = ?').get(cursorKey) as { value: string } | undefined;
        const marker = String(s.last_active ?? s.message_count ?? '');
        if (prev && prev.value === marker && marker !== '') continue; // unchanged since last poll
        const { sessionId, messages } = await this.hermes.sessionMessages(t.profile, s.id, { order: 'latest', limit: 100 });
        inserted += this.ingest(t.profile, sessionId, messages, target);
        this.db.prepare('INSERT INTO mirror_cursors (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(cursorKey, marker, Date.now());
      }
      this.lastStatus.set(key, { ok: true, at: Date.now(), sessions: sessions.length });
    } catch (e) {
      this.lastStatus.set(key, { ok: false, at: Date.now(), error: (e as Error).message });
      this.log('telegram mirror poll failed', { key, error: (e as Error).message });
    } finally {
      this.running.delete(key);
    }
    return inserted;
  }

  /** Exposed for tests. Returns number of newly inserted messages. */
  ingest(profile: string, sessionId: string, rows: HermesMessageRow[], target: { conversationId: number; workspaceId: number; agentId: number }): number {
    const sorted = [...rows].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0) || Number(a.id) - Number(b.id));
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO messages (conversation_id, workspace_id, author_kind, author_agent_id, author_label, body, state, source, external_id, origin_ts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'final', 'telegram_mirror', ?, ?, ?, ?)`,
    );
    let n = 0;
    for (const m of sorted) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      if (m.display_kind === 'hidden') continue;
      const text = extractText(m.content).trim();
      if (!text) continue;
      if (isCopy(text)) continue; // our own copy coming back from Telegram's transcript
      const ts = typeof m.timestamp === 'number' ? Math.round(m.timestamp * (m.timestamp < 1e12 ? 1000 : 1)) : Date.now();
      const isUser = m.role === 'user';
      const r = stmt.run(
        target.conversationId, target.workspaceId, isUser ? 'external' : 'agent', isUser ? null : target.agentId,
        isUser ? 'You (Telegram)' : null, text, `${profile}:${sessionId}:${m.id}`, ts, Date.now(), Date.now(),
      );
      if (r.changes > 0) {
        n++;
        const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid));
        this.bus.publish({ type: 'message.upsert', workspaceId: target.workspaceId, conversationId: target.conversationId, payload: row });
      }
    }
    return n;
  }
}
