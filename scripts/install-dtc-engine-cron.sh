#!/usr/bin/env bash
#
# Install cron jobs for the USA Gummies DTC Retention Engine (Build 3)
#
# Usage: bash scripts/install-dtc-engine-cron.sh
#
# Installs 8 cron entries for agents D1-D10 (D3/D4 run inside D2).
# Uses marker-based approach for safe re-installation.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_SCRIPT="$PROJECT_ROOT/scripts/usa-gummies-dtc-engine.mjs"
NODE_BIN="$(which node)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/usagummies-dtc-engine.log"

MARKER_START="# >>> USA_GUMMIES_DTC_ENGINE >>>"
MARKER_END="# <<< USA_GUMMIES_DTC_ENGINE <<<"

mkdir -p "$LOG_DIR"

# Build the cron block
CRON_BLOCK=$(cat <<EOF
$MARKER_START
# USA Gummies DTC Retention Engine — installed $(date +%Y-%m-%d)
CRON_TZ=America/New_York

# D1 — New Customer Ingestor (Daily 8:00 AM ET)
0 8 * * * $NODE_BIN $ENGINE_SCRIPT run D1 --source cron >> $LOG_FILE 2>&1

# D2 — Post-Purchase Sequence Manager (Daily 9:00 AM ET) — also runs D3/D4 logic
5 9 * * * $NODE_BIN $ENGINE_SCRIPT run D2 --source cron >> $LOG_FILE 2>&1

# D5 — Reorder Predictor (Daily 10:00 AM ET)
0 10 * * * $NODE_BIN $ENGINE_SCRIPT run D5 --source cron >> $LOG_FILE 2>&1

# D6 — Churn Risk Scorer (Daily 11:00 AM ET)
0 11 * * * $NODE_BIN $ENGINE_SCRIPT run D6 --source cron >> $LOG_FILE 2>&1

# D7 — Loyalty Tier Calculator (Weekly Monday 7:00 AM ET)
0 7 * * 1 $NODE_BIN $ENGINE_SCRIPT run D7 --source cron >> $LOG_FILE 2>&1

# D8 — Email Deliverability Guard (Daily 6:00 PM ET)
0 18 * * * $NODE_BIN $ENGINE_SCRIPT run D8 --source cron >> $LOG_FILE 2>&1

# D9 — DTC Daily Report (Daily 7:00 PM ET)
0 19 * * * $NODE_BIN $ENGINE_SCRIPT run D9 --source cron >> $LOG_FILE 2>&1

# D10 — Self-Heal Monitor (Every 30 min)
*/30 * * * * $NODE_BIN $ENGINE_SCRIPT run self-heal --source cron >> $LOG_FILE 2>&1

$MARKER_END
EOF
)

# Get current crontab
CURRENT_CRONTAB=$(crontab -l 2>/dev/null || true)

# Remove existing block if present
CLEAN_CRONTAB=$(echo "$CURRENT_CRONTAB" | sed "/$MARKER_START/,/$MARKER_END/d")

# Append new block
NEW_CRONTAB=$(printf "%s\n\n%s\n" "$CLEAN_CRONTAB" "$CRON_BLOCK")

# Install
echo "$NEW_CRONTAB" | crontab -

echo "✅ DTC Retention Engine cron jobs installed (8 entries)."
echo "   Logs: $LOG_FILE"
echo "   Verify: crontab -l | grep DTC_ENGINE"
