import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPrivateAddress, loadPortrait, parseCharacter, characterPrompt } from '../src/services/character.js';
import { FakeHermes } from './fakeHermes.js';
import { convId, login, makeApp, testConfig, waitFor } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

describe('character parsing', () => {
  it('reads the CHARACTER block, tolerating markdown', () => {
    const c = parseCharacter('Here you go!\n\nCHARACTER\n**name:** Jeff Moreau\nrole: Chief of Staff\nbio: I keep everything moving.\nimage: `https://cdn.example.com/a.png`');
    expect(c).toEqual({ name: 'Jeff Moreau', role: 'Chief of Staff', bio: 'I keep everything moving.', image: 'https://cdn.example.com/a.png' });
  });
  it('falls back to MEDIA: tags and treats "none" as no image', () => {
    expect(parseCharacter('CHARACTER\nname: Debra\nimage: none')?.image).toBeNull();
    expect(parseCharacter('Done. MEDIA:https://x.example/p.webp\nCHARACTER\nname: Roxy')?.image).toBe('https://x.example/p.webp');
    expect(parseCharacter('no block here')).toBeNull();
  });
  it('the prompt forbids changing the Hermes profile', () => {
    expect(characterPrompt({ displayName: 'Jeff', role: null, profileName: 'jeff' })).toMatch(/Do NOT change your Hermes configuration/);
  });
});

describe('portrait loading guards', () => {
  it('flags private and loopback addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.218', '172.20.1.1', '169.254.169.254', '100.101.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });
  it('accepts files only inside Hermes image caches, and only real images', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hh-'));
    mkdirSync(join(home, 'profiles', 'roxy', 'cache', 'images'), { recursive: true });
    mkdirSync(join(home, 'cache', 'images'), { recursive: true });
    writeFileSync(join(home, 'profiles', 'roxy', 'cache', 'images', 'p.png'), PNG);
    writeFileSync(join(home, 'cache', 'images', 'fake.png'), 'not an image');
    writeFileSync(join(home, '.env'), 'SECRET=1');
    expect((await loadPortrait(join(home, 'profiles', 'roxy', 'cache', 'images', 'p.png'), home)).ext).toBe('png');
    await expect(loadPortrait(join(home, '.env'), home)).rejects.toThrow(/not in a Hermes image folder/);
    await expect(loadPortrait(join(home, 'cache', 'images', '..', '..', '.env'), home)).rejects.toThrow(/not in a Hermes image folder/);
    await expect(loadPortrait(join(home, 'cache', 'images', 'fake.png'), home)).rejects.toThrow(/not a JPEG, PNG or WebP/);
  });
  it('refuses http, private hosts and private redirects', async () => {
    await expect(loadPortrait('http://example.com/a.png', '/x')).rejects.toThrow(/Only https/);
    await expect(loadPortrait('https://127.0.0.1/a.png', '/x')).rejects.toThrow(/private address/);
    const redirecting = (async () => new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/a.png' } })) as unknown as typeof fetch;
    await expect(loadPortrait('https://93.184.216.34/a.png', '/x', redirecting)).rejects.toThrow(/private address/);
    const ok = (async () => new Response(PNG, { status: 200 })) as unknown as typeof fetch;
    expect((await loadPortrait('https://93.184.216.34/a.png', '/x', ok)).ext).toBe('png');
  });
});

describe('Create Character end-to-end (fake Hermes)', () => {
  let fake: FakeHermes;
  afterEach(async () => { await fake?.stop(); });

  it('asks the agent in its DM, previews the proposal, and applies it only on request', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hh-'));
    mkdirSync(join(home, 'profiles', 'jeff', 'cache', 'images'), { recursive: true });
    const img = join(home, 'profiles', 'jeff', 'cache', 'images', 'jeff.png');
    writeFileSync(img, PNG);
    fake = await new FakeHermes({
      key: 'k',
      script: (run, f) => { f.finish(run, 'completed', `Happy to!\n\nCHARACTER\nname: Jeff Sterling\nrole: Chief of Staff\nbio: I keep your day on track.\nimage: ${img}`); },
    }).start();
    const cfg = testConfig(fake.url);
    cfg.hermes.home = home;
    const env = await makeApp({ cfg, key: 'k' });
    const { headers } = await login(env.app, 'sam');
    const jeff = (env.db.prepare("SELECT id FROM agents WHERE profile_name = 'jeff'").get() as any).id;
    const start = await env.app.inject({ method: 'POST', url: `/api/w/film-lv/agents/${jeff}/character`, headers });
    expect(start.statusCode).toBe(200);
    const { runId, conversationId } = start.json();
    expect(conversationId).toBe(convId(env.db, 'film-lv', 'dm', 'dm-jeff'));
    await waitFor(() => env.db.prepare("SELECT 1 FROM runs WHERE id = ? AND status = 'completed'").get(runId));
    expect(fake.runs.get('run_1')!.input).toMatch(/design how you appear in Hermes Control/);
    const got = (await env.app.inject({ url: `/api/w/film-lv/agents/${jeff}/character/${runId}`, headers })).json();
    expect(got.proposal).toMatchObject({ name: 'Jeff Sterling', role: 'Chief of Staff' });
    const pic = await env.app.inject({ url: `/api/w/film-lv/agents/${jeff}/character/${runId}/picture`, headers });
    expect(pic.statusCode).toBe(200);
    expect(pic.headers['content-type']).toBe('image/png');
    // Nothing changed yet.
    expect((env.db.prepare('SELECT display_name, avatar_file FROM agents WHERE id = ?').get(jeff) as any)).toMatchObject({ display_name: 'Jeff', avatar_file: null });
    const applied = (await env.app.inject({ method: 'POST', url: `/api/w/film-lv/agents/${jeff}/character/${runId}/apply`, headers })).json();
    expect(applied.pictureError).toBeNull();
    const row = env.db.prepare('SELECT display_name, role, description, avatar_file, profile_name FROM agents WHERE id = ?').get(jeff) as any;
    expect(row).toMatchObject({ display_name: 'Jeff Sterling', role: 'Chief of Staff', description: 'I keep your day on track.', profile_name: 'jeff' });
    expect(existsSync(join(env.ctx.avatarsDir, row.avatar_file))).toBe(true);
    // Members cannot trigger it.
    const fox = await login(env.app, 'fox');
    expect((await env.app.inject({ method: 'POST', url: `/api/w/atomic-fox/agents/${jeff}/character`, headers: fox.headers })).statusCode).toBe(403);
    await env.app.close();
  });
});
