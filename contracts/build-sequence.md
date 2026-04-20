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
| Executive Brief — morning + EOD weekday to `#ops-daily` | **Live** |
| Platform Health (weekday 07:00 PT) | **Live** |
| Drift Audit Runner (Sunday 20:00 PT) | **Live** |
| Finance Exception Agent (weekday 06:15 PT → `#finance`) | **Live** (real Plaid + QBO data) |
| Ops Agent (weekday 09:00 PT → `#operations`) | **Live** (real QBO POs) |
| Viktor W-7 Rene response capture | **Live** on Viktor's Slack presence |
| Shipping Hub + ShipStation label buying + tracking webhook | **Live** (webhook registration parked per MFA issue) |
| 174/174 vitest tests green | ✔ |
| 6 Vercel crons | ✔ |

## Gaps blocking "every engine cranking" (build order)

### 1. ShipStation shipment-history cross-ref — ~1 hour

Auto-clear the "paid — verify shipped" flag on wholesale invoices in the shipping hub once UPS scans a tracking number. Uses ShipStation's `/shipments` API (same v1 API our rate-quote already hits). Keyed by tracking number → matches against `fulfillment:stages` KV.

Unblocks: Finance Exception Agent "unavailable" rows + cleaner fulfillment queue.

### 2. Shopify on-hand inventory integration — ~3 days

Hourly Shopify Admin GraphQL poll (`inventoryLevels` by location) → memory store → Ops Agent low-threshold alert + Shipping Hub ATP gate. Ashford is the canonical location.

Unblocks: Ops Agent inventory-low alerts, Shipping Hub "over-promise" prevention.

### 3. Gmail vendor-thread freshness scraper — ~2 days

Read Gmail labels `@powers`, `@belmark`, `@inderbitzen`, etc. Get last-inbound-date per label. Write `ops:vendor:<name>:last-contact:<ISO>` to Open Brain. Ops Agent consumes.

Unblocks: "Thread freshness not wired" line in Ops Agent digest; auto-surface dormant vendor reps.

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

- `/ops/agents` dashboard — consolidated run history per agent, graduation gauge (governance §4)
- Agent Open-Brain write-back in every specialist (every specialist should capture observations tagged by division)
- HubSpot deal-stage automation for Sample-Requested → Sample-Shipped → Sample-Received
- Make.com scenario consolidation (21 scenarios; some overlap with the 3.0 runtime and should retire)
- Unified daily digest (fold Finance Exception + Ops Agent into the Executive Brief rather than three separate posts)

## Version history

- **1.0 — 2026-04-20** — First canonical publication. Derived from the 2026-04-20 blueprint gap analysis.
