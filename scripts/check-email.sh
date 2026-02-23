#!/bin/bash
# check-email.sh — Read emails via himalaya v1.1.0 (IMAP)
# Usage: check-email.sh --folder "Sent" --count 20        # List recent sent emails
# Usage: check-email.sh --folder "INBOX" --count 10       # List inbox
# Usage: check-email.sh --search "from faire"             # Search inbox (himalaya query syntax)
# Usage: check-email.sh --read <envelope-id>               # Read specific email body
#
# Used by inbox-responder.mjs and other automation scripts.

set -euo pipefail

FOLDER="INBOX"
COUNT=20
SEARCH=""
READ_ID=""
OUTPUT="plain"
ACCOUNT="usagummies"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --folder) FOLDER="$2"; shift 2 ;;
    --count) COUNT="$2"; shift 2 ;;
    --search) SEARCH="$2"; shift 2 ;;
    --read) READ_ID="$2"; shift 2 ;;
    --json) OUTPUT="json"; shift ;;
    --account) ACCOUNT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -n "$READ_ID" ]]; then
  # Read a specific message body
  himalaya message read -a "$ACCOUNT" -o "$OUTPUT" "$READ_ID" 2>&1
elif [[ -n "$SEARCH" ]]; then
  # Search emails via himalaya query (e.g., "from faire", "subject order")
  himalaya envelope list -a "$ACCOUNT" -f "$FOLDER" -s "$COUNT" -o "$OUTPUT" $SEARCH 2>&1
else
  # List recent envelopes
  himalaya envelope list -a "$ACCOUNT" -f "$FOLDER" -s "$COUNT" -o "$OUTPUT" 2>&1
fi
