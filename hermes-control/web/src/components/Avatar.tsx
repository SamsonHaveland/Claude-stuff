import type { AgentStatus } from '../lib/api';

const PALETTE = ['#6d5ef0', '#e0603a', '#1f9d8a', '#c2417d', '#3a7be0', '#b98a1c', '#7a4fc9', '#2f8f4e'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export const STATUS_META: Record<AgentStatus, { label: string; dot: string; hint: string }> = {
  online: { label: 'Online', dot: 'bg-emerald-500', hint: 'Hermes gateway reachable for this profile' },
  working: { label: 'Working', dot: 'bg-amber-400', hint: 'Has a run in progress' },
  unreachable: { label: 'Unreachable', dot: 'bg-rose-500', hint: 'Gateway health check failed' },
  not_configured: { label: 'Not connected', dot: 'bg-zinc-400', hint: 'No API key configured in Hermes Control for this profile' },
  not_found: { label: 'Not found', dot: 'bg-zinc-400', hint: 'Profile was not found in the Hermes installation' },
  integration_disabled: { label: 'Offline (disabled)', dot: 'bg-zinc-400', hint: 'Hermes integration is disabled in config' },
};

/**
 * Circular avatar. Uses the uploaded portrait when present; otherwise a local monogram
 * placeholder (no external image service). Visual identity only — never used for routing.
 */
export function Avatar({ name, url, size = 36, status, ring = false }: { name: string; url?: string | null; size?: number; status?: AgentStatus; ring?: boolean }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
  const color = PALETTE[hash(name) % PALETTE.length];
  const dot = Math.max(8, Math.round(size * 0.28));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" className={`h-full w-full rounded-full object-cover ${ring ? 'ring-2 ring-[var(--bg)]' : ''}`} />
      ) : (
        <span aria-hidden className={`flex h-full w-full items-center justify-center rounded-full font-semibold text-white ${ring ? 'ring-2 ring-[var(--bg)]' : ''}`} style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, fontSize: size * 0.38 }}>
          {initials}
        </span>
      )}
      {status && (
        <span title={STATUS_META[status].label} className={`absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-[var(--bg)] ${STATUS_META[status].dot}`} style={{ width: dot, height: dot }} />
      )}
    </span>
  );
}
