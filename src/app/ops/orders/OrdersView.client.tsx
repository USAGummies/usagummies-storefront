"use client";

import { useEffect, useMemo, useState } from "react";

type Order = {
  id: string;
  order_ref: string;
  customer_name: string;
  ship_to?: string;
  date: string;
  units: number;
  subtotal: number;
  shipping_charged?: number;
  total: number;
  terms?: string;
  status: string;
  notes?: string;
};

function money(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function isShipHold(order: Order) {
  const text = `${order.terms || ""}\n${order.notes || ""}`.toLowerCase();
  return text.includes("ship hold") || text.includes("awaiting invoice payment") || text.includes("checkout pending");
}

export function OrdersView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ops/orders/log?channel=Wholesale&limit=200", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const nextOrders = Array.isArray(json.orders) ? json.orders : [];
      setOrders(nextOrders.reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const summary = useMemo(() => {
    const shipHold = orders.filter(isShipHold).length;
    const units = orders.reduce((sum, order) => sum + (order.units || 0), 0);
    const revenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);
    return { shipHold, units, revenue };
  }, [orders]);

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#0b1733" }}>Wholesale Orders Queue</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: "rgba(11,23,51,0.65)" }}>
            One internal queue for booth, invoice, and prepaid wholesale orders.
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            border: "1px solid rgba(11,23,51,0.12)",
            background: "#fff",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 12,
            fontWeight: 700,
            color: "#0b1733",
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
        {[
          { label: "Wholesale orders", value: String(orders.length), color: "#0b1733" },
          { label: "Ship hold", value: String(summary.shipHold), color: "#b22234" },
          { label: "Units queued", value: String(summary.units), color: "#1d4ed8" },
          { label: "Gross queued", value: money(summary.revenue), color: "#166534" },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: "#fff",
              border: "1px solid rgba(11,23,51,0.08)",
              borderLeft: `4px solid ${card.color}`,
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(11,23,51,0.55)" }}>
              {card.label}
            </div>
            <div style={{ marginTop: 4, fontSize: 28, fontWeight: 800, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.18)", borderRadius: 12, padding: "12px 14px", color: "#b91c1c", marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid rgba(11,23,51,0.08)", borderRadius: 14, overflow: "hidden" }}>
        {loading && orders.length === 0 ? (
          <div style={{ padding: 20, fontSize: 14, color: "rgba(11,23,51,0.6)" }}>Loading wholesale queue…</div>
        ) : orders.length === 0 ? (
          <div style={{ padding: 20, fontSize: 14, color: "rgba(11,23,51,0.6)" }}>No wholesale orders logged yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 0 }}>
            {orders.map((order) => {
              const hold = isShipHold(order);
              return (
                <div
                  key={order.id}
                  style={{
                    padding: "16px 18px",
                    borderTop: "1px solid rgba(11,23,51,0.06)",
                    background: hold ? "rgba(178,34,52,0.03)" : "#fff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: "1 1 420px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#0b1733" }}>{order.customer_name}</div>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: 999,
                            padding: "3px 8px",
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            color: hold ? "#991b1b" : "#166534",
                            background: hold ? "rgba(239,68,68,0.10)" : "rgba(22,163,74,0.10)",
                          }}
                        >
                          {hold ? "Ship hold" : "Ready"}
                        </span>
                        <span style={{ fontSize: 11, color: "rgba(11,23,51,0.45)", fontWeight: 700 }}>
                          {order.order_ref}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: "rgba(11,23,51,0.72)", lineHeight: 1.5 }}>
                        <div>{order.units} units · {money(order.total)} · {order.date}</div>
                        {order.ship_to && <div>{order.ship_to}</div>}
                        {order.terms && <div><strong>Terms:</strong> {order.terms}</div>}
                        {order.notes && (
                          <div style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "rgba(11,23,51,0.62)" }}>
                            {order.notes}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 140 }}>
                      <div style={{ fontSize: 11, color: "rgba(11,23,51,0.45)", textTransform: "uppercase", fontWeight: 800, letterSpacing: "0.05em" }}>
                        Status
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#0b1733", marginTop: 4 }}>{order.status}</div>
                      <div style={{ marginTop: 10, fontSize: 12, color: "rgba(11,23,51,0.6)" }}>
                        Subtotal {money(order.subtotal)}
                      </div>
                      <div style={{ fontSize: 12, color: "rgba(11,23,51,0.6)" }}>
                        Freight {money(order.shipping_charged || 0)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
