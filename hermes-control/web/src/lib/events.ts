import { useEffect, useRef, useState } from 'react';

export interface ServerEvent { type: string; workspaceId: number; conversationId?: number; payload: any }

/**
 * ONE EventSource per browser tab, multiplexing every event for the user's workspaces
 * (avoids the HTTP/1.1 six-connection limit). Reconnects with backoff; consumers
 * refetch on reconnect so nothing is missed while disconnected.
 */
type Fn = (e: ServerEvent) => void;
const listeners = new Set<Fn>();
const statusListeners = new Set<(s: 'connecting' | 'open' | 'closed') => void>();
let es: EventSource | null = null;
let retry = 0;
let status: 'connecting' | 'open' | 'closed' = 'closed';
const TYPES = ['message.upsert', 'activity', 'approvals.changed'];

function setStatus(s: typeof status) { status = s; statusListeners.forEach((f) => f(s)); }

export function connectEvents() {
  if (es) return;
  setStatus('connecting');
  es = new EventSource('/api/events', { withCredentials: true });
  es.onopen = () => { retry = 0; setStatus('open'); listeners.forEach((f) => f({ type: 'reconnected', workspaceId: 0, payload: null })); };
  for (const t of TYPES) es.addEventListener(t, (ev) => {
    try { const d = JSON.parse((ev as MessageEvent).data); listeners.forEach((f) => f({ type: t, ...d })); } catch { /* ignore */ }
  });
  es.onerror = () => {
    es?.close(); es = null; setStatus('closed');
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    setTimeout(connectEvents, delay);
  };
}

export function disconnectEvents() { es?.close(); es = null; setStatus('closed'); }

export function useServerEvents(fn: Fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const l: Fn = (e) => ref.current(e);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

export function useConnectionStatus() {
  const [s, set] = useState(status);
  // Re-read after subscribing: the connection may have opened between render and this effect.
  useEffect(() => { statusListeners.add(set); set(status); return () => { statusListeners.delete(set); }; }, []);
  return s;
}
