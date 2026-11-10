import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { AgentStatus } from '../lib/api';

/* ---------- Icons (SF Symbols-like strokes) ---------- */
const icon = (d: string, fill = false) =>
  function Icon({ size = 22, className = '' }: { size?: number; className?: string }) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    );
  };
export const IChat = icon('M12 3.5c4.9 0 8.5 3.3 8.5 7.4s-3.6 7.4-8.5 7.4c-.9 0-1.8-.1-2.6-.3L5 20l1.1-3.6C4.5 15 3.5 13.1 3.5 10.9 3.5 6.8 7.1 3.5 12 3.5Z');
export const IList = icon('M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01');
export const IHand = icon('M12 21c-3.9 0-7-3-7-7v-3.5a1.5 1.5 0 0 1 3 0V12V5.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8c0 3.9-3.1 7-7 7Z');
export const IGear = icon('M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm7.6-3.2c0-.5 0-.9-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.2-1.3L14.5 3h-4l-.4 2.4A7.6 7.6 0 0 0 7.9 6.7l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1c.7.5 1.4 1 2.2 1.3l.4 2.4h4l.4-2.4c.8-.3 1.5-.8 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.3Z');
export const IBack = icon('M15 4.5 7.5 12l7.5 7.5');
export const IChevron = icon('m9 5 7 7-7 7');
export const IUp = icon('M12 19V5m0 0-6 6m6-6 6 6');
export const IPlus = icon('M12 5v14M5 12h14');
export const IClip = icon('m20 11.5-8.2 8.2a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6');
export const IX = icon('M18 6 6 18M6 6l12 12');
export const IInfo = icon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5v-5m0-3h.01');
export const ICheck = icon('m5 12.5 4.5 4.5L19 7.5');
export const IStop = icon('M7 7h10v10H7z', true);
export const IRetry = icon('M4 12a8 8 0 1 0 2.5-5.8L4 8.5M4 4v4.5h4.5');
export const IPaper = icon('m21.5 2.5-9.8 19-2.6-8.1-8.1-2.6 20.5-8.3Z');
export const IPeople = icon('M16 20v-1.2a3.8 3.8 0 0 0-3.8-3.8H6.8A3.8 3.8 0 0 0 3 18.8V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm11.5 9v-1.2a3.8 3.8 0 0 0-2.9-3.7M15.5 4.1a3.5 3.5 0 0 1 0 6.8');
export const ICompose = icon('M12 20h8M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z');
export const IMic = icon('M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15Zm-6.5-3.5a6.5 6.5 0 0 0 13 0M12 18v3');
export const ISpeaker = icon('M4 9.5v5h3.5L12 18V6L7.5 9.5H4Zm11.5-.5a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11');
export const IClock = icon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2');

/* ---------- Avatar ---------- */
const PALETTE = ['#5e5ce6', '#ff9f0a', '#30b0c7', '#ff375f', '#0a84ff', '#bf5af2', '#34c759', '#ac8e68'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export const STATUS: Record<AgentStatus, { label: string; color: string | null; hint: string }> = {
  online: { label: 'Available', color: 'var(--green)', hint: 'Ready to chat' },
  working: { label: 'Busy', color: 'var(--orange)', hint: 'Working on something right now' },
  unreachable: { label: 'Offline', color: 'var(--red)', hint: 'Hermes isn’t answering for this agent' },
  not_configured: { label: 'Not connected yet', color: null, hint: 'This agent hasn’t been connected to Hermes Control yet' },
  not_found: { label: 'Not found', color: null, hint: 'This agent wasn’t found in Hermes' },
  integration_disabled: { label: 'Not connected yet', color: null, hint: 'Hermes Control isn’t connected to Hermes yet' },
};

export function Avatar({ name, url, size = 40, status }: { name: string; url?: string | null; size?: number; status?: AgentStatus }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
  const c = PALETTE[hash(name) % PALETTE.length];
  const dotColor = status ? STATUS[status].color : null;
  const dot = Math.max(10, Math.round(size * 0.27));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span aria-hidden className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white" style={{ background: `linear-gradient(180deg, ${c}e6, ${c})`, fontSize: size * 0.4, letterSpacing: '-0.02em' }}>
          {initials}
        </span>
      )}
      {dotColor && <span className="absolute right-0 bottom-0 rounded-full" style={{ width: dot, height: dot, background: dotColor, boxShadow: '0 0 0 2px var(--bg)' }} />}
    </span>
  );
}

export function AvatarStack({ people, size = 40 }: { people: { name: string; url?: string | null }[]; size?: number }) {
  const shown = people.slice(0, 2);
  if (shown.length < 2) return <Avatar name={shown[0]?.name ?? '?'} url={shown[0]?.url} size={size} />;
  const s = Math.round(size * 0.72);
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span className="absolute top-0 left-0"><Avatar name={shown[0].name} url={shown[0].url} size={s} /></span>
      <span className="absolute right-0 bottom-0 rounded-full" style={{ boxShadow: '0 0 0 2px var(--bg)' }}><Avatar name={shown[1].name} url={shown[1].url} size={s} /></span>
    </span>
  );
}

/* ---------- Buttons ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'filled' | 'tinted' | 'plain' | 'destructive'; size?: 'lg' | 'md' };
export function Button({ variant = 'filled', size = 'md', className = '', ...p }: BtnProps) {
  const v = {
    filled: 'bg-[var(--blue)] text-white',
    tinted: 'bg-[color-mix(in_srgb,var(--blue)_15%,transparent)] text-[var(--blue)]',
    plain: 'text-[var(--blue)]',
    destructive: 'bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-[var(--red)]',
  }[variant];
  const s = size === 'lg' ? 'min-h-[50px] px-5 rounded-[14px] text-[17px] font-semibold' : 'min-h-[44px] px-4 rounded-[12px] text-[15px] font-semibold';
  return <button {...p} className={`press inline-flex items-center justify-center gap-2 disabled:opacity-40 ${v} ${s} ${className}`} />;
}

/* ---------- Grouped list ---------- */
export function Section({ title, footer, children }: { title?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7">
      {title && <h2 className="t-foot mb-1.5 px-4 font-normal uppercase text-[var(--label-2)]">{title}</h2>}
      <div className="overflow-hidden rounded-[12px] bg-[var(--cell)]">{children}</div>
      {footer && <p className="t-foot mt-1.5 px-4 text-[var(--label-2)]">{footer}</p>}
    </section>
  );
}

export function Row({ children, onClick, chevron = false, className = '' }: { children: ReactNode; onClick?: () => void; chevron?: boolean; className?: string }) {
  const inner = (
    <>
      <div className="flex min-h-[48px] flex-1 items-center gap-3 py-2.5 pr-4">{children}</div>
      {chevron && <IChevron size={16} className="mr-3 text-[var(--label-3)]" />}
    </>
  );
  return onClick ? (
    <button onClick={onClick} className={`press-row flex w-full items-center pl-4 text-left [&:not(:last-child)>div]:hairline ${className}`}>{inner}</button>
  ) : (
    <div className={`flex w-full items-center pl-4 [&:not(:last-child)>div]:hairline ${className}`}>{inner}</div>
  );
}

/* ---------- Sheet (modal from bottom; centered card on desktop) ---------- */
export function Sheet({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="sheet safe-bottom flex max-h-[92vh] w-full flex-col rounded-t-[22px] bg-[var(--bg-grouped)] shadow-[var(--shadow)] md:max-w-lg md:rounded-[22px]">
        <div className="relative flex items-center justify-center px-4 pt-3 pb-2">
          <span className="absolute top-1.5 h-1.5 w-10 rounded-full bg-[var(--label-3)] md:hidden" />
          <h2 className="t-headline mt-3">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="press absolute top-4 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--fill)] text-[var(--label-2)]"><IX size={16} /></button>
        </div>
        <div className="scroll flex-1 px-4 pt-2 pb-4">{children}</div>
        {actions && <div className="flex gap-2 px-4 pt-1 pb-4">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      {icon && <div className="mb-3 text-[var(--label-3)]">{icon}</div>}
      <h3 className="t-title">{title}</h3>
      {body && <p className="t-sub mt-2 text-[var(--label-2)]">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Large-title page header (iOS). Translucent so content scrolls underneath. */
export function LargeTitle({ title, subtitle, trailing, leading }: { title: string; subtitle?: ReactNode; trailing?: ReactNode; leading?: ReactNode }) {
  return (
    <header className="material-bar safe-top sticky top-0 z-20 px-4 pt-3 pb-2 md:px-8">
      <div className="flex min-h-[32px] items-center justify-between">{leading ?? <span />}{trailing}</div>
      <h1 className="t-large mt-1">{title}</h1>
      {subtitle && <p className="t-sub mt-0.5 text-[var(--label-2)]">{subtitle}</p>}
    </header>
  );
}

export function timeLabel(t: number) {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const y = new Date(); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - t < 6 * 864e5) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
}
