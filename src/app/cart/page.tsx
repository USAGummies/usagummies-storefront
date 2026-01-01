// src/app/cart/page.tsx (FULL REPLACE)
import Link from "next/link";
import Image from "next/image";
import { getCart } from "@/lib/cart";
import { CartLineControls } from "@/components/cart/CartLineControls.client";
import { ReviewsSummary } from "@/components/reviews/ReviewsSummary";
import { PatriotBanner } from "@/components/ui/PatriotBanner";
import { PatriotRibbon } from "@/components/ui/PatriotRibbon";

function formatMoney(amount: any) {
  const n = Number(amount?.amount ?? 0);
  const currency = String(amount?.currencyCode ?? "USD");
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function clampPct(pct: number) {
  return Math.max(0, Math.min(100, pct));
}

function ShippingMission({
  totalQty,
  remaining,
}: {
  totalQty: number;
  remaining: number;
}) {
  const pct = clampPct(Math.round((totalQty / 5) * 100));
  const unlocked = totalQty >= 5;

  const label = unlocked
    ? "Unlocked ✅"
    : remaining === 1
    ? "Add 1 more bag"
    : `Add ${remaining} more bags`;

  return (
    <div className="card-solid" style={{ padding: 16 }}>
      <div className="kicker">Free shipping mission</div>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 950, fontSize: 16 }}>
          {unlocked ? "Free shipping unlocked" : "Unlock free shipping"}
        </div>
        <div style={{ opacity: 0.78, fontSize: 13 }}>{label}</div>
      </div>

      <div
        style={{
          marginTop: 10,
          height: 10,
          borderRadius: 999,
          overflow: "hidden",
          background: "rgba(0,0,0,0.18)",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, rgba(11,30,59,0.95), rgba(193,18,31,0.90))",
          }}
        />
      </div>

      <div style={{ marginTop: 10, opacity: 0.78, fontSize: 13, lineHeight: 1.5 }}>
        Free shipping unlocks automatically at{" "}
        <span style={{ fontWeight: 950 }}>5+ bags</span>. Bundles are the fastest
        way to get there.
      </div>

      <div style={{ marginTop: 12 }}>
        <PatriotRibbon />
      </div>

      {!unlocked ? (
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href="/shop">
            Add bags →
          </Link>
          <Link className="btn btn-navy" href="/shop?sort=best-selling">
            Best-sellers →
          </Link>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span className="badge">✅ Free shipping active</span>
          <span className="badge">🇺🇸 Made in USA</span>
          <span className="badge">🚚 Ships fast</span>
        </div>
      )}
    </div>
  );
}

export default async function CartPage() {
  const cart = await getCart();

  const lines =
    (cart?.lines as any)?.nodes ??
    (cart?.lines as any)?.edges?.map((e: any) => e?.node) ??
    [];

  const totalQty = lines.reduce(
    (sum: number, l: any) => sum + (l?.quantity || 0),
    0
  );

  const remaining = Math.max(0, 5 - totalQty);

  const subtotal = cart?.cost?.subtotalAmount
    ? formatMoney(cart.cost.subtotalAmount)
    : "";

  const estimatedTotal = subtotal;

  return (
    <main style={{ padding: "18px 0 44px" }}>
      <div className="container">
        {/* Top nav */}
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 10,
          }}
        >
          <div style={{ opacity: 0.78, fontSize: 13 }}>
            <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>
              Home
            </Link>{" "}
            <span style={{ opacity: 0.45 }}>›</span>{" "}
            <span style={{ fontWeight: 950 }}>Cart</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn" href="/shop">
              Keep shopping →
            </Link>
            <a
              className="btn btn-navy"
              href={cart?.checkoutUrl || "#"}
              aria-disabled={!cart?.checkoutUrl}
              style={!cart?.checkoutUrl ? { opacity: 0.55, pointerEvents: "none" } : undefined}
            >
              Checkout →
            </a>
          </div>
        </div>

        {/* Hero */}
        <div style={{ marginTop: 14 }}>
          <PatriotBanner />
        </div>

        <div className="card-solid" style={{ marginTop: 14, padding: 18 }}>
          <div className="kicker">USA Gummies</div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              textTransform: "uppercase",
              fontWeight: 950,
              letterSpacing: "-0.02em",
              fontSize: 34,
              lineHeight: 0.95,
              marginTop: 8,
            }}
          >
            Your cart
          </div>
          <div style={{ marginTop: 10, opacity: 0.8, maxWidth: 820, lineHeight: 1.6 }}>
            Fast shipping. Secure Shopify checkout. Bundle pricing does the heavy lifting —
            your cart is designed to nudge you into the best deal.
          </div>

          <div style={{ marginTop: 12 }}>
            <PatriotRibbon />
          </div>
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 14, gridTemplateColumns: "1.7fr 1fr" }} className="cart-grid">
          {/* Lines */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Items</div>
              <div style={{ opacity: 0.78, fontSize: 13 }}>
                {lines.length ? `${lines.length} line(s)` : "No items yet"}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {lines.length === 0 ? (
                <div className="card-solid" style={{ padding: 18, textAlign: "center" }}>
                  <div style={{ fontWeight: 950, fontSize: 16 }}>Your cart is empty</div>
                  <div style={{ marginTop: 8, opacity: 0.78 }}>
                    Let’s fix that. Bundles are the best way to buy.
                  </div>
                  <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                    <Link className="btn btn-primary" href="/shop">
                      Shop gummies →
                    </Link>
                    <Link className="btn btn-navy" href="/america-250">
                      America 250 →
                    </Link>
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {lines.map((l: any) => {
                    const title = l?.merchandise?.product?.title || "Item";
                    const variant = l?.merchandise?.title || "";
                    const img = l?.merchandise?.image?.url || l?.merchandise?.product?.featuredImage?.url || null;

                    return (
                      <div key={l.id} className="card-solid" style={{ padding: 14 }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
                            <div
                              style={{
                                position: "relative",
                                height: 56,
                                width: 56,
                                borderRadius: 14,
                                overflow: "hidden",
                                border: "1px solid rgba(0,0,0,0.10)",
                                background: "rgba(255,255,255,0.55)",
                                flex: "0 0 auto",
                              }}
                            >
                              {img ? (
                                <Image
                                  src={img}
                                  alt={title}
                                  fill
                                  sizes="56px"
                                  className="object-cover"
                                />
                              ) : null}
                            </div>

                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 950, lineHeight: 1.2 }}>{title}</div>
                              {variant ? (
                                <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
                                  {variant}
                                </div>
                              ) : null}
                              <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <span className="badge">Qty: {l.quantity}</span>
                                <span className="badge">🇺🇸 Made in USA</span>
                                <span className="badge">✅ Dye-free</span>
                              </div>

                              <div style={{ marginTop: 10 }}><CartLineControls lineId={l.id} quantity={l.quantity} /></div>
                            </div>
                          </div>

                          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                            <div style={{ opacity: 0.72, fontSize: 12 }}>Line total</div>
                            <div style={{ fontWeight: 950, fontSize: 16, marginTop: 4 }}>
                              {l.cost?.totalAmount ? formatMoney(l.cost.totalAmount) : ""}
                            </div>
                          </div>
                        </div>

                        <div style={{ marginTop: 10, opacity: 0.78, fontSize: 13 }}>
                          Want bundle pricing?{" "}
                          <Link
                            href={`/products/${l?.merchandise?.product?.handle || ""}?focus=bundles`}
                            className="underline decoration-black/20 hover:decoration-black/40"
                          >
                            See bundle ladder →
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          <div style={{ display: "grid", gap: 12 }}>
            <ShippingMission totalQty={totalQty} remaining={remaining} />

            <div className="card" style={{ padding: 16 }}>
              <div className="kicker">Order summary</div>

              <div style={{ marginTop: 10, display: "grid", gap: 10, fontSize: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, opacity: 0.85 }}>
                  <span>Subtotal</span>
                  <span style={{ fontWeight: 950 }}>{subtotal}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, opacity: 0.85 }}>
                  <span>Estimated total</span>
                  <span style={{ fontWeight: 950 }}>{estimatedTotal}</span>
                </div>
              </div>

              <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12, lineHeight: 1.5 }}>
                Final shipping/tax calculated at Shopify checkout.
              </div>

              <div style={{ marginTop: 12 }}>
                <a
                  href={cart?.checkoutUrl || "#"}
                  className="btn btn-primary"
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    borderRadius: 16,
                    padding: "14px 16px",
                    fontWeight: 950,
                    pointerEvents: cart?.checkoutUrl ? "auto" : "none",
                    opacity: cart?.checkoutUrl ? 1 : 0.55,
                  }}
                >
                  Checkout →
                </a>
              </div>

              <div style={{ marginTop: 10, textAlign: "center", opacity: 0.75, fontSize: 12 }}>
                Secure checkout powered by Shopify
              </div>
            </div>

            <ReviewsSummary />

            <div className="card-solid" style={{ padding: 16 }}>
              <div style={{ fontWeight: 950 }}>Pro move:</div>
              <div style={{ marginTop: 6, opacity: 0.8, lineHeight: 1.5 }}>
                Bundles save time and unlock free shipping faster. If you’re close,
                add one more bag and lock in the best checkout.
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link className="btn btn-navy" href="/shop">
                  Shop bundles →
                </Link>
                <Link className="btn" href="/america-250">
                  America 250 →
                </Link>
              </div>
            </div>
          </div>
        </div>

        <style>{`
          @media (max-width: 980px){
            .cart-grid{ grid-template-columns: 1fr !important; }
          }
        `}</style>
      </div>
    </main>
  );
}
