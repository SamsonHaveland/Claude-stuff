import type { Config } from '../config.js';

/**
 * Client for the Hermes gateway API server (gateway/platforms/api_server*.py upstream).
 * Every endpoint used here is documented in website/docs/user-guide/features/api-server.md;
 * see docs/HERMES_AUDIT.md for the verification trail. Keys are read from server-side
 * environment variables and never leave this process.
 */
export class HermesError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export interface RunEvent {
  event: string;
  run_id: string;
  seq?: number;
  timestamp?: number;
  [k: string]: unknown;
}

export interface HermesSessionRow {
  id: string;
  source?: string;
  title?: string | null;
  started_at?: number;
  last_active?: number;
  user_id?: string | null;
  message_count?: number;
}

export interface HermesMessageRow {
  id: number | string;
  session_id: string;
  role: string;
  content: unknown;
  timestamp?: number;
  display_kind?: string | null;
  tool_name?: string | null;
}

export function keyEnvFor(profile: string, cfg: Config): string {
  return cfg.hermes.profiles[profile]?.keyEnv ?? `HC_HERMES_KEY_${profile.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export function baseUrlFor(profile: string, cfg: Config): string {
  const override = cfg.hermes.profiles[profile]?.baseUrl;
  if (override) return override.replace(/\/$/, '');
  const base = cfg.hermes.baseUrl.replace(/\/$/, '');
  // Multiplexed gateways serve named profiles under /p/<profile>/ (api-server.md "Multi-profile routing").
  return cfg.hermes.multiplex && profile !== 'default' ? `${base}/p/${encodeURIComponent(profile)}` : base;
}

export class HermesClient {
  constructor(
    private cfg: Config,
    private env: NodeJS.ProcessEnv = process.env,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  isEnabled(): boolean {
    return this.cfg.hermes.mode === 'live';
  }

  hasKey(profile: string): boolean {
    return Boolean(this.env[keyEnvFor(profile, this.cfg)]);
  }

  private async req<T>(profile: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T; headers: Headers }> {
    if (!this.isEnabled()) throw new HermesError('Hermes integration is disabled (hermes.mode != live)', 503, 'hermes_disabled');
    const key = this.env[keyEnvFor(profile, this.cfg)];
    if (!key) throw new HermesError(`No API key configured for profile "${profile}" (set ${keyEnvFor(profile, this.cfg)})`, 503, 'hermes_key_missing');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.hermes.requestTimeoutMs);
    try {
      const res = await this.fetchImpl(baseUrlFor(profile, this.cfg) + path, {
        method,
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      if (!res.ok) {
        const err = data?.error;
        const code = typeof err === 'object' ? err?.code : data?.code;
        const msg = typeof err === 'object' ? err?.message : typeof err === 'string' ? err : `HTTP ${res.status}`;
        throw new HermesError(String(msg ?? `HTTP ${res.status}`), res.status, code ?? undefined);
      }
      return { status: res.status, data, headers: res.headers };
    } catch (e) {
      if (e instanceof HermesError) throw e;
      throw new HermesError(`Hermes unreachable for profile "${profile}": ${(e as Error).message}`, 502, 'hermes_unreachable');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Unauthenticated liveness probe (GET /health). */
  async health(profile: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    try {
      const res = await this.fetchImpl(baseUrlFor(profile, this.cfg) + '/health', { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async capabilities(profile: string) {
    return (await this.req<any>(profile, 'GET', '/v1/capabilities')).data;
  }

  async createSession(profile: string, opts: { id?: string; title?: string }): Promise<string> {
    const { data } = await this.req<any>(profile, 'POST', '/api/sessions', opts);
    const id = data?.session?.id;
    if (!id) throw new HermesError('Hermes did not return a session id', 502, 'bad_response');
    return id;
  }

  async listSessions(profile: string, opts: { source?: string; limit?: number }): Promise<HermesSessionRow[]> {
    const q = new URLSearchParams();
    if (opts.source) q.set('source', opts.source);
    q.set('limit', String(opts.limit ?? 20));
    return (await this.req<any>(profile, 'GET', `/api/sessions?${q}`)).data?.data ?? [];
  }

  async sessionMessages(profile: string, sessionId: string, opts: { limit?: number; offset?: number; order?: 'oldest' | 'latest' } = {}): Promise<{ sessionId: string; messages: HermesMessageRow[] }> {
    const q = new URLSearchParams({ inline_images: 'false' });
    if (opts.limit !== undefined) q.set('limit', String(opts.limit));
    if (opts.offset !== undefined) q.set('offset', String(opts.offset));
    if (opts.order) q.set('order', opts.order);
    const { data } = await this.req<any>(profile, 'GET', `/api/sessions/${encodeURIComponent(sessionId)}/messages?${q}`);
    return { sessionId: data?.session_id ?? sessionId, messages: data?.data ?? [] };
  }

  async createRun(profile: string, body: { input: string; session_id?: string; instructions?: string }, idempotencyKey: string, sessionKey?: string) {
    const headers: Record<string, string> = { 'Idempotency-Key': idempotencyKey };
    if (sessionKey) headers['X-Hermes-Session-Key'] = sessionKey;
    const { data } = await this.req<{ run_id: string; status: string; replayed?: boolean }>(profile, 'POST', '/v1/runs', body, headers);
    if (!data?.run_id) throw new HermesError('Hermes did not return a run_id', 502, 'bad_response');
    return data;
  }

  async getRun(profile: string, runId: string) {
    return (await this.req<any>(profile, 'GET', `/v1/runs/${encodeURIComponent(runId)}`)).data;
  }

  async stopRun(profile: string, runId: string) {
    return (await this.req<any>(profile, 'POST', `/v1/runs/${encodeURIComponent(runId)}/stop`, {})).data;
  }

  /** POST /v1/runs/{id}/approval. Body shape differs by gateway mode; see approvals service. */
  async respondApproval(profile: string, runId: string, body: Record<string, unknown>) {
    return (await this.req<any>(profile, 'POST', `/v1/runs/${encodeURIComponent(runId)}/approval`, body)).data;
  }

  /**
   * Subscribe to GET /v1/runs/{id}/events. Resumes with Last-Event-ID (verified in
   * api_server_runs.py::_handle_run_events). Resolves when the stream closes.
   */
  async streamRunEvents(profile: string, runId: string, lastSeq: number, onEvent: (e: RunEvent) => void, signal?: AbortSignal): Promise<void> {
    if (!this.isEnabled()) throw new HermesError('Hermes integration is disabled', 503, 'hermes_disabled');
    const key = this.env[keyEnvFor(profile, this.cfg)];
    if (!key) throw new HermesError(`No API key for profile "${profile}"`, 503, 'hermes_key_missing');
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: 'text/event-stream' };
    if (lastSeq >= 0) headers['Last-Event-ID'] = String(lastSeq);
    let res: Response;
    try {
      res = await this.fetchImpl(`${baseUrlFor(profile, this.cfg)}/v1/runs/${encodeURIComponent(runId)}/events`, { headers, signal });
    } catch (e) {
      throw new HermesError(`Run event stream failed: ${(e as Error).message}`, 502, 'hermes_unreachable');
    }
    if (!res.ok || !res.body) throw new HermesError(`Run event stream HTTP ${res.status}`, res.status, res.status === 404 ? 'run_not_found' : undefined);
    await parseSse(res.body, (data, id) => {
      try {
        const ev = JSON.parse(data) as RunEvent;
        if (ev.seq === undefined && id !== undefined && /^\d+$/.test(id)) ev.seq = Number(id);
        onEvent(ev);
      } catch {
        /* ignore malformed frame */
      }
    });
  }
}

/** Minimal SSE parser: handles comments (":" lines), multi-line data, ids. */
export async function parseSse(body: ReadableStream<Uint8Array>, onData: (data: string, id?: string) => void): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let data: string[] = [];
  let id: string | undefined;
  const flush = () => {
    if (data.length) onData(data.join('\n'), id);
    data = [];
    id = undefined;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line === '') flush();
      else if (line.startsWith(':')) continue;
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('id:')) id = line.slice(3).trim();
    }
  }
  flush();
}
