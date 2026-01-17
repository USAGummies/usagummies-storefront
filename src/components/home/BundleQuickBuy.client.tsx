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
import { useRouter } from "next/navigation";
import type { BundleTier } from "@/lib/bundles/getBundleVariants";
import { BASE_PRICE, FREE_SHIPPING_PHRASE, MIN_PER_BAG } from "@/lib/bundles/pricing";
import { trackEvent } from "@/lib/analytics";
import { fireCartToast } from "@/lib/cartFeedback";
import { AMAZON_LISTING_URL } from "@/lib/amazon";
import { REVIEW_HIGHLIGHTS } from "@/data/reviewHighlights";

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
}: Props) {
  const router = useRouter();
  const ctaRef = React.useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = React.useState<TierKey>("8");
  const [addingQty, setAddingQty] = React.useState<number | null>(null);
  const [lastAddedQty, setLastAddedQty] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [showOtherQuantities, setShowOtherQuantities] = React.useState(false);
  const isCompact = variant === "compact";
  const isLight = tone === "light";

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
  const perBagCapText = money(MIN_PER_BAG, "USD");
  const showAmazonLink = !!selectedTier && selectedTier.quantity <= 3;
  const reviewSnippets = REVIEW_HIGHLIGHTS.slice(0, 2);
  const summaryLine =
    summaryCopy === undefined ? `${FREE_SHIPPING_PHRASE}. Most customers choose 8 bags.` : summaryCopy;
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

  async function addToCart(targetQty?: number, source: "cta" | "tile" = "cta") {
    const qty = Math.max(1, Number(targetQty ?? selectedTier?.quantity ?? 0) || 0);
    const targetTier = expandedTiers.find((tier) => tier.quantity === qty) || selectedTier;
    if (!singleBagVariantId || !isTierPurchasable(targetTier) || !qty) {
      setError(availableForSale === false ? "Out of stock" : "Select a bundle to continue.");
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
          action: "replace",
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
      router.refresh();
      if (typeof window !== "undefined") {
        const prefersReduced =
          window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!prefersReduced) {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
      router.push("/cart");
    } catch (e: any) {
      setError(e?.message || "Could not add to cart.");
    } finally {
      setAddingQty(null);
    }
  }

  function savingsFor(tier: BundleTier) {
    if (!Number.isFinite(tier.totalPrice ?? NaN)) return null;
    const s = BASE_PRICE * tier.quantity - (tier.totalPrice as number);
    return s > 0 ? s : 0;
  }

  function renderRow(tier: BundleTier) {
    const isActive = String(tier.quantity) === selected;
    const displayTotal =
      Number.isFinite(tier.totalPrice ?? NaN) && tier.totalPrice !== null
        ? money(tier.totalPrice, "USD")
        : null;
    const displayPerBag =
      tier.perBagPrice && Number.isFinite(tier.perBagPrice)
        ? `~${money(tier.perBagPrice, "USD")} / bag`
        : null;
    const unavailable = availableForSale === false || !displayTotal;
    const savings = savingsFor(tier);
    const savingsValue =
      savings && Number.isFinite(savings) && savings > 0 ? savings : null;

    if (isCompact) {
      const isOne = tier.quantity === 1;
      const isFour = tier.quantity === 4;
      const isFive = tier.quantity === 5;
      const isEight = tier.quantity === 8;
      const isTwelve = tier.quantity === 12;
      const canSelect = !unavailable;
      const isAdded = lastAddedQty === tier.quantity;
      const isAddingThis = addingQty === tier.quantity;
      const tileCtaLabel = isAddingThis
        ? "Adding..."
        : hasAdded
          ? isAdded
            ? "In your cart"
            : "Upgrade my cart for more savings"
          : "Add to cart";
      const showFreeShipping = tier.quantity >= 5;
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
              {tier.quantity} bags
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
              {displayTotal || "—"}
            </div>
            <div className={isLight ? "text-[12px] font-medium text-[var(--muted)]" : "text-[12px] font-medium text-white/65"}>
              {displayPerBag || "Standard price"}
            </div>
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium">
            <div className={isLight ? "text-[var(--candy-red)]" : "text-[var(--gold)]"}>
              {savingsValue ? `Save ${money(savingsValue, "USD")}` : <span className="invisible">Save</span>}
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

    const isFive = tier.quantity === 5;
    const isEight = tier.quantity === 8;
    const isTwelve = tier.quantity === 12;
    const isSmall = tier.quantity < 5;

    const pills: string[] = [];
    if (isFive) {
      pills.push(FREE_SHIPPING_PHRASE);
    } else if (isEight) {
      pills.push("Most popular");
      pills.push(FREE_SHIPPING_PHRASE);
    } else if (isTwelve) {
      pills.push("Best price per bag");
      pills.push(FREE_SHIPPING_PHRASE);
    } else if (tier.quantity === 4) {
      pills.push("Starter savings");
    } else if (tier.quantity === 1) {
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
    const tileCtaLabel = isAddingThis
      ? "Adding..."
      : hasAdded
        ? isAdded
          ? "In your cart"
          : "Upgrade my cart for more savings"
        : "Add to cart";

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
                  {tier.quantity} bags
                </div>
                <div className="text-xs text-white/70">
                  {tier.quantity === 5
                    ? "Free shipping"
                    : tier.quantity === 8
                    ? "Most popular"
                    : tier.quantity === 12
                    ? "Lowest per-bag"
                    : tier.quantity === 4
                    ? "Starter savings"
                    : tier.quantity === 1
                    ? "Trial size"
                    : tier.quantity < 5
                    ? "Standard price"
                    : "Bundle savings"}
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
                      Save {money(savingsValue, "USD")}
                    </span>
                    <span className="text-[10px] text-white/65 whitespace-nowrap">(vs 5-bag)</span>
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
                  {displayTotal || "—"}
                </div>
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
          "rounded-3xl border p-4 sm:p-5",
          isCompact
            ? "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
            : "border-white/10 bg-white/[0.06] text-white/70",
        ].join(" ")}
      >
        <div
          className={[
            "text-[11px] tracking-[0.2em] font-semibold uppercase",
            isCompact ? "text-[var(--muted)]" : "text-white/60",
          ].join(" ")}
        >
          Bundle pricing
        </div>
        <div className="mt-2 text-sm">
          Bundle pricing is temporarily unavailable right now. Please try again or view product details.
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
      aria-label="Bundle pricing"
      className={[
        "relative mx-auto rounded-3xl border p-4 sm:p-5 overflow-hidden",
        isCompact ? "w-full" : "max-w-3xl",
        isCompact
          ? isLight
            ? "border-[rgba(15,27,45,0.12)] bg-white text-[var(--text)] shadow-[0_20px_44px_rgba(15,27,45,0.12)]"
            : "border-white/15 bg-[rgba(10,16,30,0.92)] text-white shadow-[0_24px_60px_rgba(7,12,20,0.45)]"
          : isLight
            ? "border-[rgba(15,27,45,0.12)] bg-white text-[var(--text)] shadow-[0_30px_90px_rgba(15,27,45,0.12)] pb-16 sm:pb-12"
            : "border-white/10 bg-white/[0.06] shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl pb-16 sm:pb-12",
      ].join(" ")}
    >
      {isCompact ? null : (
        <div className="pointer-events-none absolute inset-0 opacity-12 bg-[radial-gradient(circle_at_10%_16%,rgba(255,255,255,0.22),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(10,60,138,0.3),transparent_44%),linear-gradient(135deg,rgba(214,64,58,0.18),rgba(12,20,38,0.38)),repeating-linear-gradient(135deg,rgba(255,255,255,0.07)_0,rgba(255,255,255,0.07)_8px,transparent_8px,transparent_16px)]" />
      )}
      {isCompact ? null : (
        <div className="relative mb-3 h-[2px] rounded-full bg-gradient-to-r from-[#d6403a]/70 via-white/60 to-[#0a3c8a]/65 opacity-85 shadow-[0_0_18px_rgba(255,255,255,0.12)]" />
      )}
      <div
        className={[
          "relative text-[10px] font-semibold tracking-[0.26em] uppercase flex items-center gap-2",
          isCompact ? (isLight ? "text-[var(--muted)]" : "text-white/70") : isLight ? "text-[var(--muted)]" : "text-white/75",
        ].join(" ")}
      >
        <span aria-hidden="true">🇺🇸</span>
        <span>American-made bundle pricing</span>
      </div>
      <div className="relative mt-1 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 space-y-1.5">
          <div
            className={[
              "font-extrabold",
              isCompact ? (isLight ? "text-2xl text-[var(--text)]" : "text-2xl text-white") : isLight ? "text-2xl text-[var(--text)]" : "text-2xl text-white",
            ].join(" ")}
          >
            Pick your bundle
          </div>
          <div
            className={[
              "text-xs font-semibold",
              isCompact ? (isLight ? "text-[var(--muted)]" : "text-white/70") : isLight ? "text-[var(--muted)]" : "text-white/75",
            ].join(" ")}
          >
            Build your bundle and watch your per‑bag price drop.
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
          <div
            className={[
              "flex flex-wrap items-center gap-2 text-[10.5px] font-semibold",
              isLight ? "text-[var(--text)]" : "text-white/80",
            ].join(" ")}
          >
            <span
              className={[
                "inline-flex items-center rounded-full px-2.5 py-1",
                isLight
                  ? "border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]"
                  : "border border-white/10 bg-white/5",
              ].join(" ")}
            >
              Save at 4+ bags
            </span>
            <span
              className={[
                "inline-flex items-center rounded-full px-2.5 py-1",
                isLight
                  ? "border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]"
                  : "border border-white/10 bg-white/5",
              ].join(" ")}
            >
              Free shipping at 5+ bags
            </span>
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
            "relative mt-3 rounded-2xl border px-3 py-2 text-xs",
            isCompact
              ? isLight
                ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] text-[var(--muted)]"
                : "border-white/12 bg-white/5 text-white/70"
              : isLight
                ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] text-[var(--muted)]"
                : "border-white/10 bg-white/5 text-white/75",
          ].join(" ")}
        >
          <div
            className={[
              "text-[10px] font-semibold uppercase tracking-[0.24em]",
              isLight ? "text-[var(--muted)]" : "text-white/60",
            ].join(" ")}
          >
            How pricing works
          </div>
          <ul className="mt-1.5 space-y-1">
            <li>Discounts start at 4 bags</li>
            <li>Free shipping at 5+ bags</li>
            <li>Most customers choose 8 bags</li>
            <li>Per-bag price caps at {perBagCapText} after 12+ bags</li>
          </ul>
        </div>
      ) : null}
      <div className={isLight ? "mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--muted)]" : "mt-2 flex flex-wrap items-center gap-2 text-[10px] text-white/70"}>
        <span className={isLight ? "inline-flex items-center gap-1.5 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2.5 py-1" : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 2 19 5v6c0 5-3.5 9.4-7 11-3.5-1.6-7-6-7-11V5l7-3z"
            />
          </svg>
          Love it or your money back
        </span>
        <span className={isLight ? "inline-flex items-center gap-1.5 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2.5 py-1" : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M3 6h10v7H3V6zm10 2h4l3 3v2h-7V8zm-8 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm11 0a2 2 0 1 0 .001 4A2 2 0 0 0 16 17z"
            />
          </svg>
          Ships within 24 hours
        </span>
        <span className={isLight ? "inline-flex items-center gap-1.5 rounded-full border border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] px-2.5 py-1" : "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1"}>
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
            aria-label="Bundle size"
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
          "mt-5 rounded-2xl border p-3 sm:p-3.5",
          isCompact
            ? isLight
              ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)]"
              : "border-white/15 bg-[rgba(12,18,32,0.92)]"
            : isLight
              ? "border-[rgba(15,27,45,0.12)] bg-[var(--surface-strong)] sticky bottom-3 md:static backdrop-blur-sm"
              : "border-white/12 bg-white/[0.07] sticky bottom-3 md:static backdrop-blur-sm",
        ].join(" ")}
        ref={ctaRef}
      >
        {selectedTier ? (
          isCompact ? (
            <div className="space-y-1">
              <div className={isLight ? "text-[14px] font-medium text-[var(--muted)]" : "text-[14px] font-medium text-white/80"}>
                {selectedAdded ? "In your cart" : "Your selected bundle"}: {selectedTier.quantity} bags
              </div>
              <div
                key={`${selectedTier.quantity}-${selectedTier.totalPrice}`}
                className={isLight ? "text-[24px] font-bold text-[var(--text)]" : "text-[24px] font-bold text-white"}
              >
                {selectedTier.totalPrice && Number.isFinite(selectedTier.totalPrice)
                  ? money(selectedTier.totalPrice, "USD")
                  : "—"}
              </div>
            </div>
          ) : (
            <div
              className={[
                "flex items-center justify-between gap-3",
                "border-b border-white/12 pb-2 mb-2",
              ].join(" ")}
            >
              <div
                className={
                  isLight
                    ? "text-sm font-semibold text-[var(--text)]"
                    : "text-sm font-semibold text-white/90"
                }
              >
                {selectedAdded ? "In your cart" : "Your bundle"}:{" "}
                <span
                  className={
                    isLight
                      ? "font-extrabold text-[var(--text)]"
                      : "font-extrabold text-white"
                  }
                >
                  {selectedTier.quantity} bags
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
                  key={`${selectedTier.quantity}-${selectedTier.totalPrice}`}
                  className={
                    isLight
                      ? "text-[12px] font-semibold text-[var(--muted)] transition-all duration-300 price-pop"
                      : "text-[12px] font-semibold text-white/80 transition-all duration-300 price-pop"
                  }
                >
                  {selectedTier.totalPrice && Number.isFinite(selectedTier.totalPrice)
                    ? money(selectedTier.totalPrice, "USD")
                    : "—"}
                </div>
                {selectedTier.perBagPrice && Number.isFinite(selectedTier.perBagPrice) ? (
                  <div
                    key={`${selectedTier.quantity}-${selectedTier.perBagPrice}`}
                    className="price-pop"
                  >
                    {`~${money(selectedTier.perBagPrice, "USD")} / bag`}
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
                  Adding…
                </>
              ) : selectedTier && selectedTier.totalPrice ? (
                selectedAdded
                  ? `In your cart — ${money(selectedTier.totalPrice, "USD")}`
                  : hasAdded
                    ? `Upgrade to ${selectedTier.quantity} bags — ${money(selectedTier.totalPrice, "USD")} →`
                    : `Add ${selectedTier.quantity}-bag bundle — ${money(selectedTier.totalPrice, "USD")} →`
              ) : (
                "Add bundle to cart →"
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
          {reviewSnippets.length ? (
            <div className={isLight ? "grid gap-1 text-[11px] text-[var(--muted)]" : "grid gap-1 text-[11px] text-white/70"}>
              {reviewSnippets.map((review) => (
                <div key={review.id} className="inline-flex items-center gap-2">
                  <span className={isLight ? "text-[var(--candy-yellow)]" : "text-[var(--gold)]"}>
                    {starLine(review.rating)}
                  </span>
                  <span className="truncate">"{review.body}" — {review.author}</span>
                </div>
              ))}
            </div>
          ) : null}
          {showAmazonLink ? (
            <div className={isLight ? "text-xs text-[var(--muted)]" : "text-xs text-white/65"}>
              <a
                href={AMAZON_LISTING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={isLight ? "underline underline-offset-4 hover:text-[var(--text)]" : "underline underline-offset-4 hover:text-white"}
              >
                Prefer a 1–3 bag refill? Buy on Amazon →
              </a>
            </div>
          ) : null}
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
              {lastAddedQty ? `Added ${lastAddedQty}-bag bundle to cart.` : "Added to cart."}
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
          Explore more bundle sizes →
        </Link>
      </div>
    </section>
  );
}
