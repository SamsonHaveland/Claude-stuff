# Integration Plan

This plan uses only the interfaces verified in `HERMES_AUDIT.md`. It is ordered so that nothing touches your live Hermes until you approve each step.

## Verified integration options

| Need | Chosen interface | Why | Rejected alternatives |
|---|---|---|---|
| Send to an agent and get its real reply | API server Runs API: `POST /v1/runs` with an API-owned `session_id`, then `GET …/events` (SSE) | Documented and stable. Idempotency keys survive restarts, `Last-Event-ID` resume and approvals are built in. | Reading or writing `state.db` (the gateway must be the only writer). OpenAI `chat/completions` (no per-run approval control). |
| Read Jeff's Telegram conversation | `GET /api/sessions?source=telegram`, then `GET /api/sessions/{id}/messages`, polled every *n* seconds | Read-only. Never touches Telegram. No second poller. | Second bot poller (forbidden, and it breaks the lock). Hooks (500-character truncation, and they modify Hermes). Direct DB reads (unstable schema). |
| Kanban | `hermes kanban … --json` via `execFile` | Same code path as the dashboard. No config change. | Dashboard REST (needs a pinned dashboard token, which is a config change). Direct DB access. |
| Approvals | Per-run `approval.request` event, answered with `POST /v1/runs/{id}/approval` | The only documented external approval API. | A global approval list (does not exist). |
| Agent inventory | Read-only scan of `~/.hermes` using Hermes's own marker rules, plus `profile.yaml` and `SOUL.md` | `hermes profile list` has no JSON output. | Parsing CLI text. |
| Agent status | `GET /health` for each profile URL, plus runs in progress | Real telemetry only. | Any "online" assumption. |

## Telegram synchronization: what is and isn't possible

| Direction | Status |
|---|---|
| Telegram → Hermes Control | **Supported.** Each message in an agent's Telegram session appears once, in order and with its original timestamp, in "<Agent> on Telegram". It's keyed by Hermes message id, so restarts and re-polls never duplicate. Configured for Jeff and Debra, the two agents with their own bots (checked on hermes-pi). |
| Hermes Control → Telegram (two-way, off by default) | **Supported, as the bot.** With Two-way on (Settings › Telegram), you can type in "<Agent> on Telegram". The turn runs in Hermes Control's own API session for that chat. The Telegram messages since your last Hermes Control turn go along as context, so the agent knows what was said in Telegram. When the reply completes, the exchange (`💻 From Hermes Control` / You / Agent) is posted to the agent's Telegram home chat with `hermes -p <agent> send --to telegram`. |
| Agent remembers Hermes Control turns in Telegram | **Yes, with a delay.** `hermes send` also writes the copy into the agent's Telegram session transcript. Verified on hermes-pi v0.23.0: the test message was stored in Jeff's current Telegram session. The live gateway keeps an active conversation in memory, so the agent may only see the copy after its session is reloaded (a quiet period or a gateway restart). |
| Hermes Control → Telegram *as you* | **Not possible.** Telegram doesn't let a bot post as a user, and the API server refuses writes into a Telegram-owned session (409 `permission_denied`). |
| One single Hermes session for both | **No.** Context crosses in both directions (as described above), but there are two sessions underneath. |

How two-way is kept safe:

- Copies start with `💻 From Hermes Control`, and the mirror skips those lines, so a copy never comes back as a new message (no echo loop).
- Each completed run is copied at most once (`mirror_cursors` key `tgcopy:run:<id>`), including across restarts. A failed copy is recorded in the audit log and shown in Settings. It is never retried silently.
- The text goes to `hermes send` on stdin, never as command arguments. `MEDIA:` and `[[as_document]]` directives are neutralised, so a reply can't make Hermes attach a local file. Copies are capped below Telegram's 4,096-character limit.
- Only admins can switch Two-way. Each switch is audit-logged.
- Enable it with `deploy/pi/enable-telegram-sync.sh`. The script backs up the config, changes only the `telegramMirror` lines, leaves two-way off, and can be undone with one command.

These rules hold regardless:

- Telegram keeps working whether Hermes Control is up or down.
- No second poller is created.
- The bot token never leaves Hermes.

**Candidate for later:** a single shared session through the gateway WebSocket (`hermes gateway attach --json` → `prompt.submit` on the Telegram session). The docs point cross-surface writers to it, but its behaviour with messaging-owned sessions is unconfirmed. If a test shows that it drives Jeff's Telegram session *and* delivers replies to Telegram, it would give true two-way sync without touching the Telegram gateway.

## Steps that need your approval (in order)

1. **Run the read-only audit.** `bash scripts/audit-hermes.sh`. Changes nothing.
2. **Enable the API server for Jeff.** This is a change to Hermes configuration. Add these lines to Jeff's profile `.env`:

   ```
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<random 32+ bytes>
   ```

   If the gateway is not multiplexed, also give Jeff his own `API_SERVER_PORT`.

   Then restart the gateway with `hermes gateway restart`. Telegram reconnects automatically.

   - **Impact:** the gateway restarts. A loopback HTTP listener opens.
   - **Rollback:** delete those lines and restart again.
   - The key is stored once more in Hermes Control's server environment (`HC_HERMES_KEY_JEFF`) and never in the browser.
3. **Test from Hermes Control.** Send Jeff a DM and confirm his real reply. Check that Telegram still works.
4. **Enable the Telegram mirror** (`telegramMirror[0].enabled: true`). This is a Hermes Control setting only.
5. **Repeat step 2 for the other profiles** you want reachable.
6. *(Optional)* Test the gateway WebSocket for true two-way sync.
7. *(Optional)* Allow `hermes send` as the bot for outbound Telegram posts from Hermes Control.

## Future: separate Telegram bots per agent

When each agent has its own bot, each profile's gateway platform owns its own token. Hermes Control needs no redesign: add one `telegramMirror` entry per profile. The mirror code is per-profile already.
