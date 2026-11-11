/**
 * Create or reset a Hermes Control user and grant workspace membership.
 *   npm run user:create -- <username> "<Display Name>" <admin|member> <ws:role,ws:role|*:owner>
 * The password is read from HC_NEW_PASSWORD or prompted on the TTY (never a CLI argument,
 * so it does not land in shell history).
 */
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config.js';
import { openDb } from '../db/index.js';
import { hashPassword } from '../lib/auth.js';
import { bootstrap } from '../services/bootstrap.js';
import { discoverProfiles } from '../hermes/discovery.js';

const [username, displayName, role = 'member', grants = ''] = process.argv.slice(2);
if (!username || !displayName || !['admin', 'member'].includes(role)) {
  console.error('usage: user:create <username> "<Display Name>" <admin|member> <ws:role,...|*:owner>');
  process.exit(2);
}
let password = process.env.HC_NEW_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Password (min 12 chars): ');
  rl.close();
}
const cfg = loadConfig();
const db = openDb(join(cfg.dataDir, 'hermes-control.db'));
bootstrap(db, cfg, discoverProfiles(cfg.hermes.home));
const hash = hashPassword(password);
db.prepare(
  `INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)
   ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name, password_hash = excluded.password_hash, role = excluded.role`,
).run(username.toLowerCase(), displayName, hash, role, Date.now());
const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase()) as { id: number };
db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
const workspaces = db.prepare('SELECT id, slug FROM workspaces').all() as { id: number; slug: string }[];
for (const g of grants.split(',').filter(Boolean)) {
  const [slug, wsRole = 'member'] = g.split(':');
  if (!['owner', 'member', 'viewer'].includes(wsRole)) throw new Error(`bad role ${wsRole}`);
  for (const w of workspaces.filter((w) => slug === '*' || w.slug === slug)) {
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?) ON CONFLICT DO UPDATE SET role = excluded.role').run(w.id, user.id, wsRole);
  }
}
console.log(`User ${username} saved (${role}); memberships:`, db.prepare('SELECT w.slug, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?').all(user.id));
db.close();
