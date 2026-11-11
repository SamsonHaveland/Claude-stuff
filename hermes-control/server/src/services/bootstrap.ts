import type { Config } from '../config.js';
import { tx, type DB } from '../db/index.js';
import type { DiscoveredProfile } from '../hermes/discovery.js';

const titleCase = (s: string) => s.replace(/(^|[-_])([a-z])/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase());

/**
 * Reconciles Hermes Control's own tables with config + discovered profiles.
 * - Agents: discovered profiles are upserted (discovered=1); config-declared profiles that
 *   were not found stay listed with discovered=0 so the UI can show "not found in Hermes".
 *   Display name / role / avatar edits made in the app are never overwritten.
 * - Workspaces, channels and DMs are created if missing; nothing is deleted automatically.
 */
export function bootstrap(db: DB, cfg: Config, discovered: DiscoveredProfile[]) {
  const now = Date.now();
  tx(db, () => {
    db.prepare('UPDATE agents SET discovered = 0').run();
    const upsertAgent = db.prepare(
      `INSERT INTO agents (profile_name, display_name, role, description, discovered, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_name) DO UPDATE SET
         discovered = excluded.discovered,
         last_seen_at = COALESCE(excluded.last_seen_at, agents.last_seen_at),
         description = COALESCE(agents.description, excluded.description)`,
    );
    for (const p of discovered) {
      const o = cfg.hermes.profiles[p.id] ?? {};
      upsertAgent.run(p.id, o.displayName ?? p.displayName ?? titleCase(p.id), o.role ?? null, p.description ?? p.soulExcerpt ?? null, 1, now, now);
    }
    for (const [id, o] of Object.entries(cfg.hermes.profiles)) {
      if (discovered.some((d) => d.id === id)) continue;
      upsertAgent.run(id, o.displayName ?? titleCase(id), o.role ?? null, null, 0, null, now);
    }
    const allAgents = db.prepare('SELECT id, profile_name FROM agents').all() as { id: number; profile_name: string }[];
    const agentId = (p: string) => allAgents.find((a) => a.profile_name === p)?.id;

    for (const w of cfg.workspaces) {
      db.prepare('INSERT OR IGNORE INTO workspaces (slug, name, created_at) VALUES (?,?,?)').run(w.slug, w.name, now);
      db.prepare('UPDATE workspaces SET name = ? WHERE slug = ?').run(w.name, w.slug);
      const ws = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(w.slug) as { id: number };
      // Workspace agent allowlist is authoritative from config (fail closed: empty = none).
      db.prepare('DELETE FROM workspace_agents WHERE workspace_id = ?').run(ws.id);
      const hidden = new Set(cfg.hermes.hiddenProfiles);
      const allowed = (w.agents.includes('*') ? allAgents.map((a) => a.profile_name) : w.agents).filter((p) => !hidden.has(p));
      for (const p of allowed) {
        const id = agentId(p);
        if (id) db.prepare('INSERT OR IGNORE INTO workspace_agents (workspace_id, agent_id) VALUES (?,?)').run(ws.id, id);
      }
      for (const c of w.channels) {
        db.prepare(`INSERT OR IGNORE INTO conversations (workspace_id, kind, name, topic, created_at) VALUES (?, 'channel', ?, ?, ?)`).run(ws.id, c.name, c.topic ?? null, now);
        const conv = db.prepare(`SELECT id FROM conversations WHERE workspace_id = ? AND kind = 'channel' AND name = ?`).get(ws.id, c.name) as { id: number };
        db.prepare('UPDATE conversations SET topic = ?, default_agent_id = ? WHERE id = ?').run(c.topic ?? null, c.defaultAgent && allowed.includes(c.defaultAgent) ? agentId(c.defaultAgent) ?? null : null, conv.id);
        db.prepare('DELETE FROM conversation_agents WHERE conversation_id = ?').run(conv.id);
        const members = c.agents.includes('*') ? allowed : c.agents.filter((p) => allowed.includes(p));
        for (const p of members) {
          const id = agentId(p);
          if (id) db.prepare('INSERT OR IGNORE INTO conversation_agents (conversation_id, agent_id) VALUES (?,?)').run(conv.id, id);
        }
      }
      for (const p of allowed) {
        const id = agentId(p);
        if (!id) continue;
        db.prepare(`INSERT OR IGNORE INTO conversations (workspace_id, kind, name, dm_agent_id, created_at) VALUES (?, 'dm', ?, ?, ?)`).run(ws.id, `dm-${p}`, id, now);
        const conv = db.prepare(`SELECT id FROM conversations WHERE workspace_id = ? AND kind = 'dm' AND name = ?`).get(ws.id, `dm-${p}`) as { id: number };
        db.prepare('INSERT OR IGNORE INTO conversation_agents (conversation_id, agent_id) VALUES (?,?)').run(conv.id, id);
      }
    }
  });
}
