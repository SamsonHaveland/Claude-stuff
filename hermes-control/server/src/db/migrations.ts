/**
 * Hermes Control's OWN database. It never stores Hermes credentials and is never
 * the source of truth for Hermes state (sessions, Kanban, approvals) — those are
 * read through Hermes' supported interfaces. Rows here are UI state, routing
 * bindings, mirrored copies (keyed by Hermes ids for idempotency) and audit.
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  created_at INTEGER NOT NULL
);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','member','viewer')),
  PRIMARY KEY (workspace_id, user_id)
);
-- Agents: profile_name is the EXECUTION identity (a Hermes profile id).
-- display_name / avatar are presentation only and never used for routing.
CREATE TABLE agents (
  id INTEGER PRIMARY KEY,
  profile_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT,
  description TEXT,
  avatar_file TEXT,
  discovered INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE workspace_agents (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, agent_id)
);
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('channel','dm','telegram_mirror')),
  name TEXT NOT NULL,
  topic TEXT,
  dm_agent_id INTEGER REFERENCES agents(id),
  default_agent_id INTEGER REFERENCES agents(id),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, kind, name)
);
CREATE TABLE conversation_agents (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, agent_id)
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  parent_id INTEGER REFERENCES messages(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('user','agent','system','external')),
  author_user_id INTEGER REFERENCES users(id),
  author_agent_id INTEGER REFERENCES agents(id),
  author_label TEXT,
  body TEXT NOT NULL,
  -- delivery state for agent replies; 'final' only once Hermes reported a terminal event
  state TEXT NOT NULL DEFAULT 'final' CHECK (state IN ('pending','streaming','final','failed','cancelled')),
  error TEXT,
  -- provenance: 'hc' (typed here), 'hermes_run' (reply from a Hermes run), 'telegram_mirror'
  source TEXT NOT NULL DEFAULT 'hc',
  external_id TEXT,
  origin_ts INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX messages_external ON messages(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX messages_conv ON messages(conversation_id, id);
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  uploader_user_id INTEGER REFERENCES users(id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
-- One API-owned Hermes session per (conversation, agent): keeps workspace contexts apart.
CREATE TABLE hermes_bindings (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  hermes_session_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, agent_id)
);
-- Persisted run state so restarts/reconnects resume via Last-Event-ID.
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  agent_id INTEGER NOT NULL REFERENCES agents(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  request_message_id INTEGER NOT NULL REFERENCES messages(id),
  reply_message_id INTEGER REFERENCES messages(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  hermes_run_id TEXT UNIQUE,
  hermes_session_id TEXT,
  status TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT -1,
  last_event TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX runs_open ON runs(status);
CREATE TABLE run_events (
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);
-- Approvals mirror Hermes' approval.request events. status never claims 'approved':
-- 'submitted' = we sent a decision, 'confirmed' = Hermes acknowledged it.
CREATE TABLE approvals (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  agent_id INTEGER NOT NULL REFERENCES agents(id),
  request_id TEXT,
  execution_generation INTEGER,
  command TEXT,
  description TEXT,
  choices TEXT NOT NULL,
  raw TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','submitted','confirmed','rejected','expired','error')),
  decision TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at INTEGER,
  hermes_response TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (run_id, request_id)
);
CREATE TABLE mirror_cursors (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  workspace_id INTEGER REFERENCES workspaces(id),
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX audit_ts ON audit_log(ts);
`,
  },
  {
    version: 2,
    sql: `
-- Small switches changed from Settings (e.g. telegram.twoWay.<profile> = on|off).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
  },
];
