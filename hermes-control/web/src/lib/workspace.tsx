import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Agent, type Conversation, type Me } from './api';
import { useServerEvents } from './events';

interface WsCtx {
  me: Me;
  ws: Me['workspaces'][number];
  conversations: Conversation[];
  agents: Agent[];
  agentById: (id: number | null | undefined) => Agent | undefined;
  pendingApprovals: number;
  unread: Record<number, boolean>;
  markRead: (convId: number | null) => void;
  refresh: () => void;
  canWrite: boolean;
}

const Ctx = createContext<WsCtx | null>(null);
export const useWs = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWs outside provider');
  return c;
};

export function WorkspaceProvider({ me, slug, children }: { me: Me; slug: string; children: ReactNode }) {
  const ws = me.workspaces.find((w) => w.slug === slug) ?? me.workspaces[0];
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [pendingApprovals, setPending] = useState(0);
  const [unread, setUnread] = useState<Record<number, boolean>>({});
  const active = useRef<number | null>(null);
  const convTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConversations = useCallback(() => {
    if (ws) api<Conversation[]>(`/api/w/${ws.slug}/conversations`).then(setConversations).catch(() => {});
  }, [ws?.slug]);
  const loadApprovals = useCallback(() => {
    if (ws) api<unknown[]>(`/api/w/${ws.slug}/approvals`).then((a) => setPending(a.length)).catch(() => {});
  }, [ws?.slug]);
  const refresh = useCallback(() => {
    if (!ws) return;
    loadConversations();
    loadApprovals();
    api<Agent[]>(`/api/w/${ws.slug}/agents`).then(setAgents).catch(() => {});
  }, [ws?.slug, loadConversations, loadApprovals]);

  useEffect(() => { setUnread({}); refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [refresh]);

  useServerEvents((e) => {
    if (e.type === 'reconnected') return refresh();
    if (e.type === 'approvals.changed') return loadApprovals();
    if (e.type === 'message.upsert' && e.conversationId) {
      if (e.conversationId !== active.current && e.payload?.author_kind !== 'user') setUnread((u) => ({ ...u, [e.conversationId!]: true }));
      if (convTimer.current) clearTimeout(convTimer.current);
      convTimer.current = setTimeout(loadConversations, 400); // keep list previews fresh
    }
  });

  const value = useMemo<WsCtx | null>(() => ws ? ({
    me, ws, conversations, agents, pendingApprovals, unread, refresh,
    agentById: (id) => agents.find((a) => a.id === id),
    markRead: (id) => { active.current = id; if (id) setUnread((u) => ({ ...u, [id]: false })); },
    canWrite: ws.role !== 'viewer',
  }) : null, [me, ws, conversations, agents, pendingApprovals, unread, refresh]);

  if (!value) return <div className="p-8 text-[var(--label-2)]">You don’t have access to any workspace yet.</div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type Theme = 'system' | 'light' | 'dark';
export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f9f9f9');
  try { localStorage.setItem('hc-theme', t); } catch { /* private mode */ }
}
export function getTheme(): Theme {
  try { return (localStorage.getItem('hc-theme') as Theme) || 'system'; } catch { return 'system'; }
}

/** Display title for a conversation, in plain words. */
export function convTitle(c: Conversation, agentName: (id: number | null) => string | undefined) {
  if (c.kind === 'channel') return c.name.split('-').map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
  const n = agentName(c.dmAgentId) ?? c.name;
  return c.kind === 'telegram_mirror' && !c.twoWay ? `${n} on Telegram` : n;
}

/** The chat to open for an agent: its synced Telegram chat when two-way is on, else its app chat. */
export function chatFor(conversations: Conversation[], agentId: number | null | undefined) {
  if (!agentId) return undefined;
  return conversations.find((c) => c.kind === 'telegram_mirror' && c.twoWay && c.dmAgentId === agentId)
    ?? conversations.find((c) => c.kind === 'dm' && c.dmAgentId === agentId);
}
