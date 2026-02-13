// src/app/products/[handle]/PurchaseBox.client.tsx (FULL REPLACE)
"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY } from "@/lib/bundles/pricing";
import { SINGLE_BAG_SKU, SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { fireCartToast } from "@/lib/cartFeedback";
import { trackEvent } from "@/lib/analytics";
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

const VISIBLE_QUANTITIES = [5, 8, 12];
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

function badgeForTotal(qty: number) {
  if (qty === 5) return "Save + free shipping";
  if (qty === 8) return "Most popular";
  if (qty === 12) return "Best price";
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
  surface = "card",
  layout = "classic",
}: {
  product: Product;
  focus?: string;
  surface?: "card" | "flat";
  layout?: "classic" | "integrated" | "fusion";
}) {
  const { bagCount } = useCartBagCount();
  const currentBags = Math.max(0, Number(bagCount) || 0);
  const currentPricing = currentBags > 0 ? pricingForQty(currentBags) : null;
  const currentTotal = currentPricing?.total ?? 0;
  const isFlat = surface === "flat";
  const isIntegrated = layout === "integrated";
  const isFusion = layout === "fusion";

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

  const featuredQuantities = [8, 12, 5];

  const featuredOptions = useMemo<BundleOption[]>(() => {
    if (!bundleOptions.length) return [];

    const ordered = featuredQuantities
      .map((qty) => bundleOptions.find((o) => o.qty === qty))
      .filter(Boolean) as BundleOption[];

    const fallback = bundleOptions.slice(0, 3);
    return ordered.length ? ordered : fallback;
  }, [bundleOptions]);

  const defaultQty = useMemo(() => {
    const preferred = [8, 12, 5, 4];
    for (const qty of preferred) {
      if (bundleOptions.some((o) => o.qty === qty)) return qty;
    }
    return bundleOptions[0]?.qty || 1;
  }, [bundleOptions]);

  const [selectedQty, setSelectedQty] = useState<number>(defaultQty);
  const [addingQty, setAddingQty] = useState<number | null>(null);
  const [lastAddedQty, setLastAddedQty] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const selectedNextTotal = selectedOption?.nextTotal ?? 0;
  const selectedNextBags = selectedOption?.nextBags ?? currentBags + optionQty;
  const selectedCurrency =
    (selectedVariant?.price as any)?.currencyCode ||
    (selectedVariant?.priceV2 as any)?.currencyCode ||
    baselineCurrency;
  const selectedNextTotalText = money(selectedNextTotal, selectedCurrency);
  const totalLabel = currentBags > 0 ? "New total" : "Total";
  const selectedSavingsText =
    selectedOption?.savingsAmount && selectedOption.savingsAmount > 0
      ? money(selectedOption.savingsAmount, selectedCurrency)
      : null;
  const regularPerBagText = money(BASE_PRICE, selectedCurrency);
  const regularTotalText =
    selectedNextBags && Number.isFinite(BASE_PRICE)
      ? money(BASE_PRICE * selectedNextBags, selectedCurrency)
      : null;
  const hasRegularLine = Boolean(regularPerBagText && regularTotalText);
  const selectedBadge = badgeForTotal(optionQty);
  const hasAdded = lastAddedQty !== null;
  const selectedAdded = hasAdded && lastAddedQty === optionQty;
  const isAdding = addingQty !== null;
  const ctaLabel = isAdding
    ? "Adding..."
    : selectedAdded
      ? "Added to Cart"
      : `Add ${formatQtyLabel(optionQty)} to Cart`;

  const radioOptions = useMemo(() => {
    return featuredOptions;
  }, [featuredOptions]);

  const radioIndexByQty = useMemo(() => {
    const map = new Map<number, number>();
    radioOptions.forEach((o, idx) => map.set(o.qty, idx));
    return map;
  }, [radioOptions]);

  const radioRefs = useRef<Array<HTMLElement | null>>([]);
  const hasTrackedViewRef = useRef(false);

  useEffect(() => {
    if (hasTrackedViewRef.current) return;
    if (!selectedVariant?.id) return;
    const viewPricing = pricingForQty(optionQty);
    const viewTotal = Number.isFinite(viewPricing.total) ? viewPricing.total : undefined;
    const unitPrice =
      viewTotal && optionQty > 0 ? Number((viewTotal / optionQty).toFixed(2)) : undefined;
    trackEvent("view_item", {
      currency: selectedCurrency,
      value: viewTotal,
      items: [
        {
          item_id: selectedVariant.id,
          item_name: product?.title || "USA Gummies",
          item_variant: selectedVariant.title || undefined,
          item_brand: "USA Gummies",
          item_category: "Gummy Bears",
          price: unitPrice,
          quantity: optionQty,
        },
      ],
    });
    hasTrackedViewRef.current = true;
  }, [optionQty, product?.title, selectedCurrency, selectedVariant?.id, selectedVariant?.title]);

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
      const addValueRaw =
        typeof selectedOption?.totalPrice === "number"
          ? selectedOption.totalPrice
          : Number.isFinite(selectedNextTotal)
            ? selectedNextTotal
            : undefined;
      const addValue = Number.isFinite(addValueRaw ?? NaN)
        ? Number((addValueRaw as number).toFixed(2))
        : undefined;
      const unitPrice =
        addValue && qty > 0 ? Number((addValue / qty).toFixed(2)) : undefined;
      trackEvent("add_to_cart", {
        currency: selectedCurrency,
        value: addValue,
        items: [
          {
            item_id: selectedVariant.id,
            item_name: product?.title || "USA Gummies",
            item_variant: selectedVariant.title || undefined,
            item_brand: "USA Gummies",
            item_category: "Gummy Bears",
            price: unitPrice,
            quantity: qty,
          },
        ],
      });
    } catch {
      setError("Couldn't add to cart. Please try again.");
    } finally {
      setAddingQty(null);
    }
  }

  const curatedStatus =
    selectedNextBags >= 12
      ? "Best price selected."
      : selectedNextBags >= 8
        ? "Most popular bundle selected."
        : "Free shipping bundle selected.";
  const cardHint = curatedStatus;

  return (
    <section
      data-purchase-section="true"
      className={cx(
        "pbx pbx--metal",
        isFlat && "pbx--flat",
        isIntegrated && "pbx--integrated",
        isFusion && "pbx--fusion"
      )}
    >
      {/* Savings ladder */}
      <div
        ref={bundlesRef}
        className={cx("pbx__card", focusGlow && "pbx__glow")}
        aria-label="Bag count selection"
      >
        <div className="pbx__grid">
          <div className="pbx__panel" role="group" aria-label="Bundle selection">
            <div className="pbx__panelTop">
              <div className="pbx__panelTitle">Lock in your savings</div>
              <div className="pbx__panelSub">Best value bundles: 5, 8, and 12 bags.</div>
              <div className="pbx__segmented" role="radiogroup" aria-label="Bag counts">
                {featuredOptions.map((o) => {
                  const active = selectedQty === o.qty;
                  const badge = badgeForTotal(o.nextBags ?? o.qty);
                  const index = radioIndexByQty.get(o.qty) ?? 0;

                  return (
                    <button
                      key={`${o.qty}-${o.variant.id}`}
                      type="button"
                      onClick={() => setSelectedQty(o.qty)}
                      onKeyDown={handleRadioKey(index)}
                      ref={(el) => {
                        radioRefs.current[index] = el;
                      }}
                      className={cx("pbx__segment", active && "pbx__segment--active")}
                      data-qty={o.qty}
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                    >
                      <span className="pbx__segmentQty">
                        {currentBags > 0 ? `Add ${formatQtyLabel(o.qty)}` : formatQtyLabel(o.qty)}
                      </span>
                      {badge ? <span className="pbx__segmentMeta">{badge}</span> : null}
                    </button>
                  );
                })}
              </div>
              <div className="pbx__panelHint">{cardHint}</div>
            </div>

            <div className="pbx__panelMid" aria-live="polite" role="status">
              <Image
                src="/website%20assets/Jeep.png"
                alt="Vintage Jeep illustration"
                aria-hidden="true"
                width={900}
                height={600}
                sizes="140px"
                className="pbx__panelAccent"
              />
              <div className="pbx__panelMeta">
                <span>
                  {currentBags > 0 ? `Add ${formatQtyLabel(optionQty)}` : formatQtyLabel(optionQty)}
                </span>
                {selectedBadge ? <span className="pbx__panelBadge">{selectedBadge}</span> : null}
              </div>
              <div className="pbx__panelTotal">{totalLabel} {selectedNextTotalText}</div>
              {currentBags > 0 ? (
                <div className="pbx__panelNote">
                  Cart: {formatQtyLabel(currentBags)} → {formatQtyLabel(selectedNextBags)} total
                </div>
              ) : null}
              {hasRegularLine || selectedSavingsText ? (
                <div className="pbx__panelSavings">
                  {hasRegularLine ? (
                    <span className="pbx__panelRegular">
                      Regular {regularPerBagText}/bag ·{" "}
                      <span className="pbx__panelStrike">{regularTotalText}</span> total
                    </span>
                  ) : null}
                  {selectedSavingsText ? (
                    <span className="pbx__panelSave">
                      {hasRegularLine ? " · " : ""}Save {selectedSavingsText} total
                    </span>
                  ) : null}
                </div>
              ) : null}

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
                    Locking in...
                  </span>
                ) : (
                  ctaLabel
                )}
              </button>
              {selectedAdded ? (
                <div className="pbx__panelStatus">Bags added to cart.</div>
              ) : null}
              {error ? <div className="pbx__error">{error}</div> : null}
            </div>

            <div className="pbx__panelBottom">
              <div className="pbx__trustLine">
                Ships within 24 hours • Satisfaction guaranteed • Secure checkout
              </div>
              <AmazonOneBagNote className="pbx__amazonNote" />
              <div className="pbx__trustRating">
                {AMAZON_REVIEWS.aggregate.rating.toFixed(1)} stars from verified Amazon buyers
              </div>
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
        .pbx--flat{
          --surface: transparent;
          --surface-strong: transparent;
        }
        .pbx--integrated .pbx__cardHeader{
          margin-bottom: 6px;
        }
        .pbx--fusion .pbx__cardTitle{
          font-size: 13px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
        }
        .pbx--fusion .pbx__cardTitle--gummy{
          gap: 6px;
        }
        .pbx--fusion .pbx__packIcon{
          width: 16px;
          height: 16px;
        }
        .pbx--fusion .pbx__gummyRow{
          transform: scale(0.9);
          transform-origin: left center;
        }
        .pbx--fusion .pbx__cardHint{
          font-size: 12px;
          color: var(--muted);
        }
        .pbx__grid{
          margin-top: 0;
          display: grid;
          gap: 14px;
          align-items: stretch;
        }
        @media (min-width: 1024px){
          .pbx__grid{
            grid-template-columns: minmax(0, 1fr);
          }
        }
        .pbx--flat .pbx__card{
          margin-top:0;
          border:0;
          background: transparent;
          box-shadow:none;
          padding:0;
          border-radius:0;
        }
        .pbx--flat .pbx__ladderItem,
        .pbx--flat .pbx__mission,
        .pbx--flat .pbx__complete,
        .pbx--flat .pbx__pricingNote,
        .pbx--flat .pbx__summary{
          border:0;
          background: transparent;
          box-shadow:none;
          border-radius:0;
        }
        .pbx--flat .pbx__ladderItem{ padding:4px 0; }
        .pbx--flat .pbx__mission{ padding:4px 0; }
        .pbx--flat .pbx__complete{ padding:4px 0; }
        .pbx--flat .pbx__pricingNote{ padding:6px 0; }
        .pbx--flat .pbx__summary{ padding:6px 0; margin-top:12px; }
        .pbx--flat .pbx__missionBadge{
          border:0;
          background: transparent;
          padding:0;
        }
        .pbx--flat .pbx__completeBtn{
          border:0;
          background: transparent;
          box-shadow:none;
          padding:4px 0;
          border-radius:0;
        }
        .pbx--flat .pbx__completeBtn:hover{
          border-color: transparent;
          box-shadow:none;
        }
        .pbx--flat .pbx__ladderItem--next{
          border-color: transparent;
          background: transparent;
        }
        .pbx__card{
          margin-top:14px;
          border-radius:0;
          border:0;
          background: transparent;
          padding:0;
          box-shadow: none;
        }
        .pbx__glow{
          outline: 2px solid rgba(239,59,59,0.25);
          box-shadow: 0 0 0 6px rgba(239,59,59,0.08), 0 18px 55px rgba(15,27,45,0.12);
        }
        .pbx__cardHeader{
          display:flex; gap:10px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap;
        }
        .pbx__cardTitle{ font-weight:950; font-size:16px; color: var(--text); }
        .pbx__cardTitle--gummy{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .pbx__packIcon{ opacity:0.92; filter: drop-shadow(0 8px 14px rgba(13,28,51,0.18)); }
        .pbx__gummyRow{ opacity:0.85; }
        .pbx__cardHint{ font-size:13px; color: var(--muted); }
        .pbx__panel{
          border: 1px solid var(--border);
          border-radius: 24px;
          background: linear-gradient(180deg, #fffdf8 0%, #fff7ee 100%);
          padding: 16px;
          display: grid;
          gap: 14px;
          position: relative;
          overflow: hidden;
          min-height: 100%;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.7),
            0 24px 60px rgba(15,27,45,0.08);
        }
        .pbx__panelTop{ display:grid; gap:8px; }
        .pbx__panelTitle{
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .pbx__panelSub{
          font-size: 12px;
          font-weight: 600;
          color: var(--muted);
        }
        .pbx__panelHint{
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .pbx__segmented{
          display:flex;
          align-items:stretch;
          border: 1px solid rgba(15,27,45,0.12);
          border-radius: 999px;
          overflow: hidden;
          background: rgba(255,255,255,0.92);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.75);
        }
        .pbx__segment{
          flex:1;
          padding: 8px 10px;
          text-align:center;
          border: 0;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          transition: color .14s ease, background .14s ease;
        }
        .pbx__segment + .pbx__segment{
          border-left: 1px solid rgba(15,27,45,0.08);
        }
        .pbx__segment--active{
          color: var(--text);
          background: rgba(239,59,59,0.12);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
        }
        .pbx__segmentQty{ display:block; font-size:12px; font-weight:800; }
        .pbx__segmentMeta{ display:block; font-size:10px; font-weight:700; opacity:0.7; }
        .pbx__panelMid{
          display:flex;
          flex-direction:column;
          gap:8px;
          justify-content:center;
        }
        .pbx__panelAccent{
          position:absolute;
          right: -18px;
          top: -10px;
          width: 150px;
          height: auto;
          opacity: 0.08;
          pointer-events: none;
        }
        .pbx__panelMeta{
          display:flex;
          align-items:center;
          gap:8px;
          font-size:12px;
          font-weight:700;
          color: var(--muted);
        }
        .pbx__panelBadge{
          border-radius:999px;
          border:1px solid rgba(239,59,59,0.35);
          background: rgba(239,59,59,0.12);
          padding:2px 8px;
          font-size:10px;
          font-weight:700;
          letter-spacing:0.08em;
          text-transform: uppercase;
          color: var(--red);
        }
        .pbx__panelTotal{
          font-weight: 900;
          font-size: 28px;
          color: var(--text);
        }
        .pbx__panelNote{
          font-size: 11px;
          font-weight: 600;
          color: var(--muted);
        }
        .pbx__panelSavings{
          font-size: 12px;
          font-weight: 600;
          color: var(--muted);
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .pbx__panelRegular{
          color: var(--muted);
        }
        .pbx__panelStrike{
          text-decoration: line-through;
        }
        .pbx__panelSave{
          color: var(--red);
          font-weight: 700;
        }
        .pbx__panelStatus{
          font-size: 11px;
          font-weight: 700;
          color: rgba(21,128,61,0.95);
        }
        .pbx__panelBottom{
          border-top: 1px solid rgba(15,27,45,0.08);
          padding-top: 12px;
          display:grid;
          gap:8px;
        }
        .pbx__trustLine{
          font-size:12px;
          font-weight:600;
          color: var(--muted);
        }
        .pbx__curatedLine{
          margin-top: 6px;
          font-size: 12px;
          font-weight: 600;
          color: var(--muted);
        }
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
        .pbx__selector{
          display:flex;
          flex-direction:column;
          gap:8px;
        }
        .pbx__selectorOption{
          background: none;
          border: none;
          padding: 0;
          display:flex;
          align-items:center;
          gap:8px;
          font-size:13px;
          font-weight:600;
          color: var(--muted);
          cursor: pointer;
          transition: color .14s ease;
        }
        .pbx__selectorOption:hover{ color: var(--text); }
        .pbx__selectorOption--active{ color: var(--text); }
        .pbx__selectorDot{
          font-size: 12px;
          line-height: 1;
          color: currentColor;
          opacity: 0.75;
        }
        .pbx__selectorOption--active .pbx__selectorDot{
          opacity: 1;
        }
        .pbx__selectorQty{ font-weight:700; }
        .pbx__selectorMeta{
          font-size:11px;
          font-weight:600;
          color: var(--muted);
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
        .pbx__tile--muted{
          border-color: rgba(15,27,45,0.08);
          background: rgba(15,27,45,0.015);
          box-shadow: none;
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
        .pbx__tileSaveLine{ font-size:12px; font-weight:700; color: var(--red); }
        .pbx__tile--muted .pbx__tilePrice,
        .pbx__tile--muted .pbx__tileQty{
          color: var(--muted);
        }
        .pbx__tile--muted .pbx__badge{
          border-color: rgba(15,27,45,0.1);
          background: rgba(15,27,45,0.04);
          color: var(--muted);
        }
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
          align-items:center;
          gap:6px;
        }
        .pbx__miniOption{
          display:inline-flex;
          align-items:center;
          gap:6px;
        }
        .pbx__miniSep{
          color: var(--muted);
          opacity: 0.65;
        }
        .pbx__miniLink{
          background: none;
          border: none;
          padding: 0;
          font-size: 12px;
          font-weight: 700;
          color: var(--muted);
          cursor: pointer;
          transition: color .14s ease;
        }
        .pbx__miniLink:hover{ color: var(--text); }
        .pbx__miniOption--active .pbx__miniLink{
          color: var(--text);
        }
        .pbx__miniQty{ font-weight:700; }
        .pbx__miniPrice{
          font-size:10px;
          font-weight:600;
          color: var(--muted);
          opacity: 0;
          transition: opacity .14s ease;
        }
        .pbx__miniOption:hover .pbx__miniPrice,
        .pbx__miniOption--active .pbx__miniPrice{
          opacity: 0.75;
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
        .pbx__summaryAccent{
          position: absolute;
          right: -12px;
          top: -10px;
          width: 140px;
          height: auto;
          opacity: 0.08;
          pointer-events: none;
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
        .pbx__summaryStatus--savings{ color: var(--red); }
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
          .pbx__panel{ padding:14px; border-radius:20px; }
          .pbx__panelTitle{ font-size:12px; letter-spacing:0.14em; }
          .pbx__panelSub{ font-size:11px; }
          .pbx__panelTotal{ font-size:24px; }
          .pbx__segmentQty{ font-size:11px; }
          .pbx__cta{ width:100%; justify-content:center; }
          .pbx__summaryAccent{
            width: 110px;
            right: -6px;
            top: -6px;
          }
          .pbx__miniRow{
            gap:6px;
          }
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

        /* Premium curation overrides */
        .pbx__ladder,
        .pbx__freeShip,
        .pbx__pricingNote,
        .pbx__complete,
        .pbx__missionHeader,
        .pbx__missionCopy,
        .pbx__missionActions,
        .pbx__missionList{
          display:none;
        }
        .pbx__mission{
          margin-top: 8px;
          padding: 8px 10px;
          border-radius: 12px;
          border-color: rgba(15,27,45,0.08);
          background: rgba(15,27,45,0.03);
        }
        .pbx__missionBar{ margin-top: 0; }
        .pbx__missionStatus{
          margin-top: 6px;
          font-size: 11px;
          font-weight: 700;
          color: var(--text);
        }
        .mission-bar{
          height: 6px;
          border-color: rgba(15,27,45,0.08);
          background: rgba(15,27,45,0.06);
        }
        .mission-bar__fill{ opacity: 0.75; }
        .mission-bar__tick{
          width: 8px;
          height: 8px;
          border-width: 1px;
          box-shadow: none;
        }
        .pbx__featured{
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
          gap: 10px;
          align-items: stretch;
        }
        @media (max-width: 768px){
          .pbx__featured{
            grid-template-columns: 1fr;
          }
        }
        .pbx__tile{
          min-height: 140px;
          padding: 14px;
          box-shadow: none;
        }
        .pbx__tileCta{
          display: none;
        }
        .pbx__tileMeta{
          display: none;
        }
        .pbx__tile[data-qty="8"]{
          border-color: rgba(239,59,59,0.55);
          background: rgba(239,59,59,0.08);
          box-shadow: 0 16px 40px rgba(239,59,59,0.18);
          transform: translateY(-2px);
          grid-row: span 2;
        }
        .pbx__tile[data-qty="8"] .pbx__tileMeta{
          display: flex;
        }
        .pbx__tile[data-qty="8"] .pbx__tilePrice{
          font-size: 34px;
        }
        .pbx__tile[data-qty="5"]{
          border-color: rgba(15,27,45,0.16);
          background: rgba(15,27,45,0.02);
        }
        .pbx__tile[data-qty="12"]{
          border-color: rgba(199,160,98,0.35);
          background: rgba(199,160,98,0.06);
        }
        .pbx__tile[data-qty="12"] .pbx__badge{
          border-color: rgba(199,160,98,0.4);
          background: rgba(199,160,98,0.12);
          color: var(--gold);
        }
        .pbx__badge{
          display: inline-flex;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .pbx__tile[data-qty="8"] .pbx__badge{
          border-color: rgba(239,59,59,0.45);
          background: rgba(239,59,59,0.12);
          color: var(--red);
        }
        .pbx__tile[data-qty="5"] .pbx__badge{
          border-color: rgba(15,27,45,0.18);
          background: rgba(15,27,45,0.06);
          color: var(--muted);
        }
        .pbx__tile--muted{
          border-color: rgba(15,27,45,0.08);
          background: rgba(15,27,45,0.015);
          box-shadow: none;
        }
        .pbx__tile--muted .pbx__badge{
          border-color: rgba(15,27,45,0.1);
          background: rgba(15,27,45,0.04);
          color: var(--muted);
        }
        .pbx__summary{
          margin-top: 14px;
          padding: 12px;
        }
        .pbx__cta{
          height: 50px;
          font-size: 15px;
        }
      `}</style>
    </section>
  );
}
