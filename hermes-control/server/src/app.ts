import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from './config.js';
import type { DB } from './db/index.js';
import { HermesClient, HermesError } from './hermes/client.js';
import { KanbanAdapter } from './hermes/kanban.js';
import { EventBus } from './services/bus.js';
import { RunService } from './services/runs.js';
import { TelegramMirror, cliSender } from './services/telegramMirror.js';
import { TaskFeed } from './services/taskFeed.js';
import { newToken, sha256, verifyPassword } from './lib/auth.js';
import { audit } from './lib/audit.js';
import { registerApi } from './routes/api.js';

export const SESSION_COOKIE = 'hc_session';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export interface AuthedUser {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  csrf: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

export interface AppDeps {
  cfg: Config;
  db: DB;
  hermes?: HermesClient;
  kanban?: KanbanAdapter;
  webDist?: string;
  logger?: boolean;
  mirror?: TelegramMirror;
}

export interface AppContext {
  cfg: Config;
  db: DB;
  hermes: HermesClient;
  kanban: KanbanAdapter;
  bus: EventBus;
  runs: RunService;
  mirror: TelegramMirror;
  taskFeed: TaskFeed;
  uploadsDir: string;
  avatarsDir: string;
}

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { cfg, db } = deps;
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 1024 * 1024, trustProxy: '127.0.0.1' });
  const hermes = deps.hermes ?? new HermesClient(cfg);
  const kanban = deps.kanban ?? new KanbanAdapter(cfg);
  const bus = new EventBus();
  const log = (m: string, x?: unknown) => app.log.warn({ detail: x }, m);
  const runs = new RunService(db, hermes, bus, log);
  const mirror = deps.mirror ?? new TelegramMirror(db, hermes, bus, log, cliSender(cfg.hermes.cliPath));
  mirror.configure(cfg.telegramMirror.filter((t) => t.enabled));
  runs.hooks = {
    input: (run, body) => mirror.buildInput(run.conversation_id, run.request_message_id, body),
    completed: (run, text) => mirror.copyToTelegram(run, text),
  };
  const uploadsDir = join(cfg.dataDir, 'uploads');
  const avatarsDir = join(cfg.dataDir, 'avatars');
  mkdirSync(uploadsDir, { recursive: true });
  mkdirSync(avatarsDir, { recursive: true });
  const taskFeed = new TaskFeed(db, cfg, kanban, bus, log, (wsId, agentId) => {
    const c = db.prepare(`SELECT id, kind, dm_agent_id FROM conversations WHERE workspace_id = ? AND kind = 'telegram_mirror' AND dm_agent_id = ?`).get(wsId, agentId) as any;
    return c && mirror.writable(c) ? c.id : null;
  });
  const ctx: AppContext = { cfg, db, hermes, kanban, bus, runs, mirror, taskFeed, uploadsDir, avatarsDir };

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return payload;
  });

  // ---- authentication -------------------------------------------------------------
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: 'unauthenticated' });
    const row = db.prepare(
      `SELECT u.id, u.username, u.display_name, u.role, s.csrf_token AS csrf, s.expires_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    ).get(sha256(token)) as (AuthedUser & { expires_at: number }) | undefined;
    if (!row || row.expires_at < Date.now()) return reply.code(401).send({ error: 'unauthenticated' });
    req.user = { id: row.id, username: row.username, display_name: row.display_name, role: row.role, csrf: row.csrf };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      // CSRF: double-submit token bound to the server-side session + Origin allowlist.
      if (req.headers['x-csrf-token'] !== row.csrf) return reply.code(403).send({ error: 'csrf' });
      const origin = req.headers.origin;
      if (origin && cfg.server.allowedOrigins.length && !cfg.server.allowedOrigins.includes(origin)) {
        return reply.code(403).send({ error: 'origin_not_allowed' });
      }
    }
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    if (typeof body.username !== 'string' || typeof body.password !== 'string') return reply.code(400).send({ error: 'bad_request' });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(body.username.trim().toLowerCase()) as any;
    const ok = user ? verifyPassword(body.password, user.password_hash) : (verifyPassword(body.password, DUMMY_HASH), false);
    if (!ok) {
      audit(db, { action: 'auth.login_failed', target: body.username.slice(0, 64), ip: req.ip });
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const token = newToken();
    const csrf = newToken();
    db.prepare('INSERT INTO auth_sessions (token_hash, user_id, csrf_token, created_at, expires_at, user_agent) VALUES (?,?,?,?,?,?)').run(
      sha256(token), user.id, csrf, Date.now(), Date.now() + SESSION_TTL_MS, String(req.headers['user-agent'] ?? '').slice(0, 200),
    );
    db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
    audit(db, { userId: user.id, action: 'auth.login', ip: req.ip });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: cfg.server.secureCookies, path: '/', maxAge: SESSION_TTL_MS / 1000 });
    return { ok: true, csrf };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HermesError) return reply.code(err.status >= 400 && err.status < 600 ? err.status : 502).send({ error: err.code ?? 'hermes_error', message: err.message });
    if (err?.issues) return reply.code(400).send({ error: 'validation', issues: err.issues });
    if (err?.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal' });
  });

  await registerApi(app, ctx);

  const webDist = deps.webDist ?? resolve('web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    mirror.stop();
    taskFeed.stop();
    runs.stopAll();
  });

  return { app, ctx };
}

// Constant-time-ish behaviour for unknown usernames (always run one scrypt).
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
