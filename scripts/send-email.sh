#!/bin/bash
# send-email.sh — Send email via himalaya (IMAP/SMTP)
# Usage: send-email.sh --to "recipient@example.com" --subject "Subject" --body "Body text"
# Usage: send-email.sh --to "recipient@example.com" --subject "Subject" --body-file /path/to/body.txt
#
# Called by OpenClaw agents to send outreach emails autonomously.
# Sends from marketing@usagummies.com via Gmail SMTP.

set -euo pipefail

TO=""
SUBJECT=""
BODY=""
BODY_FILE=""
CC=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TO="$2"; shift 2 ;;
    --subject) SUBJECT="$2"; shift 2 ;;
    --body) BODY="$2"; shift 2 ;;
    --body-file) BODY_FILE="$2"; shift 2 ;;
    --cc) CC="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$TO" || -z "$SUBJECT" ]]; then
  echo "ERROR: --to and --subject are required"
  exit 1
fi

if [[ -n "$BODY_FILE" && -f "$BODY_FILE" ]]; then
  BODY=$(cat "$BODY_FILE")
elif [[ -z "$BODY" ]]; then
  echo "ERROR: --body or --body-file required"
  exit 1
fi

# Build MML (MIME Meta Language) template for himalaya
TEMPLATE="From: Ben <marketing@usagummies.com>
To: $TO
Subject: $SUBJECT"

if [[ -n "$CC" ]]; then
  TEMPLATE="$TEMPLATE
Cc: $CC"
fi

TEMPLATE="$TEMPLATE

$BODY"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "=== DRY RUN ==="
  echo "$TEMPLATE"
  echo "=== Would send to: $TO ==="
  exit 0
fi

# Send via himalaya (disable errexit for status capture)
set +e
RESULT=$(echo "$TEMPLATE" | himalaya message send 2>&1)
STATUS=$?
set -e

echo "$RESULT"

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG="/Users/ben/.openclaw/workspace/memory/email_send_log.md"

if [[ $STATUS -eq 0 ]]; then
  echo "SENT_OK: Email sent to $TO — Subject: $SUBJECT"
  echo "$TIMESTAMP | SENT | $TO | $SUBJECT" >> "$LOG"
else
  echo "SEND_FAILED: himalaya exit code $STATUS"
  echo "$TIMESTAMP | FAILED | $TO | $SUBJECT | exit=$STATUS" >> "$LOG"
fi

exit $STATUS
