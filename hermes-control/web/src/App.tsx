import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { api, ApiError, setCsrf, type Me } from './lib/api';
import { connectEvents, disconnectEvents } from './lib/events';
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

  if (me === undefined) return <div className="flex h-full items-center justify-center text-[var(--muted)]">Loading…</div>;
  if (me === null) return <Login onLogin={load} />;

  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); disconnectEvents(); setMe(null); };
  const first = me.workspaces[0]?.slug;
  return (
    <Routes>
      <Route path="/" element={first ? <Navigate to={`/w/${first}`} replace /> : <NoWorkspace />} />
      <Route path="/w/:ws/*" element={<WorkspaceRoutes me={me} onLogout={logout} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function WorkspaceRoutes({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { ws } = useParams();
  if (!me.workspaces.some((w) => w.slug === ws)) return <Navigate to="/" replace />;
  return (
    <WorkspaceProvider me={me} slug={ws!}>
      <Shell onLogout={onLogout}>
        <Routes>
          <Route index element={<HomeRedirect />} />
          <Route path="c/:convId" element={<ConversationPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:agentId" element={<AgentProfilePage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </Shell>
    </WorkspaceProvider>
  );
}

function NoWorkspace() {
  return <div className="p-8 text-[var(--muted)]">Your account has no workspace yet. An admin can grant one with <code>npm run user:create</code>.</div>;
}
