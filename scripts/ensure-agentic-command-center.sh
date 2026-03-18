#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$HOME/.config/usa-gummies-mcp"
PID_FILE="$STATE_DIR/command-center.pid"
LOG_FILE="$STATE_DIR/command-center.log"
HEALTH_URL="${COMMAND_CENTER_HEALTH_URL:-http://127.0.0.1:4000/api/agentic/command-center}"
LOCK_DIR="$STATE_DIR/command-center-watchdog.lock"

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p "$STATE_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

utc_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  printf '[%s] [command-center-watchdog] %s\n' "$(utc_now)" "$1" >> "$LOG_FILE"
}

is_pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

health_ok() {
  curl -fsS --max-time 8 "$HEALTH_URL" >/dev/null 2>&1
}

resolve_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return 0
  fi
  for candidate in /opt/homebrew/bin/npm /usr/local/bin/npm /usr/bin/npm; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

wait_for_health() {
  local timeout="${1:-35}"
  local i=0
  while [[ "$i" -lt "$timeout" ]]; do
    if health_ok; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

listener_pid() {
  lsof -tiTCP:4000 -sTCP:LISTEN -n -P 2>/dev/null | head -n 1 || true
}

start_dashboard() {
  local npm_bin="$1"
  log "Starting dashboard process with npm run dev."
  (
    cd "$ROOT_DIR"
    nohup "$npm_bin" run dev >> "$LOG_FILE" 2>&1 &
    echo "$!" > "$PID_FILE"
  )
}

if health_ok; then
  active_pid="$(listener_pid)"
  if [[ -n "$active_pid" ]]; then
    echo "$active_pid" > "$PID_FILE"
  fi
  log "Health check OK."
  exit 0
fi

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_pid_alive "$pid"; then
    log "Health check failed while pid $pid is alive. Restarting."
    kill "$pid" 2>/dev/null || true
    sleep 2
  fi
  rm -f "$PID_FILE"
fi

port_pid="$(lsof -tiTCP:4000 -sTCP:LISTEN -n -P 2>/dev/null | head -n 1 || true)"
if [[ -n "$port_pid" ]]; then
  port_cmd="$(ps -p "$port_pid" -o command= 2>/dev/null || true)"
  if [[ "$port_cmd" == *"next"* || "$port_cmd" == *"node"* ]]; then
    log "Port 4000 is held by stale process $port_pid. Killing and restarting."
    kill "$port_pid" 2>/dev/null || true
    sleep 2
  else
    log "Port 4000 occupied by non-node process ($port_pid). Cannot auto-restart."
    exit 1
  fi
fi

npm_bin="$(resolve_npm || true)"
if [[ -z "${npm_bin:-}" ]]; then
  log "Unable to resolve npm binary in PATH."
  exit 1
fi

start_dashboard "$npm_bin"

if wait_for_health 40; then
  new_pid="$(listener_pid)"
  if [[ -n "$new_pid" ]]; then
    echo "$new_pid" > "$PID_FILE"
  fi
  log "Dashboard recovered. pid=${new_pid:-unknown}."
  exit 0
fi

log "Dashboard restart attempted but health check still failing."
exit 1
