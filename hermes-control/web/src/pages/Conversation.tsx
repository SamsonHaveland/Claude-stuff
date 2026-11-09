import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ts, type Agent, type Attachment, type Conversation, type Message, type Task } from '../lib/api';
import { useServerEvents } from '../lib/events';
import { useWs } from '../lib/workspace';
import { Avatar, STATUS_META } from '../components/Avatar';
import { useIsMobile } from '../components/Shell';
import { IconBack, IconClip, IconHash, IconInfo, IconRetry, IconSend, IconStop, IconTelegram, IconThread, IconX } from '../components/icons';

type Msg = Message & { run_id?: number | null; run_status?: string | null };

export function ConversationPage() {
  const { convId } = useParams();
  const id = Number(convId);
  const { ws, conversations, agentById, markRead } = useWs();
  const conv = conversations.find((c) => c.id === id);
  const mobile = useIsMobile();
  const nav = useNavigate();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [thread, setThread] = useState<Msg | null>(null);
  const [showInfo, setShowInfo] = useState(!mobile);

  const load = useCallback(() => {
    api<Msg[]>(`/api/w/${ws.slug}/conversations/${id}/messages`).then((m) => { setMessages(m); setLoaded(true); }).catch(() => setLoaded(true));
  }, [ws.slug, id]);
  useEffect(() => { setMessages([]); setLoaded(false); setThread(null); load(); markRead(id); }, [load, id]);

  useServerEvents((e) => {
    if (e.type === 'reconnected') return load();
    if (e.type !== 'message.upsert' || e.conversationId !== id) return;
    const m = e.payload as Msg;
    setMessages((list) => {
      const i = list.findIndex((x) => x.id === m.id);
      if (m.parent_id) return list.map((x) => (x.id === m.parent_id && i < 0 ? { ...x, replyCount: (x.replyCount ?? 0) + 1 } : x));
      if (i >= 0) { const copy = list.slice(); copy[i] = { ...list[i], ...m }; return copy; }
      return [...list, m];
    });
  });

  if (!conv) return <div className="flex flex-1 items-center justify-center text-[var(--muted)]">Conversation not found.</div>;
  const dmAgent = agentById(conv.dmAgentId);
  const title = conv.kind === 'channel' ? conv.name : `${dmAgent?.displayName ?? conv.name}${conv.kind === 'telegram_mirror' ? ' · Telegram' : ''}`;

  return (
    <div className="flex h-full min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 md:px-5">
          {mobile && <button aria-label="Back" onClick={() => nav(`/w/${ws.slug}`)} className="-ml-1 rounded p-1.5 hover:bg-[var(--hover)]"><IconBack /></button>}
          {conv.kind === 'channel' ? <IconHash className="h-5 w-5 text-[var(--muted)]" /> : conv.kind === 'telegram_mirror' ? <IconTelegram className="h-5 w-5 text-sky-500" /> : <Avatar name={dmAgent?.displayName ?? '?'} url={dmAgent?.avatarUrl} size={28} status={dmAgent?.status} />}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold">{title}</h1>
            <p className="truncate text-xs text-[var(--muted)]">
              {conv.kind === 'telegram_mirror' ? 'Read-only mirror via the Hermes API · replies happen in Telegram' : conv.kind === 'dm' ? `${dmAgent?.role ?? 'Agent'} · ${dmAgent ? STATUS_META[dmAgent.status].label : ''}` : conv.topic ?? `${conv.agentIds.length} agents`}
            </p>
          </div>
          {conv.kind === 'channel' && !mobile && (
            <div className="flex -space-x-2">{conv.agentIds.slice(0, 5).map((aid) => { const a = agentById(aid); return a ? <Avatar key={aid} name={a.displayName} url={a.avatarUrl} size={26} ring /> : null; })}</div>
          )}
          <button aria-label="Details" onClick={() => setShowInfo((s) => !s)} className={`rounded p-1.5 hover:bg-[var(--hover)] ${showInfo ? 'text-[var(--color-accent)]' : 'text-[var(--muted)]'}`}><IconInfo /></button>
        </header>
        <MessageList messages={messages} loaded={loaded} conv={conv} onThread={setThread} />
        {conv.readOnly ? (
          <div className="safe-bottom border-t border-[var(--border)] px-4 py-3 text-center text-sm text-[var(--muted)]">
            This is a read-only mirror of the Telegram chat. To talk to {dmAgent?.displayName ?? 'this agent'} here, use the{' '}
            <DmLink agentId={conv.dmAgentId} /> (separate Hermes session).
          </div>
        ) : (
          <Composer conv={conv} onSent={() => {}} />
        )}
      </section>
      {thread && <ThreadPanel parent={thread} conv={conv} onClose={() => setThread(null)} mobile={mobile} />}
      {!thread && showInfo && <InfoPanel conv={conv} messages={messages} onClose={() => setShowInfo(false)} mobile={mobile} />}
    </div>
  );
}

function DmLink({ agentId }: { agentId: number | null }) {
  const { ws, conversations } = useWs();
  const dm = conversations.find((c) => c.kind === 'dm' && c.dmAgentId === agentId);
  return dm ? <Link className="text-[var(--color-accent)] underline" to={`/w/${ws.slug}/c/${dm.id}`}>direct message</Link> : <span>direct message</span>;
}

function dayLabel(t: number) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function MessageList({ messages, loaded, conv, onThread }: { messages: Msg[]; loaded: boolean; conv: Conversation; onThread: (m: Msg) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages]);
  const onScroll = () => { const el = ref.current!; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const rows = useMemo(() => {
    const out: ({ kind: 'day'; label: string; key: string } | { kind: 'msg'; m: Msg; grouped: boolean; key: string })[] = [];
    let lastDay = '';
    let prev: Msg | null = null;
    for (const m of messages) {
      const day = new Date(ts(m)).toDateString();
      if (day !== lastDay) { out.push({ kind: 'day', label: dayLabel(ts(m)), key: 'd' + day }); lastDay = day; prev = null; }
      const grouped = !!prev && prev.author_kind === m.author_kind && prev.author_user_id === m.author_user_id && prev.author_agent_id === m.author_agent_id && ts(m) - ts(prev) < 5 * 60_000 && m.state === 'final' && prev.state === 'final';
      out.push({ kind: 'msg', m, grouped, key: 'm' + m.id });
      prev = m;
    }
    return out;
  }, [messages]);

  return (
    <div ref={ref} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-3 md:px-4">
      {loaded && !messages.length && (
        <div className="mx-auto mt-16 max-w-sm text-center text-sm text-[var(--muted)]">
          {conv.kind === 'telegram_mirror' ? 'No Telegram messages mirrored yet. The mirror polls Hermes when it is enabled.' : conv.kind === 'dm' ? 'Start the conversation. Messages go to this agent\'s Hermes profile and its real reply appears here.' : 'No messages yet. Address an agent with @name, or start with "Name, …".'}
        </div>
      )}
      {rows.map((r) => r.kind === 'day' ? (
        <div key={r.key} className="my-3 flex items-center gap-3 text-xs font-medium text-[var(--muted)]"><div className="h-px flex-1 bg-[var(--border)]" />{r.label}<div className="h-px flex-1 bg-[var(--border)]" /></div>
      ) : (
        <MessageRow key={r.key} m={r.m} grouped={r.grouped} onThread={conv.readOnly ? undefined : onThread} />
      ))}
    </div>
  );
}

export function MessageRow({ m, grouped, onThread }: { m: Msg; grouped: boolean; onThread?: (m: Msg) => void }) {
  const { ws, agentById } = useWs();
  const agent = agentById(m.author_agent_id);
  const name = m.author_kind === 'agent' ? agent?.displayName ?? m.author_label ?? 'Agent' : m.author_label ?? 'Unknown';
  const time = new Date(ts(m)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const retry = async () => { if (m.run_id) await api(`/api/w/${ws.slug}/runs/${m.run_id}/retry`, { method: 'POST' }).catch(() => {}); };
  const stop = async () => { if (m.run_id) await api(`/api/w/${ws.slug}/runs/${m.run_id}/stop`, { method: 'POST' }).catch(() => {}); };
  return (
    <div className={`group relative flex gap-3 rounded-lg px-2 ${grouped ? 'py-0.5' : 'mt-2 py-1.5'} hover:bg-[var(--hover)]`}>
      <div className="w-9 shrink-0">
        {!grouped && <Avatar name={name} url={m.author_kind === 'agent' ? agent?.avatarUrl : null} size={36} />}
        {grouped && <span className="hidden pt-1 text-[10px] text-[var(--muted)] group-hover:block">{time}</span>}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{name}</span>
            {m.author_kind === 'agent' && <span className="rounded bg-[var(--hover)] px-1 text-[10px] font-medium text-[var(--muted)] uppercase">Agent</span>}
            {m.source === 'telegram_mirror' && <span className="flex items-center gap-0.5 text-[11px] text-sky-500"><IconTelegram className="h-3 w-3" />via Telegram</span>}
            <span className="text-xs text-[var(--muted)]">{time}</span>
          </div>
        )}
        {m.state === 'pending' && !m.body && <div className="flex items-center gap-2 py-1 text-sm text-[var(--muted)]"><span className="typing"><span /><span /><span /></span>Waiting for Hermes…</div>}
        {m.body && <div className="prose-msg text-[15px] leading-relaxed">{renderBody(m.body)}</div>}
        {m.state === 'streaming' && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[var(--color-accent)] align-middle" />}
        {m.state === 'failed' && (
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-sm text-rose-600 dark:text-rose-300">
            <span className="font-medium">Not delivered / no reply.</span><span className="opacity-90">{m.error}</span>
            {m.run_id && <button onClick={retry} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-rose-500/15"><IconRetry className="h-3.5 w-3.5" />Retry</button>}
          </div>
        )}
        {m.state === 'cancelled' && <div className="mt-1 text-xs text-[var(--muted)]">Run cancelled.</div>}
        {(m.state === 'pending' || m.state === 'streaming') && m.run_id && (
          <button onClick={stop} className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)] hover:text-rose-500"><IconStop className="h-3 w-3" />Stop</button>
        )}
        {!!m.attachments?.length && <Attachments list={m.attachments} />}
        {!!m.replyCount && onThread && (
          <button onClick={() => onThread(m)} className="mt-1 flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline"><IconThread className="h-3.5 w-3.5" />{m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}</button>
        )}
      </div>
      {onThread && !m.parent_id && m.state === 'final' && (
        <button aria-label="Reply in thread" onClick={() => onThread(m)} className="absolute top-1 right-2 hidden rounded-md border border-[var(--border)] bg-[var(--bg)] p-1 text-[var(--muted)] shadow-sm group-hover:block"><IconThread className="h-4 w-4" /></button>
      )}
    </div>
  );
}

/** Minimal, safe rendering: code fences, inline code, @mentions. No HTML injection. */
function renderBody(body: string) {
  const parts = body.split(/(```[\s\S]*?```)/g);
  return parts.map((p, i) => {
    if (p.startsWith('```') && p.endsWith('```')) return <pre key={i}><code>{p.slice(3, -3).replace(/^\w*\n/, '')}</code></pre>;
    return p.split(/(`[^`\n]+`|@[a-z0-9][a-z0-9_-]*)/gi).map((s, j) =>
      s.startsWith('`') && s.endsWith('`') && s.length > 1 ? <code key={`${i}-${j}`}>{s.slice(1, -1)}</code>
        : s.startsWith('@') ? <span key={`${i}-${j}`} className="rounded bg-[var(--color-accent)]/12 px-0.5 font-medium text-[var(--color-accent)]">{s}</span>
          : s,
    );
  });
}

function Attachments({ list }: { list: Attachment[] }) {
  const { ws } = useWs();
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {list.map((a) => /^image\//.test(a.mime) ? (
        <a key={a.id} href={`/api/w/${ws.slug}/attachments/${a.id}`} target="_blank" rel="noreferrer"><img src={`/api/w/${ws.slug}/attachments/${a.id}`} alt={a.filename} className="max-h-48 rounded-lg border border-[var(--border)]" /></a>
      ) : (
        <a key={a.id} href={`/api/w/${ws.slug}/attachments/${a.id}`} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--hover)]">
          <IconClip className="h-4 w-4 text-[var(--muted)]" /><span className="max-w-48 truncate">{a.filename}</span><span className="text-xs text-[var(--muted)]">{fmtSize(a.size)}</span>
        </a>
      ))}
    </div>
  );
}
const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function Composer({ conv, parentId, onSent }: { conv: Conversation; parentId?: number; onSent: () => void }) {
  const { ws, agentById, canWrite } = useWs();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<{ id: number; filename: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const members = conv.agentIds.map((id) => agentById(id)).filter(Boolean) as Agent[];
  const suggestions = mention ? members.filter((a) => a.profileName.startsWith(mention.q.toLowerCase()) || a.displayName.toLowerCase().startsWith(mention.q.toLowerCase())).slice(0, 6) : [];

  useEffect(() => { const ta = taRef.current; if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; } }, [text]);

  const onChange = (v: string) => {
    setText(v);
    const pos = taRef.current?.selectionStart ?? v.length;
    const m = /(^|\s)@([a-z0-9_-]*)$/i.exec(v.slice(0, pos));
    setMention(m && conv.kind === 'channel' ? { q: m[2], start: pos - m[2].length - 1 } : null);
  };
  const pick = (a: Agent) => {
    if (!mention) return;
    const pos = taRef.current?.selectionStart ?? text.length;
    setText(text.slice(0, mention.start) + '@' + a.profileName + ' ' + text.slice(pos));
    setMention(null);
    taRef.current?.focus();
  };
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      await api(`/api/w/${ws.slug}/conversations/${conv.id}/messages`, { method: 'POST', json: { body: text, parentId, attachmentIds: files.map((f) => f.id) } });
      setText(''); setFiles([]); onSent();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const onKey = (e: KeyboardEvent) => {
    if (suggestions.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(suggestions[0]); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.innerWidth >= 768) { e.preventDefault(); void send(); }
  };
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api<{ id: number; filename: string }>(`/api/w/${ws.slug}/uploads`, { method: 'POST', body: fd }); setFiles((x) => [...x, r]); } catch (e) { setErr((e as Error).message); }
  };
  if (!canWrite) return <div className="border-t border-[var(--border)] p-3 text-center text-sm text-[var(--muted)]">You have read-only access to this workspace.</div>;
  const hint = conv.kind === 'dm' ? `Message ${agentById(conv.dmAgentId)?.displayName ?? ''}` : `Message #${conv.name} — @mention an agent to route it`;
  return (
    <div className="safe-bottom relative px-3 pt-1 pb-3 md:px-5">
      {suggestions.length > 0 && (
        <div className="absolute bottom-full left-5 z-10 mb-1 w-64 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-lg">
          {suggestions.map((a) => (
            <button key={a.id} onMouseDown={(e) => { e.preventDefault(); pick(a); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)]">
              <Avatar name={a.displayName} url={a.avatarUrl} size={22} status={a.status} />{a.displayName}<span className="ml-auto text-xs text-[var(--muted)]">@{a.profileName}</span>
            </button>
          ))}
        </div>
      )}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] focus-within:border-[var(--color-accent)]">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {files.map((f) => <span key={f.id} className="flex items-center gap-1 rounded bg-[var(--hover)] px-2 py-0.5 text-xs">{f.filename}<button aria-label="Remove" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}><IconX className="h-3 w-3" /></button></span>)}
          </div>
        )}
        <textarea ref={taRef} rows={1} value={text} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder={hint} className="block max-h-[200px] w-full resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none" />
        <div className="flex items-center gap-1 px-2 pb-2">
          <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          <button aria-label="Attach file" onClick={() => fileRef.current?.click()} className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]"><IconClip className="h-4.5 w-4.5" /></button>
          {err && <span className="truncate text-xs text-rose-500">{err}</span>}
          <button aria-label="Send" disabled={!text.trim() || busy} onClick={send} className="ml-auto rounded-lg bg-[var(--color-accent)] p-2 text-white disabled:opacity-40"><IconSend className="h-4 w-4" /></button>
        </div>
      </div>
      {files.length > 0 && <p className="mt-1 text-[11px] text-[var(--muted)]">Files are stored in this workspace. Hermes receives the file name only (the API server does not accept file uploads).</p>}
    </div>
  );
}

function SidePanel({ title, onClose, mobile, children }: { title: string; onClose: () => void; mobile: boolean; children: React.ReactNode }) {
  return (
    <aside className={mobile ? 'fixed inset-0 z-30 flex flex-col bg-[var(--bg)] safe-top' : 'flex w-80 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel)]'}>
      <div className="flex items-center border-b border-[var(--border)] px-4 py-3"><h2 className="flex-1 font-semibold">{title}</h2><button aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-[var(--hover)]"><IconX /></button></div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

function ThreadPanel({ parent, conv, onClose, mobile }: { parent: Msg; conv: Conversation; onClose: () => void; mobile: boolean }) {
  const { ws } = useWs();
  const [list, setList] = useState<Msg[]>([]);
  const load = useCallback(() => api<Msg[]>(`/api/w/${ws.slug}/conversations/${conv.id}/messages?thread=${parent.id}`).then(setList).catch(() => {}), [ws.slug, conv.id, parent.id]);
  useEffect(() => { void load(); }, [load]);
  useServerEvents((e) => { if (e.type === 'message.upsert' && e.conversationId === conv.id && (e.payload.parent_id === parent.id || list.some((m) => m.id === e.payload.id))) void load(); });
  return (
    <SidePanel title="Thread" onClose={onClose} mobile={mobile}>
      <div className="px-2 py-2">{list.map((m) => <MessageRow key={m.id} m={m} grouped={false} />)}</div>
      <div className="border-t border-[var(--border)]"><Composer conv={conv} parentId={parent.id} onSent={load} /></div>
      <p className="px-4 pb-3 text-[11px] text-[var(--muted)]">Thread replies addressed to an agent are delivered to that agent's session for this conversation.</p>
    </SidePanel>
  );
}

function InfoPanel({ conv, messages, onClose, mobile }: { conv: Conversation; messages: Msg[]; onClose: () => void; mobile: boolean }) {
  const { ws, agentById } = useWs();
  const agents = conv.agentIds.map((i) => agentById(i)).filter(Boolean) as Agent[];
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [taskErr, setTaskErr] = useState('');
  const [activity, setActivity] = useState<any[]>([]);
  const names = agents.map((a) => a.profileName).join(',');
  useEffect(() => {
    api<Task[]>(`/api/w/${ws.slug}/tasks`).then((t) => setTasks(t.filter((x) => x.assignee && names.split(',').includes(x.assignee)))).catch((e) => setTaskErr(e.message));
    api<any[]>(`/api/w/${ws.slug}/activity`).then((a) => setActivity(a.filter((x) => x.conversation === conv.name).slice(0, 15))).catch(() => {});
  }, [ws.slug, conv.id, names]);
  useServerEvents((e) => { if (e.type === 'activity' && e.conversationId === conv.id) setActivity((a) => [{ ...e.payload, agent: agentById(e.payload.agentId)?.displayName, created_at: e.payload.at }, ...a].slice(0, 15)); });
  const files = messages.flatMap((m) => m.attachments ?? []);
  const single = conv.kind !== 'channel' ? agents[0] : null;
  return (
    <SidePanel title={single ? 'Agent' : 'Details'} onClose={onClose} mobile={mobile}>
      {single && (
        <div className="flex flex-col items-center gap-2 border-b border-[var(--border)] px-4 py-5 text-center">
          <Avatar name={single.displayName} url={single.avatarUrl} size={88} status={single.status} />
          <div className="text-lg font-semibold">{single.displayName}</div>
          {single.role && <div className="text-sm text-[var(--muted)]">{single.role}</div>}
          <StatusPill agent={single} />
          {single.description && <p className="text-sm text-[var(--muted)]">{single.description}</p>}
          <Link to={`/w/${ws.slug}/agents/${single.id}`} className="text-sm text-[var(--color-accent)] hover:underline">View profile</Link>
        </div>
      )}
      {!single && (
        <PanelSection title={`Participants · ${agents.length}`}>
          {agents.map((a) => (
            <Link key={a.id} to={`/w/${ws.slug}/agents/${a.id}`} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-[var(--hover)]">
              <Avatar name={a.displayName} url={a.avatarUrl} size={30} status={a.status} />
              <div className="min-w-0"><div className="truncate text-sm font-medium">{a.displayName}</div><div className="truncate text-xs text-[var(--muted)]">{a.role ?? `@${a.profileName}`}</div></div>
            </Link>
          ))}
          {conv.defaultAgentId && <p className="px-2 pt-1 text-xs text-[var(--muted)]">Unaddressed messages go to {agentById(conv.defaultAgentId)?.displayName}.</p>}
        </PanelSection>
      )}
      <PanelSection title="Tasks">
        {taskErr && <p className="px-2 text-xs text-[var(--muted)]">Kanban unavailable: {taskErr}</p>}
        {tasks?.length === 0 && <p className="px-2 text-xs text-[var(--muted)]">No Kanban tasks for these agents.</p>}
        {tasks?.slice(0, 8).map((t) => (
          <Link key={t.id} to={`/w/${ws.slug}/tasks?task=${t.id}`} className="block rounded-md px-2 py-1.5 hover:bg-[var(--hover)]">
            <div className="truncate text-sm">{t.title}</div>
            <div className="text-xs text-[var(--muted)]">{t.status} · {t.assignee}</div>
          </Link>
        ))}
      </PanelSection>
      <PanelSection title="Files">
        {!files.length && <p className="px-2 text-xs text-[var(--muted)]">No files shared here yet.</p>}
        {files.slice(-8).reverse().map((f) => <a key={f.id} href={`/api/w/${ws.slug}/attachments/${f.id}`} className="block truncate rounded-md px-2 py-1 text-sm hover:bg-[var(--hover)]">{f.filename}</a>)}
      </PanelSection>
      <PanelSection title="Activity">
        {!activity.length && <p className="px-2 text-xs text-[var(--muted)]">Tool calls and run events reported by Hermes appear here.</p>}
        {activity.map((a, i) => (
          <div key={i} className="px-2 py-1 text-xs">
            <span className="font-medium">{a.agent}</span> <span className="text-[var(--muted)]">{a.event}</span>{a.tool && <> · <code>{a.tool}</code></>}{a.error ? <span className="text-rose-500"> · error</span> : null}
            <div className="text-[10px] text-[var(--muted)]">{new Date(a.created_at).toLocaleTimeString()}</div>
          </div>
        ))}
      </PanelSection>
    </SidePanel>
  );
}

export function StatusPill({ agent }: { agent: Agent }) {
  const s = STATUS_META[agent.status];
  return <span title={s.hint} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs"><span className={`h-2 w-2 rounded-full ${s.dot}`} />{s.label}{agent.activeRuns > 0 && ` · ${agent.activeRuns} active`}</span>;
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="border-b border-[var(--border)] px-2 py-3"><h3 className="px-2 pb-1.5 text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">{title}</h3>{children}</div>;
}
