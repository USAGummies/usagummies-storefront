#!/usr/bin/env bash
#
# Install cron jobs for the USA Gummies Supply Chain Orchestrator (Build 5)
#
# Usage: bash scripts/install-supply-chain-cron.sh
#
# Installs 8 cron entries for agents SC1-SC8.
# Uses marker-based approach for safe re-installation.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_SCRIPT="$PROJECT_ROOT/scripts/usa-gummies-supply-chain.mjs"
NODE_BIN="$(which node)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/usagummies-supply-chain.log"

MARKER_START="# >>> USA_GUMMIES_SUPPLY_CHAIN >>>"
MARKER_END="# <<< USA_GUMMIES_SUPPLY_CHAIN <<<"

mkdir -p "$LOG_DIR"

# Build the cron block
CRON_BLOCK=$(cat <<EOF
$MARKER_START
# USA Gummies Supply Chain Orchestrator — installed $(date +%Y-%m-%d)
CRON_TZ=America/New_York

# SC1 — Inventory Level Monitor (Daily 7:00 AM ET)
0 7 * * * $NODE_BIN $ENGINE_SCRIPT run SC1 --source cron >> $LOG_FILE 2>&1

# SC2 — Sales Velocity Calculator (Daily 7:15 AM ET)
15 7 * * * $NODE_BIN $ENGINE_SCRIPT run SC2 --source cron >> $LOG_FILE 2>&1

# SC3 — Reorder Point Calculator (Daily 7:30 AM ET)
30 7 * * * $NODE_BIN $ENGINE_SCRIPT run SC3 --source cron >> $LOG_FILE 2>&1

# SC4 — Production Scheduler (Weekly Monday 7:45 AM ET)
45 7 * * 1 $NODE_BIN $ENGINE_SCRIPT run SC4 --source cron >> $LOG_FILE 2>&1

# SC5 — Supplier Price Tracker (Monthly 1st 8:00 AM ET)
0 8 1 * * $NODE_BIN $ENGINE_SCRIPT run SC5 --source cron >> $LOG_FILE 2>&1

# SC6 — Fulfillment Monitor (Daily 12:00 PM ET)
0 12 * * * $NODE_BIN $ENGINE_SCRIPT run SC6 --source cron >> $LOG_FILE 2>&1

# SC7 — Amazon FBA Inventory Sync (Daily 1:00 PM ET)
0 13 * * * $NODE_BIN $ENGINE_SCRIPT run SC7 --source cron >> $LOG_FILE 2>&1

# SC8 — Self-Heal Monitor (Every 30 min)
*/30 * * * * $NODE_BIN $ENGINE_SCRIPT run self-heal --source cron >> $LOG_FILE 2>&1

$MARKER_END
EOF
)

# Get current crontab
CURRENT_CRONTAB=$(crontab -l 2>/dev/null || true)

# Remove existing block if present
CLEAN_CRONTAB=$(echo "$CURRENT_CRONTAB" | sed "/$MARKER_START/,$MARKER_END/d")

# Append new block
NEW_CRONTAB=$(printf "%s\n\n%s\n" "$CLEAN_CRONTAB" "$CRON_BLOCK")

# Install
echo "$NEW_CRONTAB" | crontab -

echo "Supply Chain Orchestrator cron jobs installed (8 entries)."
echo "   Logs: $LOG_FILE"
echo "   Verify: crontab -l | grep SUPPLY_CHAIN"
