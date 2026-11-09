# Raspberry Pi 500 Deployment Plan (NOT EXECUTED — requires approval)

Nothing in this document has been run.

## 1. Decide what the Pi is actually running (blocking question)

| If the Pi runs… | Can it host Hermes and Hermes Control? |
|---|---|
| **Home Assistant OS** (the appliance image) | **No, not safely.** HA OS only runs Home Assistant and its add-ons. There is no supported way to run arbitrary services or containers next to it, and Hermes ships no HA add-on. Workarounds such as a custom add-on or SSH tricks are unsupported and could break HA updates. **Do not attempt.** |
| Raspberry Pi OS / Debian 12–13 (64-bit) with HA in Docker ("HA Container") | Yes. HA keeps running untouched. Hermes and Hermes Control run as separate services. |
| Raspberry Pi OS / Debian with HA Supervised | Possible, but Supervised dislikes extra software on the host. Prefer Docker for Hermes and confirm Supervisor stays "healthy". |

To check without changing anything: in HA, open **Settings → About**. The "Installation type" field shows the variant. Or, over SSH, run `cat /etc/os-release`.

**If it's HA OS**, the options are:
- **Recommended:** a second small host (another Pi 5 with an SSD, or a mini PC) for Hermes, keeping HA OS as it is.
- **Not recommended:** reinstall the Pi as Pi OS with HA in a container. You said not to reinstall, so this is listed only for completeness.

## 2. Compatibility (verified vs. to-check)

**Verified (upstream docs):**
- Hermes supports Linux aarch64 and has a multi-arch Docker image (`nousresearch/hermes-agent`, Python 3.14).
- Hermes Control has no native npm modules. `node:sqlite` is built in, and Node 22+ is available for arm64.

**To check on the Pi:**
- glibc ≥ 2.36 and a 64-bit kernel: `uname -m` should print `aarch64`.
- Free RAM: Pi 500 has 8 GB; HA plus Hermes plus Hermes Control is expected to fit, but measure it.
- Storage: put `~/.hermes` and `data/` on SSD or NVMe, not the SD card (WAL writes wear SD cards).

## 3. Layout (native, systemd)

```
/opt/hermes-control/          # git checkout, built with `npm ci && npm run build`
/etc/hermes-control/config.yaml
/etc/hermes-control/env       # HC_HERMES_KEY_* (0600, root:hermes)
/var/lib/hermes-control/      # dataDir: DB, uploads, avatars
```

`deploy/hermes-control.service` is a hardened systemd unit with `Restart=always`, `ProtectSystem=strict` and `ReadWritePaths` set to the data directory only. Hermes itself runs under `hermes gateway install --system`, which is its documented systemd mode.

**Remote access:** `tailscale serve --bg --https=443 http://127.0.0.1:8787`. This gives tailnet-only HTTPS and no public exposure.

## 4. Health, logs, backups

- **Health:** `GET /api/health` for liveness. As admin, `GET /api/system/status` gives per-profile gateway reachability and mirror status. The systemd unit restarts the process on exit.
- **Logs:** structured JSON on stdout, read with `journalctl -u hermes-control`.
- **Backups:** `deploy/backup.sh`. It runs SQLite `VACUUM INTO` (a consistent snapshot even under WAL) and tars uploads and avatars, keeping 14 days. Run it nightly from a systemd timer.
- **Recovery:** stop the service, restore `hermes-control.db` and the uploads, start the service. Open runs resume automatically.

## 5. Migration sequence (each step needs your go-ahead)

1. Confirm the Pi's OS type (§1).
2. Install Node and Hermes on the target. Leave the Mac's Hermes running.
3. Copy Hermes profiles with `hermes profile export` (it strips credentials by design), then re-enter the secrets on the Pi.
4. **Telegram cut-over.** Only one poller per bot token is allowed. Stop the Mac gateway, then start the Pi gateway. A brief gap in Telegram is unavoidable; announce it.
5. Point Hermes Control on the Pi at the Pi's gateway, verify end to end, then decommission the Mac services.

**Rollback:** stop the Pi gateway and restart the Mac gateway. Telegram resumes there.
