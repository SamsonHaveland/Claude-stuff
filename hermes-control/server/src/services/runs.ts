import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.js';
import { HermesClient, HermesError, type RunEvent } from '../hermes/client.js';
import type { EventBus } from './bus.js';

/**
 * Delivers a human message to a Hermes profile and records the REAL outcome.
 *
 * Flow (all endpoints verified, see docs/HERMES_AUDIT.md):
 *   1. one API-owned Hermes session per (conversation, agent)   POST /api/sessions
 *   2. submit the turn with a durable Idempotency-Key           POST /v1/runs
 *   3. follow progress, resuming by Last-Event-ID               GET  /v1/runs/{id}/events
 *   4. if the stream is gone, reconcile from status             GET  /v1/runs/{id}
 *
 * The reply message stays 'pending'/'streaming' until Hermes emits a terminal
 * run.<status> event (or reports a terminal status); nothing is marked final on
 * assumption. Failures are shown as failures.
 */
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const MAX_STREAM_ATTEMPTS = 6;

export interface RunRow {
  id: number;
  agent_id: number;
  conversation_id: number;
  workspace_id: number;
  request_message_id: number;
  reply_message_id: number;
  idempotency_key: string;
  hermes_run_id: string | null;
  hermes_session_id: string | null;
  status: string;
  last_seq: number;
}

export interface RunHooks {
  /** Rewrite the text sent to Hermes (the stored message is unchanged). */
  input?: (run: RunRow, body: string) => string;
  /** Called once a reply completed, with its final text. Must not throw. */
  completed?: (run: RunRow, replyText: string) => void | Promise<void>;
}

export class RunService {
  private active = new Map<number, AbortController>();
  public hooks: RunHooks = {};

  constructor(private db: DB, private hermes: HermesClient, private bus: EventBus, private log: (msg: string, extra?: unknown) => void = () => {}) {}

  private profileOf(agentId: number): string {
    const row = this.db.prepare('SELECT profile_name FROM agents WHERE id = ?').get(agentId) as { profile_name: string } | undefined;
    if (!row) throw new Error(`agent ${agentId} not found`);
    return row.profile_name;
  }

  private now() {
    return Date.now();
  }

  /** Create the pending reply + run rows and start delivery in the background. */
  enqueue(opts: { workspaceId: number; conversationId: number; requestMessageId: number; agentId: number; label: string; parentId?: number | null }): number {
    const t = this.now();
    const reply = this.db.prepare(
      `INSERT INTO messages (conversation_id, workspace_id, parent_id, author_kind, author_agent_id, author_label, body, state, source, created_at, updated_at)
       VALUES (?, ?, ?, 'agent', ?, ?, '', 'pending', 'hermes_run', ?, ?)`,
    ).run(opts.conversationId, opts.workspaceId, opts.parentId ?? null, opts.agentId, opts.label, t, t);
    const replyId = Number(reply.lastInsertRowid);
    const key = `hc-${opts.requestMessageId}-${opts.agentId}-${randomBytes(12).toString('hex')}`;
    const run = this.db.prepare(
      `INSERT INTO runs (agent_id, conversation_id, workspace_id, request_message_id, reply_message_id, idempotency_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'submitting', ?, ?)`,
    ).run(opts.agentId, opts.conversationId, opts.workspaceId, opts.requestMessageId, replyId, key, t, t);
    const runId = Number(run.lastInsertRowid);
    this.publishMessage(replyId);
    void this.drive(runId);
    return runId;
  }

  /** On startup: resume every run that had not reached a terminal state. */
  resumeOpenRuns() {
    const rows = this.db.prepare(`SELECT id FROM runs WHERE status NOT IN ('completed','failed','cancelled','interrupted')`).all() as { id: number }[];
    for (const r of rows) void this.drive(r.id);
    return rows.length;
  }

  stopAll() {
    for (const c of this.active.values()) c.abort();
    this.active.clear();
  }

  private get(runId: number): RunRow {
    return this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown as RunRow;
  }

  private ensureSession(conversationId: number, agentId: number, profile: string): Promise<string> | string {
    const existing = this.db.prepare('SELECT hermes_session_id FROM hermes_bindings WHERE conversation_id = ? AND agent_id = ?').get(conversationId, agentId) as { hermes_session_id: string } | undefined;
    if (existing) return existing.hermes_session_id;
    const conv = this.db.prepare('SELECT c.name, c.kind, w.slug FROM conversations c JOIN workspaces w ON w.id = c.workspace_id WHERE c.id = ?').get(conversationId) as { name: string; kind: string; slug: string };
    const sessionId = `hc_${conv.slug}_${conversationId}_${agentId}_${randomBytes(4).toString('hex')}`.replace(/[^A-Za-z0-9_-]/g, '_');
    const title = `Hermes Control · ${conv.slug} · ${conv.kind === 'dm' ? 'DM' : '#' + conv.name}`;
    return this.hermes.createSession(profile, { id: sessionId, title }).then((id) => {
      this.db.prepare('INSERT OR IGNORE INTO hermes_bindings (conversation_id, agent_id, hermes_session_id, created_at) VALUES (?,?,?,?)').run(conversationId, agentId, id, this.now());
      const bound = this.db.prepare('SELECT hermes_session_id FROM hermes_bindings WHERE conversation_id = ? AND agent_id = ?').get(conversationId, agentId) as { hermes_session_id: string };
      return bound.hermes_session_id;
    });
  }

  private async drive(runId: number) {
    if (this.active.has(runId)) return;
    const ctrl = new AbortController();
    this.active.set(runId, ctrl);
    try {
      let run = this.get(runId);
      const profile = this.profileOf(run.agent_id);
      if (!run.hermes_run_id) {
        const sessionId = await this.ensureSession(run.conversation_id, run.agent_id, profile);
        const req = this.db.prepare('SELECT body FROM messages WHERE id = ?').get(run.request_message_id) as { body: string };
        const ws = this.db.prepare('SELECT slug FROM workspaces WHERE id = ?').get(run.workspace_id) as { slug: string };
        // Same key on every retry: Hermes dedupes durably, so a crash between submit and
        // persisting the run id can never execute the turn twice.
        const created = await this.hermes.createRun(profile, { input: this.hooks.input ? this.hooks.input(run, req.body) : req.body, session_id: sessionId }, run.idempotency_key, `hermes-control:${ws.slug}:${run.conversation_id}`);
        this.db.prepare(`UPDATE runs SET hermes_run_id = ?, hermes_session_id = ?, status = ?, updated_at = ? WHERE id = ?`).run(created.run_id, sessionId, created.status || 'started', this.now(), runId);
        run = this.get(runId);
      }
      await this.follow(run, profile, ctrl.signal);
    } catch (e) {
      const err = e as HermesError;
      this.log('run delivery failed', { runId, error: err.message, code: err.code });
      // Disabled / missing key / permanent 4xx => failed. Transient errors also surface as
      // failed with the real reason; the user can retry explicitly (no silent loops).
      this.finish(runId, 'failed', null, err.message);
    } finally {
      this.active.delete(runId);
    }
  }

  private async follow(run: RunRow, profile: string, signal: AbortSignal) {
    for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS && !signal.aborted; attempt++) {
      const current = this.get(run.id);
      if (TERMINAL.has(current.status)) return;
      try {
        await this.hermes.streamRunEvents(profile, run.hermes_run_id!, current.last_seq, (ev) => this.onEvent(run.id, ev), signal);
      } catch (e) {
        if ((e as HermesError).code !== 'run_not_found' && attempt < MAX_STREAM_ATTEMPTS - 1) {
          await sleep(Math.min(1000 * 2 ** attempt, 15_000), signal);
          continue;
        }
      }
      if (TERMINAL.has(this.get(run.id).status)) return;
      // Stream ended without a terminal event (expired buffer, restart): reconcile from status.
      const status = await this.hermes.getRun(profile, run.hermes_run_id!).catch(() => null);
      if (status && TERMINAL.has(status.status)) {
        this.finish(run.id, status.status, typeof status.output === 'string' ? status.output : null, status.error ?? null);
        return;
      }
      await sleep(Math.min(1000 * 2 ** attempt, 15_000), signal);
    }
    if (!TERMINAL.has(this.get(run.id).status) && !signal.aborted) {
      this.db.prepare(`UPDATE runs SET status = 'unknown', error = ?, updated_at = ? WHERE id = ?`).run('Lost contact with Hermes before the run finished. Status unknown; check Hermes.', this.now(), run.id);
      this.setReply(run.id, { state: 'failed', error: 'Lost contact with Hermes before the run finished (status unknown).' });
    }
  }

  /** Exposed for tests. */
  onEvent(runId: number, ev: RunEvent) {
    const run = this.get(runId);
    if (typeof ev.seq === 'number') {
      if (ev.seq <= run.last_seq) return; // duplicate after reconnect
      this.db.prepare('INSERT OR IGNORE INTO run_events (run_id, seq, event, payload, created_at) VALUES (?,?,?,?,?)').run(runId, ev.seq, ev.event, JSON.stringify(ev), this.now());
      this.db.prepare('UPDATE runs SET last_seq = ?, last_event = ?, updated_at = ? WHERE id = ?').run(ev.seq, ev.event, this.now(), runId);
    }
    const name = ev.event;
    if (name === 'message.delta' && typeof ev.delta === 'string') {
      this.db.prepare(`UPDATE messages SET body = body || ?, state = 'streaming', updated_at = ? WHERE id = ?`).run(ev.delta, this.now(), run.reply_message_id);
      this.db.prepare(`UPDATE runs SET status = 'running' WHERE id = ? AND status NOT IN ('completed','failed','cancelled','interrupted')`).run(runId);
      this.publishMessage(run.reply_message_id);
    } else if (name === 'approval.request') {
      this.recordApproval(run, ev);
    } else if (name === 'approval.responded') {
      this.db.prepare(`UPDATE approvals SET status = 'confirmed' WHERE run_id = ? AND status IN ('pending','submitted') AND (request_id IS NULL OR request_id = ? OR ? IS NULL)`).run(runId, (ev.request_id as string) ?? null, (ev.request_id as string) ?? null);
      this.bus.publish({ type: 'approvals.changed', workspaceId: run.workspace_id, payload: { runId } });
    } else if (name.startsWith('run.') && TERMINAL.has(name.slice(4))) {
      this.finish(runId, name.slice(4), typeof ev.output === 'string' ? ev.output : null, (ev.error as string) ?? null);
      return;
    }
    if (name.startsWith('tool.') || name.startsWith('subagent.') || name === 'run.started' || name === 'run.queued') {
      this.bus.publish({
        type: 'activity',
        workspaceId: run.workspace_id,
        conversationId: run.conversation_id,
        payload: { runId, agentId: run.agent_id, event: name, tool: ev.tool ?? null, preview: typeof ev.preview === 'string' ? ev.preview.slice(0, 300) : null, error: ev.error ?? null, at: Date.now() },
      });
    }
  }

  private recordApproval(run: RunRow, ev: RunEvent) {
    const requestId = (ev.request_id ?? ev.prompt_id ?? null) as string | null;
    const choices = Array.isArray(ev.choices) ? ev.choices : ['once', 'deny'];
    this.db.prepare(
      `INSERT OR IGNORE INTO approvals (run_id, workspace_id, agent_id, request_id, execution_generation, command, description, choices, raw, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?)`,
    ).run(run.id, run.workspace_id, run.agent_id, requestId, typeof ev.execution_generation === 'number' ? ev.execution_generation : null,
      typeof ev.command === 'string' ? ev.command : null, typeof ev.description === 'string' ? ev.description : null,
      JSON.stringify(choices), JSON.stringify(ev), this.now());
    this.db.prepare(`UPDATE runs SET status = 'waiting_for_approval', updated_at = ? WHERE id = ?`).run(this.now(), run.id);
    this.bus.publish({ type: 'approvals.changed', workspaceId: run.workspace_id, payload: { runId: run.id } });
  }

  private finish(runId: number, status: string, output: string | null, error: string | null) {
    const run = this.get(runId);
    if (TERMINAL.has(run.status)) return;
    this.db.prepare('UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(status, error, this.now(), runId);
    const state = status === 'completed' ? 'final' : status === 'cancelled' ? 'cancelled' : 'failed';
    const patch: { state: string; error?: string | null; body?: string } = { state, error };
    // run.completed carries the authoritative final text; prefer it over accumulated deltas.
    if (output !== null && output !== '') patch.body = output;
    this.setReply(runId, patch);
    this.db.prepare(`UPDATE approvals SET status = 'expired' WHERE run_id = ? AND status = 'pending'`).run(runId);
    this.bus.publish({ type: 'approvals.changed', workspaceId: run.workspace_id, payload: { runId } });
    if (status === 'completed' && this.hooks.completed) {
      const reply = this.db.prepare('SELECT body FROM messages WHERE id = ?').get(run.reply_message_id) as { body: string };
      void Promise.resolve().then(() => this.hooks.completed!(run, reply.body)).catch((e) => this.log('completed hook failed', { runId, error: (e as Error).message }));
    }
  }

  private setReply(runId: number, patch: { state: string; error?: string | null; body?: string }) {
    const run = this.get(runId);
    if (patch.body !== undefined) {
      this.db.prepare('UPDATE messages SET body = ?, state = ?, error = ?, updated_at = ? WHERE id = ?').run(patch.body, patch.state, patch.error ?? null, this.now(), run.reply_message_id);
    } else {
      this.db.prepare('UPDATE messages SET state = ?, error = ?, updated_at = ? WHERE id = ?').run(patch.state, patch.error ?? null, this.now(), run.reply_message_id);
    }
    this.publishMessage(run.reply_message_id);
  }

  publishMessage(messageId: number) {
    const m = this.db.prepare('SELECT m.*, r.id AS run_id, r.status AS run_status FROM messages m LEFT JOIN runs r ON r.reply_message_id = m.id WHERE m.id = ?').get(messageId) as any;
    if (m) this.bus.publish({ type: 'message.upsert', workspaceId: m.workspace_id, conversationId: m.conversation_id, payload: m });
  }

  /** Send a decision for an approval. Never marks anything approved without Hermes' 2xx. */
  async decide(approvalId: number, choice: string, userId: number) {
    const ap = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId) as any;
    if (!ap) throw new HermesError('Approval not found', 404, 'not_found');
    if (ap.status !== 'pending') throw new HermesError(`Approval is ${ap.status}`, 409, 'not_pending');
    const allowed: string[] = JSON.parse(ap.choices);
    if (!allowed.includes(choice)) throw new HermesError(`Choice must be one of ${allowed.join(', ')}`, 400, 'invalid_choice');
    const run = this.get(ap.run_id);
    const profile = this.profileOf(run.agent_id);
    // Canonical gateways require the CURRENT prompt identity from pending_controls.
    let requestId: string | null = ap.request_id;
    let generation: number | null = ap.execution_generation;
    const status = await this.hermes.getRun(profile, run.hermes_run_id!).catch(() => null);
    const controls: any[] = Array.isArray(status?.pending_controls) ? status.pending_controls : [];
    const ctl = controls.find((c) => !requestId || c.prompt_id === requestId || c.request_id === requestId) ?? controls[0];
    if (ctl) {
      requestId = ctl.prompt_id ?? ctl.request_id ?? requestId;
      generation = typeof ctl.execution_generation === 'number' ? ctl.execution_generation : generation;
    }
    this.db.prepare(`UPDATE approvals SET status = 'submitted', decision = ?, decided_by = ?, decided_at = ? WHERE id = ?`).run(choice, userId, this.now(), approvalId);
    this.bus.publish({ type: 'approvals.changed', workspaceId: ap.workspace_id, payload: { runId: run.id } });
    const body: Record<string, unknown> = { choice };
    if (requestId) body.request_id = requestId;
    if (generation !== null && generation !== undefined) body.execution_generation = generation;
    try {
      const resp = await this.hermes.respondApproval(profile, run.hermes_run_id!, body);
      this.db.prepare(`UPDATE approvals SET status = 'confirmed', hermes_response = ? WHERE id = ?`).run(JSON.stringify(resp), approvalId);
      return { status: 'confirmed', hermes: resp };
    } catch (e) {
      const err = e as HermesError;
      // 409 = stale / already settled elsewhere (e.g. answered on Telegram). Report, don't guess.
      const next = err.status === 409 ? 'rejected' : 'error';
      this.db.prepare(`UPDATE approvals SET status = ?, hermes_response = ? WHERE id = ?`).run(next, JSON.stringify({ error: err.message, code: err.code, status: err.status }), approvalId);
      throw err;
    } finally {
      this.bus.publish({ type: 'approvals.changed', workspaceId: ap.workspace_id, payload: { runId: run.id } });
    }
  }

  async stop(runId: number) {
    const run = this.get(runId);
    if (!run?.hermes_run_id) throw new HermesError('Run has not been accepted by Hermes yet', 409, 'not_started');
    return this.hermes.stopRun(this.profileOf(run.agent_id), run.hermes_run_id);
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}
