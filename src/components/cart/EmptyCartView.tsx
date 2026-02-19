// src/components/cart/EmptyCartView.tsx
"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY } from "@/lib/bundles/pricing";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";
import { AmazonOneBagNote } from "@/components/ui/AmazonOneBagNote";

type MoneyV2 = { amount: string; currencyCode: string };

function formatMoney(amount: MoneyV2 | null | undefined): string {
  const n = Number(amount?.amount ?? 0);
  const currency = String(amount?.currencyCode ?? "USD");
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function formatNumber(amount: number, currencyCode = "USD"): string {
  return formatMoney({ amount: amount.toFixed(2), currencyCode });
}

export type EmptyCartViewProps = {
  /** "drawer" for the slide-out drawer, "page" for the full cart page */
  variant: "drawer" | "page";
  onAddBags: (qty: number) => void;
  bundlePending: boolean;
  onClose?: () => void;
};

export function EmptyCartView({
  variant,
  onAddBags,
  bundlePending,
  onClose,
}: EmptyCartViewProps) {
  if (variant === "drawer") {
    return (
      <div className="rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white p-4">
        <div className="text-center">
          <div className="text-lg font-black text-[var(--text)]">Your cart is empty</div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            Pick a bag count to get started. Free shipping at 5+ bags.
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[5, 8, 12].map((q) => {
            const p = pricingForQty(q);
            const isBest = q === 8;
            return (
              <button
                key={q}
                type="button"
                onClick={() => onAddBags(q)}
                disabled={bundlePending}
                className={cn(
                  "relative rounded-xl border px-3 py-3 text-center transition hover:-translate-y-px",
                  isBest
                    ? "border-[#c7362c] bg-[rgba(199,54,44,0.04)] shadow-sm"
                    : "border-[rgba(15,27,45,0.12)] bg-white"
                )}
              >
                {isBest && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-[#c7362c] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
                    Popular
                  </span>
                )}
                <div className="text-base font-black text-[var(--text)]">{q}</div>
                <div className="text-[10px] font-semibold text-[var(--muted)]">bags</div>
                <div className="mt-1 text-xs font-bold text-[#2D7A3A]">
                  {formatNumber(p.perBag, "USD")}/bag
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-3">
          <Link
            href="/shop"
            className="btn btn-candy w-full justify-center"
            onClick={onClose}
          >
            Shop all bags
          </Link>
        </div>
        <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-[var(--muted)]">
          <span>{"\uD83C\uDDFA\uD83C\uDDF8"} Made in USA</span>
          <span>&bull;</span>
          <span>{"\uD83D\uDE9A"} Free shipping 5+</span>
          <span>&bull;</span>
          <span>{"\u2B50"} 4.8 stars</span>
        </div>
      </div>
    );
  }

  // variant === "page"
  return (
    <div className="flex flex-col gap-4">
      <div className="metal-panel rounded-[28px] border border-[rgba(15,27,45,0.12)] p-5">
        <div className="text-center">
          <div className="text-lg font-black text-[var(--text)]">Your cart is empty</div>
          <div className="mt-1 text-sm text-[var(--muted)]">
            Pick a bag count to get started. Free shipping at 5+ bags.
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[5, 8, 12].map((q) => {
            const p = pricingForQty(q);
            const savings = Math.max(0, BASE_PRICE * q - p.total);
            const isBest = q === 8;
            return (
              <button
                key={q}
                type="button"
                onClick={() => onAddBags(q)}
                disabled={bundlePending}
                className={cn(
                  "relative rounded-2xl border px-3 py-4 text-center transition hover:-translate-y-0.5",
                  isBest
                    ? "border-[#c7362c] bg-[rgba(199,54,44,0.04)] shadow-md"
                    : "border-[rgba(15,27,45,0.12)] bg-white hover:shadow-sm"
                )}
              >
                {isBest && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[#c7362c] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                    Popular
                  </span>
                )}
                <div className="text-2xl font-black text-[var(--text)]">{q}</div>
                <div className="text-[11px] font-semibold text-[var(--muted)]">bags</div>
                <div className="mt-1 text-sm font-bold text-[#2D7A3A]">
                  {formatNumber(p.perBag, "USD")}/bag
                </div>
                {savings > 0 && (
                  <div className="mt-0.5 text-[10px] font-semibold text-[var(--candy-red)]">
                    Save {formatNumber(savings, "USD")}
                  </div>
                )}
                {q >= FREE_SHIP_QTY && (
                  <div className="mt-0.5 text-[10px] text-[var(--muted)]">Free shipping</div>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-4">
          <Link
            href="/shop#bundle-pricing"
            className="btn btn-candy w-full justify-center"
            onClick={onClose}
          >
            Shop all bags
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[11px] text-[var(--muted)]">
          <span>{"\uD83C\uDDFA\uD83C\uDDF8"} Made in USA</span>
          <span>&bull;</span>
          <span>{"\uD83D\uDE9A"} Free shipping 5+</span>
          <span>&bull;</span>
          <span>{"\u2B50"} {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars</span>
        </div>
        <div className="mt-2">
          <AmazonOneBagNote className="text-[11px] text-[var(--muted)] text-center" />
        </div>
      </div>
    </div>
  );
}
