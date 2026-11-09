# Security

## Threat model

Hermes Control is a private app for one owner and possibly a few trusted collaborators. It is reached over a LAN or Tailscale. It fronts agents that can run terminal commands, so **a session on Hermes Control is roughly equivalent to shell access on the Hermes host**. Treat it that way.

## Controls in place

| Area | Control |
|---|---|
| Authentication | Username and password, hashed with scrypt (N=16384, minimum 12 characters). Login is rate-limited to 10 per 5 minutes per IP. Unknown usernames take the same hashing time as known ones. Failed logins are audited. |
| Sessions | Random 256-bit token in an `httpOnly`, `SameSite=Strict` cookie (`Secure` when served over HTTPS). Only a SHA-256 of the token is stored. 30-day expiry. Resetting a user's password revokes their sessions. |
| CSRF | Every mutating request needs an `X-CSRF-Token` that matches the server-side session. An optional Origin allowlist (`server.allowedOrigins`) adds a second check. |
| Workspace isolation | Every route under `/api/w/:ws` checks membership in SQL. Conversation, message, attachment, run and approval lookups also filter on `workspace_id`; a correct id alone is not enough. A workspace you are not in returns 404, so its existence is not revealed. Agents are routable only if they are in that workspace's allowlist (fail closed). |
| Cross-workspace leakage in Hermes | Each conversation gets its own Hermes session, so FilmLV and Atomic Fox transcripts never share context. `X-Hermes-Session-Key` scopes long-term memory per workspace and conversation, for memory providers that honour it. **Residual risk:** a profile's built-in memory (`MEMORY.md`/`USER.md`) is per profile, not per workspace. For hard separation, use separate Hermes profiles per business (e.g. `jeff-filmlv`, `jeff-atomicfox`). |
| Kanban isolation | The board is global in Hermes. Hermes Control filters by workspace `kanbanTenant` when one is configured, otherwise by assignees allowed in the workspace. It refuses actions on tasks outside the workspace. Recommendation: set `kanbanTenant` for FilmLV and Atomic Fox. |
| Credentials | Hermes API keys are read from server environment variables (`HC_HERMES_KEY_*`). They are never stored in the database, sent to the browser or logged. Settings shows only "present/missing". Discovery never opens `.env`, `auth.json`, `config.yaml`, `vault/` or any other secret file. Bot tokens stay inside Hermes. |
| Input validation | zod schemas on every body. Hermes profile and task ids are regex-checked. The Kanban CLI runs via `execFile` (no shell), with positionals after `--`. Message rendering is text-only React, with no `dangerouslySetInnerHTML`. |
| Uploads | 25 MB cap. Random storage keys. Filenames are sanitized. Non-image files are served as `attachment` / `application/octet-stream`. Avatars are restricted to JPEG, PNG or WebP, and the file's magic bytes are checked. |
| Headers | Strict CSP (`default-src 'self'`, no inline script), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`. |
| Approvals | Only workspace **owners** can decide. Only the choices Hermes offered are accepted. Every decision is audited. The UI never shows "approved" without a 2xx from Hermes. Hermes's own approval policy is unchanged and still enforced by Hermes. |
| Audit | `audit_log` records logins, sends (with routing), approvals, task changes, agent edits and uploads. |
| Transport | The server binds `127.0.0.1` by default. Remote access should go through `tailscale serve` (HTTPS, tailnet-only). **Do not port-forward to the internet.** |

## Required hardening before multi-user or remote use

1. Serve over HTTPS (`tailscale serve`) and set `server.secureCookies: true` and `server.allowedOrigins`.
2. Keep the Hermes API server on loopback (`API_SERVER_HOST=127.0.0.1`, the default). Hermes Control is its only client.
3. Use a unique `API_SERVER_KEY` for each profile, stored in a root-only env file (mode 0600) on the host.
4. Back up `data/` (database, uploads, avatars). It contains conversation content.

## Known limitations

- There is no 2FA or passkey support yet. Tailscale device identity provides the second factor.
- Attachments are not virus-scanned.
- No per-message end-to-end encryption at rest. The SQLite file relies on disk encryption (FileVault on the Mac; LUKS recommended on the Pi).
