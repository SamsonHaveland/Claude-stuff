import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/**
 * READ-ONLY profile discovery, mirroring Hermes' own rules (hermes_constants.py upstream):
 *  - the default profile is the Hermes home itself, id "default"
 *  - named profiles are <home>/profiles/<id>/ with id matching PROFILE_ID_RE
 *  - a directory counts only if it has an identity marker file
 *  - tombstoned (<home>/profiles/.deleted/<id>) and "profiles/default" are skipped
 *
 * Only profile.yaml (display metadata) and SOUL.md (persona, first lines) are read.
 * Secret-bearing files (.env, auth.json, config.yaml, vault/, ...) are NEVER opened;
 * marker existence is checked with lstat only.
 */
export const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const IDENTITY_MARKERS = ['config.yaml', '.env', 'SOUL.md', 'profile.yaml', 'auth.json', 'state.db'];

export interface DiscoveredProfile {
  id: string;
  path: string;
  displayName: string | null;
  description: string | null;
  soulExcerpt: string | null;
}

function hasIdentity(dir: string): boolean {
  return IDENTITY_MARKERS.some((m) => {
    try {
      const st = lstatSync(join(dir, m));
      return st.isFile() || st.isSymbolicLink();
    } catch {
      return false;
    }
  });
}

function readMeta(dir: string): { displayName: string | null; description: string | null } {
  try {
    const data = parse(readFileSync(join(dir, 'profile.yaml'), 'utf8')) as Record<string, unknown> | null;
    if (data && typeof data === 'object') {
      return {
        displayName: String(data.display_name ?? '').trim() || null,
        description: String(data.description ?? '').trim() || null,
      };
    }
  } catch {
    /* missing/corrupt profile.yaml is normal */
  }
  return { displayName: null, description: null };
}

function readSoul(dir: string): string | null {
  try {
    const text = readFileSync(join(dir, 'SOUL.md'), 'utf8');
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return lines.slice(0, 3).join(' ').slice(0, 400) || null;
  } catch {
    return null;
  }
}

export function discoverProfiles(hermesHome: string): DiscoveredProfile[] {
  const out: DiscoveredProfile[] = [];
  if (!existsSync(hermesHome)) return out;
  if (hasIdentity(hermesHome)) {
    out.push({ id: 'default', path: hermesHome, ...readMeta(hermesHome), soulExcerpt: readSoul(hermesHome) });
  }
  const profilesDir = join(hermesHome, 'profiles');
  let names: string[] = [];
  try {
    names = readdirSync(profilesDir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (name === 'default' || name.startsWith('.') || !PROFILE_ID_RE.test(name)) continue;
    const dir = join(profilesDir, name);
    try {
      if (!lstatSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (existsSync(join(profilesDir, '.deleted', name))) continue;
    if (!hasIdentity(dir)) continue;
    out.push({ id: name, path: dir, ...readMeta(dir), soulExcerpt: readSoul(dir) });
  }
  return out;
}
