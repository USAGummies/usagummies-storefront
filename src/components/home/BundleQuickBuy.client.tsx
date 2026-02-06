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
import { BASE_PRICE, MIN_PER_BAG, pricingForQty } from "@/lib/bundles/pricing";
import { trackEvent } from "@/lib/analytics";
import { fireCartToast } from "@/lib/cartFeedback";
import { GummyIconRow, HeroPackIcon } from "@/components/ui/GummyIcon";
import { useCartBagCount } from "@/hooks/useCartBagCount";
import { REVIEW_HIGHLIGHTS } from "@/data/reviewHighlights";
import { AmazonOneBagNote } from "@/components/ui/AmazonOneBagNote";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";
import { AMAZON_LISTING_URL, AMAZON_LOGO_URL } from "@/lib/amazon";

type TierKey = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12";
type ChannelOptionId = "amazon-1" | "amazon-2" | "amazon-3-4" | "dtc-5" | "dtc-best";

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
  showAccent?: boolean;
  accentSrc?: string;
  showEducation?: boolean;
  ctaVariant?: "detailed" | "simple";
  primaryCtaLabel?: string;
  surface?: "card" | "flat";
  layout?: "classic" | "integrated" | "fusion";
  selectorVariant?: "segmented" | "cards";
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

function priceForQtyDisplay(
  qty: number,
  prefix?: string,
  opts?: { forceBase?: boolean }
) {
  const totalValue = opts?.forceBase ? BASE_PRICE * qty : pricingForQty(qty).total;
  const total = money(totalValue, "USD");
  if (!total) return "";
  return prefix ? `${prefix} ${total}` : total;
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
  { qty: 8, label: "Most picked", caption: "8 bags" },
  { qty: 12, label: "Best price", caption: "12 bags" },
];
const MISSION_TARGET_QTY = 8;
const MISSION_SOCIAL_PROOF = "8 bags is the most popular pick.";

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
  showAccent = false,
  accentSrc = "/website%20assets/Train-02.png",
  showEducation = true,
  ctaVariant = "detailed",
  primaryCtaLabel = "Add to Cart",
  surface = "card",
  layout = "classic",
  selectorVariant = "segmented",
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
      ? `Add ${missionRemaining} more bag${missionRemaining === 1 ? "" : "s"} to reach ${MISSION_TARGET_QTY}`
      : `${MISSION_TARGET_QTY} bags locked in`;
  const mysteryBonusLine = bestPriceReached
    ? "Mystery extra included at 12 bags (while supplies last)."
    : "Mystery extra at 12 bags (while supplies last).";
  const ctaRef = React.useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = React.useState<TierKey>(() => (variant === "compact" ? "5" : "8"));
  const [selectedOption, setSelectedOption] = React.useState<ChannelOptionId>("dtc-5");
  const [amazonMultiQty, setAmazonMultiQty] = React.useState<3 | 4>(3);
  const [dtcBestQty, setDtcBestQty] = React.useState<8 | 12>(8);
  const [addingQty, setAddingQty] = React.useState<number | null>(null);
  const [lastAddedQty, setLastAddedQty] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const isCompact = variant === "compact";
  const isLight = tone === "light";
  const isFlat = surface === "flat";
  const isIntegrated = layout === "integrated";
  const isFusion = layout === "fusion";
  const analyticsName =
    (_productHandle || "USA Gummies")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "USA Gummies";

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

  const selectableTiers = React.useMemo(() => {
    const seen = new Set<number>();
    return primaryTiers.filter((tier) => {
      if (seen.has(tier.quantity)) return false;
      seen.add(tier.quantity);
      return true;
    });
  }, [primaryTiers]);

  React.useEffect(() => {
    const pool = selectableTiers;
    if (!pool.length) return;
    const selectedInPool = pool.some((t) => String(t.quantity) === selected);
    const preferred =
      pool.find((t) => t.quantity === 8) ||
      pool.find((t) => t.quantity === 5) ||
      pool[0];
    if (!selectedInPool && preferred) {
      setSelected(String(preferred.quantity) as TierKey);
    }
  }, [selectableTiers, selected]);

  const selectedTier =
    selectableTiers.find((t) => String(t.quantity) === selected) || selectableTiers[0] || null;
  const selectedTierState = selectedTier ? resolveTier(selectedTier) : null;
  const perBagCapText = money(MIN_PER_BAG, "USD");
  const reviewSnippets = REVIEW_HIGHLIGHTS.slice(0, 2);
  const shippingAdvocateLine =
    "5+ bags ship free from us. Under 5 bags, we send you to Amazon to save you on shipping.";
  const summaryLine =
    summaryCopy !== undefined
      ? summaryCopy
      : showEducation
        ? currentBags > 0
          ? `In your cart: ${currentBags} bags. ${shippingAdvocateLine}`
          : `${shippingAdvocateLine} 8 bags is the most popular pick.`
        : "";
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

  function handleOptionSelect(optionId: ChannelOptionId, overrideQty?: number) {
    const isAmazon = optionId.startsWith("amazon");
    const optionQty =
      overrideQty ??
      (optionId === "amazon-1"
        ? 1
        : optionId === "amazon-2"
          ? 2
          : optionId === "amazon-3-4"
            ? amazonMultiQty
            : optionId === "dtc-5"
              ? 5
              : dtcBestQty);
    if (!isAmazon && !canPurchaseQty(optionQty)) {
      setError(availableForSale === false ? "Out of stock." : "Select a bag count to continue.");
      return;
    }
    setSelectedOption(optionId);
    if (!isAmazon) {
      setSelected(String(optionQty) as TierKey);
    }
    setError(null);
    setSuccess(false);
    trackEvent("bundle_select", {
      qty: optionQty,
      channel: isAmazon ? "amazon" : "dtc",
      variant,
      anchorId: anchorId || null,
    });
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      window.requestAnimationFrame(scrollToCTA);
    }
  }

  function handleAmazonQtyPick(qty: 3 | 4) {
    setAmazonMultiQty(qty);
    handleOptionSelect("amazon-3-4", qty);
  }

  function handleDtcBestQtyPick(qty: 8 | 12) {
    setDtcBestQty(qty);
    handleOptionSelect("dtc-best", qty);
  }

  function handlePrimaryCtaClick() {
    if (isAmazonSelection) {
      const amazonUrl = AMAZON_LISTING_URL;
      let didNavigate = false;
      const navigateToAmazon = () => {
        if (didNavigate || typeof window === "undefined") return;
        didNavigate = true;
        window.location.href = amazonUrl;
      };
      trackEvent("bundle_amazon_click", {
        qty: amazonSelectedQty,
        variant,
        anchorId: anchorId || null,
      });
      trackEvent("amazon_redirect", {
        event_category: "commerce",
        event_label: "amazon_outbound",
        quantity: amazonSelectedQty,
        sku: "AAGB-7.5OZ",
        source_page: typeof window !== "undefined" ? window.location.pathname : "",
        event_callback: navigateToAmazon,
      });
      if (typeof window !== "undefined") {
        window.setTimeout(navigateToAmazon, 1200);
      }
      return;
    }
    addToCart(dtcSelectedQty, "cta");
  }

  function isTierPurchasable(tier?: BundleTier | null) {
    if (!tier) return false;
    if (availableForSale === false) return false;
    return Number.isFinite(tier.totalPrice ?? NaN) && tier.totalPrice !== null;
  }

  function canPurchaseQty(qty: number) {
    if (!singleBagVariantId) return false;
    const tier = allTiers.find((item) => item.quantity === qty) || null;
    return isTierPurchasable(tier);
  }

  const ctaDisabled = !singleBagVariantId || !isTierPurchasable(selectedTier);
  const isAdding = addingQty !== null;

  const selectableTiersForKeys = React.useMemo(
    () =>
      selectableTiers.filter((tier) => {
        if (availableForSale === false) return false;
        return Number.isFinite(tier.totalPrice ?? NaN) && tier.totalPrice !== null;
      }),
    [selectableTiers, availableForSale]
  );

  const isAmazonSelection = selectedOption.startsWith("amazon");
  const amazonSelectedQty =
    selectedOption === "amazon-1" ? 1 : selectedOption === "amazon-2" ? 2 : amazonMultiQty;
  const dtcSelectedQty = selectedOption === "dtc-best" ? dtcBestQty : 5;
  const activeQty = isAmazonSelection ? amazonSelectedQty : dtcSelectedQty;
  const activePricing = isAmazonSelection
    ? { total: BASE_PRICE * activeQty, perBag: BASE_PRICE }
    : pricingForQty(activeQty);
  const activeTotal = money(activePricing.total, "USD");
  const activeSavings = !isAmazonSelection
    ? money(Math.max(0, BASE_PRICE * activeQty - activePricing.total), "USD")
    : null;
  const compactCtaDisabled = isAmazonSelection ? false : !canPurchaseQty(dtcSelectedQty);

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
    if (!selectableTiersForKeys.length) return;
    const currentIndex = selectableTiersForKeys.findIndex((tier) => tier.quantity === quantity);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = Math.min(currentIndex + 1, selectableTiersForKeys.length - 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = selectableTiersForKeys.length - 1;
    }
    const nextTier = selectableTiersForKeys[nextIndex];
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
    const targetTier = selectableTiers.find((tier) => tier.quantity === qty) || selectedTier;
    if (!singleBagVariantId || !isTierPurchasable(targetTier) || !qty) {
      setError(availableForSale === false ? "Out of stock" : "Select a bag count to continue.");
      return;
    }
    if (selectableTiers.some((tier) => tier.quantity === qty)) {
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
      const pricing = pricingForQty(currentBags + qty);
      const addValueRaw = Math.max(0, (pricing.total ?? 0) - currentTotal);
      const addValue = Number.isFinite(addValueRaw) ? Number(addValueRaw.toFixed(2)) : undefined;
      const unitPrice =
        addValue && qty > 0 ? Number((addValue / qty).toFixed(2)) : undefined;
      trackEvent("add_to_cart", {
        currency: "USD",
        value: addValue,
        items: [
          {
            item_id: singleBagVariantId,
            item_name: analyticsName || "USA Gummies",
            item_variant: `${qty} bags`,
            item_brand: "USA Gummies",
            item_category: "Gummy Bears",
            price: unitPrice,
            quantity: qty,
          },
        ],
      });
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
    const bundleQty = tier.quantity;
    const canSelect = isTierPurchasable(tier);
  const label =
    bundleQty === 8
        ? "Most picked"
        : bundleQty === 12
          ? "Best price"
          : bundleQty === 5
            ? "Free shipping"
            : "";

    return (
      <button
        key={tier.quantity}
        type="button"
        role="radio"
        data-qty={tier.quantity}
        aria-checked={isActive}
        aria-disabled={!canSelect}
        tabIndex={isActive && canSelect ? 0 : -1}
        onClick={() => handleSelect(tier.quantity, canSelect)}
        onKeyDown={(event) => handleRadioKeyDown(event, tier.quantity, canSelect)}
        disabled={!canSelect}
        className={[
          "flex w-full items-center gap-2 text-left text-[13px] font-medium transition-colors",
          isLight
            ? isActive
              ? "text-[var(--text)]"
              : "text-[var(--muted)] hover:text-[var(--text)]"
            : isActive
              ? "text-white"
              : "text-white/70 hover:text-white",
          !canSelect ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <span
          className={
            isActive
              ? isLight
                ? "text-[var(--candy-red)]"
                : "text-[var(--gold)]"
              : "text-current/60"
          }
        >
          {isActive ? "●" : "○"}
        </span>
        <span className={isActive ? "font-semibold" : "font-medium"}>
          {bundleQty} bag{bundleQty === 1 ? "" : "s"}
        </span>
        {label ? (
          <span className={isLight ? "text-[11px] text-[var(--muted)]" : "text-[11px] text-white/60"}>
            — {label}
          </span>
        ) : null}
      </button>
    );
  }

  const selectedLabel =
    selectedTier?.quantity === 8
      ? "Most picked"
      : selectedTier?.quantity === 12
        ? "Best price"
        : selectedTier?.quantity === 5
          ? "Free shipping"
          : "";
  const selectedNextBags = selectedTierState?.nextBags ?? null;
  const selectedTotal = Number.isFinite(selectedTierState?.nextTotal ?? NaN)
    ? money(selectedTierState?.nextTotal, "USD")
    : null;
  const selectedSavings =
    selectedTierState?.savings && Number.isFinite(selectedTierState.savings) && selectedTierState.savings > 0
      ? money(selectedTierState.savings, "USD")
      : null;
  const basePerBag = money(BASE_PRICE, "USD");
  const regularTotal =
    selectedNextBags && Number.isFinite(BASE_PRICE)
      ? money(BASE_PRICE * selectedNextBags, "USD")
      : null;
  const hasRegularLine = Boolean(basePerBag && regularTotal);
  const totalLabel = currentBags > 0 ? "New total" : "Total";
  const compactPriceLabel = isAmazonSelection ? "Amazon total" : "Total";
  const compactSavingsLabel = isAmazonSelection
    ? "Amazon checkout saves you on shipping"
    : activeSavings
      ? `You save ${activeSavings}`
      : "Free shipping on 5+ bags";
  const dtcSelectedPricing = pricingForQty(dtcSelectedQty);
  const dtcSelectedPerBag = money(dtcSelectedPricing.perBag, "USD");
  const useCardSelector = selectorVariant === "cards";
  const recommendedQty = 12;
  const dtcBenefitLabel = (qty: number) => {
    if (qty === 12) return "Best value";
    if (qty === 8) return "Most popular";
    return "Free shipping";
  };
  const dtcSavingsLabel = (qty: number) => {
    const pricing = pricingForQty(qty);
    const savings = Math.max(0, BASE_PRICE * qty - pricing.total);
    if (savings > 0) {
      return `Save ${money(savings, "USD")}`;
    }
    return "Free shipping";
  };
  const dtcSegments = [
    { qty: 5, label: "5 bags" },
    { qty: 8, label: "8 bags" },
    { qty: 12, label: "12 bags" },
  ];
  const amazonSegments = [
    { qty: 1, label: "1 bag" },
    { qty: 2, label: "2 bags" },
    { qty: 3, label: "3 bags" },
    { qty: 4, label: "4 bags" },
  ];

  const compactRail = (
    <div data-bundle-rail className="bundle-quickbuy__rail">
      <div className="bundle-quickbuy__panel">
        <div className="bundle-quickbuy__kicker">Pick a bag count</div>
        <div className="bundle-quickbuy__sub">
          5+ bags ship free from us. Under 5 bags, we send you to Amazon to save
          you on shipping.
        </div>

        <div className="bundle-quickbuy__group">
          <div className="bundle-quickbuy__groupHeader">
            <span className="bundle-quickbuy__groupTitle">Direct (5+ bags)</span>
            <span className="bundle-quickbuy__groupMeta">Pick the bundle that fits the moment</span>
          </div>
          {useCardSelector ? (
            <div className="bundle-quickbuy__cardGrid" role="radiogroup" aria-label="Direct bag count">
              {dtcSegments.map((segment) => {
                const isActive =
                  segment.qty === 5
                    ? selectedOption === "dtc-5"
                    : selectedOption === "dtc-best" && dtcBestQty === segment.qty;
                const canSelect = canPurchaseQty(segment.qty);
                const isFeatured = segment.qty === recommendedQty;
                const perBag = money(pricingForQty(segment.qty).perBag, "USD");
                return (
                  <button
                    key={segment.qty}
                    type="button"
                    role="radio"
                    data-card
                    data-active={isActive}
                    data-featured={isFeatured}
                    aria-checked={isActive}
                    aria-disabled={!canSelect}
                    tabIndex={isActive ? 0 : -1}
                    disabled={!canSelect}
                    onClick={() => {
                      if (segment.qty === 5) {
                        handleOptionSelect("dtc-5", 5);
                      } else {
                        handleDtcBestQtyPick(segment.qty as 8 | 12);
                      }
                    }}
                    className={[
                      "bundle-quickbuy__card",
                      !canSelect ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                    ].join(" ")}
                  >
                    {isFeatured ? (
                      <div className="bundle-quickbuy__cardBadge">Recommended</div>
                    ) : null}
                    <div className="bundle-quickbuy__cardLogo" aria-hidden="true">
                      <Image
                        src="/logo-mark.png"
                        alt=""
                        width={28}
                        height={28}
                        className="h-7 w-7"
                      />
                      <span>USA Gummies</span>
                    </div>
                    <div className="bundle-quickbuy__cardCount">
                      <span>{segment.qty}</span>
                      <span>Bags</span>
                    </div>
                    <div className="bundle-quickbuy__cardPrice">
                      {priceForQtyDisplay(segment.qty)}
                    </div>
                    <div className="bundle-quickbuy__cardBenefit">
                      {dtcBenefitLabel(segment.qty)}
                    </div>
                    <div className="bundle-quickbuy__cardMeta">
                      <span>{perBag} / bag</span>
                      <span>{dtcSavingsLabel(segment.qty)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div data-segmented-control role="radiogroup" aria-label="Direct bag count">
              {dtcSegments.map((segment) => {
                const isActive =
                  segment.qty === 5
                    ? selectedOption === "dtc-5"
                    : selectedOption === "dtc-best" && dtcBestQty === segment.qty;
                const canSelect = canPurchaseQty(segment.qty);
                return (
                  <button
                    key={segment.qty}
                    type="button"
                    role="radio"
                    data-segment
                    data-active={isActive}
                    aria-checked={isActive}
                    aria-disabled={!canSelect}
                    tabIndex={isActive ? 0 : -1}
                    disabled={!canSelect}
                    onClick={() => {
                      if (segment.qty === 5) {
                        handleOptionSelect("dtc-5", 5);
                      } else {
                        handleDtcBestQtyPick(segment.qty as 8 | 12);
                      }
                    }}
                    className={[
                      "bundle-quickbuy__segment",
                      !canSelect ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                    ].join(" ")}
                  >
                    <span className="bundle-quickbuy__segmentLabel">{segment.label}</span>
                    <span className="bundle-quickbuy__segmentPrice">
                      {priceForQtyDisplay(segment.qty)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {selectedOption.startsWith("dtc") ? (
            useCardSelector ? (
              <div className="bundle-quickbuy__microcopy">
                {selectedSavings ? `You save ${selectedSavings}` : "Free shipping on 5+ bags."}
              </div>
            ) : (
              <div className="bundle-quickbuy__groupDetail">
                <span>{dtcSelectedPerBag} / bag</span>
                <span>Bundle pricing applied</span>
              </div>
            )
          ) : null}
        </div>

        <div className="bundle-quickbuy__group bundle-quickbuy__group--amazon">
          <div className="bundle-quickbuy__groupHeader">
            <span className="bundle-quickbuy__groupTitle">Amazon (1-4 bags)</span>
            <span className="bundle-quickbuy__groupMeta">Amazon checkout saves you on shipping</span>
          </div>
          <div data-segmented-control role="radiogroup" aria-label="Amazon bag count">
            {amazonSegments.map((segment) => {
              const optionId =
                segment.qty === 1 ? "amazon-1" : segment.qty === 2 ? "amazon-2" : "amazon-3-4";
              const isActive =
                optionId === "amazon-1"
                  ? selectedOption === "amazon-1"
                  : optionId === "amazon-2"
                    ? selectedOption === "amazon-2"
                    : selectedOption === "amazon-3-4" && amazonMultiQty === segment.qty;
              return (
                <button
                  key={segment.qty}
                  type="button"
                  role="radio"
                  data-segment
                  data-active={isActive}
                  aria-checked={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => {
                    if (segment.qty === 1) {
                      handleOptionSelect("amazon-1", 1);
                    } else if (segment.qty === 2) {
                      handleOptionSelect("amazon-2", 2);
                    } else {
                      handleAmazonQtyPick(segment.qty as 3 | 4);
                    }
                  }}
                  className="bundle-quickbuy__segment cursor-pointer"
                >
                  <span className="bundle-quickbuy__amazonBadge" aria-hidden="true">
                    <Image
                      src={AMAZON_LOGO_URL}
                      alt=""
                      width={36}
                      height={12}
                      className="h-3 w-auto"
                    />
                  </span>
                  <span className="bundle-quickbuy__segmentLabel">{segment.label}</span>
                  <span className="bundle-quickbuy__segmentPrice">
                    {priceForQtyDisplay(segment.qty, undefined, { forceBase: true })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div data-rail-bottom className="bundle-quickbuy__railBottom">
        <div className="bundle-quickbuy__priceBlock">
          <div className="flex items-baseline justify-between font-semibold text-[#161616] text-[14px]">
            <span>{compactPriceLabel}</span>
            <span>{activeTotal ?? "--"}</span>
          </div>
          <div className="text-[12px] font-semibold text-[#6B6B6B]">
            {compactSavingsLabel}
          </div>
        </div>
        <div className="bundle-quickbuy__rating">
          <div className="bundle-quickbuy__ratingLine">
            <span className="bundle-quickbuy__ratingStars">
              {starLine(AMAZON_REVIEWS.aggregate.rating)}
            </span>
            <span>
              {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers
            </span>
          </div>
          <div className="bundle-quickbuy__snippets">
            {reviewSnippets.map((review) => (
              <div key={review.id} className="bundle-quickbuy__snippet">
                &quot;{review.body}&quot; — {review.author}
              </div>
            ))}
          </div>
        </div>
        <div className="bundle-quickbuy__ctaStack">
          <button
            data-primary-cta
            type="button"
            className={[
              "w-full inline-flex items-center justify-center rounded-[12px] h-[52px] px-4 text-[17px] font-semibold whitespace-nowrap shadow-[0_14px_36px_rgba(214,64,58,0.28)] transition disabled:opacity-60 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[rgba(214,69,61,0.25)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F3EF]",
              isAmazonSelection
                ? "bg-[#1F1F1F] text-white hover:bg-black"
                : "bg-[#D6453D] text-white hover:bg-[#BF3B34] active:bg-[#A7322C]",
            ].join(" ")}
            onClick={handlePrimaryCtaClick}
            disabled={isAdding || compactCtaDisabled}
          >
            <span className="inline-flex items-center gap-2">
              {!isAmazonSelection && isAdding ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
                  />
                  Adding...
                </>
              ) : (
                <>
                  {isAmazonSelection ? (
                    <Image
                      src={AMAZON_LOGO_URL}
                      alt="Amazon"
                      width={48}
                      height={14}
                      className="h-4 w-auto"
                    />
                  ) : null}
                  <span>{isAmazonSelection ? "Buy on Amazon" : selectedAdded ? "Added to Cart" : "Add to Cart"}</span>
                  {isAmazonSelection ? (
                    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3zM5 5h5V3H3v7h2V5zm0 14v-5H3v7h7v-2H5z"
                      />
                    </svg>
                  ) : null}
                </>
              )}
            </span>
          </button>
          <div className={isLight ? "text-[12px] font-semibold text-[#6B6B6B]" : "text-[12px] font-semibold text-white/70"}>
            {isAmazonSelection
              ? "Amazon checkout saves you on shipping."
              : "Direct from USA Gummies. Free shipping at 5+ bags."}
          </div>
          <div
            data-rail-trust
            className={[
              "flex flex-wrap items-center gap-3 text-[12px] font-semibold",
              isLight ? "text-[#6B6B6B]" : "text-white/70",
            ].join(" ")}
          >
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true">🚚</span>
              <span>Ships within 24 hours</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true">✅</span>
              <span>Satisfaction guaranteed</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true">🔒</span>
              <span>Secure checkout</span>
            </span>
          </div>
        </div>
      </div>

      {error ? (
        <div className={isLight ? "text-xs font-semibold text-red-500" : "text-xs font-semibold text-red-200"}>
          {error}
        </div>
      ) : null}
      {success && !error ? (
        <div className={isLight ? "text-xs font-semibold text-[var(--candy-green)]" : "text-xs font-semibold text-[var(--gold)]"}>
          {lastAddedQty ? `Added ${lastAddedQty} bags to cart.` : "Added to cart."}
        </div>
      ) : null}
      {compactCtaDisabled && !isAmazonSelection && availableForSale === false && !error ? (
        <div className={isLight ? "text-xs text-[var(--muted)]" : "text-xs text-white/60"}>
          Out of stock.
        </div>
      ) : null}
    </div>
  );

  const defaultCtaStack = (
    <div
      data-bundle-cta-stack
      className={[
        "mt-3 flex flex-col gap-2",
        isFusion ? "bundle-fusion__ctaStack" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        data-primary-cta
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
          ) : ctaVariant === "simple" ? (
            selectedAdded ? "Added to cart" : primaryCtaLabel
          ) : Number.isFinite(selectedTierState?.addTotal ?? NaN) ? (
            selectedAdded && Number.isFinite(selectedTierState?.nextBags ?? NaN)
              ? `Added ${selectedTier?.quantity} bags (cart ${selectedTierState?.nextBags})`
              : Number.isFinite(selectedTierState?.nextBags ?? NaN)
                ? `Add ${selectedTier?.quantity} bags (cart ${selectedTierState?.nextBags})`
                : `Add ${selectedTier?.quantity} bags`
          ) : (
            "Add to cart"
          )}
        </span>
      </button>
      <AmazonOneBagNote
        className={isLight ? "text-xs text-[var(--muted)]" : "text-xs text-white/65"}
        linkClassName={
          isLight
            ? "underline underline-offset-4 text-[var(--text)] hover:text-[var(--navy)]"
            : "underline underline-offset-4 text-white hover:text-white"
        }
      />
      <div data-bundle-cta-trust>
        <div
          data-bundle-cta-note
          className={[
            isLight
              ? "text-xs text-[var(--muted)]"
              : isCompact
                ? "text-xs text-white/70"
                : "text-xs text-white/75",
            isFusion ? "bundle-fusion__ctaNote" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          🇺🇸 Made in the USA • ✅ Satisfaction guaranteed • 🚚 Ships within 24 hours • 🔒 Secure checkout
        </div>
        <div
          data-bundle-rating
          className={[
            isFlat
              ? isLight
                ? "mt-2 text-[11px] text-[var(--muted)]"
                : "mt-2 text-[11px] text-white/70"
              : isLight
                ? "mt-2 rounded-2xl border border-[rgba(15,27,45,0.12)] bg-white px-3 py-2 text-[11px] text-[var(--muted)]"
                : "mt-2 rounded-2xl border border-white/12 bg-white/5 px-3 py-2 text-[11px] text-white/70",
            isFusion ? "bundle-fusion__ctaProof" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className={isLight ? "font-semibold text-[var(--text)]" : "font-semibold text-white/90"}>
            {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers
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
              🇺🇸 Made in the USA
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
              🌿 No artificial dyes
            </span>
          </div>
        </div>
      </div>
      {!isFusion && reviewSnippets.length ? (
        <div
          data-bundle-reviews
          className={isLight ? "grid gap-1 text-[11px] text-[var(--muted)]" : "grid gap-1 text-[11px] text-white/70"}
        >
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
        <div className={isLight ? "text-xs text-[var(--muted)]" : isCompact ? "text-xs text-white/50" : "text-xs text-white/60"}>
          Out of stock.
        </div>
      ) : null}
    </div>
  );

  const ctaContent = (
    <>
      {!isCompact && selectedTier ? (
        <div
          className={[
            "relative space-y-2",
            isFusion ? "bundle-fusion__ctaSummary" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className={isLight ? "text-[12px] font-semibold text-[var(--muted)]" : "text-[12px] font-semibold text-white/75"}>
            {selectedTier.quantity} bags{selectedLabel ? ` — ${selectedLabel}` : ""}
          </div>
          {selectedTotal ? (
            <div
              key={`${selectedTier.quantity}-${selectedTierState?.nextTotal ?? "na"}`}
              className={isLight ? "text-[22px] font-bold text-[var(--text)]" : "text-[22px] font-bold text-white"}
            >
              {totalLabel} {selectedTotal}
            </div>
          ) : null}
          {currentBags > 0 && selectedNextBags ? (
            <div className={isLight ? "text-[11px] font-semibold text-[var(--muted)]" : "text-[11px] font-semibold text-white/70"}>
              Cart: {currentBags} bag{currentBags === 1 ? "" : "s"} → {selectedNextBags} bags total
            </div>
          ) : null}
          {hasRegularLine || selectedSavings ? (
            <div className={isLight ? "text-[11px] font-semibold text-[var(--muted)]" : "text-[11px] font-semibold text-white/70"}>
              {hasRegularLine ? (
                <span>
                  Regular {basePerBag}/bag ·{" "}
                  <span className="line-through">{regularTotal}</span> total
                </span>
              ) : null}
              {selectedSavings ? (
                <span className={isLight ? "text-[var(--candy-red)]" : "text-[var(--gold)]"}>
                  {hasRegularLine ? " · " : ""}You save {selectedSavings}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {isCompact ? compactRail : defaultCtaStack}
    </>
  );

  if (!selectableTiers.length) {
    return (
      <section
        id={anchorId}
        data-bundle-root
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
          Bundle pricing
        </div>
        <div className="mt-2 text-sm">
          Bundle pricing is loading. Please refresh or view product details.
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

  if (isFusion) {
    return (
      <section id={anchorId} aria-label="Savings pricing" data-bundle-root className="bundle-fusion">
        <div className="bundle-fusion__grid">
          <div className="bundle-fusion__guide">
            <div className="bundle-fusion__intro">
              <div className="bundle-fusion__eyebrow">Bundle pricing</div>
              <div className="bundle-fusion__title">Pick a bag count</div>
              <div className="bundle-fusion__sub">
                Add more bags and the per-bag price drops. Pricing applies to your total bag count.
              </div>
              {summaryLine ? (
                <div className="bundle-fusion__summary">{summaryLine}</div>
              ) : null}
            </div>

            {showEducation ? (
              <>
                <div className="bundle-fusion__rail">
                  {SAVINGS_LADDER.map((milestone) => {
                    const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
                    const isBest = bestPriceReached && milestone.qty === topMilestone.qty;
                    const isReached = currentBags >= milestone.qty;
                    const isActive = isNext || isBest;
                    return (
                      <div
                        key={milestone.qty}
                        className={[
                          "bundle-fusion__milestone",
                          isActive ? "bundle-fusion__milestone--active" : "",
                          isReached && !isActive ? "bundle-fusion__milestone--reached" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className="bundle-fusion__milestoneDot" aria-hidden="true" />
                        <div className="bundle-fusion__milestoneLabel">{milestone.label}</div>
                        <div className="bundle-fusion__milestoneCaption">{milestone.caption}</div>
                        {isActive ? (
                          <div className="bundle-fusion__milestoneNote">
                            {isBest ? "Best price active" : "Next up"}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="bundle-fusion__railProof">{MISSION_SOCIAL_PROOF}</div>

                <div className="bundle-fusion__mission">
                  <div className="bundle-fusion__missionHeader">
                    <span>Savings progress</span>
                    <span>
                      Progress: {missionProgressCount}/{topMilestone.qty} bags
                    </span>
                  </div>
                  <div className="bundle-fusion__missionCopy">
                    8 bags is the most picked price point.
                  </div>
                  <div className="mission-bar" aria-hidden="true">
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
                  <div className="bundle-fusion__missionBadges">
                    {[
                      { qty: 4, label: "Savings unlocked" },
                      { qty: 5, label: "Free shipping unlocked" },
                      { qty: 8, label: "Most picked unlocked" },
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
                            "bundle-fusion__missionBadge",
                            unlocked ? "bundle-fusion__missionBadge--active" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {badge.label}
                        </span>
                      );
                    })}
                  </div>
                  <div className="bundle-fusion__missionActions">
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
                      <span className="bundle-fusion__missionDone">{missionCtaLabel}</span>
                    )}
                  </div>
                  <div className="bundle-fusion__missionNote">{mysteryBonusLine}</div>
                </div>

                {showHowItWorks ? (
                  <div className="bundle-fusion__how">
                    <div className="text-[11px] font-semibold">
                      How pricing works: selections add bags to your cart. They do not replace it.
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text)]">
                        Learn more
                      </summary>
                      <div className="mt-1 text-[11px] text-[var(--muted)]">
                        Savings start at 4 bags, free shipping starts at 5 bags, and per-bag pricing caps at {perBagCapText} after 12+ bags.{" "}
                        <Link href="/faq" className="underline underline-offset-2">
                          Read the FAQ
                        </Link>
                        .
                      </div>
                    </details>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="bundle-fusion__select">
            <div className="bundle-fusion__panel">
              <div className="bundle-fusion__list" role="radiogroup" aria-label="Bag count">
                {primaryTiers.map((tier) => renderRow(tier))}
              </div>

              <div
                className={[
                  "bundle-fusion__cta",
                  !isCompact ? "bundle-fusion__cta--sticky" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                ref={ctaRef}
              >
                {ctaContent}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (isIntegrated) {
    return (
      <section
        id={anchorId}
        aria-label="Savings pricing"
        data-bundle-root
        className="bundle-integrated relative"
      >
        {showTrainAccent ? (
          <Image
            src="/website%20assets/B17Bomber.png"
            alt=""
            aria-hidden="true"
            width={1405}
            height={954}
            sizes="(max-width: 640px) 90vw, 620px"
            className="bundle-integrated__accent"
          />
        ) : null}
        {showTrainAccent ? (
          <div className="bundle-integrated__trail" aria-hidden="true">
            <GummyIconRow size={14} className="opacity-90" />
          </div>
        ) : null}

        <div className="bundle-integrated__header">
          <div className="bundle-integrated__eyebrow">Bundle pricing</div>
          <div className="bundle-integrated__title">Pick a bag count</div>
          <div className="bundle-integrated__sub">
            Add more bags and the per-bag price drops. Pricing applies to your total bag count.
          </div>
          {summaryLine ? (
            <div className="bundle-integrated__summary">
              {summaryLine}
            </div>
          ) : null}
        </div>

        <div className="bundle-integrated__grid">
          <div className="bundle-integrated__guide">
            {showEducation ? (
              <>
                <div className="bundle-integrated__ladder">
                  <div className="bundle-integrated__ladderRow">
                    {SAVINGS_LADDER.map((milestone) => {
                      const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
                      const isBest = bestPriceReached && milestone.qty === topMilestone.qty;
                      const isReached = currentBags >= milestone.qty;
                      const isActive = isNext || isBest;
                      return (
                        <div
                          key={milestone.qty}
                          className={[
                            "bundle-integrated__ladderItem",
                            isActive ? "bundle-integrated__ladderItem--active" : "",
                            isReached && !isActive ? "bundle-integrated__ladderItem--reached" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span className="bundle-integrated__ladderDot" aria-hidden="true" />
                          <div className="bundle-integrated__ladderLabel">{milestone.label}</div>
                          <div className="bundle-integrated__ladderCaption">{milestone.caption}</div>
                          {isActive ? (
                          <div className="bundle-integrated__ladderNote">
                            {isBest ? "Best price active" : "Next up"}
                          </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="bundle-integrated__ladderProof">{MISSION_SOCIAL_PROOF}</div>
                </div>

                <div className="bundle-integrated__mission">
                  <div className="bundle-integrated__missionHeader">
                    <span>Savings progress</span>
                    <span>Progress: {missionProgressCount}/{topMilestone.qty} bags</span>
                  </div>
                  <div className="bundle-integrated__missionCopy">
                    8 bags is the most picked price point.
                  </div>
                  <div className="mission-bar" aria-hidden="true">
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
                  <div className="bundle-integrated__missionBadges">
                    {[
                      { qty: 4, label: "Savings unlocked" },
                      { qty: 5, label: "Free shipping unlocked" },
                      { qty: 8, label: "Most picked unlocked" },
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
                            "bundle-integrated__missionBadge",
                            unlocked ? "bundle-integrated__missionBadge--active" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {badge.label}
                        </span>
                      );
                    })}
                  </div>
                  <div className="bundle-integrated__missionActions">
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
                      <span className="bundle-integrated__missionDone">
                        {missionCtaLabel}
                      </span>
                    )}
                  </div>
                  <div className="bundle-integrated__missionNote">{mysteryBonusLine}</div>
                </div>

                {showHowItWorks ? (
                  <div className="bundle-integrated__how">
                    <div className="text-[11px] font-semibold">
                      How pricing works: selections add bags to your cart. They do not replace it.
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] font-semibold text-[var(--text)]">
                        Learn more
                      </summary>
                      <div className="mt-1 text-[11px] text-[var(--muted)]">
                      Savings start at 4 bags, free shipping starts at 5 bags, and per-bag pricing caps at {perBagCapText} after 12+ bags.{" "}
                        <Link href="/faq" className="underline underline-offset-2">
                          Read the FAQ
                        </Link>
                        .
                      </div>
                    </details>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="bundle-integrated__select">
            <div className="bundle-integrated__selectHeader">Choose your bag count</div>
            <div className="bundle-integrated__cards" role="radiogroup" aria-label="Bag count">
              {primaryTiers.map((tier) => renderRow(tier))}
            </div>

            <div
              className={[
                "bundle-integrated__cta",
                !isCompact ? "bundle-integrated__cta--sticky" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              ref={ctaRef}
            >
              {ctaContent}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      id={anchorId}
      aria-label="Savings pricing"
      data-bundle-root
      className={[
        "relative overflow-hidden scroll-mt-32",
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
      {showAccent ? (
        <Image
          src={accentSrc}
          alt=""
          aria-hidden="true"
          width={1200}
          height={800}
          sizes="(max-width: 768px) 200px, 260px"
          className="bundle-quickbuy__accent"
        />
      ) : null}
      {showAccent ? (
        <div className="bundle-quickbuy__trail" aria-hidden="true">
          <GummyIconRow size={12} className="opacity-90" />
        </div>
      ) : null}
      {isCompact || isFlat ? null : (
        <div className="pointer-events-none absolute inset-0 opacity-12 bg-[radial-gradient(circle_at_10%_16%,rgba(255,255,255,0.22),transparent_36%),radial-gradient(circle_at_86%_8%,rgba(10,60,138,0.3),transparent_44%),linear-gradient(135deg,rgba(214,64,58,0.18),rgba(12,20,38,0.38)),repeating-linear-gradient(135deg,rgba(255,255,255,0.07)_0,rgba(255,255,255,0.07)_8px,transparent_8px,transparent_16px)]" />
      )}
      {isCompact || isFlat ? null : (
        <div className="relative mb-3 h-[2px] rounded-full bg-gradient-to-r from-[#d6403a]/70 via-white/60 to-[#0a3c8a]/65 opacity-85 shadow-[0_0_18px_rgba(255,255,255,0.12)]" />
      )}
      <div
        data-bundle-kicker
        className={[
          "relative text-[10px] font-semibold tracking-[0.26em] uppercase flex items-center gap-2",
          isCompact ? (isLight ? "text-[var(--muted)]" : "text-white/70") : isLight ? "text-[var(--muted)]" : "text-white/75",
        ].join(" ")}
      >
        <span className="inline-flex items-center gap-2">
          <HeroPackIcon size={14} className="opacity-80" />
          <span>USA Gummies</span>
        </span>
        <span>Bundle pricing</span>
      </div>
      <div data-bundle-header className="relative mt-1 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div data-bundle-header-body className="min-w-0 space-y-1.5">
          <div
            data-bundle-title
            className={[
              "font-extrabold flex items-center gap-2 flex-wrap",
              isCompact ? (isLight ? "text-2xl text-[var(--text)]" : "text-2xl text-white") : isLight ? "text-2xl text-[var(--text)]" : "text-2xl text-white",
            ].join(" ")}
          >
            <span>Pick a bag count</span>
            <span className="brand-cluster">
              <span className="brand-cluster__bags">
                <HeroPackIcon size={18} className="brand-cluster__bag opacity-80" />
                <HeroPackIcon size={18} className="brand-cluster__bag opacity-80" />
              </span>
              <GummyIconRow size={12} className={isLight ? "opacity-80" : "opacity-90"} />
            </span>
          </div>
          <div
            data-bundle-sub
            className={[
              "text-xs font-semibold",
              isCompact ? (isLight ? "text-[var(--muted)]" : "text-white/70") : isLight ? "text-[var(--muted)]" : "text-white/75",
            ].join(" ")}
          >
            Add more bags and the per-bag price drops. Pricing applies to your total bag count.
          </div>
      {summaryLine ? (
        <p
          data-bundle-summary
          className={[
            "text-sm max-w-[52ch]",
            isCompact ? (isLight ? "text-[var(--muted)]" : "text-white/65") : isLight ? "text-[var(--muted)]" : "text-white/70",
          ].join(" ")}
        >
          {summaryLine}
        </p>
      ) : null}
          {showEducation ? (
            <>
              <div data-bundle-ladder className="mt-2 grid gap-2 sm:grid-cols-4">
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
                          Best price active
                        </div>
                      ) : isPopularComplete ? (
                        <div
                          className={[
                            "text-[10px] font-semibold",
                            isLight ? "text-[var(--candy-red)]" : "text-[var(--gold)]",
                          ].join(" ")}
                        >
                          Most picked level reached
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div
                data-bundle-proof
                className={[
                  "mt-2 text-[11px] font-semibold",
                  isLight ? "text-[var(--muted)]" : "text-white/70",
                ].join(" ")}
              >
                {MISSION_SOCIAL_PROOF}
              </div>
              <div
                data-bundle-mission
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
                  Savings progress
                </div>
                <div
                  className={[
                    "mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold",
                    isLight ? "text-[var(--text)]" : "text-white/85",
                  ].join(" ")}
                >
                  <span>8 bags is the most picked price point.</span>
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
                <div
                  data-bundle-mission-status
                  className={[
                    "mt-2 text-[11px] font-semibold",
                    isLight ? "text-[var(--text)]" : "text-white/85",
                  ].join(" ")}
                >
                  {bestPriceReached
                    ? "Best price applied"
                    : `Progress: ${missionProgressCount}/${topMilestone.qty} bags`}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold">
                  {[
                    { qty: 4, label: "Savings unlocked" },
                    { qty: 5, label: "Free shipping unlocked" },
                      { qty: 8, label: "Most picked unlocked" },
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
            </>
          ) : null}
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
      {showEducation && showHowItWorks ? (
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
        data-bundle-pretrust
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
          <span aria-hidden="true">✅</span>
          <span>Satisfaction guaranteed</span>
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
          <span aria-hidden="true">🚚</span>
          <span>Ships within 24 hours</span>
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
          <span aria-hidden="true">🔒</span>
          <span>Secure checkout</span>
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

      {!isCompact ? (
        <div data-bundle-grid className="relative mt-3">
          <div
            className="flex flex-col gap-2"
            role="radiogroup"
            aria-label="Bag count"
          >
            {primaryTiers.map((tier) => renderRow(tier))}
          </div>
        </div>
      ) : null}

      <div
        data-bundle-cta
        className={[
          isFlat ? "mt-4 rounded-2xl border p-4" : "mt-5 rounded-2xl border p-3 sm:p-3.5",
          isFlat
            ? isLight
              ? "border-[rgba(15,27,45,0.12)] bg-white"
              : "border-white/12 bg-white/5"
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
        {ctaContent}
      </div>

    </section>
  );
}
