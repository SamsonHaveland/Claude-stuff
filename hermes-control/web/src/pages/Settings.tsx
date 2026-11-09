import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { applyTheme, getTheme, useWs, type Theme } from '../lib/workspace';
import { PageHeader, useIsMobile } from '../components/Shell';
import { IconPulse, IconUsers } from '../components/icons';

interface SystemStatus {
  hermesMode: string;
  hermesHome: string;
  profiles: { profile: string; discovered: boolean; keyEnv: string; keyPresent: boolean; baseUrl: string; reachable: boolean | null }[];
  telegramMirror: { profile: string; enabled: boolean; workspace: string; status: { ok: boolean; at: number; error?: string; sessions?: number } | null }[];
  openRuns: number;
  sseClients: number;
}

export function SettingsPage() {
  const { me, ws } = useWs();
  const mobile = useIsMobile();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [sys, setSys] = useState<SystemStatus | null>(null);
  useEffect(() => { if (me.user.role === 'admin') api<SystemStatus>('/api/system/status').then(setSys).catch(() => {}); }, [me.user.role]);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Settings" />
      <div className="scroll-thin flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {mobile && (
            <section className="grid grid-cols-2 gap-2">
              <Link to={`/w/${ws.slug}/activity`} className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3"><IconPulse />Activity</Link>
              <Link to={`/w/${ws.slug}/agents`} className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3"><IconUsers />Agents</Link>
            </section>
          )}
          <section>
            <h2 className="mb-2 font-semibold">Appearance</h2>
            <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
              {(['system', 'light', 'dark'] as Theme[]).map((t) => <button key={t} onClick={() => { setTheme(t); applyTheme(t); }} className={`rounded-md px-3 py-1.5 text-sm capitalize ${theme === t ? 'bg-[var(--color-accent)] text-white' : ''}`}>{t}</button>)}
            </div>
          </section>
          <section>
            <h2 className="mb-1 font-semibold">Account</h2>
            <p className="text-sm text-[var(--muted)]">{me.user.displayName} (@{me.user.username}) · {me.user.role} · {ws.name}: {ws.role}</p>
          </section>
          {sys && (
            <section className="space-y-3">
              <h2 className="font-semibold">Hermes connection</h2>
              <p className="text-sm text-[var(--muted)]">Mode: <b>{sys.hermesMode}</b> · Hermes home (read-only discovery): <code>{sys.hermesHome}</code> · open runs: {sys.openRuns} · live clients: {sys.sseClients}</p>
              <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--panel)] text-xs text-[var(--muted)]"><tr><th className="px-3 py-2">Profile</th><th className="px-3 py-2">Discovered</th><th className="px-3 py-2">API key env</th><th className="px-3 py-2">Gateway</th><th className="px-3 py-2">URL</th></tr></thead>
                  <tbody>
                    {sys.profiles.map((p) => (
                      <tr key={p.profile} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2 font-medium">{p.profile}</td>
                        <td className="px-3 py-2">{p.discovered ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2"><code className="text-xs">{p.keyEnv}</code> {p.keyPresent ? '✓' : '— missing'}</td>
                        <td className="px-3 py-2">{p.reachable === null ? '—' : p.reachable ? 'reachable' : 'unreachable'}</td>
                        <td className="px-3 py-2"><code className="text-xs">{p.baseUrl}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-[var(--muted)]">Key values are never shown or sent to the browser. Profiles, workspaces and channels are configured in <code>hermes-control.config.yaml</code>; keys in the server's environment.</p>
              <h3 className="pt-2 font-semibold">Telegram mirror</h3>
              {!sys.telegramMirror.length && <p className="text-sm text-[var(--muted)]">Not configured.</p>}
              {sys.telegramMirror.map((t) => (
                <p key={t.profile + t.workspace} className="text-sm">
                  <b>{t.profile}</b> → {t.workspace}: {!t.enabled ? 'disabled' : !t.status ? 'not polled yet' : t.status.ok ? `OK · ${t.status.sessions} Telegram session(s) · ${new Date(t.status.at).toLocaleTimeString()}` : <span className="text-rose-500">failing: {t.status.error}</span>}
                </p>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
