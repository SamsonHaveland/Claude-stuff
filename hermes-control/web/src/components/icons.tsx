// Inline stroke icons (no icon-font dependency).
const I = (d: string) => ({ className = 'h-5 w-5' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d={d} />
  </svg>
);
export const IconHash = I('M5 9h14M5 15h14M10 3 8 21M16 3l-2 18');
export const IconChat = I('M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z');
export const IconUsers = I('M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8');
export const IconTasks = I('M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9');
export const IconShield = I('M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4');
export const IconPulse = I('M3 12h4l3-8 4 16 3-8h4');
export const IconSettings = I('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z');
export const IconSend = I('m22 2-7 20-4-9-9-4 20-7Z');
export const IconClip = I('m21 12-8.6 8.6a5 5 0 0 1-7-7L14 5a3.3 3.3 0 0 1 4.7 4.7L10 18.3a1.7 1.7 0 0 1-2.3-2.4l8-8');
export const IconBack = I('M15 18l-6-6 6-6');
export const IconInfo = I('M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z');
export const IconTelegram = I('m21 4-18 7 6 2 2 6 3-4 5 4 2-15ZM9 13l9-7');
export const IconThread = I('M7 8h10M7 12h6m-6 8-3 1V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-2 3Z');
export const IconX = I('M18 6 6 18M6 6l12 12');
export const IconMenu = I('M4 6h16M4 12h16M4 18h16');
export const IconStop = I('M6 6h12v12H6z');
export const IconRetry = I('M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5');
export const IconLogout = I('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9');
