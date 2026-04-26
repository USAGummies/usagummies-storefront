# Live Build Runway — USA Gummies 3.0

**Last refreshed:** 2026-04-25  
**Repo:** `/Users/ben/usagummies-storefront`  
**Latest verified baseline before this doc:** `4c66f70 feat(ops): Phase 6 Sales Command — wholesale inquiry archive + internal list API`

**Mode:** keep building, but do not edit the same code lane as another active agent.

This is the continuity document for Claude Code, Codex, or a human operator when one agent times out. It is intentionally operational: what is live, what is blocked, what to touch next, and what not to touch in parallel.

## Current Operating Rule

If Claude Code is actively working a lane, do not touch its files. Work on docs, env readiness, smoke tests, or a disjoint workflow only.

Current active lane at the time this runway was refreshed:

- **Claude Code:** wholesale inquiry archive + internal list API is complete at `4c66f70`.
- **Next non-conflicting code lane:** receipt OCR/Rene review queue.
- **Safe parallel work:** production envs, Notion handoff, blocker docs, smoke checklist, and operator runbooks.

## What Is Live

### Slack / Control Plane

- Slack approvals click handler closes approved actions through strict closers.
- Daily brief posts to `#ops-daily` and now includes Sales Command + aging + KPI slices.
- Audit/control-plane routes are live.
- Hard rules + model policy are live.

### Sales / Revenue

- `/ops/sales` is a read-only Sales Command Center.
- It aggregates Faire invites, follow-ups, pending approvals, AP packets, location drafts, aging/SLA, and a weekly revenue KPI.
- Wholesale inquiries are now `wired` (Phase 6, `4c66f70`): `/api/leads` mirrors submissions fail-soft into a durable KV archive; auth-gated `GET /api/ops/wholesale/inquiries` exposes the count; `/ops/sales` shows real `total` + `lastSubmittedAt`. Morning brief stays quiet (wholesale is context, not action).
- B2B revenue Phase 1 is wired from paid Shopify orders tagged `wholesale`; Shopify-DTC excludes the same tag to avoid double-count.

### Faire Direct

- `/ops/faire-direct` supports:
  - invite staging,
  - review/approve/reject,
  - initial invite request approval,
  - Slack approve → Gmail send,
  - HubSpot email association fallback by email,
  - follow-up queue,
  - follow-up request approval,
  - Slack approve → Gmail follow-up send.
- Faire API is not used for sends. Invites/follow-ups go through Gmail after approval.
- `FAIRE_ACCESS_TOKEN` still affects read-only Faire specialist/API reads, not Gmail-based Direct invite sending.

### Customer / Wholesale Surfaces

- `/wholesale` can redirect to `/wholesale/inquiry/<token>` when `WHOLESALE_INQUIRY_SECRET` is set.
- `/wholesale/inquiry/[token]` shows receipt/status/upload.
- `/account/login`, `/account/recover`, and `/account` expose Shopify customer account/session/order history.
- `/account` has safe single-bag reorder; it never reuses historical prices and does not title-match.
- `/where-to-buy` is public and reads only `src/data/retailers.ts`.

### Finance / AP / Docs

- `/ops/finance/review` is read-only and aggregates finance review queues.
- `/ops/ap-packets` has dashboard, template drafts, and AP packet send-on-approve.
- `/api/ops/upload` writes durable docs to Drive when Drive parent env is configured.
- Receipts intake is review-first; OCR/QBO posting remains a future Rene-gated lane.

### Fulfillment / Shipping

- Auto-ship label buying and Slack alerts are live.
- Shipping label artifacts are persisted to Drive only when a Drive parent env exists.
- If Slack misses a label upload, ShipStation remains the source of truth for reprint.

### Locations

- `/where-to-buy` is static/public.
- `/ops/locations` stages and reviews location drafts.
- Accepting a location draft does not publish it; public promotion still requires a PR changing `src/data/retailers.ts`.

## Active Blockers

### P0 Env / Admin

These are operator tasks, not code tasks:

1. `WHOLESALE_INQUIRY_SECRET`
   - Enables sticky wholesale inquiry receipt links.
   - Generate with `openssl rand -base64 48`.

2. `GOOGLE_DRIVE_UPLOAD_PARENT_ID`
   - Required for public NCS/vendor/receipt uploads.
   - Also acts as fallback for shipping artifacts.

3. `GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID`
   - Preferred Drive parent for label + packing-slip artifacts.
   - If absent but upload parent exists, shipping artifacts can fall back.

4. `FAIRE_ACCESS_TOKEN`
   - Required for read-only Faire API order/payout/specialist data.
   - Not required for Gmail-based Faire Direct invite/follow-up sends.

5. `BOOKE_API_TOKEN` or Zapier bridge
   - Required for Finance Exception uncategorized count.

6. Legal/compliance Notion databases
   - `/Legal/Compliance Calendar`
   - `/Marketing/Approved Claims`
   - Compliance specialist remains degraded until these exist and are shared with the integration.

7. ShipStation tracking webhook credentials/MFA
   - Required for tracking webhook registration and auto-clear.
   - Manual ShipStation MFA may still be required.

### Known `not_wired` Sources

- ~Wholesale inquiry internal list API.~ ✅ Wired in Phase 6.
- B2B revenue Phase 2 attribution through QBO Class/CustomField is deferred until Rene's chart/accounting reset stabilizes. Phase 1 Shopify `tag:wholesale` is live.
- Unknown revenue catch-all by design.
- R1-R7 research specialist runtimes.
- Klaviyo/social/trade-show pods.
- External vendor self-service portal.

## Smoke Checklist After Every Deploy

Open these in order:

1. `/ops/readiness`
2. `/ops/sales`
3. `/ops/faire-direct`
4. `/ops/finance/review`
5. `/ops/ap-packets`
6. `/ops/locations`
7. `/ops/shipping`
8. `/where-to-buy`
9. `/wholesale`
10. `/account/login`

Acceptance:

- Readiness clearly shows missing/fallback envs without secrets.
- Sales dashboard loads and does not fabricate zeros for not-wired sources.
- Faire Direct queues load; approved/sent/follow-up states are visible.
- Finance review page is read-only.
- AP packet page shows live packets/drafts.
- Location drafts never publish publicly without PR.
- Shipping artifacts column shows Drive/Slack links only when actually present.
- Public pages load without auth.

## Next Build Lanes

### Lane A — Upload/readiness unblock

Operator work:

- Set Drive parent envs in Vercel.
- Verify `/ops/readiness`.
- Submit a tiny test upload through `/upload/ncs`.
- Confirm Slack notification and Drive file.

Potential code only if smoke fails:

- Fix Drive scope/env error handling.
- Do not weaken file limits, MIME gates, or public upload rate limits.

### Lane B — Receipt OCR/Rene queue

Goal: turn receipt capture from review-only into Rene-approved structured intake.

Boundary:

- OCR/extraction can prepare suggestions.
- QBO posting remains Rene-approved Class B/C.
- Do not auto-create bills or expenses.

### Lane C — B2B revenue Phase 2 attribution

Goal: graduate B2B revenue from Shopify `tag:wholesale` Phase 1 to accounting-grade attribution only after Rene's accounting reset stabilizes.

Boundary:

- Do not use HubSpot Closed-Won as revenue.
- Do not use QBO invoices/sales receipts until Class or CustomField channel attribution exists.
- Do not double-count booth orders that create both QBO invoices and paid Shopify orders.

## Stop Rules

Stop and ask before changing:

- pricing, discounts, bundle math, cart behavior, checkout, Shopify product logic,
- QBO write semantics,
- HubSpot lifecycle/stage writes,
- inventory depletion or reorder logic,
- Slack approval taxonomy class downgrades,
- medical/supplement/health claims,
- public vendor self-service mutation paths.

## Next Prompt Template For Claude Code

Use this as the next Claude prompt:

```text
You are working in /Users/ben/usagummies-storefront on main.

Before coding, run:
- git fetch origin main
- git status --short
- git log --oneline -5

Read:
- ops/LIVE-RUNWAY-2026-04-25.md
- contracts/workflow-blueprint.md
- src/app/api/ops/docs/receipt/route.ts
- src/lib/ops/docs.ts
- src/app/ops/finance/review/FinanceReviewView.client.tsx

Goal: build receipt OCR extraction into the existing receipts review flow. This is a prepare-for-review lane only; do not post to QBO.

Build:
1. Audit existing receipt capture/listing helpers and finance review surface.
2. Add a pure OCR/extraction normalization helper that turns OCR text into a suggested receipt envelope: vendor, date, amount, currency, tax, last4/payment hint, confidence, and warnings.
3. Add a route that can attach OCR suggestions to an existing receipt record or accept OCR text for a receipt id. Keep it auth-gated.
4. Surface suggestions in /ops/finance/review as review-only fields.
5. No QBO writes, no auto-categorization, no vendor creation, no payment classification beyond suggestion/warning.
6. Tests for no-fabrication: missing amount/date/vendor stays null with warning, never guessed.

Acceptance:
- Receipts still queue as needs_review.
- OCR suggestions are visible to Rene/Ben as suggestions only.
- No QBO write path added.
- No fabricated vendor/date/amount.
- Tests/typecheck/lint pass.
```
