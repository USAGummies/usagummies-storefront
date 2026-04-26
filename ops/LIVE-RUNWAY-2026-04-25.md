# Live Build Runway — USA Gummies 3.0

**Last refreshed:** 2026-04-25  
**Repo:** `/Users/ben/usagummies-storefront`  
**Latest verified baseline before this doc:** `260eab8 feat(ops): Phase 7 receipts — OCR extraction (prepare-for-review only)`

**Mode:** keep building, but do not edit the same code lane as another active agent.

This is the continuity document for Claude Code, Codex, or a human operator when one agent times out. It is intentionally operational: what is live, what is blocked, what to touch next, and what not to touch in parallel.

## Current Operating Rule

If Claude Code is actively working a lane, do not touch its files. Work on docs, env readiness, smoke tests, or a disjoint workflow only.

Current active lane at the time this runway was refreshed:

- **Claude Code:** receipt OCR extraction is complete at `260eab8`.
- **Next non-conflicting code lane:** Drive/readiness unblock if env smoke fails; otherwise receipt-to-Rene approval promotion.
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
- Receipts intake is review-first. Phase 7 attaches a *suggestion* envelope (`ocr_suggestion`) to each receipt via auth-gated `POST /api/ops/docs/receipt/ocr` — extraction is review-only; status stays `needs_review`; canonical fields are NOT auto-filled; no QBO write path was added. QBO posting remains a future Rene-gated lane. Phase 8 adds auth-gated `POST /api/ops/docs/receipt/promote-review` which produces a draft Rene approval *packet* (canonical + OCR side-by-side, eligibility rubric, taxonomy disclosure); receipt status + canonical fields preserved; idempotent. Phase 9 registers `receipt.review.promote` (Class B, Rene) in the canonical taxonomy and extends the route to ALSO open a Class B Rene approval when the packet's `eligibility.ok` is true. Phase 10 wires the closer: when Rene clicks approve/reject in Slack, the packet transitions to `rene-approved`/`rejected`. Closer mutates ONLY the packet's `status` field (canonical receipt fields and receipt's `needs_review`/`ready` status preserved). UI button on `/ops/finance/review` deferred to Phase 11.

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

### Lane B — Receipt-to-Rene approval promotion

Phases 7-12 done. Phase 12 adds the Slack-thread permalink + per-row
poll. The `/ops/finance/review` pill now flips to "Rene approved"
(green) or "Rene rejected" (amber, deliberate gap signal) within
30 seconds of Rene clicking in `#ops-approvals`, without a full
page refresh. The green pill carries an "Open thread →" link
straight to the Slack thread when the bot token is set; falls back
to a non-link pill when degraded.

Next sub-lane (Phase 13): aggregate dashboard at `/ops/finance/
review-packets` listing every packet with current status + approval
id + last polled at. Operator sees the full pipeline state instead
of one packet per row.

Boundary:

- OCR/extraction prepares suggestions. ✅ Done (Phase 7).
- Promotion creates a draft review packet. ✅ Done (Phase 8).
- Eligible packets open a Class B Rene approval. ✅ Done (Phase 9).
- Closer transitions packet on Slack decide. ✅ Done (Phase 10).
- UI button on /ops/finance/review. ✅ Done (Phase 11).
- Slack-thread permalink + per-row poll. ✅ Done (Phase 12).
- Aggregate review-packets dashboard — Phase 13.
- QBO posting remains a separate Rene-approved Class B/C action.
- Do not auto-create bills, expenses, vendors, or categories.
- Do not overwrite canonical receipt fields without explicit reviewer action.

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

Goal: build receipt-to-Rene approval promotion from existing OCR suggestions. This prepares a review packet only; do not post to QBO.

Build:
1. Audit Phase 7 receipt OCR suggestion shape and Finance Review UI.
2. Add a pure helper that turns a reviewed receipt + OCR suggestion into a Rene approval packet draft.
3. Add an auth-gated route to request receipt review approval when a receipt has sufficient reviewed/suggested fields.
4. Open a Slack/Class B approval only if the existing taxonomy has an appropriate slug; otherwise create a review queue item and document the missing slug.
5. No QBO writes, no auto-categorization, no vendor creation, no payment classification beyond suggestion/warning.
6. Tests for no-fabrication and no side effects.

Acceptance:
- Receipts still queue as `needs_review` until a human/reviewer action changes them.
- Approval packet clearly distinguishes canonical fields from OCR suggestions.
- No QBO write path added.
- No fabricated vendor/date/amount.
- Tests/typecheck/lint pass.
```
