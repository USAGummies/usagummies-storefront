#!/usr/bin/env bash
#
# Install cron jobs for the USA Gummies SEO Content Domination System (Build 4)
#
# Usage: bash scripts/install-seo-engine-cron.sh
#
# Installs 9 cron entries for agents S1-S9.
# Uses marker-based approach for safe re-installation.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_SCRIPT="$PROJECT_ROOT/scripts/usa-gummies-seo-engine.mjs"
NODE_BIN="$(which node)"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/usagummies-seo-engine.log"

MARKER_START="# >>> USA_GUMMIES_SEO_ENGINE >>>"
MARKER_END="# <<< USA_GUMMIES_SEO_ENGINE <<<"

mkdir -p "$LOG_DIR"

# Build the cron block
CRON_BLOCK=$(cat <<EOF
$MARKER_START
# USA Gummies SEO Content Domination System — installed $(date +%Y-%m-%d)
CRON_TZ=America/New_York

# S1 — Keyword Opportunity Scanner (Weekly Monday 7:00 AM ET)
0 7 * * 1 $NODE_BIN $ENGINE_SCRIPT run S1 --source cron >> $LOG_FILE 2>&1

# S2 — Content Gap Analyzer (Weekly Tuesday 7:00 AM ET)
0 7 * * 2 $NODE_BIN $ENGINE_SCRIPT run S2 --source cron >> $LOG_FILE 2>&1

# S3 — Blog Post Drafter (Weekly Wednesday 7:00 AM ET)
0 7 * * 3 $NODE_BIN $ENGINE_SCRIPT run S3 --source cron >> $LOG_FILE 2>&1

# S4 — Internal Link Optimizer (Weekly Thursday 7:00 AM ET)
0 7 * * 4 $NODE_BIN $ENGINE_SCRIPT run S4 --source cron >> $LOG_FILE 2>&1

# S5 — Blog Performance Tracker (Daily 8:00 PM ET)
0 20 * * * $NODE_BIN $ENGINE_SCRIPT run S5 --source cron >> $LOG_FILE 2>&1

# S6 — Featured Snippet Optimizer (Weekly Friday 7:00 AM ET)
0 7 * * 5 $NODE_BIN $ENGINE_SCRIPT run S6 --source cron >> $LOG_FILE 2>&1

# S7 — Sitemap & Schema Validator (Weekly Saturday 7:00 AM ET)
0 7 * * 6 $NODE_BIN $ENGINE_SCRIPT run S7 --source cron >> $LOG_FILE 2>&1

# S8 — Content Calendar Manager (Weekly Sunday 7:00 AM ET)
0 7 * * 0 $NODE_BIN $ENGINE_SCRIPT run S8 --source cron >> $LOG_FILE 2>&1

# S9 — Self-Heal Monitor (Every 30 min)
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

echo "✅ SEO Engine cron jobs installed (9 entries)."
echo "   Logs: $LOG_FILE"
echo "   Verify: crontab -l | grep SEO_ENGINE"
