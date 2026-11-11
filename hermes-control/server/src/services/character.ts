import { lookup } from 'node:dns/promises';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join, sep } from 'node:path';

/**
 * "Create Character": an agent proposes its own look for Hermes Control.
 * Presentation only — never written back to the Hermes profile, SOUL.md or memory.
 */
export function characterPrompt(agent: { displayName: string; role: string | null; profileName: string }) {
  return [
    `Hi ${agent.displayName}. I'd like you to design how you appear in Hermes Control, my private chat app for my agents.`,
    `This only affects your picture and name card in that app. Do NOT change your Hermes configuration, SOUL.md, memory, skills or anything else about yourself.`,
    ``,
    `1. Based on who you are and the work you do for me${agent.role ? ` (currently: ${agent.role})` : ''}, describe a character for yourself: the name you'd like shown, a short job title, and a 2–3 sentence bio in first person.`,
    `2. Use your image generation tool to create ONE photorealistic, professional head-and-shoulders portrait of that character: a real-looking person, natural light, neutral studio background, square framing, looking at the camera. No text or logos in the image.`,
    `3. Reply with exactly this block at the end of your message (keep the labels):`,
    ``,
    `CHARACTER`,
    `name: <name>`,
    `role: <job title>`,
    `bio: <2–3 sentences>`,
    `image: <the image URL or file path your image tool returned>`,
    ``,
    `If you can't generate images, still send the block and write "image: none".`,
  ].join('\n');
}

export interface ParsedCharacter { name: string | null; role: string | null; bio: string | null; image: string | null }

export function parseCharacter(text: string): ParsedCharacter | null {
  const idx = text.lastIndexOf('CHARACTER');
  const block = idx >= 0 ? text.slice(idx) : text;
  const field = (k: string) => {
    const m = new RegExp(`^\\s*[*_]*${k}[*_]*\\s*:\\s*(.+)$`, 'im').exec(block);
    const v = m?.[1]?.trim().replace(/^[*_`"]+|[*_`"]+$/g, '').trim() ?? '';
    return v && !/^none$/i.test(v) ? v : null;
  };
  let image = field('image');
  // Fall back to the MEDIA:<url> tag Hermes' image tool emits, or a markdown image.
  if (!image) image = /MEDIA:(\S+)/.exec(text)?.[1] ?? /!\[[^\]]*\]\((\S+?)\)/.exec(text)?.[1] ?? null;
  if (image) image = image.replace(/^<|>$/g, '').replace(/^MEDIA:/, '').replace(/^!\[[^\]]*\]\((.*)\)$/, '$1');
  const out = { name: field('name')?.slice(0, 60) ?? null, role: field('role')?.slice(0, 80) ?? null, bio: field('bio')?.slice(0, 1200) ?? null, image };
  return out.name || out.role || out.bio || out.image ? out : null;
}

const MAX_BYTES = 10 * 1024 * 1024;

function sniff(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

/** Private, loopback, link-local and other non-public addresses (SSRF guard). */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * Load the portrait the agent produced. Accepts only:
 *  - a public https URL (every redirect hop re-checked against private addresses), or
 *  - a file inside a Hermes image cache folder (<home>/cache/images or <home>/profiles/<p>/cache/images).
 * The bytes must be a real JPEG/PNG/WebP under 10 MB.
 */
export async function loadPortrait(src: string, hermesHome: string, fetchImpl: typeof fetch = fetch): Promise<{ buf: Buffer; ext: 'jpg' | 'png' | 'webp' }> {
  let buf: Buffer;
  if (src.startsWith('/') || src.startsWith('~/')) {
    const path = await realpath(src.replace(/^~(?=\/)/, process.env.HOME ?? '')).catch(() => '');
    const home = await realpath(hermesHome).catch(() => hermesHome);
    const allowed = path.startsWith(join(home, 'cache', 'images') + sep) || new RegExp(`^${escapeRe(join(home, 'profiles'))}${escapeRe(sep)}[^${escapeRe(sep)}]+${escapeRe(join(sep, 'cache', 'images', sep))}`).test(path);
    if (!path || !allowed) throw new Error('The picture is not in a Hermes image folder, so it was not used.');
    if ((await stat(path)).size > MAX_BYTES) throw new Error('The picture is larger than 10 MB.');
    buf = await readFile(path);
  } else {
    let url = new URL(src);
    for (let hop = 0; ; hop++) {
      if (url.protocol !== 'https:') throw new Error('Only https picture links are accepted.');
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('That picture link points to a private address, so it was not used.');
      const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location') && hop < 3) { url = new URL(res.headers.get('location')!, url); continue; }
      if (!res.ok) throw new Error(`Couldn't download the picture (HTTP ${res.status}).`);
      if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('The picture is larger than 10 MB.');
      buf = Buffer.from(await res.arrayBuffer());
      break;
    }
  }
  if (buf.length > MAX_BYTES) throw new Error('The picture is larger than 10 MB.');
  const ext = sniff(buf);
  if (!ext) throw new Error('That file is not a JPEG, PNG or WebP picture.');
  return { buf, ext };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
