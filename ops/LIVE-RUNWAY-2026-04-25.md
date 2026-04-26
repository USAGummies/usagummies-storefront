# Live Build Runway — USA Gummies 3.0

**Last refreshed:** 2026-04-25  
**Repo:** `/Users/ben/usagummies-storefront`  
**Latest verified baseline before this doc:** `ea0b639 feat(ops): Phase 4 Sales Command — Weekly Revenue KPI Scorecard`  
**Mode:** keep building, but do not edit the same code lane as another active agent.

This is the continuity document for Claude Code, Codex, or a human operator when one agent times out. It is intentionally operational: what is live, what is blocked, what to touch next, and what not to touch in parallel.

## Current Operating Rule

If Claude Code is actively working a lane, do not touch its files. Work on docs, env readiness, smoke tests, or a disjoint workflow only.

Current active lane at the time this runway was written:

- **Claude Code:** B2B revenue / KPI reader wiring.
- **Avoid while Claude owns it:** `src/lib/ops/revenue-kpi*`, `src/lib/ops/sales-command-center.ts`, `src/lib/ops/sales-command-readers.ts`, `/ops/sales`, `/api/ops/sales`, and daily-brief revenue/KPI sections.
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
- Wholesale inquiries are still explicitly `not_wired` in the Sales Command Center because there is no internal list API yet.
- B2B revenue is still a known gap unless Claude's current lane closes it.

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

- Wholesale inquiry internal list API.
- B2B revenue join into the KPI scorecard, unless Claude's current B2B revenue lane lands it.
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

### Lane A — Let Claude finish B2B revenue

Do not parallel-edit revenue files. After Claude finishes, verify:

- B2B channel no longer reports `not_wired` unless intentionally still blocked.
- Revenue KPI confidence/rationale remains honest.
- Morning brief still includes bounded KPI line.
- No QBO write path was added.
- Tests, typecheck, lint pass.

### Lane B — Wholesale inquiry internal list API

Goal: make wholesale inquiries visible in `/ops/sales` without fabricating data.

Safe scope:

- Store wholesale inquiry submissions in KV or existing durable store at `/api/leads`.
- Add read-only internal list endpoint.
- Wire Sales Command's wholesale inquiries source from `not_wired` to `wired`.
- No customer-facing stage changes.
- No HubSpot lifecycle/stage writes.

Acceptance:

- `/ops/sales` shows real inquiry count.
- Morning brief does not become noisy from wholesale context-only data.
- Tests prove `not_wired` never silently becomes `0`.

### Lane C — Upload/readiness unblock

Goal: make Drive upload + shipping artifacts green.

Operator work:

- Set Drive parent envs in Vercel.
- Verify `/ops/readiness`.
- Submit a tiny test upload through `/upload/ncs`.
- Confirm Slack notification and Drive file.

Potential code only if smoke fails:

- Fix Drive scope/env error handling.
- Do not weaken file limits, MIME gates, or public upload rate limits.

### Lane D — Receipt OCR/Rene queue

Goal: turn receipt capture from review-only into Rene-approved structured intake.

Boundary:

- OCR/extraction can prepare suggestions.
- QBO posting remains Rene-approved Class B/C.
- Do not auto-create bills or expenses.

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

Use this when the active B2B revenue lane finishes:

```text
You are working in /Users/ben/usagummies-storefront on main.

Before coding, run:
- git fetch origin main
- git status --short
- git log --oneline -5

Read:
- ops/LIVE-RUNWAY-2026-04-25.md
- contracts/workflow-blueprint.md S1.6
- src/lib/ops/sales-command-center.ts
- src/lib/ops/sales-command-readers.ts

Goal: pick the next non-conflicting green-to-green workflow. Do not touch pricing, cart, checkout, Shopify product logic, QBO writes, HubSpot lifecycle/stage writes, or any file currently modified by another agent.

Preferred next lane if B2B revenue is complete:
Build Wholesale inquiry internal list API so /ops/sales can replace wholesale-inquiries not_wired with a real read-only count.

Acceptance:
- Existing /api/leads behavior preserved.
- Wholesale submissions are durably queryable.
- New internal list endpoint is read-only and auth-gated.
- /ops/sales shows real count without making morning brief noisy.
- No HubSpot stage/lifecycle writes.
- Tests/typecheck/lint pass.
```
