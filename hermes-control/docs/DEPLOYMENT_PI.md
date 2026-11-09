# Raspberry Pi 500 Deployment Plan (NOT EXECUTED — requires approval)

Nothing in this document has been run.

## 0. Decision (2026-11-09): Home Assistant will be removed from the Pi

The owner decided to remove Home Assistant. The Pi will be reflashed with a general-purpose 64-bit Linux and dedicated to Hermes and Hermes Control. Removing Home Assistant OS **is** an OS reinstall: the SD card or SSD is erased.

### Before wiping (owner's checklist)
1. In Home Assistant, go to **Settings → System → Backups**, create a full backup and **download it off the Pi**. Without it, the setup can't be restored.
2. Write down what currently depends on HA: automations, lights and sensors, Zigbee/Z-Wave/Thread USB dongles, and any HA add-ons in use (e.g. Tailscale, Mosquitto). All of it stops when HA is removed.
3. If you reach the Pi remotely through an HA add-on, set up another way in first (local keyboard and screen work fine on a Pi 500).

### Recommended target OS
**Raspberry Pi OS Lite (64-bit)**, flashed with Raspberry Pi Imager. In Imager's settings, set the hostname, your user, SSH (key-based) and Wi-Fi.
- It is Debian-based, with glibc and systemd, which matches Hermes's stated Linux requirements. It also has the best Pi 500 hardware support.
- Alternative: Ubuntu Server 24.04 LTS (arm64). Upstream says it tests Hermes on Ubuntu, so this is the closest match to that.
- Put the data on a USB 3 SSD rather than the SD card. SQLite in WAL mode writes often, which wears SD cards.

The rest of this document assumes Raspberry Pi OS Lite 64-bit. §1 is kept for reference.

## 1. Decide what the Pi is actually running (superseded by §0)

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
3. Use the documented full-machine path (Hermes FAQ, "Exporting Hermes to another machine", verified at v0.23.0): `hermes backup` on the Mac, then `hermes import <zip>` on the Pi with its gateway stopped. The backup *includes* `.env` and `auth.json`. It excludes browser profiles, symlinks, and any vault key held in the macOS Keychain (check with `hermes vault key`). `hermes profile export` is for sharing a single profile and strips credentials, so don't use it for this migration.
4. **Telegram cut-over.** Only one poller per bot token is allowed. Stop the Mac gateway, then start the Pi gateway. A brief gap in Telegram is unavoidable; announce it.
5. Point Hermes Control on the Pi at the Pi's gateway, verify end to end, then decommission the Mac services.

**Rollback:** stop the Pi gateway and restart the Mac gateway. Telegram resumes there.
