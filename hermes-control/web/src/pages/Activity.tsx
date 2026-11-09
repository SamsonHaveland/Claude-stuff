import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useServerEvents } from '../lib/events';
import { useWs } from '../lib/workspace';
import { PageHeader } from '../components/Shell';
import { Avatar } from '../components/Avatar';

interface Row { seq?: number; event: string; created_at: number; runId: number; agent: string; agentId: number; conversation: string; kind: string; tool: string | null; preview: string | null; error: unknown }

export function ActivityPage() {
  const { ws, agentById } = useWs();
  const [rows, setRows] = useState<Row[]>([]);
  const load = () => api<Row[]>(`/api/w/${ws.slug}/activity`).then(setRows).catch(() => {});
  useEffect(() => { void load(); }, [ws.slug]);
  useServerEvents((e) => { if (e.type === 'activity' || e.type === 'reconnected') void load(); });
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Activity" subtitle="Run and tool events reported by Hermes for runs started here" />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 md:p-6">
        <ol className="mx-auto max-w-3xl space-y-1">
          {!rows.length && <p className="text-sm text-[var(--muted)]">No activity yet.</p>}
          {rows.map((r, i) => {
            const a = agentById(r.agentId);
            return (
              <li key={i} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-[var(--hover)]">
                <Avatar name={r.agent} url={a?.avatarUrl} size={28} />
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{r.agent}</span> <span className="text-[var(--muted)]">{r.event}</span>
                  {r.tool && <> · <code className="text-xs">{r.tool}</code></>}
                  {r.error ? <span className="text-rose-500"> · error</span> : null}
                  <span className="text-[var(--muted)]"> in {r.kind === 'dm' ? 'DM' : `#${r.conversation}`}</span>
                  {r.preview && <div className="truncate text-xs text-[var(--muted)]">{r.preview}</div>}
                </div>
                <time className="shrink-0 text-xs text-[var(--muted)]">{new Date(r.created_at).toLocaleTimeString()}</time>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
