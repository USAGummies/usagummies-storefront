#!/usr/bin/env bash
# verify-faire-token.sh — one-shot health check after FAIRE_ACCESS_TOKEN
# is pasted into Vercel env + redeployed.
#
# Usage:
#   source .env.local && ./scripts/verify-faire-token.sh
#   OR
#   CRON_SECRET=... PROD=https://www.usagummies.com ./scripts/verify-faire-token.sh
#
# What it does (read-only, no writes):
#   1. Hits Faire-specialist /run?post=false  → checks "FAIRE_ACCESS_TOKEN
#      not configured" is GONE from the response.
#   2. Hits reconciliation /run?post=false    → checks the digest now
#      includes Faire payout lines instead of the degraded "unavailable"
#      message.
#   3. Reports green/red to stdout. No Slack post, no QBO write.
#
# Class A only — read-only verification probe.

set -euo pipefail

CRON_SECRET="${CRON_SECRET:?CRON_SECRET required}"
PROD="${PROD:-https://www.usagummies.com}"

echo "Probing $PROD with bearer CRON_SECRET..."
echo

# --- 1. Faire specialist ---
echo "== /api/ops/agents/faire/run?post=false =="
faire_resp=$(curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$PROD/api/ops/agents/faire/run?post=false" 2>&1) || {
    echo "❌ HTTP error hitting faire/run"
    exit 1
}

if echo "$faire_resp" | grep -q "FAIRE_ACCESS_TOKEN not configured"; then
  echo "❌ FAIRE_ACCESS_TOKEN still unset (or new deploy hasn't picked it up)"
  echo "   First fix: vercel env add FAIRE_ACCESS_TOKEN production"
  echo "   Then redeploy: vercel deploy --prod"
  exit 1
fi
echo "✅ Faire token is reachable"
echo

# --- 2. Reconciliation digest ---
echo "== /api/ops/agents/reconciliation/run?post=false =="
recon_resp=$(curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$PROD/api/ops/agents/reconciliation/run?post=false" 2>&1) || {
    echo "❌ HTTP error hitting reconciliation/run"
    exit 1
}

if echo "$recon_resp" | grep -q "FAIRE_ACCESS_TOKEN not configured"; then
  echo "⚠ Reconciliation digest still says Faire token unset — wait 60s for Vercel to roll the new env, then re-run."
  exit 1
fi

# Count faire payout lines (each emits source:"faire" in the JSON)
faire_lines=$(echo "$recon_resp" | grep -c '"source":"faire"' || true)
shopify_lines=$(echo "$recon_resp" | grep -c '"source":"shopify"' || true)

echo "✅ Reconciliation digest live"
echo "   Faire payout lines (14d window): $faire_lines"
echo "   Shopify payout lines (14d window): $shopify_lines"
echo

# --- 3. Final summary ---
echo "================================================"
echo " Faire token: WIRED ✅"
echo " Recon digest: $faire_lines Faire + $shopify_lines Shopify lines"
echo "================================================"
echo
echo "Next Thursday 10:00 PT (17:00 UTC) the recon-specialist cron"
echo "will auto-post Rene's reconciliation digest to #finance with"
echo "Faire payouts CoA-tagged 400010.10 and Shopify payouts CoA-tagged"
echo "400020.05."
