# Financial Mechanisms Blueprint — Build Registry

**Status:** CANONICAL · v1.0 — 2026-04-30 PM
**Owner:** Ben (CEO) · Rene (Finance Lead) · Claude Code (build + maintenance)
**Trigger:** Ben's 2026-04-30 PM directive: *"make sure all these additional financial mechanisms etc are either built into the system, or are in the blueprint in notion to be built into the system."*
**Purpose:** Single registry mapping every financial mechanism Ben + Rene have scoped over the 2026-04-27 → 2026-04-30 window to its current state — ✅ shipped (in code or in canonical contract), 🟡 doctrine-locked (contract written, code wire-up pending), 🔵 proposed (in flight, awaiting ratification), or 🔴 blueprint-only (Notion / future build).

**Pairs with:**
- USA GUMMIES 3.0 RESEARCH BLUEPRINT (Notion §14 + §15) — the canonical blueprint of record. Future-build items in this doc graduate into Notion blueprint sections.
- [`/contracts/governance.md`](governance.md) — system governance rules.
- [`/contracts/approval-taxonomy.md`](approval-taxonomy.md) — Class A/B/C/D action registry.

---

## 0. Convention

Every mechanism in this registry is tagged with:
- **Status:** ✅ shipped · 🟡 doctrine-locked, code pending · 🔵 proposed, awaiting ratification · 🔴 blueprint-only
- **Source / spec:** the canonical contract markdown that defines it
- **Code-side wire:** which file(s) implement it, or `(none yet)`
- **Phase:** the Phase number in our build sequence (Phase 35 = current, 36+ = upcoming)

When a mechanism graduates from one status to the next, update this doc + the version-history block at the bottom + Slack `#financials` if it's finance-impacting.

---

## 1. COGS / cost basis mechanisms

### 1.1 Operating COGS lock at $1.79/bag
- **Status:** ✅ shipped (2026-04-30 PM Class C `pricing.change`)
- **Source:** `/contracts/wholesale-pricing.md` §1
- **Code-side wire:** `src/lib/wholesale/pricing-tiers.ts` (margin floor calc), `scripts/quote.py` (CLI), `/contracts/proforma-channel-margins.md` (channel math)
- **Math:** Albanese $1.037 + Belmark $0.131 + Powers $0.376 + Uline $0.25 = $1.794 → $1.79 rounded
- **Verification:** BoA 7020 outflows cross-referenced against Gmail invoices (Albanese INV23-206741, Belmark Invoice #2084578, Powers SO_0284052CM_20260409) — `#financials` thread `1777266794.573699`

### 1.2 Per-channel margin breakout
- **Status:** ✅ shipped
- **Source:** `/contracts/proforma-channel-margins.md` v0.1
- **Code-side wire:** Reads from contract; `src/lib/ops/pro-forma.ts` v23 mirrors structure (needs $1.75→$1.79 COGS refresh — see 8.1)
- **Math:** 13 channels with per-bag economics, every cell sourced

### 1.3 Per-vendor margin ledger
- **Status:** ✅ shipped (v0.1 committed 2026-04-30 PM)
- **Source:** `/contracts/per-vendor-margin-ledger.md`
- **Code-side wire:** 🔴 Phase 36 (queued — see §6 below)

---

## 2. Pricing tier mechanisms

### 2.1 B1–B5 wholesale tier system
- **Status:** ✅ shipped (v1.0 2026-04-27)
- **Source:** `/contracts/wholesale-pricing.md` §2
- **Code-side wire:** `src/lib/wholesale/pricing-tiers.ts` (BAGS_PER_UNIT, TIER_INVOICE_LABEL, FulfillmentType helpers); `src/lib/wholesale/batch-skus.ts` (UG-B[NNNN]-[YYMMDD]-[FT] pattern)
- **Tests:** `src/lib/wholesale/__tests__/pricing-tiers.test.ts`

### 2.2 Atomic-bag inventory model (no case/MC/pallet SKUs)
- **Status:** ✅ shipped (v1.0 2026-04-27 — PERMANENT)
- **Source:** `/contracts/wholesale-pricing.md` §1
- **Code-side wire:** All wholesale endpoints decrement at the bag level
- **Hard rule:** Claude MUST NOT create new "case"/"master carton"/"pallet" inventory SKUs

### 2.3 Custom-quote formula (9-step deterministic pricing for non-standard quotes)
- **Status:** ✅ shipped (v1.0 2026-04-30 AM)
- **Source:** `/contracts/custom-quote-formula.md`
- **Code-side wire:** `scripts/quote.py` (CLI calculator)
- **Inputs:** 8 fields (volume_bags, format, freight_mode, payment_terms, branded_or_pl, bag_size_oz, delivery_window_days, multi_batch)

### 2.4 Q3 buyer-pays surcharge (+$0.25/bag) — B3 → $3.50, B5 → $3.25
- **Status:** 🔵 proposed (Rene 2026-04-30 AM, math validated, awaiting Ben Class C `pricing.change` sign-off)
- **Source:** Slack DM thread + `#financials` thread
- **Code-side wire:** Pending ratification → `wholesale-pricing.md` v2.4 + `pricing-tiers.ts` price-table update
- **Action:** Ben ratifies in `#financials` → `/contracts/wholesale-pricing.md` v2.4 lands within an hour

### 2.5 v2.3 pricing reconciliation grid (6-class taxonomy: Pickup / Distributor / Standard / Route-anchor / Route-fill / Strategic-credential)
- **Status:** 🔵 proposed (proposal doc shipped 2026-04-30 AM)
- **Source:** `/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md`
- **Code-side wire:** Pending ratification → `wholesale-pricing.md` v2.4 + `src/lib/wholesale/pricing-classes.ts` (new module)
- **Awaiting:** Ben + Rene Class C ratification in `#financials` thread

### 2.6 B6-ANCH route-anchor pricing class (3-pallet min, $3.00/bag landed)
- **Status:** 🔵 proposed (part of v2.3 grid above)
- **Source:** `/contracts/pricing-route-governance.md` (route-economics doctrine layer)
- **Code-side wire:** Pending ratification

### 2.7 Distributor pricing commitments (Inderbitzin / Glacier Opt B at $2.10 + sell-sheet $2.49)
- **Status:** ✅ shipped
- **Source:** `/contracts/distributor-pricing-commitments.md` v1.0
- **Code-side wire:** Looked up by `src/lib/ops/delivered-pricing-guard.ts` for the buy-label / freight-comp pipeline

---

## 3. Invoice + revenue-recognition mechanisms

### 3.1 Invoice timing rule — invoice date = shipment date (CPG norm)
- **Status:** ✅ shipped (v2.3 2026-04-30 PM)
- **Source:** `/contracts/wholesale-pricing.md` §15
- **Code-side wire:** Phase 35.f wholesale-onboarding flow auto-flips QBO invoice DRAFT → SENT on `Shipped` stage advance. Class C `qbo.invoice.send` (Ben + Rene).
- **Customer-facing copy rule:** Locked replacement language, no "no sooner" hedge phrasing.

### 3.2 Invoice description rule — clean wholesale prose (no tier code in description)
- **Status:** ✅ shipped (v2.0 2026-04-28)
- **Source:** `/contracts/wholesale-pricing.md` §11 (now §12 after §15 insertion)
- **Code-side wire:** `src/lib/wholesale/pricing-tiers.ts` `TIER_INVOICE_LABEL`. Locked by tests.

### 3.3 Show-deal freight + promo-bag treatment
- **Status:** ✅ shipped (v2.0 2026-04-28)
- **Source:** `/contracts/wholesale-pricing.md` §12 (Show-deal Scenario 1) + §13 (Promo-bag CoA mapping)
- **Code-side wire:** QBO posts to `Freight Out` (op exp, not COGS) + `500030.05` / `500030.10` Samples - COGS sub-accounts

### 3.4 Escalation language locked into every quote/invoice template
- **Status:** 🟡 doctrine-locked, code pending
- **Source:** Rene 2026-04-30 AM Q5 — *"this pricing is for this order only; all reorders are quoted with each purchase request"*
- **Action queued:** Phase 36.5 — bake the canonical escalation line into the booth-quote engine + invoice templates + AP packet templates. Currently surfaced ad-hoc per Rene's manual review.

### 3.5 Multi-batch escalation clause requirement
- **Status:** ✅ shipped (HARD BLOCK in `quote.py` if multi_batch=true and clause missing)
- **Source:** `/contracts/custom-quote-formula.md` §2 step 9
- **Code-side wire:** `scripts/quote.py`

---

## 4. Approval / governance mechanisms

### 4.1 Approval taxonomy (Class A/B/C/D)
- **Status:** ✅ shipped (v1.1 2026-04-18)
- **Source:** `/contracts/approval-taxonomy.md`
- **Code-side wire:** `src/lib/ops/approvals/*` + `#ops-approvals` Slack channel as the audit trail

### 4.2 Cold-outreach approval gate (`--approved-by` token required)
- **Status:** ✅ shipped (2026-04-30 AM after Spottswood incident)
- **Source:** `/contracts/governance.md`
- **Code-side wire:** `scripts/sales/send-and-log.py` (default-OFF), `scripts/outreach-validate.mjs` (BLOCKED phrase list)

### 4.3 "No off-grid pricing without Class C" visibility flag
- **Status:** 🟡 doctrine-locked, visibility surface pending
- **Source:** `/contracts/approval-taxonomy.md` Class C `pricing.change`
- **Action queued:** Phase 36.6 — surface in morning brief whenever a non-grid quote enters the system. Currently relies on operator vigilance + `quote.py` flagging.

### 4.4 Drew-doctrine guardrail (samples ≠ Drew's customer order)
- **Status:** ✅ shipped (Phase 29)
- **Source:** `/CLAUDE.md` Fulfillment Rules + `/contracts/integrations/shipstation.md` §1
- **Code-side wire:** `src/lib/ops/__tests__/drew-doctrine.test.ts`. Sample-origin updated 2026-04-30 PM to Ashford-only.

---

## 5. Ledger + reconciliation mechanisms

### 5.1 QBO Chart-of-Accounts mapping
- **Status:** 🟡 doctrine-locked, ongoing manual setup with Rene
- **Source:** `/contracts/wholesale-pricing.md` §13 (Samples - COGS) + §12 (Freight Out)
- **Code-side wire:** `/api/ops/qbo/*` API routes are wired; CoA-mapping table is Rene's ongoing build. Per CLAUDE.md memory, two new sub-accounts (`500030.05` + `500030.10`) created 2026-04-28 PM.

### 5.2 Wholesale onboarding flow (Phase 35.f — NCS-001 / CIF-001 / VND-001 forms)
- **Status:** ✅ shipped (Phase 35.f.3.c done 2026-04-28)
- **Source:** `/contracts/wholesale-onboarding-flow.md`
- **Code-side wire:** `src/lib/wholesale/onboarding-dispatch-prod.ts`

### 5.3 Booth-quote engine (sales-tour quote-from-phone)
- **Status:** ✅ shipped (initial)
- **Source:** `/contracts/sales-tour-field-workflow.md`
- **Code-side wire:** `/api/booth-order/freight-quote` + booth-order helpers
- **Pending:** Q3 surcharge + escalation language injection (Phase 36.5)

### 5.4 Voided-label refund watcher (BUILD #9)
- **Status:** ✅ shipped (2026-04-20)
- **Source:** `/contracts/integrations/shipstation.md` §12
- **Code-side wire:** `/api/ops/shipstation/voided-labels` + Finance Exception Agent daily 09:15 PT scan

### 5.5 ShipStation wallet auto-reload check (BUILD #8)
- **Status:** ✅ shipped (UPS floor lowered $150 → $100 on 2026-04-30 PM)
- **Source:** `/contracts/integrations/shipstation.md` §11
- **Code-side wire:** `src/app/api/ops/shipstation/wallet-check/route.ts`

### 5.6 Sample-shipment auto-push to Slack #shipping at buy-time
- **Status:** ✅ shipped (2026-04-30 PM)
- **Source:** `/contracts/integrations/shipstation.md` §3.5 (canonical sample spec) + §3.6 (automation flow)
- **Code-side wire:** `src/app/api/ops/fulfillment/buy-label/route.ts` (auto `uploadBufferToSlack` on success) + `src/app/api/ops/slack/upload-pdf/route.ts` (generic PDF→Slack)
- **Default ON** — opt out with `pushToSlack: false` in body

---

## 6. Per-vendor / per-customer mechanisms (Phase 36 — Rene's ask)

### 6.1 Per-vendor margin ledger doc
- **Status:** ✅ shipped (v0.1 2026-04-30 PM)
- **Source:** `/contracts/per-vendor-margin-ledger.md`

### 6.2 `src/lib/finance/per-vendor-margin.ts` — markdown→TS parser
- **Status:** ✅ shipped — Phase 36.1
- **Spec:** Read `/contracts/per-vendor-margin-ledger.md` into a typed struct. Unknown/TBD cells stay `null` or `needsActual=true`; no QBO/HubSpot/Shopify/Gmail/Slack runtime integration.
- **Code-side wire:** `src/lib/finance/per-vendor-margin.ts`; tests in `src/lib/finance/__tests__/per-vendor-margin.test.ts`.

### 6.3 `/api/ops/finance/vendor-margin?vendor=X` endpoint
- **Status:** ✅ shipped — Phase 36.2
- **Spec:** Return full parsed ledger JSON, or one committed vendor row via `?vendor=<slug-or-name>`. Auth-gated by `isAuthorized()` (session OR `CRON_SECRET`). Used by daily morning brief + HubSpot deal-card webhook later.
- **Code-side wire:** `src/app/api/ops/finance/vendor-margin/route.ts`; tests in `src/app/api/ops/finance/vendor-margin/__tests__/route.test.ts`.

### 6.4 Morning-brief vendor-margin alerts surface
- **Status:** ✅ shipped — Phase 36.3
- **Spec:** Surface top-3 vendors with margin alerts (below-floor / thin / needs actuals) from the canonical ledger. AR aging joins remain future work.
- **Code-side wire:** `BriefInput.vendorMargin`, `renderVendorMarginMarkdown`, and `/api/ops/daily-brief` direct parser read.

### 6.4b `/ops/finance/vendor-margin` operator surface
- **Status:** ✅ shipped — Phase 36.3b
- **Spec:** Auth-gated read-only UI over the same vendor-margin endpoint. Shows source/version, alert counts, committed vendors sorted by risk, channel rows, and pending vendors. Unknown/TBD cells stay visible as `TBD`; nothing is backfilled or inferred.
- **Code-side wire:** `src/app/ops/finance/vendor-margin/page.tsx`, `VendorMarginView.client.tsx`, and pure testable helpers in `src/app/ops/finance/vendor-margin/data.ts`.

### 6.5 HubSpot deal ↔ vendor-row two-way reconcile
- **Status:** ✅ shipped — Phase 36.4 — `252d443`
- **Spec:** When a deal stage advances to `Shipped`, post the GP/bag from the vendor row to the deal note.
- **Code-side wire:** `renderVendorMarginNoteLine()` in `src/lib/finance/per-vendor-margin.ts` (fuzzy slug + first-token vendor name match for parenthetical descriptors). Returns null on no match — no over-promising margin context we can't verify. Wired into HubSpot deal-stage-change webhook.
- **Open follow-on (Phase 36.4b):** vendor-row → open-deals patch path (price change in ledger → deal note refresh on every open deal in that vendor's funnel).

### 6.6 Escalation language template injection
- **Status:** ✅ shipped — Phase 36.5 — `748e53a` (kernel + AP-packet) + `7f49ca6` (wholesale AP-packet email + booth-order QBO invoice CustomerMemo)
- **Spec:** Bake Rene's canonical escalation line into the booth-quote engine + invoice templates + AP packet templates.
- **Code-side wire:**
  - `src/lib/finance/escalation-language.ts` — `STANDARD_ESCALATION_CLAUSE` (Rene's verbatim 2026-04-29 wording) + 8-variant `ESCALATION_CLAUSES` + `pickEscalationClause()` + `renderEscalationBlock()`. Single source of truth.
  - `src/lib/sales-tour/escalation-clause.ts` — refactored to delegate to canonical (no string drift).
  - `src/lib/ops/ap-packets/templates.ts` — Jungle Jim's AP-packet reply body embeds the canonical clause.
  - `src/lib/wholesale/wholesale-ap-email.ts` — first-customer wholesale AP-packet email body now carries the canonical clause.
  - `src/app/api/booth-order/route.ts` — every booth-order.invoice_me QBO invoice CustomerMemo now carries Net-10 + handoff + canonical escalation clause.
  - 24 tests in `src/lib/finance/__tests__/escalation-language.test.ts` + 55/55 escalation + wholesale-ap-email tests pin every variant + cross-surface drift guard + injection coverage.
- **Open follow-on:** per-vendor margin ledger row-create emits matching variant (Phase 36.5c) — incremental polish, low priority.

### 6.7 Off-grid pricing visibility flag in morning brief
- **Status:** ✅ shipped — Phase 36.6 — `5626af3` (kernel) + `bbffcc6` (full brief surface)
- **Spec:** Surface every non-grid quote in the morning brief stack-down section. Forces operator review even on Class A/B autonomous actions.
- **Code-side wire:**
  - `src/lib/finance/pricing-grid-classifier.ts` — `PRICING_GRID` + `classifyPricePerBag()` + `isFullyRatifiedPrice()` (32 tests).
  - `src/lib/finance/off-grid-quotes.ts` — `ON_GRID_BAG_PRICES_USD` (canonical v2.4 grid + distributor commits) + `detectOffGridQuotes()` + severity classification (below_floor / below_distributor_floor / between_grid_lines) + `buildOffGridQuotesBriefSlice()`.
  - `daily-brief.ts` — `BriefInput.offGridQuotes?` slot + `renderOffGridQuotesMarkdown()` (top 3 + "+N more in /ops/sales" footer).
  - Daily-brief route fetches recent quotes + classifies + surfaces off-grid in the morning stack-down section.
- **Open follow-on:** HubSpot deal property `pricing_grid_status` (on / off / proposed) for deal-card visibility — Phase 36.6c.
- **Note on duplication:** Two parallel implementations of the grid classifier ship today (`pricing-grid-classifier.ts` with structured `PRICING_GRID` + tier metadata, and `off-grid-quotes.ts` with flat `ON_GRID_BAG_PRICES_USD`). They were built in parallel sessions on the same lane; both pass tests. Future cleanup: consolidate to a single source-of-truth — likely have `off-grid-quotes.ts` import `PRICING_GRID` from `pricing-grid-classifier.ts`. Tracked as Phase 36.6d.

### 6.8 Channel-level gross-margin canonical model — Phase 36.7 — `3a3fc40`
- **Status:** ✅ shipped (was §8 #4 candidate — graduated)
- **Spec:** Single source of truth for per-bag gross margin by channel, sourced from `/contracts/proforma-channel-margins.md`. Replaces the legacy `UNIT_ECONOMICS` stale `gpPerUnit` values calibrated against $1.75 COGS.
- **Code-side wire:** `CHANNEL_GROSS_MARGINS` export in `src/lib/ops/pro-forma.ts` — 12 channels (Amazon FBA / FBM, Shopify DTC 1/5/10-pack, Faire Direct + Option B, Wholesale B2-B5, C-ANCH proposed). Each row carries revenue/fees/freight/COGS/GP/GP% + status (healthy/thin/negative/needs_actuals) + source citation. 18 tests in `src/lib/ops/__tests__/channel-gross-margins.test.ts` pin every channel against the source doc.

---

## 7. Cross-references + governance

This blueprint is itself governed by:
- `/contracts/governance.md` §1 — non-negotiables (sources cited, no fabrication, etc.)
- `/contracts/approval-taxonomy.md` — every mechanism here that touches money is at minimum Class B
- `/CLAUDE.md` — Financial Data Integrity (zero tolerance for fabrication)

When a 🔴 blueprint-only item starts development:
1. Update its row to 🟡 with the file path being built
2. When code merges + tests green: update to ✅ and link the contract doc
3. Slack ping `#financials` if it's a finance-affecting mechanism

When Notion blueprint syncs with this doc:
- Notion is the canonical blueprint OF RECORD (USA GUMMIES 3.0 RESEARCH BLUEPRINT §14 + §15)
- This file is the *operational* blueprint that the codebase reads
- Discrepancies = doctrine drift; the weekly drift audit catches them

---

## 8. Open items needing Ben + Rene decision

1. **Q3 buyer-pays surcharge ratification** — ✅ ratified 2026-04-30 PM. Doctrine: `wholesale-pricing.md` §2 v2.4 (B3 → $3.50, B5 → $3.25). Test fixtures + `pricing-tiers.ts` updated `3a3fc40`.
2. **v2.3 pricing reconciliation grid ratification** — Ben + Rene dual sign-off → graduate proposal to canon, pricing-classes.ts module. *Open.*
3. **Phase 36 build sequencing** — _read superseded by actual ship order:_ 36.1 → 36.2 → 36.3 → 36.7 → 36.6 → 36.5 (parser → endpoint → brief → channel-margin model → grid classifier → escalation language). 36.4 (HubSpot deal ↔ vendor reconcile) and the brief-side wire-ups for 36.5/36.6 remain open.
4. **v23 pro forma COGS refresh** — ✅ shipped via §6.8 — `cogsPerBag: 1.79` + new `CHANNEL_GROSS_MARGINS` model + 18 tests. `3a3fc40`.
5. **EIN + DUNS canonicalization** — flagged in `/contracts/company-vendor-packet.md` §1. Ben to surface for the portal-submission backlog. *Open.*

---

## Version history

- **v1.7b — 2026-04-30 PM (late)** — Phase 36.3b shipped: `/ops/finance/vendor-margin` operator surface over the existing read-only vendor-margin API. Adds tested view helpers for alert counts, risk sorting, and TBD-preserving formatting.
- **v1.7 — 2026-04-30 PM (late)** — *Phase 36 fully closed.* §6.5 (Phase 36.4) graduated 🔴 → ✅ via `252d443`. §6.6 (Phase 36.5) graduated 🟡 → ✅ via `7f49ca6` (wholesale AP-packet email + booth-order QBO invoice CustomerMemo injected). §6.7 (Phase 36.6) graduated 🟡 → ✅ via `bbffcc6` (full brief surface wired). Status tally: ✅ 28, 🟡 3 (§3.4 / §4.3 / §5.1 — all carry-overs from earlier doctrine, not Phase 36 work), 🔵 3, 🔴 0. **No 🔴 remain.** Phase 36.6d duplication cleanup (consolidate `pricing-grid-classifier.ts` + `off-grid-quotes.ts` to one source-of-truth) flagged as next-up polish.
- **v1.6 — 2026-04-30 PM** — Phase 36.5 (kernel + AP-packet) + Phase 36.6 (kernel) shipped — `748e53a` + `5626af3`. §6.6 + §6.7 graduated 🔴 → 🟡 (kernels in code, brief-side surfaces still pending). §8 #1 + #4 closed (Q3 surcharge ratified, v23 COGS refresh shipped).
- **v1.5 — 2026-04-30 PM** — Phase 36.7 shipped: `CHANNEL_GROSS_MARGINS` canonical per-bag margin model + 18 tests — `3a3fc40`. New §6.8 added.
- **v1.4 — 2026-04-30 PM** — Q3 buyer-pays surcharge ratified by Ben (B3 → $3.50, B5 → $3.25). `wholesale-pricing.md` graduated to v2.4. Test fixtures + `pricing-tiers.ts` realigned.
- **v1.3 — 2026-04-30 PM** — Phase 36.3 shipped: morning-brief vendor margin watch section.
- **v1.2 — 2026-04-30 PM** — Phase 36.2 shipped: auth-gated read-only vendor-margin JSON endpoint.
- **v1.1 — 2026-04-30 PM** — Phase 36.1 shipped: per-vendor margin ledger parser with no-fabrication tests.
- **v1.0 — 2026-04-30 PM** — Initial publication. Maps 30+ financial mechanisms to ✅ / 🟡 / 🔵 / 🔴 status. Phase 36 backlog of 6 code-side build targets (6.2–6.7). 5 open Ben + Rene decisions queued in §8.
