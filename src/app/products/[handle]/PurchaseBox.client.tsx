// src/app/products/[handle]/PurchaseBox.client.tsx (FULL REPLACE)
"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY } from "@/lib/bundles/pricing";
import { SINGLE_BAG_SKU, SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import { fireCartToast } from "@/lib/cartFeedback";

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
  perBag?: number;
  freeShipping: boolean;
  savingsAmount: number;
  savingsPct?: number;
  currencyCode?: string;
};

const VISIBLE_QUANTITIES = [1, 2, 3, 4, 5, 8, 12];

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

function badgeForQty(qty: number) {
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
      const pricing = pricingForQty(t.qty);
      const totalPrice = Number.isFinite(pricing.total) ? pricing.total : undefined;
      const perBag = Number.isFinite(pricing.perBag) ? pricing.perBag : undefined;
      const savingsAmount = Math.max(0, BASE_PRICE * t.qty - (totalPrice ?? 0));
      const savingsPct =
        totalPrice && savingsAmount > 0
          ? (savingsAmount / (BASE_PRICE * t.qty)) * 100
          : undefined;

      return {
        ...t,
        variant: singleVariant,
        totalPrice,
        perBag,
        freeShipping: t.qty >= FREE_SHIP_QTY,
        savingsAmount,
        savingsPct,
        currencyCode: baselineCurrency,
        accent: t.accent,
      };
    });
  }, [availableTiers, singleVariant, baselineCurrency]);

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
  const [adding, setAdding] = useState(false);
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
        bundlesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setFocusGlow(true);
        setTimeout(() => setFocusGlow(false), 1400);
      }, 120);
    }
  }, [focus]);

  const selectedOption = bundleOptions.find((o) => o.qty === selectedQty) ?? bundleOptions[0];

  const selectedVariant = selectedOption?.variant ?? pickSingleVariant(variants);
  const selectedPrice = selectedOption?.totalPrice;
  const optionQty = selectedOption?.qty ?? selectedQty ?? 1;
  const selectedCurrency =
    (selectedVariant?.price as any)?.currencyCode ||
    (selectedVariant?.priceV2 as any)?.currencyCode ||
    baselineCurrency;
  const selectedPriceText = money(selectedPrice, selectedCurrency);

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

  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleRadioKey(index: number) {
    return (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!radioOptions.length) return;
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

  async function addToCart() {
    setError(null);

    if (!selectedVariant?.id) {
      setError("No purchasable variant found for this product.");
      return;
    }

    if (selectedVariant.availableForSale === false) {
      setError("Out of stock.");
      return;
    }

    setAdding(true);
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
          variantId: selectedVariant.id,
          quantity: Math.max(1, selectedQty),
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
      fireCartToast(optionQty);
      router.push("/cart");
      router.refresh();
    } catch {
      setError("Couldn't add to cart. Please try again.");
      setAdding(false);
    } finally {
      setAdding(false);
    }
  }

  return (
    <section data-purchase-section="true" className="pbx pbx--metal">
      {/* Bundle ladder */}
      <div
        ref={bundlesRef}
        className={cx("pbx__card", focusGlow && "pbx__glow")}
        aria-label="Bundle selection"
      >
        <div className="pbx__cardHeader">
          <div>
            <div className="pbx__cardTitle">Pick your bundle</div>
            <div className="pbx__cardHint">
              Add more bags, lower price per bag, free shipping at 5+.
            </div>
          </div>
        </div>

        <div className="pbx__freeShip">
          Free shipping on 5+ bags - most customers qualify
        </div>

        <div className="pbx__options">
          <div className="pbx__optionGroup" role="radiogroup" aria-label="Bundle sizes">
            <div className="pbx__featured">
            {featuredOptions.map((o) => {
              const active = selectedQty === o.qty;
              const badge = badgeForQty(o.qty);
              const index = radioIndexByQty.get(o.qty) ?? 0;
              const popular = o.qty === 8;

              return (
                <button
                  key={`${o.qty}-${o.variant.id}`}
                  type="button"
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
                    <span className="pbx__tileQty">{formatQtyLabel(o.qty)}</span>
                    {badge ? (
                      <span className={cx("pbx__badge", popular && "pbx__badge--popular")}>
                        {badge}
                      </span>
                    ) : null}
                  </div>

                  <div className="pbx__tilePriceRow">
                    <div className="pbx__tilePrice">{money(o.totalPrice, o.currencyCode)}</div>
                    <div className="pbx__tilePer">~{money(o.perBag, o.currencyCode)} / bag</div>
                  </div>

                  <div className="pbx__tileMeta">
                    {o.savingsAmount > 0 ? (
                      <span className="pbx__tileSave">Save {money(o.savingsAmount, o.currencyCode)}</span>
                    ) : (
                      <span className="pbx__tileSave pbx__tileSave--muted">Standard price</span>
                    )}
                    {o.freeShipping ? <span className="pbx__tileShip">Free shipping</span> : null}
                  </div>
                </button>
              );
            })}
            </div>
            {showExtras ? (
              <div className="pbx__miniRow">
                {extraOptions.map((o) => {
                  const active = selectedQty === o.qty;
                  const label = formatQtyLabel(o.qty);
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
                      <span className="pbx__miniPrice">{money(o.totalPrice, o.currencyCode)}</span>
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
            <div className="pbx__summaryLabel">Your selected bundle: {formatQtyLabel(optionQty)}</div>
            <div className="pbx__summaryPrice">{selectedPriceText}</div>
            {error ? <div className="pbx__error">{error}</div> : null}
          </div>

          <button
            type="button"
            disabled={adding}
            onClick={addToCart}
            className={cx("pbx__cta", "pbx__cta--primary")}
          >
            {adding ? (
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
                />
                Adding...
              </span>
            ) : (
              `Build my bundle - ${selectedPriceText} ->`
            )}
          </button>
          <div className="pbx__ctaNote" aria-live="polite">
            Love it or your money back - Ships within 24 hours - Limited daily production
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
