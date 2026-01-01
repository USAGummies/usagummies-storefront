// src/app/products/[handle]/PurchaseBox.client.tsx (FULL REPLACE)
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

type MoneyLike =
  | { amount: string; currencyCode?: string }
  | { amount: string; currencyCode: string }
  | undefined;

type VariantNode = {
  id: string;
  title: string;
  availableForSale?: boolean;
  price?: MoneyLike;
  priceV2?: MoneyLike;
};

type Product = {
  title: string;
  handle: string;
  variants?: { nodes?: VariantNode[] };
  priceRange?: { minVariantPrice?: MoneyLike; maxVariantPrice?: MoneyLike };
};

function money(amount?: number) {
  if (!Number.isFinite(amount || 0)) return "$0.00";
  return `$${(amount || 0).toFixed(2)}`;
}

function asNumberAmount(v?: MoneyLike) {
  const raw = (v as any)?.amount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function pickBaseVariant(variants: VariantNode[]) {
  const byTitle = [...variants].sort((a, b) => {
    const at = (a.title || "").toLowerCase();
    const bt = (b.title || "").toLowerCase();
    const aSingle = at.includes("single") || at.includes("1") || at.includes("one");
    const bSingle = bt.includes("single") || bt.includes("1") || bt.includes("one");
    return Number(bSingle) - Number(aSingle);
  });
  return byTitle[0] || variants[0];
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
  const baseVariant = pickBaseVariant(variants);

  const basePriceNumber =
    asNumberAmount(baseVariant?.price) ??
    asNumberAmount(baseVariant?.priceV2) ??
    asNumberAmount(product?.priceRange?.minVariantPrice) ??
    0;

  const ladder = useMemo(
    () => [
      { qty: 1, label: "1 Bag", tag: "Try it", accent: false },
      { qty: 2, label: "2 Bags", tag: "Stock up", accent: false },
      { qty: 4, label: "4 Bags", tag: "Better value", accent: false },
      { qty: 5, label: "5 Bags", tag: "FREE SHIPPING", accent: true, popular: true },
      { qty: 8, label: "8 Bags", tag: "Best deal", accent: true },
      { qty: 12, label: "12 Bags", tag: "Party pack", accent: true },
    ],
    []
  );

  const [selectedQty, setSelectedQty] = useState<number>(5);
  const [adding, setAdding] = useState(false);

  const bundlesRef = useRef<HTMLDivElement | null>(null);
  const [focusGlow, setFocusGlow] = useState(false);

  useEffect(() => {
    if (focus === "bundles") {
      setTimeout(() => {
        bundlesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setFocusGlow(true);
        setTimeout(() => setFocusGlow(false), 1400);
      }, 100);
    }
  }, [focus]);

  async function addToCart(qty: number) {
    if (!baseVariant?.id) return;
    setAdding(true);
    try {
      await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          variantId: baseVariant.id,
          quantity: qty,
        }),
      });

      router.push("/cart");
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  const total = basePriceNumber * Number(selectedQty || 1);

  const selected = ladder.find((x) => x.qty === selectedQty);
  const selectedTag = selected?.tag || "";
  const selectedAccent = Boolean(selected?.accent);

  return (
    <section data-purchase-section="true">
      {/* Top strip */}
      <div className="patriot-banner">
        <div className="patriot-banner__content" style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div className="kicker">Bundle & Save</div>
              <div style={{ fontWeight: 950, fontSize: 18, marginTop: 8 }}>
                {product?.title || "USA Gummies"}
              </div>
              <div className="muted" style={{ marginTop: 6, fontSize: 14 }}>
                Pick a bundle — the cart does the nudging. Free shipping at 5+.
              </div>

              <div className="badge-row" style={{ marginTop: 10 }}>
                <span className="badge">🇺🇸 Made in USA</span>
                <span className="badge">✅ Dye-free</span>
                <span className="badge">🚚 Ships fast</span>
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div className="kicker">Starting at</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 950, fontSize: 24, marginTop: 6 }}>
                {money(basePriceNumber)}
              </div>
              <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                per bag (base)
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <PatriotRibbon />
          </div>
        </div>
      </div>

      {/* Bundle ladder */}
      <div
        ref={bundlesRef}
        className={cx(
          "card-solid",
          "purchase-ladder",
          focusGlow && "purchase-glow"
        )}
        style={{ marginTop: 14, padding: 14 }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 950, fontSize: 16 }}>Choose your bundle</div>
          <div style={{ opacity: 0.78, fontSize: 13 }}>
            Free shipping at <span style={{ fontWeight: 950 }}>5+</span>
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          }}
          className="bundle-grid"
        >
          {ladder.map((b) => {
            const active = selectedQty === b.qty;
            const accent = Boolean(b.accent);
            const bundleTotal = basePriceNumber * b.qty;

            return (
              <button
                key={b.qty}
                type="button"
                onClick={() => setSelectedQty(b.qty)}
                className={cx(
                  "bundle-tile",
                  active && "bundle-tile--active",
                  accent && "bundle-tile--accent",
                  active && accent && "bundle-tile--active-accent"
                )}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 950, fontSize: 16 }}>{b.label}</div>
                      {b.popular ? (
                        <span
                          style={{
                            borderRadius: 999,
                            padding: "6px 10px",
                            border: "1px solid rgba(193,18,31,0.20)",
                            background: "rgba(193,18,31,0.10)",
                            fontWeight: 950,
                            fontSize: 11,
                          }}
                        >
                          Most Popular
                        </span>
                      ) : null}
                    </div>
                    <div style={{ opacity: 0.75, marginTop: 6, fontSize: 12 }}>
                      {b.tag}
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>Total</div>
                    <div style={{ fontWeight: 950, fontSize: 16 }}>
                      {money(bundleTotal)}
                    </div>
                  </div>
                </div>

                {accent ? (
                  <div style={{ marginTop: 10, opacity: 0.78, fontSize: 12, display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>🔥 Better bundle value</span>
                    <span>🇺🇸 Premium deal tier</span>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, opacity: 0.6, fontSize: 12 }}>
                    Great starter option
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Decision row */}
        <div className="card" style={{ marginTop: 12, padding: 14 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 950 }}>
                Selected:{" "}
                <span style={{ color: selectedAccent ? "var(--red)" : "inherit" }}>
                  {selectedQty} bag(s)
                </span>
              </div>
              <div style={{ opacity: 0.75, marginTop: 6, fontSize: 13 }}>
                {selectedTag} • Bundle total shown below
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ opacity: 0.7, fontSize: 12 }}>Bundle total</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 950, fontSize: 26 }}>
                  {money(total)}
                </div>
              </div>

              <button
                id="add-to-cart-hidden-submit"
                type="button"
                onClick={() => addToCart(selectedQty)}
                style={{ display: "none" }}
                aria-hidden="true"
                tabIndex={-1}
              />

              <button
                type="button"
                disabled={adding}
                onClick={() => addToCart(selectedQty)}
                className={cx(
                  "btn",
                  selectedAccent ? "btn-primary" : "btn-navy",
                  adding && "opacity-70"
                )}
                style={{
                  padding: "12px 18px",
                  borderRadius: 999,
                  border: "none",
                }}
              >
                {adding ? "Adding..." : "Add Bundle to Cart →"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13, lineHeight: 1.5 }}>
            <strong>Tip:</strong> 5+ bags unlocks free shipping. 8+ is usually the best value per checkout.
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 520px){
          .bundle-grid{ grid-template-columns: repeat(1, minmax(0, 1fr)) !important; }
        }

        .purchase-glow{
          outline: 2px solid rgba(242,193,78,0.65);
          box-shadow: 0 0 0 6px rgba(242,193,78,0.18), 0 18px 55px rgba(0,0,0,0.16);
        }

        .bundle-tile{
          width: 100%;
          text-align: left;
          border-radius: 18px;
          border: 1px solid rgba(0,0,0,0.10);
          background: rgba(255,255,255,0.78);
          backdrop-filter: blur(10px);
          padding: 14px;
          cursor: pointer;
          transition: transform .08s ease, box-shadow .18s ease, border-color .18s ease;
        }
        .bundle-tile:hover{
          transform: translateY(-1px);
          box-shadow: 0 16px 34px rgba(0,0,0,0.12);
          border-color: rgba(0,0,0,0.14);
        }
        .bundle-tile--accent{
          border-color: rgba(193,18,31,0.18);
        }
        .bundle-tile--active{
          border-color: rgba(11,30,59,0.22);
          box-shadow: 0 18px 38px rgba(0,0,0,0.14);
        }
        .bundle-tile--active-accent{
          border-color: rgba(193,18,31,0.30);
          box-shadow: 0 18px 44px rgba(193,18,31,0.10);
        }
      `}</style>
    </section>
  );
}
