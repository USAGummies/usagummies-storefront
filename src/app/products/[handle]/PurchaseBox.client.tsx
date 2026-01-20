// src/app/products/[handle]/PurchaseBox.client.tsx (FULL REPLACE)
"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY } from "@/lib/bundles/pricing";
import { SINGLE_BAG_SKU, SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { fireCartToast } from "@/lib/cartFeedback";
import { useCartBagCount } from "@/hooks/useCartBagCount";
import { AmazonOneBagNote } from "@/components/ui/AmazonOneBagNote";
import { AMAZON_REVIEWS } from "@/data/amazonReviews";

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
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

type MoneyLike =
  | { amount: string; currencyCode?: string }
  | { amount: string; currencyCode: string }
  | undefined;

type VariantNode = {
  id: string;
  title: string;
  sku?: string | null;
  availableForSale?: boolean;
  price?: MoneyLike;
  priceV2?: MoneyLike;
  bundleBadge?: { value?: string | null } | null;
};

type Product = {
  title: string;
  handle: string;
  description?: string;
  variants?: { nodes?: VariantNode[] };
  priceRange?: { minVariantPrice?: MoneyLike; maxVariantPrice?: MoneyLike };
};

type BundleOption = {
  qty: number;
  label: string;
  sub: string;
  accent?: boolean;
  variant: VariantNode;
  totalPrice?: number;
  nextTotal?: number;
  nextBags?: number;
  perBag?: number;
  freeShipping: boolean;
  savingsAmount: number;
  savingsPct?: number;
  currencyCode?: string;
};

const VISIBLE_QUANTITIES = [1, 2, 3, 4, 5, 8, 12];
const SAVINGS_LADDER = [
  { qty: 4, label: "Savings start", caption: "4+ bags" },
  { qty: 5, label: "Free shipping", caption: "5+ bags" },
  { qty: 8, label: "Most popular", caption: "8 bags" },
  { qty: 12, label: "Best price", caption: "12 bags" },
];
const MISSION_TARGET_QTY = 8;
const MISSION_SOCIAL_PROOF = "87% of shoppers end at 8 bags.";
const COMPLETE_TARGETS = [5, 8, 12];

function money(amount?: number, currencyCode = "USD") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "--";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function formatQtyLabel(qty: number) {
  return `${qty} bag${qty === 1 ? "" : "s"}`;
}

function formatAddLabel(qty: number) {
  return `+${formatQtyLabel(qty)}`;
}

function badgeForTotal(qty: number) {
  if (qty === 4) return "Starter savings";
  if (qty === 5) return "Free shipping";
  if (qty === 8) return "Most popular";
  if (qty === 12) return "Bulk savings";
  return "";
}

// Parse bundle quantity from Shopify variant titles like:
// "5 bag Starter Bundle for $23.99 ..."
// "2 bags for $9.98 ..."
// "Single bag for ..."
function parseQtyFromTitle(title?: string): number | undefined {
  const t = (title || "").toLowerCase();

  if (t.includes("single")) return 1;

  const m1 = t.match(/(\d+)\s*(?:bag|bags)\b/); // "5 bag", "2 bags"
  if (m1?.[1]) {
    const n = Number(m1[1]);
    return Number.isFinite(n) ? n : undefined;
  }

  // Fallback: first integer in title
  const m2 = t.match(/(\d+)/);
  if (m2?.[1]) {
    const n = Number(m2[1]);
    return Number.isFinite(n) ? n : undefined;
  }

  return undefined;
}

function pickSingleVariant(variants: VariantNode[]) {
  const byId = variants.find((v) => v.id === SINGLE_BAG_VARIANT_ID);
  if (byId) return byId;
  const bySku = variants.find((v) => (v.sku || "").toString() === SINGLE_BAG_SKU);
  if (bySku) return bySku;
  const matches = variants.filter((v) => parseQtyFromTitle(v.title) === 1);
  const avail = matches.find((v) => v.availableForSale !== false);
  return avail || matches[0];
}

export default function PurchaseBox({
  product,
  focus,
}: {
  product: Product;
  focus?: string;
}) {
  const router = useRouter();
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
      ? `Complete the mission: add ${missionRemaining} bag${missionRemaining === 1 ? "" : "s"} (total ${MISSION_TARGET_QTY})`
      : "Most popular mission complete";
  const mysteryBonusLine = bestPriceReached
    ? "Mystery extra revealed: Patriot Pride sticker (while supplies last)."
    : "Mystery extra unlocks at 12 bags.";

  const variants = (product?.variants?.nodes || []) as VariantNode[];
  // Canonical ladder. Expose 1-3 bags plus core bundle sizes on-site.
  const ladder = useMemo(() => {
    return VISIBLE_QUANTITIES.map((qty) => {
      const accent = [4, 5, 8, 12].includes(qty);
      return { qty, label: formatQtyLabel(qty), sub: "", accent };
    });
  }, []);

  const singleVariant = useMemo(() => pickSingleVariant(variants), [variants]);

  const baselineCurrency =
    (singleVariant?.price as any)?.currencyCode ||
    (singleVariant?.priceV2 as any)?.currencyCode ||
    (product?.priceRange?.minVariantPrice as any)?.currencyCode ||
    "USD";

  const availableTiers = useMemo(() => ladder, [ladder]);

  const bundleOptions = useMemo<BundleOption[]>(() => {
    if (!singleVariant?.id) return [];

    return availableTiers.map((t) => {
      const nextBags = currentBags + t.qty;
      const pricing = pricingForQty(nextBags);
      const nextTotal = Number.isFinite(pricing.total) ? pricing.total : undefined;
      const addTotal = Math.max(0, (nextTotal ?? 0) - currentTotal);
      const perBag = Number.isFinite(pricing.perBag) ? pricing.perBag : undefined;
      const savingsAmount = Math.max(0, BASE_PRICE * nextBags - (nextTotal ?? 0));
      const savingsPct =
        nextTotal && savingsAmount > 0
          ? (savingsAmount / (BASE_PRICE * nextBags)) * 100
          : undefined;

      return {
        ...t,
        variant: singleVariant,
        totalPrice: addTotal,
        nextTotal,
        nextBags,
        perBag,
        freeShipping: nextBags >= FREE_SHIP_QTY,
        savingsAmount,
        savingsPct,
        currencyCode: baselineCurrency,
        accent: t.accent,
      };
    });
  }, [availableTiers, singleVariant, baselineCurrency, currentBags, currentTotal]);

  const featuredQuantities = [4, 5, 8, 12];

  const featuredOptions = useMemo<BundleOption[]>(() => {
    if (!bundleOptions.length) return [];

    const ordered = featuredQuantities
      .map((qty) => bundleOptions.find((o) => o.qty === qty))
      .filter(Boolean) as BundleOption[];

    const fallback = bundleOptions.slice(0, 3);
    return ordered.length ? ordered : fallback;
  }, [bundleOptions]);

  const extraOptions = useMemo<BundleOption[]>(() => {
    if (!bundleOptions.length) return [];
    const featuredIds = new Set(featuredOptions.map((o) => o.qty));
    return bundleOptions
      .filter((o) => !featuredIds.has(o.qty))
      .sort((a, b) => a.qty - b.qty);
  }, [bundleOptions, featuredOptions]);

  const defaultQty = useMemo(() => {
    const preferred = [8, 5, 4, 12];
    for (const qty of preferred) {
      if (bundleOptions.some((o) => o.qty === qty)) return qty;
    }
    return bundleOptions[0]?.qty || 1;
  }, [bundleOptions]);

  const [selectedQty, setSelectedQty] = useState<number>(defaultQty);
  const [addingQty, setAddingQty] = useState<number | null>(null);
  const [lastAddedQty, setLastAddedQty] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  // Keep selection valid as data hydrates
  useEffect(() => {
    if (!bundleOptions.length) return;
    setSelectedQty((prev) => {
      if (bundleOptions.some((o) => o.qty === prev)) return prev;
      return defaultQty;
    });
  }, [bundleOptions, defaultQty]);

  const bundlesRef = useRef<HTMLDivElement | null>(null);
  const [focusGlow, setFocusGlow] = useState(false);

  useEffect(() => {
    if (focus === "bundles") {
      setTimeout(() => {
        const prefersReduced =
          typeof window !== "undefined" &&
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        bundlesRef.current?.scrollIntoView({
          behavior: prefersReduced ? "auto" : "smooth",
          block: "start",
        });
        setFocusGlow(true);
        setTimeout(() => setFocusGlow(false), 1400);
      }, 120);
    }
  }, [focus]);

  const selectedOption = bundleOptions.find((o) => o.qty === selectedQty) ?? bundleOptions[0];

  const selectedVariant = selectedOption?.variant ?? pickSingleVariant(variants);
  const optionQty = selectedOption?.qty ?? selectedQty ?? 1;
  const selectedAddTotal = selectedOption?.totalPrice ?? 0;
  const selectedNextTotal = selectedOption?.nextTotal ?? 0;
  const selectedNextBags = selectedOption?.nextBags ?? currentBags + optionQty;
  const selectedCurrency =
    (selectedVariant?.price as any)?.currencyCode ||
    (selectedVariant?.priceV2 as any)?.currencyCode ||
    baselineCurrency;
  const completeTargets = useMemo(() => {
    if (currentBags >= COMPLETE_TARGETS[COMPLETE_TARGETS.length - 1]) return [];
    return COMPLETE_TARGETS.filter((target) => target > currentBags).map((target) => {
      const addQty = Math.max(1, target - currentBags);
      const targetPricing = pricingForQty(target);
      const addTotal = Math.max(0, targetPricing.total - currentTotal);
      return {
        target,
        addQty,
        addTotalText: money(addTotal, selectedCurrency),
      };
    });
  }, [currentBags, currentTotal, selectedCurrency]);
  const selectedPriceText = money(selectedAddTotal, selectedCurrency);
  const selectedNextTotalText = money(selectedNextTotal, selectedCurrency);
  const hasAdded = lastAddedQty !== null;
  const selectedAdded = hasAdded && lastAddedQty === optionQty;
  const isAdding = addingQty !== null;
  const ctaLabel = isAdding
    ? "Adding..."
    : selectedAdded
      ? `Added ${formatQtyLabel(optionQty)} (total ${selectedNextBags})`
      : `Add ${formatQtyLabel(optionQty)} (total ${selectedNextBags})`;

  const hasExtraSelected = extraOptions.some((o) => o.qty === selectedQty);
  const showExtras = showMore || hasExtraSelected;
  const toggleExtrasLabel = hasExtraSelected
    ? "Smaller quantities selected"
    : showExtras
      ? "Hide smaller quantities"
      : "Need fewer bags?";

  const radioOptions = useMemo(() => {
    return showExtras ? [...featuredOptions, ...extraOptions] : featuredOptions;
  }, [showExtras, featuredOptions, extraOptions]);

  const radioIndexByQty = useMemo(() => {
    const map = new Map<number, number>();
    radioOptions.forEach((o, idx) => map.set(o.qty, idx));
    return map;
  }, [radioOptions]);

  const radioRefs = useRef<Array<HTMLElement | null>>([]);

  function handleRadioKey(index: number) {
    return (event: KeyboardEvent<HTMLElement>) => {
      if (!radioOptions.length) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const qty = radioOptions[index]?.qty;
        if (qty) setSelectedQty(qty);
        return;
      }
      if (["ArrowRight", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const nextIndex = (index + 1) % radioOptions.length;
        const nextQty = radioOptions[nextIndex]?.qty;
        if (nextQty) {
          setSelectedQty(nextQty);
          requestAnimationFrame(() => radioRefs.current[nextIndex]?.focus());
        }
      }
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const nextIndex = (index - 1 + radioOptions.length) % radioOptions.length;
        const nextQty = radioOptions[nextIndex]?.qty;
        if (nextQty) {
          setSelectedQty(nextQty);
          requestAnimationFrame(() => radioRefs.current[nextIndex]?.focus());
        }
      }
    };
  }

  async function addToCart(targetQty?: number) {
    setError(null);
    const qty = Math.max(1, Number(targetQty ?? selectedQty) || 1);

    if (!selectedVariant?.id) {
      setError("No purchasable variant found for this product.");
      return;
    }

    if (selectedVariant.availableForSale === false) {
      setError("Out of stock.");
      return;
    }

    if (bundleOptions.some((o) => o.qty === qty)) {
      setSelectedQty(qty);
    }

    setAddingQty(qty);
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
          variantId: selectedVariant.id,
          quantity: qty,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Cart request failed");
      }
      if (json?.cart?.id) storeCartId(json.cart.id);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("cart:updated"));
      }
      fireCartToast(qty);
      setLastAddedQty(qty);
      router.push("/cart");
      router.refresh();
    } catch {
      setError("Couldn't add to cart. Please try again.");
    } finally {
      setAddingQty(null);
    }
  }

  const cardHint =
    currentBags > 0
      ? `In your cart: ${currentBags} bags. Selecting a size adds that many bags.`
      : "Selecting a size adds that many bags to your cart. More bags = lower price per bag.";

  return (
    <section data-purchase-section="true" className="pbx pbx--metal">
      {/* Savings ladder */}
      <div
        ref={bundlesRef}
        className={cx("pbx__card", focusGlow && "pbx__glow")}
        aria-label="Bag count selection"
      >
        <div className="pbx__cardHeader">
          <div>
            <div className="pbx__cardTitle">Pick your bag count</div>
            <div className="pbx__cardHint">
              {cardHint}
            </div>
          </div>
        </div>

        <div className="pbx__ladder">
          <div className="pbx__ladderTitle">Savings ladder</div>
          <div className="pbx__ladderGrid">
            {SAVINGS_LADDER.map((milestone) => {
              const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
              const isBest = bestPriceReached && milestone.qty === topMilestone.qty;
              const isReached = currentBags >= milestone.qty;
              const isPopularComplete =
                milestone.qty === MISSION_TARGET_QTY && currentBags >= milestone.qty;
              return (
                <div
                  key={milestone.qty}
                  className={cx(
                    "pbx__ladderItem",
                    (isNext || isBest) && "pbx__ladderItem--next",
                    isReached && !(isNext || isBest) && "pbx__ladderItem--reached"
                  )}
                >
                  <div className="pbx__ladderLabel">{milestone.label}</div>
                  <div className="pbx__ladderCaption">{milestone.caption}</div>
                  {isNext ? (
                    <div className="pbx__ladderNext">Next up</div>
                  ) : isBest ? (
                    <div className="pbx__ladderNext">Best price applied</div>
                  ) : isPopularComplete ? (
                    <div className="pbx__ladderNext">Most popular mission complete</div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="pbx__ladderProof">{MISSION_SOCIAL_PROOF}</div>
        </div>

        <div className="pbx__mission">
          <div className="pbx__missionHeader">
            <div className="pbx__missionTitle">Mission to savings</div>
            <div className="pbx__missionProgress">
              Progress: {missionProgressCount}/{topMilestone.qty} bags
            </div>
          </div>
          <div className="pbx__missionCopy">
            Hit 8 bags to unlock the crowd-favorite price.
          </div>
          <div className="pbx__missionBar">
            <div className="mission-bar" aria-hidden="true">
              <div className="mission-bar__fill" style={{ width: `${missionProgressPct}%` }} />
              {SAVINGS_LADDER.map((milestone) => {
                const left = (milestone.qty / topMilestone.qty) * 100;
                const reached = currentBags >= milestone.qty;
                const isNext = !bestPriceReached && milestone.qty === nextMilestone.qty;
                return (
                  <span
                    key={milestone.qty}
                    className={cx(
                      "mission-bar__tick",
                      reached && "mission-bar__tick--reached",
                      isNext && "mission-bar__tick--next"
                    )}
                    style={{ left: `${left}%` }}
                  />
                );
              })}
            </div>
          </div>
          <div className="pbx__missionActions">
            {missionRemaining > 0 ? (
              <button
                type="button"
                onClick={() => addToCart(missionRemaining)}
                disabled={addingQty !== null}
                className="btn btn-candy pressable pbx__missionCta"
              >
                {addingQty ? "Adding..." : missionCtaLabel}
              </button>
            ) : (
              <span className="pbx__missionBadge">{missionCtaLabel}</span>
            )}
          </div>
          <div className="pbx__missionList">
            <div className="pbx__missionListTitle">Finish your bag count</div>
            {[
              { qty: 4, label: "Savings pricing unlocked" },
              { qty: 5, label: "Free shipping unlocked" },
              { qty: 8, label: "Crowd-favorite price unlocked" },
              {
                qty: 12,
                label: bestPriceReached
                  ? "Patriot Pride sticker revealed"
                  : "Mystery extra unlocks",
              },
            ].map((item) => {
              const done = currentBags >= item.qty;
              return (
                <div
                  key={item.qty}
                  className={cx("pbx__missionItem", done && "pbx__missionItem--done")}
                >
                  <span className="pbx__missionDot" aria-hidden="true">
                    {done ? (
                      <svg viewBox="0 0 24 24" className="pbx__missionCheck" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M9.2 16.2 5.5 12.5l1.4-1.4 2.3 2.3 7.2-7.2 1.4 1.4z"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span>
                    {item.label}
                    {item.qty === 12 ? " (12 bags)" : ` (${item.qty}+ bags)`}
                  </span>
                </div>
              );
            })}
            <div className="pbx__missionBonus">{mysteryBonusLine}</div>
          </div>
        </div>

        <div className="pbx__complete">
          <div className="pbx__completeTitle">Complete your savings</div>
          {completeTargets.length ? (
            <div className="pbx__completeGrid">
              {completeTargets.map((target) => (
                <button
                  key={target.target}
                  type="button"
                  onClick={() => addToCart(target.addQty)}
                  disabled={addingQty !== null}
                  className="pbx__completeBtn"
                >
                  <span className="pbx__completeLabel">
                    Add {target.addQty} bag{target.addQty === 1 ? "" : "s"} (total {target.target})
                  </span>
                  <span className="pbx__completePrice">
                    {target.addTotalText ? `+${target.addTotalText}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="pbx__completeBadge">Best price unlocked.</div>
          )}
        </div>

        <div className="pbx__freeShip">
          Free shipping at 5+ bags (based on your total)
        </div>

        <div className="pbx__pricingNote">
          <div className="pbx__pricingLine">
            How pricing works: selections add bags, never replace your cart.
          </div>
          <details className="pbx__pricingDetails">
            <summary className="pbx__pricingSummary">Learn more</summary>
            <div className="pbx__pricingBody">
              Savings start at 4 bags, free shipping unlocks at 5 bags, and the best per-bag price
              shows up at 12 bags.{" "}
              <Link href="/faq" className="pbx__pricingLink">
                Read the FAQ
              </Link>
              .
            </div>
          </details>
        </div>

        <div className="pbx__options">
          <div className="pbx__optionGroup" role="radiogroup" aria-label="Bag counts">
            <div className="pbx__featured">
            {featuredOptions.map((o) => {
              const active = selectedQty === o.qty;
              const badge = badgeForTotal(o.nextBags ?? o.qty);
              const index = radioIndexByQty.get(o.qty) ?? 0;
              const popular = (o.nextBags ?? o.qty) === 8;
              const isAdded = lastAddedQty === o.qty;
              const isAddingThis = addingQty === o.qty;
              const tileCtaLabel = isAddingThis
                ? "Adding..."
                : isAdded
                  ? "Added"
                  : hasAdded
                    ? `Add ${formatQtyLabel(o.qty)} more`
                    : `Add ${formatQtyLabel(o.qty)}`;

              return (
                <div
                  key={`${o.qty}-${o.variant.id}`}
                  onClick={() => setSelectedQty(o.qty)}
                  onKeyDown={handleRadioKey(index)}
                  ref={(el) => {
                    radioRefs.current[index] = el;
                  }}
                  className={cx("pbx__tile", popular && "pbx__tile--popular", active && "pbx__tile--active")}
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                >
                  <div className="pbx__tileHeader">
                    <span className="pbx__tileQty">{formatAddLabel(o.qty)}</span>
                    {badge ? (
                      <span className={cx("pbx__badge", popular && "pbx__badge--popular")}>
                        {badge}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    New total: {o.nextBags ?? currentBags + o.qty} bags
                  </div>

                  <div className="pbx__tilePriceRow">
                    <div className="pbx__tilePrice">+{money(o.totalPrice, o.currencyCode)}</div>
                    <div className="pbx__tilePer">
                      Total after add: {money(o.nextTotal, o.currencyCode)} - ~{money(o.perBag, o.currencyCode)} / bag
                    </div>
                  </div>

                  <div className="pbx__tileMeta">
                    {o.savingsAmount > 0 ? (
                      <span className="pbx__tileSave">Save {money(o.savingsAmount, o.currencyCode)} total</span>
                    ) : (
                      <span className="pbx__tileSave pbx__tileSave--muted">Standard price</span>
                    )}
                    {o.freeShipping ? <span className="pbx__tileShip">Free shipping</span> : null}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      addToCart(o.qty);
                    }}
                    disabled={isAdding}
                    className={cx(
                      "pbx__tileCta",
                      isAdded && "pbx__tileCta--added",
                      hasAdded && !isAdded && "pbx__tileCta--upgrade"
                    )}
                  >
                    {tileCtaLabel}
                  </button>
                </div>
              );
            })}
            </div>
            {showExtras ? (
              <div className="pbx__miniRow">
                {extraOptions.map((o) => {
                  const active = selectedQty === o.qty;
                  const label = formatAddLabel(o.qty);
                  const index = radioIndexByQty.get(o.qty) ?? 0;

                  return (
                    <button
                      key={`mini-${o.qty}-${o.variant.id}`}
                      type="button"
                      onClick={() => setSelectedQty(o.qty)}
                      onKeyDown={handleRadioKey(index)}
                      ref={(el) => {
                        radioRefs.current[index] = el;
                      }}
                      className={cx("pbx__miniBtn", active && "pbx__miniBtn--active")}
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                    >
                      <span className="pbx__miniQty">{label}</span>
                      <span className="pbx__miniPrice">+{money(o.totalPrice, o.currencyCode)}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {extraOptions.length ? (
            <div className="pbx__more">
              <button
                type="button"
                className="pbx__moreLink"
                onClick={() => setShowMore((prev) => !prev)}
                disabled={hasExtraSelected}
              >
                {toggleExtrasLabel}
              </button>
            </div>
          ) : null}
        </div>

        <div className="pbx__summary" aria-live="polite" role="status">
          <div className="pbx__summaryMeta">
            <div className="pbx__summaryLabel">
              {selectedAdded ? "Added" : "Add"} {formatQtyLabel(optionQty)}
            </div>
            <div className="pbx__summaryPrice">+{selectedPriceText}</div>
            {currentBags > 0 ? (
              <div className="pbx__summaryStatus pbx__summaryStatus--muted">
                New total: {selectedNextBags} bags - {selectedNextTotalText}
              </div>
            ) : null}
            {selectedAdded ? (
              <div className="pbx__summaryStatus pbx__summaryStatus--success">Bags added to cart.</div>
            ) : null}
            {error ? <div className="pbx__error">{error}</div> : null}
          </div>

          <button
            type="button"
            disabled={isAdding}
            onClick={() => addToCart()}
            className={cx("pbx__cta", "pbx__cta--primary")}
          >
            {isAdding ? (
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
                />
                Adding...
              </span>
            ) : (
              ctaLabel
            )}
          </button>
          <div className="pbx__ctaNote" aria-live="polite">
            Love it or your money back - Ships within 24 hours - Limited daily production
          </div>
          <AmazonOneBagNote className="pbx__amazonNote" />
          <div className="pbx__trust">
            <div className="pbx__trustRating">
              ⭐ {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers
            </div>
            <div className="pbx__trustBadges">
              <span>Made in the USA</span>
              <span>No artificial dyes</span>
              <span>Money-back guarantee</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .pbx{ display:block; color: var(--text); }
        .pbx--metal{
          --surface: #ffffff;
          --surface-strong: #fffdf8;
          --text: #1c2430;
          --muted: #5f5b56;
          --border: rgba(15,27,45,0.12);
        }
        .pbx__card{
          margin-top:14px;
          border-radius:18px;
          border:1px solid var(--border);
          background: var(--surface-strong);
          padding:14px;
          box-shadow: 0 18px 40px rgba(15,27,45,0.12);
        }
        .pbx__glow{
          outline: 2px solid rgba(239,59,59,0.25);
          box-shadow: 0 0 0 6px rgba(239,59,59,0.08), 0 18px 55px rgba(15,27,45,0.12);
        }
        .pbx__cardHeader{
          display:flex; gap:10px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap;
        }
        .pbx__cardTitle{ font-weight:950; font-size:16px; color: var(--text); }
        .pbx__cardHint{ font-size:13px; color: var(--muted); }
        .pbx__freeShip{
          margin-top:10px;
          font-size:12px;
          font-weight:700;
          color: var(--text);
        }
        .pbx__ladder{
          margin-top:10px;
          display:grid;
          gap:8px;
        }
        .pbx__ladderTitle{
          font-size:10px;
          font-weight:700;
          letter-spacing:0.22em;
          text-transform:uppercase;
          color: var(--muted);
        }
        .pbx__ladderGrid{
          display:grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap:8px;
        }
        .pbx__ladderItem{
          border:1px solid var(--border);
          background: var(--surface);
          border-radius:12px;
          padding:8px;
        }
        .pbx__ladderItem--next{
          border-color: rgba(239,59,59,0.45);
          background: rgba(239,59,59,0.08);
        }
        .pbx__ladderItem--reached{
          opacity:0.9;
        }
        .pbx__ladderLabel{
          font-size:10px;
          text-transform:uppercase;
          letter-spacing:0.18em;
          color: var(--muted);
        }
        .pbx__ladderCaption{
          font-size:12px;
          font-weight:700;
          color: var(--text);
        }
        .pbx__ladderNext{
          margin-top:2px;
          font-size:10px;
          font-weight:700;
          color: var(--red);
        }
        .pbx__ladderProof{
          font-size:11px;
          font-weight:600;
          color: var(--muted);
        }
        .pbx__mission{
          margin-top:10px;
          border:1px solid var(--border);
          background: var(--surface);
          border-radius:12px;
          padding:10px;
        }
        .pbx__missionHeader{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          flex-wrap:wrap;
        }
        .pbx__missionTitle{
          font-size:10px;
          font-weight:700;
          letter-spacing:0.22em;
          text-transform:uppercase;
          color: var(--muted);
        }
        .pbx__missionProgress{
          font-size:11px;
          font-weight:700;
          color: var(--text);
        }
        .pbx__missionCopy{
          margin-top:4px;
          font-size:12px;
          font-weight:600;
          color: var(--muted);
        }
        .pbx__missionBar{ margin-top:8px; }
        .pbx__missionActions{
          margin-top:10px;
          display:flex;
          flex-wrap:wrap;
          gap:8px;
        }
        .pbx__missionCta{
          font-size:12px;
          padding:8px 14px;
        }
        .pbx__missionBadge{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          border-radius:999px;
          border:1px solid rgba(239,59,59,0.4);
          background: rgba(239,59,59,0.12);
          color: var(--red);
          font-size:10px;
          font-weight:700;
          letter-spacing:0.08em;
          text-transform:uppercase;
          padding:6px 10px;
        }
        .pbx__missionList{
          margin-top:10px;
          display:grid;
          gap:6px;
        }
        .pbx__missionListTitle{
          font-size:10px;
          font-weight:700;
          letter-spacing:0.22em;
          text-transform:uppercase;
          color: var(--muted);
        }
        .pbx__missionItem{
          display:flex;
          align-items:center;
          gap:8px;
          font-size:12px;
          font-weight:600;
          color: var(--muted);
        }
        .pbx__missionItem--done{
          color: var(--text);
        }
        .pbx__missionDot{
          width:16px;
          height:16px;
          border-radius:999px;
          border:1px solid rgba(15,27,45,0.2);
          background: #ffffff;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          color: var(--muted);
        }
        .pbx__missionItem--done .pbx__missionDot{
          border-color: rgba(239,59,59,0.5);
          background: rgba(239,59,59,0.16);
          color: var(--red);
        }
        .pbx__missionCheck{
          width:12px;
          height:12px;
        }
        .pbx__missionBonus{
          margin-top:4px;
          font-size:11px;
          color: var(--muted);
        }
        .pbx__complete{
          margin-top:10px;
          border:1px solid var(--border);
          background: var(--surface);
          border-radius:12px;
          padding:10px;
        }
        .pbx__completeTitle{
          font-size:10px;
          font-weight:700;
          letter-spacing:0.22em;
          text-transform:uppercase;
          color: var(--muted);
        }
        .pbx__completeGrid{
          margin-top:8px;
          display:grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap:8px;
        }
        .pbx__completeBtn{
          border-radius:12px;
          border:1px solid rgba(15,27,45,0.12);
          background: var(--surface-strong);
          padding:8px 10px;
          text-align:left;
          font-size:12px;
          font-weight:700;
          color: var(--text);
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          transition: transform .12s ease, border-color .12s ease, box-shadow .12s ease;
        }
        .pbx__completeBtn:hover{
          transform: translateY(-1px);
          border-color: rgba(239,59,59,0.35);
          box-shadow: 0 10px 22px rgba(239,59,59,0.12);
        }
        .pbx__completeBtn:disabled{
          opacity:0.6;
          cursor:not-allowed;
          transform:none;
          box-shadow:none;
        }
        .pbx__completeLabel{
          font-size:12px;
          font-weight:700;
          color: var(--text);
        }
        .pbx__completePrice{
          font-size:11px;
          font-weight:600;
          color: var(--muted);
          white-space:nowrap;
        }
        .pbx__completeBadge{
          margin-top:8px;
          display:inline-flex;
          align-items:center;
          gap:6px;
          border-radius:999px;
          border:1px solid rgba(239,59,59,0.4);
          background: rgba(239,59,59,0.12);
          color: var(--red);
          font-size:11px;
          font-weight:700;
          padding:6px 10px;
        }
        .pbx__pricingNote{
          margin-top:10px;
          border:1px solid var(--border);
          background: var(--surface);
          border-radius:12px;
          padding:10px;
          font-size:12px;
          color: var(--muted);
        }
        .pbx__pricingLine{ font-weight:700; color: var(--text); }
        .pbx__pricingDetails{ margin-top:6px; }
        .pbx__pricingSummary{ cursor:pointer; font-weight:700; color: var(--text); }
        .pbx__pricingBody{ margin-top:4px; }
        .pbx__pricingLink{
          text-decoration: underline;
          text-underline-offset: 3px;
          color: var(--text);
        }

        .pbx__options{ margin-top:10px; }
        .pbx__optionGroup{ display:flex; flex-direction:column; gap:12px; }
        .pbx__featured{
          display:grid;
          gap:14px;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }

        .pbx__tile{
          width:100%;
          min-height:190px;
          text-align:left;
          border-radius:12px;
          border:1px solid var(--border);
          background: var(--surface);
          padding:16px;
          cursor:pointer;
          display:flex;
          flex-direction:column;
          gap:8px;
          transition: border-color .14s ease-out, box-shadow .14s ease-out, background .14s ease-out, transform .14s ease-out;
        }
        .pbx__tile:hover{
          border-color: rgba(13,28,51,0.2);
          box-shadow: 0 16px 34px rgba(15,27,45,0.12);
        }
        .pbx__tile:active{ transform: scale(0.98); }
        .pbx__tile:focus-visible{
          outline: 3px solid rgba(13,28,51,0.3);
          outline-offset: 2px;
        }
        .pbx__tile--popular{
          border-color: rgba(239,59,59,0.35);
          background: rgba(239,59,59,0.04);
          box-shadow: 0 12px 26px rgba(239,59,59,0.12);
          position: relative;
          z-index: 1;
        }
        .pbx__tile--active{
          border-color: rgba(239,59,59,0.65);
          background: rgba(239,59,59,0.07);
          box-shadow: 0 0 0 2px rgba(239,59,59,0.35), 0 18px 44px rgba(239,59,59,0.18);
        }

        .pbx__tileHeader{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
        }
        .pbx__tileQty{ font-weight:800; font-size:16px; color: var(--text); }
        .pbx__badge{
          border-radius:999px;
          padding:4px 8px;
          border:1px solid rgba(13,28,51,0.12);
          background: rgba(13,28,51,0.06);
          font-size:12px;
          font-weight:700;
          color: var(--navy);
        }
        .pbx__badge--popular{
          border-color: rgba(239,59,59,0.5);
          background: rgba(239,59,59,0.12);
          color: var(--red);
        }
        .pbx__tilePriceRow{
          display:flex;
          flex-direction:column;
          align-items:flex-start;
          gap:4px;
        }
        .pbx__tilePrice{ font-weight:900; font-size:30px; line-height:1.1; color: var(--text); }
        .pbx__tilePer{ font-size:14px; font-weight:600; color: var(--muted); }
        .pbx__tileMeta{
          margin-top:auto;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          font-size:12px;
        }
        .pbx__tileSave{ font-weight:700; color: var(--red); }
        .pbx__tileSave--muted{ color: var(--muted); }
        .pbx__tileShip{ color: var(--muted); font-weight:600; }
        .pbx__tileCta{
          margin-top:10px;
          align-self:flex-start;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:6px;
          border-radius:999px;
          border:1px solid rgba(13,28,51,0.16);
          background: rgba(13,28,51,0.06);
          padding:6px 12px;
          font-size:11px;
          font-weight:800;
          color: var(--text);
          transition: transform .08s ease, border-color .14s ease, background .14s ease, opacity .14s ease;
        }
        .pbx__tileCta:hover{
          border-color: rgba(239,59,59,0.3);
          background: rgba(239,59,59,0.08);
        }
        .pbx__tileCta:active{ transform: translateY(1px); }
        .pbx__tileCta:disabled{ opacity: 0.6; cursor: not-allowed; }
        .pbx__tileCta--added{
          border-color: rgba(34,197,94,0.35);
          background: rgba(34,197,94,0.12);
          color: rgba(21,128,61,0.95);
        }
        .pbx__tileCta--upgrade{
          border-color: rgba(239,59,59,0.35);
          background: rgba(239,59,59,0.1);
          color: var(--red);
        }

        .pbx__more{ margin-top:10px; }
        .pbx__moreLink{
          font-size:12px;
          font-weight:600;
          color: var(--muted);
          text-decoration: underline;
          text-underline-offset: 3px;
          background: none;
          border: none;
          padding: 0;
        }
        .pbx__moreLink:disabled{ opacity: 0.5; cursor: default; }
        .pbx__miniRow{
          margin-top:10px;
          display:flex;
          flex-wrap:wrap;
          gap:8px;
        }
        .pbx__miniBtn{
          border:1px solid var(--border);
          border-radius:999px;
          padding:6px 10px;
          background: var(--surface);
          display:inline-flex;
          align-items:center;
          gap:8px;
          font-size:12px;
          font-weight:800;
          color: var(--text);
          transition: transform .08s ease, border-color .14s ease, background .14s ease;
        }
        .pbx__miniBtn:hover{ transform: translateY(-1px); }
        .pbx__miniBtn--active{
          border-color: rgba(239,59,59,0.55);
          background: rgba(239,59,59,0.08);
          color: var(--red);
        }
        .pbx__miniQty{ font-weight:900; }
        .pbx__miniPrice{
          font-size:11px;
          font-weight:700;
          color: var(--muted);
        }

        .pbx__summary{
          margin-top:24px;
          border-radius:16px;
          border:1px solid var(--border);
          background: var(--surface);
          padding:14px;
          display:grid;
          gap:12px;
          position: relative;
        }
        @media (min-width: 768px){
          .pbx__summary{
            grid-template-columns: 1fr auto;
            align-items:center;
            position: sticky;
            bottom: 12px;
          }
        }
        .pbx__summaryMeta{ min-width:0; }
        .pbx__summaryLabel{ font-size:14px; font-weight:600; color: var(--muted); }
        .pbx__summaryPrice{ font-weight:900; font-size:24px; color: var(--text); margin-top:4px; }
        .pbx__summaryStatus{
          margin-top:6px;
          font-size:12px;
          font-weight:700;
          color: var(--text);
        }
        .pbx__summaryStatus--muted{ color: var(--muted); }
        .pbx__summaryStatus--success{ color: rgba(21,128,61,0.95); }
        .pbx__error{
          margin-top:8px;
          font-size:13px;
          font-weight:900;
          color: rgba(193,18,31,0.95);
        }

        .pbx__cta{
          border:none;
          border-radius:12px;
          padding:0 20px;
          height:54px;
          font-size:16px;
          font-weight:800;
          cursor:pointer;
          transition: transform .08s ease, opacity .18s ease, filter .18s ease;
          white-space:nowrap;
          background: var(--navy);
          color: white;
        }
        .pbx__cta--primary{ background: linear-gradient(180deg, #ff4b4b 0%, #e93b3e 100%); }
        .pbx__cta--primary:hover{ filter: brightness(1.05); }
        .pbx__cta:disabled{ opacity:.65; cursor:not-allowed; }
        .pbx__cta:active{ transform: translateY(1px); }
        .pbx__ctaNote{
          grid-column: 1 / -1;
          font-size:12px;
          color: var(--muted);
        }
        .pbx__amazonNote{
          margin-top:6px;
          font-size:12px;
        }
        .pbx__trust{
          margin-top:10px;
          display:grid;
          gap:6px;
          font-size:11px;
          color: var(--muted);
        }
        .pbx__trustRating{
          font-weight:700;
          color: var(--text);
        }
        .pbx__trustBadges{
          display:flex;
          flex-wrap:wrap;
          gap:6px;
          font-size:10px;
          font-weight:700;
          text-transform:uppercase;
          letter-spacing:0.12em;
          color: var(--muted);
        }
        .pbx__trustBadges span{
          border:1px solid rgba(15,27,45,0.12);
          border-radius:999px;
          padding:4px 8px;
          background: var(--surface);
        }

        @media (max-width: 640px){
          .pbx__featured{ grid-template-columns: 1fr; }
          .pbx__tilePriceRow{
            flex-direction:row;
            align-items:baseline;
            justify-content:space-between;
          }
          .pbx__tilePrice{ font-size:26px; }
          .pbx__summary{ padding:12px; }
          .pbx__cta{ width:100%; justify-content:center; }
          .pbx__miniRow{
            flex-wrap:nowrap;
            overflow-x:auto;
            padding-bottom:6px;
            scrollbar-width:none;
          }
          .pbx__miniRow::-webkit-scrollbar{ display:none; }
        }

        @media (prefers-reduced-motion: reduce){
          .pbx__tile,
          .pbx__tile:hover,
          .pbx__tile--active,
          .pbx__tile--popular{
            transition: none !important;
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>
    </section>
  );
}
