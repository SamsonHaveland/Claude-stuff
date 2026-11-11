# Architecture

## Overview

```
 iPhone / Mac browser (PWA)
        │  HTTPS (tailscale serve) · cookie session · ONE multiplexed SSE stream
        ▼
 ┌──────────────────────── Hermes Control (one Node 22+ process) ────────────────────────┐
 │ Fastify: REST + SSE + static SPA                                                       │
 │  ├─ auth (scrypt, httpOnly cookie, CSRF token, rate-limited login, audit log)          │
 │  ├─ workspace guard (every /api/w/:ws route; 404 on non-membership)                    │
 │  ├─ RunService ─────── POST /v1/runs · GET /v1/runs/{id}/events · /approval ───────┐   │
 │  ├─ TelegramMirror ─── GET /api/sessions?source=telegram · /messages (read-only) ─┤   │
 │  ├─ KanbanAdapter ──── execFile("hermes", ["kanban", …, "--json"]) ───────────────┤   │
 │  ├─ discovery ──────── read-only scan of ~/.hermes (marker files, profile.yaml)   │   │
 │  └─ SQLite (node:sqlite, WAL): Hermes Control's own state only                    │   │
 └────────────────────────────────────────────────────────────────────────────────────┼───┘
                                                                                      ▼
                       Hermes gateway (unchanged) — API server on 127.0.0.1:8642 /p/<profile>/
                       Telegram adapter (unchanged, sole poller) · Kanban dispatcher · approvals
```

**Stack and the reasons for it.** The original brief suggested Next.js. I chose a Vite SPA served by the API process instead, because it makes for one process on the Pi.

- **Frontend:** React 19, TypeScript and Tailwind 4, built with Vite into static files.
- **No SSR.** The data is private and single-user, so server rendering adds nothing.
- **Backend:** Fastify 5. Its dependencies are a handful of `@fastify/*` plugins, `zod` and `yaml`.
- **Database:** `node:sqlite`, built into Node 22.5+. There is no native module to compile on ARM64. The migration path to PostgreSQL is straightforward: plain SQL, and one migration table.

## Data model (Hermes Control's own DB)

| Table | Purpose |
|---|---|
| `users`, `auth_sessions` | Accounts (scrypt hashes). Session tokens are stored as SHA-256. Each session has a CSRF token. |
| `workspaces`, `workspace_members` | Isolation boundary. Member roles are `owner`, `member` or `viewer`. |
| `agents` | `profile_name` is the **execution identity** and is immutable here. `display_name`, `role` and `avatar_file` are presentation only. |
| `workspace_agents` | Which profiles may be used in which workspace. Comes from config. Empty means none (fail closed). |
| `conversations`, `conversation_agents` | Channel, DM and Telegram-mirror rows, each bound to one workspace. |
| `messages` | `workspace_id` is denormalized onto each row so every query can enforce it. `state` is one of `pending`, `streaming`, `final`, `failed`, `cancelled`. `source` is `hc`, `hermes_run` or `telegram_mirror`. `(source, external_id)` is UNIQUE, for idempotency. |
| `attachments` | Stored under `data/uploads/<workspace_id>/<random>`. Served only through workspace-checked routes. |
| `hermes_bindings` | One API-owned Hermes session per (conversation, agent). |
| `runs`, `run_events` | Persisted run state: the Hermes run id, the idempotency key and `last_seq`. Used for resume. |
| `approvals` | Mirrors `approval.request` events. The status never says "approved"; it says `submitted` or `confirmed` (Hermes returned 2xx). |
| `mirror_cursors`, `audit_log` | Mirror change detection, and an append-only record of actions. |

## Message flow (human → agent)

1. `POST /api/w/:ws/conversations/:id/messages`. The server checks membership and that the conversation belongs to that workspace, then stores the human message.
2. **Routing** (`services/routing.ts`) is deterministic and uses no LLM:
   - A DM goes to the DM's agent.
   - In a channel, a message goes to every agent that is addressed explicitly (`@jeff`, or a leading "Jeff, …") and is both a channel member and allowed in the workspace.
   - If no agent is addressed, the message goes to the channel's default agent, or to nobody.
   - "Jeff, ask Debra …" goes to **Jeff only**. Jeff delegates through Hermes (Kanban or delegation). Hermes Control never invents Debra's answer.
3. For each target, the server stores a `pending` reply and a `runs` row with a random idempotency key, then calls `RunService.drive`:
   - It finds or creates the binding session: `POST /api/sessions` with `id = hc_<ws>_<conv>_<agent>_<rand>`.
   - It calls `POST /v1/runs {input, session_id}` with `Idempotency-Key` and `X-Hermes-Session-Key: hermes-control:<ws>:<conv>`, which scopes long-term memory.
   - It follows the SSE stream. Each event is stored with its `seq`, and duplicates (`seq ≤ last_seq`) are dropped.
   - `message.delta` events are appended to the reply as they arrive (streaming).
   - The terminal `run.<status>` sets the final text from `output`, or marks the reply failed with Hermes's error.
4. Browsers receive `message.upsert`, `activity` and `approvals.changed` events over **one** SSE connection per tab, filtered by workspace membership.

## Error handling and recovery

| Situation | Behaviour |
|---|---|
| Hermes unreachable, wrong key, 4xx | Reply set to `failed` with the real error. The UI offers **Retry**, which reuses the same idempotency key, so Hermes replays rather than re-runs if the first attempt actually went through. |
| SSE stream drops | Reconnect with `Last-Event-ID`, with exponential backoff (up to 6 attempts). If the stream ends with no terminal event, reconcile from `GET /v1/runs/{id}`. If still unresolved, the run is marked `unknown` with a clear message. Nothing is assumed. |
| Hermes Control restarts | `resumeOpenRuns()` continues every non-terminal run. A crash between submit and storing the run id is safe, because the idempotency key makes Hermes replay. |
| Gateway restarts mid-run | Hermes reports `interrupted` or `unknown`, and Hermes Control shows exactly that. |
| Telegram mirror errors | Recorded in `/api/system/status` and shown in Settings. Polling continues on the next tick. Telegram is unaffected. |
| Kanban CLI missing or failing | The task UI shows "Kanban unavailable: <reason>". |
| Approval answered elsewhere | Hermes returns 409, and Hermes Control shows `rejected (stale or answered elsewhere)`. |
| Browser offline | The service worker serves only the app shell (API responses are never cached). The SSE client reconnects with backoff and refetches. |

## Configuration

`hermes-control.config.yaml` (git-ignored; see `config.example.yaml`) holds workspaces, channels, profile overrides and mirror targets. Secrets live only in the server environment: `HC_HERMES_KEY_<PROFILE>`.
