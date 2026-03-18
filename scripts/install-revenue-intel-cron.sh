#!/usr/bin/env bash
#
# Install cron jobs for the USA Gummies Revenue Intelligence Engine (Build 2)
#
# Usage: bash scripts/install-revenue-intel-cron.sh
#
# Installs 12 cron entries for agents R1-R12.
# Uses marker-based approach for safe re-installation.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_SCRIPT="$PROJECT_ROOT/scripts/usa-gummies-revenue-intel.mjs"
NODE_BIN="$(which node)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/usagummies-revenue-intel.log"

MARKER_START="# >>> USA_GUMMIES_REVENUE_INTEL >>>"
MARKER_END="# <<< USA_GUMMIES_REVENUE_INTEL <<<"

mkdir -p "$LOG_DIR"

# Build the cron block
CRON_BLOCK=$(cat <<EOF
$MARKER_START
# USA Gummies Revenue Intelligence Engine — installed $(date +%Y-%m-%d)
CRON_TZ=America/New_York

# R1 — Shopify DTC Collector (Daily 9:00 PM ET)
0 21 * * * $NODE_BIN $ENGINE_SCRIPT run R1 --source cron >> $LOG_FILE 2>&1

# R2 — Shopify B2B Collector (Daily 9:05 PM ET)
5 21 * * * $NODE_BIN $ENGINE_SCRIPT run R2 --source cron >> $LOG_FILE 2>&1

# R3 — Amazon Collector (Daily 9:10 PM ET)
10 21 * * * $NODE_BIN $ENGINE_SCRIPT run R3 --source cron >> $LOG_FILE 2>&1

# R4 — Faire Collector (Daily 9:15 PM ET)
15 21 * * * $NODE_BIN $ENGINE_SCRIPT run R4 --source cron >> $LOG_FILE 2>&1

# R5 — GA4 Traffic Collector (Daily 9:20 PM ET)
20 21 * * * $NODE_BIN $ENGINE_SCRIPT run R5 --source cron >> $LOG_FILE 2>&1

# R6 — COGS Calculator (Daily 9:25 PM ET)
25 21 * * * $NODE_BIN $ENGINE_SCRIPT run R6 --source cron >> $LOG_FILE 2>&1

# R7 — Daily Digest Compiler (Daily 9:30 PM ET)
30 21 * * * $NODE_BIN $ENGINE_SCRIPT run R7 --source cron >> $LOG_FILE 2>&1

# R8 — Weekly Trend Analyzer (Weekly Sunday 10:00 PM ET)
0 22 * * 0 $NODE_BIN $ENGINE_SCRIPT run R8 --source cron >> $LOG_FILE 2>&1

# R9 — Monthly Investor Snapshot (Monthly 1st 10:00 PM ET)
0 22 1 * * $NODE_BIN $ENGINE_SCRIPT run R9 --source cron >> $LOG_FILE 2>&1

# R10 — Anomaly Detector (Daily 9:35 PM ET)
35 21 * * * $NODE_BIN $ENGINE_SCRIPT run R10 --source cron >> $LOG_FILE 2>&1

# R11 — Forecast Engine (Weekly Sunday 10:30 PM ET)
30 22 * * 0 $NODE_BIN $ENGINE_SCRIPT run R11 --source cron >> $LOG_FILE 2>&1

# R12 — Self-Heal Monitor (Every 30 min)
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

echo "✅ Revenue Intelligence cron jobs installed (12 entries)."
echo "   Logs: $LOG_FILE"
echo "   Verify: crontab -l | grep REVENUE_INTEL"
