import { execFile } from 'node:child_process';
import type { Config } from '../config.js';
import { HermesError } from './client.js';

/**
 * Kanban via the supported Hermes CLI (hermes_cli/kanban_parser.py upstream).
 * The CLI writes through the same kanban_db code as the dashboard; Hermes Control
 * never opens kanban.db itself. Commands with machine-readable output use --json.
 * Arguments go through execFile (no shell) and positionals follow "--" so a title
 * beginning with "-" cannot be parsed as a flag.
 */
export interface KanbanTask {
  id: string;
  title: string;
  body?: string | null;
  assignee?: string | null;
  status: string;
  priority?: number | null;
  tenant?: string | null;
  created_by?: string | null;
  created_at?: number | null;
  started_at?: number | null;
  completed_at?: number | null;
  result?: string | null;
  last_failure_error?: string | null;
  [k: string]: unknown;
}

export interface KanbanTaskDetail {
  task: KanbanTask;
  comments: { author: string; body: string; created_at: number }[];
  events: { kind: string; payload: unknown; created_at: number; run_id?: string | null }[];
  runs: Record<string, unknown>[];
  [k: string]: unknown;
}

const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type Runner = (file: string, args: string[]) => Promise<string>;

const defaultRunner: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err) reject(new HermesError(`hermes kanban failed: ${(stderr || err.message).toString().slice(0, 400)}`, 502, 'kanban_cli_failed'));
      else resolve(stdout.toString());
    });
  });

export class KanbanAdapter {
  constructor(private cfg: Config, private run: Runner = defaultRunner) {}

  private base(): string[] {
    return this.cfg.hermes.kanbanBoard ? ['kanban', '--board', this.cfg.hermes.kanbanBoard] : ['kanban'];
  }

  private async json<T>(args: string[]): Promise<T> {
    if (this.cfg.hermes.mode !== 'live') throw new HermesError('Hermes integration is disabled', 503, 'hermes_disabled');
    const out = await this.run(this.cfg.hermes.cliPath, [...this.base(), ...args]);
    try {
      return JSON.parse(out) as T;
    } catch {
      throw new HermesError('hermes kanban returned non-JSON output', 502, 'kanban_bad_output');
    }
  }

  private async plain(args: string[]): Promise<string> {
    if (this.cfg.hermes.mode !== 'live') throw new HermesError('Hermes integration is disabled', 503, 'hermes_disabled');
    return this.run(this.cfg.hermes.cliPath, [...this.base(), ...args]);
  }

  async list(filter: { assignee?: string; status?: string; archived?: boolean; tenant?: string } = {}): Promise<KanbanTask[]> {
    const args = ['list', '--json'];
    if (filter.tenant) args.push('--tenant', filter.tenant);
    if (filter.assignee) { assertProfile(filter.assignee); args.push('--assignee', filter.assignee); }
    if (filter.status) { if (!/^[a-z_]+$/.test(filter.status)) throw new HermesError('bad status', 400); args.push('--status', filter.status); }
    if (filter.archived) args.push('--archived');
    return this.json(args);
  }

  async show(id: string): Promise<KanbanTaskDetail> {
    assertTaskId(id);
    return this.json(['show', '--json', '--', id]);
  }

  async create(input: { title: string; body?: string; assignee?: string; priority?: number; tenant?: string; idempotencyKey: string }): Promise<KanbanTask> {
    const args = ['create', '--json', '--idempotency-key', input.idempotencyKey];
    if (input.tenant) args.push('--tenant', input.tenant);
    if (input.body) args.push(`--body=${input.body}`);
    if (input.assignee) { assertProfile(input.assignee); args.push('--assignee', input.assignee); }
    if (input.priority !== undefined) args.push('--priority', String(Math.trunc(input.priority)));
    args.push('--', input.title);
    return this.json(args);
  }

  async assign(id: string, profile: string | null) {
    assertTaskId(id);
    if (profile) assertProfile(profile);
    return this.plain(['assign', '--', id, profile ?? 'none']);
  }

  async comment(id: string, text: string, author: string) {
    assertTaskId(id);
    return this.plain(['comment', `--author=${author}`, '--', id, text]);
  }

  /** Only the verified status-transition subcommands; Hermes enforces the workflow rules. */
  async transition(id: string, action: 'block' | 'unblock' | 'complete' | 'archive', reason?: string) {
    assertTaskId(id);
    if (action === 'block') return this.plain(['block', '--', id, reason || 'Blocked from Hermes Control']);
    if (action === 'complete' && reason) return this.plain(['complete', `--result=${reason}`, '--', id]);
    return this.plain([action, '--', id]);
  }
}

function assertTaskId(id: string) {
  if (!TASK_ID_RE.test(id)) throw new HermesError('Invalid task id', 400, 'invalid_task_id');
}
function assertProfile(p: string) {
  if (!PROFILE_RE.test(p)) throw new HermesError('Invalid profile name', 400, 'invalid_profile');
}
