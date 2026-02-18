"use client";

import { useState, useCallback, useRef } from "react";
import Image from "next/image";
import {
  BASE_PRICE,
  pricingForQty,
  DISCOUNT_START_QTY,
  FREE_SHIP_QTY,
} from "@/lib/bundles/pricing";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { AMAZON_LISTING_URL } from "@/lib/amazon";
import { trackEvent } from "@/lib/analytics";
import { fireCartToast } from "@/lib/cartFeedback";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type BagSliderProps = {
  variant?: "full" | "compact" | "sticky";
  defaultQty?: number;
  showMilestones?: boolean;
  className?: string;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MIN_QTY = 1;
const MAX_QTY = 12;

const MILESTONES = [
  { qty: 5, label: "Free shipping", color: "#2D7A3A" },
  { qty: 8, label: "Most popular", color: "#1B2A4A" },
  { qty: 12, label: "Best price", color: "#c7362c" },
] as const;

const FLAVOR_BEARS = [
  { name: "Cherry", src: "/brand/gummies/gummy-red.png" },
  { name: "Lemon", src: "/brand/gummies/gummy-yellow.png" },
  { name: "Green Apple", src: "/brand/gummies/gummy-green.png" },
  { name: "Orange", src: "/brand/gummies/gummy-orange.png" },
  { name: "Watermelon", src: "/brand/gummies/gummy-pink.png" },
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function money(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function pct(qty: number) {
  return ((qty - MIN_QTY) / (MAX_QTY - MIN_QTY)) * 100;
}

function storeCartId(cartId?: string | null) {
  if (!cartId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem("cartId", cartId);
  } catch { /* ignore storage */ }
  if (typeof document !== "undefined") {
    document.cookie = `cartId=${cartId}; path=/; samesite=lax`;
  }
}

function getStoredCartId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("cartId");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BagSlider({
  variant = "full",
  defaultQty = 5,
  showMilestones = true,
  className = "",
}: BagSliderProps) {
  const [qty, setQty] = useState(Math.max(MIN_QTY, Math.min(MAX_QTY, defaultQty)));
  const [busy, setBusy] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const isAmazon = qty < DISCOUNT_START_QTY;
  const { perBag, total } = pricingForQty(qty);
  const retailTotal = BASE_PRICE * qty;
  const savings = retailTotal - total;
  const hasSavings = savings > 0.005;
  const freeShip = qty >= FREE_SHIP_QTY;

  /* ---- slider interaction ---- */
  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQty(Number(e.target.value));
  }, []);

  const nudge = useCallback((dir: 1 | -1) => {
    setQty((q) => Math.max(MIN_QTY, Math.min(MAX_QTY, q + dir)));
  }, []);

  /* ---- CTA action ---- */
  const handleCta = useCallback(async () => {
    if (busy) return;

    if (isAmazon) {
      trackEvent("bag_slider_amazon", { qty, per_bag: perBag, total });
      window.open(AMAZON_LISTING_URL, "_blank", "noopener");
      return;
    }

    setBusy(true);
    trackEvent("bag_slider_add_to_cart", { qty, per_bag: perBag, total });

    try {
      const existingCartId = getStoredCartId();
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace",
          variantId: SINGLE_BAG_VARIANT_ID,
          quantity: qty,
          ...(existingCartId ? { cartId: existingCartId } : {}),
        }),
      });
      const data = await res.json();
      if (data.ok && data.cart?.id) {
        storeCartId(data.cart.id);
        fireCartToast(qty);
      }
    } catch {
      // silent fail — toast will still show via event
    } finally {
      setBusy(false);
    }
  }, [busy, isAmazon, qty, perBag, total]);

  /* ---- milestone snapping for tap targets ---- */
  const snapToMilestone = useCallback((mQty: number) => {
    setQty(mQty);
    trackEvent("bag_slider_milestone_tap", { milestone: mQty });
  }, []);

  /* ---------------------------------------------------------------- */
  /*  STICKY variant — minimal bottom bar                             */
  /* ---------------------------------------------------------------- */
  if (variant === "sticky") {
    return (
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 border-t border-[rgba(27,42,74,0.1)] bg-white/95 backdrop-blur-sm px-4 py-2.5 ${className}`}
        style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => nudge(-1)}
              disabled={qty <= MIN_QTY}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(27,42,74,0.15)] text-sm font-bold text-[#1B2A4A] disabled:opacity-30"
              aria-label="Remove one bag"
            >
              −
            </button>
            <span className="text-sm font-bold text-[#1B2A4A] tabular-nums">{qty}</span>
            <button
              onClick={() => nudge(1)}
              disabled={qty >= MAX_QTY}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(27,42,74,0.15)] text-sm font-bold text-[#1B2A4A] disabled:opacity-30"
              aria-label="Add one bag"
            >
              +
            </button>
          </div>
          <button
            onClick={handleCta}
            disabled={busy}
            className={`flex-1 rounded-full py-2.5 text-center text-sm font-bold text-white transition-colors ${
              isAmazon
                ? "bg-[#FF9900] active:bg-[#e68a00]"
                : "bg-[#c7362c] active:bg-[#b02c26]"
            } ${busy ? "opacity-60" : ""}`}
          >
            {busy
              ? "Adding…"
              : isAmazon
                ? `Buy on Amazon — ${money(total)}`
                : `Add to Cart — ${money(total)}`}
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  COMPACT variant — for cart upsell sidebar                       */
  /* ---------------------------------------------------------------- */
  if (variant === "compact") {
    return (
      <div className={`rounded-2xl border border-[rgba(27,42,74,0.1)] bg-white p-4 ${className}`}>
        <div className="text-xs font-bold uppercase tracking-wider text-[#1B2A4A]/60 mb-2">
          Adjust your order
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => nudge(-1)}
            disabled={qty <= MIN_QTY}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(27,42,74,0.15)] text-base font-bold text-[#1B2A4A] disabled:opacity-30"
          >
            −
          </button>
          <div className="flex-1">
            <input
              type="range"
              min={MIN_QTY}
              max={MAX_QTY}
              step={1}
              value={qty}
              onChange={handleSlider}
              className="bag-slider__range w-full"
              aria-label={`Select bag quantity: ${qty}`}
            />
          </div>
          <button
            onClick={() => nudge(1)}
            disabled={qty >= MAX_QTY}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(27,42,74,0.15)] text-base font-bold text-[#1B2A4A] disabled:opacity-30"
          >
            +
          </button>
          <span className="text-lg font-black text-[#1B2A4A] tabular-nums w-8 text-center">{qty}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between text-xs">
          <span className="text-[#1B2A4A]/70">
            {money(perBag)}/bag{hasSavings && <span className="text-[#2D7A3A] font-semibold ml-1">Save {money(savings)}</span>}
          </span>
          <span className="font-bold text-[#1B2A4A]">{money(total)}</span>
        </div>
        <button
          onClick={handleCta}
          disabled={busy}
          className={`mt-3 w-full rounded-full py-2.5 text-center text-sm font-bold text-white transition-colors ${
            isAmazon
              ? "bg-[#FF9900] active:bg-[#e68a00]"
              : "bg-[#c7362c] active:bg-[#b02c26]"
          } ${busy ? "opacity-60" : ""}`}
        >
          {busy
            ? "Adding…"
            : isAmazon
              ? `Buy on Amazon — ${money(total)}`
              : `Update Cart — ${money(total)}`}
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  FULL variant — primary purchase surface                         */
  /* ---------------------------------------------------------------- */
  return (
    <div className={`bag-slider ${className}`}>
      {/* Quantity display */}
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-bold uppercase tracking-wider text-[#1B2A4A]/60">
          How many bags?
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => nudge(-1)}
            disabled={qty <= MIN_QTY}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(27,42,74,0.15)] text-sm font-bold text-[#1B2A4A] disabled:opacity-30 transition-opacity"
            aria-label="Remove one bag"
          >
            −
          </button>
          <span className="text-xl font-black text-[#1B2A4A] tabular-nums w-8 text-center">{qty}</span>
          <button
            onClick={() => nudge(1)}
            disabled={qty >= MAX_QTY}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(27,42,74,0.15)] text-sm font-bold text-[#1B2A4A] disabled:opacity-30 transition-opacity"
            aria-label="Add one bag"
          >
            +
          </button>
        </div>
      </div>

      {/* Slider track */}
      <div className="relative mt-2 mb-1" ref={trackRef}>
        <input
          type="range"
          min={MIN_QTY}
          max={MAX_QTY}
          step={1}
          value={qty}
          onChange={handleSlider}
          className="bag-slider__range w-full"
          aria-label={`Select bag quantity: ${qty} bags`}
          style={{
            background: `linear-gradient(to right, #c7362c 0%, #c7362c ${pct(qty)}%, rgba(27,42,74,0.12) ${pct(qty)}%, rgba(27,42,74,0.12) 100%)`,
          }}
        />

        {/* Milestone markers on track */}
        {showMilestones && (
          <div className="absolute inset-x-0 top-0 h-full pointer-events-none" aria-hidden="true">
            {MILESTONES.map((m) => (
              <button
                key={m.qty}
                onClick={() => snapToMilestone(m.qty)}
                className="pointer-events-auto absolute -translate-x-1/2 top-[22px] flex flex-col items-center"
                style={{ left: `${pct(m.qty)}%` }}
                aria-label={`Select ${m.qty} bags — ${m.label}`}
              >
                <span
                  className="h-2 w-2 rounded-full border-2 border-white"
                  style={{ backgroundColor: m.color }}
                />
                <span
                  className="mt-0.5 text-[9px] font-bold leading-none whitespace-nowrap"
                  style={{ color: m.color }}
                >
                  {m.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Spacing for milestone labels */}
      {showMilestones && <div className="h-5" />}

      {/* Price breakdown */}
      <div className="rounded-xl bg-[#f8f5ef] border border-[rgba(27,42,74,0.06)] px-4 py-3 mt-1">
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-2xl font-black text-[#1B2A4A] tabular-nums">{money(total)}</span>
            {qty > 1 && (
              <span className="ml-2 text-sm text-[#1B2A4A]/60">
                {money(perBag)}/bag
              </span>
            )}
          </div>
          {hasSavings && (
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-[#2D7A3A]">
                Save {money(savings)}
              </span>
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#2D7A3A] text-[9px] text-white">
                ✓
              </span>
            </div>
          )}
        </div>

        {/* Retail comparison */}
        {hasSavings && (
          <div className="mt-1 text-xs text-[#1B2A4A]/50">
            <span className="line-through">{money(retailTotal)}</span>
            <span className="ml-1">retail</span>
          </div>
        )}

        {/* Shipping note */}
        <div className="mt-1.5 text-xs font-medium">
          {freeShip ? (
            <span className="text-[#2D7A3A]">
              <span className="mr-1">✓</span>Free shipping included
            </span>
          ) : (
            <span className="text-[#1B2A4A]/50">
              Ships free with Amazon Prime
            </span>
          )}
        </div>
      </div>

      {/* CTA Button */}
      <button
        onClick={handleCta}
        disabled={busy}
        className={`mt-3 w-full rounded-full py-3.5 text-center text-base font-bold text-white shadow-md transition-all active:scale-[0.98] ${
          isAmazon
            ? "bg-[#FF9900] hover:bg-[#e68a00] shadow-[#FF9900]/20"
            : "bg-[#c7362c] hover:bg-[#b02c26] shadow-[#c7362c]/20"
        } ${busy ? "opacity-60 pointer-events-none" : ""}`}
      >
        {busy ? (
          "Adding to cart…"
        ) : isAmazon ? (
          <span className="flex items-center justify-center gap-2">
            Buy on Amazon — {money(total)}
          </span>
        ) : (
          <span>Add to Cart — {money(total)}</span>
        )}
      </button>

      {/* Channel explanation */}
      <div className="mt-2 text-center text-[10px] text-[#1B2A4A]/40">
        {isAmazon ? (
          <>Opens Amazon.com in a new tab &middot; Prime shipping available</>
        ) : (
          <>Ships direct from USA Gummies &middot; Free shipping on 5+ bags</>
        )}
      </div>

      {/* Flavor strip — full variant only */}
      {variant === "full" && (
        <div className="mt-4 pt-3 border-t border-[rgba(27,42,74,0.06)]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#1B2A4A]/50 mb-2">
            5 classic flavors in every bag
          </div>
          <div className="flex items-center gap-3">
            {FLAVOR_BEARS.map((f) => (
              <div key={f.name} className="flex flex-col items-center gap-0.5">
                <Image
                  src={f.src}
                  alt={`${f.name} gummy bear`}
                  width={28}
                  height={28}
                  className="drop-shadow-sm"
                />
                <span className="text-[9px] font-medium text-[#1B2A4A]/60">{f.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
