import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Agent } from '../lib/api';
import { useWs } from '../lib/workspace';
import { Avatar, STATUS_META } from '../components/Avatar';
import { PageHeader } from '../components/Shell';
import { StatusPill } from './Conversation';
import { IconBack, IconChat } from '../components/icons';

export function AgentsPage() {
  const { ws, agents } = useWs();
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Agents" subtitle={`${agents.length} Hermes profiles allowed in ${ws.name}`} />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 md:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Link key={a.id} to={`/w/${ws.slug}/agents/${a.id}`} className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 transition hover:border-[var(--color-accent)]/50 hover:shadow-sm">
              <Avatar name={a.displayName} url={a.avatarUrl} size={56} status={a.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2"><span className="truncate font-semibold">{a.displayName}</span><span className="truncate text-xs text-[var(--muted)]">@{a.profileName}</span></div>
                <div className="truncate text-sm text-[var(--muted)]">{a.role ?? 'No role set'}</div>
                <div className="mt-2"><StatusPill agent={a} /></div>
              </div>
            </Link>
          ))}
        </div>
        {!agents.length && <p className="text-[var(--muted)]">No agents are allowed in this workspace. An admin configures this in <code>hermes-control.config.yaml</code>.</p>}
        <p className="mt-6 max-w-2xl text-xs text-[var(--muted)]">
          Profiles are discovered read-only from the Hermes installation. Status comes only from real telemetry: the gateway's health endpoint and runs in progress here. Portraits and display names are presentation only; messages are always routed by the Hermes profile id shown after “@”.
        </p>
      </div>
    </div>
  );
}

interface AgentDetail extends Agent {
  recentRuns: { id: number; status: string; error: string | null; created_at: number; updated_at: number; last_event: string | null; conversation: string; kind: string }[];
  capabilities: { features?: Record<string, boolean> } | null;
}

export function AgentProfilePage() {
  const { agentId } = useParams();
  const { ws, me, conversations, refresh } = useWs();
  const nav = useNavigate();
  const [a, setA] = useState<AgentDetail | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const load = () => api<AgentDetail>(`/api/w/${ws.slug}/agents/${agentId}`).then(setA).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, [agentId, ws.slug]);
  if (err) return <div className="p-6 text-[var(--muted)]">{err}</div>;
  if (!a) return <div className="p-6 text-[var(--muted)]">Loading…</div>;
  const dm = conversations.find((c) => c.kind === 'dm' && c.dmAgentId === a.id);
  const admin = me.user.role === 'admin';
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="safe-top flex items-center gap-2 border-b border-[var(--border)] px-3 py-3 md:px-6">
        <button aria-label="Back" onClick={() => nav(`/w/${ws.slug}/agents`)} className="rounded p-1.5 hover:bg-[var(--hover)]"><IconBack /></button>
        <h1 className="font-semibold">Agent profile</h1>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 md:p-8">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
            <Avatar name={a.displayName} url={a.avatarUrl} size={120} status={a.status} />
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-semibold">{a.displayName}</h2>
              <p className="text-[var(--muted)]">{a.role ?? 'No role set'}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Hermes profile: <code>{a.profileName}</code>{!a.discovered && ' · not found in the Hermes installation'}</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <StatusPill agent={a} />
                {dm && <Link to={`/w/${ws.slug}/c/${dm.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"><IconChat className="h-4 w-4" />Message</Link>}
                {admin && <button onClick={() => setEdit((e) => !e)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--hover)]">{edit ? 'Close editor' : 'Edit profile'}</button>}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">{STATUS_META[a.status].hint}.</p>
          {edit && <AgentEditor agent={a} onSaved={() => { setEdit(false); void load(); refresh(); }} />}
          {a.description && <section className="mt-6"><h3 className="mb-1 text-sm font-semibold">About</h3><p className="text-sm whitespace-pre-wrap text-[var(--muted)]">{a.description}</p></section>}
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold">Capabilities</h3>
            {a.capabilities?.features ? (
              <div className="flex flex-wrap gap-1.5">{Object.entries(a.capabilities.features).filter(([, v]) => v).map(([k]) => <span key={k} className="rounded-full bg-[var(--hover)] px-2 py-0.5 text-xs">{k.replace(/_/g, ' ')}</span>)}</div>
            ) : <p className="text-sm text-[var(--muted)]">Reported by Hermes (<code>/v1/capabilities</code>) when the profile is online.</p>}
          </section>
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold">Recent activity in {ws.name}</h3>
            {!a.recentRuns.length && <p className="text-sm text-[var(--muted)]">No runs from Hermes Control yet.</p>}
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {a.recentRuns.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <RunBadge status={r.status} />
                  <span className="truncate">{r.kind === 'dm' ? 'Direct message' : `#${r.conversation}`}</span>
                  {r.error && <span className="truncate text-xs text-rose-500">{r.error}</span>}
                  <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">{new Date(r.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

export function RunBadge({ status }: { status: string }) {
  const c: Record<string, string> = { completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', failed: 'bg-rose-500/15 text-rose-600 dark:text-rose-300', running: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', waiting_for_approval: 'bg-violet-500/15 text-violet-600 dark:text-violet-300', unknown: 'bg-zinc-500/15 text-zinc-500' };
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${c[status] ?? 'bg-zinc-500/15 text-zinc-500'}`}>{status.replace(/_/g, ' ')}</span>;
}

function AgentEditor({ agent, onSaved }: { agent: Agent; onSaved: () => void }) {
  const [displayName, setName] = useState(agent.displayName);
  const [role, setRole] = useState(agent.role ?? '');
  const [description, setDesc] = useState(agent.description ?? '');
  const [msg, setMsg] = useState('');
  const save = async () => {
    try { await api(`/api/agents/${agent.id}`, { method: 'PATCH', json: { displayName, role: role || null, description: description || null } }); onSaved(); } catch (e) { setMsg((e as Error).message); }
  };
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append('file', f);
    try { await api(`/api/agents/${agent.id}/avatar`, { method: 'POST', body: fd }); onSaved(); } catch (e) { setMsg((e as Error).message); }
  };
  const input = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';
  return (
    <div className="mt-5 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <p className="text-xs text-[var(--muted)]">These fields change how the agent looks in Hermes Control only. They never modify the Hermes profile, its SOUL.md or its routing id.</p>
      <label className="block text-sm"><span className="mb-1 block font-medium">Display name</span><input className={input} value={displayName} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm"><span className="mb-1 block font-medium">Role</span><input className={input} value={role} onChange={(e) => setRole(e.target.value)} /></label>
      <label className="block text-sm"><span className="mb-1 block font-medium">Description</span><textarea rows={3} className={input} value={description} onChange={(e) => setDesc(e.target.value)} /></label>
      <label className="block text-sm"><span className="mb-1 block font-medium">Portrait (JPEG, PNG or WebP; square works best)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} className="text-sm" /></label>
      {msg && <p className="text-sm text-rose-500">{msg}</p>}
      <button onClick={save} className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white">Save</button>
    </div>
  );
}
