import { Navigate } from 'react-router-dom';
import { useWs } from '../lib/workspace';
import { Sidebar, useIsMobile } from '../components/Shell';

/** Desktop: open the first channel. Mobile: the conversation list is the home screen. */
export function HomeRedirect() {
  const { ws, conversations } = useWs();
  const mobile = useIsMobile();
  if (mobile) return <Sidebar mobile />;
  const first = conversations.find((c) => c.kind === 'channel') ?? conversations[0];
  if (!first) return <div className="flex flex-1 items-center justify-center text-[var(--muted)]">No conversations yet.</div>;
  return <Navigate to={`/w/${ws.slug}/c/${first.id}`} replace />;
}
