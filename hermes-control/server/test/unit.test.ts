import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverProfiles } from '../src/hermes/discovery.js';
import { resolveTargets } from '../src/services/routing.js';
import { parseSse, baseUrlFor, keyEnvFor } from '../src/hermes/client.js';
import { KanbanAdapter } from '../src/hermes/kanban.js';
import { extractText } from '../src/services/telegramMirror.js';
import { testConfig } from './helpers.js';

describe('profile discovery (read-only, Hermes rules)', () => {
  it('finds default + named profiles, skips tombstoned, marker-less, invalid and profiles/default', () => {
    const home = mkdtempSync(join(tmpdir(), 'hermes-home-'));
    writeFileSync(join(home, 'config.yaml'), 'x: 1');
    const mk = (name: string, files: Record<string, string>) => {
      mkdirSync(join(home, 'profiles', name), { recursive: true });
      for (const [f, c] of Object.entries(files)) writeFileSync(join(home, 'profiles', name, f), c);
    };
    mk('jeff', { 'profile.yaml': 'display_name: Jeff\ndescription: Chief of Staff', '.env': 'TELEGRAM_BOT_TOKEN=SECRET' });
    mk('debra', { 'SOUL.md': '# Debra\nYou are Debra, production accountant.' });
    mk('ghost', {}); // no identity marker
    mk('oldbot', { 'config.yaml': '' });
    mkdirSync(join(home, 'profiles', '.deleted', 'oldbot'), { recursive: true });
    mk('default', { 'config.yaml': '' });
    mk('Bad_Name', { 'config.yaml': '' });
    const found = discoverProfiles(home);
    expect(found.map((p) => p.id)).toEqual(['default', 'debra', 'jeff']);
    const jeff = found.find((p) => p.id === 'jeff')!;
    expect(jeff.displayName).toBe('Jeff');
    expect(JSON.stringify(found)).not.toContain('SECRET');
    expect(found.find((p) => p.id === 'debra')!.soulExcerpt).toContain('production accountant');
  });
  it('returns [] for a missing home', () => {
    expect(discoverProfiles('/definitely/not/here')).toEqual([]);
  });
});

describe('routing', () => {
  const members = [
    { id: 1, profileName: 'jeff', displayName: 'Jeff' },
    { id: 2, profileName: 'debra', displayName: 'Debra' },
    { id: 3, profileName: 'roxy', displayName: 'Roxy' },
  ];
  const ch = { kind: 'channel' as const };
  it('delegation phrasing goes to the addressee only (no fabricated fan-out)', () => {
    const t = resolveTargets('Jeff, ask Debra to review the budget and Roxy to review the presentation.', ch, members);
    expect(t.map((x) => x.profileName)).toEqual(['jeff']);
  });
  it('@mentions address each mentioned agent', () => {
    expect(resolveTargets('@debra and @Roxy please look', ch, members).map((x) => x.id).sort()).toEqual([2, 3]);
  });
  it('emails and partial words are not mentions', () => {
    expect(resolveTargets('mail jeff@example.com about jeffrey', ch, members)).toEqual([]);
  });
  it('falls back to channel default agent, else nobody', () => {
    expect(resolveTargets('status?', { kind: 'channel', defaultAgentId: 1 }, members).map((x) => x.id)).toEqual([1]);
    expect(resolveTargets('status?', ch, members)).toEqual([]);
  });
  it('DM always targets the DM agent; mirrors never route', () => {
    expect(resolveTargets('@roxy hi', { kind: 'dm', dmAgentId: 2 }, members).map((x) => x.id)).toEqual([2]);
    expect(resolveTargets('@jeff hi', { kind: 'telegram_mirror' }, members)).toEqual([]);
  });
});

describe('hermes client helpers', () => {
  it('builds multiplex URLs and key env names', () => {
    const cfg = testConfig('http://127.0.0.1:8642');
    expect(baseUrlFor('jeff', cfg)).toBe('http://127.0.0.1:8642/p/jeff');
    expect(baseUrlFor('default', cfg)).toBe('http://127.0.0.1:8642');
    expect(keyEnvFor('my-bot', cfg)).toBe('HC_HERMES_KEY_MY_BOT');
  });
  it('parses SSE with comments, ids and split chunks', async () => {
    const enc = new TextEncoder();
    const chunks = [': open\n\n', 'id: 0\ndata: {"event":"a"', '}\n\n: keepalive\n\nid: 1\n', 'data: {"event":"b"}\n\n'];
    const stream = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });
    const got: [string, string | undefined][] = [];
    await parseSse(stream, (d, id) => got.push([d, id]));
    expect(got).toEqual([['{"event":"a"}', '0'], ['{"event":"b"}', '1']]);
  });
  it('extracts text from structured content', () => {
    expect(extractText([{ type: 'text', text: 'hi' }, { type: 'image_url' }])).toBe('hi\n[image]');
  });
});

describe('kanban adapter', () => {
  it('uses --json, -- separators and never a shell', async () => {
    const calls: string[][] = [];
    const k = new KanbanAdapter(testConfig(), async (file, args) => { calls.push([file, ...args]); return '{"id":"t1","title":"x","status":"ready"}'; });
    await k.create({ title: '--rm everything', assignee: 'debra', idempotencyKey: 'abc12345', tenant: 'filmlv' });
    expect(calls[0]).toEqual(['hermes', 'kanban', 'create', '--json', '--idempotency-key', 'abc12345', '--tenant', 'filmlv', '--assignee', 'debra', '--', '--rm everything']);
    await expect(k.show('../etc')).rejects.toThrow(/Invalid task id/);
    await expect(k.assign('t1', 'Bad Profile')).rejects.toThrow(/Invalid profile/);
  });
});
