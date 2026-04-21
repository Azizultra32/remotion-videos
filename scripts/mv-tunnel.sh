#!/usr/bin/env bash
#
# scripts/mv-tunnel.sh
#
# Start a STABLE public tunnel for the editor on localhost:4000.
#
# Why localtunnel with a fixed subdomain (not cloudflared quick-tunnel):
# cloudflared's `--url` mode gives a random `*.trycloudflare.com` URL on
# every launch. Every restart = new URL. Days of URL churn.
#
# localtunnel lets us CLAIM a specific subdomain via --subdomain, so the
# URL is stable across restarts (as long as no one else squats the
# subdomain in the second between our disconnect and reconnect, which
# is vanishingly rare for a long, random-suffixed name).
#
# Tradeoff: localtunnel shows a one-time "enter your IP to continue"
# captcha per visitor IP. The password is your current public IP
# (fetched via `curl https://loca.lt/mytunnelpassword`). The prompt
# below prints it at launch so you can paste it the first time you
# visit from a new device.
#
# Auth cost: zero. No signup, no login, no OAuth.
#
# Usage:
#   scripts/mv-tunnel.sh                          # launch with default stable name
#   MV_TUNNEL_SUBDOMAIN=my-custom-name scripts/mv-tunnel.sh   # pick your own
#   scripts/mv-tunnel.sh --kill                   # kill any running tunnel
#
# The npm wrapper: `npm run mv:tunnel`.

set -euo pipefail

LOGFILE="/tmp/mv-tunnel.log"
# A unique-per-machine default. Combines hostname + uid to avoid clashes
# with other dev setups also running mv-tunnel.sh. Override via the
# MV_TUNNEL_SUBDOMAIN env var if you want a different one.
DEFAULT_SUBDOMAIN="mv-editor-$(echo -n "$(hostname)-$(id -u)" | shasum | cut -c1-10)"
SUBDOMAIN="${MV_TUNNEL_SUBDOMAIN:-$DEFAULT_SUBDOMAIN}"

if [ "${1:-}" = "--kill" ]; then
  pkill -9 -f "localtunnel --port 4000" 2>/dev/null || true
  pkill -9 -f "bin/lt --port 4000" 2>/dev/null || true
  echo "tunnel killed"
  exit 0
fi

# Kill any existing tunnel so we don't double-bind the subdomain.
pkill -9 -f "localtunnel --port 4000" 2>/dev/null || true
pkill -9 -f "bin/lt --port 4000" 2>/dev/null || true
sleep 1

# Detach fully (double-fork) so the tunnel survives this shell exiting.
# Plain `nohup cmd &` still dies when the parent process group is reaped
# by some agent harnesses. `(cmd &) &` forces reparenting to init.
rm -f "$LOGFILE"
(nohup npx --yes localtunnel --port 4000 --subdomain "$SUBDOMAIN" > "$LOGFILE" 2>&1 &) &

# Wait for the "your url is: ..." line.
URL=""
for i in $(seq 1 30); do
  sleep 1
  URL=$(grep -oE 'https?://[a-z0-9-]+\.loca\.lt' "$LOGFILE" | tail -1 || true)
  [ -n "$URL" ] && break
done

if [ -z "$URL" ]; then
  echo "error: tunnel didn't come up in 30s. log:"
  tail -20 "$LOGFILE" 2>&1
  exit 1
fi

# Public IP — localtunnel shows a captcha on first visit per IP and
# asks for this password. Fetch it so the user doesn't have to hunt.
PASSWORD=$(curl -s --max-time 5 https://loca.lt/mytunnelpassword 2>/dev/null || echo "(fetch loca.lt/mytunnelpassword)")

cat <<EOF

  ================================================================
  Editor tunnel is LIVE:
  $URL

  First visit from each device shows a one-time captcha page.
  The password it asks for is your current public IP:
      $PASSWORD

  After entering it once, the browser cookies the bypass for ~7 days
  and you won't see the captcha again from that device.

  Subdomain is stable across restarts (no new URL each time):
      $SUBDOMAIN

  Kill it with:  npm run mv:tunnel -- --kill
  Log:           $LOGFILE
  ================================================================

EOF
