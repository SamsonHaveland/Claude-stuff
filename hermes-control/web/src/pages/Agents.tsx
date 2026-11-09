import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type Agent } from '../lib/api';
import { useWs } from '../lib/workspace';
import { useIsMobile } from '../components/Shell';
import { Avatar, Button, IBack, IChat, LargeTitle, Row, Section, Sheet, STATUS, timeLabel } from '../components/ui';

export function AgentsPage() {
  const { ws, agents } = useWs();
  const nav = useNavigate();
  return (
    <div className="scroll h-full flex-1 bg-[var(--bg-grouped)]">
      <LargeTitle title="Agents" leading={<button onClick={() => nav(`/w/${ws.slug}/settings`)} className="press flex items-center text-[17px] text-[var(--blue)]"><IBack size={24} />Settings</button>} />
      <div className="mx-auto max-w-2xl px-4 pb-10 md:px-8">
        <Section footer="Names and photos only change how agents look here. They never change the agent in Hermes.">
          {agents.map((a) => (
            <Row key={a.id} chevron onClick={() => nav(`/w/${ws.slug}/agents/${a.id}`)}>
              <Avatar name={a.displayName} url={a.avatarUrl} size={44} status={a.status} />
              <span className="flex flex-col"><span>{a.displayName}</span><span className="t-foot text-[var(--label-2)]">{a.role ?? STATUS[a.status].label}</span></span>
            </Row>
          ))}
        </Section>
      </div>
    </div>
  );
}

interface AgentDetail extends Agent {
  recentRuns: { id: number; status: string; error: string | null; created_at: number; conversation: string; kind: string }[];
  capabilities: { features?: Record<string, boolean> } | null;
}
const RUN_WORD: Record<string, string> = { completed: 'Replied', failed: 'Didn’t reply', cancelled: 'Stopped', running: 'Working', waiting_for_approval: 'Asked you first', interrupted: 'Interrupted', unknown: 'Unknown' };

export function AgentProfilePage() {
  const { agentId } = useParams();
  const { ws, me, conversations, refresh } = useWs();
  const nav = useNavigate();
  const mobile = useIsMobile();
  const [a, setA] = useState<AgentDetail | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const load = () => api<AgentDetail>(`/api/w/${ws.slug}/agents/${agentId}`).then(setA).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, [agentId, ws.slug]);
  const dm = a && conversations.find((c) => c.kind === 'dm' && c.dmAgentId === a.id);
  const s = a ? STATUS[a.status] : null;

  return (
    <div className="scroll h-full flex-1 bg-[var(--bg-grouped)]">
      <header className="material-bar safe-top sticky top-0 z-20 flex items-center justify-between px-2 py-1.5">
        <button onClick={() => (history.length > 1 ? nav(-1) : nav(`/w/${ws.slug}`))} className="press flex h-11 items-center text-[17px] text-[var(--blue)]"><IBack size={26} />Back</button>
        {me.user.role === 'admin' && a && <button onClick={() => setEdit(true)} className="press h-11 px-3 text-[17px] text-[var(--blue)]">Edit</button>}
      </header>
      {err && <p className="p-6 text-center text-[var(--label-2)]">{err}</p>}
      {a && s && (
        <div className="mx-auto max-w-xl px-4 pb-12">
          <div className="flex flex-col items-center pt-2 pb-6 text-center">
            <Avatar name={a.displayName} url={a.avatarUrl} size={mobile ? 120 : 140} />
            <h1 className="t-large mt-3">{a.displayName}</h1>
            {a.role && <p className="t-sub text-[var(--label-2)]">{a.role}</p>}
            <p className="t-foot mt-2 flex items-center gap-1.5" title={s.hint}>
              <span className="h-2 w-2 rounded-full" style={{ background: s.color ?? 'var(--label-3)' }} />{s.label}{a.activeRuns > 0 ? ` · ${a.activeRuns} in progress` : ''}
            </p>
            {dm && <Button size="lg" className="mt-5 w-56" onClick={() => nav(`/w/${ws.slug}/c/${dm.id}`)}><IChat size={20} />Message</Button>}
          </div>
          {(a.description) && <Section title="About"><p className="t-sub px-4 py-3 whitespace-pre-wrap">{a.description}</p></Section>}
          <Section title="Recent" footer={`Only conversations started in Hermes Control are shown.`}>
            {a.recentRuns.length ? a.recentRuns.slice(0, 8).map((r) => (
              <Row key={r.id}>
                <span className="flex flex-1 flex-col"><span className="t-sub">{RUN_WORD[r.status] ?? r.status}</span><span className="t-cap text-[var(--label-2)]">{r.kind === 'dm' ? 'Direct chat' : `#${r.conversation}`}</span></span>
                <span className="t-foot text-[var(--label-2)]">{timeLabel(r.created_at)}</span>
              </Row>
            )) : <Row><span className="text-[var(--label-2)]">Nothing yet</span></Row>}
          </Section>
          <Section title="Technical" footer={s.hint}>
            <Row><span className="flex-1">Hermes profile</span><code className="t-foot text-[var(--label-2)]">{a.profileName}</code></Row>
            <Row><span className="flex-1">Found in Hermes</span><span className="text-[var(--label-2)]">{a.discovered ? 'Yes' : 'No'}</span></Row>
          </Section>
        </div>
      )}
      {edit && a && <EditAgent agent={a} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void load(); refresh(); }} />}
    </div>
  );
}

function EditAgent({ agent, onClose, onSaved }: { agent: Agent; onClose: () => void; onSaved: () => void }) {
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
  const field = 'h-12 w-full bg-transparent px-4 outline-none';
  return (
    <Sheet title="Edit Profile" onClose={onClose} actions={<Button size="lg" className="w-full" onClick={save}>Save</Button>}>
      <div className="mb-5 flex flex-col items-center">
        <Avatar name={displayName || agent.displayName} url={agent.avatarUrl} size={96} />
        <label className="press t-sub mt-2 cursor-pointer font-semibold text-[var(--blue)]">
          Change Photo
          <input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </label>
      </div>
      <Section title="Name"><input className={field} value={displayName} onChange={(e) => setName(e.target.value)} /></Section>
      <Section title="Job"><input className={field} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Chief of Staff" /></Section>
      <Section title="About" footer="This only changes how the agent looks here, not how it behaves in Hermes.">
        <textarea rows={3} className="w-full resize-none bg-transparent px-4 py-3 outline-none" value={description} onChange={(e) => setDesc(e.target.value)} />
      </Section>
      {msg && <p className="t-sub text-[var(--red)]">{msg}</p>}
    </Sheet>
  );
}
