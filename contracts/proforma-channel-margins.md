# Per-Channel Gross Margin Framework — Pro Forma Input

**Status:** CANONICAL FRAMEWORK · v0.1 — 2026-04-30
**Owner:** Rene (proforma model owner) · Ben (pricing decisions) · Claude Code (framework drafting)
**Trigger:** Rene's 2026-04-30 5:46 AM CT request in `#financials`: *"create a simple sheet that shows: amazon Rev−COGS−Their Fees etc → Gross Margin. Do the same for each of our sectors — this will be used in proforma."*
**Companion to:** `src/lib/ops/pro-forma.ts` (Pro Forma v23 monthly targets) — this doc is the *unit-economics framework* that feeds those monthly projections.

---

## 0. Hard rules

1. **Every dollar figure cites a source** per `/CLAUDE.md` "Financial Data Integrity" + `/contracts/governance.md` §1 #2. Cells without a citation are flagged `[needs QBO actual]` / `[needs live channel pull]` rather than fabricated.
2. **COGS is $1.79/bag** (LOCKED 2026-04-29 PM per `/CLAUDE.md`). Powers manufacturing $1.52 + Uline secondary $0.25 = $1.79. *Note:* `src/lib/ops/pro-forma.ts:116` still has stale `cogsPerBag: 1.75` ("Albanese + Dutch Valley") — Ben to refresh in next pro-forma bump; this doc uses the locked $1.79.
3. **Channel fees are sourced from each channel's published rate card.** Linked inline.
4. **Shipping costs cite real auto-ship label data** (`#shipping` channel `#ops-audit` audit log) where available.

---

## 1. Per-channel gross margin — single-bag (7.5 oz) economics

The math format: `Revenue − Channel Fees − COGS − Shipping = Gross Margin per bag`. All numbers are PER UNIT (one 7.5 oz bag) unless flagged otherwise. Per-bag math is the input; the pro-forma multiplies by monthly unit volume.

### 1.1 Amazon FBA (Amazon ships from their warehouse)

| Line | Per bag | Notes / Source |
|---|---:|---|
| Gross revenue (sell price) | $5.99 | [source: Amazon listing — confirm with `mcp__shopify-store__get-shop` equivalent or seller-central screenshot] |
| Referral fee (8%, food category) | −$0.48 | [source: Amazon Seller Central food-category fee schedule] |
| FBA fulfillment fee (Small Standard) | −$3.06 | [source: Amazon FBA fee 2026 — confirm size class via `/api/ops/amazon/settlements?action=fees`] |
| Inbound shipping to FBA (blended per unit) | −$0.30 | [needs QBO actual — Uline+freight to Amazon receiving, divided by units shipped in] |
| Storage (allocated monthly per unit) | −$0.05 | [needs QBO actual — Amazon monthly storage / units on hand] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| **Gross margin per bag** | **≈ $0.33** | **≈ 5.5% GM** |

**Pro forma v23 had `fbaFees: 3.71` (combined ref + FBA) → `gpPerUnit: 0.53`.** This breakdown is more granular and uses the $1.79 COGS, so the GP/unit comes lower (~$0.33) — a more honest baseline.

### 1.2 Amazon FBM (we ship from our warehouse)

| Line | Per bag | Notes / Source |
|---|---:|---|
| Gross revenue (sell price) | $5.99 | [needs Amazon listing price for FBM offer — same SKU or distinct?] |
| Referral fee (8%) | −$0.48 | Same as FBA |
| FBA fulfillment fee | $0.00 | We fulfill, not Amazon |
| USPS Ground Advantage label (1-bag mailer) | −$6.74–$6.95 | [source: `#shipping` audit log 2026-04-26..29 actual labels] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| **Gross margin per bag** | **≈ −$2.95 to −$3.16** | **NEGATIVE — single-bag FBM at $5.99 LOSES money on shipping** |

**⚠ FLAG FOR BEN:** Amazon FBM single-bag orders at $5.99 retail with $6.74+ USPS labels are loss-making. Either (a) buyer-paid shipping is a separate Amazon line (not in the $5.99 — confirm in Seller Central), (b) the FBM offer is priced higher than $5.99, or (c) we should pause Amazon FBM single-bag offers. The recent live FBM orders in `#shipping` (Wonderland RV Park, Amy Catalano, Thomas Shimizu) need P&L verification. **Rene + Ben action item.**

### 1.3 Shopify DTC (single-bag)

| Line | Per bag | Notes / Source |
|---|---:|---|
| Gross revenue (sell price) | $5.99 | [source: `/contracts/outreach-pitch-spec.md` MSRP $5.99 single bag] |
| Shopify Payments fee (2.9% + $0.30) | −$0.47 | (2.9% × $5.99) + $0.30 = $0.47 [source: shopify.com/pricing] |
| USPS Ground Advantage label | −$6.74–$6.95 | [source: `#shipping` audit log Shopify FBM labels — Mike Prior 2026-04-29 = $6.95] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| **Gross margin per bag** | **≈ −$2.99 to −$3.20** | **NEGATIVE on free-shipping single-bag** |

**⚠ FLAG:** Same shipping-loss issue as Amazon FBM. Shopify DTC single-bag at $5.99 with free shipping is structurally unprofitable. Per `/contracts/outreach-pitch-spec.md` §6 we offer free shipping at 5+ bags (the pricing-ladder threshold). **Single-bag DTC needs either a higher price or a $5–7 shipping line on the cart.**

### 1.4 Shopify DTC (5-bag bundle — free-shipping threshold)

| Line | Per bundle (5 bags) | Notes / Source |
|---|---:|---|
| Gross revenue | $25.00 | [source: `/contracts/outreach-pitch-spec.md` 5-bag bundle entry] |
| Shopify Payments fee (2.9% + $0.30) | −$1.03 | (2.9% × $25.00) + $0.30 |
| USPS Ground Advantage label (5-bag box) | −$8.00–$10.00 | [needs `#shipping` audit log — pull a recent 5-bag DTC label] |
| Operating COGS (5 × $1.79) | −$8.85 | LOCKED 2026-04-29 |
| **Gross margin** | **≈ $5.12–$7.12** | **≈ $1.02–$1.42 per bag · ~20–28% GM** |

### 1.5 Shopify DTC (10-bag bundle)

| Line | Per bundle (10 bags) | Notes / Source |
|---|---:|---|
| Gross revenue | $50.00 | [source: 10-bag bundle entry] |
| Shopify Payments fee | −$1.75 | (2.9% × $50.00) + $0.30 |
| USPS Priority Mail label | −$10.00–$13.00 | [needs `#shipping` audit log — pull a recent 10-bag DTC label] |
| Operating COGS (10 × $1.79) | −$17.70 | LOCKED 2026-04-29 |
| **Gross margin** | **≈ $17.55–$20.55** | **≈ $1.76–$2.06 per bag · ~35–41% GM** |

### 1.6 Faire — Direct invite (commission-free path)

Faire Direct is the 0%-commission program for sellers who invite their own customers. We use this path; legacy 25%-commission Faire listings are not the canonical channel.

| Line | Per bag (delivered $2.49 sell sheet) | Notes / Source |
|---|---:|---|
| Gross revenue | $2.49 | [source: `/contracts/distributor-pricing-commitments.md` §1 sell-sheet] |
| Faire commission (Direct = 0%) | $0.00 | [source: faire.com/seller direct-invite program] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| Per-bag freight allocation (when delivered) | −$0.20–$0.40 | [source: `/contracts/sales-tour-field-workflow.md` regional table — 1-pallet drive cost ÷ 900 bags ≈ $0.07–$0.50 depending on state] |
| **Gross margin per bag** | **≈ $0.32–$0.52** | **≈ 13–21% GM** |

### 1.7 Faire — Option B distributor (Inderbitzin, Glacier)

| Line | Per bag (delivered $2.10) | Notes / Source |
|---|---:|---|
| Gross revenue | $2.10 | [source: `/contracts/distributor-pricing-commitments.md` §2 Option-B] |
| Faire commission | $0.00 | (Direct invite path) |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| Per-bag freight (delivered) | −$0.20–$0.40 | Same as 1.6 |
| **Gross margin per bag** | **≈ −$0.07 to $0.13** | **≈ −3% to 6% GM — *thin margin floor*** |

**⚠ FLAG:** Option B at $2.10 delivered is structurally near-break-even. Defensible as a strategic-credential play (Inderbitzin = WA distributor footprint; Glacier = MT exposure). Not scalable to non-credential accounts at this price.

### 1.8 Wholesale direct B2B — `B2` master carton landed

| Line | Per bag ($3.49 landed master carton, 36 bags) | Notes / Source |
|---|---:|---|
| Gross revenue | $3.49 | [source: `/contracts/wholesale-pricing.md` v2.2 §2 B2] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| Per-bag freight (master carton landed, drive economics) | −$0.10–$0.30 | [source: founder-drive economics from `/contracts/wholesale-pricing.md` §3] |
| **Gross margin per bag** | **≈ $1.42–$1.62** | **≈ 41–46% GM** |

### 1.9 Wholesale direct B2B — `B3` master carton buyer-pays

| Line | Per bag ($3.25 + buyer freight, 36 bags) | Notes / Source |
|---|---:|---|
| Gross revenue | $3.25 | [source: `wholesale-pricing.md` v2.2 §2 B3] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| Per-bag freight | $0.00 | Buyer pays, no P&L impact |
| **Gross margin per bag** | **≈ $1.48** | **≈ 46% GM** |

### 1.10 Wholesale direct B2B — `B4` pallet landed

| Line | Per bag ($3.25, 900 bags/pallet) | Notes / Source |
|---|---:|---|
| Gross revenue | $3.25 | [source: B4] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| Per-bag freight (pallet drive economics) | −$0.07–$0.50 | [source: `freight-corridor-table.ts` ÷ 900 — WA $25/pallet ÷ 900 = $0.03; AZ $445/pallet ÷ 900 = $0.49] |
| **Gross margin per bag** | **≈ $0.98–$1.41** | **≈ 30–43% GM (state-dependent)** |

### 1.11 Wholesale direct B2B — `B5` pallet buyer-pays

| Line | Per bag ($3.00, 900 bags) | Notes / Source |
|---|---:|---|
| Gross revenue | $3.00 | [source: B5] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| Per-bag freight | $0.00 | Buyer pays |
| **Gross margin per bag** | **≈ $1.23** | **≈ 41% GM** |

### 1.12 Wholesale direct B2B — `C-ANCH` route anchor (PROPOSED, awaits Class C)

| Line | Per bag ($3.00 landed, 3+ pallet MOQ) | Notes / Source |
|---|---:|---|
| Gross revenue | $3.00 | [source: `/contracts/pricing-route-governance.md` §1 — proposed C-ANCH; awaits Q2 ratification] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| Per-bag freight (3+ pallet, drive amortized) | −$0.05–$0.35 | Multi-pallet drive math: total drive cost spread over 2700+ bags |
| **Gross margin per bag** | **≈ $0.88–$1.18** | **≈ 29–39% GM (route-density dependent)** |

The route-anchor margin is structurally lower than B5 buyer-pays — but volume × density × strategic-anchor value (per `/contracts/pricing-route-governance.md` §3) is the offset.

### 1.13 Trade-show special (e.g. Reunion 2026)

| Line | Per bag (per show terms) | Notes / Source |
|---|---:|---|
| Gross revenue | varies | [source: `/contracts/distributor-pricing-commitments.md` §3 — Reunion 2026 was $3.25 + free freight at master carton MOQ; expired post-show] |
| Operating COGS | −$1.79 | LOCKED 2026-04-29 |
| Per-bag freight (we absorb full freight on master cartons during shows) | −$0.30–$0.60 | [source: master-carton freight ÷ 36 bags] |
| **Gross margin per bag** | **strictly per-show; flagged as one-off in `outreach-pitch-spec.md` §4 BLOCKED claims** | |

Trade-show specials are **one-off Class C deals**, not a recurring channel. Surfaced here for completeness; the proforma should treat them as discrete event-driven revenue not a baseline.

---

## 2. Channel revenue mix snapshot (for proforma)

For Rene's proforma, the per-bag GM above feeds into volume targets. Pro Forma v23 (`src/lib/ops/pro-forma.ts`) targets for end of year (Dec 2026):

| Channel | Dec 2026 units | Dec 2026 revenue | Dec 2026 GP (v23) | This doc's per-bag GM |
|---|---:|---:|---:|---:|
| Amazon FBA | 1,400 | $8,386 | $742 | $0.33 (vs v23 $0.53 — needs reconcile) |
| Wholesale | 6,400 | $22,336 | $11,136 | $1.42–$1.62 (matches v23 $1.74 ballpark) |
| Distributor | 15,000 | $37,500 | $6,250 | varies — see 1.6 + 1.7 |
| **Total** | **22,800** | **$68,222** | **$18,128** | **≈ 27% blended GM** |

**v23 reconciliation needed:**
1. Amazon GP/unit: v23 says $0.53, this framework says $0.33. Delta = $0.20/unit ≈ $280/month at Dec volume. Likely cause: v23 uses $1.75 COGS (stale) + $3.71 combined Amazon fees (possibly understates inbound shipping + storage). Rene to confirm which is the proforma input.
2. Shopify DTC channel **not in v23** — needs to be added if DTC volume scales.
3. Faire (commission-free direct) **not in v23** — adds when Faire token surfaces real payouts in the recon digest.

---

## 3. Open data pulls Rene needs (live citation paths)

When Rene populates the proforma, these are the live-data routes that supersede the placeholder cells:

| Data | Live source | Route / file |
|---|---|---|
| Amazon settlement fees per order | `GET /api/ops/amazon/settlements?action=fees&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` | Wired commit `14a0d61` per Viktor recap |
| Amazon FBA storage / FBA fulfillment cost actuals | `GET /api/ops/amazon/settlements?action=fees` (same endpoint surfaces FBA + storage breakouts) | Same |
| Shopify Payments payouts | `fetchRecentShopifyPayouts()` | `src/lib/finance/shopify-payments.ts` (wired 2026-04-29) |
| Shopify Admin order details (per-order shipping cost) | Admin GraphQL `orders(query: ...)` | `src/lib/shopify/customers-with-last-order.ts` for the admin auth pattern |
| Auto-ship label costs (per-order) | `#shipping` Slack post `Cost: $X.XX` line | Real labels live in audit log |
| QBO P&L per channel (Amazon `400015.05` / Shopify-Faire-B2B `400020.05` / DTC `400015.10` / Trade-show `400015.15`) | `GET /api/ops/qbo/query?type=pnl` | Wired |
| Faire payouts | Recon digest under CoA `400020.05` per CF-09 | Faire-direct routes wired 2026-04-29 |

---

## 4. v0.2 follow-ups for Rene

When you populate the proforma model from this framework:

1. **Refresh the Amazon FBA combined fee** — pull the last 90 days of `/api/ops/amazon/settlements?action=fees` and compute the actual per-unit referral + FBA + inbound + storage. Replace v23's `fbaFees: 3.71` with the live actual.
2. **Decide single-bag DTC + FBM economics** — flag §1.2 + §1.3. Either raise list price, add buyer-paid shipping, or pause single-bag offers. This is the biggest open margin question.
3. **Add Shopify DTC + Faire as proforma channels** — v23 doesn't break them out; given Mike Prior's order yesterday hit `Tag: Sample` (Shopify DTC) at $5.99, the channel is live.
4. **Confirm Option B distributor floor ($2.10) margin** — at near-break-even, the volume needs to clear to make the credential play worth it. Worth a once-a-quarter Rene+Ben review.
5. **Lock the C-ANCH (route-anchor) per-bag GM** once Q2 of pricing v2.3 ratifies — that opens the structural lever Phase D's reorder + brief work compounds against.

---

## 5. Cross-references

- `/CLAUDE.md` "Inventory & COGS Model" — $1.79/bag locked 2026-04-29
- `/contracts/wholesale-pricing.md` v2.2 — B-tier prices + freight modes
- `/contracts/distributor-pricing-commitments.md` v1.0 — Sell-sheet $2.49, Option-A $2.50, Option-B $2.10
- `/contracts/pricing-route-governance.md` v1.0 §3 — founder-drive freight economics
- `/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md` — C-ANCH (route anchor) proposed class
- `/contracts/sales-tour-field-workflow.md` §3 — `freight-corridor-table.ts` per-state per-pallet drive cost
- `src/lib/ops/pro-forma.ts` — Pro Forma v23 monthly volume + revenue + GP targets (needs $1.75 → $1.79 COGS refresh)
- `/contracts/outreach-pitch-spec.md` — MSRP $5.99 / $4.99 retail tiers; bundle pricing

---

## 6. Version history

- **0.1 — 2026-04-30** — First publication. Per-channel per-bag gross-margin framework for the proforma. Surfaces three flagged action items: (a) Amazon FBM single-bag negative margin, (b) Shopify DTC single-bag negative margin, (c) Pro Forma v23 needs $1.75→$1.79 COGS refresh + add Shopify DTC + Faire channels.
