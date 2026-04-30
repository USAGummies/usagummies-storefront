#!/usr/bin/env python3
"""
quote.py — Custom-quote calculator implementing /contracts/custom-quote-formula.md.

Usage examples:

  # Buc-ee's at 90 pallets, loose-pack-no-secondary, FOB freight, Net 30, branded
  python3 scripts/quote.py \\
    --volume-bags 81000 \\
    --format loose_no_secondary \\
    --freight fob \\
    --terms net30 \\
    --branded usa_gummies \\
    --bag-oz 7.5 \\
    --multi-batch \\
    --whale-tier 0

  # Quick standard B5 pallet check
  python3 scripts/quote.py --volume-bags 900 --format standard --freight fob \\
    --terms net30 --branded usa_gummies --whale-tier 2

  # Private label (will flag — needs Powers + Belmark quote)
  python3 scripts/quote.py --volume-bags 45000 --format loose_no_secondary \\
    --freight free_3plus --terms prepay --branded private_label --whale-tier 0

Output: JSON quote object + a human-readable summary block.

The numbers in this script come from canonical contracts:
  /contracts/wholesale-pricing.md §1 (COGS = $1.77 standard, $1.52/$1.60 reduced)
  /contracts/distributor-pricing-commitments.md §1-2 (sell-sheet + Option B floor)
  /contracts/proforma-channel-margins.md (margin-floor flags)
  /CLAUDE.md (PLACEHOLDER cost-basis caveat — surfaced as a flag in every output)

Approval taxonomy: see /contracts/custom-quote-formula.md §5.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, asdict, field
from typing import Optional

# ── Canonical numbers (from /contracts/) ─────────────────────────────────────
COGS_BY_FORMAT = {
    "standard":            1.77,  # full secondary packaging
    "loose_inner":         1.60,  # inner cases + clip + hook removed
    "loose_no_secondary":  1.52,  # full secondary packaging removed
}
SECONDARY_REMOVAL_BY_FORMAT = {
    "standard":            0.00,
    "loose_inner":         0.17,
    "loose_no_secondary":  0.25,
}
MIN_MARGIN_FLOOR = {
    "usa_gummies":   0.33,  # $/bag — ~18% GP at $1.77, ~22% at $1.52
    "private_label": 0.25,  # PL floor harder — pure cash-flow, lower margin OK
}
WHALE_WIGGLE = {
    0: 0.15,  # Tier-0 whale (Buc-ee's, KeHE, McLane)
    1: 0.12,  # Standard whale (50+ stores, $1M+ ARR)
    2: 0.10,  # Mid-tier (3-15 doors)
}
PAYMENT_TERMS_ADJ = {
    "net30":  0.00,
    "net15":  -0.02,  # multiplied by adjusted_price
    "prepay": -0.05,  # flat $/bag
}
FREE_FREIGHT_MIN_BAGS = 2700  # 3 pallets minimum

@dataclass
class QuoteInputs:
    volume_bags: int
    format: str
    freight_mode: str
    payment_terms: str
    branded_or_pl: str
    bag_size_oz: float = 7.5
    delivery_window_days: int = 14
    multi_batch: bool = False
    whale_tier: int = 1

@dataclass
class QuoteOutput:
    inputs: dict
    cogs_breakdown: dict
    pricing: dict
    totals: dict
    tier_classification: str
    freight_eligibility: str
    escalation_clause_required: bool
    flags: list = field(default_factory=list)
    customer_summary: str = ""


def classify_tier(volume_bags: int, format_: str, branded: str) -> str:
    if branded == "private_label":
        return "custom-PL"
    if format_ != "standard":
        return "custom-loose-pack"
    if volume_bags >= 2700:
        return "B5" if volume_bags >= 9000 else "B4"
    if volume_bags >= 900:
        return "B4"
    if volume_bags >= 36:
        return "B2"
    return "B1"


def compute_quote(i: QuoteInputs) -> QuoteOutput:
    flags = []

    # ── Step 1 — base COGS for format ────
    base_cogs = COGS_BY_FORMAT[i.format]
    secondary_removed = SECONDARY_REMOVAL_BY_FORMAT[i.format]

    # ── Step 2 — branded vs PL layer ────
    pl_layer = 0.00
    if i.branded_or_pl == "private_label":
        flags.append("🚩 PRIVATE LABEL — Powers + Belmark custom-film tooling quote required. PL layer NOT computed in this run; quoted price excludes tooling amortization. Get fresh quote before sending.")
        # Placeholder — would be (film_tooling + UPC + artwork) / volume_bags

    # ── Step 3 — bag-size adjustment ────
    bag_size_adj = 0.00
    if i.bag_size_oz != 7.5:
        flags.append(f"🚩 BAG SIZE {i.bag_size_oz} oz — non-canonical SKU. Powers + Belmark new-SKU cost adjustment NOT computed. Quote at your own risk until verified.")

    total_cogs = base_cogs + pl_layer + bag_size_adj

    # ── Step 4 — floor ────
    margin_floor = MIN_MARGIN_FLOOR[i.branded_or_pl]
    floor_per_bag = total_cogs + margin_floor

    # ── Step 5 — freight mode ────
    freight_per_bag = 0.00
    freight_eligibility = ""
    if i.freight_mode == "landed":
        # Approximate founder-drive freight cost: ~$321/pallet on a 1,500-mile lane
        # / 900 bags per pallet = $0.36/bag
        freight_per_bag = 0.36
        freight_eligibility = "we_ship_landed"
    elif i.freight_mode == "fob":
        freight_per_bag = 0.00
        freight_eligibility = "buyer_pays"
    elif i.freight_mode == "free_3plus":
        if i.volume_bags < FREE_FREIGHT_MIN_BAGS:
            flags.append(f"🚩 FREE FREIGHT REQUESTED but volume ({i.volume_bags} bags) < 3-pallet minimum ({FREE_FREIGHT_MIN_BAGS} bags). Reject or upgrade volume.")
        freight_per_bag = 0.00
        freight_eligibility = "free_3plus"
    else:
        flags.append(f"🚩 UNKNOWN FREIGHT MODE: {i.freight_mode}")
        freight_eligibility = "unknown"

    # ── Step 6 — payment terms ────
    terms_adj = 0.00
    pre_terms_price = floor_per_bag + freight_per_bag
    if i.payment_terms == "net15":
        terms_adj = round(-0.02 * pre_terms_price, 4)
    elif i.payment_terms == "prepay":
        terms_adj = -0.05

    # ── Step 7 — wiggle / opening ────
    wiggle = WHALE_WIGGLE.get(i.whale_tier, 0.10)
    opening_per_bag = floor_per_bag + wiggle + freight_per_bag + terms_adj
    opening_per_bag = round(opening_per_bag, 2)

    # ── Step 8 — tier classification ────
    tier = classify_tier(i.volume_bags, i.format, i.branded_or_pl)

    # ── Step 9 — escalation clause ────
    escalation_required = bool(i.multi_batch)
    if escalation_required:
        flags.append("⚠️ MULTI-BATCH — escalation clause REQUIRED in proposal. Hard block if missing.")

    # ── Margin checks ────
    gp_per_bag = round(opening_per_bag - total_cogs, 4)
    floor_gp = round(floor_per_bag - total_cogs, 4)
    if floor_gp < margin_floor - 0.001:
        flags.append(f"🚩 BELOW MIN_MARGIN_FLOOR ({margin_floor} for {i.branded_or_pl}). HARD BLOCK — must be re-priced or class-C waivered.")

    # ── Always-on placeholder caveat ────
    flags.insert(0, "🚩 PLACEHOLDER COST BASIS — $1.52 from /CLAUDE.md is placeholder until Powers + Belmark final invoices reconcile. All quotes carry margin-of-error.")

    extended_revenue = round(opening_per_bag * i.volume_bags, 2)
    extended_cogs = round(total_cogs * i.volume_bags, 2)
    extended_gp = round(extended_revenue - extended_cogs, 2)
    gp_pct = round(extended_gp / extended_revenue * 100, 1) if extended_revenue else 0.0

    summary = (
        f"\n══════════════════════════════════════\n"
        f"  USA GUMMIES — CUSTOM QUOTE\n"
        f"══════════════════════════════════════\n"
        f"  Volume:               {i.volume_bags:,} bags\n"
        f"  Format:               {i.format}\n"
        f"  Bag size:             {i.bag_size_oz} oz\n"
        f"  Branded:              {i.branded_or_pl}\n"
        f"  Freight:              {i.freight_mode}\n"
        f"  Payment terms:        {i.payment_terms}\n"
        f"  Tier classification:  {tier}\n"
        f"\n"
        f"  COGS / bag:           ${total_cogs:.2f}\n"
        f"  Floor / bag:          ${floor_per_bag:.2f}  (margin floor {margin_floor:.2f}/bag)\n"
        f"  Wiggle (whale-tier):  ${wiggle:.2f}\n"
        f"  Freight / bag:        ${freight_per_bag:.2f}\n"
        f"  Terms adjustment:     ${terms_adj:.2f}\n"
        f"  ────────────────────────────\n"
        f"  *Opening quote:       ${opening_per_bag:.2f} / bag*\n"
        f"\n"
        f"  Extended revenue:     ${extended_revenue:,.2f}\n"
        f"  Extended COGS:        ${extended_cogs:,.2f}\n"
        f"  Extended GP:          ${extended_gp:,.2f}\n"
        f"  GP %:                 {gp_pct}%\n"
        f"\n"
        f"  Multi-batch:          {'YES — escalation clause required' if i.multi_batch else 'NO'}\n"
        f"══════════════════════════════════════\n"
    )

    return QuoteOutput(
        inputs=asdict(i),
        cogs_breakdown={
            "manufacturing_belmark": 1.52,
            "secondary_packaging_removed": secondary_removed,
            "private_label_layer": pl_layer,
            "bag_size_adjustment": bag_size_adj,
            "total_cogs_per_bag": total_cogs,
        },
        pricing={
            "floor_per_bag": round(floor_per_bag, 2),
            "wiggle": wiggle,
            "freight_per_bag": freight_per_bag,
            "payment_terms_adjustment": terms_adj,
            "opening_quote_per_bag": opening_per_bag,
        },
        totals={
            "volume_bags": i.volume_bags,
            "extended_revenue": extended_revenue,
            "extended_cogs": extended_cogs,
            "extended_gp": extended_gp,
            "gp_pct": gp_pct,
        },
        tier_classification=tier,
        freight_eligibility=freight_eligibility,
        escalation_clause_required=escalation_required,
        flags=flags,
        customer_summary=summary,
    )


def main():
    ap = argparse.ArgumentParser(description="Custom quote calculator — see /contracts/custom-quote-formula.md")
    ap.add_argument("--volume-bags", type=int, required=True)
    ap.add_argument("--format", choices=list(COGS_BY_FORMAT.keys()), required=True)
    ap.add_argument("--freight", choices=["landed", "fob", "free_3plus"], required=True, dest="freight_mode")
    ap.add_argument("--terms", choices=list(PAYMENT_TERMS_ADJ.keys()), required=True, dest="payment_terms")
    ap.add_argument("--branded", choices=["usa_gummies", "private_label"], required=True, dest="branded_or_pl")
    ap.add_argument("--bag-oz", type=float, default=7.5, dest="bag_size_oz")
    ap.add_argument("--delivery-days", type=int, default=14, dest="delivery_window_days")
    ap.add_argument("--multi-batch", action="store_true")
    ap.add_argument("--whale-tier", type=int, choices=[0, 1, 2], default=1)
    ap.add_argument("--json", action="store_true", help="Emit JSON only (no human summary)")
    args = ap.parse_args()

    inputs = QuoteInputs(
        volume_bags=args.volume_bags,
        format=args.format,
        freight_mode=args.freight_mode,
        payment_terms=args.payment_terms,
        branded_or_pl=args.branded_or_pl,
        bag_size_oz=args.bag_size_oz,
        delivery_window_days=args.delivery_window_days,
        multi_batch=args.multi_batch,
        whale_tier=args.whale_tier,
    )

    out = compute_quote(inputs)

    if args.json:
        print(json.dumps(asdict(out), indent=2))
    else:
        print(out.customer_summary)
        if out.flags:
            print("FLAGS:")
            for f in out.flags:
                print(f"  {f}")
            print()
        print(json.dumps({k: v for k, v in asdict(out).items() if k != "customer_summary"}, indent=2))


if __name__ == "__main__":
    main()
