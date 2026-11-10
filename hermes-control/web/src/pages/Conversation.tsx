import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ts, type Agent, type Attachment, type Conversation, type Message } from '../lib/api';
import { useServerEvents } from '../lib/events';
import { convTitle, useWs } from '../lib/workspace';
import { plainText, useIsMobile } from '../components/Shell';
import { Markdown } from '../components/Markdown';
import { Avatar, AvatarStack, Button, EmptyState, IBack, IClip, ICompose, IInfo, IMic, IPlus, IRetry, ISpeaker, IStop, IUp, IX, Row, Section, Sheet, STATUS } from '../components/ui';

type Msg = Message & { run_id?: number | null; run_status?: string | null };
/** Latest thing each running reply is doing, keyed by run id (from live activity events). */
type Activity = Record<number, { tool: string | null; event: string }>;

const TOOL_WORDS: [RegExp, string][] = [
  [/^terminal|execute_code|process/, 'Running a command'], [/web_search|search/, 'Searching'], [/web_extract|browser|fetch/, 'Reading a web page'],
  [/read_file|skill_view|session_search/, 'Reading'], [/write_file|patch|edit/, 'Writing a file'], [/^kanban/, 'Updating the task board'],
  [/delegate|subagent/, 'Asking a teammate'], [/memory/, 'Updating memory'], [/image|vision/, 'Working on an image'], [/^mcp/, 'Using a connected service'],
];
function activityWords(a?: { tool: string | null; event: string }) {
  if (!a) return 'Thinking';
  if (a.event.startsWith('subagent')) return 'Asking a teammate';
  if (!a.tool || a.event === 'tool.completed') return 'Thinking';
  return TOOL_WORDS.find(([re]) => re.test(a.tool!))?.[1] ?? 'Working';
}
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

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
  const [info, setInfo] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [activity, setActivity] = useState<Activity>({});

  const seenReplies = useRef(new Set<number>());
  const [loadError, setLoadError] = useState(false);
  const current = useRef(id);
  current.current = id;
  const load = useCallback(() => {
    // A slow answer for a chat you already left must not replace the one on screen.
    api<Msg[]>(`/api/w/${ws.slug}/conversations/${id}/messages`)
      .then((m) => { if (current.current !== id) return; setMessages(m); setLoaded(true); setLoadError(false); })
      .catch(() => { if (current.current !== id) return; setLoaded(true); setLoadError(true); });
  }, [ws.slug, id]);
  useEffect(() => { setMessages([]); setLoaded(false); setLoadError(false); setThread(null); setActivity({}); seenReplies.current.clear(); load(); markRead(id); return () => markRead(null); }, [load, id]);

  useServerEvents((e) => {
    if (e.type === 'reconnected') return load();
    if (e.type === 'activity' && e.conversationId === id) {
      const a = e.payload as { runId: number; tool: string | null; event: string };
      return setActivity((m) => ({ ...m, [a.runId]: { tool: a.tool, event: a.event } }));
    }
    if (e.type !== 'message.upsert' || e.conversationId !== id) return;
    const m = e.payload as Msg;
    if (m.parent_id) {
      // A thread reply streams as many updates; count it once.
      if (seenReplies.current.has(m.id)) return;
      seenReplies.current.add(m.id);
      return setMessages((list) => list.map((x) => (x.id === m.parent_id ? { ...x, replyCount: (x.replyCount ?? 0) + 1 } : x)));
    }
    setMessages((list) => {
      const i = list.findIndex((x) => x.id === m.id);
      if (i >= 0) { const copy = list.slice(); copy[i] = { ...list[i], ...m }; return copy; }
      return [...list, m];
    });
  });

  if (!conv) return <div className="flex flex-1 items-center justify-center text-[var(--label-2)]">{conversations.length ? 'This chat doesn’t exist.' : ''}</div>;
  const dmAgent = agentById(conv.dmAgentId);
  const title = convTitle(conv, (x) => agentById(x)?.displayName);
  const members = conv.agentIds.map((x) => agentById(x)).filter(Boolean) as Agent[];
  const subtitle = conv.kind === 'telegram_mirror' ? (conv.twoWay ? 'Synced with Telegram' : 'Copy of your Telegram chat') : conv.kind === 'dm' ? (dmAgent ? STATUS[dmAgent.status].label : '') : members.map((m) => m.displayName).join(', ');
  const openInfo = () => (conv.kind === 'dm' && dmAgent ? nav(`/w/${ws.slug}/agents/${dmAgent.id}`) : setInfo(true));

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="material-bar safe-top sticky top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center border-b-[0.5px] border-[var(--separator)] px-2 py-1.5">
        <div>{mobile && <button aria-label="Back to chats" onClick={() => nav(`/w/${ws.slug}`)} className="press flex h-11 items-center gap-0.5 pr-2 text-[17px] text-[var(--blue)]"><IBack size={26} />Chats</button>}</div>
        <button onClick={openInfo} className="press flex flex-col items-center rounded-xl px-3 py-1">
          {conv.kind === 'channel' ? <AvatarStack people={members.map((m) => ({ name: m.displayName, url: m.avatarUrl }))} size={38} /> : <Avatar name={dmAgent?.displayName ?? title} url={dmAgent?.avatarUrl} size={38} status={conv.kind === 'dm' ? dmAgent?.status : undefined} />}
          <span className="t-foot mt-0.5 flex items-center gap-0.5 font-semibold">{title}<span className="text-[var(--label-3)]">›</span></span>
          <span className="max-w-[60vw] truncate text-[11px] text-[var(--label-2)] md:max-w-sm">{subtitle}</span>
        </button>
        <div className="flex justify-end">
          {conv.kind !== 'channel' && !conv.readOnly && <button aria-label="Start a fresh conversation" title="Start fresh" onClick={() => setFresh(true)} className="press flex h-11 w-11 items-center justify-center text-[var(--blue)]"><ICompose size={23} /></button>}
          <button aria-label="Details" onClick={openInfo} className="press flex h-11 w-11 items-center justify-center text-[var(--blue)]"><IInfo size={24} /></button>
        </div>
      </header>
      {loadError && !messages.length
        ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><p className="t-sub text-[var(--label-2)]">Couldn’t load this chat.</p><Button variant="tinted" onClick={load}>Try Again</Button></div>
        : <MessageList messages={messages} loaded={loaded} conv={conv} onThread={setThread} activity={activity} />}
      {conv.long && !conv.readOnly && (
        <button onClick={() => setFresh(true)} className="press flex items-center gap-2 bg-[color-mix(in_srgb,var(--orange)_14%,var(--bg))] px-4 py-2 text-left">
          <span className="t-foot flex-1"><b>This chat is getting long.</b> Long chats are slower and cost more.</span>
          <span className="t-foot shrink-0 font-semibold text-[var(--blue)]">Start Fresh</span>
        </button>
      )}
      {fresh && <FreshSheet conv={conv} name={dmAgent?.displayName ?? 'the agent'} onClose={() => setFresh(false)} />}
      {conv.readOnly ? <MirrorFooter conv={conv} /> : <>{conv.twoWay && <p className="t-cap bg-[var(--bg)] px-4 pt-1 text-center text-[var(--label-2)]">Sent from here, copied to Telegram</p>}<Composer key={conv.id} conv={conv} /></>}
      {thread && <ThreadSheet parent={thread} conv={conv} onClose={() => setThread(null)} />}
      {info && <GroupInfo conv={conv} members={members} messages={messages} onClose={() => setInfo(false)} />}
    </div>
  );
}

function FreshSheet({ conv, name, onClose }: { conv: Conversation; name: string; onClose: () => void }) {
  const { ws, refresh } = useWs();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await api(`/api/w/${ws.slug}/conversations/${conv.id}/fresh`, { method: 'POST', json: {} }); refresh(); onClose(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Sheet title="Start Fresh?" onClose={onClose}>
      <div className="px-5 pb-6">
        <p className="t-sub">{name} starts the next message with a clean slate, so replies are faster and cost less.</p>
        <ul className="t-sub mt-3 list-disc space-y-1 pl-5 text-[var(--label-2)]">
          <li>Everything above stays here for you to read.</li>
          <li>{name} keeps long-term memory, but won’t remember the details of this chat.</li>
          <li>Tip: first ask {name} to “remember anything important from this chat”.</li>
        </ul>
        {err && <p className="t-foot mt-3 text-[var(--red)]">{err}</p>}
        <div className="mt-5 flex gap-3">
          <Button variant="tinted" onClick={onClose} className="flex-1">Not Now</Button>
          <Button onClick={go} disabled={busy} className="flex-1">{busy ? 'Starting…' : 'Start Fresh'}</Button>
        </div>
      </div>
    </Sheet>
  );
}

function MirrorFooter({ conv }: { conv: Conversation }) {
  const { ws, conversations, agentById } = useWs();
  const a = agentById(conv.dmAgentId);
  const dm = conversations.find((c) => c.kind === 'dm' && c.dmAgentId === conv.dmAgentId);
  return (
    <div className="material-bar safe-bottom border-t-[0.5px] border-[var(--separator)] px-4 py-3 text-center">
      <p className="t-foot text-[var(--label-2)]">This is a copy of your Telegram chat. Reply in Telegram, or turn on Two-way in Settings.</p>
      {dm && <Link to={`/w/${ws.slug}/c/${dm.id}`} className="t-sub mt-1 inline-block font-semibold text-[var(--blue)]">Message {a?.displayName ?? 'this agent'} here instead</Link>}
    </div>
  );
}

function MessageList({ messages, loaded, conv, onThread, activity }: { messages: Msg[]; loaded: boolean; conv: Conversation; onThread: (m: Msg) => void; activity: Activity }) {
  const { agentById, ws } = useWs();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages]);
  const onScroll = () => { const el = ref.current!; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };
  const mine = (m: Msg) => m.author_kind === 'user' || m.author_kind === 'external';

  const rows = useMemo(() => messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const sameAuthor = (a?: Msg) => !!a && mine(a) === mine(m) && a.author_agent_id === m.author_agent_id && Math.abs(ts(a) - ts(m)) < 5 * 60_000;
    const showTime = !prev || ts(m) - ts(prev) > 15 * 60_000 || new Date(ts(m)).toDateString() !== new Date(ts(prev)).toDateString();
    return { m, first: !sameAuthor(prev) || showTime, last: !sameAuthor(next), showTime };
  }), [messages]);

  const dmAgent = agentById(conv.dmAgentId);
  return (
    <div ref={ref} onScroll={onScroll} className="scroll min-h-0 flex-1 px-3 pt-3 pb-2 md:px-6">
      {loaded && !messages.length && (
        conv.kind === 'telegram_mirror'
          ? <EmptyState title="Nothing here yet" body="Messages from your Telegram chat will show up here once the Telegram copy is switched on." />
          : <div className="flex flex-col items-center pt-14 text-center">
              {conv.kind === 'dm' ? <Avatar name={dmAgent?.displayName ?? '?'} url={dmAgent?.avatarUrl} size={88} /> : <AvatarStack people={conv.agentIds.map((x) => agentById(x)).filter(Boolean).map((a) => ({ name: a!.displayName, url: a!.avatarUrl }))} size={88} />}
              <h3 className="t-title mt-3">{convTitle(conv, (x) => agentById(x)?.displayName)}</h3>
              <p className="t-sub mt-1 max-w-xs text-[var(--label-2)]">{conv.kind === 'dm' ? `Send ${dmAgent?.displayName ?? 'them'} a message. Their real reply appears here.` : 'Tap a name below to choose who you’re asking, then type your message.'}</p>
            </div>
      )}
      {rows.map(({ m, first, last, showTime }) => (
        <div key={m.id}>
          {showTime && <div className="t-cap mt-4 mb-2 text-center text-[var(--label-2)]"><span className="font-semibold">{dayWord(ts(m))}</span> {new Date(ts(m)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>}
          {m.author_kind === 'system'
            ? <div className="my-3 flex items-center gap-3 px-2" role="separator"><span className="h-px flex-1 bg-[var(--separator)]" /><span className="t-cap font-semibold text-[var(--label-2)]">{m.body}</span><span className="h-px flex-1 bg-[var(--separator)]" /></div>
            : <Bubble m={m} mine={mine(m)} first={first} last={last} group={conv.kind === 'channel'} wsSlug={ws.slug} onThread={conv.readOnly ? undefined : onThread} doing={m.run_id ? activity[m.run_id] : undefined} />}
        </div>
      ))}
    </div>
  );
}

function dayWord(t: number) {
  const d = new Date(t); const now = new Date(); const y = new Date(); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function Bubble({ m, mine, first, last, group, wsSlug, onThread, doing }: { m: Msg; mine: boolean; first: boolean; last: boolean; group: boolean; wsSlug: string; onThread?: (m: Msg) => void; doing?: { tool: string | null; event: string } }) {
  const { agentById } = useWs();
  const agent = agentById(m.author_agent_id);
  const name = agent?.displayName ?? m.author_label ?? 'Agent';
  const [why, setWhy] = useState(false);
  const retry = () => m.run_id && api(`/api/w/${wsSlug}/runs/${m.run_id}/retry`, { method: 'POST' }).catch(() => {});
  const stop = () => m.run_id && api(`/api/w/${wsSlug}/runs/${m.run_id}/stop`, { method: 'POST' }).catch(() => {});
  const thinking = (m.state === 'pending' || m.state === 'streaming') && !m.body;
  const running = m.state === 'pending' || m.state === 'streaming';
  // While a reply is in progress, tick once a second so the elapsed time stays honest.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  const elapsed = now - m.created_at;
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const speak = () => {
    if (speaking) { speechSynthesis.cancel(); return setSpeaking(false); }
    const u = new SpeechSynthesisUtterance(plainText(m.body).slice(0, 4000));
    u.onend = u.onerror = () => setSpeaking(false);
    speechSynthesis.cancel(); speechSynthesis.speak(u); setSpeaking(true);
  };
  useEffect(() => () => { if (speaking) speechSynthesis.cancel(); }, [speaking]);
  const radius = mine ? `rounded-[20px] ${last ? 'rounded-br-[6px]' : ''}` : `rounded-[20px] ${last ? 'rounded-bl-[6px]' : ''}`;

  return (
    <div className={`msg-in flex items-end gap-2 ${mine ? 'justify-end' : ''} ${last ? 'mb-2' : 'mb-[3px]'}`}>
      {!mine && <div className="w-8 shrink-0">{last && <Avatar name={name} url={agent?.avatarUrl} size={32} />}</div>}
      <div className={`flex max-w-[78%] flex-col md:max-w-[62%] ${mine ? 'items-end' : 'items-start'}`}>
        {!mine && group && first && <span className="t-cap mb-0.5 ml-3 text-[var(--label-2)]">{name}</span>}
        {thinking ? (
          <div className={`bg-[var(--bubble-them)] px-4 py-3 ${radius}`} aria-label={`${name} is typing`}><span className="typing"><span /><span /><span /></span></div>
        ) : m.state === 'failed' && !m.body ? (
          <div className={`border border-[color-mix(in_srgb,var(--red)_40%,transparent)] px-4 py-2.5 ${radius}`}>
            <p className="t-sub font-semibold text-[var(--red)]">{name} didn’t reply.</p>
            {why && m.error && <p className="t-foot mt-1 text-[var(--label-2)]">{m.error}</p>}
            <div className="mt-1.5 flex gap-3">
              {m.run_id && <button onClick={retry} className="press t-sub flex items-center gap-1 font-semibold text-[var(--blue)]"><IRetry size={16} />Try Again</button>}
              {m.error && <button onClick={() => setWhy((w) => !w)} className="press t-sub text-[var(--label-2)]">{why ? 'Hide' : 'Why?'}</button>}
            </div>
          </div>
        ) : (
          <div className={`bubble px-3.5 py-2 text-[17px] leading-[1.3] ${mine ? 'bg-[var(--bubble-me)] text-white' : 'bg-[var(--bubble-them)]'} ${radius}`}>
            {mine ? renderBody(m.body) : <Markdown text={m.body} />}
            {m.state === 'streaming' && <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse rounded bg-current align-middle opacity-60" />}
          </div>
        )}
        {!!m.attachments?.length && <Attachments list={m.attachments} wsSlug={wsSlug} mine={mine} />}
        {running && m.run_id && (
          <span className="t-cap mt-1 ml-3 flex items-center gap-2 text-[var(--label-2)]">
            {m.run_status === 'waiting_for_approval'
              ? <Link to={`/w/${wsSlug}/needs-you`} className="font-semibold text-[var(--orange)]">Waiting for your OK ›</Link>
              : <>
                  {elapsed >= 4000 && <span aria-live="off">{activityWords(doing)} · {clock(elapsed)}</span>}
                  {elapsed >= 120_000 && <span className="text-[var(--orange)]">taking a while</span>}
                </>}
            <button onClick={stop} className="press font-semibold text-[var(--blue)]">Stop</button>
          </span>
        )}
        {!mine && !running && m.state === 'final' && m.body && canSpeak && last && (
          <button onClick={speak} aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'} className="press t-cap mt-0.5 ml-2 flex items-center gap-1 text-[var(--label-2)]">{speaking ? <IStop size={13} /> : <ISpeaker size={15} />}{speaking ? 'Stop' : 'Listen'}</button>
        )}
        {m.state === 'cancelled' && <span className="t-cap mt-1 ml-3 text-[var(--label-2)]">Stopped</span>}
        {m.state === 'failed' && m.body && <span className="t-cap mt-1 ml-3 text-[var(--red)]">Didn’t finish. {m.run_id && <button onClick={retry} className="font-semibold text-[var(--blue)]">Try Again</button>}</span>}
        {m.source === 'telegram_mirror' && last && <span className="t-cap mt-0.5 px-2 text-[var(--label-2)]">via Telegram</span>}
        {m.source === 'kanban' && last && <Link to={`/w/${wsSlug}/todos`} className="t-cap mt-0.5 px-2 text-[var(--label-2)]">from the task board ›</Link>}
        {!!m.replyCount && onThread && <button onClick={() => onThread(m)} className="press t-foot mt-1 px-2 font-semibold text-[var(--blue)]">{m.replyCount} {m.replyCount === 1 ? 'Reply' : 'Replies'}</button>}
      </div>
    </div>
  );
}

/** Safe text rendering: code blocks, inline code, @mentions. Never HTML. */
function renderBody(body: string) {
  return body.split(/(```[\s\S]*?```)/g).map((p, i) => {
    if (p.startsWith('```') && p.endsWith('```')) return <pre key={i}><code>{p.slice(3, -3).replace(/^\w*\n/, '')}</code></pre>;
    return p.split(/(`[^`\n]+`|@[a-z0-9][a-z0-9_-]*)/gi).map((s, j) =>
      s.startsWith('`') && s.endsWith('`') && s.length > 1 ? <code key={`${i}-${j}`}>{s.slice(1, -1)}</code>
        : s.startsWith('@') ? <span key={`${i}-${j}`} className="font-semibold">{s}</span> : s);
  });
}

function Attachments({ list, wsSlug, mine }: { list: Attachment[]; wsSlug: string; mine: boolean }) {
  return (
    <div className={`mt-1 flex flex-wrap gap-1.5 ${mine ? 'justify-end' : ''}`}>
      {list.map((a) => /^image\//.test(a.mime) ? (
        <a key={a.id} href={`/api/w/${wsSlug}/attachments/${a.id}`} target="_blank" rel="noreferrer"><img src={`/api/w/${wsSlug}/attachments/${a.id}`} alt={a.filename} className="max-h-56 rounded-[18px]" /></a>
      ) : (
        <a key={a.id} href={`/api/w/${wsSlug}/attachments/${a.id}`} className="press flex items-center gap-2 rounded-[16px] bg-[var(--fill)] px-3.5 py-2.5">
          <IClip size={18} className="text-[var(--label-2)]" /><span className="t-sub max-w-48 truncate">{a.filename}</span>
        </a>
      ))}
    </div>
  );
}

function Composer({ conv, parentId, onSent }: { conv: Conversation; parentId?: number; onSent?: () => void }) {
  const { ws, agentById, canWrite } = useWs();
  const members = conv.agentIds.map((x) => agentById(x)).filter(Boolean) as Agent[];
  const defaultAgent = agentById(conv.defaultAgentId);
  const [text, setText] = useState('');
  const [to, setTo] = useState<number[]>([]);
  const [files, setFiles] = useState<{ id: number; filename: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isGroup = conv.kind === 'channel';
  // Dictation: only where the browser offers speech recognition (Safari and Chrome do; it is hidden otherwise).
  const SR = typeof window !== 'undefined' ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : undefined;
  const rec = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const dictate = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); rec.current = r;
    const base = text.trim() ? text.trimEnd() + ' ' : '';
    r.lang = navigator.language || 'en-US'; r.interimResults = true; r.continuous = false;
    r.onresult = (e: any) => setText(base + Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join(''));
    r.onerror = (e: any) => { setListening(false); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setErr('Microphone access is off for this app. You can also use the microphone key on the keyboard.'); };
    r.onend = () => { setListening(false); ta.current?.focus(); };
    try { r.start(); setListening(true); setErr(''); } catch { setListening(false); }
  };
  useEffect(() => () => rec.current?.abort?.(), []);
  useEffect(() => { const t = ta.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px'; } }, [text]);

  const needsPick = isGroup && !to.length && !defaultAgent && !/@\w/.test(text);
  const canSend = text.trim().length > 0 && !busy && !needsPick;
  const send = async () => {
    if (!canSend) return;
    setBusy(true); setErr('');
    const mentions = to.map((x) => agentById(x)).filter((a) => a && !new RegExp(`@${a.profileName}\\b`, 'i').test(text)).map((a) => '@' + a!.profileName);
    const body = (mentions.length ? mentions.join(' ') + ' ' : '') + text.trim();
    try {
      await api(`/api/w/${ws.slug}/conversations/${conv.id}/messages`, { method: 'POST', json: { body, parentId, attachmentIds: files.map((f) => f.id) } });
      setText(''); setFiles([]); onSent?.(); ta.current?.focus();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.innerWidth >= 768) { e.preventDefault(); void send(); } };
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api<{ id: number; filename: string }>(`/api/w/${ws.slug}/uploads`, { method: 'POST', body: fd }); setFiles((x) => [...x, r]); } catch (e) { setErr((e as Error).message); }
  };

  if (!canWrite) return <p className="t-foot safe-bottom px-4 py-3 text-center text-[var(--label-2)]">You can read this chat but not send messages.</p>;
  const placeholder = !isGroup ? 'Message' : to.length ? `Ask ${to.map((x) => agentById(x)?.displayName).join(' & ')}` : defaultAgent ? `Message (goes to ${defaultAgent.displayName})` : 'Choose who to ask first';
  return (
    <div className="material-bar safe-bottom border-t-[0.5px] border-[var(--separator)] px-2 pt-2 pb-2 md:px-4">
      {isGroup && (
        <div className="scroll mb-2 flex gap-2 overflow-x-auto px-1">
          <span className="t-foot self-center text-[var(--label-2)]">Ask:</span>
          {members.map((a) => {
            const on = to.includes(a.id);
            return (
              <button key={a.id} onClick={() => setTo((t) => (on ? t.filter((x) => x !== a.id) : [...t, a.id]))} aria-pressed={on} className={`press flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[15px] ${on ? 'bg-[var(--blue)] text-white' : 'bg-[var(--fill)]'}`}>
                <Avatar name={a.displayName} url={a.avatarUrl} size={26} />{a.displayName}
              </button>
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 px-1">
          {files.map((f) => <span key={f.id} className="t-foot flex items-center gap-1 rounded-full bg-[var(--fill)] py-1 pr-1.5 pl-3">{f.filename}<button aria-label="Remove file" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} className="press rounded-full p-0.5"><IX size={14} /></button></span>)}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <button aria-label="Add a file" onClick={() => fileRef.current?.click()} className="press mb-[3px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--fill)] text-[var(--label-2)]"><IPlus size={20} /></button>
        <div className="flex min-h-[40px] flex-1 items-end rounded-[20px] border-[0.5px] border-[var(--separator)] bg-[var(--bg)] pr-1 pl-3.5 focus-within:border-[var(--blue)]">
          <textarea ref={ta} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder={placeholder} aria-label="Message" className="max-h-[180px] flex-1 resize-none bg-transparent py-2 text-[17px] outline-none placeholder:text-[var(--label-3)]" />
          {SR && (listening || !text.trim()) && <button aria-label={listening ? 'Stop dictation' : 'Dictate a message'} aria-pressed={listening} onClick={dictate} className={`press mr-1 mb-1 flex h-8 w-8 items-center justify-center rounded-full ${listening ? 'bg-[var(--red)] text-white' : 'text-[var(--label-2)]'}`}>{listening ? <IStop size={14} /> : <IMic size={20} />}</button>}
          <button aria-label="Send" disabled={!canSend} onClick={send} className={`press mb-1 flex h-8 w-8 items-center justify-center rounded-full text-white transition-opacity ${canSend ? 'bg-[var(--blue)]' : 'bg-[var(--label-3)] opacity-60'}`}><IUp size={20} /></button>
        </div>
      </div>
      {needsPick && text.trim() && <p className="t-foot mt-1.5 px-2 text-[var(--orange)]">Tap a name above so I know who to ask.</p>}
      {err && <p className="t-foot mt-1.5 px-2 text-[var(--red)]">{err}</p>}
      {files.length > 0 && <p className="t-cap mt-1 px-2 text-[var(--label-2)]">Files stay in Hermes Control. Agents only see the file name for now.</p>}
    </div>
  );
}

function ThreadSheet({ parent, conv, onClose }: { parent: Msg; conv: Conversation; onClose: () => void }) {
  const { ws } = useWs();
  const [list, setList] = useState<Msg[]>([]);
  const load = useCallback(() => api<Msg[]>(`/api/w/${ws.slug}/conversations/${conv.id}/messages?thread=${parent.id}`).then(setList).catch(() => {}), [ws.slug, conv.id, parent.id]);
  useEffect(() => { void load(); }, [load]);
  useServerEvents((e) => { if (e.type === 'message.upsert' && e.conversationId === conv.id) void load(); });
  return (
    <Sheet title="Replies" onClose={onClose}>
      <div className="pb-2">{list.map((m) => <Bubble key={m.id} m={m} mine={m.author_kind === 'user'} first last group={conv.kind === 'channel'} wsSlug={ws.slug} />)}</div>
      <div className="-mx-4"><Composer conv={conv} parentId={parent.id} onSent={load} /></div>
    </Sheet>
  );
}

function GroupInfo({ conv, members, messages, onClose }: { conv: Conversation; members: Agent[]; messages: Msg[]; onClose: () => void }) {
  const { ws, agentById } = useWs();
  const nav = useNavigate();
  const files = messages.flatMap((m) => m.attachments ?? []);
  const def = agentById(conv.defaultAgentId);
  return (
    <Sheet title={convTitle(conv, (x) => agentById(x)?.displayName)} onClose={onClose}>
      <Section title="People in this group" footer={def ? `If you don’t pick anyone, messages go to ${def.displayName}.` : 'Pick who to ask each time you send.'}>
        {members.map((a) => (
          <Row key={a.id} chevron onClick={() => { onClose(); nav(`/w/${ws.slug}/agents/${a.id}`); }}>
            <Avatar name={a.displayName} url={a.avatarUrl} size={36} status={a.status} />
            <span className="flex flex-col"><span>{a.displayName}</span><span className="t-foot text-[var(--label-2)]">{a.role ?? STATUS[a.status].label}</span></span>
          </Row>
        ))}
      </Section>
      <Section title="Files">
        {files.length ? files.slice(-10).reverse().map((f) => (
          <Row key={f.id}><a href={`/api/w/${ws.slug}/attachments/${f.id}`} className="flex-1 truncate text-[var(--blue)]">{f.filename}</a></Row>
        )) : <Row><span className="text-[var(--label-2)]">No files yet</span></Row>}
      </Section>
      <Button variant="tinted" size="lg" className="w-full" onClick={onClose}>Done</Button>
    </Sheet>
  );
}
