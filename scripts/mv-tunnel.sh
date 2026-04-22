#!/usr/bin/env bash
#
# scripts/mv-tunnel.sh
#
# Start a public Cloudflare quick tunnel for the editor on localhost:4000.
#
# Usage:
#   scripts/mv-tunnel.sh          # launch
#   scripts/mv-tunnel.sh --kill   # kill running tunnel

set -euo pipefail

LOGFILE="/tmp/mv-tunnel.log"
PIDFILE="/tmp/mv-tunnel.pid"
PLISTFILE="/tmp/com.remotion.mv-tunnel.plist"
URLFILE="/tmp/mv-tunnel.url"
EDITOR_PIDFILE="/tmp/mv-editor.pid"
EDITOR_PLISTFILE="/tmp/com.remotion.mv-editor.plist"
LOCAL_URL="http://127.0.0.1:4000"
DOH_URL="https://1.1.1.1/dns-query"
SERVICE_LABEL="com.remotion.mv-tunnel"
EDITOR_LABEL="com.remotion.mv-editor"
LAUNCH_DOMAIN="gui/$(id -u)"
LAUNCH_TARGET="$LAUNCH_DOMAIN/$SERVICE_LABEL"
EDITOR_LAUNCH_TARGET="$LAUNCH_DOMAIN/$EDITOR_LABEL"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EDITOR_ROOT="$REPO_ROOT/editor"

kill_tunnel() {
  launchctl bootout "$LAUNCH_TARGET" >/dev/null 2>&1 || true

  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi

  rm -f "$URLFILE"
  pkill -f "localtunnel --port 4000" 2>/dev/null || true
  pkill -f "bin/lt --port 4000" 2>/dev/null || true
}

kill_editor_service() {
  launchctl bootout "$EDITOR_LAUNCH_TARGET" >/dev/null 2>&1 || true

  if [ -f "$EDITOR_PIDFILE" ]; then
    kill "$(cat "$EDITOR_PIDFILE")" 2>/dev/null || true
    rm -f "$EDITOR_PIDFILE"
  fi
}

write_launchd_plist() {
  local cloudflared_path="$1"

  cat >"$PLISTFILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVICE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$cloudflared_path</string>
    <string>tunnel</string>
    <string>--url</string>
    <string>$LOCAL_URL</string>
    <string>--logfile</string>
    <string>$LOGFILE</string>
    <string>--loglevel</string>
    <string>info</string>
    <string>--metrics</string>
    <string>localhost:0</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$(pwd)</string>
  <key>StandardOutPath</key>
  <string>/tmp/mv-tunnel.stdout</string>
  <key>StandardErrorPath</key>
  <string>/tmp/mv-tunnel.stderr</string>
</dict>
</plist>
EOF
}

write_editor_launchd_plist() {
  cat >"$EDITOR_PLISTFILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$EDITOR_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "$EDITOR_ROOT" && npm run dev -- --host 127.0.0.1 --port 4000</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$EDITOR_ROOT</string>
  <key>StandardOutPath</key>
  <string>/tmp/mv-editor.stdout</string>
  <key>StandardErrorPath</key>
  <string>/tmp/mv-editor.stderr</string>
</dict>
</plist>
EOF
}

read_service_pid() {
  local target="$1"
  launchctl print "$target" 2>/dev/null | awk '/^[[:space:]]+pid = / {print $3; exit}'
}

wait_for_local_editor() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 "$LOCAL_URL/api/songs" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_local_editor() {
  if curl -fsS --max-time 5 "$LOCAL_URL/api/songs" >/dev/null; then
    return 0
  fi

  if [ ! -d "$EDITOR_ROOT" ]; then
    echo "error: editor directory not found at $EDITOR_ROOT"
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "error: npm is required to auto-start the editor."
    exit 1
  fi

  write_editor_launchd_plist
  kill_editor_service
  rm -f /tmp/mv-editor.stdout /tmp/mv-editor.stderr

  if ! launchctl bootstrap "$LAUNCH_DOMAIN" "$EDITOR_PLISTFILE" >/dev/null 2>&1; then
    echo "error: failed to bootstrap editor launchd service"
    exit 1
  fi

  local editor_pid=""
  for _ in $(seq 1 10); do
    editor_pid="$(read_service_pid "$EDITOR_LAUNCH_TARGET" || true)"
    if [ -n "$editor_pid" ]; then
      printf '%s\n' "$editor_pid" >"$EDITOR_PIDFILE"
      break
    fi
    sleep 1
  done

  if ! wait_for_local_editor; then
    echo "error: managed editor did not become healthy on $LOCAL_URL"
    tail -40 /tmp/mv-editor.stderr 2>/dev/null || true
    tail -40 /tmp/mv-editor.stdout 2>/dev/null || true
    exit 1
  fi
}

if [ "${1:-}" = "--kill" ]; then
  kill_tunnel
  kill_editor_service
  echo "tunnel killed"
  exit 0
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "error: cloudflared is not installed."
  echo "install it with: brew install cloudflared"
  exit 1
fi

ensure_local_editor

write_launchd_plist "$(command -v cloudflared)"

URL=""
ROOT_CODE=""
SONGS_CODE=""
for attempt in $(seq 1 3); do
  kill_tunnel
  rm -f "$LOGFILE" "$PIDFILE" "$URLFILE" /tmp/mv-tunnel.stdout /tmp/mv-tunnel.stderr

  if ! launchctl bootstrap "$LAUNCH_DOMAIN" "$PLISTFILE" >/dev/null 2>&1; then
    echo "[mv-tunnel] attempt $attempt failed to bootstrap launchd service; retrying..." >&2
    sleep 1
    continue
  fi

  for _ in $(seq 1 5); do
    PID="$(read_service_pid "$LAUNCH_TARGET" || true)"
    if [ -n "${PID:-}" ]; then
      printf '%s\n' "$PID" >"$PIDFILE"
      break
    fi
    sleep 1
  done

  URL=""
  for _ in $(seq 1 30); do
    sleep 1
    if [ -f "$LOGFILE" ]; then
      URL=$(grep -oE 'https://[-a-z0-9]+\.trycloudflare\.com' "$LOGFILE" | tail -1 || true)
    fi
    [ -n "$URL" ] && break
  done

  if [ -z "$URL" ]; then
    kill_tunnel
    echo "[mv-tunnel] attempt $attempt failed to read a public URL; retrying..." >&2
    continue
  fi

  printf '%s\n' "$URL" >"$URLFILE"

  ROOT_CODE=""
  SONGS_CODE=""
  for _ in $(seq 1 45); do
    ROOT_CODE=$(curl -s -o /dev/null -w '%{http_code}' --doh-url "$DOH_URL" --connect-timeout 2 --max-time 4 "$URL/" || true)
    SONGS_CODE=$(curl -s -o /dev/null -w '%{http_code}' --doh-url "$DOH_URL" --connect-timeout 2 --max-time 4 "$URL/api/songs" || true)
    if [ "$ROOT_CODE" = "200" ] && [ "$SONGS_CODE" = "200" ]; then
      break
    fi
    sleep 1
  done

  if [ "$ROOT_CODE" = "200" ] && [ "$SONGS_CODE" = "200" ]; then
    break
  fi

  echo "[mv-tunnel] attempt $attempt health check failed (root=$ROOT_CODE, api/songs=$SONGS_CODE); retrying..." >&2
done

if [ "$ROOT_CODE" != "200" ] || [ "$SONGS_CODE" != "200" ]; then
  kill_tunnel
  echo "error: public tunnel failed health checks"
  echo "root status: $ROOT_CODE"
  echo "api/songs status: $SONGS_CODE"
  tail -20 "$LOGFILE" 2>/dev/null || true
  exit 1
fi

cat <<EOF

  ================================================================
  Editor tunnel is LIVE:
  $URL

  Verified:
    GET /           -> $ROOT_CODE
    GET /api/songs  -> $SONGS_CODE

  Process:
    launchd label  -> $SERVICE_LABEL
    pid            -> $(cat "$PIDFILE")

  Kill it with:  npm run mv:tunnel -- --kill
  Log:           $LOGFILE
  ================================================================

EOF
