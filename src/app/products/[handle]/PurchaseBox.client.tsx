// src/app/products/[handle]/PurchaseBox.client.tsx (FULL REPLACE)
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pricingForQty, BASE_PRICE, FREE_SHIP_QTY, FREE_SHIPPING_PHRASE, MIN_PER_BAG } from "@/lib/bundles/pricing";
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

const VISIBLE_QUANTITIES = [1, 2, 3, 4, 5, 8, 12];

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
      let label = `${qty} Bag${qty === 1 ? "" : "s"}`;
      let sub =
        qty === 1
          ? "Try it"
          : qty < 4
            ? "Standard price"
            : qty === 4
              ? "Discount starts"
              : FREE_SHIPPING_PHRASE;

      if (qty === 8) {
        label = "Most Popular (8 bags)";
        sub = "Best balance of value + convenience";
      }

      if (qty === 10) {
        sub = "Stock-up pick";
      }

      if (qty === 12) {
        sub = "Lowest price per bag";
      }

      return { qty, label, sub, accent };
    });
  }, []);

  const singleVariant = useMemo(() => pickSingleVariant(variants), [variants]);

  const baselineCurrency =
    (singleVariant?.price as any)?.currencyCode ||
    (singleVariant?.priceV2 as any)?.currencyCode ||
    (product?.priceRange?.minVariantPrice as any)?.currencyCode ||
    "USD";

  const availableTiers = useMemo(() => ladder, [ladder]);
  const perBagCapText = money(MIN_PER_BAG, baselineCurrency);

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
        badges: [],
        savingsAmount,
        savingsPct,
        currencyCode: baselineCurrency,
        accent: t.accent,
      };
    });
  }, [availableTiers, singleVariant, baselineCurrency]);

  const bundleOptionsWithBadges = useMemo<BundleOption[]>(() => {
    const opts = bundleOptions.map((o) => ({ ...o, badges: [] as BundleBadge[] }));

    for (const o of opts) {
      if (o.qty === 8) o.badges.push("most_popular");
    }

    return opts;
  }, [bundleOptions]);

  const featuredQuantities = [4, 5, 8, 12];

  const featuredOptions = useMemo<BundleOption[]>(() => {
    if (!bundleOptionsWithBadges.length) return [];

    const ordered = featuredQuantities
      .map((qty) => bundleOptionsWithBadges.find((o) => o.qty === qty))
      .filter(Boolean) as BundleOption[];

    const fallback = bundleOptionsWithBadges.slice(0, 3);
    const base = ordered.length ? ordered : fallback;

    return base.map((o) => {
      const badges = [...o.badges];
      if (o.qty === 8 && !badges.includes("most_popular")) badges.push("most_popular");
      return { ...o, badges };
    });
  }, [bundleOptionsWithBadges]);

  const extraOptions = useMemo<BundleOption[]>(() => {
    if (!bundleOptionsWithBadges.length) return [];
    const featuredIds = new Set(featuredOptions.map((o) => o.qty));
    return bundleOptionsWithBadges
      .filter((o) => !featuredIds.has(o.qty))
      .sort((a, b) => a.qty - b.qty);
  }, [bundleOptionsWithBadges, featuredOptions]);

  const defaultQty = useMemo(() => {
    return (
      bundleOptionsWithBadges.find((o) => o.qty === 8)?.qty ||
      bundleOptionsWithBadges.find((o) => o.qty === 5)?.qty ||
      bundleOptionsWithBadges.find((o) => o.qty === 10)?.qty ||
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
      setError("Couldn’t add to cart. Please try again.");
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
            <div className="pbx__cardTitle">Choose your bundle</div>
            <div className="pbx__cardHint">
              Bundle pricing follows the USA Gummies ladder.
            </div>
            <div className="pbx__guidance">
              Most customers choose 8 bags. {FREE_SHIPPING_PHRASE}
            </div>
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/60">
                How pricing works
              </div>
              <ul className="mt-1.5 space-y-1">
                <li>Discounts start at 4 bags</li>
                <li>Free shipping at 5+ bags</li>
                <li>Most customers choose 8 bags</li>
                <li>Per-bag price caps at {perBagCapText} after 12+ bags</li>
              </ul>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/70">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 2 19 5v6c0 5-3.5 9.4-7 11-3.5-1.6-7-6-7-11V5l7-3z"
                  />
                </svg>
                Love it or your money back
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M3 6h10v7H3V6zm10 2h4l3 3v2h-7V8zm-8 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm11 0a2 2 0 1 0 .001 4A2 2 0 0 0 16 17z"
                  />
                </svg>
                Ships within 24 hours
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 1 0-8 0v2z"
                  />
                </svg>
                Secure checkout
              </span>
            </div>
          </div>
        </div>

        <div className="pbx__featured">
          {featuredOptions.map((o) => {
            const active = selectedQty === o.qty;
            const accent = Boolean((o as any).accent);
            const glow =
              o.badges.includes("most_popular") || o.badges.includes("best_deal") || o.qty === 10;

            return (
              <button
                key={`${o.qty}-${o.variant.id}`}
                type="button"
                onClick={() => setSelectedQty(o.qty)}
                className={cx(
                  "pbx__tile",
                  "pbx__tile--featured",
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
                    </div>
                    {o.sub ? <div className="pbx__tileSub">{o.sub}</div> : null}
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

                  <div className="pbx__tileRight">
                    <div className="pbx__tiny">Price</div>
                    <div className="pbx__tileTotal">{money(o.totalPrice, o.currencyCode)}</div>
                    <div className="pbx__tilePer">Per bag: {money(o.perBag, o.currencyCode)}</div>
                    {o.savingsAmount > 0 ? (
                      <div className="pbx__tileSave">
                        Save {money(o.savingsAmount, o.currencyCode)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {extraOptions.length ? (
          <div className="pbx__mini">
            <div className="pbx__miniTitle">More bundle sizes</div>
            <div className="pbx__miniRow">
              {extraOptions.map((o) => {
                const active = selectedQty === o.qty;
                const label = `${o.qty} bag${o.qty === 1 ? "" : "s"}`;
                return (
                  <button
                    key={`mini-${o.qty}-${o.variant.id}`}
                    type="button"
                    onClick={() => setSelectedQty(o.qty)}
                    className={cx("pbx__miniBtn", active && "pbx__miniBtn--active")}
                    aria-pressed={active}
                  >
                    <span className="pbx__miniQty">{label}</span>
                    <span className="pbx__miniPrice">{money(o.totalPrice, o.currencyCode)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

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
              {adding ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
                  />
                  Adding…
                </span>
              ) : (
                "Add to Cart"
              )}
            </button>
            <div className="pbx__ctaNote" aria-live="polite">
              Love it or your money back • Ships within 24 hours • Secure checkout
            </div>
          </div>
        </div>

        <div className="pbx__mobileSticky" aria-live="polite">
          <div className="pbx__stickyLeft">
            <div className="pbx__stickyLabel">{selectedOption?.label || `${selectedQty} bags`}</div>
            <div className="pbx__stickySub">
              Love it or your money back • Ships within 24 hours • Secure checkout
            </div>
          </div>
          <button
            type="button"
            onClick={addToCart}
            disabled={adding}
            className="pbx__stickyBtn"
          >
            {adding ? (
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
                />
                Adding…
              </span>
            ) : (
              "Add bundle"
            )}
          </button>
        </div>
      </div>

      <style>{`
        .pbx{ display:block; color: var(--text); }
        .pbx--metal{
          --surface: rgba(10,22,40,0.78);
          --surface-strong: rgba(8,16,30,0.92);
          --text: rgba(255,255,255,0.92);
          --muted: rgba(255,255,255,0.64);
          --border: rgba(199,160,98,0.32);
        }
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
          box-shadow: 0 18px 40px rgba(7,12,20,0.45);
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

        .pbx__featured{
          margin-top:12px;
          display:grid;
          gap:12px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
        .pbx__mini{
          margin-top:14px;
          border-top:1px solid var(--border);
          padding-top:12px;
        }
        .pbx__miniTitle{
          font-size:11px;
          font-weight:900;
          letter-spacing:.18em;
          text-transform:uppercase;
          color: var(--muted);
        }
        .pbx__miniRow{
          margin-top:8px;
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
          transition: transform .08s ease, border-color .2s ease, background .2s ease;
        }
        .pbx__miniBtn:hover{ transform: translateY(-1px); }
        .pbx__miniBtn--active{
          border-color: rgba(199,54,44,0.45);
          background: rgba(199,54,44,0.08);
          color: var(--red);
        }
        .pbx__miniQty{ font-weight:900; }
        .pbx__miniPrice{
          font-size:11px;
          font-weight:700;
          color: var(--muted);
        }
        @media (max-width: 640px){
          .pbx__right{ display:none; }
          .pbx__tileTop{ flex-direction: column; align-items:flex-start; }
          .pbx__tileRight{ text-align:left; min-width: 0; }
          .pbx__featured{ grid-template-columns: 1fr; }
          .pbx__miniRow{
            flex-wrap:nowrap;
            overflow-x:auto;
            padding-bottom:6px;
            scrollbar-width:none;
          }
          .pbx__miniRow::-webkit-scrollbar{ display:none; }
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
          border-color: rgba(199,160,98,0.6);
          box-shadow: 0 18px 38px rgba(7,12,20,0.45);
          background: linear-gradient(140deg, rgba(12,26,48,0.9), rgba(10,20,38,0.85));
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
        .pbx__tile--featured{
          min-width: 0;
          flex: initial;
        }

        .pbx__tileTop{ display:flex; gap:10px; align-items:flex-start; justify-content:space-between; }
        .pbx__tileLabelRow{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .pbx__tileLabel{ font-weight:950; font-size:14px; color: var(--text); }
        .pbx__tileSub{ margin-top:4px; font-size:12px; color: var(--muted); }
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
          border-color: rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.12);
          color: var(--text);
        }
        .pbx__tileRight{ text-align:right; min-width:100px; color: var(--text); }
        .pbx__tileTotal{ font-weight:950; font-size:15px; color: var(--text); }
        .pbx__tilePer{ margin-top:4px; font-size:12px; color: var(--muted); }
        .pbx__tileSave{ margin-top:6px; font-size:11px; font-weight:800; color: var(--gold); }

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
