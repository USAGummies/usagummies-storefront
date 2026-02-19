"use client";

import { useState, useCallback, useRef, useMemo } from "react";
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
  { name: "Cherry", src: "/brand/gummies/gummy-pink.png" },
  { name: "Lemon", src: "/brand/gummies/gummy-yellow.png" },
  { name: "Green Apple", src: "/brand/gummies/gummy-green.png" },
  { name: "Orange", src: "/brand/gummies/gummy-orange.png" },
  { name: "Watermelon", src: "/brand/gummies/gummy-red.png" },
] as const;

const BAG_IMAGE_SRC = "/brand/hero-pack-icon.png";

/* ------------------------------------------------------------------ */
/*  Bag layout                                                         */
/* ------------------------------------------------------------------ */

type BagPosition = {
  x: number;
  y: number;
  rotate: number;
  scale: number;
};

/** Deterministic pseudo-random rotation for bag at index i. */
function bagRotation(i: number): number {
  const seed = ((i * 7 + 3) % 13) / 13;
  return (seed - 0.5) * 6; // range: -3 to +3 degrees
}

/**
 * Compute positions for `count` bags in a container whose logical
 * coordinate space is 100x100. Positions are expressed as percentages.
 */
function computeBagLayout(count: number): BagPosition[] {
  const bags: BagPosition[] = [];

  if (count === 1) {
    bags.push({ x: 50, y: 50, rotate: bagRotation(0), scale: 1 });
    return bags;
  }

  if (count <= 3) {
    const spacing = 30;
    const startX = 50 - ((count - 1) * spacing) / 2;
    for (let i = 0; i < count; i++) {
      bags.push({
        x: startX + i * spacing,
        y: 50,
        rotate: bagRotation(i),
        scale: 0.9,
      });
    }
    return bags;
  }

  if (count <= 6) {
    // Pyramid: top row centered, bottom row wider
    const topCount = Math.floor(count / 2);
    const botCount = count - topCount;
    const spacing = 22;

    for (let i = 0; i < topCount; i++) {
      const startX = 50 - ((topCount - 1) * spacing) / 2;
      bags.push({
        x: startX + i * spacing,
        y: 30,
        rotate: bagRotation(i),
        scale: 0.8,
      });
    }
    for (let i = 0; i < botCount; i++) {
      const startX = 50 - ((botCount - 1) * spacing) / 2;
      bags.push({
        x: startX + i * spacing,
        y: 68,
        rotate: bagRotation(topCount + i),
        scale: 0.8,
      });
    }
    return bags;
  }

  // 7-12: grid rows filling up
  const cols = 4;
  const rows = Math.ceil(count / cols);
  const spacingX = 20;
  const spacingY = rows <= 2 ? 38 : 30;
  const startY = 50 - ((rows - 1) * spacingY) / 2;

  let placed = 0;
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, count - placed);
    const startX = 50 - ((inRow - 1) * spacingX) / 2;
    for (let c = 0; c < inRow; c++) {
      bags.push({
        x: startX + c * spacingX,
        y: startY + r * spacingY,
        rotate: bagRotation(placed),
        scale: 0.7,
      });
      placed++;
    }
  }

  return bags;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function pct(qty: number): number {
  return ((qty - MIN_QTY) / (MAX_QTY - MIN_QTY)) * 100;
}

function storeCartId(cartId?: string | null): void {
  if (!cartId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem("cartId", cartId);
  } catch { /* ignore storage */ }
  if (typeof document !== "undefined") {
    document.cookie = `cartId=${cartId}; path=/; samesite=lax`;
  }
}

function getStoredCartId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("cartId");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

function GradientAccentBar(): React.ReactElement {
  return (
    <div
      className="absolute top-0 left-0 right-0 h-1"
      style={{
        background: "linear-gradient(90deg, #c7362c, #1B2A4A, #c7362c)",
      }}
    />
  );
}

function bagImageSize(qty: number): number {
  if (qty <= 3) return 64;
  if (qty <= 6) return 52;
  return 44;
}

function BagStack({ qty }: { qty: number }): React.ReactElement {
  const layout = useMemo(() => computeBagLayout(qty), [qty]);
  const sizePx = bagImageSize(qty);

  return (
    <div
      className="relative w-full h-[130px] md:h-[180px] my-2 select-none"
      aria-hidden="true"
    >
      {layout.map((pos, i) => (
        <div
          key={i}
          className="absolute transition-all duration-300 ease-out"
          style={{
            left: `${pos.x}%`,
            top: `${pos.y}%`,
            transform: `translate(-50%, -50%) rotate(${pos.rotate}deg) scale(${pos.scale})`,
            zIndex: i,
          }}
        >
          <Image
            src={BAG_IMAGE_SRC}
            alt=""
            width={sizePx}
            height={sizePx}
            className="drop-shadow-md pointer-events-none w-[44px] md:w-[56px] h-auto"
            draggable={false}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BagSlider({
  variant = "full",
  defaultQty = 5,
  showMilestones = true,
  className = "",
}: BagSliderProps): React.ReactElement {
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
  /*  CTA label helpers                                                */
  /* ---------------------------------------------------------------- */

  function ctaLabel(): string {
    if (busy) return "Adding to cart\u2026";
    if (isAmazon) return `BUY ON AMAZON \u2014 ${money(total)}`;
    return `ADD TO CART \u2014 ${money(total)}`;
  }

  function compactCtaLabel(): string {
    if (busy) return "Adding\u2026";
    if (isAmazon) return `BUY ON AMAZON \u2014 ${money(total)}`;
    return `UPDATE CART \u2014 ${money(total)}`;
  }

  /* ---------------------------------------------------------------- */
  /*  STICKY variant — mobile bottom bar with dual CTAs                */
  /* ---------------------------------------------------------------- */
  if (variant === "sticky") {
    return (
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 bg-white/[0.97] backdrop-blur-[12px] border-t border-[rgba(15,27,45,0.1)] px-4 py-3 md:hidden ${className}`}
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-xl items-center gap-2">
          {/* Primary: Shopify CTA */}
          <button
            onClick={() => {
              if (!isAmazon) {
                handleCta();
              } else {
                // If currently in Amazon range, primary still goes to cart
                // but we override to the 5-pack default
                setQty(5);
                // handleCta will fire on next render via the button
              }
            }}
            disabled={busy}
            className={`flex-[1.2] py-3 bg-[#c7362c] text-white font-display text-sm tracking-[1px] uppercase rounded-xl text-center transition-all hover:-translate-y-px hover:bg-[#a82920] ${busy ? "opacity-60 pointer-events-none" : ""}`}
          >
            {busy ? "Adding\u2026" : `${qty} BAGS \u2014 ${money(total)}`}
          </button>

          {/* Secondary: Amazon CTA */}
          <a
            href={AMAZON_LISTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("bag_slider_sticky_amazon", { qty })}
            className="flex-1 py-3 bg-white border-2 border-[#1B2A4A] text-[#1B2A4A] font-display text-sm tracking-[1px] uppercase rounded-xl text-center transition-all hover:-translate-y-px hover:border-[#c7362c] hover:bg-[#f0ede6]"
          >
            AMAZON
          </a>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  COMPACT variant — cart upsell sidebar with premium card          */
  /* ---------------------------------------------------------------- */
  if (variant === "compact") {
    return (
      <div className={`rounded-2xl border-2 border-[rgba(15,27,45,0.1)] bg-white p-5 relative overflow-hidden ${className}`}>
        <GradientAccentBar />

        <div className="font-display text-xs font-bold uppercase tracking-[1px] text-[#1B2A4A]/60 mb-2">
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
          <span className="text-lg font-black text-[#1B2A4A] tabular-nums w-8 text-center">
            {qty}
          </span>
        </div>

        {/* Price summary */}
        <div className="mt-3 p-3.5 rounded-xl bg-[rgba(45,122,58,0.06)] border border-[rgba(45,122,58,0.2)]">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-[#1B2A4A]/70">
              {money(perBag)}/bag
              {hasSavings && (
                <span className="text-[#2D7A3A] font-semibold ml-1">
                  Save {money(savings)}
                </span>
              )}
            </span>
            <span className="font-bold text-[#1B2A4A] text-base">
              {money(total)}
            </span>
          </div>
        </div>

        {/* CTA */}
        {isAmazon ? (
          <a
            href={AMAZON_LISTING_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("bag_slider_compact_amazon", { qty, total })}
            className="mt-3 w-full py-4 px-6 bg-white border-2 border-[#1B2A4A] rounded-xl text-[#1B2A4A] font-display text-base tracking-[1px] uppercase flex items-center justify-center gap-2.5 transition-all hover:-translate-y-px hover:border-[#c7362c] hover:bg-[#f0ede6]"
          >
            {compactCtaLabel()}
          </a>
        ) : (
          <button
            onClick={handleCta}
            disabled={busy}
            className={`mt-3 w-full py-4 bg-[#c7362c] text-white font-display text-base tracking-[1px] text-center border-0 rounded-xl uppercase transition-all hover:-translate-y-px hover:bg-[#a82920] ${busy ? "opacity-60 pointer-events-none" : ""}`}
          >
            {compactCtaLabel()}
          </button>
        )}
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  FULL variant — primary purchase surface with premium card        */
  /* ---------------------------------------------------------------- */
  return (
    <div className={`relative overflow-hidden bg-white border-2 border-[rgba(199,54,44,0.2)] rounded-2xl p-5 pb-6 ${className}`}>
      <GradientAccentBar />

      {/* Quantity header */}
      <div className="flex items-center justify-between mb-1">
        <div className="font-display text-xs font-bold uppercase tracking-[1px] text-[#1B2A4A]/60">
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
          <span className="text-xl font-black text-[#1B2A4A] tabular-nums w-8 text-center">
            {qty}
          </span>
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

      {/* Bag stacking visualization */}
      <BagStack qty={qty} />

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

        {/* Milestone markers */}
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

      {/* Social proof */}
      <div className="mt-3 text-center">
        <span className="text-[#c7a062] text-sm">★★★★★</span>
        <span className="ml-1.5 text-xs text-[#1B2A4A]/60">
          4.8 from verified buyers
        </span>
      </div>

      {/* Price breakdown — trust box style */}
      <div className="mt-3 p-3.5 rounded-xl bg-[rgba(45,122,58,0.06)] border border-[rgba(45,122,58,0.2)]">
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-2xl font-black text-[#1B2A4A] tabular-nums">
              {money(total)}
            </span>
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

      {/* CTA Buttons — /go page style */}
      {isAmazon ? (
        <a
          href={AMAZON_LISTING_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("bag_slider_amazon", { qty, per_bag: perBag, total })}
          className="mt-3 w-full py-4 px-6 bg-white border-2 border-[#1B2A4A] rounded-xl text-[#1B2A4A] font-display text-lg tracking-[1px] uppercase flex items-center justify-center gap-2.5 transition-all hover:-translate-y-px hover:border-[#c7362c] hover:bg-[#f0ede6]"
        >
          {ctaLabel()}
        </a>
      ) : (
        <button
          onClick={handleCta}
          disabled={busy}
          className={`mt-3 w-full py-[18px] bg-[#c7362c] text-white font-display text-[22px] tracking-[1.5px] text-center border-0 rounded-xl uppercase transition-all hover:-translate-y-px hover:bg-[#a82920] ${busy ? "opacity-60 pointer-events-none" : ""}`}
        >
          {ctaLabel()}
        </button>
      )}

      {/* Channel explanation */}
      <div className="mt-2 text-center text-[10px] text-[#1B2A4A]/40">
        {isAmazon ? (
          <>Opens Amazon.com in a new tab &middot; Prime shipping available</>
        ) : (
          <>Ships direct from USA Gummies &middot; Free shipping on 5+ bags</>
        )}
      </div>

      {/* Trust & guarantee box */}
      <div className="mt-3 p-3.5 rounded-xl bg-[rgba(45,122,58,0.06)] border border-[rgba(45,122,58,0.2)]">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#2D7A3A]">
          <span>✓</span>
          <span>30-day money-back guarantee &bull; Ships within 24 hours</span>
        </div>
      </div>

      {/* Flavor strip */}
      <div className="mt-4 pt-3 border-t border-[rgba(27,42,74,0.06)]">
        <div className="font-display text-[10px] font-semibold uppercase tracking-wider text-[#1B2A4A]/50 mb-2">
          5 classic flavors in every bag
        </div>
        <div className="flex items-center gap-4">
          {FLAVOR_BEARS.map((f) => (
            <div key={f.name} className="flex flex-col items-center gap-1">
              <Image
                src={f.src}
                alt={`${f.name} gummy bear`}
                width={36}
                height={36}
                className="drop-shadow-sm"
              />
              <span className="text-[9px] font-medium text-[#1B2A4A]/60">
                {f.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
