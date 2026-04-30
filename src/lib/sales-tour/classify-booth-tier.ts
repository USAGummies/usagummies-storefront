/**
 * Pure tier classifier — maps `BoothVisitIntent` → list of `QuoteLine`s
 * + the doctrinal `PricingClass` + the approval requirement.
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` §3.1 (the truth table).
 * Pricing constants: `/src/lib/wholesale/pricing-tiers.ts` (B-grid is canonical).
 *
 * No I/O. Pure functions only — fully unit-testable.
 */
import {
  BAG_PRICE_USD,
  BAGS_PER_UNIT,
  type PricingTier,
} from "@/lib/wholesale/pricing-tiers";

import type {
  ApprovalRequirement,
  BoothVisitIntent,
  PricingClass,
  QuoteLine,
} from "./booth-visit-types";

/** Doctrinal off-grid prices from `pricing-route-governance.md` §1. */
const PICKUP_FLOOR_PRICE = 2.0;
const ROUTE_ANCHOR_PRICE = 3.0;

/** Bag count thresholds for class detection. */
const PALLET_BAG_COUNT = BAGS_PER_UNIT.B4; // 900
const MASTER_CARTON_BAG_COUNT = BAGS_PER_UNIT.B2; // 36
const ROUTE_ANCHOR_MIN_PALLETS = 3;
const SAMPLE_DROP_FREE_THRESHOLD = 6; // up to 6 free bags = Class A `slack.post.audit`

interface ClassifyResult {
  lines: QuoteLine[];
  approval: ApprovalRequirement;
  approvalReasons: string[];
  dealCheckRequired: boolean;
  pricingClass: PricingClass;
}

/**
 * Build a `QuoteLine` from a B-grid tier — used for on-grid `C-STD` lines.
 */
function gridLine(
  tier: PricingTier,
  totalBags: number,
  pricingClass: PricingClass,
  freightStance: QuoteLine["freightStance"],
  labelOverride?: string,
): QuoteLine {
  const pricePerBag = BAG_PRICE_USD[tier];
  const totalUsd = +(pricePerBag * totalBags).toFixed(2);
  return {
    bGridDesignator: tier,
    pricingClass,
    pricePerBag,
    freightStance,
    totalUsd,
    label:
      labelOverride ??
      `${totalBags} bags · ${tier} ($${pricePerBag.toFixed(2)}/bag, ${freightStance === "landed" ? "landed" : "buyer freight"}) = $${totalUsd.toFixed(2)}`,
  };
}

/**
 * Build an off-grid `QuoteLine` (used for C-PU pickup floor + C-ANCH route anchor).
 */
function offGridLine(args: {
  totalBags: number;
  pricingClass: PricingClass;
  pricePerBag: number;
  freightStance: QuoteLine["freightStance"];
  label: string;
}): QuoteLine {
  const totalUsd = +(args.pricePerBag * args.totalBags).toFixed(2);
  return {
    bGridDesignator: null,
    pricingClass: args.pricingClass,
    pricePerBag: args.pricePerBag,
    freightStance: args.freightStance,
    totalUsd,
    label: args.label,
  };
}

/**
 * Classify a booth visit per the §3.1 truth table. Returns one or two lines
 * (two when `freightAsk = "unsure"` so Ben can show both options at the booth)
 * plus the approval class and deal-check flag.
 */
export function classifyBoothTier(intent: BoothVisitIntent): ClassifyResult {
  const { scale, count, totalBags, freightAsk } = intent;
  const palletCount =
    scale === "pallet"
      ? count
      : Math.floor(totalBags / PALLET_BAG_COUNT);
  const reasons: string[] = [];

  // -----------------------------------------------------------------
  // Sample drops (1 case or fewer free bags) — Class A audit-only
  // -----------------------------------------------------------------
  if (scale === "sample" || (scale === "case" && totalBags <= SAMPLE_DROP_FREE_THRESHOLD)) {
    reasons.push(`sample drop ≤${SAMPLE_DROP_FREE_THRESHOLD} bags → Class A free sample (Drew/Ben fulfills)`);
    return {
      lines: [
        offGridLine({
          totalBags,
          pricingClass: "C-EXC",
          pricePerBag: 0,
          freightStance: "buyer-paid",
          label: `${totalBags} bag sample drop · FREE · ship via Drew (East Coast) or Ben (Ashford WA)`,
        }),
      ],
      approval: "none",
      approvalReasons: reasons,
      dealCheckRequired: false,
      pricingClass: "C-EXC",
    };
  }

  // -----------------------------------------------------------------
  // Pickup floor ($2.00) — explicit `pickup` ask + ≥1 master carton
  // Off-grid; first-time = Class C deal-check
  // -----------------------------------------------------------------
  if (freightAsk === "pickup" && totalBags >= MASTER_CARTON_BAG_COUNT && palletCount === 0) {
    // Pickup at master-carton scale → C-PU pickup floor (off-grid Class C)
    // OR `B3` $3.25 master carton buyer-pays (on-grid Class A).
    // Per pricing-route-governance.md §1, C-PU is the floor; B3 is the
    // standard alternative. Ben can choose at the booth.
    reasons.push(`pickup ask + ${totalBags} bags → offer both C-PU floor ($${PICKUP_FLOOR_PRICE}/bag, off-grid Class C) and B3 ($${BAG_PRICE_USD.B3}/bag buyer-pays, on-grid Class A)`);
    return {
      lines: [
        offGridLine({
          totalBags,
          pricingClass: "C-PU",
          pricePerBag: PICKUP_FLOOR_PRICE,
          freightStance: "buyer-paid",
          label: `${totalBags} bags · C-PU pickup floor ($${PICKUP_FLOOR_PRICE.toFixed(2)}/bag, buyer freight) = $${(PICKUP_FLOOR_PRICE * totalBags).toFixed(2)} *(off-grid; needs Class C deal-check)*`,
        }),
        gridLine("B3", totalBags, "C-STD", "buyer-paid"),
      ],
      approval: "class-c",
      approvalReasons: reasons,
      dealCheckRequired: true,
      pricingClass: "C-PU",
    };
  }

  // -----------------------------------------------------------------
  // Pallet-scale orders
  // -----------------------------------------------------------------
  if (palletCount >= 1 || scale === "pallet") {
    const palletsForGrid = palletCount === 0 ? 1 : palletCount;
    // Route anchor: ≥3 pallets + (anchor OR landed)
    if (
      palletsForGrid >= ROUTE_ANCHOR_MIN_PALLETS &&
      (freightAsk === "anchor" || freightAsk === "landed")
    ) {
      reasons.push(
        `${palletsForGrid}-pallet ${freightAsk} ask → C-ANCH route-anchor at $${ROUTE_ANCHOR_PRICE}/bag (off-grid; Class C first-time deal-check + corridor route plan required)`,
      );
      return {
        lines: [
          offGridLine({
            totalBags,
            pricingClass: "C-ANCH",
            pricePerBag: ROUTE_ANCHOR_PRICE,
            freightStance: "landed",
            label: `${totalBags} bags · ${palletsForGrid} pallets · C-ANCH route-anchor ($${ROUTE_ANCHOR_PRICE.toFixed(2)}/bag, landed) = $${(ROUTE_ANCHOR_PRICE * totalBags).toFixed(2)} *(off-grid; needs Class C deal-check + route plan)*`,
          }),
        ],
        approval: "class-c",
        approvalReasons: reasons,
        dealCheckRequired: true,
        pricingClass: "C-ANCH",
      };
    }
    // Pallet pickup: B5 $3.00 buyer-pays
    if (freightAsk === "pickup") {
      reasons.push(`pallet pickup → B5 $${BAG_PRICE_USD.B5}/bag buyer-pays (on-grid Class A)`);
      return {
        lines: [gridLine("B5", totalBags, "C-STD", "buyer-paid")],
        approval: "none",
        approvalReasons: reasons,
        dealCheckRequired: false,
        pricingClass: "C-STD",
      };
    }
    // Pallet landed (1-2 pallets, OR ≥3 with non-anchor freight ask): B4
    if (freightAsk === "landed" || freightAsk === "fill" || freightAsk === "unsure") {
      const lines: QuoteLine[] = [gridLine("B4", totalBags, "C-STD", "landed")];
      if (freightAsk === "unsure") {
        lines.push(gridLine("B5", totalBags, "C-STD", "buyer-paid"));
        reasons.push("freight ask = unsure → quote both B4 landed and B5 buyer-pays");
      } else if (freightAsk === "fill") {
        reasons.push("`fill` ask → C-FILL framing applies (route already justified by anchor); price is B4 grid");
        lines[0].pricingClass = "C-FILL";
      } else {
        reasons.push(`${palletsForGrid}-pallet landed → B4 $${BAG_PRICE_USD.B4}/bag (on-grid Class A)`);
      }
      return {
        lines,
        approval: "none",
        approvalReasons: reasons,
        dealCheckRequired: false,
        pricingClass: freightAsk === "fill" ? "C-FILL" : "C-STD",
      };
    }
  }

  // -----------------------------------------------------------------
  // Master-carton scale (no pallets) — landed B2 / buyer-pays B3 / unsure both
  // -----------------------------------------------------------------
  if (scale === "master-carton" || (scale === "case" && totalBags >= MASTER_CARTON_BAG_COUNT)) {
    if (freightAsk === "landed" || freightAsk === "fill") {
      const cls: PricingClass = freightAsk === "fill" ? "C-FILL" : "C-STD";
      reasons.push(
        `${totalBags} bags master-carton ${freightAsk} → B2 $${BAG_PRICE_USD.B2}/bag landed (${cls})`,
      );
      const line = gridLine("B2", totalBags, cls, "landed");
      return {
        lines: [line],
        approval: "none",
        approvalReasons: reasons,
        dealCheckRequired: false,
        pricingClass: cls,
      };
    }
    if (freightAsk === "pickup") {
      reasons.push(`${totalBags} bags master-carton pickup → B3 $${BAG_PRICE_USD.B3}/bag buyer-pays (C-STD)`);
      return {
        lines: [gridLine("B3", totalBags, "C-STD", "buyer-paid")],
        approval: "none",
        approvalReasons: reasons,
        dealCheckRequired: false,
        pricingClass: "C-STD",
      };
    }
    // unsure → quote both
    reasons.push("freight ask = unsure → quote both B2 landed and B3 buyer-pays");
    return {
      lines: [
        gridLine("B2", totalBags, "C-STD", "landed"),
        gridLine("B3", totalBags, "C-STD", "buyer-paid"),
      ],
      approval: "none",
      approvalReasons: reasons,
      dealCheckRequired: false,
      pricingClass: "C-STD",
    };
  }

  // -----------------------------------------------------------------
  // Sub-master-carton case quantities (paid samples / small orders)
  // 7-35 bag range = paid sample territory; B1 ($3.49 local case) is
  // internal-only. Use B2 pricing as the closest published anchor.
  // -----------------------------------------------------------------
  reasons.push(
    `${totalBags} bag sub-master-carton order → quote at B2 anchor ($${BAG_PRICE_USD.B2}/bag landed) since B1 is internal-only`,
  );
  return {
    lines: [
      gridLine(
        "B2",
        totalBags,
        "C-STD",
        freightAsk === "pickup" ? "buyer-paid" : "landed",
        `${totalBags} bags · sub-master-carton at B2 anchor ($${BAG_PRICE_USD.B2.toFixed(2)}/bag) = $${(BAG_PRICE_USD.B2 * totalBags).toFixed(2)}`,
      ),
    ],
    approval: "none",
    approvalReasons: reasons,
    dealCheckRequired: false,
    pricingClass: "C-STD",
  };
}
