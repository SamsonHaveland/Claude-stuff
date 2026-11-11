#!/usr/bin/env bash
# Hermes migration — READ-ONLY audit of the Raspberry Pi (target machine).
# Changes nothing and never prints secret values. Uses `sudo -n` only (never prompts);
# anything that needs a password is reported as "needs sudo" instead.
#
# Run from the Mac:
#   ssh samsonhaveland@hermes-pi.local 'bash -s' < migration-audit-pi.sh > pi-audit.txt 2>&1
set -u
sec() { printf '\n===== %s =====\n' "$1"; }
H="${HERMES_HOME:-$HOME/.hermes}"

sec "Host"
hostname; uname -srm; . /etc/os-release && echo "$PRETTY_NAME"; uptime
cat /proc/device-tree/model 2>/dev/null | tr -d '\0'; echo
free -h | head -2; df -h / /boot/firmware 2>/dev/null
command -v vcgencmd >/dev/null && { vcgencmd measure_temp; vcgencmd get_throttled; }

sec "Hermes on the Pi?"
for p in "$(command -v hermes 2>/dev/null)" "$HOME/.local/bin/hermes" /usr/local/bin/hermes; do [ -n "$p" ] && [ -e "$p" ] && echo "hermes binary: $p"; done
[ -d "$H" ] && { echo "$H exists:"; ls -la "$H" | head -40; echo "profiles: $(ls "$H/profiles" 2>/dev/null | grep -v '^\.' | tr '\n' ' ')"; } || echo "$H does not exist"
command -v hermes >/dev/null && { hermes --version 2>&1 | head -5; hermes gateway list 2>&1 | head -20; }
ls -d ~/hermes-backup-*.zip ~/*hermes* 2>/dev/null || echo "no hermes files/backups in home"

sec "Runtimes"
python3 --version 2>&1; command -v uv && uv --version; command -v node && node --version; command -v git && git --version

sec "Docker"
if command -v docker >/dev/null; then
  docker --version
  systemctl is-active docker; systemctl is-enabled docker
  id -nG | grep -qw docker && echo "user in docker group: yes" || echo "user in docker group: no"
  if docker ps -a >/dev/null 2>&1; then D=docker; elif sudo -n docker ps -a >/dev/null 2>&1; then D="sudo -n docker"; else D=""; fi
  if [ -n "$D" ]; then
    echo "-- containers:"; $D ps -a --format '{{.Names}}  {{.Image}}  {{.Status}}  {{.Ports}}' | head -20
    echo "-- images:"; $D images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | head -20
    echo "-- volumes:"; $D volume ls --format '{{.Name}}' | head -20
  else echo "cannot query docker without sudo password (needs sudo)"; fi
else echo "docker not installed"; fi

sec "Services, timers, cron"
systemctl list-units --all --no-pager 2>/dev/null | grep -iE 'hermes|tailscale|rpi-connect' || echo "(no system units matching hermes/tailscale/rpi-connect)"
systemctl --user list-units --all --no-pager 2>/dev/null | grep -iE 'hermes|rpi-connect' || echo "(no user units matching hermes/rpi-connect)"
systemctl list-timers --all --no-pager 2>/dev/null | head -15
echo "linger for ${USER:-$(id -un)}: $(loginctl show-user "${USER:-$(id -un)}" -p Linger 2>/dev/null)"
echo "crontab lines: $(crontab -l 2>/dev/null | grep -vc '^#')"

sec "Network exposure"
ss -tln 2>/dev/null | awk 'NR==1 || /LISTEN/'
for f in ufw nft iptables; do command -v $f >/dev/null && echo "firewall tool present: $f"; done
sudo -n ufw status 2>/dev/null || true

sec "Remote access"
command -v tailscale >/dev/null && { tailscale version | head -1; tailscale status 2>&1 | head -5; } || echo "tailscale not installed"
command -v rpi-connect >/dev/null && rpi-connect status 2>&1 | head -8 || echo "rpi-connect not installed"
echo "authorized_keys entries: $(grep -c . ~/.ssh/authorized_keys 2>/dev/null || echo 0)"
if sudo -n true 2>/dev/null; then sudo -n sshd -T 2>/dev/null | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication) '; else echo "sshd effective config: needs sudo"; grep -hiE '^\s*(PasswordAuthentication|PermitRootLogin)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null; fi

sec "Time and updates"
timedatectl 2>/dev/null | grep -E 'Time zone|synchronized'
systemctl is-enabled unattended-upgrades 2>/dev/null | sed 's/^/unattended-upgrades: /'
apt list --upgradable 2>/dev/null | grep -c upgradable | sed 's/^/packages upgradable: /'

sec "Done — nothing was modified"
