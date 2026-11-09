/**
 * TEST DOUBLE ONLY. A tiny HTTP server that imitates the *verified* subset of the Hermes
 * API server contract (see docs/HERMES_AUDIT.md): bearer auth, /health, POST /api/sessions,
 * GET /api/sessions(?source), GET /api/sessions/{id}/messages, POST /v1/runs with
 * Idempotency-Key, GET /v1/runs/{id}, GET /v1/runs/{id}/events (SSE, seq ids, Last-Event-ID),
 * POST /v1/runs/{id}/approval. It is never used outside automated tests.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeRun {
  id: string;
  sessionId: string;
  input: string;
  events: Record<string, unknown>[];
  status: string;
  subscribers: Set<ServerResponse>;
  output?: string;
}

export interface FakeHermesOptions {
  key: string;
  /** Script per run: produce events. Default: echo deltas then complete. */
  script?: (run: FakeRun, fake: FakeHermes) => Promise<void> | void;
}

export class FakeHermes {
  sessions = new Map<string, { id: string; source: string; title?: string; last_active: number }>();
  messages = new Map<string, { id: number; role: string; content: unknown; timestamp: number }[]>();
  runs = new Map<string, FakeRun>();
  idem = new Map<string, string>();
  approvalCalls: { runId: string; body: any }[] = [];
  runCreates = 0;
  dropStreamAfter: number | null = null;
  approvalStatus = 200;
  url = '';
  private server = createServer((req, res) => void this.handle(req, res));
  private seq = 0;

  constructor(private opts: FakeHermesOptions) {}

  async start(port = 0) {
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    for (const r of this.runs.values()) for (const s of r.subscribers) s.destroy();
    this.server.closeAllConnections?.();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  emit(run: FakeRun, event: string, fields: Record<string, unknown> = {}) {
    const ev = { event, run_id: run.id, timestamp: Date.now() / 1000, ...fields };
    run.events.push(ev);
    const seq = run.events.length - 1;
    for (const s of run.subscribers) s.write(`id: ${seq}\ndata: ${JSON.stringify({ ...ev, seq })}\n\n`);
    if (event.startsWith('run.') && ['completed', 'failed', 'cancelled', 'interrupted'].includes(event.slice(4))) {
      run.status = event.slice(4);
      for (const s of run.subscribers) s.end(': stream closed\n\n');
      run.subscribers.clear();
    }
  }

  addTelegram(sessionId: string, rows: { role: string; content: unknown }[]) {
    this.sessions.set(sessionId, { id: sessionId, source: 'telegram', last_active: Date.now() / 1000 });
    const list = this.messages.get(sessionId) ?? [];
    for (const r of rows) list.push({ id: ++this.seq, role: r.role, content: r.content, timestamp: Date.now() / 1000 + this.seq / 1000 });
    this.messages.set(sessionId, list);
    this.sessions.get(sessionId)!.last_active = Date.now() / 1000 + this.seq;
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private async body(req: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, 'http://x');
    // Strip a multiplex /p/<profile> prefix.
    const path = url.pathname.replace(/^\/p\/[a-z0-9_-]+/, '');
    if (path === '/health') return this.json(res, 200, { status: 'ok' });
    if (req.headers.authorization !== `Bearer ${this.opts.key}`) return this.json(res, 401, { error: { message: 'Invalid API key', code: 'invalid_api_key' } });

    if (req.method === 'POST' && path === '/api/sessions') {
      const b = await this.body(req);
      const id = b.id ?? `api_${Date.now()}`;
      if (this.sessions.has(id)) return this.json(res, 409, { error: { message: 'exists', code: 'session_exists' } });
      this.sessions.set(id, { id, source: 'api_server', title: b.title, last_active: Date.now() / 1000 });
      return this.json(res, 201, { object: 'hermes.session', session: { id, source: 'api_server', title: b.title } });
    }
    if (req.method === 'GET' && path === '/api/sessions') {
      const source = url.searchParams.get('source');
      return this.json(res, 200, { object: 'list', data: [...this.sessions.values()].filter((s) => !source || s.source === source) });
    }
    let m = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!this.sessions.has(id)) return this.json(res, 404, { error: { message: 'not found', code: 'session_not_found' } });
      const rows = (this.messages.get(id) ?? []).map((r) => ({ ...r, session_id: id }));
      return this.json(res, 200, { object: 'list', session_id: id, data: rows });
    }
    if (req.method === 'POST' && path === '/v1/runs') {
      const b = await this.body(req);
      const key = String(req.headers['idempotency-key'] ?? '');
      if (key && this.idem.has(key)) {
        res.setHeader('Idempotency-Replayed', 'true');
        return this.json(res, 202, { run_id: this.idem.get(key), status: 'started', replayed: true });
      }
      if (b.session_id && this.sessions.get(b.session_id)?.source === 'telegram') {
        return this.json(res, 409, { error: { message: 'session owned by another surface', code: 'permission_denied' } });
      }
      this.runCreates++;
      const run: FakeRun = { id: `run_${this.runs.size + 1}`, sessionId: b.session_id, input: b.input, events: [], status: 'running', subscribers: new Set() };
      this.runs.set(run.id, run);
      if (key) this.idem.set(key, run.id);
      this.json(res, 202, { run_id: run.id, status: 'started' });
      setTimeout(() => void (this.opts.script ?? defaultScript)(run, this), 20);
      return;
    }
    m = path.match(/^\/v1\/runs\/([^/]+)(\/events|\/approval|\/stop)?$/);
    if (m) {
      const run = this.runs.get(m[1]);
      if (!run) return this.json(res, 404, { error: { message: 'Run not found', code: 'run_not_found' } });
      if (!m[2] && req.method === 'GET') {
        const pending = run.events.filter((e) => e.event === 'approval.request').slice(-1).map((e) => ({ prompt_id: e.request_id, execution_generation: 1 }));
        return this.json(res, 200, { object: 'hermes.run', run_id: run.id, status: run.status, output: run.output, pending_controls: run.status === 'waiting_for_approval' ? pending : [] });
      }
      if (m[2] === '/approval' && req.method === 'POST') {
        const b = await this.body(req);
        this.approvalCalls.push({ runId: run.id, body: b });
        if (this.approvalStatus !== 200) return this.json(res, this.approvalStatus, { error: { message: 'stale', code: 'stale_generation' } });
        run.status = 'running';
        this.json(res, 200, { object: 'hermes.run.approval_response', run_id: run.id, choice: b.choice, resolved: 1 });
        this.emit(run, 'approval.responded', { choice: b.choice, request_id: b.request_id, resolved: 1 });
        if (b.choice === 'deny') this.finish(run, 'failed', 'BLOCKED: denied by user');
        else this.finish(run, 'completed', 'Approved action executed.');
        return;
      }
      if (m[2] === '/stop') { this.finish(run, 'cancelled'); return this.json(res, 200, { run_id: run.id, status: 'stopping' }); }
      if (m[2] === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': open\n\n');
        const last = req.headers['last-event-id'] !== undefined ? Number(req.headers['last-event-id']) : -1;
        run.events.forEach((e, i) => { if (i > last) res.write(`id: ${i}\ndata: ${JSON.stringify({ ...e, seq: i })}\n\n`); });
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return res.end(': stream closed\n\n');
        run.subscribers.add(res);
        if (this.dropStreamAfter !== null) {
          const n = this.dropStreamAfter;
          this.dropStreamAfter = null;
          setTimeout(() => { run.subscribers.delete(res); res.destroy(); }, n);
        }
        req.on('close', () => run.subscribers.delete(res));
        return;
      }
    }
    this.json(res, 404, { error: { message: 'not found' } });
  }

  finish(run: FakeRun, status: string, output?: string) {
    run.output = output;
    this.emit(run, `run.${status}`, { output, ...(status === 'failed' ? { error: output } : {}) });
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function defaultScript(run: FakeRun, fake: FakeHermes) {
  fake.emit(run, 'run.started');
  fake.emit(run, 'tool.started', { tool: 'read_file', preview: 'budget.xlsx' });
  fake.emit(run, 'tool.completed', { tool: 'read_file', duration: 0.1, error: false });
  for (const part of ['Echo: ', run.input]) {
    fake.emit(run, 'message.delta', { delta: part });
    await sleep(15);
  }
  fake.finish(run, 'completed', `Echo: ${run.input}`);
}
