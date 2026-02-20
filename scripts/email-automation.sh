#!/bin/bash
# email-automation.sh — Runs email drip + inbox responder
# Called every 2 hours by launchd

NODE="/opt/homebrew/bin/node"
DIR="$(dirname "$0")"

echo ""
echo "=============================="
echo "Email automation run: $(date)"
echo "=============================="

echo ""
echo "--- Email Drip ---"
$NODE "$DIR/email-drip.mjs" 2>&1

echo ""
echo "--- Inbox Responder ---"
$NODE "$DIR/inbox-responder.mjs" 2>&1

echo ""
echo "Done: $(date)"
