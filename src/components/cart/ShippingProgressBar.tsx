// src/components/cart/ShippingProgressBar.tsx
"use client";

import { cn } from "@/lib/cn";
import { FREE_SHIP_QTY } from "@/lib/bundles/pricing";

export type ShippingProgressBarProps = {
  totalBags: number;
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
  freeShipQty = FREE_SHIP_QTY,
  unlocked,
  savingsText,
  variant = "card",
}: ShippingProgressBarProps) {
  const freeShipGap = Math.max(0, freeShipQty - totalBags);
  const progressPct = clampPct(Math.round((totalBags / freeShipQty) * 100));

  const inner = (
    <>
      <div className="flex items-center justify-between text-[11px] font-semibold">
        <span className={unlocked ? "text-[#2D7A3A]" : "text-[var(--text)]"}>
          {unlocked
            ? "\u2713 Free shipping unlocked!"
            : `Add ${freeShipGap} more bag${freeShipGap === 1 ? "" : "s"} for FREE shipping`}
        </span>
        <span className="text-[var(--muted)]">
          {totalBags}/{freeShipQty} bags
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[rgba(15,27,45,0.08)]">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            unlocked ? "bg-[#2D7A3A]" : "bg-[#c7362c]"
          )}
          style={{ width: `${progressPct}%` }}
        />
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
