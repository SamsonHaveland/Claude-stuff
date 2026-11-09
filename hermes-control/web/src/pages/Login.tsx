import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { Button } from '../components/ui';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('/api/auth/login', { method: 'POST', json: { username: username.trim().toLowerCase(), password } });
      onLogin();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 429 ? 'Too many tries. Please wait a few minutes.' : 'That username or password isn’t right.');
    } finally { setBusy(false); }
  };
  const field = 'h-[52px] w-full bg-transparent px-4 text-[17px] outline-none placeholder:text-[var(--label-3)]';
  return (
    <div className="flex min-h-full items-center justify-center bg-[var(--bg-grouped)] p-5">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/icons/icon.svg" alt="" className="h-20 w-20 rounded-[22px] shadow-[var(--shadow)]" />
          <h1 className="t-large mt-5">Hermes Control</h1>
          <p className="t-sub mt-1 text-[var(--label-2)]">Sign in to talk to your agents.</p>
        </div>
        <div className="overflow-hidden rounded-[12px] bg-[var(--cell)]">
          <input aria-label="Username" placeholder="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setU(e.target.value)} className={`${field} hairline`} />
          <input aria-label="Password" placeholder="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} className={field} />
        </div>
        {err && <p role="alert" className="t-sub mt-3 text-center text-[var(--red)]">{err}</p>}
        <Button size="lg" type="submit" className="mt-5 w-full" disabled={busy || !username || !password}>{busy ? 'Signing In…' : 'Sign In'}</Button>
      </form>
    </div>
  );
}
