import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  markRead: (convId: number) => void;
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
  const [activeConv, setActiveConv] = useState<number | null>(null);

  const refresh = useCallback(() => {
    if (!ws) return;
    api<Conversation[]>(`/api/w/${ws.slug}/conversations`).then(setConversations).catch(() => {});
    api<Agent[]>(`/api/w/${ws.slug}/agents`).then(setAgents).catch(() => {});
    api<unknown[]>(`/api/w/${ws.slug}/approvals`).then((a) => setPending(a.length)).catch(() => {});
  }, [ws?.slug]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [refresh]);

  useServerEvents((e) => {
    if (e.type === 'reconnected') return refresh();
    if (!ws) return;
    if (e.type === 'approvals.changed') api<unknown[]>(`/api/w/${ws.slug}/approvals`).then((a) => setPending(a.length)).catch(() => {});
    if (e.type === 'message.upsert' && e.conversationId && e.conversationId !== activeConv) {
      const myWs = conversations.find((c) => c.id === e.conversationId);
      if (myWs) setUnread((u) => ({ ...u, [e.conversationId!]: true }));
    }
  });

  const value = useMemo<WsCtx | null>(() => ws ? ({
    me, ws, conversations, agents, pendingApprovals, unread, refresh,
    agentById: (id) => agents.find((a) => a.id === id),
    markRead: (id) => { setActiveConv(id); setUnread((u) => ({ ...u, [id]: false })); },
    canWrite: ws.role !== 'viewer',
  }) : null, [me, ws, conversations, agents, pendingApprovals, unread, refresh]);

  if (!value) return <div className="p-8 text-[var(--muted)]">You are not a member of any workspace. Ask an admin to add you.</div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type Theme = 'system' | 'light' | 'dark';
export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  try { localStorage.setItem('hc-theme', t); } catch { /* private mode */ }
}
export function getTheme(): Theme {
  try { return (localStorage.getItem('hc-theme') as Theme) || 'system'; } catch { return 'system'; }
}
