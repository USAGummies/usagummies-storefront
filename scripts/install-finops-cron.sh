#!/usr/bin/env bash
#
# Install cron jobs for the USA Gummies Financial Operations Engine (Build 6)
#
# Usage: bash scripts/install-finops-cron.sh
#
# Installs 11 cron entries for agents F1-F11.
# Uses marker-based approach for safe re-installation.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_SCRIPT="$PROJECT_ROOT/scripts/usa-gummies-finops.mjs"
NODE_BIN="$(which node)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/usagummies-finops.log"

MARKER_START="# >>> USA_GUMMIES_FINOPS >>>"
MARKER_END="# <<< USA_GUMMIES_FINOPS <<<"

mkdir -p "$LOG_DIR"

# Build the cron block
CRON_BLOCK=$(cat <<EOF
$MARKER_START
# USA Gummies Financial Operations Engine — installed $(date +%Y-%m-%d)
CRON_TZ=America/New_York

# F1 — Found Transaction Ingestor (Daily 7:00 AM ET)
0 7 * * * $NODE_BIN $ENGINE_SCRIPT run F1 --source cron >> $LOG_FILE 2>&1

# F2 — Invoice Scanner (Daily 7:15 AM ET)
15 7 * * * $NODE_BIN $ENGINE_SCRIPT run F2 --source cron >> $LOG_FILE 2>&1

# F3 — Revenue Reconciler (Daily 7:30 AM ET)
30 7 * * * $NODE_BIN $ENGINE_SCRIPT run F3 --source cron >> $LOG_FILE 2>&1

# F4 — Expense Categorizer (Daily 7:45 AM ET)
45 7 * * * $NODE_BIN $ENGINE_SCRIPT run F4 --source cron >> $LOG_FILE 2>&1

# F5 — Production Cost Allocator (Daily 8:00 AM ET)
0 8 * * * $NODE_BIN $ENGINE_SCRIPT run F5 --source cron >> $LOG_FILE 2>&1

# F6 — Accounts Payable Tracker (Daily 10:00 AM ET)
0 10 * * * $NODE_BIN $ENGINE_SCRIPT run F6 --source cron >> $LOG_FILE 2>&1

# F7 — Accounts Receivable Tracker (Daily 10:15 AM ET)
15 10 * * * $NODE_BIN $ENGINE_SCRIPT run F7 --source cron >> $LOG_FILE 2>&1

# F8 — Cash Flow Calculator (Daily 11:00 AM ET)
0 11 * * * $NODE_BIN $ENGINE_SCRIPT run F8 --source cron >> $LOG_FILE 2>&1

# F9 — P&L Generator (Weekly Sunday 8:00 PM ET)
0 20 * * 0 $NODE_BIN $ENGINE_SCRIPT run F9 --source cron >> $LOG_FILE 2>&1

# F10 — Tax Reserve Calculator (Monthly 1st 9:00 AM ET)
0 9 1 * * $NODE_BIN $ENGINE_SCRIPT run F10 --source cron >> $LOG_FILE 2>&1

# F11 — Self-Heal Monitor (Every 30 min)
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

echo "✅ FinOps cron jobs installed (11 entries)."
echo "   Logs: $LOG_FILE"
echo "   Verify: crontab -l | grep FINOPS"
