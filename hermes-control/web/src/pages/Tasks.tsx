import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Task } from '../lib/api';
import { useWs } from '../lib/workspace';
import { Avatar, Button, EmptyState, IList, IPlus, LargeTitle, Section, Sheet, Row, ICheck } from '../components/ui';

// Hermes Kanban statuses (hermes_cli/kanban_workflow.py) grouped into three plain buckets.
const BUCKETS = {
  todo: { label: 'To Do', statuses: ['triage', 'todo', 'scheduled', 'ready'] },
  doing: { label: 'Doing', statuses: ['running', 'review', 'blocked'] },
  done: { label: 'Done', statuses: ['done'] },
} as const;
type Bucket = keyof typeof BUCKETS;
const PLAIN: Record<string, string> = { triage: 'New', todo: 'To do', scheduled: 'Scheduled', ready: 'Ready to start', running: 'Working on it', review: 'Waiting for review', blocked: 'Stuck', done: 'Done' };
const fmt = (t?: number | null) => (t ? new Date(t * (t < 1e12 ? 1000 : 1)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);

export function TasksPage() {
  const { ws } = useWs();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [err, setErr] = useState('');
  const [bucket, setBucket] = useState<Bucket>('todo');
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const selected = params.get('task');
  const load = () => api<Task[]>(`/api/w/${ws.slug}/tasks`).then((t) => { setTasks(t); setErr(''); }).catch((e) => { setErr(e.message); setTasks([]); });
  useEffect(() => { void load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [ws.slug]);
  const counts = useMemo(() => Object.fromEntries((Object.keys(BUCKETS) as Bucket[]).map((b) => [b, (tasks ?? []).filter((t) => (BUCKETS[b].statuses as readonly string[]).includes(t.status)).length])), [tasks]);
  const shown = (tasks ?? []).filter((t) => (BUCKETS[bucket].statuses as readonly string[]).includes(t.status));

  return (
    <div className="scroll h-full flex-1 bg-[var(--bg-grouped)]">
      <LargeTitle title="To-Dos" trailing={ws.role !== 'viewer' && !err ? <button aria-label="New to-do" onClick={() => setAdding(true)} className="press flex h-9 w-9 items-center justify-center rounded-full bg-[var(--blue)] text-white"><IPlus size={20} /></button> : undefined} />
      <div className="mx-auto max-w-2xl px-4 pb-10 md:px-8">
        {err ? (
          <EmptyState icon={<IList size={56} />} title="To-Dos aren’t connected yet" body={<>They’ll appear here once Hermes Control is connected to Hermes.<br /><span className="t-cap">{err}</span></>} />
        ) : (
          <>
            <div role="tablist" className="mb-5 grid grid-cols-3 rounded-[9px] bg-[var(--fill)] p-0.5">
              {(Object.keys(BUCKETS) as Bucket[]).map((b) => (
                <button key={b} role="tab" aria-selected={bucket === b} onClick={() => setBucket(b)} className={`press rounded-[7px] py-1.5 text-[14px] font-semibold ${bucket === b ? 'bg-[var(--cell)] shadow-sm' : 'text-[var(--label-2)]'}`}>{BUCKETS[b].label}{counts[b] ? ` · ${counts[b]}` : ''}</button>
              ))}
            </div>
            {tasks && !shown.length && <EmptyState icon={<IList size={48} />} title={bucket === 'done' ? 'Nothing finished yet' : 'All clear'} body={bucket === 'todo' ? 'Tap + to give an agent something to do.' : undefined} />}
            {shown.length > 0 && <Section>{shown.map((t) => <TaskRow key={t.id} t={t} onOpen={() => setParams({ task: t.id })} />)}</Section>}
          </>
        )}
      </div>
      {selected && <TaskSheet id={selected} onClose={() => setParams({})} onChanged={load} />}
      {adding && <NewTask onClose={() => setAdding(false)} onCreated={() => { setAdding(false); setBucket('todo'); void load(); }} />}
    </div>
  );
}

function TaskRow({ t, onOpen }: { t: Task; onOpen: () => void }) {
  const { agents } = useWs();
  const a = agents.find((x) => x.profileName === t.assignee);
  const done = t.status === 'done';
  return (
    <Row onClick={onOpen} chevron>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${done ? 'border-[var(--green)] bg-[var(--green)] text-white' : t.status === 'blocked' ? 'border-[var(--red)]' : 'border-[var(--label-3)]'}`}>{done && <ICheck size={14} />}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate ${done ? 'text-[var(--label-2)] line-through' : ''}`}>{t.title}</span>
        <span className="t-foot flex items-center gap-1.5 text-[var(--label-2)]">
          {a && <Avatar name={a.displayName} url={a.avatarUrl} size={16} />}{a?.displayName ?? t.assignee ?? 'No one yet'}
          {t.status === 'blocked' && <span className="font-semibold text-[var(--red)]">· Stuck</span>}
          {t.status === 'running' && <span className="text-[var(--orange)]">· Working on it</span>}
        </span>
      </span>
    </Row>
  );
}

function TaskSheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { ws, agents } = useWs();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api<any>(`/api/w/${ws.slug}/tasks/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); void load(); }, [id]);
  const act = async (label: string, path: string, json: unknown) => {
    setBusy(label); setErr('');
    try { await api(`/api/w/${ws.slug}/tasks/${id}/${path}`, { method: 'POST', json }); await load(); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const t = d?.task;
  const owner = ws.role === 'owner';
  return (
    <Sheet title="To-Do" onClose={onClose}>
      {!t && !err && <p className="py-8 text-center text-[var(--label-2)]">Loading…</p>}
      {err && <p className="t-sub mb-3 text-[var(--red)]">{err}</p>}
      {t && (
        <>
          <h3 className="t-title mb-1">{t.title}</h3>
          <p className="t-sub mb-5 text-[var(--label-2)]">{PLAIN[t.status] ?? t.status}{fmt(t.completed_at) ? ` · finished ${fmt(t.completed_at)}` : fmt(t.created_at) ? ` · added ${fmt(t.created_at)}` : ''}</p>
          <Section title="Who’s doing it">
            <div className="scroll flex gap-3 overflow-x-auto p-3">
              {agents.map((a) => (
                <button key={a.id} disabled={!!busy} onClick={() => act('assign', 'assign', { profile: a.profileName === t.assignee ? null : a.profileName })} className={`press flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl p-1 ${a.profileName === t.assignee ? 'bg-[color-mix(in_srgb,var(--blue)_14%,transparent)]' : ''}`}>
                  <Avatar name={a.displayName} url={a.avatarUrl} size={44} />
                  <span className={`t-cap truncate ${a.profileName === t.assignee ? 'font-semibold text-[var(--blue)]' : ''}`}>{a.displayName}</span>
                </button>
              ))}
            </div>
          </Section>
          {t.body && <Section title="Details"><p className="t-sub px-4 py-3 whitespace-pre-wrap">{t.body}</p></Section>}
          {t.result && <Section title="Result"><p className="t-sub px-4 py-3 whitespace-pre-wrap">{t.result}</p></Section>}
          {t.last_failure_error && <Section title="What went wrong"><p className="t-sub px-4 py-3 whitespace-pre-wrap text-[var(--red)]">{t.last_failure_error}</p></Section>}
          <Section title="Notes" footer="Notes are added to the task in Hermes.">
            {d.comments?.map((c: any, i: number) => <Row key={i}><span className="flex flex-col"><span className="t-sub">{c.body}</span><span className="t-cap text-[var(--label-2)]">{c.author} · {fmt(c.created_at)}</span></span></Row>)}
            <div className="flex items-center gap-2 px-4 py-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" className="h-10 flex-1 bg-transparent outline-none" />
              <Button variant="plain" disabled={!note.trim() || !!busy} onClick={async () => { await act('note', 'comment', { text: note }); setNote(''); }}>Add</Button>
            </div>
          </Section>
          {owner && (
            <div className="grid grid-cols-2 gap-3">
              {t.status !== 'done' && <Button size="lg" disabled={!!busy} onClick={() => act('complete', 'transition', { action: 'complete' })}>Mark as Done</Button>}
              {t.status === 'blocked' ? <Button variant="tinted" size="lg" disabled={!!busy} onClick={() => act('unblock', 'transition', { action: 'unblock' })}>Unstick</Button>
                : t.status !== 'done' && <Button variant="tinted" size="lg" disabled={!!busy} onClick={() => act('block', 'transition', { action: 'block', reason: 'Paused from Hermes Control' })}>Put on Hold</Button>}
              <Button variant="destructive" size="lg" className="col-span-2" disabled={!!busy} onClick={() => { if (confirm('Archive this to-do?')) void act('archive', 'transition', { action: 'archive' }).then(onClose); }}>Archive</Button>
            </div>
          )}
          {d.events?.length > 0 && (
            <details className="mt-5">
              <summary className="t-foot cursor-pointer text-[var(--label-2)]">History</summary>
              {d.events.map((e: any, i: number) => <p key={i} className="t-cap mt-1 text-[var(--label-2)]">{fmt(e.created_at)} · {e.kind}</p>)}
            </details>
          )}
        </>
      )}
    </Sheet>
  );
}

function NewTask({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { ws, agents } = useWs();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [who, setWho] = useState<string>('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [clientKey] = useState(() => crypto.randomUUID().replace(/-/g, ''));
  const submit = async () => {
    setBusy(true); setErr('');
    try { await api(`/api/w/${ws.slug}/tasks`, { method: 'POST', json: { title, body: body || undefined, assignee: who || undefined, clientKey } }); onCreated(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet title="New To-Do" onClose={onClose} actions={<Button size="lg" className="w-full" disabled={!title.trim() || !who || busy} onClick={submit}>{busy ? 'Adding…' : 'Add To-Do'}</Button>}>
      <Section title="What needs doing?">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Check the budget" className="h-12 w-full bg-transparent px-4 text-[17px] outline-none" />
      </Section>
      <Section title="Who should do it?">
        <div className="grid grid-cols-4 gap-2 p-3 sm:grid-cols-5">
          {agents.map((a) => (
            <button key={a.id} onClick={() => setWho(a.profileName)} aria-pressed={who === a.profileName} className={`press flex flex-col items-center gap-1 rounded-xl p-1.5 ${who === a.profileName ? 'bg-[color-mix(in_srgb,var(--blue)_14%,transparent)]' : ''}`}>
              <span className={`rounded-full ${who === a.profileName ? 'ring-3 ring-[var(--blue)]' : ''}`}><Avatar name={a.displayName} url={a.avatarUrl} size={52} /></span>
              <span className={`t-cap truncate ${who === a.profileName ? 'font-semibold text-[var(--blue)]' : ''}`}>{a.displayName}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="More details (optional)">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="w-full resize-none bg-transparent px-4 py-3 outline-none" />
      </Section>
      {err && <p className="t-sub text-[var(--red)]">{err}</p>}
    </Sheet>
  );
}
