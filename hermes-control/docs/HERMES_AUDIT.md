# Hermes Audit

**Status: source-level audit complete; your installation has NOT been audited yet.**

## How this audit was done (read this first)

Hermes Control was built in a cloud container that has **no access to your Mac**. No Remote Control folder was shared with the session. So `/Users/samsonhaveland/.hermes` was never inspected, and none of the following is known about your install:

- installed version
- the real profile list (beyond the six names you gave)
- gateway mode
- whether the API server is enabled
- Telegram configuration

What was audited instead:

| Source | Detail |
|---|---|
| Upstream Hermes Agent source | `github.com/NousResearch/hermes-agent`, `main` at commit `8a5a7ace` (2026‑11‑09, tag `v0.23.0+canary.20261109T065146Z`) |
| Upstream docs | `website/docs/**` in the same checkout |

Your installation may be older. `hermes update` follows the stable release channel by default, so some interfaces below may differ on your Mac.

**Next step:** run `bash scripts/audit-hermes.sh > hermes-audit-report.txt` on the Mac. It is read-only, and it prints file/variable *presence* and never secret values. The results go into the "Installation facts" section at the end of this file.

Legend: **VERIFIED** = confirmed in upstream code (file:line) or official docs. **INFERRED** = reasoned, not confirmed. **UNKNOWN** = needs your machine.

---

## 1. Version and commands

- **VERIFIED:** `hermes --version` prints the version, install directory, method and Python version (`hermes_cli/_startup_fast.py:187-217`). `pyproject.toml` declares `0.0.0`, and the real version is computed at runtime.
- **VERIFIED:** `hermes update --check` / `--plan` are read-only previews. Receipts are written to `~/.hermes/logs/update_receipts/latest.json`.
- **VERIFIED:** Python `>=3.11,<3.15`. The comments say 3.14 is the supported target (`pyproject.toml:11`).
- **UNKNOWN:** your installed version.

## 2. Profiles

- **VERIFIED:** The default profile is `~/.hermes` itself (id `default`). Named profiles are `~/.hermes/profiles/<id>/`, with id regex `^[a-z0-9][a-z0-9_-]{0,63}$`.
- **VERIFIED:** A directory counts as a profile only if it has one of these markers: `config.yaml`, `.env`, `SOUL.md`, `profile.yaml`, `auth.json`, `state.db` (`hermes_constants.py:399-408`).
- **VERIFIED:** `profiles/.deleted/<id>` tombstones and `profiles/default` are excluded.
- **VERIFIED:** Display metadata lives in `profile.yaml`: `display_name`, `description`, `ui_meta.hermes-bots.title` (`hermes_cli/profiles.py:871-896`). The persona lives in `SOUL.md`.
- **VERIFIED:** Secret-bearing files are:
  - `.env`, `auth.json`, `auth/google_oauth.json`, `.op.env`, `npmrc`
  - `*token*.json`, `honcho.json`, `mem0.json`, `webhook_subscriptions.json`
  - `vault/`, `mcp-tokens/`, `pairing/`, `browser-profile/`

  Source: `hermes_cli/profiles.py:163-176`. Hermes Control never opens any of these.
- **VERIFIED:** `hermes profile list` has **no** `--json` flag. `hermes profile show <name>` and `hermes gateway list` exist.
- **UNKNOWN:** the full profile inventory on your Mac. Hermes Control discovers it at startup using the rules above.

## 3. Gateway architecture

- **VERIFIED:** `gateway.multiplex_profiles` defaults to **true**. One gateway process, owned by the default profile, serves every profile. If its preflight fails, it falls back to serving the default profile only (`multi-profile-gateways.md:64-118`).
- **VERIFIED:** Commands: `hermes [-p X] gateway run|start|stop|restart|status [--deep]|install|list`. The launchd labels are `ai.hermes.gateway` and `ai.hermes.gateway-<name>` (`hermes_cli/gateway_launchd.py:33`).
- **VERIFIED:** The control socket `$HERMES_HOME/gateway.sock` handles coordination only (status, tickets, rescans). It has **no** send-message command (`gateway/control_socket.py`).

## 4. API server (primary integration point)

All items here are **VERIFIED** against `gateway/platforms/api_server*.py` and `website/docs/user-guide/features/api-server.md`.

**Enabling it**
- It is off by default. Turn it on with `API_SERVER_ENABLED=true` and `API_SERVER_KEY=…`.
- It binds `127.0.0.1:8642`.
- The bearer key is required even on loopback.

**Multi-profile routing**
- With multiplexing, profiles are served at `/p/<profile>/…`.
- **Each named profile needs its own `API_SERVER_KEY`** in its `.env`. A profile without one is unreachable (fails closed). Since July 2026, the default profile's key is rejected on other profiles' prefixes.

**Endpoints Hermes Control uses**

| Endpoint | Purpose |
|---|---|
| `GET /health` | Unauthenticated liveness probe |
| `GET /v1/capabilities` | Feature discovery |
| `POST /api/sessions` | Create an API-owned session. Body `{id?, title?}`; returns `{session:{id}}`, HTTP 201 |
| `GET /api/sessions?source=&limit=` | List sessions. Read handlers check only existence and auth, not which surface owns the session (`api_server.py:2519-2570, 2730-2762`) |
| `GET /api/sessions/{id}/messages?order=&limit=&inline_images=false` | Message rows: `id, role, content, timestamp, display_kind…` |
| `POST /v1/runs` | Submit a turn. Body `{input, session_id?}`; returns HTTP 202 `{run_id, status}`. Supports a durable `Idempotency-Key` (24 h, survives restart; replays return `Idempotency-Replayed: true`) |
| `GET /v1/runs/{id}` | Status, `output`, `pending_controls` |
| `GET /v1/runs/{id}/events` | SSE. Each frame has `id: <seq>`. Resume with `Last-Event-ID` (`api_server_runs.py:1277`). Sends a `replay.truncated` event if the buffer expired (about 5 minutes) |
| `POST /v1/runs/{id}/approval` | Answer an approval. Body `{choice, request_id?, execution_generation?}`. Choices are `once` / `session` / `always` / `deny`; aliases `approve` / `allow` map to `once`. Answers 409 if stale or not pending (`api_server_runs.py:1358-1413`) |
| `POST /v1/runs/{id}/stop` | Stop a run |

**Event names (from code)**
- `run.queued`, `run.started`
- `message.started`, `message.delta` (`delta`), `message.interim`, `reasoning.available`
- `tool.started`, `tool.progress`, `tool.completed`, `tool.failed`
- `subagent.start`, `subagent.complete`
- `approval.request` (redacted `command`, `description`, `choices`), `approval.responded`
- `run.steered`, `run.stopping`, `replay.truncated`
- Terminal: `run.<status>` with `status ∈ {completed, failed, cancelled, interrupted}`, carrying `output`. A run can also report `unknown` after an owner restart. This is non-terminal and is cleared with `POST /v1/runs/{id}/resolve-unknown`.

**Hard constraint**
- **VERIFIED:** The API server **refuses to bind a session owned by another surface** (CLI, TUI, Desktop, ACP or messaging, which includes Telegram). It returns HTTP 409 `permission_denied` before admission (`api-server.md`, "API sessions are their own sessions").
- **VERIFIED:** The API server does **not** accept file uploads, only inline images.

## 5. Telegram

**How it runs**
- **VERIFIED:** Long polling is the default. Webhook mode is used if `TELEGRAM_WEBHOOK_URL` is set.
- **VERIFIED:** The token is `TELEGRAM_BOT_TOKEN` in the profile's `.env`.
- **VERIFIED:** A machine-local lock allows **one poller per bot token** (`plugins/platforms/telegram/adapter.py:3018`). Across machines, Telegram itself answers 409. The docs say: "Do not reuse the same bot token in multiple running gateways."

**Ways to send**
- **VERIFIED:** `hermes send --to telegram[:chat_id] "text"` calls the Bot API directly as the **bot**, and then mirrors the text into the chat's session as an *assistant* turn. It is not user input to Jeff.
- **VERIFIED:** A webhook route with `deliver: telegram` runs its **own** session and posts the reply to the chat.

**Other surfaces**
- **VERIFIED but untested for Telegram:** the docs direct cross-surface writers to the gateway WebSocket (`prompt.submit` on the shared session, protocol `hermes-gateway-v1`, ticket from `hermes gateway attach --json`). Operator scope "does not upgrade messaging … credentials" (`gateway-local-sessions.md:88-90`). Whether a WebSocket client can drive Jeff's *Telegram* session, and whether the reply would then be delivered to Telegram, was **not confirmed**.

## 6. Session and message storage

- **VERIFIED:** Each profile has `state.db` (SQLite, WAL, schema v31) with tables `sessions` and `messages`. The docs say the gateway is the **only writer**; other processes must not write it. Read-only browsing is tolerated, but the schema changes between versions. **Hermes Control never opens `state.db`.** It reads through the API.

## 7. Kanban

**Storage**
- **VERIFIED:** One **global** board shared by every profile: `~/.hermes/kanban.db`, plus `~/.hermes/kanban/boards/<slug>/kanban.db` for other boards. SQLite, WAL.

**Tasks**
- **VERIFIED:** Task fields: `id, title, body, assignee (profile), status, priority, tenant, created_at, started_at, completed_at, result, last_failure_error`, plus related comments, events and runs.
- **VERIFIED:** Statuses: `triage, todo, scheduled, ready, running, blocked, review, done, archived`.

**CLI**
- **VERIFIED:** `hermes kanban [--board B] create|list|show|assign|comment|block|unblock|complete|archive …`.
- `--json` is available on `create`, `list`, `show`, and some other commands.
- There is **no** `move` command.

**Dispatch**
- **VERIFIED:** The gateway dispatcher ticks every 60 s and runs `hermes -p <assignee> chat -q …`.

**Other access paths**
- **VERIFIED:** The dashboard has a REST/WS plugin at `:9119/api/plugins/kanban/…`. It needs the dashboard session token. That token is regenerated on every start unless `HERMES_DASHBOARD_SESSION_TOKEN` is pinned.
- Hermes Control uses the **CLI** instead, because that needs no Hermes config change.

## 8. Approvals

- **VERIFIED:** `approvals.mode` is `smart` (default), `manual` or `off`. Unanswered prompts are denied after `timeout`, default 300 s. `approvers` narrows who may answer on messaging platforms.
- **VERIFIED:** Approvals can be answered from:
  - the CLI
  - Telegram (buttons, `/approve`, `/deny`)
  - the TUI or Desktop
  - the API server, per run only
- **VERIFIED (by absence):** There is **no global "list pending approvals" endpoint**. Hermes Control can only show approvals for runs it started itself.

## 9. Extension mechanisms

**Gateway hooks**
- **VERIFIED:** `<profile>/hooks/<name>/HOOK.yaml` + `handler.py`.
- Events: `agent:start`, `agent:end` (with `platform`, `chat_id`, `session_id`, `message`/`response`), among others.
- `message` and `response` are truncated to 500 characters.
- Hooks are awaited in-line, so a slow hook delays the turn.

**Plugin hooks**
- **VERIFIED:** e.g. `pre_gateway_dispatch`, `post_llm_call`.
- There is no outbound-delivery hook, by design.

**Outbound webhooks**
- **VERIFIED:** `hooks.outbound` in config sends HMAC-signed POSTs.

None of these are installed by Hermes Control. They would modify Hermes and require your approval.

## 10. ARM64 / Raspberry Pi

- **VERIFIED:** Linux aarch64 and Docker aarch64 are listed as supported. Tested on Ubuntu, with glibc and systemd required.
- **VERIFIED:** The Docker image `nousresearch/hermes-agent` is multi-arch (amd64/arm64), runs Python 3.14 and uses Debian trixie.
- **VERIFIED:** Raspberry Pi is never mentioned in the docs. There is no Home Assistant OS add-on; the HA integration is a client plugin.
- **INFERRED:** Home Assistant **OS** is an appliance OS. It does not support arbitrary containers or native services outside add-ons. Running Hermes *on* HA OS is therefore not a supported path. See `DEPLOYMENT_PI.md`.
- **INFERRED:** On a Pi, local models would run CPU-only. Hosted model providers are unaffected.

---

## Installation facts (fill from `scripts/audit-hermes.sh`)

| Fact | Value |
|---|---|
| Hermes version | _pending_ |
| Profiles discovered | _pending_ |
| Multiplexed gateway? | _pending_ |
| API server enabled / port | _pending_ |
| Per-profile `API_SERVER_KEY` present | _pending_ |
| Jeff's Telegram: polling or webhook | _pending_ |
| Approval mode | _pending_ |
| Kanban boards / task count | _pending_ |
