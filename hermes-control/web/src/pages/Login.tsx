import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('/api/auth/login', { method: 'POST', json: { username, password } });
      onLogin();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 429 ? 'Too many attempts. Wait a few minutes.' : 'Incorrect username or password.');
    } finally { setBusy(false); }
  };
  return (
    <div className="flex h-full items-center justify-center bg-[var(--sidebar)] p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-[var(--bg)] p-7 shadow-2xl">
        <div className="flex items-center gap-3">
          <img src="/icons/icon.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-semibold">Hermes Control</h1>
            <p className="text-sm text-[var(--muted)]">Private workspace sign-in</p>
          </div>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Username</span>
          <input autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setU(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 outline-none focus:border-[var(--color-accent)]" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 outline-none focus:border-[var(--color-accent)]" />
        </label>
        {err && <p role="alert" className="text-sm text-rose-500">{err}</p>}
        <button disabled={busy || !username || !password} className="w-full rounded-lg bg-[var(--color-accent)] py-2.5 font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
