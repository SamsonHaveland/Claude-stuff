import type { DB } from '../db/index.js';

export function audit(
  db: DB,
  e: { userId?: number | null; workspaceId?: number | null; action: string; target?: string; detail?: unknown; ip?: string },
) {
  db.prepare('INSERT INTO audit_log (ts, user_id, workspace_id, action, target, detail, ip) VALUES (?,?,?,?,?,?,?)').run(
    Date.now(), e.userId ?? null, e.workspaceId ?? null, e.action, e.target ?? null,
    e.detail === undefined ? null : JSON.stringify(e.detail), e.ip ?? null,
  );
}
