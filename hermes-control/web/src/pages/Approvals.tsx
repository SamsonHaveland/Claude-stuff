import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Approval } from '../lib/api';
import { useServerEvents } from '../lib/events';
import { useWs } from '../lib/workspace';
import { PageHeader } from '../components/Shell';
import { Avatar } from '../components/Avatar';

const CHOICE_LABEL: Record<string, string> = { once: 'Allow once', session: 'Allow for session', always: 'Always allow', deny: 'Deny' };
const STATUS_LABEL: Record<Approval['status'], string> = {
  pending: 'Waiting for your decision',
  submitted: 'Decision sent — waiting for Hermes to confirm',
  confirmed: 'Hermes recorded the decision',
  rejected: 'Hermes refused (stale or already answered elsewhere)',
  expired: 'Run ended before a decision',
  error: 'Could not reach Hermes',
};

export function ApprovalsPage() {
  const { ws, agentById } = useWs();
  const [list, setList] = useState<Approval[]>([]);
  const [all, setAll] = useState(false);
  const [err, setErr] = useState<Record<number, string>>({});
  const load = () => api<Approval[]>(`/api/w/${ws.slug}/approvals${all ? '?status=all' : ''}`).then(setList).catch(() => {});
  useEffect(() => { void load(); }, [ws.slug, all]);
  useServerEvents((e) => { if (e.type === 'approvals.changed' || e.type === 'reconnected') void load(); });
  const decide = async (a: Approval, choice: string) => {
    if (choice !== 'deny' && choice !== 'once' && !confirm(`${CHOICE_LABEL[choice]}? This widens what ${a.agent} may do without asking.`)) return;
    setErr((x) => ({ ...x, [a.id]: '' }));
    try { await api(`/api/w/${ws.slug}/approvals/${a.id}/decision`, { method: 'POST', json: { choice } }); } catch (e) { setErr((x) => ({ ...x, [a.id]: (e as Error).message })); }
    void load();
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Approvals" subtitle="Actions Hermes paused for a human decision" actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show history</label>} />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {!list.length && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
              No pending approvals. Requests appear here when an agent run started from Hermes Control hits a Hermes approval gate.
              Approvals raised in Telegram or the CLI are still answered there; Hermes does not expose a global pending-approvals list.
            </div>
          )}
          {list.map((a) => {
            const agent = agentById(a.agentId);
            return (
              <article key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={a.agent} url={agent?.avatarUrl} size={36} />
                  <div className="min-w-0 flex-1"><div className="font-semibold">{a.agent} requests approval</div><div className="text-xs text-[var(--muted)]">{new Date(a.created_at).toLocaleString()} · <Link className="hover:underline" to={`/w/${ws.slug}/c/${a.conversationId}`}>{a.kind === 'dm' ? 'Direct message' : `#${a.conversation}`}</Link></div></div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${a.status === 'pending' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300' : 'bg-[var(--hover)] text-[var(--muted)]'}`}>{a.status}</span>
                </div>
                {a.description && <p className="mt-3 text-sm">{a.description}</p>}
                {a.command && <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--hover)] p-2.5 text-xs"><code>{a.command}</code></pre>}
                {a.requestText && <p className="mt-2 text-xs text-[var(--muted)]">Context: “{a.requestText.slice(0, 240)}”</p>}
                <p className="mt-2 text-xs text-[var(--muted)]">{STATUS_LABEL[a.status]}{a.decision ? ` · decision: ${CHOICE_LABEL[a.decision] ?? a.decision}` : ''}</p>
                {err[a.id] && <p className="mt-1 text-sm text-rose-500">{err[a.id]}</p>}
                {a.status === 'pending' && ws.role === 'owner' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.choices.map((c) => <button key={c} onClick={() => decide(a, c)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${c === 'deny' ? 'border border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300' : c === 'once' ? 'bg-[var(--color-accent)] text-white' : 'border border-[var(--border)] hover:bg-[var(--hover)]'}`}>{CHOICE_LABEL[c] ?? c}</button>)}
                  </div>
                )}
                {a.status === 'pending' && ws.role !== 'owner' && <p className="mt-2 text-xs text-[var(--muted)]">Only workspace owners can decide.</p>}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
