# Changelog

## Unreleased

### Added
- **Two-way Telegram sync** for agents with their own bot (Jeff and Debra):
  - Their Telegram chats show up in Hermes Control as before.
  - With **Settings › Telegram › Two-way** on, you can also type in that chat. The agent gets your recent Telegram messages as context, and the exchange is copied into Telegram from the agent's bot using Hermes's own `hermes send`. There's no bot token in Hermes Control and no second poller.
  - Copies are never mirrored back. Each exchange is copied at most once, and failures show in Settings.
  - Off by default. `deploy/pi/enable-telegram-sync.sh` turns the Telegram chats on and leaves two-way off.
- **New app icon:** a speech bubble with a messenger's wing, with a separate version for Android's round mask.

- **Create Character.** On an agent's profile, or for everyone at once from Agents, Hermes Control asks each agent in its chat to design its own name, job title, bio and a photorealistic portrait, using the agent's own image tool.
  - You preview each result and choose Use This, Try Again or Keep Current.
  - Presentation only: the Hermes profile is never changed.
  - Pictures are accepted only from public https addresses (private addresses are blocked, including after redirects) or from Hermes image-cache folders, and must be real JPEG/PNG/WebP files under 10 MB.
- **`hermes.hiddenProfiles`** setting, default `[default]`: hides profiles from Hermes Control without touching Hermes.

### Changed
- **Apple-style redesign.** The app is now modelled on Messages:
  - A chat list with photos, last-message previews and unread dots, plus iMessage-style bubbles with a typing indicator.
  - Plain-language failures, such as "Jeff didn't reply. Try Again".
  - Tap-to-ask name chips in groups, so there's no need to type @mentions.
  - Four plain destinations (Chats, To-Dos, Needs You, Settings), using a tab bar on iPhone and the sidebar on Mac.
  - Approvals become big Allow / Don't Allow buttons. Kanban is shown as To Do, Doing and Done.
  - Visual style: system font, iOS colours, translucent bars and grouped lists. Reduced motion, reduced transparency and higher contrast are respected.

### Fixed
- **Agent replies now render Markdown**: headings, bold, lists, tables, checklists, code and links. It's done safely: no raw HTML, only http(s) and mailto links, and remote images appear as links. Chat-list previews show plain text.
- The iPhone toolbar no longer covers the message box (dynamic viewport height), and tables scroll sideways instead of breaking words.
- The "Live" indicator could stay on "Connecting…" after a page reload even though updates were connected.
- Base CSS was overriding utility colours on buttons and inputs.
- The message box now starts fresh for each chat.

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
