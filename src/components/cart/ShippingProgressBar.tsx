// src/components/cart/ShippingProgressBar.tsx
//
// 2026-04-29 \u2014 repurposed. Free shipping is now universal (no minimum),
// so this bar no longer tracks a "free shipping unlock." Instead it shows
// progress toward the 5-bag bundle-pricing tier ($5.00/bag, save $4.95
// vs straight retail). Same component contract \u2014 `unlocked`, `totalBags`,
// `savingsText` \u2014 so callers don't need to change. The visual gauge now
// progresses toward the bundle pricing milestone (DISCOUNT_START_QTY=5)
// instead of FREE_SHIP_QTY.
"use client";

import { cn } from "@/lib/cn";
import { DISCOUNT_START_QTY, perBagForQty, BASE_PRICE } from "@/lib/bundles/pricing";

export type ShippingProgressBarProps = {
  totalBags: number;
  /** @deprecated kept for backward compat; ignored \u2014 bar now tracks bundle tier */
  freeShipQty?: number;
  unlocked: boolean;
  /** Optional savings line shown below the bar when savings are active */
  savingsText?: string;
  /** Visual variant: "card" wraps in a bordered card, "inline" renders bare */
  variant?: "card" | "inline";
};

function clampPct(pct: number): number {
  return Math.max(0, Math.min(100, pct));
}

export function ShippingProgressBar({
  totalBags,
  unlocked,
  savingsText,
  variant = "card",
}: ShippingProgressBarProps) {
  // Bar now tracks progress toward bundle pricing (5 bags = $5.00/bag).
  // "unlocked" prop is reinterpreted as "bundle tier reached".
  const tierTarget = DISCOUNT_START_QTY;
  const tierGap = Math.max(0, tierTarget - totalBags);
  const tierUnlocked = totalBags >= tierTarget;
  const progressPct = clampPct(Math.round((totalBags / tierTarget) * 100));
  const savingsAtTier = (BASE_PRICE - perBagForQty(tierTarget)) * tierTarget; // $4.95

  const inner = (
    <>
      <div className="flex items-center justify-between text-[11px] font-semibold">
        <span className={tierUnlocked ? "text-[#2D7A3A]" : "text-[var(--text)]"}>
          {tierUnlocked
            ? "\u2713 Bundle pricing active \u2014 $5.00/bag"
            : `Add ${tierGap} more bag${tierGap === 1 ? "" : "s"} to drop to $5.00/bag (save $${savingsAtTier.toFixed(2)})`}
        </span>
        <span className="text-[var(--muted)]">
          {totalBags}/{tierTarget} bags
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[rgba(15,27,45,0.08)]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            tierUnlocked ? "bg-[#2D7A3A]" : "bg-[#c7362c]"
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted)]">
        Free shipping on every order &middot; no minimum
      </div>
      {savingsText && (
        <div className="mt-1 text-[10px] font-semibold text-[#2D7A3A]">
          {savingsText}
        </div>
      )}
    </>
  );

  if (variant === "inline") {
    return <div className="rounded-xl bg-[rgba(15,27,45,0.04)] p-2.5">{inner}</div>;
  }

  return (
    <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-3">
      {inner}
    </div>
  );
}
