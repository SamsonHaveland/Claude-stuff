import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Task } from '../lib/api';
import { useWs } from '../lib/workspace';
import { PageHeader } from '../components/Shell';
import { Avatar } from '../components/Avatar';
import { IconX } from '../components/icons';

// Status vocabulary from hermes_cli/kanban_workflow.py (upstream).
const COLUMNS = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done'];
const fmt = (t?: number | null) => (t ? new Date(t * (t < 1e12 ? 1000 : 1)).toLocaleString() : '—');

export function TasksPage() {
  const { ws, agents, me } = useWs();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [err, setErr] = useState('');
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const selected = params.get('task');
  const load = () => api<Task[]>(`/api/w/${ws.slug}/tasks`).then((t) => { setTasks(t); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { void load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [ws.slug]);
  const byStatus = useMemo(() => Object.fromEntries(COLUMNS.map((c) => [c, (tasks ?? []).filter((t) => t.status === c)])), [tasks]);
  const agentByProfile = (p?: string | null) => agents.find((a) => a.profileName === p);
  const isOwner = ws.role === 'owner';

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title="Tasks" subtitle="Hermes Kanban (via the hermes kanban CLI)" actions={ws.role !== 'viewer' && <button onClick={() => setCreating(true)} className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white">New task</button>} />
        {err && <div className="m-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Kanban is unavailable: {err}</div>}
        <div className="scroll-thin flex flex-1 gap-3 overflow-x-auto p-4">
          {COLUMNS.map((c) => (
            <div key={c} className="flex w-72 shrink-0 flex-col rounded-xl bg-[var(--panel)]">
              <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">{c}<span className="rounded-full bg-[var(--hover)] px-1.5">{byStatus[c]?.length ?? 0}</span></div>
              <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {byStatus[c]?.map((t) => {
                  const a = agentByProfile(t.assignee);
                  return (
                    <button key={t.id} onClick={() => setParams({ task: t.id })} className={`w-full rounded-lg border bg-[var(--bg)] p-2.5 text-left text-sm shadow-sm hover:border-[var(--color-accent)]/60 ${selected === t.id ? 'border-[var(--color-accent)]' : 'border-[var(--border)]'}`}>
                      <div className="line-clamp-2 font-medium">{t.title}</div>
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                        {a ? <Avatar name={a.displayName} url={a.avatarUrl} size={18} /> : null}<span className="truncate">{a?.displayName ?? t.assignee ?? 'Unassigned'}</span>
                        {t.priority ? <span className="ml-auto">P{t.priority}</span> : null}
                      </div>
                      {t.last_failure_error && <div className="mt-1 truncate text-xs text-rose-500">{t.last_failure_error}</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {selected && <TaskDetail id={selected} canTransition={isOwner} admin={me.user.role === 'admin'} onClose={() => setParams({})} onChanged={load} />}
      {creating && <NewTask onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} />}
    </div>
  );
}

function TaskDetail({ id, onClose, onChanged, canTransition }: { id: string; onClose: () => void; onChanged: () => void; canTransition: boolean; admin: boolean }) {
  const { ws, agents } = useWs();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api<any>(`/api/w/${ws.slug}/tasks/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { setD(null); void load(); }, [id]);
  const act = async (label: string, path: string, json: unknown) => {
    setBusy(label); setErr('');
    try { await api(`/api/w/${ws.slug}/tasks/${id}/${path}`, { method: 'POST', json }); await load(); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const t = d?.task;
  return (
    <aside className="fixed inset-0 z-30 flex flex-col bg-[var(--bg)] md:static md:w-[420px] md:border-l md:border-[var(--border)]">
      <div className="safe-top flex items-center border-b border-[var(--border)] px-4 py-3"><h2 className="flex-1 truncate font-semibold">{t?.title ?? 'Task'}</h2><button aria-label="Close" onClick={onClose}><IconX /></button></div>
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {err && <p className="text-rose-500">{err}</p>}
        {!t && !err && <p className="text-[var(--muted)]">Loading…</p>}
        {t && (
          <>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5">
              <dt className="text-[var(--muted)]">Status</dt><dd className="font-medium">{t.status}</dd>
              <dt className="text-[var(--muted)]">Assignee</dt>
              <dd>
                <select disabled={!!busy} value={t.assignee ?? ''} onChange={(e) => act('assign', 'assign', { profile: e.target.value || null })} className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5">
                  <option value="">Unassigned</option>{agents.map((a) => <option key={a.id} value={a.profileName}>{a.displayName}</option>)}
                </select>
              </dd>
              <dt className="text-[var(--muted)]">Priority</dt><dd>{t.priority ?? '—'}</dd>
              <dt className="text-[var(--muted)]">Created</dt><dd>{fmt(t.created_at)}</dd>
              <dt className="text-[var(--muted)]">Started</dt><dd>{fmt(t.started_at)}</dd>
              <dt className="text-[var(--muted)]">Completed</dt><dd>{fmt(t.completed_at)}</dd>
            </dl>
            {t.body && <section><h3 className="mb-1 font-semibold">Description</h3><p className="whitespace-pre-wrap text-[var(--muted)]">{t.body}</p></section>}
            {t.result && <section><h3 className="mb-1 font-semibold">Result</h3><p className="whitespace-pre-wrap">{t.result}</p></section>}
            {t.last_failure_error && <section><h3 className="mb-1 font-semibold text-rose-500">Last error</h3><p className="whitespace-pre-wrap text-rose-500">{t.last_failure_error}</p></section>}
            {canTransition && (
              <div className="flex flex-wrap gap-2">
                {(['block', 'unblock', 'complete', 'archive'] as const).map((a) => (
                  <button key={a} disabled={!!busy} onClick={() => { if (confirm(`Ask Hermes to ${a} this task?`)) void act(a, 'transition', { action: a }); }} className="rounded-lg border border-[var(--border)] px-2.5 py-1 capitalize hover:bg-[var(--hover)] disabled:opacity-50">{busy === a ? '…' : a}</button>
                ))}
              </div>
            )}
            <p className="text-xs text-[var(--muted)]">Changes go through <code>hermes kanban</code>; Hermes enforces the workflow rules, and the board shows what Hermes reports back.</p>
            <section>
              <h3 className="mb-1 font-semibold">Runs</h3>
              {!d.runs?.length && <p className="text-[var(--muted)]">No runs yet.</p>}
              {d.runs?.map((r: any) => <div key={r.id} className="border-b border-[var(--border)] py-1.5"><span className="font-medium">{r.profile}</span> · {r.status}{r.outcome ? ` · ${r.outcome}` : ''}{r.error && <div className="text-rose-500">{r.error}</div>}{r.summary && <div className="text-[var(--muted)]">{r.summary}</div>}</div>)}
            </section>
            <section>
              <h3 className="mb-1 font-semibold">History</h3>
              {d.events?.map((e: any, i: number) => <div key={i} className="flex gap-2 py-0.5 text-xs"><span className="text-[var(--muted)]">{fmt(e.created_at)}</span><span>{e.kind}</span></div>)}
            </section>
            <section>
              <h3 className="mb-1 font-semibold">Comments</h3>
              {d.comments?.map((c: any, i: number) => <div key={i} className="border-b border-[var(--border)] py-1.5"><span className="font-medium">{c.author}</span> <span className="text-xs text-[var(--muted)]">{fmt(c.created_at)}</span><div className="whitespace-pre-wrap">{c.body}</div></div>)}
              <div className="mt-2 flex gap-2"><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5" /><button disabled={!comment.trim() || !!busy} onClick={async () => { await act('comment', 'comment', { text: comment }); setComment(''); }} className="rounded-lg bg-[var(--color-accent)] px-3 text-white disabled:opacity-50">Post</button></div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function NewTask({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { ws, agents } = useWs();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assignee, setAssignee] = useState(agents[0]?.profileName ?? '');
  const [priority, setPriority] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [clientKey] = useState(() => crypto.randomUUID().replace(/-/g, ''));
  const submit = async () => {
    setBusy(true); setErr('');
    try { await api(`/api/w/${ws.slug}/tasks`, { method: 'POST', json: { title, body: body || undefined, assignee: assignee || undefined, priority: priority ? Number(priority) : undefined, clientKey } }); onCreated(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const input = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="safe-bottom w-full max-w-lg space-y-3 rounded-t-2xl bg-[var(--bg)] p-5 md:rounded-2xl">
        <h2 className="text-lg font-semibold">New Kanban task</h2>
        <input className={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <textarea className={input} rows={4} placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex gap-2">
          <select className={input} value={assignee} onChange={(e) => setAssignee(e.target.value)}>{agents.map((a) => <option key={a.id} value={a.profileName}>{a.displayName}</option>)}</select>
          <input className={`${input} w-28`} type="number" min={0} max={10} placeholder="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
        <p className="text-xs text-[var(--muted)]">Created with <code>hermes kanban create</code>. The Hermes dispatcher decides when the assigned profile starts work.</p>
        {err && <p className="text-sm text-rose-500">{err}</p>}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-lg px-3 py-2 text-sm">Cancel</button><button disabled={!title.trim() || busy} onClick={submit} className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create task'}</button></div>
      </div>
    </div>
  );
}
