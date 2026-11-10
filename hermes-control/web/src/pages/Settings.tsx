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
  telegramMirror: { profile: string; enabled: boolean; twoWay: boolean; workspace: string; status: { ok: boolean; at: number; error?: string } | null; lastCopy: { ok: boolean; at: number; error?: string } | null }[];
  autoUpdate: { result: string; note?: string; version_before?: string; version_after?: string; finished_at?: string } | null;
}

export function SettingsPage() {
  const { me, ws, agents, refresh } = useWs();
  const nav = useNavigate();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [sys, setSys] = useState<SystemStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  const loadSys = () => api<SystemStatus>('/api/system/status').then(setSys).catch(() => {});
  useEffect(() => { if (me.user.role === 'admin') loadSys(); }, [me.user.role]);
  const [twoWayError, setTwoWayError] = useState<string | null>(null);
  const setTwoWay = async (profile: string, on: boolean) => {
    setTwoWayError(null);
    setSys((s) => s && { ...s, telegramMirror: s.telegramMirror.map((t) => (t.profile === profile ? { ...t, twoWay: on } : t)) });
    try {
      await api(`/api/system/telegram/${encodeURIComponent(profile)}/two-way`, { method: 'POST', json: { on } });
    } catch (e) {
      setTwoWayError((e as Error).message);
    }
    await loadSys();
    refresh();
  };
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
              <Section title="Telegram" footer="Two-way: what you type in an agent’s Telegram chat here is also sent to Telegram, from the agent’s bot. Their Telegram replies show up here either way.">
                {sys.telegramMirror.map((t) => {
                  const name = agents.find((a) => a.profileName === t.profile)?.displayName ?? t.profile;
                  const reading = !t.enabled ? 'Off' : !t.status ? 'Starting…' : t.status.ok ? 'Showing here' : 'Having trouble';
                  const copy = t.lastCopy && !t.lastCopy.ok ? 'Last copy to Telegram failed' : null;
                  return (
                    <Row key={t.profile + t.workspace}>
                      <span className="flex flex-1 flex-col">
                        <span>{name}</span>
                        <span className="t-foot text-[var(--label-2)]">{reading}</span>
                        {copy && <span className="t-cap text-[var(--red)]">{copy}</span>}
                      </span>
                      <label className="flex items-center gap-2">
                        <span className="t-sub text-[var(--label-2)]">Two-way</span>
                        <input type="checkbox" role="switch" aria-label={`Two-way Telegram for ${name}`} disabled={!t.enabled} checked={t.twoWay} onChange={(e) => setTwoWay(t.profile, e.target.checked)} className="switch" />
                      </label>
                    </Row>
                  );
                })}
                {twoWayError && <p className="t-foot px-4 py-2 text-[var(--red)]">Couldn’t change that: {twoWayError}</p>}
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
