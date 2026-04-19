# Make.com Scenario Inventory — USA Gummies 3.0

**Purpose:** authoritative inventory of every Make.com scenario in the USA Gummies team, with current state, owner, source/destination, purpose, failure path, and 3.0 disposition. Verified live against the Make API on **2026-04-19**.

**Authority:** [`/contracts/channels.json`](../contracts/channels.json) defines which Slack channels survive go-live; this doc maps each scenario to that registry.

**API used to verify:**
```bash
curl -sS -H "Authorization: Token $MAKE_API_TOKEN" \
  "https://us2.make.com/api/v2/scenarios?teamId=1826571"
# plus per-scenario /scenarios/<id>/blueprint for source/destination
```

---

## Live runtime state (snapshot 2026-04-19)

- **Total scenarios:** 22
- **`isActive: true` (intent: enabled):** 19
- **`isActive: false` (intent: disabled):** 3 — `Amazon FBA Velocity Alert` (#4711837), `Instantly Reply Detector` (#4711828), `Instantly to HubSpot Lead Sync` (#4712381)
- **`isPaused: true` (currently not running):** 22 of 22 — **the entire Make.com runtime is paused.** Last edit timestamp on every scenario is 2026-04-12; oldest `nextExec` was 2026-04-15. No scenarios have fired since then.
- **`isinvalid: true`:** 0
- **DLQ count:** 0 across all scenarios

The platform-wide pause is the right state for go-live — every scenario below either needs to be retargeted to the new 3.0 channels or killed before it resumes posting.

---

## Channel-ID legend

These are the destination Slack channel IDs found in the live blueprints, mapped to the canonical 3.0 channel registry in [`/contracts/channels.json`](../contracts/channels.json):

| Channel ID | Legacy name | 3.0 disposition | Routes to (3.0) |
|---|---|---|---|
| `C0ALS6W7VB4` | `#abra-control` | retired (archive) | `#ops-daily` |
| `C0AKG9FSC2J` | `#financials` | not in active list — legacy | `#finance` |
| `C0AS1GXU18T` | `#orders` | not in active list — legacy | `#sales` (revenue events) or `#operations` (inventory/shipping) |
| `C0AS7UHNGPL` | `#wholesale-leads` | retired (rename or archive) | `#sales` |
| `C0AS7UHDHS6` | `#customer-feedback` | retired (fold) | `#sales` |
| `C0ARSF61U5D` | `#email-inbox` | retired (fold) | `#sales` |
| `C0AT26ZC6F2` | `#abandoned-carts` | retired (fold) | `#sales` |

---

## Inventory

**Owner:** Ben for every scenario (`createdByUser` + `updatedByUser` = Benjamin Stutman across all 22).

**Trigger:** Make.com Schedule module on the listed interval (no webhook-triggered scenarios in the workspace).

**Failure path (default):** every scenario uses the same pattern — `Source → OpenAI GPT (returns "SKIP" if no new data) → Slack CreateMessage`. There is no DLQ wiring, no retry policy, and no alert on failure beyond Make.com's default email-on-error to `ben@usagummies.com`. A failure leaves the data in the source system; the next scheduled run re-pulls fresh.

### Speed layer (real-time / sub-hour)

#### `Abandoned Cart Recovery` — `#4711622`
- **State:** isActive=true, isPaused=true (workspace-wide pause)
- **Trigger:** every 30 min
- **Source:** Shopify Admin API — `GET /admin/api/2025-01/checkouts.json` (open checkouts)
- **Destination:** `C0AT26ZC6F2` (#abandoned-carts — RETIRED)
- **Purpose:** detect abandoned carts and post a recovery prompt
- **Failure path:** GPT returns SKIP if no abandoned carts; on Shopify 4xx/5xx the run errors and Make emails Ben.
- **Still needed in 3.0:** **No.** Abandoned-cart recovery should be Shopify's native flow (Klaviyo-style email) or a Viktor-owned cart-recovery agent. A 30-min Slack ping that requires human follow-up is exactly the firehose pattern §15.6 forbids.
- **Recommended action:** **disable** (don't delete — Klaviyo decision pending). Until disable, retarget destination to `#sales` so the post doesn't 404 when `#abandoned-carts` is archived.

#### `Customer Feedback Monitor` — `#4711623`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 30 min
- **Source:** Gmail — `q=subject:(feedback OR review OR complaint)`
- **Destination:** `C0AS7UHDHS6` (#customer-feedback — RETIRED)
- **Purpose:** surface customer feedback emails for human triage
- **Failure path:** GPT SKIP if no matches; Gmail rate-limit → Make error email.
- **Still needed in 3.0:** **Yes, but rehome.** The 3.0 model folds customer feedback into `#sales` (or latent `#cx` once that division activates).
- **Recommended action:** **modify** — repoint destination to `#sales`, change channel ID from `C0AS7UHDHS6` to the new `#sales` channel ID once Ben creates it.

#### `Gmail Smart Router` — `#4711618`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 30 min
- **Source:** Gmail — `/v1/users/me/threads?q=in:inbox after:{{30min}}`
- **Destination:** `C0ARSF61U5D` (#email-inbox — RETIRED)
- **Purpose:** GPT tags inbound mail and posts a routing summary; downstream Viktor SENTINEL reads from this channel for deeper processing
- **Failure path:** GPT SKIP if no new threads; Gmail rate-limit → Make error email.
- **Still needed in 3.0:** **Yes, but rehome.** Per memory `reference_make_automation.md`, this is the spine of the speed→intelligence handoff (Make does the cheap routing, Viktor SENTINEL does the deeper processing from the resulting Slack post). The `#email-inbox` channel is being folded into `#sales`.
- **Recommended action:** **modify** — repoint destination to `#sales`. Keep the GPT tags so Viktor can still discriminate.

#### `Shopify Order Alerts` — `#4711620`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 15 min
- **Source:** Shopify Admin API — `GET /admin/api/2025-01/orders.json`
- **Destination:** `C0AS1GXU18T` (#orders — legacy)
- **Purpose:** post a Slack alert per new paid order
- **Failure path:** GPT SKIP on no new orders; Shopify 4xx/5xx → Make error email.
- **Still needed in 3.0:** **Conflict-flag.** The 3.0 daily brief (`/api/ops/daily-brief?kind=morning`) already aggregates yesterday's Shopify revenue from a Make pre-fetch (per `ops/make-webhooks.md` §4.1). A separate per-order firehose duplicates that data and contradicts §15.6 ("do not add more tools until the current tools have one owner"). However Ben may want per-order pings as a fast-feedback signal during launch.
- **Recommended action:** **modify** — repoint destination to `#sales`. Leave enabled at 15-min cadence as a per-order ping; the daily brief continues to aggregate. If Ben finds the volume noisy, downgrade to `disable` and rely solely on the brief.

#### `Wholesale Lead Capture` — `#4711621`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 30 min
- **Source:** Gmail — `q=subject:(wholesale OR bulk OR distributor)`
- **Destination:** `C0AS7UHNGPL` (#wholesale-leads — RETIRED)
- **Purpose:** surface inbound wholesale inquiries
- **Failure path:** GPT SKIP if no matches; Gmail rate-limit → Make error email.
- **Still needed in 3.0:** **Yes, but rehome.** Wholesale leads are core sales workflow; `#wholesale-leads` folds into `#sales`.
- **Recommended action:** **modify** — repoint destination to `#sales`.

### Intelligence layer (15 min – 1 hr)

#### `B2B Reply Detector` — `#4711826`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 30 min
- **Source:** Gmail — `q=(wholesale OR bulk OR distributor) (RE: OR Re:)`
- **Destination:** `C0AS7UHNGPL` (#wholesale-leads — RETIRED)
- **Purpose:** detect replies on wholesale threads so they don't get lost
- **Failure path:** GPT SKIP if no matches; Gmail error → Make email.
- **Still needed in 3.0:** **Yes, but rehome.** This is the function that previously failed on the Jungle Jim's draft (`feedback_rainier_tracking.md` / blocked-items B-11 evidence) — keeping it is part of the remediation.
- **Recommended action:** **modify** — repoint destination to `#sales`.

#### `B2B Follow-Up Reminder` — `#4711838`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 1 hr
- **Source:** Gmail — `q=subject:(wholesale OR bulk OR distributor)` filtered for stale threads
- **Destination:** `C0AS7UHNGPL` (#wholesale-leads — RETIRED)
- **Purpose:** ping when a B2B thread has gone quiet too long
- **Failure path:** GPT SKIP / Gmail error → Make email.
- **Still needed in 3.0:** **Conflict-flag.** Viktor's `next_action_date` field in HubSpot (per Tuesday T1) is the canonical 3.0 stale-deal mechanism. Two systems pinging on the same signal will create duplicate work.
- **Recommended action:** **disable** — let HubSpot/Viktor own stale-lead reminders. Re-enable only if Viktor's coverage proves insufficient after 2 weeks of go-live data.

#### `HubSpot Pipeline Monitor` — `#4711827`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 30 min
- **Source:** HubSpot CRM — `watchDeals` module
- **Destination:** `C0ALS6W7VB4` (#abra-control — RETIRED)
- **Purpose:** post when a deal stage changes
- **Failure path:** GPT SKIP if no new stage moves; HubSpot 4xx → Make email.
- **Still needed in 3.0:** **Conflict-flag.** Pipeline movement belongs in `#sales`, not `#ops-daily` — `#ops-daily` is for the executive rollup, not raw deal-level events. The daily brief composer also has a `pipelineYesterday` extension reserved (`make-webhooks.md` §4.4) which would aggregate this into the daily roll-up.
- **Recommended action:** **modify** — repoint destination to `#sales` for live events; once the daily brief's `pipelineYesterday` line is wired (post-Monday), reconsider whether per-stage pings are still needed.

#### `Instantly Reply Detector` — `#4711828`
- **State:** **isActive=false, isPaused=true** (already disabled)
- **Trigger:** every 15 min
- **Source:** Instantly API — `GET /api/v2/campaigns`
- **Destination:** `C0AS7UHNGPL` (#wholesale-leads — RETIRED)
- **Purpose:** detect Instantly outbound replies
- **Failure path:** never executes (disabled).
- **Still needed in 3.0:** **No.** Instantly was dropped from the stack (per `feedback_tech_stack_correction.md`). Make connection #8312617 (Instantly) is also flagged for revocation in `monday-checklist.md` M2c.
- **Recommended action:** **delete** — explicit kill per M2c. Already inactive; delete to prevent accidental re-enable.

#### `Instantly to HubSpot Lead Sync` — `#4712381`
- **State:** **isActive=false, isPaused=true** (already disabled)
- **Trigger:** every 15 min
- **Source:** Instantly API — `GET /api/v2/leads?sort_by=reply_time`
- **Destination:** `C0AS7UHNGPL` (#wholesale-leads — RETIRED)
- **Purpose:** push Instantly replies to HubSpot
- **Failure path:** never executes (disabled).
- **Still needed in 3.0:** **No.** Same reason as #4711828.
- **Recommended action:** **delete** — explicit kill per M2c.

#### `New Customer Welcome` — `#4711829`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 1 hr
- **Source:** Shopify Admin API — `GET /admin/api/2025-01/customers.json`
- **Destination:** `C0AS1GXU18T` (#orders — legacy)
- **Purpose:** alert when a new DTC customer registers
- **Failure path:** GPT SKIP if none; Shopify 4xx → Make email.
- **Still needed in 3.0:** **Probably no.** Welcome flows belong in Klaviyo/Shopify email automation, not a Slack ping. A Slack post about a new customer is information without action — exactly what §15.6 calls out.
- **Recommended action:** **disable**.

#### `Shopify Refund Alert` — `#4711830`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 1 hr
- **Source:** Shopify Admin API — `GET /admin/api/2025-01/orders.json` filtered for refunds
- **Destination:** `C0AS1GXU18T` (#orders — legacy)
- **Purpose:** alert on a refund being issued
- **Failure path:** GPT SKIP if none; Shopify 4xx → Make email.
- **Still needed in 3.0:** **Yes, but rehome.** Refunds are a revenue event AND a possible AP/finance signal — post to `#sales` (revenue) and let Booke pick up the financial impact via QBO. **Do not** dual-post; one source of truth per channel.
- **Recommended action:** **modify** — repoint destination to `#sales`.

#### `ShipStation Shipping Alerts` — `#4711832`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 1 hr
- **Source:** ShipStation API — `GET /shipments?createDateStart={{1h ago}}`
- **Destination:** `C0AS1GXU18T` (#orders — legacy)
- **Purpose:** alert when shipments go out
- **Failure path:** GPT SKIP if none; ShipStation 4xx → Make email.
- **Still needed in 3.0:** **Yes, rehome.** Shipping is operational, not sales — belongs in `#operations` per channels.json (purpose: "Production, supply, samples, shipping").
- **Recommended action:** **modify** — repoint destination to `#operations`.

#### `Shopify to QBO Sync` — `#4711833`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 1 hr
- **Source:** Shopify Admin API — `GET /admin/api/2025-01/orders.json`
- **Destination:** `C0AKG9FSC2J` (#financials — legacy)
- **Purpose:** push Shopify orders to QBO as invoices
- **Failure path:** GPT SKIP if none; QBO 4xx → Make email. **No idempotency key visible in blueprint** — re-runs may create duplicate invoices in QBO.
- **Still needed in 3.0:** **Conflict-flag.** Per CLAUDE.md "Shopify DTC" is a tracked QBO revenue channel, but the canonical 3.0 path is for Booke (the finance agent under `/contracts/agents/booke.md`) to own the Shopify→QBO posting with a real idempotency key — not a Make scenario writing without dedup. Risk: duplicate revenue lines in QBO.
- **Recommended action:** **disable** until Booke owns the sync, OR **modify** to add an explicit dedup key (Shopify order ID → QBO invoice DocNumber) and repoint destination notification to `#finance`. Default recommendation: **disable** — let Booke own this end-to-end.

#### `Vendor Bill Tracking` — `#4711836`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 30 min
- **Source:** Gmail — `q=from:(powers OR belmark OR pirateship)`
- **Destination:** `C0AKG9FSC2J` (#financials — legacy)
- **Purpose:** flag vendor bill emails for AP entry
- **Failure path:** GPT SKIP if none; Gmail rate-limit → Make email.
- **Still needed in 3.0:** **Yes, rehome.** This is real AP intake. `#financials` maps to `#finance` in 3.0.
- **Recommended action:** **modify** — repoint destination to `#finance`.

### Daily / weekly digests

#### `Amazon FBA Velocity Alert` — `#4711837`
- **State:** **isActive=false** (already disabled, never run — `operations: 0`)
- **Trigger:** every 24 hr
- **Source:** Amazon SP-API — `GET /fba/inventory/v1/summaries`
- **Destination:** `C0AS1GXU18T` (#orders — legacy)
- **Purpose:** alert on FBA velocity changes
- **Failure path:** never executes (disabled).
- **Still needed in 3.0:** **No.** Per `reference_make_automation.md`: "too complex for Make.com (SP-API OAuth), Viktor's RADAR cron handles it." That call still stands — SP-API auth lives in `claude_desktop_config.json`, not in a Make HTTP module.
- **Recommended action:** **delete**.

#### `Discount Code Tracker` — `#4711839`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 1 hr
- **Source:** Shopify Admin API — `GET /admin/api/2024-01/price_rules.json`
- **Destination:** `C0AS1GXU18T` (#orders — legacy)
- **Purpose:** flag new or used discount codes
- **Failure path:** GPT SKIP if none; Shopify 4xx → Make email.
- **Still needed in 3.0:** **Probably no.** Discount-code visibility isn't a load-bearing 3.0 signal — it doesn't surface in the daily brief, doesn't trigger an approval, doesn't drive a decision. Information without an owner.
- **Recommended action:** **disable** (keep the blueprint in case Ben wants discount-promo intelligence later).

#### `Inventory Level Alerts` — `#4711840`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 1 hr
- **Source:** Shopify Admin API — `GET /admin/api/2025-01/inventory_levels.json`
- **Destination:** `C0AS1GXU18T` (#orders — legacy)
- **Purpose:** alert when inventory drops below threshold
- **Failure path:** GPT SKIP if above threshold; Shopify 4xx → Make email.
- **Still needed in 3.0:** **Yes, rehome.** Inventory is operational — belongs in `#operations`.
- **Recommended action:** **modify** — repoint destination to `#operations`. Verify the GPT prompt has a real low-stock threshold (otherwise it'll fire continuously).

#### `Morning Ops Brief` — `#4711841`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 24 hr
- **Source:** Shopify Admin API — `GET /admin/api/2024-01/orders.json`
- **Destination:** `C0ALS6W7VB4` (#abra-control — RETIRED)
- **Purpose:** Shopify-only daily revenue summary
- **Failure path:** GPT SKIP if no new data; Shopify 4xx → Make email.
- **Still needed in 3.0:** **No — direct conflict with the canonical 3.0 daily brief.** [`/api/ops/daily-brief?kind=morning`](../src/app/api/ops/daily-brief) is the single source of truth and aggregates Shopify + Amazon + Faire + Plaid cash. Two daily briefs in parallel would post conflicting numbers to the same audience.
- **Recommended action:** **delete**. The replacement is the scheduled HTTP scenario in [`make-webhooks.md`](make-webhooks.md) §1.1 that calls `/api/ops/daily-brief?kind=morning` weekdays at 07:00 PT.

#### `Shopify Low Stock Alert` — `#4711842`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 1 hr
- **Source:** Shopify Admin API — `GET /admin/api/2025-01/products.json`
- **Destination:** `C0AS1GXU18T` (#orders — legacy)
- **Purpose:** low-stock alert by product
- **Failure path:** GPT SKIP if above threshold; Shopify 4xx → Make email.
- **Still needed in 3.0:** **Conflict-flag.** Functionally duplicates `Inventory Level Alerts` (#4711840) — both query Shopify for stock signals and post to the same channel. Pick one.
- **Recommended action:** **delete** — keep `Inventory Level Alerts` (#4711840), kill this one.

#### `Weekly P&L Summary` — `#4711843`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 7 days
- **Source:** QBO via `https://www.usagummies.com/api/ops/qbo/query?type=pnl`
- **Destination:** `C0AKG9FSC2J` (#financials — legacy)
- **Purpose:** weekly P&L snapshot for Rene
- **Failure path:** GPT SKIP if no new data; QBO API 4xx → Make email.
- **Still needed in 3.0:** **Yes, rehome.** This is one of the few scenarios that already goes through the canonical QBO route — exactly the right pattern. `#financials` maps to `#finance`.
- **Recommended action:** **modify** — repoint destination to `#finance`.

#### `Weekly Shipping Cost Report` — `#4711844`
- **State:** isActive=true, isPaused=true
- **Trigger:** every 7 days
- **Source:** ShipStation API — `GET /shipments?createDateStart={{7d ago}}`
- **Destination:** `C0AKG9FSC2J` (#financials — legacy)
- **Purpose:** weekly shipping spend
- **Failure path:** GPT SKIP if no new data; ShipStation 4xx → Make email.
- **Still needed in 3.0:** **Yes, rehome.** Operational cost data that Rene needs — belongs in `#finance`.
- **Recommended action:** **modify** — repoint destination to `#finance`.

---

## Summary

**Keep + modify (rehome destination only)** — 11 scenarios:
- `#4711618` Gmail Smart Router → `#sales`
- `#4711620` Shopify Order Alerts → `#sales`
- `#4711621` Wholesale Lead Capture → `#sales`
- `#4711623` Customer Feedback Monitor → `#sales`
- `#4711826` B2B Reply Detector → `#sales`
- `#4711830` Shopify Refund Alert → `#sales`
- `#4711832` ShipStation Shipping Alerts → `#operations`
- `#4711836` Vendor Bill Tracking → `#finance`
- `#4711840` Inventory Level Alerts → `#operations`
- `#4711843` Weekly P&L Summary → `#finance`
- `#4711844` Weekly Shipping Cost Report → `#finance`

**Disable (keep blueprint, deactivate)** — 5 scenarios:
- `#4711622` Abandoned Cart Recovery (defer to Klaviyo)
- `#4711827` HubSpot Pipeline Monitor (defer to daily-brief `pipelineYesterday`; or rehome to `#sales` if Ben prefers per-stage pings)
- `#4711829` New Customer Welcome (defer to email automation)
- `#4711833` Shopify to QBO Sync (defer to Booke; current scenario lacks dedup key — duplicate-invoice risk)
- `#4711838` B2B Follow-Up Reminder (defer to Viktor's HubSpot `next_action_date` per Tuesday T1)
- `#4711839` Discount Code Tracker (no decision-loop owner)

**Delete** — 4 scenarios:
- `#4711828` Instantly Reply Detector (Instantly dropped — M2c)
- `#4712381` Instantly to HubSpot Lead Sync (Instantly dropped — M2c)
- `#4711837` Amazon FBA Velocity Alert (SP-API doesn't fit Make HTTP; never executed)
- `#4711841` Morning Ops Brief (direct conflict with `/api/ops/daily-brief`)
- `#4711842` Shopify Low Stock Alert (duplicates `#4711840`)

(Disable counts 6 above; Shopify Low Stock Alert moves to delete to break the dupe.)

---

## Conflicts with the 3.0 control plane

The scenarios below contradict canonical 3.0 contracts and must be addressed before any Make scenario is unpaused:

1. **`#4711841` Morning Ops Brief** competes with [`/api/ops/daily-brief`](../src/app/api/ops/daily-brief) for the same audience and same time-slot. Two morning briefs with different revenue numbers would create exactly the "competing blueprint" problem §15.6 forbids. → **delete before unpause.**
2. **`#4711842` Shopify Low Stock Alert** duplicates `#4711840 Inventory Level Alerts`. → **delete before unpause.**
3. **`#4711833` Shopify to QBO Sync** writes invoices to QBO without an idempotency key — risk of duplicate revenue entries that violate the financial-integrity rules in CLAUDE.md (#1, #6). → **disable before unpause; defer to Booke.**
4. **`#4711838` B2B Follow-Up Reminder** competes with HubSpot `next_action_date` (Tuesday T1) — two stale-deal nudgers will produce duplicate work in `#sales`. → **disable before unpause.**
5. **`#4711827` HubSpot Pipeline Monitor** posts to `#abra-control` (which is being archived) and would orphan on Monday morning. Even after retargeting, it duplicates the `pipelineYesterday` extension reserved in `make-webhooks.md` §4.4. → **disable, OR retarget to `#sales` and accept event-level pings.**

The 11 "keep + modify" scenarios above do **not** conflict with 3.0 once their destination channel IDs are repointed.

---

## Procedure for the Monday cutover (Ben)

After M5a (creating the 9 new channels), grab the new channel IDs from Slack and run, for each "keep + modify" row above:

```bash
# 1. Pull current blueprint
curl -sS -H "Authorization: Token $MAKE_API_TOKEN" \
  "https://us2.make.com/api/v2/scenarios/<id>/blueprint" > /tmp/<id>.json

# 2. Edit destination channel ID in the slack:CreateMessage module's mapper.channel
# 3. PATCH the scenario with the modified blueprint:
curl -sS -X PATCH -H "Authorization: Token $MAKE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg b "$(jq -c .response.blueprint /tmp/<id>.json)" '{blueprint: $b}')" \
  "https://us2.make.com/api/v2/scenarios/<id>?confirmed=true"
```

For "delete" rows: `DELETE /scenarios/<id>?confirmed=true`. For "disable" rows: `POST /scenarios/<id>/stop` (or leave `isActive=false` if already there).

Do **not** unpause any scenario until the Make.com Slack bot is invited to the new 3.0 channels (M5a) and `SLACK_BOT_TOKEN`/`SLACK_SIGNING_SECRET` are wired (Step 3 of `go-live-runbook.md`).
