#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$HOME/.config/usa-gummies-mcp/agentic-engine.log"
mkdir -p "$(dirname "$LOG_FILE")"
PATH_FALLBACK="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [[ -x "$candidate" ]]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "Unable to locate node binary for cron schedule install." >&2
  exit 1
fi

MARKER_START="# >>> USA_GUMMIES_AGENTIC >>>"
MARKER_END="# <<< USA_GUMMIES_AGENTIC <<<"

EXISTING="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$EXISTING" | awk -v s="$MARKER_START" -v e="$MARKER_END" '
  $0==s {skip=1; next}
  $0==e {skip=0; next}
  skip==0 {print}
')"

read -r -d '' BLOCK <<CRON || true
$MARKER_START
CRON_TZ=America/New_York
PATH=$PATH_FALLBACK
45 7 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent7 >> "$LOG_FILE" 2>&1
0 8 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent1 --target 40 >> "$LOG_FILE" 2>&1
20 8 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent22 --limit 8 >> "$LOG_FILE" 2>&1
30 8 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent2 --target 10 >> "$LOG_FILE" 2>&1
40 8 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent12 --limit 250 >> "$LOG_FILE" 2>&1
50 8 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent audit >> "$LOG_FILE" 2>&1
52 8 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent19 --limit 800 >> "$LOG_FILE" 2>&1
55 8 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent18 --limit 600 >> "$LOG_FILE" 2>&1
57 8 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent20 --limit 600 >> "$LOG_FILE" 2>&1
0 9 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent3 --limit 35 >> "$LOG_FILE" 2>&1
15 9 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent4 --limit 10 >> "$LOG_FILE" 2>&1
0 11 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent13 >> "$LOG_FILE" 2>&1
0 13 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent5 >> "$LOG_FILE" 2>&1
30 14 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent13 >> "$LOG_FILE" 2>&1
30 15 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent21 >> "$LOG_FILE" 2>&1
0 16 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent6 >> "$LOG_FILE" 2>&1
0 17 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent8 >> "$LOG_FILE" 2>&1
15 17 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent9 >> "$LOG_FILE" 2>&1
30 17 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent11 >> "$LOG_FILE" 2>&1
45 17 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent16 >> "$LOG_FILE" 2>&1
0 18 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent17 >> "$LOG_FILE" 2>&1
20 18 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent6 --backfill --count 250 --max-processed 120 --source scheduler-backfill >> "$LOG_FILE" 2>&1
# V2 Agents — Deal progression, quotes, fulfillment, re-engagement
30 9 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent28 >> "$LOG_FILE" 2>&1
0 10 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent23 >> "$LOG_FILE" 2>&1
30 10 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent24 >> "$LOG_FILE" 2>&1
30 11 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent25 >> "$LOG_FILE" 2>&1
0 12 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent30 --limit 20 >> "$LOG_FILE" 2>&1
0 14 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent27 --limit 5 >> "$LOG_FILE" 2>&1
0 18 * * 1 cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent26 >> "$LOG_FILE" 2>&1
0 19 * * 0 cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent29 >> "$LOG_FILE" 2>&1
# Idle-hour pipeline fill: run research only when core agents are not scheduled in that hour.
20 0,1,2,3,4,5,6,10,12,15,19,20,21,22,23 * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-research-backfill --target 20 --limit 6 --source idle-hour-backfill >> "$LOG_FILE" 2>&1
13,43 * * * * cd "$ROOT_DIR" && bash scripts/dmarc-cleanup.sh >> "$LOG_FILE" 2>&1
*/5 * * * * cd "$ROOT_DIR" && bash scripts/ensure-agentic-command-center.sh >> "$LOG_FILE" 2>&1
*/30 * * * * cd "$ROOT_DIR" && "$NODE_BIN" scripts/usa-gummies-agentic.mjs run-agent agent10 --source scheduler >> "$LOG_FILE" 2>&1
$MARKER_END
CRON

NEW_CRON="${CLEANED}

${BLOCK}
"

printf '%s\n' "$NEW_CRON" | crontab -

echo "Installed USA Gummies agentic schedule (ET) into crontab."
echo "Log: $LOG_FILE"
