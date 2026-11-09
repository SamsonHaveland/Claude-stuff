import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { disconnectEvents } from '../lib/events';
import { applyTheme, getTheme, useWs, type Theme } from '../lib/workspace';
import { WorkspaceSwitcher } from '../components/Shell';
import { Avatar, LargeTitle, Row, Section } from '../components/ui';

interface SystemStatus {
  hermesMode: string;
  profiles: { profile: string; discovered: boolean; keyPresent: boolean; reachable: boolean | null }[];
  telegramMirror: { profile: string; enabled: boolean; workspace: string; status: { ok: boolean; at: number; error?: string } | null }[];
  autoUpdate: { result: string; note?: string; version_before?: string; version_after?: string; finished_at?: string } | null;
}

export function SettingsPage() {
  const { me, ws, agents } = useWs();
  const nav = useNavigate();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [sys, setSys] = useState<SystemStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  useEffect(() => { if (me.user.role === 'admin') api<SystemStatus>('/api/system/status').then(setSys).catch(() => {}); }, [me.user.role]);
  const signOut = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); disconnectEvents(); location.href = '/'; };
  const connected = (p: string) => sys?.profiles.find((x) => x.profile === p);

  return (
    <div className="scroll h-full flex-1 bg-[var(--bg-grouped)]">
      <LargeTitle title="Settings" />
      <div className="mx-auto max-w-2xl px-4 pb-12 md:px-8">
        <Section>
          <Row>
            <Avatar name={me.user.displayName} size={56} />
            <span className="flex flex-col"><span className="t-title">{me.user.displayName}</span><span className="t-foot text-[var(--label-2)]">@{me.user.username}</span></span>
          </Row>
        </Section>

        <Section title="Appearance">
          <div className="p-2">
            <div className="grid grid-cols-3 rounded-[9px] bg-[var(--fill)] p-0.5">
              {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                <button key={t} onClick={() => { setTheme(t); applyTheme(t); }} className={`press rounded-[7px] py-1.5 text-[14px] font-semibold ${theme === t ? 'bg-[var(--cell)] shadow-sm' : 'text-[var(--label-2)]'}`}>{t === 'system' ? 'Automatic' : t === 'light' ? 'Light' : 'Dark'}</button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Workspace">
          <Row chevron={me.workspaces.length > 1} onClick={me.workspaces.length > 1 ? () => setSwitching(true) : undefined}><span className="flex-1">Current</span><span className="text-[var(--label-2)]">{ws.name}</span></Row>
          <Row chevron onClick={() => nav(`/w/${ws.slug}/agents`)}><span className="flex-1">Agents</span><span className="text-[var(--label-2)]">{agents.length}</span></Row>
          <Row chevron onClick={() => nav(`/w/${ws.slug}/activity`)}><span className="flex-1">Activity Log</span></Row>
        </Section>

        {sys && (
          <>
            <Section title="Connection to Hermes" footer={sys.hermesMode === 'live' ? 'Agents marked “Not connected yet” need their access key set up.' : 'Hermes Control isn’t talking to Hermes yet, so messages are saved but not sent.'}>
              {agents.map((a) => {
                const c = connected(a.profileName);
                const label = sys.hermesMode !== 'live' || !c?.keyPresent ? 'Not connected yet' : c.reachable ? 'Connected' : 'Can’t reach';
                const color = label === 'Connected' ? 'var(--green)' : label === 'Can’t reach' ? 'var(--red)' : 'var(--label-3)';
                return (
                  <Row key={a.id}>
                    <Avatar name={a.displayName} url={a.avatarUrl} size={30} />
                    <span className="flex-1">{a.displayName}</span>
                    <span className="t-sub flex items-center gap-1.5 text-[var(--label-2)]"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>
                  </Row>
                );
              })}
            </Section>
            <Section title="Updates">
              <Row>
                <span className="flex flex-1 flex-col">
                  <span>Hermes auto-update</span>
                  <span className="t-foot text-[var(--label-2)]">{sys.autoUpdate ? `${sys.autoUpdate.result.replace(/_/g, ' ')}${sys.autoUpdate.finished_at ? ' · ' + new Date(sys.autoUpdate.finished_at).toLocaleString() : ''}` : 'Not set up yet'}</span>
                  {sys.autoUpdate?.note && <span className="t-cap text-[var(--label-2)]">{sys.autoUpdate.note}</span>}
                </span>
                {sys.autoUpdate && <span className="h-2.5 w-2.5 rounded-full" style={{ background: sys.autoUpdate.result === 'failed' ? 'var(--red)' : sys.autoUpdate.result.includes('warning') ? 'var(--orange)' : 'var(--green)' }} />}
              </Row>
            </Section>
            {sys.telegramMirror.length > 0 && (
              <Section title="Telegram copy">
                {sys.telegramMirror.map((t) => (
                  <Row key={t.profile + t.workspace}>
                    <span className="flex-1">{agents.find((a) => a.profileName === t.profile)?.displayName ?? t.profile}</span>
                    <span className="t-sub text-[var(--label-2)]">{!t.enabled ? 'Off' : !t.status ? 'Starting…' : t.status.ok ? 'On' : 'Having trouble'}</span>
                  </Row>
                ))}
              </Section>
            )}
          </>
        )}

        <Section>
          <Row onClick={signOut}><span className="flex-1 text-center text-[var(--red)]">Sign Out</span></Row>
        </Section>
        <p className="t-cap text-center text-[var(--label-3)]">Hermes Control · private to you</p>
      </div>
      {switching && <WorkspaceSwitcher onClose={() => setSwitching(false)} />}
    </div>
  );
}
