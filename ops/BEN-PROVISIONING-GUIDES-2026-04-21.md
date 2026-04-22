# Provisioning Guides — Finish What's Wired

This doc covers the 10 manual provisioning tasks from `/ops/MORNING-2026-04-21.md`. Each section tells you **exactly where to click** and **where to paste the result**, so you never have to dig through vendor docs.

---

## 1. Top up Stamps.com wallet (URGENT — blocks next label buy)

1. Go to https://ship.shipstation.com/settings/shipping-providers
2. Click **Stamps.com** row → **Top-up Funds**
3. Enter $150-200 (recommended for a week of Amazon FBM + Shopify DTC)
4. Credit card on file: Visa ••••0661 (already saved)
5. **Verify:** Open https://www.usagummies.com/ops/shipping — the `stamps_com` card should show the new balance and go green (no red "BELOW FLOOR" tag)

**No env / code action needed.** Preflight auto-picks up new balance on next call.

---

## 2. Configure Shopify `orders/paid` webhook

1. Shopify Admin → https://usagummies.myshopify.com/admin/settings/notifications
2. Scroll to **Webhooks** section → **Create webhook**
3. **Event:** `Order payment`
4. **Format:** JSON
5. **URL:** `https://www.usagummies.com/api/ops/webhooks/shopify/orders-paid`
6. **API version:** 2025-01 (matches our client)
7. Click **Save**
8. Copy the "Signing secret" from the webhook-detail page (it appears after save)

### If `SHOPIFY_WEBHOOK_SECRET` is already set on Vercel (it should be):
- No further action. The webhook fires on the next paid order and the route HMAC-verifies the payload.

### If you need to set or rotate it:
```bash
echo -n "<signing secret from Shopify>" | vercel env add SHOPIFY_WEBHOOK_SECRET production
echo -n "<signing secret from Shopify>" | vercel env add SHOPIFY_WEBHOOK_SECRET preview
# Trigger redeploy via empty commit or vercel deploy
```

### Verify:
Place a test $1 order on usagummies.com with a test coupon. Within 5-30 seconds:
- `#ops-approvals` should receive a Class B shipment.create proposal
- Approve → label fires

---

## 3. Configure HubSpot `deal.propertyChange` webhook

**Step A — Get the Private App signing secret:**

1. HubSpot → https://app.hubspot.com/private-apps
2. Open your existing private app (the one whose token is in `HUBSPOT_PRIVATE_APP_TOKEN` on Vercel)
3. Go to **Webhooks** tab → **Subscribe**
4. Copy the **Client secret** (shown under the app's **Auth** tab — this is the `HUBSPOT_APP_SECRET`)

**Step B — Set the env var:**

```bash
echo -n "<client secret>" | vercel env add HUBSPOT_APP_SECRET production
echo -n "<client secret>" | vercel env add HUBSPOT_APP_SECRET preview
# Trigger redeploy
```

**Step C — Create the subscription:**

1. On the app's **Webhooks** tab → **Create subscription**
2. **Object:** `Deal`
3. **Event:** `Property change`
4. **Property:** `dealstage` (only subscribe to this one to avoid noise)
5. **Target URL:** `https://www.usagummies.com/api/ops/webhooks/hubspot/deal-stage-changed`
6. Save subscription
7. Toggle subscription to **Active**

**Step D — Test:**

1. Open any deal in HubSpot
2. Change the stage from "Lead" to "PO Received"
3. Within 30 seconds, a Class B proposal should appear in `#ops-approvals`

---

## 4. Create Notion `/Legal/Compliance Calendar` database

Until this lands, the Compliance Specialist runs in `[FALLBACK]` mode (surfaces 11 obligation categories without real dates).

### Minimum schema (Notion properties):

| Column | Type | Notes |
|---|---|---|
| Name | Title | e.g. "WY Annual Report" |
| Due | Date | The actual calendar date |
| Owner | Text | "Ben" / "Rene" / "Drew" / "Counsel" |
| Status | Status | "Upcoming" / "In progress" / "Done" / "Missed" |
| Category | Select | "corporate" / "tax" / "trademark" / "fda" / "insurance" / "license" / "contracts" |

### Pre-seed list to copy into the DB:

Source material lives in `/Users/ben/usagummies-storefront/src/lib/ops/compliance-doctrine.ts` — every entry's title + category is already in code. Copy the 11 obligations in, add the real Due dates from your filings + Wyoming Attorneys LLC records, and set Status to "Upcoming".

### Share the DB with the Notion integration:

1. Click **Share** in the top-right of the DB
2. Invite the integration that holds `NOTION_TOKEN` (the same one used for Viktor / compliance agent)
3. Give it **Can edit** access

**Verify:** Next weekday 11:00 PT, the Compliance Specialist will switch from `[FALLBACK]` to live-mode (your real dates shown, 60/30/15-day alerts fire).

---

## 5. Provision `FAIRE_ACCESS_TOKEN`

### If you have a Faire Brand account:

1. Log into https://faire.com as your brand (USA Gummies)
2. Navigate to Settings → API / Developer (if present — Faire's brand API is invitation-only)
3. Generate a personal access token
4. Set on Vercel:

```bash
echo -n "<faire token>" | vercel env add FAIRE_ACCESS_TOKEN production
echo -n "<faire token>" | vercel env add FAIRE_ACCESS_TOKEN preview
```

### If Faire's API isn't available:

The Twin.so browser automation fallback is in project memory (reference_twin_faire.md). Worth considering once Faire volume justifies the setup — until then, the Faire Specialist cleanly degrades with "FAIRE_ACCESS_TOKEN not set" every Thursday.

---

## 6. Provision `BOOKE_API_TOKEN` (or Zapier bridge)

### Option A — Direct API token:

1. Log into https://booke.ai
2. Settings → API → Generate personal access token
3. Set on Vercel:

```bash
echo -n "<booke token>" | vercel env add BOOKE_API_TOKEN production
```

### Option B — Zapier bridge (no direct API):

1. Create a Zapier scenario:
   - **Trigger:** Schedule → every 1 hour
   - **Action:** HTTP POST
   - **URL:** `https://www.usagummies.com/api/ops/booke/push`
   - **Headers:** `Authorization: Bearer <CRON_SECRET>` (pull from Vercel env)
   - **Body:** `{"count": <Booke's uncategorized count, pulled via a prior Zapier step that scrapes Booke's dashboard>}`
2. Turn on the scenario

The Finance Exception Agent reads the `booke:uncategorized_count` KV key (populated by the push route) and renders it in Rene's morning digest.

---

## 7. Tune `INVENTORY_BURN_RATE_BAGS_PER_DAY`

Default: 250 bags/day (placeholder).

### To compute the real rate:

1. Over the last 30 days, sum `units shipped` across Shopify + Amazon + Faire orders
2. Divide by 30
3. Round

Or pull it from the finance reports once they're stable. Set on Vercel:

```bash
echo -n "<your actual rate, e.g. 180>" | vercel env add INVENTORY_BURN_RATE_BAGS_PER_DAY production
```

### Per-SKU overrides (optional):

```bash
echo -n "150" | vercel env add INVENTORY_BURN_RATE_UG_AAGB_6CT production
echo -n "30" | vercel env add INVENTORY_BURN_RATE_UG_AAGB_MAILER production
```

**Verify:** Hit https://www.usagummies.com/api/ops/inventory/cover-days — each row should show the updated `burnRatePerDay`.

---

## 8. Follow up on Stamps.com refund escalation ($130.90 pending)

1. Check Gmail for reply to the 2026-04-20 email (Subject: `Refund escalation — 17 USPS labels voided 2026-04-10, no credit on account bstutman-1309c`)
2. If reply exists, paste the status into the thread Ben uses for internal tracking
3. If no reply by Wednesday 2026-04-22, follow up:

> Hi team — following up on my 2026-04-20 ticket. I haven't received any response or seen the $130.90 credit post to my Stamps.com wallet. Please confirm receipt and provide an ETA. Reference: 17 tracking numbers listed below + shipmentIDs starting with 13530xxxx, all voided 2026-04-10.

The full list of 17 tracking numbers + shipmentIds is in the original email body + `/tmp/voided_labels_stale.json` (if still present on the laptop) + the `/api/ops/shipstation/voided-labels` route response.

### Escalation path if still unresolved 7 days out:

- Direct Stamps.com support: `support@stamps.com` with subject "Escalation — refund outstanding account bstutman-1309c"
- Or chat via https://www.stamps.com → Contact → Live chat (M-F business hours)

---

## 9. Vercel cron count monitor (B-24)

Current count: **15 crons** in `vercel.json`.

```bash
grep '"schedule"' vercel.json | wc -l
# 15
```

### Historical Vercel Hobby cron limits:

- 2024: 2 crons max
- Mid-2025: relaxed to ~40 crons
- 2026: Hobby Plan officially lists unlimited cron count but throttles aggressive usage

### If Vercel rejects a cron on next deploy:

The build output will contain an error like `Cron job limit exceeded`. Fallback:

1. Identify the lowest-priority cron (likely `research` Friday 11:00 PT or `faire` Thursday 11:00 PT — both degraded anyway)
2. Remove from `vercel.json`
3. Recreate as a Make.com scenario: Schedule trigger → HTTP POST to the route with the CRON_SECRET bearer header

---

## 10. ShipStation webhook verification (B-13)

Webhook ID 106614 was registered for `ITEM_SHIP_NOTIFY` on 2026-04-20.

### Verify it's still active:

```bash
curl -u "$SHIPSTATION_API_KEY:$SHIPSTATION_API_SECRET" https://ssapi.shipstation.com/webhooks | jq
```

Should include an entry with `"WebhookId": 106614` pointing at `https://www.usagummies.com/api/ops/fulfillment/tracking-webhook?token=<FULFILLMENT_WEBHOOK_SECRET>`.

### If missing (ShipStation deleted / MFA lockout occurred):

```bash
curl -X POST -u "$SHIPSTATION_API_KEY:$SHIPSTATION_API_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "target_url": "https://www.usagummies.com/api/ops/fulfillment/tracking-webhook?token=REPLACE_WITH_FULFILLMENT_WEBHOOK_SECRET",
    "event": "ITEM_SHIP_NOTIFY",
    "store_id": null,
    "friendly_name": "USA Gummies auto-clear on ship"
  }' \
  https://ssapi.shipstation.com/webhooks/subscribe
```

Replace the secret, note the new Webhook ID that returns.

---

## Done so far by me tonight

The code is all live. What's ABOVE is strictly your manual config work. Each section is standalone — you can tackle them in any order. Recommended priority:

1. #1 (Stamps.com top-up) — blocks your next label buy
2. #2 (Shopify webhook) — starts auto-dispatch on DTC
3. #8 (refund follow-up) — money we're owed
4. #3 (HubSpot webhook) — automates wholesale dispatch
5. #7 (burn rate) — cover-day accuracy
6. #4 (Notion Compliance Calendar) — with counsel
7. #5 (Faire) + #6 (Booke) — lower priority
8. #10 (webhook verify) — belt-and-suspenders sanity
9. #9 (cron monitor) — passive watch
