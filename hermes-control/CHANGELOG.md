# Changelog

## Unreleased

### Added
- **Task work shows in the agents' chats.** When an agent gets a card on the task board, starts it, finishes it or gets stuck, a line appears in that agent's one-to-one chat. The finished result (or the blocking reason) is also posted into the chat of the agent that asked for it, so "Jeff, ask Harry…" comes back to Jeff's chat. Cards that existed before this version are not announced. A business's cards only appear in that business's workspace.
- **Start Fresh.** One-to-one chats have a button that starts the agent on a new Hermes conversation. History stays visible, a "New conversation" divider marks the break, and the agent keeps its long-term memory. Hermes never starts a new conversation by itself, and measurements on the Pi showed one two-day chat costing about 15–20 cents a message. The app flags long chats (30 turns or 60,000 characters) with a banner. Start Fresh is refused while a reply is still running.
- **Live progress on replies.** While an agent works, the bubble shows what it is doing ("Running a command", "Searching", "Asking a teammate") and a running clock. It says "taking a while" after two minutes, and "Waiting for your OK" with a link when the reply is blocked on an approval.
- **Listen.** Agent replies have a read-aloud button that uses the device's built-in voice.
- **Dictation.** A microphone in the message box, shown where the browser supports speech recognition; it falls back to the keyboard microphone.
- **`deploy/pi/speed-check.sh`** (read-only): shows why agents are slow. Covers Pi load, text sent with every message per agent, tools switched on, Telegram streaming mode, grouped gateway warnings, scheduled-job health and 7-day usage. `--ping` also times a one-word reply per agent.
- **`deploy/pi/setup-night-shift.sh`**: creates a six-job night shift for one business (research, website, outreach, ads, quality pass, morning brief). All jobs are created **paused**. They write drafts only, into `~/hermes-work/<tenant>/tonight/`. The script refuses to run without nightly backups, or if an agent has approvals switched off.
- **Phase 0 scripts for the Pi** (`deploy/pi/`), each backing up what it changes and printing an undo:
  - `phase0-check.sh`: read-only checks. Is a second machine polling the Telegram bots? Approval modes, connected-service trust levels, scheduled jobs that mention Hayes or Marty, listening ports, backups.
  - `enable-hermes-backup.sh`: a nightly 03:30 `hermes backup` of every agent (keeps 14) plus a Hermes Control database copy. Files are private and timer-driven; the first backup runs straight away and is checked.
  - `lockdown-mcp-trust.sh`: sets `trust: untrusted` on every connected service, so writes ask first. Flags agents whose approvals are switched off.
  - `enable-jeff-delegation.sh`: Kanban tools for Jeff (Telegram and Hermes Control), plus a chain-of-command section appended to his SOUL.md. Safe to run twice.
  - `add-business-workspaces.sh`: adds Atomic Fox Media and Vegas Couples Clash workspaces, each with its own Kanban tenant, and renames Atomic Fox to Atomic Fox Mitigation.
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
- **Start Fresh failed on real Hermes** with "Title … is already in use". Hermes requires unique conversation titles, and the fresh conversation reused the old one. Later conversations are now dated, and any clash is retried with a unique suffix. The test stand-in now enforces the same rule.
- The installer no longer says "Hermes integration is OFF" or shows a home-network address when your kept settings say otherwise.
From an independent code review, which found no access-control, injection or script-injection problems:
- **Login guessing limit could be bypassed** from the home network by faking a forwarding header. Only the local Tailscale proxy is trusted for it now.
- **Approvals could get stuck or be mislabelled.** A network hiccup left an approval unanswerable, and two taps at once could both be sent. An approval is now claimed once, and handed back if Hermes couldn't be reached.
- **Long replies were marked "Lost contact"** after six stream reconnects, even while Hermes was still working (long tools, waiting for an approval). Progress now resets the count.
- **Try Again** on a reply that Hermes itself had failed just failed again. It now starts a new attempt, and no longer touches other chats' stuck replies.
- **Thread reply counts** grew with every streamed word ("200 Replies" for one reply).
- **The Chats badge** counted messages from other businesses.
- **Switching chats quickly** could show the previous chat's messages; a failed load now says so, with Try Again.
- **Portrait downloads:** a disguised local address could get past the private-address check, and a download without a stated size could grow unbounded. Both closed.
- **Speed:** three missing database indexes added. Streamed text is no longer stored a second time as thousands of event rows; old rows are cleaned up.
- Task text starting with "-" could be misread as a command option. `?archived=false` was read as true.
- `deploy/backup.sh` never worked: `VACUUM INTO` was given a double-quoted name, which SQLite reads as a column. It now uses a string literal, and the result was verified with an integrity check.
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
