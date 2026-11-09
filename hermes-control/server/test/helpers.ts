import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, type Config } from '../src/config.js';
import { openDb, type DB } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { hashPassword } from '../src/lib/auth.js';
import { HermesClient } from '../src/hermes/client.js';
import { KanbanAdapter, type Runner } from '../src/hermes/kanban.js';

export const PASSWORD = 'correct horse battery staple';

export function testConfig(hermesUrl = 'http://127.0.0.1:9', extra: Record<string, unknown> = {}): Config {
  const cfg = parseConfig({
    dataDir: mkdtempSync(join(tmpdir(), 'hc-test-')),
    hermes: {
      mode: 'live', baseUrl: hermesUrl, multiplex: true, requestTimeoutMs: 3000,
      profiles: { jeff: { role: 'Chief of Staff' }, debra: { role: 'Production Accounting' }, roxy: { role: 'Creative Director' }, harry: {} },
    },
    workspaces: [
      { slug: 'film-lv', name: 'FilmLV', agents: ['jeff', 'debra', 'roxy'], channels: [{ name: 'production', agents: ['*'] }, { name: 'general', agents: ['*'], defaultAgent: 'jeff' }] },
      { slug: 'atomic-fox', name: 'Atomic Fox', agents: ['jeff', 'harry'], channels: [{ name: 'research', agents: ['*'] }] },
    ],
    telegramMirror: [{ profile: 'jeff', enabled: true, pollSeconds: 60, workspace: 'film-lv' }],
    ...extra,
  });
  return cfg;
}

export async function makeApp(opts: { hermesUrl?: string; key?: string; kanbanRunner?: Runner; cfg?: Config } = {}) {
  const cfg = opts.cfg ?? testConfig(opts.hermesUrl);
  const db = openDb(':memory:');
  bootstrap(db, cfg, []); // profiles come from config (discovered=0) in tests
  db.prepare('UPDATE agents SET discovered = 1').run();
  const env = { HC_HERMES_KEY_JEFF: opts.key ?? 'k', HC_HERMES_KEY_DEBRA: opts.key ?? 'k', HC_HERMES_KEY_ROXY: opts.key ?? 'k', HC_HERMES_KEY_HARRY: opts.key ?? 'k' };
  const hermes = new HermesClient(cfg, env);
  const kanban = new KanbanAdapter(cfg, opts.kanbanRunner ?? (async () => '[]'));
  const { app, ctx } = await buildApp({ cfg, db, hermes, kanban, webDist: '/nonexistent' });
  addUser(db, 'sam', 'admin', [['film-lv', 'owner'], ['atomic-fox', 'owner']]);
  addUser(db, 'fox', 'member', [['atomic-fox', 'member']]);
  return { app, ctx, db, cfg };
}

export function addUser(db: DB, username: string, role: 'admin' | 'member', grants: [string, string][]) {
  db.prepare('INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(username, username.toUpperCase(), hashPassword(PASSWORD), role, Date.now());
  const uid = (db.prepare('SELECT id FROM users WHERE username = ?').get(username) as any).id;
  for (const [slug, r] of grants) {
    const ws = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(slug) as any;
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws.id, uid, r);
  }
}

export async function login(app: Awaited<ReturnType<typeof makeApp>>['app'], username: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'hc_session')!;
  const csrf = res.json().csrf as string;
  const headers = { cookie: `hc_session=${cookie.value}`, 'x-csrf-token': csrf };
  return { headers, csrf };
}

export function convId(db: DB, ws: string, kind: string, name: string): number {
  return (db.prepare('SELECT c.id FROM conversations c JOIN workspaces w ON w.id = c.workspace_id WHERE w.slug = ? AND c.kind = ? AND c.name = ?').get(ws, kind, name) as any).id;
}

export async function waitFor<T>(fn: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
