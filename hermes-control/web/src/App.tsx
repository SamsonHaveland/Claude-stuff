import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { api, ApiError, setCsrf, type Me } from './lib/api';
import { connectEvents } from './lib/events';
import { WorkspaceProvider } from './lib/workspace';
import { Login } from './pages/Login';
import { Shell } from './components/Shell';
import { ConversationPage } from './pages/Conversation';
import { AgentsPage, AgentProfilePage } from './pages/Agents';
import { TasksPage } from './pages/Tasks';
import { ApprovalsPage } from './pages/Approvals';
import { ActivityPage } from './pages/Activity';
import { SettingsPage } from './pages/Settings';
import { HomeRedirect } from './pages/Home';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const load = () => api<Me>('/api/me').then((m) => { setCsrf(m.csrf); setMe(m); connectEvents(); }).catch((e) => { if (e instanceof ApiError && e.status === 401) setMe(null); else setMe(null); });
  useEffect(() => { load(); }, []);

  if (me === undefined) return <div className="h-full bg-[var(--bg-grouped)]" />;
  if (me === null) return <Login onLogin={load} />;

  const first = me.workspaces[0]?.slug;
  return (
    <Routes>
      <Route path="/" element={first ? <Navigate to={`/w/${first}`} replace /> : <NoWorkspace />} />
      <Route path="/w/:ws/*" element={<WorkspaceRoutes me={me} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function WorkspaceRoutes({ me }: { me: Me }) {
  const { ws } = useParams();
  if (!me.workspaces.some((w) => w.slug === ws)) return <Navigate to="/" replace />;
  return (
    <WorkspaceProvider me={me} slug={ws!}>
      <Shell>
        <Routes>
          <Route index element={<HomeRedirect />} />
          <Route path="c/:convId" element={<ConversationPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:agentId" element={<AgentProfilePage />} />
          <Route path="todos" element={<TasksPage />} />
          <Route path="needs-you" element={<ApprovalsPage />} />
          <Route path="tasks" element={<Navigate to="../todos" replace />} />
          <Route path="approvals" element={<Navigate to="../needs-you" replace />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </Shell>
    </WorkspaceProvider>
  );
}

function NoWorkspace() {
  return <div className="p-8 text-center text-[var(--label-2)]">Your account isn’t in any workspace yet. Ask the owner to add you.</div>;
}
