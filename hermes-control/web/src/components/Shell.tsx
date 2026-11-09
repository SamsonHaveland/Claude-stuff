import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useWs } from '../lib/workspace';
import { useConnectionStatus } from '../lib/events';
import { Avatar } from './Avatar';
import { IconChat, IconHash, IconLogout, IconPulse, IconSettings, IconShield, IconTasks, IconTelegram, IconUsers } from './icons';

export function useIsMobile() {
  const q = '(max-width: 767px)';
  const [m, set] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => set(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}

export function Shell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const mobile = useIsMobile();
  const loc = useLocation();
  const inConversation = /\/c\/\d+/.test(loc.pathname);
  if (mobile) {
    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">{children}</div>
        {!inConversation && <MobileTabs />}
      </div>
    );
  }
  return (
    <div className="flex h-full">
      <Sidebar onLogout={onLogout} />
      <main className="flex min-w-0 flex-1">{children}</main>
    </div>
  );
}

export function Sidebar({ onLogout, mobile = false }: { onLogout?: () => void; mobile?: boolean }) {
  const { me, ws, conversations, agentById, unread, pendingApprovals } = useWs();
  const nav = useNavigate();
  const conn = useConnectionStatus();
  const channels = conversations.filter((c) => c.kind === 'channel');
  const dms = conversations.filter((c) => c.kind === 'dm');
  const mirrors = conversations.filter((c) => c.kind === 'telegram_mirror');
  const base = `/w/${ws.slug}`;
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-2.5 ${mobile ? 'py-2.5 text-[15px]' : 'py-1.5 text-sm'} transition-colors ${isActive ? 'bg-[var(--sidebar-active)] text-white' : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)]'}`;

  return (
    <aside className={`${mobile ? 'w-full' : 'w-64 shrink-0'} flex h-full flex-col bg-[var(--sidebar)] text-[var(--sidebar-text)] safe-top`}>
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-3">
        <select
          aria-label="Workspace"
          value={ws.slug}
          onChange={(e) => nav(`/w/${e.target.value}`)}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-1 text-[15px] font-semibold text-white outline-none hover:bg-[var(--sidebar-hover)]"
        >
          {me.workspaces.map((w) => <option key={w.slug} value={w.slug} className="text-black">{w.name}</option>)}
        </select>
        <span title={`Live updates: ${conn}`} className={`h-2 w-2 rounded-full ${conn === 'open' ? 'bg-emerald-400' : conn === 'connecting' ? 'bg-amber-400' : 'bg-rose-500'}`} />
      </div>
      {me.hermesMode !== 'live' && (
        <div className="mx-3 mt-3 rounded-md bg-amber-500/15 px-2.5 py-2 text-xs text-amber-200">Hermes integration is disabled. Messages are stored but not delivered to agents.</div>
      )}
      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-2 py-3">
        {!mobile && (
          <div className="space-y-0.5">
            <NavLink to={`${base}/agents`} className={item}><IconUsers className="h-4 w-4" />Agents</NavLink>
            <NavLink to={`${base}/tasks`} className={item}><IconTasks className="h-4 w-4" />Tasks</NavLink>
            <NavLink to={`${base}/approvals`} className={item}>
              <IconShield className="h-4 w-4" />Approvals
              {pendingApprovals > 0 && <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">{pendingApprovals}</span>}
            </NavLink>
            <NavLink to={`${base}/activity`} className={item}><IconPulse className="h-4 w-4" />Activity</NavLink>
          </div>
        )}
        <Section title="Channels">
          {channels.map((c) => (
            <NavLink key={c.id} to={`${base}/c/${c.id}`} className={item}>
              <IconHash className="h-4 w-4 opacity-70" />
              <span className={`truncate ${unread[c.id] ? 'font-semibold text-white' : ''}`}>{c.name}</span>
            </NavLink>
          ))}
          {!channels.length && <Empty>No channels configured</Empty>}
        </Section>
        <Section title="Direct messages">
          {dms.map((c) => {
            const a = agentById(c.dmAgentId);
            return (
              <NavLink key={c.id} to={`${base}/c/${c.id}`} className={item}>
                <Avatar name={a?.displayName ?? c.name} url={a?.avatarUrl} size={mobile ? 28 : 22} status={a?.status} />
                <span className={`truncate ${unread[c.id] ? 'font-semibold text-white' : ''}`}>{a?.displayName ?? c.name}</span>
                {a?.role && !mobile && <span className="ml-auto truncate text-[11px] text-[var(--sidebar-muted)]">{a.role}</span>}
              </NavLink>
            );
          })}
          {!dms.length && <Empty>No agents allowed in this workspace</Empty>}
        </Section>
        {mirrors.length > 0 && (
          <Section title="Telegram (read-only)">
            {mirrors.map((c) => {
              const a = agentById(c.dmAgentId);
              return (
                <NavLink key={c.id} to={`${base}/c/${c.id}`} className={item}>
                  <IconTelegram className="h-4 w-4 opacity-80" />
                  <span className={`truncate ${unread[c.id] ? 'font-semibold text-white' : ''}`}>{a?.displayName ?? c.name} · Telegram</span>
                </NavLink>
              );
            })}
          </Section>
        )}
      </nav>
      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-2.5">
        <Avatar name={me.user.displayName} size={28} />
        <div className="min-w-0 flex-1 truncate text-sm">{me.user.displayName}</div>
        <NavLink to={`${base}/settings`} aria-label="Settings" className="rounded p-1.5 hover:bg-[var(--sidebar-hover)]"><IconSettings className="h-4 w-4" /></NavLink>
        {onLogout && <button aria-label="Sign out" onClick={onLogout} className="rounded p-1.5 hover:bg-[var(--sidebar-hover)]"><IconLogout className="h-4 w-4" /></button>}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-[var(--sidebar-muted)] uppercase">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
const Empty = ({ children }: { children: ReactNode }) => <div className="px-2.5 py-1 text-xs text-[var(--sidebar-muted)]">{children}</div>;

function MobileTabs() {
  const { ws, pendingApprovals } = useWs();
  const base = `/w/${ws.slug}`;
  const tab = ({ isActive }: { isActive: boolean }) => `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--muted)]'}`;
  return (
    <nav className="safe-bottom flex border-t border-[var(--border)] bg-[var(--panel)]">
      <NavLink end to={base} className={tab}><IconChat />Chats</NavLink>
      <NavLink to={`${base}/agents`} className={tab}><IconUsers />Agents</NavLink>
      <NavLink to={`${base}/tasks`} className={tab}><IconTasks />Tasks</NavLink>
      <NavLink to={`${base}/approvals`} className={tab}>
        <IconShield />Approvals
        {pendingApprovals > 0 && <span className="absolute top-1 right-[28%] rounded-full bg-rose-500 px-1 text-[10px] text-white">{pendingApprovals}</span>}
      </NavLink>
      <NavLink to={`${base}/settings`} className={tab}><IconSettings />More</NavLink>
    </nav>
  );
}

/** Standard page header used by non-conversation pages. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="safe-top flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-3 md:px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}
