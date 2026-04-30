# Custom Quote Formula

**Status:** CANONICAL — 2026-04-30
**Source:** Ben + Rene Buc-ee's strategy call 2026-04-30 AM (#financials thread `1777568200.027019`).
**Purpose:** A single deterministic formula for generating any custom wholesale quote (whale, distributor, private label, bulk PO). Replaces ad-hoc napkin math with a reproducible pipeline so Ben, Drew, Rene, Claude, and Viktor all generate the same number from the same inputs.
**Pairs with:** [`/contracts/wholesale-pricing.md`](wholesale-pricing.md) (B1-B5 tiers), [`/contracts/distributor-pricing-commitments.md`](distributor-pricing-commitments.md), [`/contracts/proforma-channel-margins.md`](proforma-channel-margins.md), [`/contracts/pricing-route-governance.md`](pricing-route-governance.md).

---

## 1. Inputs

Every custom quote takes these 8 inputs:

| Input | Type | Values | Notes |
|---|---|---|---|
| `volume_bags` | int | ≥1 | Total bag commitment for the PO |
| `format` | enum | `standard` / `loose_inner` / `loose_no_secondary` | Determines secondary-packaging deduction |
| `freight_mode` | enum | `landed` / `fob` / `free_3plus` | Maps to B-tiers + influences price floor |
| `payment_terms` | enum | `net30` / `net15` / `prepay` | Cash-flow adjustment |
| `branded_or_pl` | enum | `usa_gummies` / `private_label` | Different cost stack + margin model |
| `bag_size_oz` | float | 7.5 (default) / 3.5 (hypothetical) | Smaller bag = lower cost-per-bag, requires custom film tooling |
| `delivery_window_days` | int | typically 5–21 | In-stock vs production-required (escalations apply) |
| `multi_batch` | bool | true/false | Multi-batch deals carry escalation re-quote clause |

---

## 2. The formula (canonical)

### Step 1 — Compute COGS/bag for the requested format

Base COGS per `/contracts/wholesale-pricing.md` §1 = **$1.77/bag** (standard format).

| Format | COGS/bag | Secondary-packaging removed |
|---|---|---|
| `standard` | **$1.77** | none — full secondary packaging included (master carton + 6 inner cases + 6 strip clips + 6 S-hooks) |
| `loose_inner` | **$1.60** | inner cases + strip clips + S-hooks removed (loose into master carton); $0.17/bag savings |
| `loose_no_secondary` | **$1.52** | full secondary packaging removed (bags into buyer's bulk container); $0.25/bag savings — confirmed Ben 2026-04-30 |

🚩 **Caveat:** $1.52 = "PLACEHOLDER until final invoices arrive" per `/CLAUDE.md`. Once Powers + Belmark final invoices land and Rene reconciles, the placeholder gets replaced with the actual cost basis. Quotes generated against the placeholder carry that margin-of-error explicitly.

### Step 2 — Apply branded vs private-label cost layer

| `branded_or_pl` | Additional layer | Notes |
|---|---|---|
| `usa_gummies` | $0.00 | No additional cost — using existing USA Gummies film + UPC + artwork (Belmark already amortized) |
| `private_label` | + custom-film tooling amortization + custom UPC fee + custom artwork setup | 🚩 **NEEDS POWERS + BELMARK QUOTE** at the requested PO size. Tooling-amortization-per-bag = `(film_tooling_cost + UPC_fee + artwork_setup) / volume_bags`. Cannot quote until we have these from the vendors. |

### Step 3 — Apply bag-size adjustment

| `bag_size_oz` | COGS adjustment | Notes |
|---|---|---|
| 7.5 (canonical) | $0.00 | Baseline |
| 3.5 (hypothetical) | TBD: scales with content + film | 🚩 Currently unverified. New bag size = new SKU = new film + new UPC + Powers production change. Don't quote without a bag-size-change cost from Powers + Belmark. |

### Step 4 — Compute floor price/bag

```
price_floor = adjusted_COGS + min_margin_floor
```

Margin floor by `branded_or_pl`:

| `branded_or_pl` | min_margin_floor | Rationale |
|---|---|---|
| `usa_gummies` | **$0.33/bag** (≥18% GP) | Below 18% GP, the deal stops being viable as ongoing business — we're absorbing volatility for free. |
| `private_label` | **$0.25/bag** (≥13% GP at private-label scale) | PL is pure cash-flow, not brand — accept lower GP since we're effectively a contract manufacturer + co-packer at that point. Floor is harder. |

### Step 5 — Apply freight mode

| `freight_mode` | Freight charge added to per-bag price | Customer pays freight separately? |
|---|---|---|
| `landed` (B2 / B4) | + actual freight cost / volume_bags | No |
| `fob` (B3 / B5) | $0 added (freight deducted from price already) | Yes — buyer books their own LTL |
| `free_3plus` | $0 added; we eat freight | No — only at 3+ pallet (75+ MC / 2,700+ bags) MOQ |

Freight cost basis (per `/contracts/wholesale-pricing.md` §3):
- Founder-drive (Ben): ~$321/pallet for WA → St. Louis-equivalent 1,500-mile run (default for landed-pricing if Ben can drive)
- LTL fallback: ~$475/pallet for the same lane
- Multi-stop drives compound the math via opportunistic sales calls

### Step 6 — Apply payment-terms adjustment

| `payment_terms` | Per-bag adjustment | Cash-flow rationale |
|---|---|---|
| `net30` | $0.00 (default) | Standard B2B. We carry the receivable. |
| `net15` with 2% prepay discount | −$0.02 × adjusted_price (but only if buyer prepays at receipt) | Gets us cash 15 days earlier; 2% is the cash-flow vig. |
| `prepay` (full upfront) | −$0.05/bag | Fully de-risked; pure cash-flow inflow. Use for private-label deals where buyer prepays the full PO. |

### Step 7 — Compute opening price + wiggle room

Per Rene's 2026-04-30 directive: **always quote $0.10–$0.15/bag above floor** so we have negotiation room.

```
opening_price = price_floor + wiggle
where wiggle ∈ [$0.10, $0.15] depending on whale-class
```

Whale-class default wiggle:
- Tier-0 whale (Buc-ee's, KeHE, McLane, Eastern National, Xanterra): $0.15
- Standard whale (50+ stores, $1M+ ARR potential): $0.12
- Mid-tier multi-location (3-15 doors): $0.10

### Step 8 — Compute volume tier mapping

| Volume bags | Volume tier | Maps to |
|---|---|---|
| 36 | 1 master carton | B1 / B2 / B3 |
| 216 | 6 master cartons | sell-sheet 6-MC tier |
| 900 | 1 pallet | B4 / B5 |
| 2,700 | 3 pallets | `free_3plus` freight waiver eligible |
| 9,000+ | 10+ pallets | distributor / chain-launch tier — sell-sheet $2.49/bag delivered |
| 45,000+ | 50+ pallets | whale tier — multi-batch escalation clause kicks in |

### Step 9 — Multi-batch escalation clause

If `multi_batch == true`:
- First-batch price valid only for the first PO's bag count
- Second-batch and beyond carry an explicit re-quote clause: "Pricing applies to the initial PO; subsequent reorders are subject to re-quote based on current Powers / Albanese / Belmark cost basis at the time of the reorder."
- Reason: Powers will hit us with escalations between batches. Albanese has minimal volume break, so we can't lock 2026 pricing for 2027.
- If `multi_batch == true` AND no escalation clause is in the proposal → **HARD BLOCK, do not send**.

---

## 3. Output schema

Every quote produces this JSON-shaped output (whether human-formatted or machine-generated):

```json
{
  "inputs": { ...all 8 inputs verbatim... },
  "cogs_breakdown": {
    "manufacturing_belmark": 1.52,
    "secondary_packaging": 0.00 | 0.10 | 0.17 | 0.25,
    "private_label_layer": 0.00 | "<computed>",
    "bag_size_adjustment": 0.00 | "<computed>",
    "total_cogs_per_bag": "<computed>"
  },
  "pricing": {
    "floor_per_bag": "<computed>",
    "wiggle": 0.10 | 0.12 | 0.15,
    "opening_quote_per_bag": "<computed>",
    "freight_per_bag": 0.00 | "<computed>",
    "payment_terms_adjustment": 0.00 | -0.02_pct | -0.05_flat
  },
  "totals": {
    "volume_bags": "<input>",
    "extended_revenue": "<computed>",
    "extended_cogs": "<computed>",
    "extended_gp": "<computed>",
    "gp_pct": "<computed>"
  },
  "tier_classification": "B1" | "B2" | "B3" | "B4" | "B5" | "custom-loose-pack" | "custom-PL",
  "freight_eligibility": "free_3plus" | "buyer_pays" | "we_ship_landed",
  "escalation_clause_required": true | false,
  "flags": [
    "🚩 PLACEHOLDER COST BASIS — final invoices pending",
    "🚩 PRIVATE LABEL — Powers + Belmark custom-film quote required",
    "🚩 BELOW MIN_MARGIN_FLOOR — review with Rene before sending",
    "🚩 MULTI-BATCH WITHOUT ESCALATION CLAUSE — HARD BLOCK"
  ]
}
```

---

## 4. Integration with `/contracts/wholesale-pricing.md` B-tiers

The B1-B5 tiers in `/contracts/wholesale-pricing.md` are the **defaults**. The custom-quote formula above is for when a buyer asks for something that doesn't fit B1-B5 (e.g., loose-pack, private label, smaller bag, multi-batch with escalation).

If a quote outputs `tier_classification` == B1-B5, the customer-facing format is the standard pricing block from the existing sales sheet. If `tier_classification` == `custom-loose-pack` or `custom-PL`, it goes into a formal proposal letter (see Buc-ee's Part 4 template in #financials thread `1777568200.027019`).

---

## 5. Approval taxonomy

Per `/contracts/approval-taxonomy.md`:

| Quote type | Approval class | Approver |
|---|---|---|
| Standard B1-B5 | Class A — autonomous | Helper (`scripts/sales/send-and-log.py`) with `--approved-by` token |
| `custom-loose-pack` at GP ≥18% | Class B — Ben single-approve | Ben in chat or Slack reaction |
| `custom-loose-pack` at GP <18% | Class C — Ben + Rene both approve | Slack thread sign-off from both |
| `custom-PL` (any) | Class C — Ben + Rene both approve | Always Class C — private label needs both |
| Multi-batch deal | Class C — Ben + Rene both approve, escalation clause MUST be in proposal | Always |
| Below min_margin_floor for the type | **HARD BLOCK** — quote must be re-priced or explicitly waivered by Ben + Rene with documented reason | Cannot fire from helper |

---

## 6. The CLI calculator

`scripts/quote.py` — takes the 8 inputs as flags, outputs the full quote JSON + a customer-facing summary block. See that file for usage. The script reads canonical numbers from this contract + pricing/proforma docs at runtime so any update here propagates without code changes.

---

## Version history

- **1.0 — 2026-04-30 PM** — Initial canonical publication after Ben + Rene Buc-ee's strategy call. Locks the 8 inputs, the 9-step formula, the output schema, the B-tier integration, and the approval taxonomy. Documents the `$1.52 placeholder` flag explicitly.
