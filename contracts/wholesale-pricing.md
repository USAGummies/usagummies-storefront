# Wholesale Pricing — LOCKED

**Status:** CANONICAL
**Source:** Ben + Rene call recap 2026-04-27 §2 + §5 + §6 (v1.0); Rene + Viktor `#financials` thread 2026-04-28 batch-SKU session ratified by Ben (v2.0); Cindy/Redstone FOB-quote drift reconciliation 2026-04-28 PM ratified by Ben "option a" (v2.1); Rene's promo-bag CoA mapping doctrine 2026-04-28 PM (v2.2 first half); Ben's payment-methods + signature-title locks 2026-04-28 PM (v2.2 second half — §13 + §14); 3-vendor B0001 reconciliation 2026-04-30 PM, Ben approved Class C `pricing.change` to lock COGS at verified $1.79/bag (v2.3).
**Version:** 2.3 — 2026-04-30 PM
**Replaces:** any ad hoc pricing scattered across previous outreach scripts. This is the single source of truth.
**Pairs with:** [`/contracts/pricing-route-governance.md`](pricing-route-governance.md) — the route-economics + deal-check + escalation-clause governance layer that overlays this SKU/tier grid. For non-standard wholesale offers, landed delivery pricing, route-anchor vs route-fill logic, and Ben↔Rene partner communication, follow that doctrine.
**Reconciliation in flight:** [`/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md`](proposals/pricing-grid-v2.3-route-reconciliation.md) — six-class taxonomy proposal resolving the open reconciliations between v2.2 and the route-governance v1.0 numbers ($2.00 pickup floor, $3.00 landed route-anchor). Awaiting Ben + Rene Class C `pricing.change` ratification; on ratification, this contract graduates to v2.3.

## What changed in v2.0 (2026-04-28)

Rene + Viktor designed the operational naming + invoice-presentation layer in `#financials` on 2026-04-28; Ben ratified ("we want to build it completely, following rene's feedback"). The v1.0 `B1-B5` internal identifiers are preserved unchanged in code (audit envelopes + Mike's existing flow `wf_a54616e3-...` continue to resolve cleanly). The additions are:

1. **Fulfillment-type code layer (`LCD/MCL/MCBF/PL/PBF`)** — parallel to the B-tier internal ids, used at the customer-+ finance-facing surface (SKUs + invoice line copy). Mapping is fixed and bijective. See §9.
2. **Batch SKU pattern `UG-B[NNNN]-[YYMMDD]-[FT]`** — the shape of every QBO Products & Services entry going forward. Price is locked at SKU creation; price changes always = new batch SKU. See §10.
3. **Customer-facing invoice description rule** — descriptions are clean wholesale prose. NO tier code prefix in the description. The fulfillment-type code lives in the SKU column on the invoice. See §11.
4. **Show-deal freight handling + promo-bag treatment** — locked the canonical pattern for absorbed-freight ("show deal") sales + complimentary-bag sales. See §12.

---

## 1. Atomic inventory model (PERMANENT)

**Inventory is tracked at the SINGLE-BAG level. Period.**

- We do not maintain separate SKUs for case / master carton / pallet as inventory units. Those are commercial / packaging *abstractions* that convert to bag quantities at order time.
- A wholesale order line that says "1 master carton" decrements inventory by **36 bags** (per the canonical case-pack at `/CLAUDE.md` "Packaging spec").
- Existing setup should already reflect this. Some prior invoices (e.g. Glacier) used master-carton descriptions in line text — that's invoice copy, not the inventory model.

**Coding rule:** Claude Code MUST NOT create new "case" / "master carton" / "pallet" inventory SKUs. Order types are pricing/order abstractions; they decrement bag inventory.

### Operating COGS (LOCKED 2026-04-30 PM — Class C `pricing.change` ratified)

**$1.79 / bag** — final operating COGS for all margin / pricing / forecasting models.

| Layer | Source | Per-bag | Verification |
|---|---|---|---|
| Albanese gummies (raw) | Albanese Confectionary Group | $1.037 | BoA 7020 outflow 2026-03-17 = $55,244.50 / 53,280 bags = $1.037/bag |
| Belmark film (primary packaging) | Belmark, Inc | $0.131 | BoA 7020 outflow 2026-03-18 = $6,989.66 / 53,280 bags = $0.131/bag |
| Powers labor + cartons (assembly) | Powers Inc. | $0.376 | BoA 7020 outflow 2026-03-31 = $10,020.25 / 26,640 bags Run 1 = $0.376/bag |
| **Factory subtotal** | | **$1.544** | |
| Secondary packaging | Uline (master carton + inner cases + strip clips + S-hooks) | $0.25 | Per-master-carton Uline build below |
| **TOTAL operating COGS** | | **$1.794 → $1.79** | |

Per-master-carton Uline build: $2.68 (S-12605) + 6 × $0.61 (S-4315) + 6 × $0.32 (S-12559) + 6 × $0.10 (S-20269) = **$8.84 / 36 bags = ~$0.25 / bag**.

**Sources for the factory-side numbers:** QBO purchases query 2026-04-30 (vendors 32/33/34) cross-referenced against Gmail invoices (Albanese INV23-206741, Belmark Invoice #2084578 / PO# EM031626 / Quote Q1250326, Powers SO_0284052CM_20260409) and Greg Kroetch's pricing memo 2026-03-25 (Powers labor $0.35/bag + carton $0.85/case). See `#financials` thread `1777266794.573699` 2026-04-30 PM for the full reconciliation.

**Class C `pricing.change` history:**
- *2026-04-29 PM (v2.2 → originally locked at $1.77):* Ben locked the placeholder breakdown ($1.52 factory + $0.25 Uline). Factory $1.52 was an estimate — final invoices not yet reconciled.
- *2026-04-30 PM (v2.2 → v2.3):* Reconciled factory side against actual paid invoices. Verified $1.544 (vs $1.52 placeholder, $0.024 understated). Ben approved 2026-04-30 in `#financials` thread `1777266794.573699`. Awaiting Rene's :white_check_mark: ratification for full Class C audit trail completion. **Use $1.79/bag for all forward analysis.**

Any margin/pricing model that uses a different COGS number is a doctrine violation.

---

## 2. The five core pricing line items

There are exactly **5 wholesale pricing concepts**. Anything outside these is a deliberate special, not a default.

| Designator | Unit | Price | Freight | Where it's exposed |
|---|---|---|---|---|
| **B1** | Individual case (6 bags) | $3.49 / bag | Ben delivers locally | INTERNAL ONLY — manual PO + manual delivery. **NOT** in the online wholesale flow. |
| **B2** | Master carton (36 bags) | $3.49 / bag | LANDED — USA Gummies ships, freight built in | Online wholesale dashboard |
| **B3** | Master carton (36 bags) | $3.25 / bag | Buyer pays freight | Online wholesale dashboard |
| **B4** | Pallet | $3.25 / bag | LANDED — USA Gummies ships, freight built in | Online wholesale dashboard |
| **B5** | Pallet | $3.00 / bag | Buyer pays freight | Online wholesale dashboard |

The internal `B1`..`B5` designators (Rene's request, §5) are stable identifiers in code, audit logs, QBO line text, and Slack notifications. The customer-facing label can read "Master carton — landed", but the system identifies the line as `B2`.

### Pallet quantity convention

Pallets are an order-type abstraction; the bag count per pallet is set by our outbound shipping pallet build, **25 master cartons = 900 bags per pallet** (per `/contracts/outreach-pitch-spec.md` §5, locked 2026-04-23). When `B4` or `B5` is selected, the order line decrements `<pallet_count> × 900` bags.

**⚠️ DO NOT confuse with Uline inbound reorder spec.** `/CLAUDE.md` "Packaging spec" says "Uline reorder per run: 12 masters... for 432 bags" — that is the *inbound packaging-supply* pack-out (cartons + cases + clips + hooks ordered from Uline to support 432 bags of finished-goods production). It is NOT the outbound shipping pallet. The outbound 48×40 skid we build for LTL freight to a buyer holds 25 master cartons (Ti×Hi 6×4 + 1 cap = 25, ~530 lb gross packed, ~52 in tall). Conflating the two was the v1.0 → v2.0 drift; the reconciliation pass on 2026-04-28 PM corrects it (v2.1).

---

## 3. Freight / delivery quote logic

Three freight modes, deterministic:

| Mode | When | Logic |
|---|---|---|
| **Landed** (`B2`, `B4`) | Default for online master-carton + 1-2 pallet orders | Higher per-bag price; freight is built in. The order's `freight_quote` is `0` (already in bag price). |
| **Buyer pays freight** (`B3`, `B5`) | Buyer requests their own freight | Lower per-bag price; the order's `freight_quote = "buyer-paid"` and the customer arranges pickup or supplies their account. |
| **Free freight (USA Gummies absorbs)** | 3+ pallet orders | We pay the LTL. Buyer pays $3.00/bag flat across the order; no separate freight line on the customer-facing total. Internally, the carrier invoice posts to `Freight Out / Shipping & Delivery Expense` per §12 (Scenario 1). |
| **Founder-driven freight (LOCKED 2026-04-29 — our structural moat)** | Default for any landed-pricing order where Ben can drive the route | Ben pulls the load himself with the GMC 1500 Duramax + cargo trailer. At ~16 mpg loaded with diesel ~$3.95/gal, fuel-only cost beats LTL by 30-50% per pallet (e.g. WA → St. Louis: ~$321/pallet drive vs $475/pallet LTL). Multi-stop routing compounds the math via opportunistic sales calls + sample drops + additional pallet-level deliveries that amortize the trip cost. **Margin models for landed (Option 2 / B4) tier default to drive economics, not LTL.** LTL is the fallback when Ben can't make the trip. |
| **LTL fallback** | When founder drive is infeasible (timing, multi-coast, etc.) | Real broker bid via Freightos / FreightCenter / our preferred LTL carrier. Cited in customer invoices; never fabricated. |

**Hard rule (§3 of recap):** Free freight on sub-pallet quantities is RETIRED. Free freight only at 3+ pallet MOQ (75+ master cartons / 2,700+ bags). This is locked in `/contracts/outreach-pitch-spec.md` §4 (commit `4d3e2ed`) and re-confirmed by Ben on the Cindy/Redstone FOB thread 2026-04-28 PM.

---

## 4. Online vs internal exposure

| Path | What customers see |
|---|---|
| **Online wholesale onboarding flow** (`/wholesale` and the future onboarding portal) | `B2`, `B3`, `B4`, `B5` only. Minimum order = 1 master carton. Individual bags + individual sub-master-carton cases are NOT selectable. |
| **Internal / manual sales** (Ben walks into a store, Renny adds a local PO) | `B1` (local case at $3.49/bag, Ben delivers) is available via manual PO creation — not the online flow. |
| **Custom deals / acquisition specials** | Created manually. Examples: "$3.25 first-order acquisition special" (treated as customer acquisition cost; goal is recurring orders at standard pricing). The system supports manual special pricing per-customer but does NOT auto-generate specials. |

---

## 5. Designator rules (B1-B5 stability)

- **Designators are stable identifiers.** Once `B2` means "master carton landed at $3.49/bag", that mapping doesn't change without a deliberate doctrine update + version bump on this file.
- If pricing or freight mode changes for an existing tier, **rename the designator** (e.g. `B2` retired → `B6` introduced) rather than mutating `B2`'s meaning. Audit trails referencing `B2` must always resolve to the same pricing.
- New designators get the next available letter+number (`B6`, `B7`, …). Special / event pricing gets `S` prefix (`S1`, `S2`).
- Designators surface in: order line items, QBO invoice line text, Slack order notifications, HubSpot deal properties, the wholesale-account portal (when shipped).

---

## 6. Show specials / acquisition pricing (§6 of recap)

- **No recurring special pricing planned right now.**
- Show / event specials may happen ad hoc (e.g. "$3.25 starter for first order" in lieu of $3.49).
- Treated as **customer acquisition cost**. Goal: get into the account, then promote into B2-B5 standard pricing on the next order.
- Coding rule: Claude Code does NOT create random special pricing logic unless explicitly instructed. The system supports manually created special pricing/deals (per-customer overrides), but auto-discount / auto-promo is OFF by default.

---

## 7. Implementation status as of 2026-04-27

| Layer | State | Pointer |
|---|---|---|
| Atomic-bag inventory model | EXISTS — already canonical. Verify no rogue case-SKUs. | `src/lib/ops/inventory-snapshot.ts`, `src/lib/ops/shipping-packaging.ts` |
| Pricing tiers in code | NOT YET ENCODED as `B1-B5` designators. Today's prices are scattered across `/api/booth-order`, `/api/leads`, manual outreach, QBO templates. | Needs a new `src/lib/ops/wholesale-pricing.ts` module. |
| Online wholesale dashboard exposure | Existing `/wholesale` form captures intent → posts to HubSpot via Phase 1.b. Does NOT yet present the B2/B3/B4/B5 selector. | Needs onboarding flow rebuild — see [`/contracts/wholesale-onboarding-flow.md`](./wholesale-onboarding-flow.md) (DRAFT — interviewer pre-build pass pending). |
| QBO invoice line text using designators | Not yet wired. Today's invoices use product-level descriptions. | Wire when Rene's chart-of-accounts mapping is finalized (currently parking the receipt → bill loop too — see Viktor briefing §6). |

---

## 8. Where Viktor cites this from

When Rene asks Viktor "what's the wholesale price for X?", Viktor's answer must:
1. Cite `/contracts/wholesale-pricing.md` v1.0
2. Use the `B1-B5` designators
3. Never quote prices NOT in the table without a "this is a manual special pricing case" caveat
4. For 3+ pallet orders, surface "custom freight quote — Ben prices manually based on route" rather than guess

Per [`/contracts/viktor.md`](./viktor.md) §6 hard rule "every dollar figure needs a source citation."

---

---

## 9. Fulfillment-type code layer (added v2.0)

Rene's 2026-04-28 design with Viktor introduced a parallel naming layer for customer-+ finance-facing use. The B-tier ids stay as the stable internal identifier; the fulfillment-type code is the readable derived label that goes on SKUs, invoice columns, and any operator surface where readability beats audit-stability.

| B-tier (internal id) | Fulfillment-type code | Expanded |
|---|---|---|
| **B1** | **LCD** | Local Case, Delivered (Ben delivers locally) |
| **B2** | **MCL** | Master Carton, Landed |
| **B3** | **MCBF** | Master Carton, Buyer Freight |
| **B4** | **PL** | Pallet, Landed |
| **B5** | **PBF** | Pallet, Buyer Freight |

**Where each surfaces:**

| Layer | Use | Example |
|---|---|---|
| Code (`PricingTier` type, audit envelopes, KV records, tests) | B-tier | `tier: "B3"` |
| QBO Products & Services SKU field | Fulfillment-type code (via batch SKU) | `UG-B0001-260415-MCBF` |
| QBO invoice SKU column (printed customer copy) | Fulfillment-type code | `UG-B0001-260415-MCBF` |
| QBO invoice description column (printed customer copy) | NEITHER — clean wholesale prose only | "All American Gummy Bears — 7.5 oz, 36-Bag Master Carton, Buyer Freight" |
| Slack notifications, audit log lines, internal ops UI | B-tier (compact + stable) | `B3 — Master carton + buyer freight` |
| Customer-facing email body (wholesale-AP packet, etc.) | Description prose; no code | "15 master cartons (540 bags)" |

Helpers in `src/lib/wholesale/pricing-tiers.ts`:
- `tierToFulfillmentType(tier: PricingTier): FulfillmentType`
- `fulfillmentTypeToTier(ft: FulfillmentType): PricingTier`
- `isFulfillmentType(value: unknown): value is FulfillmentType`

---

## 10. Batch SKU pattern `UG-B[NNNN]-[YYMMDD]-[FT]` (added v2.0)

Every QBO Products & Services entry going forward uses the canonical batch-SKU naming scheme:

```
UG-B0001-260415-MCL
└┬┘ └─┬─┘ └──┬──┘ └─┬─┘
 │    │     │      └─ Fulfillment-type code (LCD / MCL / MCBF / PL / PBF)
 │    │     └──────── Pickup date YYMMDD (sorts chronologically)
 │    └────────────── Batch number, 4-digit zero-padded (B0001..B9999)
 └─────────────────── USA Gummies brand prefix (future-proofs multi-line catalog)
```

**Doctrinal rules:**

1. **Batch number scope:** B0001..B9999. If we ever cross 9999, the spec upgrades to 5-digit (`B[NNNNN]`); that's a doctrine bump, not a runtime patch.
2. **Pickup date:** the date the supplier (Powers etc.) released the batch to us. UTC; the canonical helper accepts a `Date` and emits YYMMDD.
3. **Price is locked to the SKU at QBO-item creation time.** Price changes always = new batch SKU. Existing SKU prices are never edited. This preserves the audit trail — every invoice forever resolves to the price that was in effect when its SKU was created.
4. **Same physical batch can spawn multiple SKUs** — one per fulfillment-type code. They share batch number + pickup date but differ on the FT segment. Inventory deduction (a future module) walks the FT-keyed SKUs to find the next-available batch matching the customer's order.

**Implementation:** `src/lib/wholesale/batch-skus.ts`

Public API:
- `formatBatchSku(parts): string` — pure; throws on invalid input
- `parseBatchSku(sku): ParsedBatchSku | null` — pure; never throws (returns null on malformed)
- `isBatchSku(sku): sku is string` — type guard
- `canonicalizeBatchSku(sku): string | null` — round-trips through parse+format

Locked by 39 unit tests. Format ↔ parse is identity for every fulfillment-type code.

**Future scope (not in this commit):** the batch *registry* — KV-backed list of `{ batchNumber, pickupDate, supplier, totalBags, unitCostUsd }` for FIFO selection + cost-of-goods rollups.

---

## 11. Invoice description rule (added v2.0)

Per Rene's 2026-04-28 lock in `#financials`: customer-facing invoice descriptions are **clean wholesale prose**. NO tier code or fulfillment-type code in the description. The code(s) live in the SKU column.

**Before (v1.0, retired):**
```
Description: B3 — Master carton (36 bags), buyer freight
```

**After (v2.0, locked):**
```
SKU:         UG-B0001-260415-MCBF
Description: All American Gummy Bears — 7.5 oz, 36-Bag Master Carton, Buyer Freight
```

The cleanup is enforced in `src/lib/wholesale/pricing-tiers.ts` `TIER_INVOICE_LABEL`:

| B-tier | Description (locked) |
|---|---|
| B1 (LCD) | All American Gummy Bears — 7.5 oz, 6-Bag Case, Local Delivery |
| B2 (MCL) | All American Gummy Bears — 7.5 oz, 36-Bag Master Carton, Freight Included |
| B3 (MCBF) | All American Gummy Bears — 7.5 oz, 36-Bag Master Carton, Buyer Freight |
| B4 (PL) | All American Gummy Bears — 7.5 oz, ~900-Bag Pallet, Freight Included |
| B5 (PBF) | All American Gummy Bears — 7.5 oz, ~900-Bag Pallet, Buyer Freight |

Locked by tests in `src/lib/wholesale/__tests__/pricing-tiers.test.ts` ("TIER_INVOICE_LABEL — Rene 2026-04-28 lock").

**QBO operator action (one-time):** enable the SKU column on the invoice template (Gear → Custom Form Styles → Edit invoice template → Columns → turn on SKU). Already done by Rene 2026-04-28 ("looks like sku is open - i updated").

**Existing QBO items needing description scrub:** Item 15 ("All American Gummy Bears - Trade Show") had `B3 — Master carton (36 bags), buyer freight` baked into the description. After v2.0 lands, the operator should edit Item 15 to use clean prose. (Mike's invoice 1539 was already created with the legacy description; new invoices going forward use v2.0 prose.)

---

## 12. Show-deal freight + promo-bag treatment (added v2.0)

Two scenarios came up while invoicing Mike (Thanksgiving Point), and Rene + Viktor locked the canonical handling for both.

### Scenario 1 — Show deal (we absorb freight)

Customer paid the standard MCBF / PBF rate; we cover their freight as a deal sweetener. Mike's case: 15 master cartons × $3.25/bag at MCBF, freight covered per Reunion 2026 show terms.

**Invoice presentation:**
- Customer line at standard MCBF / PBF rate, full bag quantity
- Optional courtesy memo line: *"Freight covered per Reunion 2026 show terms"* — visible on invoice but $0
- NO freight charge on the customer's total

**QBO posting:**
- Revenue line: standard MCBF / PBF income account (Trade Show - Retail acct 325 today; future Wholesale - Retail acct per Rene's ongoing CoA work)
- When we pay the carrier, the freight cost posts to a **`Freight Out / Shipping & Delivery Expense`** account (CoA addition in flight w/ Rene as of 2026-04-28). Operating expense, not COGS adjustment.

### Scenario 2 — Promo bags (we give product as part of the deal)

Customer paid for N bags at standard rate; we threw in M bonus bags at $0. Real product cost (COGS), customer pays $0 for the bonus units.

**Invoice presentation (recommended Option A):**
```
QTY    DESCRIPTION                                      RATE     AMOUNT
504    All American Gummy Bears — 36-Bag Master Carton  $3.25   $1,638.00
 36    Promotional Bags — per deal terms                 $0.00       $0.00
                                                       TOTAL   $1,638.00
```

Why Option A (not the QBO native discount line): customer sees what they got, QBO records $0 revenue on the bonus bags, COGS still hits when the bags ship. Clean audit trail without enabling QBO's discount-line feature.

**QBO posting:**
- Standard product line: standard MCBF / PBF income account
- $0 promotional line: same account (revenue $0)
- Optional CoA addition: **`Sales Promotions Expense`** to track the product-cost-given-away. Sub-tracking; not strictly required.

### Rene's Apr 28 framing

> "got a show deal - so in this we would have to pay for the freight - so when we buy the freight it would charge as an expense to freight line in coa and we would eat the cost - the question is how do we best show the discounts on the invoice and capture appropriately in qbo? this will also occur in future when we have to give certain amount of bags as part of the sale"

Both scenarios are fully addressed above. Locked.

---

## 13. Accepted payment methods (added v2.2 — 2026-04-28 PM)

**LOCKED by Ben 2026-04-28 PM ("we don't do checks"):**

USA Gummies accepts the following payment methods on wholesale invoices:

| Method | Status | Notes |
|---|---|---|
| **ACH** | ✅ ACCEPTED — preferred | Lowest cost-to-collect, fastest reconciliation. Default ask on every CIF-001. |
| **Wire** | ✅ ACCEPTED | Same-day funds; OK for time-sensitive deals or international (when applicable). |
| **Credit card** | ✅ ACCEPTED | Routed via Shopify B2B for online orders, or via QBO Payments invoice link. **3.5% processing surcharge** passes to buyer (already captured in onboarding-portal copy). |
| **Check** | ❌ **NOT ACCEPTED** | We do not deposit paper checks. If a buyer's AP system can ONLY pay by check, escalate to Ben for case-by-case override. |

**Coding rules (mandatory):**

- `paymentMethods` strings in code must read `"ACH, wire"` (or include "credit card" where applicable). The string `"check"` is **prohibited**. Locked in `src/lib/ops/ap-packets.ts` + `src/lib/ops/ap-packets/templates.ts` (2026-04-28 PM commit).
- `OnboardingPortal.tsx` payment-method selector exposes only `"ach"` + `"cc_via_invoice"` (the legacy `"check"` button was removed 2026-04-28 PM).
- Any new template / form / UI surface that includes payment-method selection MUST drop check.

**Customer-facing messaging:** if a buyer asks "do you take check?" — politely redirect to ACH or card, no explanation needed beyond "ACH is the easiest way to pay us." Do not enumerate "we do/don't accept X" in unsolicited copy; just don't list check as an option.

---

## 14. Brand signature standard (added v2.2 — 2026-04-28 PM)

**LOCKED by Ben 2026-04-28 PM:**

Ben Stutman's title across all customer-facing surfaces is `Founding Father`.

**LOCKED form (single canonical signature block):**

```
Ben Stutman
Founding Father, USA Gummies
ben@usagummies.com · (307) 209-4928
```

**Variants accepted (same intent, brevity adapts to context):**
- `Founding Father, USA Gummies` (most common — emails, invoices, packets)
- `Ben Stutman · Founding Father, USA Gummies · ben@usagummies.com · (307) 209-4928` (single-line, e.g. cold-outreach footer)

**PROHIBITED titles (never use):**
- `Founder & CEO` ❌
- `Founder and CEO` ❌
- `CEO` ❌
- `Owner` ❌
- `President` ❌
- Any title that emphasizes corporate hierarchy over founder craftsman tone

**Why:** USA Gummies' brand voice is American-made craftsman/founder over corporate executive. "Founding Father" lands as personal + intentional + American; "Founder & CEO" lands as MBA-templated.

**Where this applies:**
- Every outbound email from `ben@usagummies.com`
- Every PI / invoice / quote PDF generated by us
- Every customer-facing form (NCS-001, CIF-001, etc.) that includes Ben's signature line
- HubSpot user profile / Slack profile / LinkedIn (when Ben gets to those)
- Marketing copy / website / product packaging

**Coding rule:** Search for `Founder & CEO`, `Founder and CEO`, `CEO` in any string-templated outbound surface and replace with `Founding Father`. Locked in `contracts/outreach-pitch-spec.md` §10 (signature block) on 2026-04-28 PM.

---

## 13. Promo-bag + sample CoA mapping (added v2.2)

Rene 2026-04-28 PM directive (`#financials` thread `1777266794.573699`): promo bags inside a customer order are a **COGS event**, not overhead. They map under the existing `500030 Samples - COGS` parent — NOT under `660010 Promotion & Entertainment` (which is overhead/marketing-flavored, wrong bucket).

### CoA structure (created 2026-04-28 by Viktor; renamed per Rene's 2026-04-28 PM revision)

```
500030          Samples - COGS                       (parent — pre-existing)
500030.05       Samples - Promo/Outreach             (NEW — QBO id 332, was "Outreach")
500030.10       Samples - Order Promo                (NEW — QBO id 333, was "Order Promotion")
500080.30       FI - Samples (Freight In, samples)   (pre-existing parallel)
500090.30       FO - Samples (Freight Out, samples)  (pre-existing parallel)
```

### When to use each child

| Sub-account | Use when | Memo template |
|---|---|---|
| **500030.05 Samples - Promo/Outreach** | Bags given away with NO invoice attached: trade-show booth bags, sample mailers to prospects, COSQ-001 welcome bags, internal staff samples, marketing outreach product. | `Show/Event: <name> · Date: <YYYY-MM-DD>` (or `Recipient: <name>` for individual sample mailers) |
| **500030.10 Samples - Order Promo** | Free bags ON a paid customer invoice: Reunion-style "freight covered + bonus bags" specials, "buy 10 cartons, get 1 free" deals, any complimentary bags tied to a specific paid order. ALWAYS attached to a specific invoice + customer. | `Customer: <name> · Invoice: <#> · Deal: <deal-name>` |

### Doctrinal hard rules

1. **P&L impact is identical to single-bucket COGS** — both children roll up to parent `500030 Samples - COGS`. Gross Margin reporting unchanged. The split exists for *period-level visibility* only ("how much did we give away in pure outreach vs. tied-to-paid-orders this month?").

2. **Inventory atomic-bag rule unchanged** — every bag (paid, sample, or promo) decrements bag inventory by 1. The CoA split is downstream allocation only, post-deduction. `/contracts/wholesale-pricing.md` §1 holds.

3. **Memo discipline is non-optional.** Every line item routed to `500030.05` or `500030.10` carries its memo template. Without the memo, the line is unfindable at month-end review (the whole reason the split exists is post-hoc traceability).

4. **The decision tree at line-item time:**
   - Is there a paid customer invoice attached? → `500030.10 Samples - Order Promo`
   - No invoice (give-away to prospect, internal use, trade show table) → `500030.05 Samples - Promo/Outreach`
   - Customer paid for the bags → standard COGS path (`COGS - Wholesale` or `COGS - Trade Show` etc.) — *not* `500030`

5. **`660010 Promotion & Entertainment` is OVERHEAD** — used for marketing meals, sponsorships, business-development hospitality. Never for product give-aways. Future Claude Code agents that auto-classify expenses must respect this distinction.

### Example mappings (canonical)

| Scenario | Sub-account | Memo |
|---|---|---|
| Mike (Thanksgiving Point) hypothetical 36 bonus bags on Invoice 1539 | `500030.10` | `Customer: Thanksgiving Point · Invoice: 1539 · Deal: Reunion 2026 freight comp` |
| Trade show booth bags handed to walk-up prospects at Reunion 2026 | `500030.05` | `Show/Event: The Reunion 2026 · Date: 2026-04-14` |
| Welcome packet COSQ-001 sample bag mailed to a new prospect | `500030.05` | `Recipient: <name> · Source: COSQ-001 welcome packet` |
| Future "buy 10 master cartons get 1 free" promotion line on a paid invoice | `500030.10` | `Customer: <name> · Invoice: <#> · Deal: 10+1 promotion` |

### Operator action remaining

QBO API can create accounts but cannot set the account *number* or *parent* on creation (per the 2026-04-13 Trade Show CoA setup gotcha). Manual step in QBO Gear → Chart of Accounts → edit each:
- 500030.05 Samples - Promo/Outreach → set `Number: 500030.05`, `Parent: Samples - COGS`
- 500030.10 Samples - Order Promo → set `Number: 500030.10`, `Parent: Samples - COGS`

Rene + Viktor coordinating on this directly (Rene: *"i can set up qbo with you"*).

---

## 15. Invoice timing rule (added v2.3 — 2026-04-30 PM)

**Status:** CANONICAL · 2026-04-30
**Source:** Ben + Rene email thread "FW: USA Gummies wholesale onboarding (Invoice 1539) - Thanksgiving Point" 2026-04-30 PM. Rene flagged hedging language ("no sooner") in customer-facing copy; Ben confirmed CPG-norm timing.

### 15.1 The rule

**Invoice date = shipment date.** The invoice is created and sent on the day product physically leaves the USA Gummies origin (Ashford, WA warehouse for Ben-direct orders, Powers Confections for any direct ex-factory ship, or contracted carrier pickup site for LTL).

- **Not before shipment** — invoicing pre-shipment creates a receivable for goods we have not yet earned (GAAP ASC 606 revenue-recognition flag; auditor-flagged).
- **Not after delivery** — buyer's payment terms (Net 10 / Net 15 / Net 30) run *from the invoice date*. Late invoicing burns float we earned.
- **Same day as freight depart** — for founder-drive deliveries (Ben hand-delivers), "shipment" = the day Ben physically departs Ashford with the load, not the delivery date at the buyer's dock.

### 15.2 Founder-drive worked example (Mike / Thanksgiving Point Invoice 1539)

- Customer commit: hand-delivery May 11 (1-pallet at Thanksgiving Point Dino Museum south dock)
- Ben's Utah departure from Ashford: May 8 or May 9 (whichever day the load actually leaves)
- **Invoice 1539 dated + sent: May 8 or May 9** (= shipment date)
- Net 10 from invoice date: clock starts when goods leave dock, not when they arrive

### 15.3 Customer-facing language rule

Per Rene's 2026-04-30 lock: invoice-timing language in customer emails is **factual, no hedges**. The line is a date statement, not a negotiation.

**Before (retired — hedge phrasing):**
> "Invoice goes out the day freight does, no sooner."

**After (locked):**
> "Invoice will be dated and sent on the day freight leaves Ashford — [actual date]. Net 10 from invoice date per [Invoice #] terms."

**Why the change:** "no sooner" reads as defensive — answering a question the buyer didn't ask. Clean date-stating language matches the CPG B2B norm and removes the appearance of policy negotiation.

### 15.4 Operator + auditor cross-references

- **GAAP / ASC 606** — revenue recognition occurs at the point of shipment for FOB Origin / FOB Shipping Point terms (§3 freight modes for `landed` and `buyer-pays` default to origin-transfer). Invoice date matches the recognition event.
- **INCOTERMS** — title transfers at shipment for FOB Origin; invoice timing follows title transfer.
- **Net-term math** — Net 10 / Net 15 / Net 30 always run from invoice date. If invoice and shipment dates diverge, the audit trail breaks.
- **QBO automation hook** — when the wholesale onboarding flow (Phase 35.f) advances a deal to `Shipped`, the QBO invoice DRAFT auto-flips to SENT with the day's date. Class C `qbo.invoice.send` (Ben + Rene) per `/contracts/approval-taxonomy.md`.

### 15.5 Exceptions (require Class C signoff)

| Scenario | Treatment |
|---|---|
| **Prepaid / deposit-required deals** | Deposit invoice issued at PO acceptance is fine, but it's a *deposit* invoice, not the goods invoice. Goods invoice still fires at shipment. |
| **Multi-batch / staged-delivery deals** | Each batch shipment generates its own invoice on its own shipment date. No "lump invoice" for staged drops. |
| **Sample / promo bags (no charge)** | No invoice — these post to `500030.05 / 500030.10` per the §13 Promo-bag CoA mapping. |
| **Trade-show field sales (booth-day pickup)** | Invoice dated the booth day (= goods physically transfer at the booth = shipment-equivalent). |

---

## Version history

- **2.3 — 2026-04-30 PM** — Adds §15 *Invoice timing rule*. Rene flagged hedge language ("no sooner") in Ben's reply to Mike Hippler / Thanksgiving Point Invoice 1539 customer email. Ben confirmed CPG-norm timing: invoice date = shipment date (= day freight leaves Ashford), Net-term clock starts on that date, customer-facing copy is factual date-stating with no hedges. Source: Ben + Rene email thread "FW: USA Gummies wholesale onboarding (Invoice 1539) - Thanksgiving Point" 2026-04-30 PM. No code change in this version (doctrine + customer-language lock only); QBO automation hook lives in the Phase 35.f wholesale-onboarding flow already.
- **2.2 — 2026-04-28 PM** — Adds §13 *Promo-bag + sample CoA mapping*. Rene 2026-04-28 PM directive: promo bags inside customer orders = COGS event under `500030 Samples - COGS`, NOT overhead under `660010 Promotion & Entertainment`. Two new sub-accounts created in QBO by Viktor: `500030.05 Samples - Promo/Outreach` (id 332) for no-invoice give-aways + `500030.10 Samples - Order Promo` (id 333) for promo bags on paid invoices. Names finalized by Rene's 2026-04-28 PM revision (was "Outreach" / "Order Promotion"). Memo templates locked. Inventory atomic-bag rule unchanged — split is downstream allocation only. Source: Slack `#financials` thread `1777266794.573699` 2026-04-28 PM. Operator action: Rene + Viktor coordinate the QBO Gear → Chart of Accounts edit to set account numbers + parent linkage manually (API limitation).
- **2.1 — 2026-04-28 PM** — Reconciles outbound pallet quantity (12 MC / 432 bags ❌ → 25 MC / 900 bags ✅) against `/contracts/outreach-pitch-spec.md` §5 + the actual outbound shipping skid spec. The v1.0/v2.0 figure was wrong: it pulled "12 MC = 432 bags" from `/CLAUDE.md`'s Uline *inbound* reorder pack-out and applied it to the *outbound* wholesale pallet. Outbound 48×40 LTL skids hold 25 master cartons (Ti×Hi 6×4 + 1 cap, ~530 lb packed). Also re-frames §3 freight modes to surface the **3+ pallet free-freight tier** (canonical, matching outreach spec §6) instead of "custom quote" — Ben re-confirmed via the Cindy/Redstone FOB thread 2026-04-28 PM. Code-side mirror: `pricing-tiers.ts` BAGS_PER_UNIT B4/B5 = 900 + invoice labels updated. Re-baselined 4 test files. No customer-facing reissues needed (Cindy was always told 25 MC; Phase 35.f flow has no live customers through B4/B5 yet — only Rene's Snow Leopard test ID).
- **2.0 — 2026-04-28** — Adds fulfillment-type code layer (LCD/MCL/MCBF/PL/PBF), batch SKU pattern `UG-B[NNNN]-[YYMMDD]-[FT]`, customer-facing invoice description rule (no tier prefix in description, code lives in SKU column), and show-deal/promo-bag treatment. B-tier internal ids preserved unchanged for audit-trail continuity (Mike's flow `wf_a54616e3-...` resolves cleanly under both v1.0 and v2.0). Source: Rene + Viktor `#financials` thread 2026-04-28; ratified by Ben "we want to build it completely, following rene's feedback". Code-side mirror: `src/lib/wholesale/pricing-tiers.ts` (TIER_INVOICE_LABEL clean prose + FulfillmentType helpers + canonical unitNoun) + `src/lib/wholesale/batch-skus.ts` (new module).
- **1.0 — 2026-04-27** — First canonical publication. Locks the 5-line-item pricing model + B1-B5 designators + 3 freight modes + atomic-bag inventory invariant per Ben + Rene call recap §1, §2, §3, §5, §6. Replaces ad-hoc pricing scattered across previous outreach scripts.
