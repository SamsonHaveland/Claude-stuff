import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { convTitle, useWs } from '../lib/workspace';
import { useConnectionStatus } from '../lib/events';
import type { Conversation } from '../lib/api';
import { Avatar, AvatarStack, IChat, IGear, IHand, IList, Sheet, timeLabel, Row, Section, ICheck } from './ui';

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

const TABS = [
  { to: '', label: 'Chats', Icon: IChat, end: true },
  { to: 'todos', label: 'To-Dos', Icon: IList },
  { to: 'needs-you', label: 'Needs You', Icon: IHand },
  { to: 'settings', label: 'Settings', Icon: IGear },
];

export function Shell({ children }: { children: ReactNode }) {
  const mobile = useIsMobile();
  const loc = useLocation();
  const fullScreen = /\/(c|agents)\/\d+/.test(loc.pathname);
  if (mobile) {
    return (
      <div className="flex h-full flex-col bg-[var(--bg)]">
        <div className="min-h-0 flex-1">{children}</div>
        {!fullScreen && <TabBar />}
      </div>
    );
  }
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 bg-[var(--bg)]">{children}</main>
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return n > 0 ? <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--red)] px-1 text-[11px] font-semibold text-white">{n}</span> : null;
}

function TabBar() {
  const { ws, pendingApprovals, unread, conversations } = useWs();
  const unreadCount = conversations.filter((c) => unread[c.id]).length; // only chats of this workspace
  return (
    <nav className="material-bar safe-bottom flex border-t-[0.5px] border-[var(--separator)]">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={label} end={end} to={`/w/${ws.slug}${to ? '/' + to : ''}`} className={({ isActive }) => `press relative flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10.5px] font-medium ${isActive ? 'text-[var(--blue)]' : 'text-[var(--label-2)]'}`}>
          <Icon size={26} />
          {label}
          <span className="absolute top-1 left-1/2 ml-2">{label === 'Needs You' ? <Badge n={pendingApprovals} /> : label === 'Chats' ? <Badge n={unreadCount} /> : null}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Sidebar() {
  const { ws, me, pendingApprovals } = useWs();
  const conn = useConnectionStatus();
  const [switcher, setSwitcher] = useState(false);
  return (
    <aside className="material-sidebar flex w-[340px] shrink-0 flex-col border-r-[0.5px] border-[var(--separator)]">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <button onClick={() => me.workspaces.length > 1 && setSwitcher(true)} className="press flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-1 text-left">
          <span className="t-headline truncate">{ws.name}</span>
          {me.workspaces.length > 1 && <span className="text-[var(--label-2)]">⌄</span>}
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--label-2)]" title={conn === 'open' ? 'Live updates on' : 'Reconnecting…'}>
          <span className="h-2 w-2 rounded-full" style={{ background: conn === 'open' ? 'var(--green)' : 'var(--orange)' }} />
          {conn === 'open' ? 'Live' : 'Connecting…'}
        </span>
      </div>
      <nav className="grid grid-cols-4 gap-1 px-3 pb-3">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink key={label} end={end} to={`/w/${ws.slug}${to ? '/' + to : ''}`} className={({ isActive }) => `press relative flex flex-col items-center gap-1 rounded-[12px] py-2 text-[11.5px] font-medium ${isActive ? 'bg-[var(--cell)] text-[var(--blue)] shadow-sm' : 'text-[var(--label-2)] hover:bg-[var(--fill)]'}`}>
            <Icon size={22} />
            {label}
            {label === 'Needs You' && pendingApprovals > 0 && <span className="absolute top-1 right-2"><Badge n={pendingApprovals} /></span>}
          </NavLink>
        ))}
      </nav>
      <div className="scroll min-h-0 flex-1 px-2 pb-3"><ChatList compact /></div>
      {switcher && <WorkspaceSwitcher onClose={() => setSwitcher(false)} />}
    </aside>
  );
}

export function WorkspaceSwitcher({ onClose }: { onClose: () => void }) {
  const { me, ws } = useWs();
  const nav = useNavigate();
  return (
    <Sheet title="Switch Workspace" onClose={onClose}>
      <Section footer="Each workspace keeps its own chats, files and to-dos separate.">
        {me.workspaces.map((w) => (
          <Row key={w.slug} onClick={() => { onClose(); nav(`/w/${w.slug}`); }}>
            <span className="flex-1">{w.name}</span>
            {w.slug === ws.slug && <ICheck size={20} className="text-[var(--blue)]" />}
          </Row>
        ))}
      </Section>
    </Sheet>
  );
}

/** The Messages-style list of conversations. */
export function ChatList({ compact = false }: { compact?: boolean }) {
  const { ws, conversations, agentById, unread, pendingApprovals } = useWs();
  const loc = useLocation();
  const [q, setQ] = useState('');
  const name = (id: number | null) => agentById(id)?.displayName;
  const rows = useMemo(() => {
    const list = conversations.filter((c) => c.kind !== 'dm' || agentById(c.dmAgentId));
    const filtered = q ? list.filter((c) => convTitle(c, name).toLowerCase().includes(q.toLowerCase())) : list;
    return [...filtered].sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0) || (a.kind === 'channel' ? -1 : 1) - (b.kind === 'channel' ? -1 : 1) || convTitle(a, name).localeCompare(convTitle(b, name)));
  }, [conversations, q, agentById]);

  return (
    <div>
      <div className={compact ? 'px-2 pb-2' : 'px-4 pb-2 md:px-8'}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search chats" className="h-9 w-full rounded-[10px] bg-[var(--fill)] px-3 text-[16px] outline-none placeholder:text-[var(--label-2)]" />
      </div>
      {pendingApprovals > 0 && (
        <NavLink to={`/w/${ws.slug}/needs-you`} className={`press mb-2 flex items-center gap-3 rounded-[14px] bg-[color-mix(in_srgb,var(--orange)_16%,transparent)] px-4 py-3 ${compact ? 'mx-2' : 'mx-4 md:mx-8'}`}>
          <IHand size={24} className="text-[var(--orange)]" />
          <span className="t-sub flex-1 font-semibold">{pendingApprovals === 1 ? '1 thing needs your OK' : `${pendingApprovals} things need your OK`}</span>
          <span className="text-[var(--label-3)]">›</span>
        </NavLink>
      )}
      <ul className={compact ? '' : 'md:px-4'}>
        {rows.map((c) => <ChatRow key={c.id} c={c} active={loc.pathname.endsWith(`/c/${c.id}`)} unread={!!unread[c.id]} compact={compact} />)}
      </ul>
      {!rows.length && <p className="t-sub px-6 py-10 text-center text-[var(--label-2)]">{q ? 'No matches.' : 'No chats yet.'}</p>}
    </div>
  );
}

function preview(c: Conversation) {
  if (!c.last) return c.kind === 'channel' ? `${c.agentIds.length} agents` : c.kind === 'telegram_mirror' ? (c.twoWay ? 'Synced with Telegram' : 'Copy of your Telegram chat') : 'Say hello';
  if (c.last.state === 'pending' || c.last.state === 'streaming') return 'Typing…';
  if (c.last.state === 'failed') return 'Didn’t get a reply';
  return (c.last.authorKind === 'user' ? 'You: ' : '') + plainText(c.last.body);
}

function ChatRow({ c, active, unread, compact }: { c: Conversation; active: boolean; unread: boolean; compact: boolean }) {
  const { ws, agentById } = useWs();
  const nav = useNavigate();
  const a = agentById(c.dmAgentId);
  const title = convTitle(c, (id) => agentById(id)?.displayName);
  const people = c.agentIds.map((id) => agentById(id)).filter(Boolean).map((x) => ({ name: x!.displayName, url: x!.avatarUrl }));
  const size = compact ? 46 : 54;
  return (
    <li>
      <button onClick={() => nav(`/w/${ws.slug}/c/${c.id}`)} className={`press flex w-full items-center gap-3 rounded-[12px] px-2 text-left ${active ? 'bg-[var(--blue)] text-white' : 'hover:bg-[var(--fill)]'}`}>
        <span className="flex w-2.5 justify-center">{unread && !active && <span className="h-2.5 w-2.5 rounded-full bg-[var(--blue)]" />}</span>
        <span className="py-2">{c.kind === 'channel' ? <AvatarStack people={people} size={size} /> : <Avatar name={a?.displayName ?? title} url={a?.avatarUrl} size={size} status={c.kind === 'dm' ? a?.status : undefined} />}</span>
        <span className={`flex min-w-0 flex-1 flex-col self-stretch justify-center py-2.5 pr-2 ${active ? '' : 'hairline'}`}>
          <span className="flex items-baseline gap-2">
            <span className={`t-headline truncate ${unread && !active ? 'font-bold' : ''}`}>{title}</span>
            <span className={`t-foot ml-auto shrink-0 ${active ? 'text-white/80' : 'text-[var(--label-2)]'}`}>{c.last ? timeLabel(c.last.at) : ''}</span>
          </span>
          <span className={`t-sub line-clamp-2 ${active ? 'text-white/85' : 'text-[var(--label-2)]'}`}>{preview(c)}</span>
        </span>
      </button>
    </li>
  );
}

/** Markdown -> plain one-line preview, like Messages shows. */
export function plainText(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/MEDIA:\S+/g, '[image]')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}
