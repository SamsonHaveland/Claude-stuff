import type { DB } from '../db/index.js';
import type { HermesClient, HermesMessageRow } from '../hermes/client.js';
import type { EventBus } from './bus.js';

/**
 * READ-ONLY mirror of a profile's Telegram conversations into Hermes Control.
 *
 * Source: GET /api/sessions?source=telegram and GET /api/sessions/{id}/messages on the
 * profile's API server (verified: read handlers only check existence + bearer auth).
 * It does NOT talk to Telegram, does NOT start a poller, and does NOT write to Hermes.
 * Idempotency: each Hermes message row maps to external_id
 * "<profile>:<session>:<message id>" with a UNIQUE index, so re-polls never duplicate.
 *
 * Writing back into the Telegram chat is intentionally unsupported: the API server
 * refuses writes to sessions owned by another surface (409 permission_denied), and
 * `hermes send` would post as the bot, not as you. See docs/INTEGRATION_PLAN.md.
 */
export interface MirrorTarget {
  profile: string;
  workspace: string;
  pollSeconds: number;
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

  constructor(private db: DB, private hermes: HermesClient, private bus: EventBus, private log: (m: string, x?: unknown) => void = () => {}) {}

  start(targets: MirrorTarget[]) {
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
    ).run(ws.id, name, `Read-only mirror of ${agent.display_name}'s Telegram chats (via Hermes API)`, agent.id, Date.now());
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
      const ts = typeof m.timestamp === 'number' ? Math.round(m.timestamp * (m.timestamp < 1e12 ? 1000 : 1)) : Date.now();
      const isUser = m.role === 'user';
      const r = stmt.run(
        target.conversationId, target.workspaceId, isUser ? 'external' : 'agent', isUser ? null : target.agentId,
        isUser ? 'Telegram user' : null, text, `${profile}:${sessionId}:${m.id}`, ts, Date.now(), Date.now(),
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
