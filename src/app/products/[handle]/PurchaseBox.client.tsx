// src/app/products/[handle]/PurchaseBox.client.tsx (FULL REPLACE)
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY, FREE_SHIPPING_PHRASE } from "@/lib/bundles/pricing";
import { SINGLE_BAG_SKU, SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";

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

type BundleBadge = "most_popular" | "best_deal";

type BundleOption = {
  qty: number;
  label: string;
  sub: string;
  accent?: boolean;
  variant: VariantNode;
  totalPrice?: number;
  perBag?: number;
  freeShipping: boolean;
  badges: BundleBadge[];
  savingsAmount: number;
  savingsPct?: number;
  currencyCode?: string;
};

function money(amount?: number, currencyCode = "USD") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";

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

function formatPercent(n?: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${rounded}%`;
}

function asNumberAmount(v?: MoneyLike) {
  const raw = (v as any)?.amount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
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

function isFreeShippingTitle(title?: string) {
  const t = (title || "").toLowerCase();
  return t.includes("free shipping") || t.includes("free-ship") || t.includes("freeshipping");
}

function normalizeBadge(raw?: string | null): BundleBadge | undefined {
  if (!raw) return undefined;
  const v = raw.toString().trim().toLowerCase().replace(/\s+/g, "_");

  if (v === "most_popular" || v === "mostpopular" || v === "popular") return "most_popular";
  if (v === "best_deal" || v === "bestdeal" || v === "deal") return "best_deal";
  return undefined;
}

function variantPriceNumber(v?: VariantNode) {
  return asNumberAmount(v?.price) ?? asNumberAmount(v?.priceV2);
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
  // Canonical ladder. We'll show a tier only if Shopify actually has that variant.
  const ladder = useMemo(
    () => [
      { qty: 1, label: "1 Bag", sub: "Try it" },
      { qty: 2, label: "2 Bags", sub: "Standard price" },
      { qty: 3, label: "3 Bags", sub: "Standard price" },
      { qty: 4, label: "4 Bags", sub: "Discount starts", accent: true },
      { qty: 5, label: "5 Bags", sub: FREE_SHIPPING_PHRASE, accent: true },
      { qty: 8, label: "Best Value (8 bags) — Lowest price per bag", sub: "Recommended", accent: true },
      { qty: 12, label: "12 Bags", sub: "Lowest price per bag", accent: true },
    ],
    []
  );

  const singleVariant = useMemo(() => pickSingleVariant(variants), [variants]);

  const baselineCurrency =
    (singleVariant?.price as any)?.currencyCode ||
    (singleVariant?.priceV2 as any)?.currencyCode ||
    (product?.priceRange?.minVariantPrice as any)?.currencyCode ||
    "USD";

  const availableTiers = useMemo(() => ladder, [ladder]);

  const bundleOptions = useMemo<BundleOption[]>(() => {
    if (!singleVariant?.id) return [];
    const available = singleVariant.availableForSale !== false;

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
        badges: [],
        savingsAmount,
        savingsPct,
        currencyCode: baselineCurrency,
        accent: t.accent,
      };
    });
  }, [availableTiers, singleVariant, baselineCurrency]);

  const bundleOptionsWithBadges = useMemo<BundleOption[]>(() => {
    const opts = bundleOptions.map((o) => ({ ...o, badges: [...o.badges] }));

    let mostTaken = false;
    let bestTaken = false;

    for (const o of opts) {
      const hasMost = o.badges.includes("most_popular");
      const hasBest = o.badges.includes("best_deal");

      o.badges = [
        ...(hasMost && !mostTaken ? ((mostTaken = true), ["most_popular"] as const) : []),
        ...(hasBest && !bestTaken ? ((bestTaken = true), ["best_deal"] as const) : []),
      ];
    }

    // Ensure 5-bag shows as Most Popular when available
    const fiveTier = opts.find((o) => o.qty === 5);
    if (fiveTier && !fiveTier.badges.includes("most_popular") && !mostTaken) {
      fiveTier.badges.push("most_popular");
      mostTaken = true;
    }

    if (!mostTaken && opts.length) {
      const sortedByQty = [...opts].sort((a, b) => a.qty - b.qty);
      const median = sortedByQty[Math.floor(sortedByQty.length / 2)];
      if (median && !median.badges.includes("most_popular")) {
        median.badges.push("most_popular");
        mostTaken = true;
      }
    }

    if (!bestTaken) {
      const best = [...opts]
        .filter((o) => (o.savingsPct ?? 0) > 0)
        .sort((a, b) => (b.savingsPct ?? 0) - (a.savingsPct ?? 0) || b.qty - a.qty)[0];
      if (best && !best.badges.includes("best_deal")) {
        best.badges.push("best_deal");
        bestTaken = true;
      }
    }

    return opts;
  }, [bundleOptions]);

  const defaultQty = useMemo(() => {
    return (
      bundleOptionsWithBadges.find((o) => o.qty === 8)?.qty ||
      bundleOptionsWithBadges.find((o) => o.qty === 5)?.qty ||
      bundleOptionsWithBadges[0]?.qty ||
      1
    );
  }, [bundleOptionsWithBadges]);

  const [selectedQty, setSelectedQty] = useState<number>(defaultQty);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep selection valid as data hydrates
  useEffect(() => {
    if (!bundleOptionsWithBadges.length) return;
    setSelectedQty((prev) => {
      if (bundleOptionsWithBadges.some((o) => o.qty === prev)) return prev;
      return defaultQty;
    });
  }, [bundleOptionsWithBadges, defaultQty]);

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


  const selectedOption =
    bundleOptionsWithBadges.find((o) => o.qty === selectedQty) ??
    bundleOptionsWithBadges[0];

  const selectedVariant = selectedOption?.variant ?? pickSingleVariant(variants);
  const selectedPrice = selectedOption?.totalPrice;
  const optionQty = selectedOption?.qty ?? selectedQty ?? 1;
  const selectedCurrency =
    (selectedVariant?.price as any)?.currencyCode ||
    (selectedVariant?.priceV2 as any)?.currencyCode ||
    baselineCurrency;
  const freeShip = optionQty >= FREE_SHIP_QTY;

  const perBag =
    optionQty > 0 && selectedPrice !== undefined ? selectedPrice / optionQty : undefined;

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
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
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
      router.push("/cart");
      router.refresh();
    } catch {
      setError("Couldn’t add to cart. Please try again.");
      setAdding(false);
    } finally {
      setAdding(false);
    }
  }

  return (
    <section data-purchase-section="true" className="pbx">
      {/* Bundle ladder */}
      <div
        ref={bundlesRef}
        className={cx("pbx__card", focusGlow && "pbx__glow")}
        aria-label="Bundle selection"
      >
        <div className="pbx__cardHeader">
          <div>
            <div className="pbx__cardTitle">Choose your bundle</div>
            <div className="pbx__cardHint">
              Bundle pricing follows the USA Gummies ladder.
            </div>
            <div className="pbx__guidance">
              Most customers choose 8+ bags for best value. {FREE_SHIPPING_PHRASE}
            </div>
          </div>
        </div>

        <div className="pbx__sliderWrap">
          <div className="pbx__edge pbx__edge--left" aria-hidden="true" />
          <div className="pbx__edge pbx__edge--right" aria-hidden="true" />
          <div className="pbx__grid bundle-slider">
            {bundleOptionsWithBadges.map((o) => {
            const active = selectedQty === o.qty;
            const accent = Boolean((o as any).accent);
            const glow = o.badges.includes("most_popular") || o.badges.includes("best_deal");

            return (
              <button
                key={`${o.qty}-${o.variant.id}`}
                type="button"
                onClick={() => setSelectedQty(o.qty)}
                className={cx(
                  "pbx__tile",
                  accent && "pbx__tile--accent",
                  active && "pbx__tile--active",
                  active && accent && "pbx__tile--activeAccent",
                  glow && "pbx__tile--glow"
                )}
                aria-pressed={active}
              >
                <div className="pbx__tileTop">
                  <div className="pbx__tileLeft">
                    <div className="pbx__tileLabelRow">
                      <span className={cx("pbx__check", active && "pbx__check--active")} aria-hidden="true">
                        {active ? "✓" : ""}
                      </span>
                    <div className="pbx__tileLabel">{o.label}</div>
                    {o.badges.length ? (
                      <div className="pbx__tileBadges">
                        {o.badges.includes("most_popular") ? (
                          <span className="pbx__pill">Most Popular</span>
                        ) : null}
                        {o.badges.includes("best_deal") ? (
                          <span className="pbx__pill pbx__pill--navy">Best Deal</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="pbx__tileRight">
                  <div className="pbx__tiny">Price</div>
                  <div className="pbx__tileTotal">{money(o.totalPrice, o.currencyCode)}</div>
                  <div className="pbx__tilePer">Per bag: {money(o.perBag, o.currencyCode)}</div>
                </div>
              </div>
            </button>
          );
          })}
          </div>
        </div>

        {/* Decision row */}
        <div className="pbx__summary" aria-live="polite" role="status">
          <div className="pbx__summaryLeft">
            <div className="pbx__summaryTitle">
              Selected:{" "}
              <span className={cx("pbx__em", freeShip && "pbx__em--red")}>
                {selectedOption?.label || `${selectedQty} bags`}
              </span>
            </div>

            {error ? <div className="pbx__error">{error}</div> : null}
          </div>

          <div className="pbx__summaryRight">
            <div className="pbx__totals">
              <div className="pbx__tiny">Bundle price</div>
              <div className="pbx__grand">{money(selectedPrice, selectedCurrency)}</div>
            </div>

            <button
              type="button"
              disabled={adding}
              onClick={addToCart}
              className={cx("pbx__cta", "pbx__cta--primary")}
            >
              {adding ? "Adding…" : "Add to Cart"}
            </button>
            <div className="pbx__ctaNote" aria-live="polite">
              {selectedQty >= 5
                ? FREE_SHIPPING_PHRASE
                : FREE_SHIPPING_PHRASE}
            </div>
          </div>
        </div>

        <div className="pbx__mobileSticky" aria-live="polite">
          <div className="pbx__stickyLeft">
            <div className="pbx__stickyLabel">{selectedOption?.label || `${selectedQty} bags`}</div>
            <div className="pbx__stickySub">
              {selectedQty >= 5 ? FREE_SHIPPING_PHRASE : FREE_SHIPPING_PHRASE}
            </div>
          </div>
          <button
            type="button"
            onClick={addToCart}
            disabled={adding}
            className="pbx__stickyBtn"
          >
            {adding ? "Adding…" : "Add bundle"}
          </button>
        </div>
      </div>

      <style>{`
        .pbx{ display:block; color: var(--text); }
        .pbx__left{ min-width: 0; }
        .pbx__right{ text-align:right; white-space:nowrap; }
        .pbx__kicker{ font-size:12px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; color: var(--muted); }
        .pbx__price{ margin-top:6px; font-family: var(--font-display); font-weight:950; font-size:24px; color: var(--text); }
        .pbx__tiny{ font-size:12px; color: var(--muted); margin-top:4px; }
        .pbx__card{
          margin-top:14px;
          border-radius:18px;
          border:1px solid var(--border);
          background: var(--surface-strong);
          padding:14px;
          box-shadow: 0 18px 40px rgba(15,27,45,0.12);
        }
        .pbx__glow{
          outline: 2px solid rgba(13,28,51,0.3);
          box-shadow: 0 0 0 6px rgba(13,28,51,0.1), 0 18px 55px rgba(13,28,51,0.16);
        }
        .pbx__cardHeader{
          display:flex; gap:10px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap;
        }
        .pbx__cardTitle{ font-weight:950; font-size:16px; color: var(--text); }
        .pbx__cardHint{ font-size:13px; color: var(--muted); }
        .pbx__guidance{ margin-top:6px; font-size:12px; color: var(--muted); }

        .pbx__sliderWrap{
          position: relative;
        }
        .pbx__edge{
          position: absolute;
          top: 0;
          bottom: 0;
          width: 28px;
          pointer-events: none;
          z-index: 2;
        }
        .pbx__edge--left{
          left: 0;
          background: linear-gradient(90deg, rgba(248,245,239,0.98), rgba(248,245,239,0));
        }
        .pbx__edge--right{
          right: 0;
          background: linear-gradient(270deg, rgba(248,245,239,0.98), rgba(248,245,239,0));
        }
        .pbx__grid{
          margin-top:12px;
          display:flex;
          overflow-x:auto;
          gap:10px;
          scroll-snap-type: x mandatory;
          padding: 0 6px 8px;
          scrollbar-width: none;
        }
        .pbx__grid::-webkit-scrollbar{ display:none; }
        @media (max-width: 640px){
          .pbx__right{ display:none; }
          .pbx__tileTop{ flex-direction: column; align-items:flex-start; }
          .pbx__tileRight{ text-align:left; min-width: 0; }
        }

        .pbx__tile{
          width:100%;
          min-width: 220px;
          flex: 0 0 auto;
          scroll-snap-align: start;
          text-align:left;
          border-radius:18px;
          border:1px solid var(--border);
          background: var(--surface);
          padding:10px;
          cursor:pointer;
          transition: transform var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out), background var(--dur-2) var(--ease-out);
        }
        @media (min-width: 768px){
          .pbx__tile{ min-width: 240px; }
        }
        .pbx__tile:hover{
          transform: translateY(-2px);
          box-shadow: 0 16px 34px rgba(15,27,45,0.14);
          border-color: rgba(13,28,51,0.18);
        }
        .pbx__tile:focus-visible{
          outline: 3px solid rgba(13,28,51,0.3);
          outline-offset: 2px;
        }
        .pbx__tile--accent{ border-color: rgba(199,54,44,0.32); }
        .pbx__tile--active{
          border-color: rgba(13,28,51,0.34);
          box-shadow: 0 18px 38px rgba(13,28,51,0.16);
          background: linear-gradient(140deg, rgba(13,28,51,0.12), rgba(13,28,51,0.04));
          transform: translateY(-2px) scale(1.01);
        }
        .pbx__tile--activeAccent{
          border-color: rgba(199,54,44,0.42);
          box-shadow: 0 18px 44px rgba(199,54,44,0.14);
          animation: pbxPulse 3s ease-in-out infinite;
        }
        .pbx__tile--glow{
          box-shadow: 0 22px 58px rgba(199,160,98,0.18), 0 0 0 1px rgba(199,160,98,0.28), 0 0 0 8px rgba(199,160,98,0.04);
          background: rgba(199,160,98,0.08);
        }

        .pbx__tileTop{ display:flex; gap:10px; align-items:flex-start; justify-content:space-between; }
        .pbx__tileLabelRow{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .pbx__tileLabel{ font-weight:950; font-size:14px; color: var(--text); }
        .pbx__tileBadges{ display:flex; gap:6px; flex-wrap:wrap; }
        .pbx__check{
          width:18px; height:18px; border-radius:999px;
          border:1px solid var(--border);
          display:inline-flex; align-items:center; justify-content:center;
          font-size:12px; font-weight:900; color: transparent;
          background: var(--surface-strong);
        }
        .pbx__check--active{
          color: white;
          background: linear-gradient(145deg, rgba(13,28,51,0.98), rgba(13,28,51,0.86));
          border-color: rgba(13,28,51,0.4);
          box-shadow: 0 8px 18px rgba(13,28,51,0.24);
        }
        .pbx__pill{
          border-radius:999px; padding:6px 10px;
          border:1px solid rgba(199,54,44,0.35);
          background: rgba(199,54,44,0.12);
          font-weight:950; font-size:11px; color: var(--red);
        }
        .pbx__pill--gold{
          border-color: rgba(199,160,98,0.55);
          background: rgba(199,160,98,0.2);
          color: #7a531f;
        }
        .pbx__pill--navy{
          border-color: rgba(13,28,51,0.18);
          background: var(--surface-strong);
          color: var(--navy);
        }
        .pbx__tileRight{ text-align:right; min-width:100px; color: var(--text); }
        .pbx__tileTotal{ font-weight:950; font-size:15px; color: var(--text); }
        .pbx__tilePer{ margin-top:4px; font-size:12px; color: var(--muted); }

        .pbx__summary{
          margin-top:10px;
          border-radius:16px;
          border:1px solid var(--border);
          background: var(--surface);
          padding:12px;
          display:flex;
          gap:10px;
          align-items:center;
          justify-content:space-between;
          flex-wrap:wrap;
          position: relative;
        }
        @media (min-width: 768px){
          .pbx__summary{ position: sticky; bottom: 12px; z-index: 2; }
        }
        .pbx__summaryTitle{ font-weight:950; }
        .pbx__em{ font-weight:950; color: var(--text); }
        .pbx__em--red{ color: var(--red); }
        .pbx__error{
          margin-top:10px;
          font-size:13px;
          font-weight:900;
          color: rgba(193,18,31,0.95);
        }

        .pbx__summaryRight{ display:flex; gap:12px; align-items:center; }
        .pbx__totals{ text-align:right; }
        .pbx__grand{ font-family: var(--font-display); font-weight:950; font-size:26px; color: var(--text); }

        .pbx__cta{
          border:none;
          border-radius:999px;
          padding:12px 18px;
          font-weight:950;
          cursor:pointer;
          transition: transform .08s ease, opacity .18s ease, filter .18s ease;
          white-space:nowrap;
          background: var(--navy);
          color: white;
        }
        .pbx__cta--primary{
          background: linear-gradient(180deg, #c7362c 0%, #b02c26 100%);
        }
        .pbx__cta--primary:hover{
          filter: brightness(1.05);
        }
        .pbx__cta:disabled{ opacity:.65; cursor:not-allowed; }
        .pbx__cta:active{ transform: translateY(1px); }
        .pbx__ctaNote{
          margin-top:6px;
          font-size:12px;
          color: var(--muted);
        }
        .pbx__ctaMicro{
          margin-top:4px;
          font-size:11px;
          color: var(--muted);
        }
        .pbx__trustInline{
          margin-top:8px;
          display:flex;
          gap:6px;
          flex-wrap:wrap;
        }


        .pbx__mobileSticky{
          display:none;
        }
        .pbx__stickyLeft{ min-width:0; }
        .pbx__stickyLabel{ font-weight:900; }
        .pbx__stickySub{ font-size:12px; opacity:0.82; margin-top:2px; }
        .pbx__stickyBtn{
          background: linear-gradient(180deg, #c7362c 0%, #b02c26 100%);
          color: white;
          border:none;
          border-radius:999px;
          padding:10px 14px;
          font-weight:900;
        }
        @media (max-width: 640px){
          .pbx__mobileSticky{ display:none; }
        }

        @media (prefers-reduced-motion: reduce){
          .pbx__tile,
          .pbx__tile:hover,
          .pbx__tile--active,
          .pbx__tile--activeAccent,
          .pbx__tile--glow{
            transition: none !important;
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>
    </section>
  );
}
