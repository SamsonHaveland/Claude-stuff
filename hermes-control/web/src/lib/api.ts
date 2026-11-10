export interface Me {
  user: { id: number; username: string; displayName: string; role: 'admin' | 'member' };
  csrf: string;
  workspaces: { slug: string; name: string; role: 'owner' | 'member' | 'viewer' }[];
  hermesMode: 'live' | 'disabled';
}
export interface Conversation {
  id: number;
  kind: 'channel' | 'dm' | 'telegram_mirror';
  name: string;
  topic: string | null;
  dmAgentId: number | null;
  defaultAgentId: number | null;
  agentIds: number[];
  readOnly: boolean;
  /** Long one-to-one chat: slower and costlier, so the app offers a fresh start. */
  long?: boolean;
  /** Telegram copy that also sends what you type here to Telegram. */
  twoWay?: boolean;
  lastMessageId: number | null;
  last: { body: string; at: number; authorKind: string; state: string } | null;
}
export type AgentStatus = 'online' | 'working' | 'unreachable' | 'not_configured' | 'not_found' | 'integration_disabled';
export interface Agent {
  id: number;
  profileName: string;
  displayName: string;
  role: string | null;
  description: string | null;
  avatarUrl: string | null;
  discovered: boolean;
  status: AgentStatus;
  activeRuns: number;
}
export interface Attachment { id: number; filename: string; mime: string; size: number }
export interface Message {
  id: number;
  conversation_id: number;
  workspace_id: number;
  parent_id: number | null;
  author_kind: 'user' | 'agent' | 'system' | 'external';
  author_user_id: number | null;
  author_agent_id: number | null;
  author_label: string | null;
  body: string;
  state: 'pending' | 'streaming' | 'final' | 'failed' | 'cancelled';
  error: string | null;
  source: 'hc' | 'hermes_run' | 'telegram_mirror';
  origin_ts: number | null;
  created_at: number;
  attachments?: Attachment[];
  replyCount?: number;
}
export interface Approval {
  id: number;
  status: 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'expired' | 'error';
  command: string | null;
  description: string | null;
  choices: string[];
  decision: string | null;
  decided_at: number | null;
  created_at: number;
  agent: string;
  agentId: number;
  conversationId: number;
  conversation: string;
  kind: string;
  requestText: string | null;
  hermes_response: unknown;
}
export interface Task {
  id: string;
  title: string;
  body?: string | null;
  assignee?: string | null;
  status: string;
  priority?: number | null;
  created_at?: number | null;
  started_at?: number | null;
  completed_at?: number | null;
  result?: string | null;
  last_failure_error?: string | null;
}

let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrf);
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin', body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const ts = (m: Pick<Message, 'origin_ts' | 'created_at'>) => m.origin_ts ?? m.created_at;
