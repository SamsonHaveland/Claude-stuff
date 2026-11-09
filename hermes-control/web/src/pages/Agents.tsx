import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type Agent } from '../lib/api';
import { useWs } from '../lib/workspace';
import { useIsMobile } from '../components/Shell';
import { Avatar, Button, IBack, IChat, LargeTitle, Row, Section, Sheet, STATUS, timeLabel } from '../components/ui';

export function AgentsPage() {
  const { ws, agents, me } = useWs();
  const nav = useNavigate();
  const [pending, setPending] = useState(() => loadPending());
  const [msg, setMsg] = useState('');
  const designAll = async () => {
    if (!confirm(`Ask all ${agents.length} agents to design their own look?\n\nEach one creates a portrait with its image tool (about $0.03–0.06 each on FAL.ai, or included with a Nous Portal subscription). You'll approve each result before anything changes.`)) return;
    setMsg('');
    for (const a of agents) {
      try { const r = await api<{ runId: number }>(`/api/w/${ws.slug}/agents/${a.id}/character`, { method: 'POST' }); savePending(a.id, r.runId); } catch (e) { setMsg((e as Error).message); }
    }
    setPending(loadPending());
  };
  return (
    <div className="scroll h-full flex-1 bg-[var(--bg-grouped)]">
      <LargeTitle title="Agents" leading={<button onClick={() => nav(`/w/${ws.slug}/settings`)} className="press flex items-center text-[17px] text-[var(--blue)]"><IBack size={24} />Settings</button>} />
      <div className="mx-auto max-w-2xl px-4 pb-10 md:px-8">
        {me.user.role === 'admin' && agents.length > 0 && (
          <div className="mb-6 rounded-[18px] bg-[var(--cell)] p-5 text-center">
            <p className="t-headline">Let your agents design their own look</p>
            <p className="t-foot mt-1 text-[var(--label-2)]">Each agent picks a name, job title and bio, and makes a portrait of itself. You approve every one.</p>
            <Button size="lg" className="mt-4 w-full" onClick={designAll}>Design Everyone’s Look</Button>
            {msg && <p className="t-foot mt-2 text-[var(--red)]">{msg}</p>}
          </div>
        )}
        <Section footer="Names and photos only change how agents look here. They never change the agent in Hermes.">
          {agents.map((a) => (
            <Row key={a.id} chevron onClick={() => nav(`/w/${ws.slug}/agents/${a.id}`)}>
              <Avatar name={a.displayName} url={a.avatarUrl} size={44} status={a.status} />
              <span className="flex flex-1 flex-col"><span>{a.displayName}</span><span className="t-foot text-[var(--label-2)]">{a.role ?? STATUS[a.status].label}</span></span>
              {pending[a.id] && <span className="t-foot rounded-full bg-[color-mix(in_srgb,var(--blue)_14%,transparent)] px-2 py-0.5 font-semibold text-[var(--blue)]">New look</span>}
            </Row>
          ))}
        </Section>
      </div>
    </div>
  );
}

/* Which agents have a character proposal in progress (per browser; the server holds the truth). */
const PENDING_KEY = 'hc-character-runs';
function loadPending(): Record<number, number> { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}'); } catch { return {}; } }
function savePending(agentId: number, runId: number | null) {
  const m = loadPending(); if (runId) m[agentId] = runId; else delete m[agentId];
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

interface Proposal { name: string | null; role: string | null; bio: string | null; image: string | null }

function CharacterCard({ agent, wsSlug, onApplied }: { agent: Agent; wsSlug: string; onApplied: () => void }) {
  const [runId, setRunId] = useState<number | null>(() => loadPending()[agent.id] ?? null);
  const [state, setState] = useState<{ status: string; done: boolean; error: string | null; proposal: Proposal | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const poll = useCallback(async () => {
    if (!runId) return;
    try { setState(await api(`/api/w/${wsSlug}/agents/${agent.id}/character/${runId}`)); } catch { setRunId(null); savePending(agent.id, null); }
  }, [runId, wsSlug, agent.id]);
  useEffect(() => { void poll(); if (!runId) return; const t = setInterval(() => { if (!state?.done) void poll(); }, 2500); return () => clearInterval(t); }, [poll, runId, state?.done]);

  const start = async () => {
    if (!confirm(`Ask ${agent.displayName} to design their own look?\n\nThey'll create one portrait with their image tool (about $0.03–0.06 on FAL.ai, or included with a Nous Portal subscription). Nothing changes until you tap Use This.`)) return;
    setBusy(true); setNote(''); setState(null);
    try { const r = await api<{ runId: number }>(`/api/w/${wsSlug}/agents/${agent.id}/character`, { method: 'POST' }); savePending(agent.id, r.runId); setRunId(r.runId); }
    catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setNote('');
    try {
      const r = await api<{ pictureError: string | null }>(`/api/w/${wsSlug}/agents/${agent.id}/character/${runId}/apply`, { method: 'POST' });
      savePending(agent.id, null); setRunId(null); setState(null);
      if (r.pictureError) setNote(`Saved the name and bio, but not the picture: ${r.pictureError}`);
      onApplied();
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  const dismiss = () => { savePending(agent.id, null); setRunId(null); setState(null); };
  const p = state?.proposal;
  const [imgOk, setImgOk] = useState(true);
  const imgSrc = p?.image && imgOk ? `/api/w/${wsSlug}/agents/${agent.id}/character/${runId}/picture` : null;

  if (!runId) return (
    <Section footer="Only changes how this agent looks in Hermes Control. Their Hermes profile, personality and memory stay exactly the same.">
      <Row onClick={start}><span className="flex-1 text-[var(--blue)]">{busy ? 'Asking…' : `Let ${agent.displayName} Design Their Look`}</span></Row>
      {note && <p className="t-foot px-4 pb-3 text-[var(--orange)]">{note}</p>}
    </Section>
  );
  return (
    <section className="mb-7 rounded-[18px] bg-[var(--cell)] p-5">
      {!state?.done ? (
        <div className="flex flex-col items-center py-4 text-center">
          <span className="typing"><span /><span /><span /></span>
          <p className="t-headline mt-3">{agent.displayName} is designing their look…</p>
          <p className="t-foot mt-1 text-[var(--label-2)]">This can take a minute. You can leave this page; it carries on.</p>
        </div>
      ) : !p ? (
        <div className="text-center">
          <p className="t-headline">{state.status === 'completed' ? `${agent.displayName} replied, but without a character card.` : `${agent.displayName} couldn’t finish.`}</p>
          {state.error && <p className="t-foot mt-1 text-[var(--label-2)]">{state.error}</p>}
          <p className="t-foot mt-1 text-[var(--label-2)]">You can read the reply in your chat with them.</p>
          <div className="mt-4 grid grid-cols-2 gap-3"><Button variant="tinted" onClick={dismiss}>Close</Button><Button onClick={() => { dismiss(); void start(); }}>Try Again</Button></div>
        </div>
      ) : (
        <>
          <p className="t-foot text-center font-semibold text-[var(--label-2)] uppercase">{agent.displayName} suggests</p>
          <div className="mt-3 flex flex-col items-center text-center">
            {imgSrc ? <img src={imgSrc} onError={() => setImgOk(false)} alt="" className="h-36 w-36 rounded-full object-cover shadow-[var(--shadow)]" /> : <Avatar name={p.name ?? agent.displayName} size={120} />}
            {!imgSrc && <p className="t-cap mt-2 text-[var(--label-2)]">{p.image ? 'The picture couldn’t be loaded safely, so only the name and bio would be used.' : 'No picture was created.'}</p>}
            <h3 className="t-title mt-3">{p.name ?? agent.displayName}</h3>
            {p.role && <p className="t-sub text-[var(--label-2)]">{p.role}</p>}
            {p.bio && <p className="t-sub mt-3 max-w-md">{p.bio}</p>}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button variant="tinted" size="lg" disabled={busy} onClick={() => { dismiss(); void start(); }}>Try Again</Button>
            <Button size="lg" disabled={busy} onClick={apply}>{busy ? 'Saving…' : 'Use This'}</Button>
          </div>
          <button onClick={dismiss} className="press t-foot mt-3 w-full text-center text-[var(--label-2)]">Keep Current Look</button>
        </>
      )}
      {note && <p className="t-foot mt-3 text-center text-[var(--orange)]">{note}</p>}
    </section>
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
          {me.user.role === 'admin' && <CharacterCard agent={a} wsSlug={ws.slug} onApplied={() => { void load(); refresh(); }} />}
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
