import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Approval } from '../lib/api';
import { useServerEvents } from '../lib/events';
import { useWs } from '../lib/workspace';
import { Avatar, Button, EmptyState, IHand, LargeTitle, timeLabel } from '../components/ui';

const STATUS_TEXT: Record<Approval['status'], { text: string; tone: string }> = {
  pending: { text: 'Waiting for you', tone: 'var(--orange)' },
  submitted: { text: 'Sending your answer…', tone: 'var(--label-2)' },
  confirmed: { text: 'Done. Hermes got your answer.', tone: 'var(--green)' },
  rejected: { text: 'Too late: this was already answered or has ended.', tone: 'var(--label-2)' },
  expired: { text: 'This request ended before you answered.', tone: 'var(--label-2)' },
  error: { text: 'Couldn’t reach Hermes. Try again.', tone: 'var(--red)' },
};
const MORE: Record<string, string> = { session: 'Allow for this whole chat', always: 'Always allow this' };

export function ApprovalsPage() {
  const { ws, agentById } = useWs();
  const [list, setList] = useState<Approval[] | null>(null);
  const [tab, setTab] = useState<'now' | 'earlier'>('now');
  const [err, setErr] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const load = () => api<Approval[]>(`/api/w/${ws.slug}/approvals${tab === 'earlier' ? '?status=all' : ''}`).then((l) => setList(tab === 'earlier' ? l.filter((a) => a.status !== 'pending') : l)).catch(() => setList([]));
  useEffect(() => { setList(null); void load(); }, [ws.slug, tab]);
  useServerEvents((e) => { if (e.type === 'approvals.changed' || e.type === 'reconnected') void load(); });

  const decide = async (a: Approval, choice: string) => {
    if (MORE[choice] && !confirm(`${MORE[choice]}?\n\n${a.agent} won’t ask again for this kind of action.`)) return;
    setBusy(a.id); setErr((x) => ({ ...x, [a.id]: '' }));
    try { await api(`/api/w/${ws.slug}/approvals/${a.id}/decision`, { method: 'POST', json: { choice } }); } catch (e) { setErr((x) => ({ ...x, [a.id]: (e as Error).message })); }
    setBusy(null); void load();
  };

  return (
    <div className="scroll h-full flex-1 bg-[var(--bg-grouped)]">
      <LargeTitle title="Needs You" subtitle="Your agents ask before doing anything important." />
      <div className="mx-auto max-w-2xl px-4 pb-10 md:px-8">
        <div role="tablist" className="mb-5 grid grid-cols-2 rounded-[9px] bg-[var(--fill)] p-0.5">
          {(['now', 'earlier'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`press rounded-[7px] py-1.5 text-[14px] font-semibold ${tab === t ? 'bg-[var(--cell)] shadow-sm' : 'text-[var(--label-2)]'}`}>{t === 'now' ? 'Waiting' : 'Earlier'}</button>
          ))}
        </div>
        {list && !list.length && (
          <EmptyState icon={<IHand size={56} />} title={tab === 'now' ? 'Nothing needs you' : 'No earlier answers'} body={tab === 'now' ? 'When an agent wants to do something important, like send an email, it will ask you here first.' : undefined} />
        )}
        <div className="space-y-4">
          {list?.map((a) => {
            const agent = agentById(a.agentId);
            const s = STATUS_TEXT[a.status];
            const extra = a.choices.filter((c) => MORE[c]);
            return (
              <article key={a.id} className="rounded-[18px] bg-[var(--cell)] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                <div className="flex items-center gap-3">
                  <Avatar name={a.agent} url={agent?.avatarUrl} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="t-headline">{a.agent} wants to:</p>
                    <p className="t-foot text-[var(--label-2)]">{timeLabel(a.created_at)} · <Link className="text-[var(--blue)]" to={`/w/${ws.slug}/c/${a.conversationId}`}>Open chat</Link></p>
                  </div>
                </div>
                <p className="mt-3 text-[19px] leading-snug font-medium">{a.description || 'Run an action that needs permission'}</p>
                {a.command && (
                  <details className="mt-2">
                    <summary className="t-foot cursor-pointer text-[var(--label-2)]">Show the exact action</summary>
                    <pre className="t-foot mt-1.5 overflow-x-auto rounded-[10px] bg-[var(--fill)] p-3"><code>{a.command}</code></pre>
                  </details>
                )}
                {a.requestText && <p className="t-foot mt-2 text-[var(--label-2)]">Because you asked: “{a.requestText.slice(0, 160)}”</p>}
                {a.status === 'pending' && ws.role === 'owner' ? (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <Button variant="destructive" size="lg" disabled={busy === a.id} onClick={() => decide(a, 'deny')}>Don’t Allow</Button>
                      <Button size="lg" disabled={busy === a.id} onClick={() => decide(a, 'once')}>Allow</Button>
                    </div>
                    {extra.length > 0 && <div className="mt-2 flex justify-center gap-4">{extra.map((c) => <button key={c} onClick={() => decide(a, c)} className="press t-foot text-[var(--blue)]">{MORE[c]}</button>)}</div>}
                  </>
                ) : (
                  <p className="t-sub mt-4 font-medium" style={{ color: s.tone }}>{a.status === 'pending' ? 'Only a workspace owner can answer this.' : s.text}{a.decision ? ` (You chose: ${a.decision === 'once' ? 'Allow' : a.decision === 'deny' ? 'Don’t Allow' : MORE[a.decision] ?? a.decision})` : ''}</p>
                )}
                {err[a.id] && <p className="t-foot mt-2 text-[var(--red)]">{err[a.id]}</p>}
              </article>
            );
          })}
        </div>
        <p className="t-foot mt-8 text-center text-[var(--label-2)]">Requests made in Telegram are answered in Telegram.</p>
      </div>
    </div>
  );
}
