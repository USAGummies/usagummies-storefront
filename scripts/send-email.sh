#!/bin/bash
# send-email.sh — Send email via himalaya (IMAP/SMTP)
# Usage: send-email.sh --to "recipient@example.com" --subject "Subject" --body "Body text"
# Usage: send-email.sh --to "recipient@example.com" --subject "Subject" --body-file /path/to/body.txt
#
# Sends from ben@usagummies.com via Gmail SMTP.
# Used by inbox-responder.mjs and other automation scripts.

set -euo pipefail

TO=""
SUBJECT=""
BODY=""
BODY_FILE=""
CC=""
DRY_RUN=false
ALLOW_REPEAT=false
ALLOW_SYSTEM_RECIPIENT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TO="$2"; shift 2 ;;
    --subject) SUBJECT="$2"; shift 2 ;;
    --body) BODY="$2"; shift 2 ;;
    --body-file) BODY_FILE="$2"; shift 2 ;;
    --cc) CC="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --allow-repeat) ALLOW_REPEAT=true; shift ;;
    --allow-system-recipient) ALLOW_SYSTEM_RECIPIENT=true; shift ;;
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
TEMPLATE="From: Ben <ben@usagummies.com>
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

# Recipient repeat guard to prevent accidental auto-reply loops.
if [[ "$ALLOW_REPEAT" != "true" ]]; then
  LOG="/Users/ben/.config/usa-gummies-mcp/email_send_log.md"
  TODAY_ET=$(TZ=America/New_York date +%Y-%m-%d)
  TO_LC=$(echo "$TO" | tr '[:upper:]' '[:lower:]')
  if [[ "$ALLOW_SYSTEM_RECIPIENT" != "true" ]]; then
    if [[ "$TO_LC" =~ ^(no-?reply|donotreply|postmaster|mailer-daemon|dmarc|bounce)@ ]] || [[ "$TO_LC" =~ @(.*\.)?(teamwork\.com|zendesk\.com|freshdesk\.com|helpdesk\.com)$ ]]; then
      echo "SEND_BLOCKED: system/helpdesk recipient guard for $TO"
      exit 3
    fi
  fi
  if [[ -f "$LOG" ]]; then
    SENT_TODAY_TO_RECIPIENT=$(awk -F'|' -v day="$TODAY_ET" -v to_lc="$TO_LC" '
      BEGIN { count=0 }
      {
        ts=$1; gsub(/^ +| +$/, "", ts);
        status=$2; gsub(/^ +| +$/, "", status);
        to=$3; gsub(/^ +| +$/, "", to);
        tl=tolower(to);
        if (index(ts, day)==1 && status=="SENT" && tl==to_lc) count++;
      }
      END { print count+0 }
    ' "$LOG")
    MAX_SENDS_PER_RECIPIENT_PER_DAY=${MAX_SENDS_PER_RECIPIENT_PER_DAY:-1}
    if [[ "${SENT_TODAY_TO_RECIPIENT:-0}" -ge "${MAX_SENDS_PER_RECIPIENT_PER_DAY}" ]]; then
      echo "SEND_BLOCKED: repeat guard tripped for $TO (sent $SENT_TODAY_TO_RECIPIENT times today ET; max=$MAX_SENDS_PER_RECIPIENT_PER_DAY)"
      exit 2
    fi
  fi
fi

# Send via himalaya (disable errexit for status capture)
set +e
RESULT=$(echo "$TEMPLATE" | himalaya message send 2>&1)
STATUS=$?
set -e

echo "$RESULT"

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG="/Users/ben/.config/usa-gummies-mcp/email_send_log.md"

if [[ $STATUS -eq 0 ]]; then
  echo "SENT_OK: Email sent to $TO — Subject: $SUBJECT"
  echo "$TIMESTAMP | SENT | $TO | $SUBJECT" >> "$LOG"
else
  echo "SEND_FAILED: himalaya exit code $STATUS"
  echo "$TIMESTAMP | FAILED | $TO | $SUBJECT | exit=$STATUS" >> "$LOG"
fi

exit $STATUS
