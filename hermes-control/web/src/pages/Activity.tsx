import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useServerEvents } from '../lib/events';
import { useWs } from '../lib/workspace';
import { Avatar, EmptyState, IBack, IClock, LargeTitle, Row, Section, timeLabel } from '../components/ui';

interface Ev { event: string; created_at: number; agent: string; agentId: number; conversation: string; kind: string; tool: string | null; error: unknown }
const WORD: Record<string, string> = {
  'run.started': 'started working', 'run.queued': 'is queued', 'run.completed': 'finished', 'run.failed': 'ran into a problem', 'run.cancelled': 'was stopped',
  'tool.started': 'is using', 'tool.completed': 'used', 'tool.failed': 'couldn’t use', 'approval.request': 'asked for your OK', 'approval.responded': 'got your answer',
  'subagent.start': 'asked a helper', 'subagent.complete': 'heard back from a helper',
};

export function ActivityPage() {
  const { ws, agentById } = useWs();
  const nav = useNavigate();
  const [rows, setRows] = useState<Ev[] | null>(null);
  const load = () => api<Ev[]>(`/api/w/${ws.slug}/activity`).then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, [ws.slug]);
  useServerEvents((e) => { if (e.type === 'activity' || e.type === 'reconnected') void load(); });
  return (
    <div className="scroll h-full flex-1 bg-[var(--bg-grouped)]">
      <LargeTitle title="Activity Log" subtitle="What your agents did, as reported by Hermes." leading={<button onClick={() => nav(`/w/${ws.slug}/settings`)} className="press flex items-center text-[17px] text-[var(--blue)]"><IBack size={24} />Settings</button>} />
      <div className="mx-auto max-w-2xl px-4 pb-10 md:px-8">
        {rows && !rows.length && <EmptyState icon={<IClock size={56} />} title="Nothing yet" body="Activity appears once you start chatting with your agents." />}
        {!!rows?.length && (
          <Section>
            {rows.map((r, i) => (
              <Row key={i}>
                <Avatar name={r.agent} url={agentById(r.agentId)?.avatarUrl} size={30} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="t-sub truncate"><b>{r.agent}</b> {WORD[r.event] ?? r.event}{r.tool ? <> <code className="t-foot">{r.tool}</code></> : null}{r.error ? <span className="text-[var(--red)]"> (error)</span> : null}</span>
                  <span className="t-cap text-[var(--label-2)]">{r.kind === 'dm' ? 'Direct chat' : `#${r.conversation}`}</span>
                </span>
                <span className="t-foot text-[var(--label-2)]">{timeLabel(r.created_at)}</span>
              </Row>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
