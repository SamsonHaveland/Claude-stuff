# Hermes Control

A private, Slack-style web app (PWA) for talking to and managing your [Hermes Agent](https://github.com/NousResearch/hermes-agent) multi-agent system. It works on Mac, iPhone and desktop browsers.

It is a separate application. It **never modifies your Hermes installation**. It talks to Hermes only through documented interfaces: the gateway's API server and the `hermes kanban` CLI. It reads `~/.hermes` read-only to discover profiles. See `docs/HERMES_AUDIT.md` for what was verified and how.

## What works

| Feature | Status |
|---|---|
| Three-panel UI: workspaces, channels, DMs, agent directory, tasks, approvals, activity, settings, threads, light/dark, iPhone layout | Built, and tested in Chromium at desktop and iPhone 15 Pro sizes |
| Read-only discovery of Hermes profiles | Built and unit-tested. **Not yet run against your Mac.** |
| DM / @mention routing to the right Hermes profile, with streaming and the real final reply | Built and tested against a contract-faithful fake. **Needs the API server enabled on your Mac for a real test.** |
| Approvals for runs started here (only "confirmed" after Hermes accepts the decision) | Built and tested against the fake |
| Telegram chats (Jeff, Debra) shown in Hermes Control, deduplicated | Built and tested against the fake |
| Two-way Telegram sync (type in the app, copy posted to Telegram from the agent's bot) | Built and tested; off until switched on in Settings. See `docs/INTEGRATION_PLAN.md` |
| Kanban board, create, assign, comment, block/unblock/complete/archive | Built (via the CLI). **Needs `hermes` on PATH.** |
| Agent portraits (upload, circular, replaceable without touching Hermes) | Built |

## Quick start (on your Mac)

You need Node ≥ 22.5 (`brew install node`).

```bash
git clone <this repo> && cd Claude-stuff/hermes-control
npm ci && npm run build
cp config.example.yaml hermes-control.config.yaml   # edit workspaces/channels
cp .env.example .env && chmod 600 .env              # leave empty until the API server is enabled
npm run user:create -- samson "Samson" admin "*:owner"   # prompts for a password (≥12 chars)
./scripts/start.sh                                   # http://<mac-ip>:8787 from your iPhone on the same Wi-Fi
```

With `hermes.mode: disabled`, the UI runs and stores messages but delivers nothing to agents, and says so on screen. To connect Jeff, follow `docs/INTEGRATION_PLAN.md` step 2 (it needs your approval because it edits Jeff's `.env` and restarts the gateway). Then set `mode: live` and fill in `HC_HERMES_KEY_JEFF`.

**Before changing anything:** run `bash scripts/audit-hermes.sh`. It is read-only and prints no secrets.

**iPhone:** open the URL in Safari and choose Share → Add to Home Screen. The service worker activates only over HTTPS. Use `tailscale serve --bg --https=443 http://127.0.0.1:8787` for a private HTTPS URL that works away from home.

## Development

```bash
npm run dev:server     # API on :8787 (tsx watch)
npm run dev:web        # Vite on :5173, proxying /api
npm test               # 28 automated tests (vitest)
npm run typecheck
HC_FAKE_KEY=dev-key npx tsx scripts/fake-hermes.ts   # LOCAL TEST DOUBLE on :18642; every reply is labelled [FAKE HERMES]
```

## Layout

```
server/src/
  hermes/      client.ts (API server), kanban.ts (CLI), discovery.ts (read-only)
  services/    runs.ts (delivery/approvals), telegramMirror.ts, routing.ts, bootstrap.ts, bus.ts
  routes/      api.ts — every workspace route goes through requireWorkspace()
  db/          node:sqlite + migrations
server/test/   unit + integration tests, fakeHermes.ts (test double)
web/src/       React SPA (pages/, components/, lib/)
docs/          HERMES_AUDIT, INTEGRATION_PLAN, ARCHITECTURE, SECURITY, DEPLOYMENT_PI
deploy/        systemd unit, backup script, optional macOS LaunchAgent (none installed)
scripts/       audit-hermes.sh (read-only), start.sh, fake-hermes.ts (dev only)
```
