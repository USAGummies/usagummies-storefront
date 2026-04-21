# Build Sequence — USA Gummies 3.0

**Status:** CANONICAL — 2026-04-20
**Companion:** [`activation-status.md`](activation-status.md) (live runtime inventory) · [`ops/blocked-items.md`](../ops/blocked-items.md) (human-action queue)
**Source of truth for sequencing:** [22.B — Execution Sequences](https://www.notion.so/3484c0c42c2e81048158f9007dddc093) (Notion, canonical). Child of the Codex Operating Addendum. This repo doc mirrors 22.B's forward-looking order for code-owned work.
**Session log:** [22.B.Log — Claude Code Build Log](https://www.notion.so/3484c0c42c2e812dbd62eb17b8c918c2) (Notion). Every Claude Code session appends one block mapped to 22.B rows; this is what catches drift between doctrine and code.

---

## What's already firing on all cylinders

| Layer | Status |
|---|---|
| Control plane (taxonomy v1.2, approvals, audit, stores, Slack surfaces) | **Live** |
| 9 Slack channels (topics pinned, Make bot a member where needed) | **Live** |
| Executive Brief — morning + EOD weekday to `#ops-daily` | **Live** (morning now includes Shipping Hub pre-flight; EOD now renders "today in review" with labels bought/voided + CF-09 queue transitions — 2026-04-20) |
| Platform Health (weekday 07:00 PT) | **Live** |
| Drift Audit Runner (Sunday 20:00 PT) | **Live** |
| Finance Exception Agent (weekday 06:15 PT → `#finance`) | **Live** — now drains CF-09 freight-comp queue + surfaces stale void refunds (2026-04-20) |
| Ops Agent (weekday 09:00 PT → `#operations`) | **Live** — now includes Shipping Hub pre-flight + reorder trigger (2026-04-20) |
| ShipStation wallet + void-refund watcher (weekday 09:00 PT → `#operations`) | **Live** — BUILDs #8 + #9 (2026-04-20) |
| Viktor W-7 Rene response capture | **Live** on Viktor's Slack presence |
| Shipping Hub + ShipStation label buying + tracking webhook | **Live** — with 9 drift-prevention BUILDs + ATP gate + delivered-pricing guard + freight-comp auto-queue + HubSpot deal-stage auto-advance (2026-04-20). Webhook registration parked per MFA. |
| `/ops/shipping` live preflight dashboard | **Live** (2026-04-20) — auto-refresh 30s, wallet/ATP/queue/voids cards + recent-labels table |
| CF-09 freight-comp queue manager (`/api/ops/fulfillment/freight-comp-queue`) | **Live** (2026-04-20) — GET list, POST approve+post-to-QBO, DELETE reject with audit trail |
| 174/174 vitest tests green | ✔ |
| 12 Vercel crons | ✔ (watch Hobby-plan ceiling) |

## Gaps blocking "every engine cranking" (build order)

### 1. ShipStation shipment-history cross-ref — ✅ **DONE**

Auto-clear the "paid — verify shipped" flag on wholesale invoices via `findShipmentsByOrderNumberPrefix`. Webhook path still parked on ShipStation MFA (B-13).

### 2. Shopify on-hand inventory integration — ✅ **DONE** (2026-04-20)

`getAllOnHandInventory` → Ops Agent writes `inventory:snapshot:v1` KV daily → `/api/ops/inventory/snapshot` GET/POST → buy-label route auto-decrements after each successful ship to keep the cache honest between daily refreshes. ATP gate in `src/lib/ops/atp-gate.ts` prevents over-promise (refuses buys with projected deficit > 24 bags, overridable).

### 3. Gmail vendor-thread freshness scraper — ✅ **DONE** (pre-existing, 2026-04-18)

`src/lib/ops/vendor-threads.ts` reads Gmail for Powers / Belmark / Inderbitzin / Albanese, computes `daysSince`. Ops Agent digest consumes.

### 4. Booke queue feed — ~2 days

Booke (third-party SaaS) exposes an API for its suggestion queue. Finance Exception Agent currently hardcodes `unavailable` for uncategorized count. Wire Booke → Open Brain → Finance Exception.

Unblocks: Finance Exception Agent "Uncategorized transactions" line; saves Rene ~1–2h/week.

### 5. Research Librarian + R-1..R-7 — ~1–2 weeks

Eight LLM specialist agents per `/contracts/agents/research-librarian.md` + `r1-consumer.md` through `r7-press.md`. Each is Class A write only (findings tagged `[R-1]` through `[R-7]` posted to `#research` + weekly Friday digest).

**Requires Ben decisions before build:**
- **Hosting:** Vercel cron vs `/loop` on laptop vs local daemon. Recommendation: Vercel cron (matches current pattern).
- **Research tooling:** Feedly Pro vs Muck Rack for press (R-7); SerpAPI vs Reddit API for consumer (R-1); Finbox vs SEC EDGAR for market data (R-2); USPTO TESS + SEC filings for competitive (R-3).
- **Budget cap:** proposed $15/agent/month ($120 total).

This is the biggest remaining build. Staged separately because the external-API choices need Ben's confirmation before code starts.

### 6. Compliance Specialist runtime — ~4 days (AFTER doctrine)

**Blocked on two Notion artifacts Ben + counsel must draft first:**
- `/Legal/Compliance Calendar` — vendor COI/W-9 dates, trademark renewals (USPTO §8/§9), FDA FFR biennial window, WY corporate filings, insurance renewals.
- `/Marketing/Approved Claims` — substantiated USA-made / dye-free / non-GMO / health claims, post counsel review.

Once those exist, the runtime is straightforward: daily calendar scan, gate `content.publish` / `ad.spend.launch` against Approved Claims, HubSpot tasks for renewals.

### 7. Faire Specialist runtime — ~3 days

Weekly Thursday reconciliation prep (Rene-facing), Direct-share tracking, Direct-invite batch proposals (each Class B).

**Requires Ben decisions before build:**
- Faire brand-portal API creds (or commit to portal-scraper approach).
- Bulk-import Faire retailer list into HubSpot wholesale-contact set (Canon §10.1 Lane B.5 — one-time manual).

## Callouts + parked blockers

| Item | Owner | Reason parked |
|---|---|---|
| **ShipStation v1 webhook registration** | Ben | Blocked on ShipStation MFA — I can't reliably automate the MFA code entry against ShipStation's React inputs. Ben enters the code once, I capture the new API key + secret from the "Generate API Key" modal, push to Vercel, then the `/api/ops/fulfillment/webhook-register` route registers the webhook in one `POST`. Parked pending ~2 min of Ben's time. |
| **Rene + Drew contract sign-off** | Ben (to sequence) | Per Ben 2026-04-20, Drew is intentionally off the blocked-items list. Rene still has R-1 / R-2 / R-3 open. Not a code blocker — the Finance Exception Agent digests post either way. |
| **6 secret rotations (B-3..B-8, B-12)** | Ben | P0 manual per governance §7. Shopify Admin token, AWS IAM, LWA refresh, Open Brain MCP, CRON_SECRET, CONTROL_PLANE_ADMIN_SECRET. Don't gate the build; gate the sign-off. |
| **Paperclip unload (B-2)** | Ben | Zombie launchd loop still firing. 3 `launchctl unload` commands. |
| **Vercel Hobby cron ceiling** | Ben | Hobby tier historically caps at 4 active crons. We currently have 6. If Vercel rejects the 5th/6th, drift-audit + EOD brief move to Make.com. Verify plan before Tuesday. |

## Latent divisions (do NOT activate without a trigger firing)

Per [`activation-triggers.md`](activation-triggers.md): marketing-brand, marketing-paid, trade-shows-field, outreach-partnerships-press, customer-experience, product-packaging-rd. Each has a measurable gate. Don't activate because it feels useful — activate when the metric fires.

## Phase 2 (after every engine is cranking)

- `/ops/agents` dashboard — consolidated run history per agent, graduation gauge (governance §4). **Pending.** (`/ops/shipping` live 2026-04-20 as the fulfillment-specific surface; agent run history is still TODO.)
- Agent Open-Brain write-back in every specialist (every specialist should capture observations tagged by division). **Pending.**
- HubSpot deal-stage automation for Sample-Requested → Sample-Shipped → Sample-Received — ✅ **DONE** (2026-04-20, `hubspotDealId` on buy-label → `advanceDealOnShipment` patches deal + attaches tracking note).
- Make.com scenario consolidation (21 scenarios; some overlap with the 3.0 runtime and should retire). **Pending** — audit needs Make.com API access.
- Unified daily digest (fold Finance Exception + Ops Agent into the Executive Brief rather than three separate posts). **Pending** — morning brief now includes preflight signals but retains separate Finance Exception + Ops digests. Consolidation deferred until signal overlap becomes a readability problem.
- Fulfillment drift-audit checks — sample weekly for delivered-pricing compliance + wallet-floor adherence + ATP gate hit rate + stale-void SLA. ✅ **DONE** (2026-04-20, commit `1063e9e` — `/api/ops/control-plane/fulfillment-drift-audit` weekly Mon 20:30 PT → `#ops-audit`).
- Sample Order Dispatch (S-08) runtime — event-driven Class-B proposal agent per `/contracts/agents/sample-order-dispatch.md`. 🟡 **MVP LIVE** (2026-04-20). Pure classifier + proposal composer + dispatch route (18/18 vitest green, posts to `#ops-approvals`, refusals to `#ops-alerts`). Webhook-adapter wiring for Shopify / Amazon / Faire / HubSpot is the follow-on.

## Version history

- **1.2 — 2026-04-20** — Reality refresh: gaps #1-#3 marked done; HubSpot auto-advance done; 15-commit push from 2026-04-20 night session recorded. Phase 2 list carries remaining "pending" items.
- **1.1 — 2026-04-20** — Stale deferrals corrected; #2 + #3 + HubSpot promoted to done.
- **1.0 — 2026-04-20** — First canonical publication. Derived from the 2026-04-20 blueprint gap analysis.
