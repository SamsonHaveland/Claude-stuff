import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeHermes, sleep } from './fakeHermes.js';
import { convId, login, makeApp, waitFor } from './helpers.js';
import { RunService } from '../src/services/runs.js';

let fake: FakeHermes;
let env: Awaited<ReturnType<typeof makeApp>>;

const reply = (db: any, runId: number) => db.prepare('SELECT m.* FROM messages m JOIN runs r ON r.reply_message_id = m.id WHERE r.id = ?').get(runId) as any;
const runRow = (db: any, runId: number) => db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any;

beforeEach(async () => {
  fake = await new FakeHermes({ key: 'secret-key' }).start();
  env = await makeApp({ hermesUrl: fake.url, key: 'secret-key' });
});
afterEach(async () => {
  await env.app.close();
  await fake.stop();
});

describe('authentication', () => {
  it('rejects unauthenticated, bad password, and mutation without CSRF', async () => {
    expect((await env.app.inject({ url: '/api/me' })).statusCode).toBe(401);
    expect((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'sam', password: 'wrong-password-123' } })).statusCode).toBe(401);
    const { headers } = await login(env.app, 'sam');
    const c = convId(env.db, 'film-lv', 'dm', 'dm-jeff');
    const noCsrf = await env.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers: { cookie: headers.cookie }, payload: { body: 'hi' } });
    expect(noCsrf.statusCode).toBe(403);
    const audit = env.db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action = 'auth.login_failed'`).get() as any;
    expect(audit.n).toBe(1);
  });
});

describe('workspace isolation', () => {
  it('a member of Atomic Fox cannot see FilmLV conversations, messages, agents or approvals', async () => {
    const { headers } = await login(env.app, 'fox');
    const me = (await env.app.inject({ url: '/api/me', headers })).json();
    expect(me.workspaces.map((w: any) => w.slug)).toEqual(['atomic-fox']);
    for (const url of ['/api/w/film-lv/conversations', '/api/w/film-lv/agents', '/api/w/film-lv/approvals', '/api/w/film-lv/tasks']) {
      expect((await env.app.inject({ url, headers })).statusCode).toBe(404);
    }
    // Guessing a FilmLV conversation id through the Atomic Fox workspace also fails.
    const filmConv = convId(env.db, 'film-lv', 'channel', 'production');
    expect((await env.app.inject({ url: `/api/w/atomic-fox/conversations/${filmConv}/messages`, headers })).statusCode).toBe(404);
    const send = await env.app.inject({ method: 'POST', url: `/api/w/atomic-fox/conversations/${filmConv}/messages`, headers, payload: { body: 'leak?' } });
    expect(send.statusCode).toBe(404);
  });

  it('agents not allowed in a workspace are not routable there (Debra is FilmLV-only)', async () => {
    const { headers } = await login(env.app, 'sam');
    const agents = (await env.app.inject({ url: '/api/w/atomic-fox/agents', headers })).json();
    expect(agents.map((a: any) => a.profileName).sort()).toEqual(['harry', 'jeff']);
    const c = convId(env.db, 'atomic-fox', 'channel', 'research');
    const res = (await env.app.inject({ method: 'POST', url: `/api/w/atomic-fox/conversations/${c}/messages`, headers, payload: { body: '@debra review this' } })).json();
    expect(res.routedTo).toEqual([]);
    expect(fake.runCreates).toBe(0);
  });

  it('the same agent gets a separate Hermes session per workspace conversation', async () => {
    const { headers } = await login(env.app, 'sam');
    const a = convId(env.db, 'film-lv', 'dm', 'dm-jeff');
    const b = convId(env.db, 'atomic-fox', 'dm', 'dm-jeff');
    const r1 = (await env.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${a}/messages`, headers, payload: { body: 'one' } })).json();
    const r2 = (await env.app.inject({ method: 'POST', url: `/api/w/atomic-fox/conversations/${b}/messages`, headers, payload: { body: 'two' } })).json();
    await waitFor(() => runRow(env.db, r1.runIds[0]).status === 'completed' && runRow(env.db, r2.runIds[0]).status === 'completed');
    const s1 = runRow(env.db, r1.runIds[0]).hermes_session_id;
    const s2 = runRow(env.db, r2.runIds[0]).hermes_session_id;
    expect(s1).not.toBe(s2);
    expect(s1).toContain('film-lv');
    expect(s2).toContain('atomic-fox');
  });

  it('attachments cannot be read or attached across workspaces', async () => {
    const { headers } = await login(env.app, 'sam');
    const boundary = 'XBOUNDARY';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="budget.csv"\r\nContent-Type: text/csv\r\n\r\na,b\r\n--${boundary}--\r\n`;
    const up = await env.app.inject({ method: 'POST', url: '/api/w/film-lv/uploads', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(up.statusCode).toBe(200);
    const id = up.json().id;
    expect((await env.app.inject({ url: `/api/w/atomic-fox/attachments/${id}`, headers })).statusCode).toBe(404);
    expect((await env.app.inject({ url: `/api/w/film-lv/attachments/${id}`, headers })).statusCode).toBe(200);
    const c = convId(env.db, 'atomic-fox', 'channel', 'research');
    await env.app.inject({ method: 'POST', url: `/api/w/atomic-fox/conversations/${c}/messages`, headers, payload: { body: 'note', attachmentIds: [id] } });
    expect((env.db.prepare('SELECT message_id FROM attachments WHERE id = ?').get(id) as any).message_id).toBeNull();
  });
});

describe('message delivery to Hermes', () => {
  it('DM to Jeff creates an API-owned session, streams, and shows the REAL final output', async () => {
    const { headers } = await login(env.app, 'sam');
    const c = convId(env.db, 'film-lv', 'dm', 'dm-jeff');
    const res = (await env.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers, payload: { body: 'Summarise today' } })).json();
    expect(res.routedTo).toEqual([{ agentId: expect.any(Number), profile: 'jeff' }]);
    const runId = res.runIds[0];
    const final = await waitFor(() => { const m = reply(env.db, runId); return m?.state === 'final' ? m : null; });
    expect(final.body).toBe('Echo: Summarise today');
    expect(final.source).toBe('hermes_run');
    const run = runRow(env.db, runId);
    expect(run.hermes_run_id).toBe('run_1');
    expect(fake.sessions.get(run.hermes_session_id)?.source).toBe('api_server');
    expect(fake.runs.get('run_1')!.input).toBe('Summarise today');
    // tool activity recorded from real events
    const events = env.db.prepare('SELECT event FROM run_events WHERE run_id = ? ORDER BY seq').all(runId).map((r: any) => r.event);
    expect(events).toEqual(['run.started', 'tool.started', 'tool.completed', 'message.delta', 'message.delta', 'run.completed']);
  });

  it('channel delegation message reaches Jeff only; no reply is fabricated for Debra or Roxy', async () => {
    const { headers } = await login(env.app, 'sam');
    const c = convId(env.db, 'film-lv', 'channel', 'production');
    const res = (await env.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers, payload: { body: 'Jeff, ask Debra to review the budget and Roxy to review the presentation.' } })).json();
    expect(res.routedTo.map((r: any) => r.profile)).toEqual(['jeff']);
    await waitFor(() => reply(env.db, res.runIds[0])?.state === 'final');
    const agentMsgs = env.db.prepare(`SELECT author_agent_id FROM messages WHERE conversation_id = ? AND author_kind = 'agent'`).all(c);
    expect(agentMsgs).toHaveLength(1);
  });

  it('a Hermes failure is shown as a failure, never as a reply', async () => {
    await fake.stop();
    const { headers } = await login(env.app, 'sam');
    const c = convId(env.db, 'film-lv', 'dm', 'dm-jeff');
    const res = (await env.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers, payload: { body: 'hello?' } })).json();
    const m = await waitFor(() => { const r = reply(env.db, res.runIds[0]); return r?.state === 'failed' ? r : null; });
    expect(m.body).toBe('');
    expect(m.error).toMatch(/unreachable/i);
    fake = await new FakeHermes({ key: 'secret-key' }).start(); // for afterEach
  });

  it('wrong API key fails closed with the real error', async () => {
    const other = await makeApp({ hermesUrl: fake.url, key: 'WRONG' });
    const { headers } = await login(other.app, 'sam');
    const c = convId(other.db, 'film-lv', 'dm', 'dm-jeff');
    const res = (await other.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers, payload: { body: 'x' } })).json();
    const m = await waitFor(() => { const r = reply(other.db, res.runIds[0]); return r?.state === 'failed' ? r : null; });
    expect(m.error).toMatch(/Invalid API key/);
    await other.app.close();
  });

  it('resumes a dropped event stream with Last-Event-ID without duplicating text', async () => {
    fake.dropStreamAfter = 5;
    const slow = new FakeHermes({
      key: 'secret-key',
      script: async (run, f) => {
        f.emit(run, 'run.started');
        f.emit(run, 'message.delta', { delta: 'Hello ' });
        await sleep(150); // stream gets cut here
        f.emit(run, 'message.delta', { delta: 'world' });
        f.finish(run, 'completed');
      },
    });
    await fake.stop();
    fake = await slow.start();
    fake.dropStreamAfter = 60;
    const app2 = await makeApp({ hermesUrl: fake.url, key: 'secret-key' });
    const { headers } = await login(app2.app, 'sam');
    const c = convId(app2.db, 'film-lv', 'dm', 'dm-jeff');
    const res = (await app2.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers, payload: { body: 'hi' } })).json();
    const m = await waitFor(() => { const r = reply(app2.db, res.runIds[0]); return r?.state === 'final' ? r : null; }, 8000);
    expect(m.body).toBe('Hello world');
    expect(fake.runCreates).toBe(1);
    await app2.app.close();
  });

  it('after a restart, unfinished runs resume and the idempotency key prevents a second execution', async () => {
    const { headers } = await login(env.app, 'sam');
    const c = convId(env.db, 'film-lv', 'dm', 'dm-jeff');
    const res = (await env.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers, payload: { body: 'persist me' } })).json();
    await waitFor(() => runRow(env.db, res.runIds[0]).hermes_run_id);
    env.ctx.runs.stopAll();
    // Simulate a crash after Hermes accepted the run but before we stored its id.
    env.db.prepare(`UPDATE runs SET hermes_run_id = NULL, status = 'submitting', last_seq = -1 WHERE id = ?`).run(res.runIds[0]);
    env.db.prepare(`UPDATE messages SET body = '', state = 'pending' WHERE id = ?`).run(runRow(env.db, res.runIds[0]).reply_message_id);
    await sleep(200);
    const svc = new RunService(env.db, env.ctx.hermes, env.ctx.bus);
    expect(svc.resumeOpenRuns()).toBe(1);
    const m = await waitFor(() => { const r = reply(env.db, res.runIds[0]); return r?.state === 'final' ? r : null; });
    expect(m.body).toBe('Echo: persist me');
    expect(fake.runCreates).toBe(1); // replayed, not re-run
  });
});

describe('approvals', () => {
  it('records approval.request as pending and only marks confirmed after Hermes 2xx', async () => {
    await fake.stop();
    fake = await new FakeHermes({
      key: 'secret-key',
      script: (run, f) => { run.status = 'waiting_for_approval'; f.emit(run, 'approval.request', { request_id: 'p-1', command: 'rm -rf build', description: 'Delete build dir', choices: ['once', 'session', 'deny'] }); },
    }).start();
    const app2 = await makeApp({ hermesUrl: fake.url, key: 'secret-key' });
    const { headers } = await login(app2.app, 'sam');
    const c = convId(app2.db, 'film-lv', 'dm', 'dm-jeff');
    await app2.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers, payload: { body: 'clean up' } });
    const pending = await waitFor(async () => null as any, 1).catch(() => null);
    void pending;
    const ap = await waitFor(() => app2.db.prepare(`SELECT * FROM approvals WHERE status = 'pending'`).get() as any);
    expect(ap.command).toBe('rm -rf build');
    const list = (await app2.app.inject({ url: '/api/w/film-lv/approvals', headers })).json();
    expect(list[0].choices).toEqual(['once', 'session', 'deny']);
    const bad = await app2.app.inject({ method: 'POST', url: `/api/w/film-lv/approvals/${ap.id}/decision`, headers, payload: { choice: 'always' } });
    expect(bad.statusCode).toBe(400); // 'always' not offered by Hermes for this request
    const ok = await app2.app.inject({ method: 'POST', url: `/api/w/film-lv/approvals/${ap.id}/decision`, headers, payload: { choice: 'once' } });
    expect(ok.statusCode).toBe(200);
    expect(fake.approvalCalls[0].body).toEqual({ choice: 'once', request_id: 'p-1', execution_generation: 1 });
    expect((app2.db.prepare('SELECT status FROM approvals WHERE id = ?').get(ap.id) as any).status).toBe('confirmed');
    await app2.app.close();
  });

  it('a stale approval (409 from Hermes) is shown as rejected, not approved', async () => {
    await fake.stop();
    fake = await new FakeHermes({ key: 'secret-key', script: (run, f) => { run.status = 'waiting_for_approval'; f.emit(run, 'approval.request', { request_id: 'p-2', command: 'send email', choices: ['once', 'deny'] }); } }).start();
    fake.approvalStatus = 409;
    const app2 = await makeApp({ hermesUrl: fake.url, key: 'secret-key' });
    const { headers } = await login(app2.app, 'sam');
    const c = convId(app2.db, 'film-lv', 'dm', 'dm-jeff');
    await app2.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers, payload: { body: 'email them' } });
    const ap = await waitFor(() => app2.db.prepare(`SELECT * FROM approvals WHERE status = 'pending'`).get() as any);
    const res = await app2.app.inject({ method: 'POST', url: `/api/w/film-lv/approvals/${ap.id}/decision`, headers, payload: { choice: 'once' } });
    expect(res.statusCode).toBe(409);
    expect((app2.db.prepare('SELECT status FROM approvals WHERE id = ?').get(ap.id) as any).status).toBe('rejected');
    await app2.app.close();
  });

  it('only workspace owners can decide', async () => {
    const { headers } = await login(env.app, 'fox');
    const r = await env.app.inject({ method: 'POST', url: '/api/w/atomic-fox/approvals/1/decision', headers, payload: { choice: 'once' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('telegram mirror (read-only)', () => {
  it('mirrors Jeff Telegram messages once, in order, and refuses writes into the mirror', async () => {
    fake.addTelegram('tg-123', [{ role: 'user', content: 'Morning Jeff' }, { role: 'tool', content: 'ignored' }, { role: 'assistant', content: [{ type: 'text', text: 'Morning! 3 items today.' }] }]);
    const target = { profile: 'jeff', workspace: 'film-lv', pollSeconds: 60 };
    expect(await env.ctx.mirror.pollOnce(target)).toBe(2);
    expect(await env.ctx.mirror.pollOnce(target)).toBe(0); // unchanged session skipped
    env.db.prepare('DELETE FROM mirror_cursors').run();
    expect(await env.ctx.mirror.pollOnce(target)).toBe(0); // re-fetch, still no duplicates
    fake.addTelegram('tg-123', [{ role: 'user', content: 'Thanks' }]);
    expect(await env.ctx.mirror.pollOnce(target)).toBe(1);
    const c = convId(env.db, 'film-lv', 'telegram_mirror', 'telegram-jeff');
    const { headers } = await login(env.app, 'sam');
    const msgs = (await env.app.inject({ url: `/api/w/film-lv/conversations/${c}/messages`, headers })).json();
    expect(msgs.map((m: any) => m.body)).toEqual(['Morning Jeff', 'Morning! 3 items today.', 'Thanks']);
    const w = await env.app.inject({ method: 'POST', url: `/api/w/film-lv/conversations/${c}/messages`, headers, payload: { body: 'reply' } });
    expect(w.statusCode).toBe(409);
    // Never visible from the other workspace
    const fox = await login(env.app, 'fox');
    expect((await env.app.inject({ url: `/api/w/atomic-fox/conversations/${c}/messages`, headers: fox.headers })).statusCode).toBe(404);
  });

  it('records mirror failure status instead of throwing', async () => {
    await fake.stop();
    await env.ctx.mirror.pollOnce({ profile: 'jeff', workspace: 'film-lv', pollSeconds: 60 });
    expect(env.ctx.mirror.lastStatus.get('jeff@film-lv')?.ok).toBe(false);
    fake = await new FakeHermes({ key: 'secret-key' }).start();
  });
});

describe('tasks', () => {
  it('filters the shared Kanban board to the workspace and validates assignees', async () => {
    const tasks = [
      { id: 't1', title: 'Budget review', assignee: 'debra', status: 'ready', tenant: null },
      { id: 't2', title: 'Fox research', assignee: 'harry', status: 'running', tenant: null },
      { id: 't3', title: 'Tenanted', assignee: 'jeff', status: 'ready', tenant: 'other' },
    ];
    const calls: string[][] = [];
    const app2 = await makeApp({ hermesUrl: fake.url, key: 'secret-key', kanbanRunner: async (_f, args) => { calls.push(args); return args.includes('list') ? JSON.stringify(tasks) : JSON.stringify({ id: 't9', title: 'new', status: 'ready', assignee: 'debra' }); } });
    const { headers } = await login(app2.app, 'sam');
    const film = (await app2.app.inject({ url: '/api/w/film-lv/tasks', headers })).json();
    expect(film.map((t: any) => t.id)).toEqual(['t1']);
    const fox = (await app2.app.inject({ url: '/api/w/atomic-fox/tasks', headers })).json();
    expect(fox.map((t: any) => t.id)).toEqual(['t2']);
    const bad = await app2.app.inject({ method: 'POST', url: '/api/w/atomic-fox/tasks', headers, payload: { title: 'x', assignee: 'debra', clientKey: 'abcdefgh1' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app2.app.inject({ method: 'POST', url: '/api/w/film-lv/tasks', headers, payload: { title: 'Check cue sheet', assignee: 'debra', clientKey: 'abcdefgh1' } });
    expect(ok.statusCode).toBe(200);
    expect(calls.at(-1)).toContain('--idempotency-key');
    await app2.app.close();
  });
});
