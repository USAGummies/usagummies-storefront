"use client";

/**
 * CANONICAL / DO NOT MODIFY WITHOUT APPROVAL
 * -------------------------------------------------------------------------
 * This BundleQuickBuy module (UI, design language, copy, pricing presentation,
 * pill/tier mapping, savings framing, sticky CTA behavior) is the standard
 * USA Gummies conversion surface for homepage/shop/PDP/cart contexts.
 * Only bug fixes, accessibility fixes, or explicitly approved strategy changes
 * may alter structure, styling, or copy. Treat any stylistic/structural edits
 * as a breaking change requiring explicit approval.
 */
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import type { BundleTier } from "@/lib/bundles/getBundleVariants";
import { BASE_PRICE, FREE_SHIPPING_PHRASE, MIN_PER_BAG, pricingForQty } from "@/lib/bundles/pricing";
import { trackEvent } from "@/lib/analytics";
import { fireCartToast } from "@/lib/cartFeedback";
import { GummyIconRow } from "@/components/ui/GummyIcon";
import { useCartBagCount } from "@/hooks/useCartBagCount";
import { REVIEW_HIGHLIGHTS } from "@/data/reviewHighlights";
import { AmazonOneBagNote } from "@/components/ui/AmazonOneBagNote";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";

type TierKey = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12";

type Props = {
  tiers?: BundleTier[] | null;
  productHandle?: string | null;
  anchorId?: string;
  singleBagVariantId?: string | null;
  availableForSale?: boolean;
  variant?: "default" | "compact";
  featuredQuantities?: number[];
  tone?: "dark" | "light";
  showHowItWorks?: boolean;
  summaryCopy?: string;
  showTrainAccent?: boolean;
  showOtherQuantitiesLink?: boolean;
  otherQuantitiesLabel?: string;
  otherQuantities?: number[];
  surface?: "card" | "flat";
};

function money(amount?: number | null, currency = "USD") {
  if (!Number.isFinite(amount ?? NaN)) return null;
  const n = amount as number;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function storeCartId(cartId?: string | null) {
  if (!cartId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem("cartId", cartId);
  } catch {
    // ignore
  }
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

const FEATURED_QTYS: TierKey[] = ["1", "2", "3", "4", "5", "8", "12"];
const FEATURED_QTYS_COMPACT: TierKey[] = ["1", "2", "3", "4", "5", "8", "12"];
const SAVINGS_LADDER = [
  { qty: 4, label: "Savings start", caption: "4+ bags" },
  { qty: 5, label: "Free shipping", caption: "5+ bags" },
  { qty: 8, label: "Most popular", caption: "8 bags" },
  { qty: 12, label: "Best price", caption: "12 bags" },
];
const MISSION_TARGET_QTY = 8;
const MISSION_SOCIAL_PROOF = "87% of shoppers end at 8 bags.";

export default function BundleQuickBuy({
  tiers = [],
  productHandle: _productHandle,
  anchorId,
  singleBagVariantId,
  availableForSale = true,
  featuredQuantities,
  variant = "default",
  tone = "dark",
  showHowItWorks = true,
  summaryCopy,
  showTrainAccent = false,
  showOtherQuantitiesLink = false,
  otherQuantitiesLabel = "Need fewer bags?",
  otherQuantities,
  surface = "card",
}: Props) {
  const { bagCount } = useCartBagCount();
  const currentBags = Math.max(0, Number(bagCount) || 0);
  const currentPricing = currentBags > 0 ? pricingForQty(currentBags) : null;
  const currentTotal = currentPricing?.total ?? 0;
  const topMilestone = SAVINGS_LADDER[SAVINGS_LADDER.length - 1];
  const bestPriceReached = currentBags >= topMilestone.qty;
  const nextMilestone = bestPriceReached
    ? topMilestone
    : SAVINGS_LADDER.find((milestone) => currentBags < milestone.qty) || topMilestone;
  const missionRemaining = Math.max(0, MISSION_TARGET_QTY - currentBags);
  const missionProgressCount = Math.min(currentBags, topMilestone.qty);
  const missionProgressPct = Math.min(
    100,
    Math.round((missionProgressCount / topMilestone.qty) * 100)
  );
  const missionCtaLabel =
    missionRemaining > 0
      ? `Lock in savings now: add ${missionRemaining} bag${missionRemaining === 1 ? "" : "s"} (total ${MISSION_TARGET_QTY})`
      : `Savings locked at ${MISSION_TARGET_QTY} bags`;
  const mysteryBonusLine = bestPriceReached
    ? "Mystery extra revealed: Patriot Pride sticker (while supplies last)."
    : "Mystery extra unlocks at 12 bags.";
  const ctaRef = React.useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = React.useState<TierKey>("8");
  const [addingQty, setAddingQty] = React.useState<number | null>(null);
  const [lastAddedQty, setLastAddedQty] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [showOtherQuantities, setShowOtherQuantities] = React.useState(false);
  const isCompact = variant === "compact";
  const isLight = tone === "light";
  const isFlat = surface === "flat";

  const allTiers = React.useMemo(() => {
    const allowed = (tiers || []).filter((t) => {
      if (!t) return false;
      return Number.isFinite(t.quantity);
    });
    allowed.sort((a, b) => a.quantity - b.quantity);
    return allowed;
  }, [tiers]);

  const primaryTiers = React.useMemo(() => {
    const defaultKeys = isCompact ? FEATURED_QTYS_COMPACT : FEATURED_QTYS;
    const allowedKeys = (featuredQuantities?.length
      ? featuredQuantities.map((q) => String(q))
      : defaultKeys) as TierKey[];
    const allowedSet = new Set(allowedKeys);

    return allTiers.filter((t) => {
      const key = String(t.quantity) as TierKey;
      return allowedSet.has(key);
    });
  }, [allTiers, isCompact, featuredQuantities]);

  const expandedTiers = React.useMemo(() => {
    if (!showOtherQuantitiesLink || !showOtherQuantities) {
      return primaryTiers;
    }
    if (!otherQuantities?.length) {
      return allTiers;
    }
    const otherSet = new Set(otherQuantities.map((q) => String(q)));
    const combined = [...primaryTiers];
    allTiers.forEach((tier) => {
      const key = String(tier.quantity);
      if (otherSet.has(key) && !combined.some((t) => t.quantity === tier.quantity)) {
        combined.push(tier);
      }
    });
    combined.sort((a, b) => a.quantity - b.quantity);
    return combined;
  }, [allTiers, primaryTiers, showOtherQuantities, showOtherQuantitiesLink, otherQuantities]);

  React.useEffect(() => {
    const pool = expandedTiers;
    if (!pool.length) return;
    const selectedInPool = pool.some((t) => String(t.quantity) === selected);
    const preferred =
      pool.find((t) => t.quantity === 8) ||
      pool.find((t) => t.quantity === 5) ||
      pool[0];
    if (!selectedInPool && preferred) {
      setSelected(String(preferred.quantity) as TierKey);
    }
  }, [expandedTiers, selected]);

  const selectedTier =
    expandedTiers.find((t) => String(t.quantity) === selected) || expandedTiers[0] || null;
  const selectedTierState = selectedTier ? resolveTier(selectedTier) : null;
  const perBagCapText = money(MIN_PER_BAG, "USD");
  const reviewSnippets = REVIEW_HIGHLIGHTS.slice(0, 2);
  const summaryLine =
    summaryCopy === undefined
      ? currentBags > 0
        ? `In your cart: ${currentBags} bags. Add more to save. ${FREE_SHIPPING_PHRASE}.`
        : `${FREE_SHIPPING_PHRASE}. Most customers choose 8 bags.`
      : summaryCopy;
  const hasAdded = lastAddedQty !== null;
  const selectedAdded = Boolean(
    selectedTier && lastAddedQty !== null && selectedTier.quantity === lastAddedQty
  );

  function starLine(rating: number) {
    const full = Math.max(0, Math.min(5, Math.round(rating)));
    return "★".repeat(full).padEnd(5, "☆");
  }

  function scrollToCTA() {
    if (!ctaRef.current) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ctaRef.current.scrollIntoView({
      behavior: prefersReduced ? "auto" : "smooth",
      block: "center",
    });
  }

  function handleSelect(qty: number, canSelect = true) {
    if (!canSelect) return;
    trackEvent("bundle_select", {
      qty,
      variant,
      anchorId: anchorId || null,
    });
    setSelected(String(qty) as TierKey);
    setSuccess(false);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.requestAnimationFrame(scrollToCTA);
    }
  }

  function isTierPurchasable(tier?: BundleTier | null) {
    if (!tier) return false;
    if (availableForSale === false) return false;
    return Number.isFinite(tier.totalPrice ?? NaN) && tier.totalPrice !== null;
  }

  const ctaDisabled = !singleBagVariantId || !isTierPurchasable(selectedTier);
  const isAdding = addingQty !== null;

  const selectableTiers = React.useMemo(
    () =>
      expandedTiers.filter((tier) => {
        if (availableForSale === false) return false;
        return Number.isFinite(tier.totalPrice ?? NaN) && tier.totalPrice !== null;
      }),
    [expandedTiers, availableForSale]
  );

  function handleRadioKeyDown(
    event: React.KeyboardEvent<HTMLElement>,
    quantity: number,
    canSelect: boolean
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (canSelect) handleSelect(quantity, canSelect);
      return;
    }
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (!selectableTiers.length) return;
    const currentIndex = selectableTiers.findIndex((tier) => tier.quantity === quantity);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = Math.min(currentIndex + 1, selectableTiers.length - 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = selectableTiers.length - 1;
    }
    const nextTier = selectableTiers[nextIndex];
    if (nextTier) {
      handleSelect(nextTier.quantity, true);
    }
  }

  React.useEffect(() => {
    if (!success) return;
    const t = window.setTimeout(() => setSuccess(false), 2200);
    return () => window.clearTimeout(t);
  }, [success]);

  async function addToCart(
    targetQty?: number,
    source: "cta" | "tile" | "mission" = "cta"
  ) {
    const qty = Math.max(1, Number(targetQty ?? selectedTier?.quantity ?? 0) || 0);
    const targetTier = expandedTiers.find((tier) => tier.quantity === qty) || selectedTier;
    if (!singleBagVariantId || !isTierPurchasable(targetTier) || !qty) {
      setError(availableForSale === false ? "Out of stock" : "Select a bag count to continue.");
      return;
    }
    if (expandedTiers.some((tier) => tier.quantity === qty)) {
      setSelected(String(qty) as TierKey);
    }
    trackEvent("bundle_add_to_cart", {
      qty,
      variant,
      anchorId: anchorId || null,
      source,
    });
    setAddingQty(qty);
    setError(null);
    setSuccess(false);
    try {
      const storedCartId = getStoredCartId();
      if (storedCartId && typeof document !== "undefined") {
        document.cookie = `cartId=${storedCartId}; path=/; samesite=lax`;
      }
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          variantId: singleBagVariantId,
          merchandiseId: singleBagVariantId,
          quantity: qty,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Could not add to cart.");
      }
      if (json?.cart?.id) storeCartId(json.cart.id);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart:updated"));
      }
      fireCartToast(qty);
      setLastAddedQty(qty);
      setSuccess(true);
    } catch (e: any) {
      setError(e?.message || "Could not add to cart.");
    } finally {
      setAddingQty(null);
    }
  }

  function resolveTier(tier: BundleTier) {
    const nextBags = currentBags + tier.quantity;
    const pricing = pricingForQty(nextBags);
    const nextTotal = Number.isFinite(pricing.total) ? pricing.total : null;
    const addTotal = Math.max(0, (nextTotal ?? 0) - currentTotal);
    const perBag = Number.isFinite(pricing.perBag) ? pricing.perBag : null;
    const savings = nextTotal ? Math.max(0, BASE_PRICE * nextBags - nextTotal) : null;
    return { nextBags, nextTotal, addTotal, perBag, savings };
  }

  function renderRow(tier: BundleTier) {
    const isActive = String(tier.quantity) === selected;
    const tierState = resolveTier(tier);
    const displayTotal = tierState.nextTotal ? money(tierState.nextTotal, "USD") : null;
    const displayAdd = tierState.nextTotal ? money(tierState.addTotal, "USD") : null;
    const displayPerBag =
      tierState.perBag && Number.isFinite(tierState.perBag)
        ? `~${money(tierState.perBag, "USD")} / bag`
        : null;
    const unavailable = availableForSale === false || !displayTotal;
    const savingsValue =
      tierState.savings && Number.isFinite(tierState.savings) && tierState.savings > 0
        ? tierState.savings
        : null;

    if (isCompact) {
      const nextBags = tierState.nextBags;
      const isOne = nextBags === 1;
      const isFour = nextBags === 4;
      const isFive = nextBags === 5;
      const isEight = nextBags === 8;
      const isTwelve = nextBags === 12;
      const canSelect = !unavailable;
      const isAdded = lastAddedQty === tier.quantity;
      const isAddingThis = addingQty === tier.quantity;
      const totalLabel = Number.isFinite(nextBags ?? NaN)
        ? ` (total ${nextBags})`
        : "";
      const tileCtaLabel = isAddingThis
        ? "Locking in..."
        : isAdded
          ? `Savings locked${totalLabel}`
          : `Lock in savings now${totalLabel}`;
      const showFreeShipping = nextBags >= 5;
      const label =
        isEight
          ? "Most popular"
          : isFive
            ? "Free shipping"
            : isTwelve
              ? "Bulk savings"
              : isFour
                ? "Starter savings"
                : isOne
                  ? "Trial size"
                  : "";
      const hasLabel = Boolean(label);
      return (
        <div
          key={tier.quantity}
          role="radio"
          aria-checked={isActive}
          aria-disabled={!canSelect}
          tabIndex={isActive && canSelect ? 0 : -1}
          onClick={() => handleSelect(tier.quantity, canSelect)}
          onKeyDown={(event) => handleRadioKeyDown(event, tier.quantity, canSelect)}
          className={[
            "relative w-full snap-start border-2 px-4 py-4 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 ease-out",
            "rounded-[12px] min-h-[190px] sm:min-h-[200px] w-full sm:max-w-[280px] sm:justify-self-center",
            isLight
              ? "bg-white text-[var(--text)] border-[rgba(15,27,45,0.14)] shadow-[0_10px_22px_rgba(15,27,45,0.08)]"
              : "bg-[linear-gradient(180deg,rgba(10,16,30,0.96),rgba(8,12,24,0.92))] text-white border-white/15 shadow-[0_12px_24px_rgba(7,12,20,0.45)]",
            isActive
              ? isLight
                ? "border-[var(--candy-red)] bg-[rgba(239,59,59,0.1)] shadow-[0_18px_38px_rgba(239,59,59,0.2)] ring-2 ring-[rgba(239,59,59,0.2)]"
                : "border-[rgba(199,160,98,0.7)] bg-white/[0.08] shadow-[0_18px_38px_rgba(7,12,20,0.6)] ring-2 ring-[rgba(199,160,98,0.28)]"
              : isLight
                ? "hover:border-[rgba(239,59,59,0.3)] hover:bg-[rgba(239,59,59,0.04)]"
                : "hover:border-[rgba(199,160,98,0.4)] hover:bg-white/[0.04]",
            isEight ? "scale-[1.03] sm:scale-[1.04] z-10 sm:max-w-[300px]" : "",
            isLight
              ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(239,59,59,0.35)]"
              : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(199,160,98,0.45)]",
            unavailable ? "opacity-60 cursor-not-allowed" : "active:scale-[0.98]",
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-2">
            <div className={isLight ? "text-[17px] font-semibold text-[var(--text)]" : "text-[17px] font-semibold text-white"}>
              +{tier.quantity} bags
            </div>
            {label ? (
              <span
                className={[
                  "rounded-full px-2 py-1 text-[12px] font-medium",
                  isLight
                    ? "border border-[rgba(239,59,59,0.25)] bg-[rgba(239,59,59,0.12)] text-[var(--candy-red)]"
                    : "border border-white/20 bg-[rgba(199,54,44,0.22)] text-white/90",
                ].join(" ")}
              >
                {label}
              </span>
            ) : (
              <span
                className={[
                  "rounded-full px-2 py-1 text-[12px] font-medium invisible",
                  isLight
                    ? "border border-[rgba(239,59,59,0.25)] bg-[rgba(239,59,59,0.12)] text-[var(--candy-red)]"
                    : "border border-white/20 bg-[rgba(199,54,44,0.22)] text-white/90",
                ].join(" ")}
              >
                {hasLabel ? label : "Label"}
              </span>
            )}
          </div>

          <div className="mt-1.5 flex items-baseline justify-between gap-2 sm:flex-col sm:items-start sm:gap-1.5">
            <div className={isLight ? "text-[32px] font-bold leading-[1.05] text-[var(--text)]" : "text-[32px] font-bold leading-[1.05] text-white"}>
              {displayAdd ? `+${displayAdd}` : "—"}
            </div>
            <div className={isLight ? "text-[12px] font-medium text-[var(--muted)]" : "text-[12px] font-medium text-white/65"}>
              {displayTotal ? `New total: ${displayTotal}` : "Standard price"}
              {displayPerBag ? ` - ${displayPerBag}` : ""}
            </div>
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium">
            <div className={isLight ? "text-[var(--candy-red)]" : "text-[var(--gold)]"}>
              {savingsValue ? `Save ${money(savingsValue, "USD")} total` : <span className="invisible">Save</span>}
            </div>
            <div className={isLight ? "text-[var(--muted)]" : "text-white/60"}>
              {showFreeShipping ? "Free shipping" : <span className="invisible">Free shipping</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              addToCart(tier.quantity, "tile");
            }}
            disabled={unavailable || isAdding}
            className={[
              "mt-2 inline-flex w-full items-center justify-center rounded-full border px-3 py-1 text-[10.5px] font-semibold tracking-tight transition",
              isLight
                ? "border-[rgba(15,27,45,0.16)] bg-white text-[var(--text)] hover:border-[rgba(15,27,45,0.28)] hover:bg-[rgba(239,59,59,0.08)]"
                : "border-white/20 bg-white/10 text-white/90 hover:border-white/40 hover:bg-white/15",
              isAdded
                ? isLight
                  ? "border-[rgba(34,197,94,0.55)] bg-[rgba(34,197,94,0.12)] text-[var(--candy-green)]"
                  : "border-[rgba(125,210,150,0.55)] bg-[rgba(125,210,150,0.2)] text-white"
                : hasAdded
                  ? isLight
                    ? "border-[rgba(239,59,59,0.35)] bg-[rgba(239,59,59,0.08)] text-[var(--candy-red)]"
                    : "border-[rgba(199,160,98,0.5)] bg-[rgba(199,160,98,0.18)] text-white"
                  : "",
              (unavailable || isAdding) ? "opacity-60 cursor-not-allowed" : "",
            ].join(" ")}
          >
            {tileCtaLabel}
          </button>
        </div>
      );
    }

    const nextBags = tierState.nextBags;
    const isFive = nextBags === 5;
    const isEight = nextBags === 8;
    const isTwelve = nextBags === 12;
    const isSmall = nextBags < 5;

    const label = isEight
      ? "Most popular"
      : isFive
        ? "Free shipping"
        : isTwelve
          ? "Lowest per-bag"
          : nextBags === 4
            ? "Starter savings"
            : nextBags === 1
              ? "Trial size"
              : isSmall
                ? "Standard price"
                : "Savings";

    const pills: string[] = [];
    if (isFive) {
      pills.push(FREE_SHIPPING_PHRASE);
    } else if (isEight) {
      pills.push("Most popular");
      pills.push(FREE_SHIPPING_PHRASE);
    } else if (isTwelve) {
      pills.push("Best price per bag");
      pills.push(FREE_SHIPPING_PHRASE);
    } else if (nextBags === 4) {
      pills.push("Starter savings");
    } else if (nextBags === 1) {
      pills.push("Trial size");
    } else if (isSmall) {
      pills.push("Standard price");
    }

    const cardTone = isEight ? "bg-white/[0.15]" : "bg-white/[0.04]";
    const cardBorder = isEight
      ? "ring-1 ring-[rgba(212,167,75,0.82)] border-[rgba(212,167,75,0.6)] shadow-[0_26px_62px_rgba(0,0,0,0.38)]"
      : "border-[rgba(212,167,75,0.16)]";

    const canSelect = !unavailable;
    const isAdded = lastAddedQty === tier.quantity;
    const isAddingThis = addingQty === tier.quantity;
    const totalLabel = Number.isFinite(nextBags ?? NaN)
      ? ` (total ${nextBags})`
      : "";
    const tileCtaLabel = isAddingThis
      ? "Locking in..."
      : isAdded
        ? `Savings locked${totalLabel}`
        : `Lock in savings now${totalLabel}`;

    return (
      <div
        key={tier.quantity}
        role="radio"
        aria-checked={isActive}
        aria-disabled={!canSelect}
        tabIndex={isActive && canSelect ? 0 : -1}
        onClick={() => handleSelect(tier.quantity, canSelect)}
        onKeyDown={(event) => handleRadioKeyDown(event, tier.quantity, canSelect)}
        className={[
          "bundleTierBtn",
          "min-w-[220px] w-[220px] sm:min-w-[240px] sm:w-[240px] min-h-[210px] sm:min-h-[220px] snap-start transition-transform",
          cardTone,
          isActive
            ? "bundleTierBtn--active ring-1 ring-[rgba(212,167,75,0.8)] shadow-[0_18px_46px_rgba(0,0,0,0.32)]"
            : "bundleTierBtn--highlight",
          isEight
            ? "bundleTierBtn--primary scale-[1.03] sm:scale-[1.04] z-10 min-w-[240px] w-[240px] sm:min-w-[260px] sm:w-[260px]"
            : "",
          cardBorder,
          unavailable ? "opacity-60 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <div className="relative">
          {isEight ? (
            <>
              <span className="absolute left-0 top-3 bottom-3 w-[4px] rounded-full bg-gradient-to-b from-[#d6403a] via-[var(--gold, #d4a74b)] to-[#0a3c8a] opacity-90" />
              <span className="absolute -top-2 left-3 inline-flex items-center rounded-b-xl rounded-tr-xl bg-[linear-gradient(135deg,rgba(212,167,75,0.96),rgba(214,64,58,0.82))] px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.24em] text-[#0c1426] uppercase shadow-[0_8px_18px_rgba(0,0,0,0.3)]">
                Most popular
              </span>
            </>
          ) : null}
          <div
            className={[
              "bundleTierBtn__inner",
              isEight ? "pt-[22px] pb-4 pl-4" : "pt-4 pb-3.5 pl-4",
              isEight ? "bg-white/[0.035] rounded-2xl" : "",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-white font-extrabold leading-none whitespace-nowrap text-lg">
                  +{tier.quantity} bags
                </div>
                <div className="text-xs text-white/70">
                  New total: {nextBags} bags - {label}
                </div>
                {savingsValue ? (
                  <div
                    className={[
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      "bg-[rgba(212,167,75,0.14)] border border-[rgba(212,167,75,0.35)] text-[var(--gold)]",
                      isEight ? "shadow-[0_10px_28px_rgba(212,167,75,0.25)]" : "shadow-[0_6px_18px_rgba(212,167,75,0.18)]",
                    ].join(" ")}
                    title="Savings vs the 5-bag baseline"
                  >
                    <span aria-hidden="true">★</span>
                    <span className="leading-none font-extrabold">
                      Save {money(savingsValue, "USD")} total
                    </span>
                    <span className="text-[10px] text-white/65 whitespace-nowrap">(vs single bags)</span>
                  </div>
                ) : null}
                {unavailable ? (
                  <div className="text-[11px] text-red-200 font-semibold">Temporarily unavailable</div>
                ) : null}
              </div>
              <div className="relative text-right">
                {isEight ? (
                  <span className="pointer-events-none absolute -inset-3 rounded-[18px] bg-[radial-gradient(circle_at_65%_20%,rgba(212,167,75,0.26),transparent_58%)] opacity-95" />
                ) : null}
                <div className="relative text-white text-xl font-extrabold leading-none drop-shadow-[0_6px_18px_rgba(0,0,0,0.35)] transition-all duration-300">
                  {displayAdd ? `+${displayAdd}` : "—"}
                </div>
                {displayTotal ? (
                  <div className="relative mt-1 text-[11px] text-white/65 transition-all duration-300">
                    Total after add: {displayTotal}
                  </div>
                ) : null}
                {displayPerBag ? (
                  <div className="relative mt-1 text-[11px] text-white/65 transition-all duration-300">
                    {displayPerBag}
                  </div>
                ) : null}
                {isEight ? (
                  <div className="relative mt-1 text-[10px] font-semibold text-[var(--gold)]/90">
                    Best balance of value + convenience
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {pills.slice(0, 2).map((p) => (
                <span
                  key={p}
                  className="bundlePill px-2.25 py-1 text-[10.5px] font-semibold tracking-tight bg-white/16 border-[rgba(255,255,255,0.32)] text-white/90 shadow-[0_4px_10px_rgba(0,0,0,0.16)]"
                >
                  {p}
                </span>
              ))}
            </div>
            <div className="mt-3 flex">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  addToCart(tier.quantity, "tile");
                }}
                disabled={unavailable || isAdding}
                className={[
                  "bundleTierBtn__cta",
                  isAdded ? "bundleTierBtn__cta--added" : hasAdded ? "bundleTierBtn__cta--upgrade" : "",
                ].join(" ")}
              >
                {tileCtaLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!expandedTiers.length) {
    return (
      <section
        id={anchorId}
        className={[
          isFlat ? "border-0 bg-transparent p-0" : "rounded-3xl border p-4 sm:p-5",
          isCompact
            ? isLight
              ? "text-[var(--muted)]"
              : "text-white/70"
            : isLight
              ? "text-[var(--muted)]"
              : "text-white/70",
        ].join(" ")}
      >
        <div
          className={[
            "text-[11px] tracking-[0.2em] font-semibold uppercase",
            isCompact ? (isLight ? "text-[var(--muted)]" : "text-white/60") : isLight ? "text-[var(--muted)]" : "text-white/60",
          ].join(" ")}
        >
          Savings pricing
        </div>
        <div className="mt-2 text-sm">
          Savings pricing is temporarily unavailable right now. Please try again or view product details.
        </div>
        <Link
          href="/shop#product-details"
          className="mt-3 inline-flex items-center justify-center rounded-full bg-[#d6403a] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_30px_rgba(214,64,58,0.35)] hover:brightness-110 active:brightness-95"
        >
          View product details
        </Link>
      </section>
    );
  }

  return (
    <section
      id={anchorId}
      aria-label="Savings pricing"
      className={[
        "relative overflow-hidden",
        isFlat ? "w-full" : "mx-auto rounded-3xl border p-4 sm:p-5",
        isCompact ? "w-full" : isFlat ? "w-full" : "max-w-3xl",
        isFlat
          ? isLight
            ? "bg-transparent text-[var(--text)]"
            : "bg-transparent text-white"
          : isCompact
            ? isLight
              ? "border-[rgba(15,27,45,0.12)] bg-white text-[var(--text)] shadow-[0_20px_44px_rgba(15,27,45,0.12)]"
              : "border-white/15 bg-[rgba(10,16,30,0.92)] text-white shadow-[0_24px_60px_rgba(7,12,20,0.45)]"
            : isLight
              ? "border-[rgba(15,27,45,0.12)] bg-white text-[var(--text)] shadow-[0_30px_90px_rgba(15,27,45,0.12)] pb-16 sm:pb-12"
              : "border-white/10 bg-white/[0.06] shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl pb-16 sm:pb-12",
      ].join(" ")}
    >
      {isCompact || isFlat ? null : (
        <div className="pointer-events-none absolute inset-0 opacity-12 bg-[radial-gradient(circle_at_10%_16%,rgba(255,255,255,0.22),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(10,60,138,0.3),transparent_44%),linear-gradient(135deg,rgba(214,64,58,0.18),rgba(12,20,38,0.38)),repeating-linear-gradient(135deg,rgba(255,255,255,0.07)_0,rgba(255,255,255,0.07)_8px,transparent_8px,transparent_16px)]" />
      )}
      {isCompact || isFlat ? null : (
        <div className="relative mb-3 h-[2px] rounded-full bg-gradient-to-r from-[#d6403a]/70 via-white/60 to-[#0a3c8a]/65 opacity-85 shadow-[0_0_18px_rgba(255,255,255,0.12)]" />
      )}
      <div
        className={[
          "relative text-[10px] font-semibold tracking-[0.26em] uppercase flex items-center gap-2",
          isCompact ? (isLight ? "text-[var(--muted)]" : "text-white/70") : isLight ? "text-[var(--muted)]" : "text-white/75",
        ].join(" ")}
      >
        <span aria-hidden="true">🇺🇸</span>
        <span>American-made savings pricing</span>
      </div>
      <div className="relative mt-1 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 space-y-1.5">
          <div
            className={[
              "font-extrabold flex items-center gap-2 flex-wrap",
              isCompact ? (isLight ? "text-2xl text-[var(--text)]" : "text-2xl text-white") : isLight ? "text-2xl text-[var(--text)]" : "text-2xl text-white",
            ].join(" ")}
          >
            <span>Lock in your savings</span>
            <GummyIconRow size={14} className={isLight ? "opacity-80" : "opacity-90"} />
          </div>
          <div
            className={[
              "text-xs font-semibold",
              isCompact ? (isLight ? "text-[var(--muted)]" : "text-white/70") : isLight ? "text-[var(--muted)]" : "text-white/75",
            ].join(" ")}
          >
            Add more bags and watch your per-bag price drop. Savings apply to your total bag count.
          </div>
      {summaryLine ? (
        <p
          className={[
            "text-sm max-w-[52ch]",
            isCompact ? (isLight ? "text-[var(--muted)]" : "text-white/65") : isLight ? "text-[var(--muted)]" : "text-white/70",
          ].join(" ")}
        >
          {summaryLine}
        </p>
      ) : null}
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            {SAVINGS_LADDER.map((milestone) => {
              const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
              const isBest = bestPriceReached && milestone.qty === topMilestone.qty;
              const isReached = currentBags >= milestone.qty;
              const isPopularComplete =
                milestone.qty === MISSION_TARGET_QTY && currentBags >= milestone.qty;
              return (
                <div
                  key={milestone.qty}
                  className={[
                    isFlat ? "px-0 py-1 text-[11px] font-semibold" : "rounded-2xl border px-2.5 py-2 text-[11px] font-semibold",
                    isFlat
                      ? isLight
                        ? "text-[var(--text)]"
                        : "text-white/85"
                      : isLight
                        ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] text-[var(--text)]"
                        : "border-white/10 bg-white/5 text-white/85",
                    !isFlat && (isNext || isBest)
                      ? isLight
                        ? "border-[rgba(239,59,59,0.45)] bg-[rgba(239,59,59,0.08)]"
                        : "border-[rgba(248,212,79,0.5)] bg-[rgba(248,212,79,0.08)]"
                      : "",
                    isReached && !(isNext || isBest) && (isLight ? "opacity-90" : "opacity-80"),
                  ].join(" ")}
                >
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    {milestone.label}
                  </div>
                  <div className={isLight ? "text-[var(--text)]" : "text-white"}>
                    {milestone.caption}
                  </div>
                  {isNext ? (
                    <div
                      className={[
                        "text-[10px] font-semibold",
                        isLight ? "text-[var(--candy-red)]" : "text-[var(--gold)]",
                      ].join(" ")}
                    >
                      Next up
                    </div>
                  ) : isBest ? (
                    <div
                      className={[
                        "text-[10px] font-semibold",
                        isLight ? "text-[var(--candy-red)]" : "text-[var(--gold)]",
                      ].join(" ")}
                    >
                      Best price applied
                    </div>
                  ) : isPopularComplete ? (
                    <div
                      className={[
                        "text-[10px] font-semibold",
                        isLight ? "text-[var(--candy-red)]" : "text-[var(--gold)]",
                      ].join(" ")}
                    >
                      Most popular mission complete
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div
            className={[
              "mt-2 text-[11px] font-semibold",
              isLight ? "text-[var(--muted)]" : "text-white/70",
            ].join(" ")}
          >
            {MISSION_SOCIAL_PROOF}
          </div>
          <div
            className={[
              isFlat ? "mt-3 pt-1 text-xs" : "mt-3 rounded-2xl border px-3 py-3 text-xs",
              isFlat
                ? isLight
                  ? "text-[var(--muted)]"
                  : "text-white/70"
                : isLight
                  ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] text-[var(--muted)]"
                  : "border-white/12 bg-white/5 text-white/70",
            ].join(" ")}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em]">
              Mission to savings
            </div>
            <div
              className={[
                "mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold",
                isLight ? "text-[var(--text)]" : "text-white/85",
              ].join(" ")}
            >
              <span>Hit 8 bags to unlock the crowd-favorite price.</span>
              <span>
                Progress: {missionProgressCount}/{topMilestone.qty} bags
              </span>
            </div>
            <div className="mt-2 mission-bar" aria-hidden="true">
              <div className="mission-bar__fill" style={{ width: `${missionProgressPct}%` }} />
              {SAVINGS_LADDER.map((milestone) => {
                const left = (milestone.qty / topMilestone.qty) * 100;
                const reached = currentBags >= milestone.qty;
                const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
                return (
                  <span
                    key={milestone.qty}
                    className={[
                      "mission-bar__tick",
                      reached ? "mission-bar__tick--reached" : "",
                      isNext ? "mission-bar__tick--next" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ left: `${left}%` }}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold">
              {[
                { qty: 4, label: "Savings unlocked" },
                { qty: 5, label: "Free shipping unlocked" },
                { qty: 8, label: "Crowd favorite unlocked" },
                {
                  qty: 12,
                  label: bestPriceReached ? "Mystery extra revealed" : "Mystery extra unlocks",
                },
              ].map((badge) => {
                const unlocked = currentBags >= badge.qty;
                return (
                  <span
                    key={badge.qty}
                    className={[
                      isFlat ? "inline-flex items-center px-2 py-1" : "inline-flex items-center rounded-full border px-2 py-1",
                      isFlat
                        ? unlocked
                          ? isLight
                            ? "text-[var(--candy-red)]"
                            : "text-[var(--gold)]"
                          : isLight
                            ? "text-[var(--muted)]"
                            : "text-white/60"
                        : unlocked
                          ? isLight
                            ? "border-[rgba(239,59,59,0.35)] bg-[rgba(239,59,59,0.12)] text-[var(--candy-red)]"
                            : "border-[rgba(248,212,79,0.5)] bg-[rgba(248,212,79,0.12)] text-[var(--gold)]"
                          : isLight
                            ? "border-[rgba(15,27,45,0.12)] bg-white text-[var(--muted)]"
                            : "border-white/10 bg-white/5 text-white/60",
                    ].join(" ")}
                  >
                    {badge.label}
                  </span>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {missionRemaining > 0 ? (
                <button
                  type="button"
                  onClick={() => addToCart(missionRemaining, "mission")}
                  disabled={addingQty !== null || !singleBagVariantId}
                  className="btn btn-candy pressable"
                >
                  {addingQty ? "Locking in..." : missionCtaLabel}
                </button>
              ) : (
                <span
                  className={
                    isFlat
                      ? "inline-flex text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--candy-red)]"
                      : "inline-flex rounded-full border border-[rgba(239,59,59,0.35)] bg-[rgba(239,59,59,0.12)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--candy-red)]"
                  }
                >
                  {missionCtaLabel}
                </span>
              )}
            </div>
            <div className="mt-2 text-[11px] font-semibold">
              {mysteryBonusLine}
            </div>
          </div>
        </div>
        {showTrainAccent ? (
          <Image
            src="/website%20assets/B17Bomber.png"
            alt=""
            aria-hidden="true"
            width={1405}
            height={954}
            sizes="(max-width: 640px) 110vw, 860px"
            className="h-[190px] w-auto shrink-0 object-contain sm:ml-auto sm:h-[218px] lg:h-[236px]"
          />
        ) : null}
      </div>
      {showHowItWorks ? (
        <div
          className={[
            isFlat ? "relative mt-3 text-xs" : "relative mt-3 rounded-2xl border px-3 py-2 text-xs",
            isFlat
              ? isLight
                ? "text-[var(--muted)]"
                : "text-white/75"
              : isCompact
                ? isLight
                  ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] text-[var(--muted)]"
                  : "border-white/12 bg-white/5 text-white/70"
                : isLight
                  ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] text-[var(--muted)]"
                  : "border-white/10 bg-white/5 text-white/75",
          ].join(" ")}
        >
          <div className="text-[11px] font-semibold">
            How pricing works: selections add bags, never replace your cart.
          </div>
          <details className="mt-2">
            <summary
              className={[
                "cursor-pointer text-[11px] font-semibold",
                isLight ? "text-[var(--text)]" : "text-white/90",
              ].join(" ")}
            >
              Learn more
            </summary>
            <div className="mt-1 text-[11px]">
              Savings start at 4 bags, free shipping unlocks at 5 bags, and per-bag pricing caps at {perBagCapText} after 12+ bags.{" "}
              <Link href="/faq" className="underline underline-offset-2">
                Read the FAQ
              </Link>
              .
            </div>
          </details>
        </div>
      ) : null}
      <div
        className={
          isFlat
            ? isLight
              ? "mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[var(--muted)]"
              : "mt-2 flex flex-wrap items-center gap-3 text-[10px] text-white/70"
            : isLight
              ? "mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)]"
              : "mt-2 flex flex-wrap items-center gap-2 text-[10px] text-white/70"
        }
      >
        <span
          className={
            isFlat
              ? "inline-flex items-center gap-1.5"
              : isLight
                ? "inline-flex items-center gap-1.5 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2.5 py-1"
                : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"
          }
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 2 19 5v6c0 5-3.5 9.4-7 11-3.5-1.6-7-6-7-11V5l7-3z"
            />
          </svg>
          Love it or your money back
        </span>
        <span
          className={
            isFlat
              ? "inline-flex items-center gap-1.5"
              : isLight
                ? "inline-flex items-center gap-1.5 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2.5 py-1"
                : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"
          }
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M3 6h10v7H3V6zm10 2h4l3 3v2h-7V8zm-8 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm11 0a2 2 0 1 0 .001 4A2 2 0 0 0 16 17z"
            />
          </svg>
          Ships within 24 hours
        </span>
        <span
          className={
            isFlat
              ? "inline-flex items-center gap-1.5"
              : isLight
                ? "inline-flex items-center gap-1.5 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2.5 py-1"
                : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"
          }
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 1 0-8 0v2z"
            />
          </svg>
          Secure checkout
        </span>
      </div>
      {isCompact ? null : (
        <div className="relative mt-2 text-xs text-white/75 font-semibold">
          ★★★★★ Rated by verified buyers
          <span className="ml-2 text-white/45" title="Ratings pulled from verified buyers only">
            ⓘ
          </span>
        </div>
      )}

      <div className="relative mt-3">
        {isCompact ? (
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4"
            role="radiogroup"
            aria-label="Bag count"
          >
            {expandedTiers.map((tier) => renderRow(tier))}
          </div>
        ) : (
          <>
            <div
              className={[
                "pointer-events-none absolute left-0 top-0 h-full w-10",
                "bg-[linear-gradient(90deg,rgba(12,20,38,0.9),transparent)]",
              ].join(" ")}
            />
            <div
              className={[
                "pointer-events-none absolute right-0 top-0 h-full w-10",
                "bg-[linear-gradient(270deg,rgba(12,20,38,0.9),transparent)]",
              ].join(" ")}
            />
            <div className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2 pr-4 bundle-slider">
              {expandedTiers.map((tier) => renderRow(tier))}
            </div>
          </>
        )}
      </div>
      {showOtherQuantitiesLink && !showOtherQuantities ? (
        <button
          type="button"
          onClick={() => setShowOtherQuantities(true)}
          className={[
            "mt-2 text-[11px] font-medium underline underline-offset-2 decoration-transparent hover:decoration-current",
            isLight ? "text-[var(--muted)]/80 hover:text-[var(--text)]" : "text-white/60 hover:text-white",
          ].join(" ")}
        >
          {otherQuantitiesLabel}
        </button>
      ) : null}

      <div
        className={[
          isFlat ? "mt-5 pt-4 border-t border-[rgba(15,27,45,0.12)]" : "mt-5 rounded-2xl border p-3 sm:p-3.5",
          isFlat
            ? isLight
              ? "bg-transparent"
              : "border-white/12 bg-transparent"
            : isCompact
              ? isLight
                ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]"
                : "border-white/15 bg-[rgba(12,18,32,0.92)]"
              : isLight
                ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] sticky bottom-3 md:static backdrop-blur-sm"
                : "border-white/12 bg-white/[0.07] sticky bottom-3 md:static backdrop-blur-sm",
          !isCompact && (isFlat ? "sticky bottom-3 md:static" : ""),
        ].join(" ")}
        ref={ctaRef}
      >
        {selectedTier ? (
          isCompact ? (
            <div className="space-y-1">
              <div className={isLight ? "text-[14px] font-medium text-[var(--muted)]" : "text-[14px] font-medium text-white/80"}>
                {selectedAdded ? "Savings locked" : "Lock in savings now"} +{selectedTier.quantity} bags
              </div>
              <div
                key={`${selectedTier.quantity}-${selectedTierState?.addTotal}`}
                className={isLight ? "text-[24px] font-bold text-[var(--text)]" : "text-[24px] font-bold text-white"}
              >
                {Number.isFinite(selectedTierState?.addTotal ?? NaN)
                  ? `+${money(selectedTierState?.addTotal, "USD")}`
                  : "—"}
              </div>
              {Number.isFinite(selectedTierState?.nextTotal ?? NaN) ? (
                <div className={isLight ? "text-[12px] text-[var(--muted)]" : "text-[12px] text-white/70"}>
                  New total: {selectedTierState?.nextBags} bags - {money(selectedTierState?.nextTotal, "USD")}
                </div>
              ) : null}
            </div>
          ) : (
            <div
              className={[
                "flex items-center justify-between gap-3",
                isFlat
                  ? isLight
                    ? "border-b border-[rgba(15,27,45,0.12)] pb-2 mb-2"
                    : "border-b border-white/12 pb-2 mb-2"
                  : "border-b border-white/12 pb-2 mb-2",
              ].join(" ")}
            >
              <div
                className={
                  isLight
                    ? "text-sm font-semibold text-[var(--text)]"
                    : "text-sm font-semibold text-white/90"
                }
              >
                {selectedAdded ? "Savings locked" : "Lock in savings now"} +{selectedTier.quantity} bags
                <span
                  className={
                    isLight
                      ? "font-extrabold text-[var(--text)]"
                      : "font-extrabold text-white"
                  }
                >
                  {selectedTierState ? ` (new total: ${selectedTierState.nextBags} bags)` : ""}
                </span>
              </div>
              <div
                className={
                  isLight
                    ? "text-right text-xs text-[var(--muted)]"
                    : "text-right text-xs text-white/60"
                }
              >
                <div
                  key={`${selectedTier.quantity}-${selectedTierState?.addTotal}`}
                  className={
                    isLight
                      ? "text-[12px] font-semibold text-[var(--muted)] transition-all duration-300 price-pop"
                      : "text-[12px] font-semibold text-white/80 transition-all duration-300 price-pop"
                  }
                >
                  {Number.isFinite(selectedTierState?.addTotal ?? NaN)
                    ? `+${money(selectedTierState?.addTotal, "USD")}`
                    : "—"}
                </div>
                {Number.isFinite(selectedTierState?.nextTotal ?? NaN) ? (
                  <div
                    key={`${selectedTier.quantity}-${selectedTierState?.nextTotal ?? "na"}`}
                    className="price-pop"
                  >
                    {`Total after add: ${money(selectedTierState?.nextTotal, "USD")}`}
                  </div>
                ) : null}
                {Number.isFinite(selectedTierState?.perBag ?? NaN) ? (
                  <div
                    key={`${selectedTier.quantity}-${selectedTierState?.perBag ?? "na"}`}
                    className="price-pop"
                  >
                    {`~${money(selectedTierState?.perBag, "USD")} / bag`}
                  </div>
                ) : null}
              </div>
            </div>
          )
        ) : null}

        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            className={[
              "w-full inline-flex items-center justify-center rounded-[12px] h-[54px] px-4 sm:px-5 text-[16px] sm:text-[17px] font-semibold whitespace-nowrap shadow-[0_14px_36px_rgba(214,64,58,0.28)] hover:brightness-110 active:brightness-95 disabled:opacity-60 disabled:cursor-not-allowed leading-tight relative overflow-hidden",
              isLight
                ? "bg-[var(--candy-red)] text-white shadow-[0_16px_36px_rgba(239,59,59,0.32)]"
                : isCompact
                  ? "bg-[var(--red)] text-white"
                  : "bg-[#d6403a] text-white",
            ].join(" ")}
            onClick={() => addToCart()}
            disabled={isAdding || ctaDisabled}
          >
            <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),transparent_50%)] opacity-95" />
            <span className="relative inline-flex items-center gap-2">
              {isAdding ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
                  />
                  Locking in...
                </>
              ) : Number.isFinite(selectedTierState?.addTotal ?? NaN) ? (
                selectedAdded && Number.isFinite(selectedTierState?.nextBags ?? NaN)
                  ? `Savings locked: ${selectedTier?.quantity} bags (total ${selectedTierState?.nextBags})`
                  : Number.isFinite(selectedTierState?.nextBags ?? NaN)
                    ? `Lock in savings now: ${selectedTier?.quantity} bags (total ${selectedTierState?.nextBags})`
                    : `Lock in savings now: ${selectedTier?.quantity} bags`
              ) : (
                "Lock in savings now"
              )}
            </span>
          </button>
          <div
            className={
              isLight
                ? "text-xs text-[var(--muted)]"
                : isCompact
                  ? "text-xs text-white/70"
                  : "text-xs text-white/75"
            }
          >
            Love it or your money back • Ships within 24 hours • Secure checkout
          </div>
          <div
            className={
              isFlat
                ? isLight
                  ? "mt-2 text-[11px] text-[var(--muted)]"
                  : "mt-2 text-[11px] text-white/70"
                : isLight
                  ? "mt-2 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white px-3 py-2 text-[11px] text-[var(--muted)]"
                  : "mt-2 rounded-2xl border border-white/12 bg-white/5 px-3 py-2 text-[11px] text-white/70"
            }
          >
            <div className={isLight ? "font-semibold text-[var(--text)]" : "font-semibold text-white/90"}>
              ⭐ {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
              <span
                className={
                  isFlat
                    ? "px-0 py-0"
                    : isLight
                      ? "rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2 py-1"
                      : "rounded-full border border-white/10 bg-white/5 px-2 py-1"
                }
              >
                Made in the USA
              </span>
              <span
                className={
                  isFlat
                    ? "px-0 py-0"
                    : isLight
                      ? "rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2 py-1"
                      : "rounded-full border border-white/10 bg-white/5 px-2 py-1"
                }
              >
                No artificial dyes
              </span>
            </div>
          </div>
          {reviewSnippets.length ? (
            <div className={isLight ? "grid gap-1 text-[11px] text-[var(--muted)]" : "grid gap-1 text-[11px] text-white/70"}>
              {reviewSnippets.map((review) => (
                <div key={review.id} className="inline-flex items-center gap-2">
                  <span className={isLight ? "text-[var(--candy-yellow)]" : "text-[var(--gold)]"}>
                    {starLine(review.rating)}
                  </span>
                  <span className="truncate">&quot;{review.body}&quot; — {review.author}</span>
                </div>
              ))}
            </div>
          ) : null}
          <AmazonOneBagNote
            className={isLight ? "text-xs text-[var(--muted)]" : "text-xs text-white/65"}
            linkClassName={
              isLight
                ? "underline underline-offset-4 text-[var(--text)] hover:text-[var(--navy)]"
                : "underline underline-offset-4 text-white hover:text-white"
            }
          />
          {error ? (
            <div
              className={
                isLight
                  ? "text-xs font-semibold text-red-500"
                  : isCompact
                    ? "text-xs font-semibold text-red-200"
                    : "text-xs font-semibold text-red-200"
              }
            >
              {error}
            </div>
          ) : null}
          {success && !error ? (
            <div
              className={
                isLight
                  ? "text-xs font-semibold text-[var(--candy-green)]"
                  : isCompact
                    ? "text-xs font-semibold text-[var(--gold)]"
                    : "text-xs font-semibold text-[var(--gold)]"
              }
            >
              {lastAddedQty ? `Added ${lastAddedQty} bags to cart.` : "Added to cart."}
            </div>
          ) : null}
          {ctaDisabled && availableForSale === false && !error ? (
            <div className={isLight ? "text-xs text-[var(--muted)]" : isCompact ? "text-xs text-white/50" : "text-xs text-white/60"}>Out of stock.</div>
          ) : null}
        </div>
      </div>

      <div className={isLight ? "mt-3 flex items-center gap-3 text-xs text-[var(--muted)]" : isCompact ? "mt-3 flex items-center gap-3 text-xs text-white/60" : "mt-3 flex items-center gap-3 text-xs text-white/70"}>
        <Link
          href="/shop#product-bundles"
          className={
            isLight
              ? "inline-flex items-center gap-2 font-semibold text-[var(--text)] underline underline-offset-4 hover:text-[var(--text)]"
              : isCompact
                ? "inline-flex items-center gap-2 font-semibold text-white/80 underline underline-offset-4 hover:text-white"
                : "inline-flex items-center gap-2 font-semibold text-white underline underline-offset-4 hover:text-white/90"
          }
        >
          Explore more bag sizes
        </Link>
      </div>
    </section>
  );
}
