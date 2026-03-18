#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_FOLDER="${DMARC_TARGET_FOLDER:-AI/Spam or Promo}"
SCAN_COUNT="${DMARC_SCAN_COUNT:-250}"
ACCOUNT="${DMARC_ACCOUNT:-usagummies}"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

bash "$ROOT_DIR/scripts/check-email.sh" --folder INBOX --count "$SCAN_COUNT" --json --account "$ACCOUNT" > "$TMP" 2>/dev/null || true

IDS=$(node - <<'NODE' "$TMP"
const fs = require('fs');
const file = process.argv[2];
const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const idx = raw.indexOf('[');
if (idx < 0) {
  process.stdout.write('');
  process.exit(0);
}
let rows = [];
try {
  rows = JSON.parse(raw.slice(idx));
} catch {
  process.stdout.write('');
  process.exit(0);
}
const isDmarc = (m) => {
  const subject = String(m?.subject || '').toLowerCase();
  const from = String(m?.from?.addr || '').toLowerCase();
  return (
    subject.includes('dmarc') ||
    subject.includes('report domain:') ||
    subject.includes('report domain ') ||
    from.includes('dmarc') ||
    from.includes('noreply-dmarc-support@google.com') ||
    from.includes('dmarcreport@microsoft.com') ||
    from.includes('noreply@dmarc.yahoo.com') ||
    from.includes('mimecastreport.com') ||
    from.includes('zoho.com') && subject.includes('report domain')
  );
};
const ids = rows.filter(isDmarc).map((m) => String(m.id || '').trim()).filter(Boolean);
process.stdout.write(ids.join(' '));
NODE
)

if [[ -z "$IDS" ]]; then
  echo "DMARC cleanup: no matching messages in INBOX."
  exit 0
fi

MOVED=0
FAILED=0
for id in $IDS; do
  if himalaya message move -a "$ACCOUNT" -f INBOX "$TARGET_FOLDER" "$id" >/dev/null 2>&1; then
    MOVED=$((MOVED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
done

echo "DMARC cleanup: moved=$MOVED failed=$FAILED target=$TARGET_FOLDER"
if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
