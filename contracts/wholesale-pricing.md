# Wholesale Pricing — LOCKED

**Status:** CANONICAL
**Source:** Ben + Rene call recap 2026-04-27 §2 + §5 + §6 (v1.0); Rene + Viktor `#financials` thread 2026-04-28 batch-SKU session ratified by Ben (v2.0).
**Version:** 2.0 — 2026-04-28
**Replaces:** any ad hoc pricing scattered across previous outreach scripts. This is the single source of truth.

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

Pallets are an order-type abstraction; the bag count per pallet is set by the warehouse pallet build (typically 12 master cartons = 432 bags per pallet, per `/CLAUDE.md` Uline reorder spec). When `B4` or `B5` is selected, the order line decrements `<pallet_count> × 432` bags.

---

## 3. Freight / delivery quote logic

Three freight modes, deterministic:

| Mode | When | Logic |
|---|---|---|
| **Landed** (`B2`, `B4`) | Default for online master-carton + 1-2 pallet orders | Higher per-bag price; freight is built in. The order's `freight_quote` is `0` (already in bag price). |
| **Buyer pays freight** (`B3`, `B5`) | Buyer requests their own freight | Lower per-bag price; the order's `freight_quote = "buyer-paid"` and the customer arranges pickup or supplies their account. |
| **Custom quote** | 3+ pallet orders, OR Ben personally delivers | Manual quote based on Ben's fuel + time + opportunistic route value. The order is captured but `freight_quote = "custom-pending"` until Ben provides a number. |

**Hard rule (§3 of recap):** Free freight on sub-pallet quantities is RETIRED. Free freight only at 3+ pallet MOQ. This is already locked in `/contracts/outreach-pitch-spec.md` §4 (commit `4d3e2ed`).

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
| B4 (PL) | All American Gummy Bears — 7.5 oz, ~432-Bag Pallet, Freight Included |
| B5 (PBF) | All American Gummy Bears — 7.5 oz, ~432-Bag Pallet, Buyer Freight |

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

## Version history

- **2.0 — 2026-04-28** — Adds fulfillment-type code layer (LCD/MCL/MCBF/PL/PBF), batch SKU pattern `UG-B[NNNN]-[YYMMDD]-[FT]`, customer-facing invoice description rule (no tier prefix in description, code lives in SKU column), and show-deal/promo-bag treatment. B-tier internal ids preserved unchanged for audit-trail continuity (Mike's flow `wf_a54616e3-...` resolves cleanly under both v1.0 and v2.0). Source: Rene + Viktor `#financials` thread 2026-04-28; ratified by Ben "we want to build it completely, following rene's feedback". Code-side mirror: `src/lib/wholesale/pricing-tiers.ts` (TIER_INVOICE_LABEL clean prose + FulfillmentType helpers + canonical unitNoun) + `src/lib/wholesale/batch-skus.ts` (new module).
- **1.0 — 2026-04-27** — First canonical publication. Locks the 5-line-item pricing model + B1-B5 designators + 3 freight modes + atomic-bag inventory invariant per Ben + Rene call recap §1, §2, §3, §5, §6. Replaces ad-hoc pricing scattered across previous outreach scripts.
