// src/components/cart/OrderSummaryPanel.tsx
"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { ShippingProgressBar } from "@/components/cart/ShippingProgressBar";
import { ExpressCheckoutButtons } from "@/components/cart/ExpressCheckoutButtons";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";
import type { MouseEvent } from "react";

export type OrderSummaryPanelProps = {
  totalBags: number;
  unlocked: boolean;
  subtotal: string;
  estimatedTotal: string;
  shippingSummary: string;
  shippingHint: string;
  bundlePerBagText: string;
  bestPriceApplied: boolean;
  hasSavings: boolean;
  showRegularLine: boolean;
  regularTotalText: string;
  drawerSavingsLine: string;
  highlightTotals: boolean;
  showNextTierCta: boolean;
  nextTierCtaLabel: string;
  bundlePending: boolean;
  checkoutUrl: string | null;
  checkoutHref: string | null;
  secondaryCta: { href: string; label: string };
  onAddNextTier: () => void;
  onCheckoutClick: (event: MouseEvent<HTMLAnchorElement>, method: string) => void;
  onClose?: () => void;
};

export function OrderSummaryPanel({
  totalBags,
  unlocked,
  subtotal,
  estimatedTotal,
  shippingSummary,
  shippingHint,
  bundlePerBagText,
  bestPriceApplied,
  hasSavings,
  showRegularLine,
  regularTotalText,
  drawerSavingsLine,
  highlightTotals: _highlightTotals,
  showNextTierCta,
  nextTierCtaLabel,
  bundlePending,
  checkoutUrl,
  checkoutHref,
  secondaryCta,
  onAddNextTier,
  onCheckoutClick,
  onClose,
}: OrderSummaryPanelProps) {
  const resolvedCheckoutHref = checkoutHref ?? checkoutUrl ?? "";

  return (
    <div className="metal-panel rounded-2xl border border-[rgba(199,160,98,0.35)] p-4 flex flex-col gap-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
        Order summary
      </div>
      <div className="flex items-center justify-between text-sm text-[var(--muted)]">
        <span>Items</span>
        <span className="font-black text-[var(--text)]">{subtotal}</span>
      </div>
      <div className="flex items-center justify-between text-sm text-[var(--muted)]">
        <span>Shipping</span>
        <span className="font-semibold text-[var(--text)]">{shippingSummary}</span>
      </div>
      <div className="text-[10px] text-[var(--muted)]">{shippingHint}</div>

      {totalBags > 0 && (
        <div className="my-2">
          <ShippingProgressBar
            totalBags={totalBags}
            unlocked={unlocked}
            variant="inline"
          />
        </div>
      )}

      <div className="flex items-center justify-between text-base text-[var(--text)]">
        <span className="font-semibold">Estimated total</span>
        <span className="font-black">{estimatedTotal}</span>
      </div>
      {bundlePerBagText && (
        <div className="text-xs text-[var(--muted)]">
          Price per bag at {totalBags} bags &bull; {bundlePerBagText} / bag
        </div>
      )}
      {bestPriceApplied && (
        <div className="inline-flex w-fit rounded-full border border-[rgba(239,59,59,0.25)] bg-[rgba(239,59,59,0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--candy-red)]">
          Best price active
        </div>
      )}
      {totalBags > 0 && (
        <div
          className={cn(
            "text-xs font-semibold",
            hasSavings ? "text-[var(--candy-red)]" : "text-[var(--muted)]"
          )}
        >
          {showRegularLine
            ? `Normally ${regularTotalText} \u2014 today ${estimatedTotal}`
            : drawerSavingsLine}
        </div>
      )}
      {showNextTierCta && (
        <button
          type="button"
          onClick={onAddNextTier}
          disabled={bundlePending}
          className="btn btn-outline pressable w-full justify-center"
        >
          {bundlePending ? "Adding..." : nextTierCtaLabel}
        </button>
      )}

      <div className="mt-2">
        {checkoutUrl && (
          <div className="mb-3">
            <ExpressCheckoutButtons
              checkoutUrl={resolvedCheckoutHref}
              onCheckoutClick={onCheckoutClick}
              variant="panel"
            />
          </div>
        )}
        {checkoutUrl && (
          <div className="mb-2 grid gap-1 text-[11px] font-semibold text-[var(--muted)]">
            <div>{"\u2B50"} {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers</div>
            <div>{"\uD83C\uDDFA\uD83C\uDDF8"} Made in the USA</div>
            <div>{"\uD83D\uDE9A"} Ships within 24 hours</div>
          </div>
        )}
        {checkoutUrl && (
          <a
            href={resolvedCheckoutHref}
            className="btn btn-candy w-full justify-center pressable"
            onClick={(event) => onCheckoutClick(event, "secure")}
          >
            <span className="inline-flex items-center gap-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 1 0-8 0v2z"
                />
              </svg>
              Secure checkout
            </span>
          </a>
        )}
        <div className="mt-2 text-xs font-semibold text-[var(--muted)]">
          Order now, ships tomorrow.
        </div>
        <Link
          href={secondaryCta.href}
          className="mt-2 inline-flex text-xs font-semibold text-[var(--muted)] underline underline-offset-4 hover:text-[var(--text)]"
          onClick={onClose}
        >
          {secondaryCta.label}
        </Link>
      </div>
    </div>
  );
}
