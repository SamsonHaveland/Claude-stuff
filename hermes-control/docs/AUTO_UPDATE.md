# Hermes Auto-Update

**Status: built and tested against a stub; NOT installed. Installing it schedules unattended changes to your Hermes install, so it needs your approval.**

## What Hermes provides (verified, upstream docs)

Hermes has **no built-in scheduled auto-update**. It only shows passive "update available" notices. Its updater, `hermes update`, is built to run unattended, though: the docs list cron among the non-interactive callers it supports. It handles:

- **Release channel:** follows the `stable` channel (published `vX.Y.Z` releases) by default.
- **Backups:** `--backup` takes a full pre-update backup of `~/.hermes`.
- **Broken releases:** checks that the startup files compile. If they don't, it **rolls the checkout back** to the previous commit.
- **Gateway restarts:** restarts gateways **drain-first**. In-flight chats, cron jobs and API runs are allowed to finish, up to 30 minutes by default.
- **Receipts:** writes one to `~/.hermes/logs/update_receipts/latest.json`.
- **Exit codes:** `0` ok, `1` install error, `2` local changes blocked the pull.

## What we add

| File | Purpose |
|---|---|
| `deploy/hermes-autoupdate.sh` | Nightly wrapper. Takes a lock, runs `hermes update --check --channel stable`, and only if a release exists runs `hermes update --yes --backup --channel stable`. Records the result to `~/.hermes-autoupdate/status.json`, with logs in `~/.hermes-autoupdate/logs/` (kept 60 days). |
| `deploy/com.hermes.autoupdate.plist` | Mac: a launchd job at 04:17. If the Mac is asleep, it runs on wake. |
| `deploy/hermes-autoupdate.service` + `.timer` | Pi/Linux: a systemd timer at 04:17 plus a random delay of up to 20 minutes. It catches up on a missed run after a reboot. |
| Hermes Control → Settings → *Hermes auto-update* | Shows the last result (up to date, updated, updated with warnings, or failed), the before → after version, and any `⚠`/`✗` lines. Admin only. |

The wrapper only ever installs **stable releases**. It never changes the channel, config, profiles or credentials, and it never sends messages.

## Tested (against a stub `hermes`)

| Case | Outcome |
|---|---|
| Already up to date | `up_to_date`. The update is not run. |
| Release available, update succeeds | `updated`, version before → after |
| Hermes prints follow-up warnings | `updated_with_warnings`, with the warnings listed |
| Local changes block the pull | `failed`, "nothing was installed" |
| Update check fails (e.g. network) | `failed`, "nothing was changed" |
| Another run is in progress | `skipped_locked`. The other run's lock is left alone. |

**Not yet tested:** a real `hermes update` on your Mac.

## Risks, and how they're handled

| Risk | Handling |
|---|---|
| A new release changes behaviour or breaks an integration | Stable channel only. A full backup is taken before every update. Settings shows the result the next morning. Hermes Control relies only on documented API-server endpoints, which reduces the chance of breakage. |
| A broken release | Hermes rolls back automatically when its startup files are broken. For other regressions, restore from the pre-update backup (`hermes backup restore …`, see the Hermes docs) and pause the job (below). |
| The gateway restart interrupts work | Hermes drains first: in-flight chats and cron jobs finish. Telegram is briefly offline during the restart, which is why the job runs at 04:17. |
| Disk use from full backups | A full backup is taken only when an update actually installs, not every night. Prune old ones occasionally. |
| A wording change in `hermes update --check` | If the "update available" text stops matching, the wrapper safely does nothing and reports `up_to_date`. A Hermes version that never changes over weeks is the signal to check. |

## Install (after approval)

**Mac**
```bash
mkdir -p ~/.hermes-autoupdate
bash ~/hermes-control/deploy/hermes-autoupdate.sh        # one manual run first; check ~/.hermes-autoupdate/status.json
cp ~/hermes-control/deploy/com.hermes.autoupdate.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hermes.autoupdate.plist
```
Pause or remove: `launchctl bootout gui/$(id -u)/com.hermes.autoupdate`.

**Pi**
```bash
sudo cp deploy/hermes-autoupdate.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hermes-autoupdate.timer
systemctl list-timers hermes-autoupdate.timer
```
Pause: `sudo systemctl disable --now hermes-autoupdate.timer`.

Hermes Control itself is not auto-updated. It changes only when you pull new code from this repository.
