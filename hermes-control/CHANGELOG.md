# Changelog

## Unreleased

### Added
- **Nightly Hermes auto-update (stable releases only).** Adds the `deploy/hermes-autoupdate.sh` wrapper around `hermes update`, with a launchd job for the Mac and a systemd timer for the Pi. None of these are installed yet.
- **Update status in Settings.** Hermes Control shows the result of the last update. See `docs/AUTO_UPDATE.md`.

## 0.1.0 — 2026-11-09

First working build. Nothing has been deployed, and no existing Hermes configuration has been touched.

### Added
- **Hermes audit.** A source-level audit of upstream Hermes Agent (commit `8a5a7ace`), written up in `docs/HERMES_AUDIT.md`, plus the read-only installation audit script `scripts/audit-hermes.sh`.
- **Backend.** A Fastify + `node:sqlite` server with:
  - cookie authentication, CSRF protection and rate-limited login
  - workspace isolation and an audit log
  - an append-only design for Hermes-derived data
- **Hermes integration:**
  - API server client: sessions, runs, SSE events with `Last-Event-ID` resume, approval, stop
  - Kanban via the CLI with `--json`
  - read-only profile discovery
- **Message delivery** with durable idempotency keys, restart recovery and honest failure states.
- **Deterministic routing.** DMs, @mentions and leading "Name," addressing, plus a per-channel default agent.
- **Telegram read-mirror** for Jeff, keyed by Hermes message id.
- **Approval center** for runs started from Hermes Control.
- **Frontend.** React + Tailwind PWA:
  - three-panel desktop layout and an iPhone tab layout
  - threads, @mention autocomplete, attachments
  - agent profiles with uploadable circular portraits
  - Kanban board, activity feed, settings, and light/dark themes
- **Tests.** 28 automated tests, plus a Playwright walkthrough at desktop and iPhone sizes.
- **Deployment preparation.** A Raspberry Pi plan (not executed), a systemd unit and a backup script.

### Known limitations
- Hermes Control cannot write into Jeff's Telegram chat as the user (Hermes refuses it by design). The DM with Jeff is a separate Hermes session.
- Approvals raised outside Hermes Control (Telegram, CLI) are not listed, because Hermes has no global pending-approvals API.
- Attachment contents are not forwarded to Hermes, because the API server accepts inline images only.
