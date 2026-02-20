#!/bin/bash
# check-email.sh — Read emails via himalaya (IMAP)
# Usage: check-email.sh --folder "Sent" --count 20        # List recent sent emails
# Usage: check-email.sh --folder "INBOX" --count 10       # List inbox
# Usage: check-email.sh --search "from:someone@example.com" --folder "INBOX"
# Usage: check-email.sh --read <envelope-id>               # Read specific email body
#
# Called by OpenClaw agents to check email status and replies.

set -euo pipefail

FOLDER="INBOX"
COUNT=20
SEARCH=""
READ_ID=""
OUTPUT="plain"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --folder) FOLDER="$2"; shift 2 ;;
    --count) COUNT="$2"; shift 2 ;;
    --search) SEARCH="$2"; shift 2 ;;
    --read) READ_ID="$2"; shift 2 ;;
    --json) OUTPUT="json"; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -n "$READ_ID" ]]; then
  # Read a specific message body
  himalaya message read -o "$OUTPUT" "$READ_ID" 2>&1
elif [[ -n "$SEARCH" ]]; then
  # Search emails
  himalaya envelope search -f "$FOLDER" -s "$COUNT" -o "$OUTPUT" "$SEARCH" 2>&1
else
  # List recent envelopes
  himalaya envelope list -f "$FOLDER" -s "$COUNT" -o "$OUTPUT" 2>&1
fi
