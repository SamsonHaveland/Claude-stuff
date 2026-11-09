import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const expandHome = (p: string) => (p.startsWith('~') ? p.replace(/^~/, homedir()) : p);

const ProfileOverride = z.object({
  baseUrl: z.string().url().optional(),
  /** Name of the environment variable holding this profile's API_SERVER_KEY. Never the key itself. */
  keyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  displayName: z.string().optional(),
  role: z.string().optional(),
});

const ConfigSchema = z.object({
  server: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().default(8787),
    /** Origin users load the app from (used for CSRF origin checks). */
    allowedOrigins: z.array(z.string()).default([]),
    secureCookies: z.boolean().default(false),
  }).default({ host: '127.0.0.1', port: 8787, allowedOrigins: [], secureCookies: false }),
  dataDir: z.string().default('./data'),
  hermes: z.object({
    /** 'live' talks to Hermes; 'disabled' runs the UI with no Hermes connectivity (nothing fabricated). */
    mode: z.enum(['live', 'disabled']).default('disabled'),
    /** Hermes home, used ONLY for read-only discovery of profile names / SOUL.md. */
    home: z.string().default('~/.hermes'),
    /** Default API server URL. With gateway.multiplex_profiles, named profiles are reached at /p/<profile>/. */
    baseUrl: z.string().url().default('http://127.0.0.1:8642'),
    multiplex: z.boolean().default(true),
    requestTimeoutMs: z.number().int().default(30_000),
    /** Hermes CLI used for Kanban (`hermes kanban ... --json`). Executed without a shell. */
    cliPath: z.string().default('hermes'),
    kanbanBoard: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).optional(),
    profiles: z.record(z.string(), ProfileOverride).default({}),
  }).default({ mode: 'disabled', home: '~/.hermes', baseUrl: 'http://127.0.0.1:8642', multiplex: true, requestTimeoutMs: 30_000, cliPath: 'hermes', profiles: {} }),
  /** Status file written by deploy/hermes-autoupdate.sh (read-only here). */
  autoUpdate: z.object({ statusFile: z.string().default('~/.hermes-autoupdate/status.json') }).default({ statusFile: '~/.hermes-autoupdate/status.json' }),
  telegramMirror: z.array(z.object({
    profile: z.string(),
    enabled: z.boolean().default(false),
    pollSeconds: z.number().int().min(2).default(5),
    workspace: z.string().default('general'),
  })).default([]),
  workspaces: z.array(z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    /** Hermes profiles permitted in this workspace. Empty = none (fail closed). '*' = all. */
    agents: z.array(z.string()).default([]),
    /** Hermes Kanban is one board for all profiles; a tenant keeps this workspace's tasks separate. */
    kanbanTenant: z.string().regex(/^[A-Za-z0-9_.-]+$/).optional(),
    channels: z.array(z.object({
      name: z.string().regex(/^[a-z0-9-]+$/),
      topic: z.string().optional(),
      agents: z.array(z.string()).default([]),
      defaultAgent: z.string().optional(),
    })).default([]),
  })).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(path = process.env.HC_CONFIG ?? 'hermes-control.config.yaml'): Config {
  const raw = existsSync(path) ? parse(readFileSync(path, 'utf8')) ?? {} : {};
  const cfg = ConfigSchema.parse(raw);
  cfg.dataDir = resolve(expandHome(cfg.dataDir));
  cfg.hermes.home = resolve(expandHome(cfg.hermes.home));
  cfg.autoUpdate.statusFile = resolve(expandHome(cfg.autoUpdate.statusFile));
  return cfg;
}

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw ?? {});
}
