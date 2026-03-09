"use client";

import { useCallback, useEffect, useState } from "react";

type Variant = {
  id: string;
  title: string;
  available: boolean;
  price: string;
  currency: string;
  qty: number | null;
};

type Product = {
  id: string;
  title: string;
  handle: string;
  image: string | null;
  variants: Variant[];
};

type CartItem = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  price: string;
  quantity: number;
};

export function WholesaleView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);

  // Order form
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<{ name?: string; total?: string; invoiceUrl?: string } | null>(null);
  const [brain, setBrain] = useState<{ insights: string[]; sources: { title: string; source_table: string }[] } | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainError, setBrainError] = useState<string | null>(null);

  const fetchBrainInsights = useCallback(async () => {
    setBrainLoading(true);
    setBrainError(null);
    try {
      const res = await fetch("/api/ops/abra/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "wholesale B2B distributors bulk orders pricing wholesale accounts" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch insights");
      setBrain(data);
    } catch (err) {
      setBrainError(err instanceof Error ? err.message : "Brain query failed");
    } finally {
      setBrainLoading(false);
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/ops/wholesale/products", { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        setProducts(json.products || []);
      } catch {
        setError("Failed to load products");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function addToCart(product: Product, variant: Variant) {
    setCart((prev) => {
      const existing = prev.find((c) => c.variantId === variant.id);
      if (existing) {
        return prev.map((c) => c.variantId === variant.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, {
        variantId: variant.id,
        productTitle: product.title,
        variantTitle: variant.title === "Default Title" ? "" : variant.title,
        price: variant.price,
        quantity: 1,
      }];
    });
  }

  function updateQty(variantId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.variantId !== variantId));
    } else {
      setCart((prev) => prev.map((c) => c.variantId === variantId ? { ...c, quantity: qty } : c));
    }
  }

  const cartTotal = cart.reduce((sum, c) => sum + parseFloat(c.price) * c.quantity, 0);

  async function submitOrder() {
    if (!customerName || !customerEmail || cart.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/ops/wholesale/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          customerEmail,
          companyName,
          note,
          lineItems: cart.map((c) => ({ variantId: c.variantId, quantity: c.quantity })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `${res.status}`);
      setOrderResult(json.draftOrder);
      setCart([]);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    background: "#12141c",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#fff",
    padding: "10px 14px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
  } as const;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
            Wholesale Orders
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: 0 }}>
            Create Shopify draft orders for wholesale and B2B customers.
          </p>
        </div>
        <button
          onClick={() => void fetchBrainInsights()}
          disabled={brainLoading}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            border: `1px solid ${brain ? "rgba(199,160,98,0.4)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 10,
            background: brain ? "rgba(199,160,98,0.08)" : "#1a1d27",
            color: "#fff", padding: "8px 12px", fontSize: 12, fontWeight: 700,
            cursor: brainLoading ? "default" : "pointer",
            opacity: brainLoading ? 0.7 : 1, fontFamily: "inherit",
          }}
        >
          {brainLoading ? "Thinking..." : brain ? "Refresh Intel" : "🧠 Intel"}
        </button>
      </div>

      {brainError && (
        <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#ef4444" }}>
          🧠 Brain: {brainError}
        </div>
      )}
      {brain && brain.insights.length > 0 && (
        <div style={{ background: "rgba(199,160,98,0.06)", border: "1px solid rgba(199,160,98,0.2)", borderRadius: 12, padding: "14px 16px", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "#fff", marginBottom: 10, fontSize: 14 }}>
            🧠 Distributor Intelligence
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 18px", listStyle: "disc" }}>
            {brain.insights.map((insight, i) => (
              <li key={i} style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.6, marginBottom: 4 }}>{insight}</li>
            ))}
          </ul>
          {brain.sources.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {brain.sources.map((s, i) => (
                <span key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: s.source_table === "email" ? "rgba(255,255,255,0.06)" : "rgba(199,160,98,0.1)",
                  border: `1px solid ${s.source_table === "email" ? "rgba(255,255,255,0.1)" : "rgba(199,160,98,0.2)"}`,
                  borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: 600,
                }}>
                  {s.source_table === "email" ? "📧" : "🧠"} {s.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {orderResult && (
        <div style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 12, padding: "20px 24px", marginBottom: 28 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#4ade80", marginBottom: 8 }}>
            Draft Order Created: {orderResult.name}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
            Total: ${orderResult.total}
            {orderResult.invoiceUrl && (
              <> · <a href={orderResult.invoiceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa" }}>Send Invoice</a></>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* Product catalog */}
        <div style={{ flex: "2 1 400px", minWidth: 0 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Products
          </h2>

          {loading && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, padding: "20px 0" }}>Loading products...</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {products.map((p) => (
              <div key={p.id} style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  {p.image && (
                    <img
                      src={p.image}
                      alt={p.title}
                      style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", background: "#0d0f14" }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{p.title}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                      {p.variants.length} variant{p.variants.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {p.variants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => addToCart(p, v)}
                      disabled={!v.available}
                      style={{
                        padding: "6px 14px",
                        fontSize: 11,
                        fontWeight: 500,
                        background: v.available ? "rgba(99,102,241,0.1)" : "rgba(107,114,128,0.1)",
                        color: v.available ? "#a5b4fc" : "#6b7280",
                        border: `1px solid ${v.available ? "rgba(99,102,241,0.15)" : "rgba(107,114,128,0.1)"}`,
                        borderRadius: 6,
                        cursor: v.available ? "pointer" : "not-allowed",
                        fontFamily: "inherit",
                      }}
                    >
                      {v.title === "Default Title" ? `$${v.price}` : `${v.title} · $${v.price}`}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cart + Order form */}
        <div style={{ flex: "1 1 300px", minWidth: 280 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Order ({cart.length} item{cart.length !== 1 ? "s" : ""})
          </h2>

          <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
            {cart.length === 0 ? (
              <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>
                Add products to start an order
              </div>
            ) : (
              <>
                {cart.map((item) => (
                  <div key={item.variantId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>
                        {item.productTitle}{item.variantTitle ? ` — ${item.variantTitle}` : ""}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>${item.price} each</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button onClick={() => updateQty(item.variantId, item.quantity - 1)} style={{ width: 24, height: 24, borderRadius: 6, background: "rgba(255,255,255,0.06)", border: "none", color: "#fff", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>-</button>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", minWidth: 20, textAlign: "center" }}>{item.quantity}</span>
                      <button onClick={() => updateQty(item.variantId, item.quantity + 1)} style={{ width: 24, height: 24, borderRadius: 6, background: "rgba(255,255,255,0.06)", border: "none", color: "#fff", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", minWidth: 55, textAlign: "right" }}>
                      ${(parseFloat(item.price) * item.quantity).toFixed(2)}
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, marginTop: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>Total</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>${cartTotal.toFixed(2)}</span>
                </div>
              </>
            )}
          </div>

          {/* Customer info */}
          <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", marginBottom: 14 }}>
              Customer Info
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input placeholder="Customer Name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} style={inputStyle} />
              <input placeholder="Email *" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} style={inputStyle} />
              <input placeholder="Company Name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={inputStyle} />
              <textarea placeholder="Order notes..." value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <button
              onClick={submitOrder}
              disabled={submitting || cart.length === 0 || !customerName || !customerEmail}
              style={{
                marginTop: 16,
                width: "100%",
                padding: "12px 20px",
                fontSize: 14,
                fontWeight: 600,
                background: cart.length > 0 && customerName && customerEmail ? "rgba(99,102,241,0.9)" : "rgba(99,102,241,0.2)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                cursor: submitting || cart.length === 0 ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Creating Draft Order..." : `Create Draft Order — $${cartTotal.toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
