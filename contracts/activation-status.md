# Activation Status — USA Gummies 3.0

**Last updated:** 2026-04-21 (overnight — post 36-commit shipping + Amazon FBM + S-08 build arc)
**Source of truth:** this file (commit history shows activation events)
**Companion docs:** [`governance.md`](governance.md), [`activation-triggers.md`](activation-triggers.md), [`approval-taxonomy.md`](approval-taxonomy.md), [`build-sequence.md`](build-sequence.md)
**Canonical sequence (Notion):** [22.B — Execution Sequences](https://www.notion.so/3484c0c42c2e81048158f9007dddc093) — Tuesday cutover + Week-1 + Pipelines + Specialists
**Session-by-session build log (Notion):** [22.B.Log — Claude Code Build Log](https://www.notion.so/3484c0c42c2e812dbd62eb17b8c918c2) — one block per Claude Code session, mapped to 22.B rows

---

## Live agents + runtimes

| Agent | Contract | Runtime | Heartbeat | Audience |
|---|---|---|---|---|
| Executive Brief | [agents/executive-brief.md](agents/executive-brief.md) | [`/api/ops/daily-brief`](../src/app/api/ops/daily-brief/route.ts) | Weekday 08:00 PT morning + Tue-Sat 17:00 PT EOD | `#ops-daily` |
| Platform Health | — (control plane) | [`/api/ops/control-plane/health`](../src/app/api/ops/control-plane/health/route.ts) | Weekday 07:00 PT | `#ops-audit` |
| Drift Audit Runner | [agents/drift-audit-runner.md](agents/drift-audit-runner.md) | [`/api/ops/control-plane/drift-audit`](../src/app/api/ops/control-plane/drift-audit/route.ts) | Sunday 20:00 PT | `#ops-audit` |
| Viktor (Sales) | [viktor.md](viktor.md) | existing Slack runtime | `@viktor` mentions + W-7 Rene capture | `#sales`, `#finance` |
| Viktor W-7 Rene Capture | [agents/viktor-rene-capture.md](agents/viktor-rene-capture.md) | [`/api/ops/viktor/rene-capture`](../src/app/api/ops/viktor/rene-capture/route.ts) | Event (via Viktor's Slack loop) | `#finance` |
| Shipping Hub | (derived from [agents/sample-order-dispatch.md](agents/sample-order-dispatch.md)) | [`/ops/fulfillment`](../src/app/ops/fulfillment) + [`/api/ops/fulfillment`](../src/app/api/ops/fulfillment) | Always-on (session) | `/ops/fulfillment` UI |
| Finance Exception Agent | [agents/finance-exception.md](agents/finance-exception.md) | [`/api/ops/agents/finance-exception/run`](../src/app/api/ops/agents/finance-exception/run/route.ts) | Weekday 06:15 PT | `#finance` |
| Ops Agent (now with Shopify inventory + Gmail vendor-thread freshness) | [agents/ops.md](agents/ops.md) | [`/api/ops/agents/ops/run`](../src/app/api/ops/agents/ops/run/route.ts) | Weekday 09:00 PT | `#operations` |
| Compliance Specialist | [agents/compliance-specialist.md](agents/compliance-specialist.md) | [`/api/ops/agents/compliance/run`](../src/app/api/ops/agents/compliance/run/route.ts) | Weekday 11:00 PT | `#operations` (degraded → `#ops-audit` until `/Legal/Compliance Calendar` exists in Notion) |
| Faire Specialist | [agents/faire-specialist.md](agents/faire-specialist.md) | [`/api/ops/agents/faire/run`](../src/app/api/ops/agents/faire/run/route.ts) | Thursday 11:00 PT | `#finance` (reconcile prep) + `#sales` (Direct-share). Degraded until `FAIRE_ACCESS_TOKEN` is set. |
| Research Librarian | [agents/research-librarian.md](agents/research-librarian.md) | [`/api/ops/agents/research/run`](../src/app/api/ops/agents/research/run/route.ts) + [`/api/ops/research/note`](../src/app/api/ops/research/note/route.ts) | Friday 11:00 PT | `#research` — weekly synthesis of notes captured via the note POST endpoint. |
| Booke queue feed | [agents/booke.md](agents/booke.md) | [`/api/ops/booke/push`](../src/app/api/ops/booke/push/route.ts) | Event (Zapier / Make posts count) | Feeds Finance Exception Agent "Uncategorized" cell. |
| ShipStation Health (BUILDs #8 + #9) | [integrations/shipstation.md](integrations/shipstation.md) §11–§12 | [`/api/ops/shipstation/wallet-check`](../src/app/api/ops/shipstation/wallet-check/route.ts) | Weekday 09:00 PT | `#operations` (only when below floor or stale void) |
| Shipping Hub pre-flight | [`src/lib/ops/fulfillment-preflight.ts`](../src/lib/ops/fulfillment-preflight.ts) | [`/api/ops/fulfillment/preflight`](../src/app/api/ops/fulfillment/preflight/route.ts) + [`/ops/shipping`](../src/app/ops/shipping) UI | Polled every 30s (UI) + embedded in morning Exec Brief + Ops Agent digest | Browser dashboard + `#ops-daily` + `#operations` |
| Freight-comp queue manager (CF-09) | [distributor-pricing-commitments.md](distributor-pricing-commitments.md) §5 | [`/api/ops/fulfillment/freight-comp-queue`](../src/app/api/ops/fulfillment/freight-comp-queue/route.ts) | Event (writes on every buy-label for delivered-pricing customer; drained by Rene) | Finance Exception digest + direct HTTP approve |
| Inventory snapshot cache | [`src/lib/ops/inventory-snapshot.ts`](../src/lib/ops/inventory-snapshot.ts) | [`/api/ops/inventory/snapshot`](../src/app/api/ops/inventory/snapshot/route.ts) | Daily (Ops Agent side-effect) + on-demand POST + auto-decrement on buy-label | Feeds ATP gate + preflight |
| Sample/Order Dispatch (S-08) MVP — classifier + proposal composer + dispatch route | [agents/sample-order-dispatch.md](agents/sample-order-dispatch.md) + [`src/lib/ops/sample-order-dispatch.ts`](../src/lib/ops/sample-order-dispatch.ts) | [`/api/ops/agents/sample-dispatch/dispatch`](../src/app/api/ops/agents/sample-dispatch/dispatch/route.ts) | Event (POST from upstream webhook adapter or manual trigger) | Class B proposals to `#ops-approvals`; refusals to `#ops-alerts`. Webhook-adapter wiring for Shopify / Amazon / Faire / HubSpot is next. |
| Fulfillment drift-audit (BUILDs #2/#6/#9 compliance) | [`src/lib/ops/fulfillment-drift.ts`](../src/lib/ops/fulfillment-drift.ts) | [`/api/ops/control-plane/fulfillment-drift-audit`](../src/app/api/ops/control-plane/fulfillment-drift-audit/route.ts) | Monday 20:30 PT (weekly) | `#ops-audit` — only posts when findings exist |
| Fulfillment weekly summary | `GET /api/ops/fulfillment/summary` | [`/api/ops/fulfillment/summary`](../src/app/api/ops/fulfillment/summary/route.ts) | On-demand + consumed by drift audit | Labels / queue drain / wallets / stale voids / ATP rollup |
| Amazon FBM unshipped alerts | — | [`/api/ops/amazon/unshipped-fbm-alert`](../src/app/api/ops/amazon/unshipped-fbm-alert/route.ts) | Weekdays 09:00 / 13:00 / 16:00 PT | `#operations` — urgency-tagged FBM order queue |
| Amazon FBM dispatch bridge | — | [`/api/ops/amazon/dispatch`](../src/app/api/ops/amazon/dispatch/route.ts) | On-demand (Ben copies ship-to from Seller Central) | `#ops-approvals` — Class B shipment.create proposal |
| Packing Slip renderer | [`src/lib/ops/html-to-pdf.ts`](../src/lib/ops/html-to-pdf.ts) | [`/api/ops/fulfillment/packing-slip`](../src/app/api/ops/fulfillment/packing-slip/route.ts) | On-demand (GET for browser print, POST for agents) | Letter-size HTML packing slips in brand template |
| Inventory cover-day forecast (S-07 MVP) | [`src/lib/ops/inventory-forecast.ts`](../src/lib/ops/inventory-forecast.ts) | [`/api/ops/inventory/cover-days`](../src/app/api/ops/inventory/cover-days/route.ts) | On-demand | Fleet + per-SKU cover days, urgency buckets, reorder recommendations |
| Sample/Order Dispatch webhook — Shopify | — | [`/api/ops/webhooks/shopify/orders-paid`](../src/app/api/ops/webhooks/shopify/orders-paid/route.ts) | Event (Shopify `orders/paid` webhook, HMAC-verified) | `#ops-approvals` Class B proposal |
| Sample/Order Dispatch webhook — HubSpot | — | [`/api/ops/webhooks/hubspot/deal-stage-changed`](../src/app/api/ops/webhooks/hubspot/deal-stage-changed/route.ts) | Event (HubSpot `deal.propertyChange` webhook, signature-v3 verified) | `#ops-approvals` Class B proposal |
| Agent Status UI | — | [`/ops/agents/status`](../src/app/ops/agents/status/page.tsx) + [`/api/ops/agents/status`](../src/app/api/ops/agents/status/route.ts) | Polled every 60s (UI) | Per-agent green/yellow/red health cards, 12 agents tracked |
| Rene's Ledger UI | — | [`/ops/ledger`](../src/app/ops/ledger/page.tsx) | Polled every 60s (UI) | CF-09 freight-comp approve/reject + stale-void review |

## Contracts with runtime pending (phase 2)

| Contract | Scope | Owner | Runtime path (planned) |
|---|---|---|---|
| [agents/reconciliation-specialist.md](agents/reconciliation-specialist.md) | Thursday weekly reconcile prep | Rene | Subset of Finance Exception Agent — promote to standalone if scope grows |
| [agents/inventory-specialist.md](agents/inventory-specialist.md) | Per-SKU cover-day scan | Drew | Subset of Ops Agent (now that Shopify on-hand cross-ref is wired into Ops Agent directly) — promote to standalone if Drew needs a dedicated cover-day forecast surface. |
| [agents/r1-consumer.md](agents/r1-consumer.md) … [r7-press.md](agents/r7-press.md) | On-demand research per stream | Ben | 7 separate LLM-driven runtimes (Feedly Pro / Muck Rack / SerpAPI / USPTO TESS / SEC EDGAR / Finbox). Note-capture infra live via POST /api/ops/research/note; Librarian synthesis live. Individual LLM agents blocked on Ben's tool-stack decision. |
| [agents/platform-specialist.md](agents/platform-specialist.md) | Connector smoke + secret rotation | Ben | Extends the existing platform health cron |

## Latent divisions (do NOT activate without a trigger)

Per [`activation-triggers.md`](activation-triggers.md) the 5 latent divisions (marketing-brand, marketing-paid, trade-shows-field, outreach-partnerships-press, customer-experience, product-packaging-rd) each have a measurable activation trigger. Do not activate one "because it feels useful." §15.6 anti-pattern.

## Deferred integrations (flagged in runtimes)

These agents currently surface `unavailable` for their dependent data until these are wired:

- **Booke queue → Finance Exception Agent** — **code built** (see `src/lib/ops/booke-client.ts`); surfaces `unavailableReason: "BOOKE_API_TOKEN not configured"` until Ben/Rene provisions the env var OR the Zapier bridge writes `booke:uncategorized_count` to KV.
- **Gmail labeled vendor threads → Ops Agent** — **LIVE** (2026-04-20). `src/lib/ops/vendor-threads.ts` reads Gmail for Powers / Belmark / Inderbitzin / Albanese, computes `daysSince`, consumed in Ops Agent digest.
- **Shopify on-hand inventory → Ops Agent + snapshot cache** — **LIVE** (2026-04-20). Ops Agent daily `loadInventory()` writes `inventory:snapshot:v1` KV; readable via `GET /api/ops/inventory/snapshot`. Downstream consumers: Shipping Hub ATP gate (pending), ad-hoc status queries.
- **ShipStation shipment history → Fulfillment hub** — cross-ref live (`findShipmentsByOrderNumberPrefix`); webhook auto-clear parked on ShipStation MFA (B-13).
- **ShipStation wallet + void-refund watcher** — **LIVE** (2026-04-20). Daily `GET /api/ops/shipstation/wallet-check?post=true` at 09:00 PT → `#operations`. Paired BUILDs #8 + #9.
- **CF-09 freight-comp auto-queue → Finance Exception Agent** — **LIVE** (2026-04-20). Buy-label writes paired DEBIT 500050 / CREDIT 499010 drafts to `fulfillment:freight-comp-queue`; Finance Exception digest drains the queue + surfaces stale voids.
- **Delivered-pricing doctrine guard → QBO invoice POST** — **LIVE** (2026-04-20). Refuses freight lines on delivered-pricing customers unless Class C override attached.
- **Faire brand portal scraper** (Faire Specialist) — still parked on `FAIRE_ACCESS_TOKEN` or scraper decision.
- **COI + insurance store** (Compliance Specialist) — still blocked on `/Legal/Compliance Calendar` + `/Marketing/Approved Claims` Notion drafts (Ben + counsel).

The no-fabrication rule means every missing data point surfaces with an explicit reason. Wiring is a separate commit per integration.

## Runtime inventory

### Cron jobs ([vercel.json](../vercel.json))

| Path | Schedule UTC | Schedule PT |
|---|---|---|
| `/api/ops/control-plane/health` | `0 14 * * 1-5` | Weekday 07:00 |
| `/api/ops/agents/finance-exception/run?post=true` | `15 14 * * 1-5` | Weekday 06:15 PT — Wait, that's wrong — 14:15 UTC is 06:15 PT (PDT 07:15). Check DST. |
| `/api/ops/daily-brief?kind=morning&post=true` | `0 15 * * 1-5` | Weekday 08:00 PT (07:00 PST) |
| `/api/ops/shipstation/wallet-check?post=true` | `0 16 * * 1-5` | Weekday 09:00 PT (BUILD #8 + #9 — wallet floor + stale-void watcher) |
| `/api/ops/agents/ops/run?post=true` | `0 17 * * 1-5` | Weekday 10:00 PT (09:00 PST) |
| `/api/ops/agents/compliance/run?post=true` | `0 18 * * 1-5` | Weekday 11:00 PT |
| `/api/ops/agents/reconciliation/run?post=true` | `0 17 * * 4` | Thursday 10:00 PT |
| `/api/ops/agents/amazon-settlement/run?post=true` | `30 17 * * 4` | Thursday 10:30 PT |
| `/api/ops/agents/faire/run?post=true` | `0 18 * * 4` | Thursday 11:00 PT |
| `/api/ops/agents/research/run?post=true` | `0 18 * * 5` | Friday 11:00 PT |
| `/api/ops/daily-brief?kind=eod&post=true` | `0 0 * * 2-6` | Tue-Sat 17:00 PT |
| `/api/ops/control-plane/drift-audit` | `0 3 * * 1` | Monday 20:00 PT (Sunday evening PT wall-clock) |

(Cron times are UTC. PT mappings drift with DST. 12 crons total as of 2026-04-20 — watch Hobby-plan ceiling.)

### Middleware self-auth prefixes ([src/middleware.ts](../src/middleware.ts))

`/api/ops/scheduler/master`, `/api/ops/engine/`, `/api/ops/notify`, `/api/ops/slack/`, `/api/ops/control-plane/`, `/api/ops/daily-brief`, `/api/ops/abra/`, `/api/ops/department/`, `/api/ops/plaid/`, `/api/ops/gmail-callback`, `/api/ops/qbo/`, `/api/ops/amazon-ads/`, `/api/ops/puzzle/`, `/api/ops/sweeps/`, `/api/ops/workflows/`, `/api/ops/approvals`, `/api/ops/forge/`, `/api/ops/archive/`, `/api/ops/freight/`, `/api/ops/pulse/`, `/api/ops/ledger/`, `/api/ops/inventory/`, `/api/ops/orders/`, `/api/ops/docs/`, `/api/ops/pipeline/`, `/api/ops/amazon/`, `/api/ops/alerts/`, `/api/ops/claims/`, `/api/ops/fulfillment`, `/api/ops/viktor/`, `/api/ops/agents/`.

## Activation gate

Per [`agents/README.md`](agents/README.md) rule 5:

> Monday activation gate: Ben, Rene, or Drew (owner per division) must approve the corresponding contracts in `#ops-approvals` before the agent is turned on.

The 2 new agents (Finance Exception Agent, Ops Agent) are wired but require Rene's + Drew's acknowledgment before the cron is left running unsupervised. Smoke-test their output once (via POST with `post=false`) before the first live post.

## Open questions

1. **Vercel Hobby cron limit** — we currently have 6 cron entries. If the plan caps at 4, the drift-audit + one other cron move to Make.com (spec § blocked-items.md).
2. **Booke integration contract** — [agents/booke.md](agents/booke.md) defines Booke's write scope but the actual data feed from Booke into our control plane isn't wired. Finance Exception Agent shows `unavailable` for the Booke queue until this lands.
3. **R-1..R-7 research agent runtimes** — 7 separate LLM agents is a Phase 2 build; Research Librarian is their orchestrator. Scope: 1-2 weeks.
