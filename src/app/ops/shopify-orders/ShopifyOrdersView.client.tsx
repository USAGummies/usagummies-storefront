"use client";

/**
 * /ops/shopify-orders — Shopify DTC unfulfilled-paid queue (fallback).
 *
 * When the `orders/paid` webhook is configured + firing, Shopify
 * orders auto-dispatch — this page stays empty-ish. When the webhook
 * misses (config drift, Shopify outage) OR before Ben configures it
 * (guide §2), this page is the manual catch-up path.
 *
 * Ben sees every unfulfilled paid order with full ship-to + line
 * items. One-click "Dispatch" posts the Class B proposal to
 * #ops-approvals. No forms to fill — Shopify payload has the address.
 */
import { useCallback, useEffect, useState } from "react";

import {
  NAVY,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

const GREEN = "#16a34a";
const YELLOW = "#eab308";

interface DispatchReadyOrder {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string;
  totalAmount: number;
  currencyCode: string;
  customer: { displayName: string | null; email: string | null } | null;
  shippingAddress: {
    name: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    provinceCode: string | null;
    zip: string | null;
    country: string | null;
    countryCode: string | null;
    phone: string | null;
  } | null;
  lineItems: Array<{ title: string; sku: string | null; quantity: number }>;
  tags: string[];
  note: string | null;
}

interface QueueResponse {
  ok: boolean;
  totalCount: number;
  orders: DispatchReadyOrder[];
  error?: string;
}

function money(n: number, currency = "USD"): string {
  if (currency === "USD") return `$${n.toFixed(2)}`;
  return `${n.toFixed(2)} ${currency}`;
}

function ageHours(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export function ShopifyOrdersView() {
  const [orders, setOrders] = useState<DispatchReadyOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/shopify/unshipped?days=14&limit=50", {
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as QueueResponse;
      setOrders(json.orders);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  const dispatch = useCallback(
    async (order: DispatchReadyOrder) => {
      if (!confirm(`Dispatch ${order.name} (${money(order.totalAmount)}) to #ops-approvals?`)) {
        return;
      }
      setDispatching(order.id);
      try {
        const res = await fetch("/api/ops/shopify/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: order.id }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          refuseReason?: string;
          proposal?: { summary?: string };
        };
        if (!res.ok) {
          setResults((p) => ({
            ...p,
            [order.id]: {
              ok: false,
              message: data.error ?? data.refuseReason ?? `HTTP ${res.status}`,
            },
          }));
        } else {
          setResults((p) => ({
            ...p,
            [order.id]: {
              ok: true,
              message: `Dispatched · ${data.proposal?.summary ?? "proposal posted"}`,
            },
          }));
          await load();
        }
      } catch (err) {
        setResults((p) => ({
          ...p,
          [order.id]: {
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          },
        }));
      } finally {
        setDispatching(null);
      }
    },
    [load],
  );

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", color: NAVY }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
            🛒 Shopify DTC Queue
          </h1>
          <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>
            Paid + unfulfilled Shopify orders (fallback queue). Normally
            the <code>orders/paid</code> webhook auto-dispatches — use
            this page only when the webhook has missed or is not yet
            configured.
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            background: CARD,
            color: NAVY,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          style={{
            border: `1px solid ${RED}55`,
            background: `${RED}0d`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13,
            color: RED,
          }}
        >
          ❌ {error}
        </div>
      )}

      {!loading && orders.length === 0 && !error && (
        <div
          style={{
            border: `1px solid ${GREEN}55`,
            background: `${GREEN}0d`,
            borderRadius: 10,
            padding: 20,
            fontSize: 14,
            color: GREEN,
            textAlign: "center",
            fontWeight: 600,
          }}
        >
          ✅ No unfulfilled Shopify orders.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
          gap: 14,
        }}
      >
        {orders.map((o) => {
          const hrs = ageHours(o.createdAt);
          const urgencyColor = hrs > 36 ? RED : hrs > 24 ? YELLOW : GREEN;
          const urgencyLabel = hrs > 24
            ? `${Math.round(hrs)}h since placed`
            : `${Math.round(hrs)}h ago`;
          const ship = o.shippingAddress;
          const result = results[o.id];
          const complete =
            !!ship &&
            !!ship.address1 &&
            !!ship.city &&
            !!ship.provinceCode &&
            !!ship.zip;

          return (
            <div
              key={o.id}
              style={{
                border: `1px solid ${BORDER}`,
                borderLeft: `4px solid ${urgencyColor}`,
                borderRadius: 12,
                background: CARD,
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "start",
                  marginBottom: 6,
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{o.name}</div>
                  <div style={{ fontSize: 12, color: DIM, marginTop: 2 }}>
                    {money(o.totalAmount, o.currencyCode)} ·{" "}
                    {o.lineItems.reduce((s, l) => s + l.quantity, 0)} unit(s) ·{" "}
                    {o.customer?.displayName ?? "Guest"}
                  </div>
                </div>
                <span
                  style={{
                    color: urgencyColor,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                >
                  {urgencyLabel}
                </span>
              </div>

              {ship && (
                <div
                  style={{
                    fontSize: 11,
                    color: DIM,
                    padding: "6px 10px",
                    background: "rgba(27,42,74,0.03)",
                    borderRadius: 6,
                    marginBottom: 10,
                    lineHeight: 1.4,
                  }}
                >
                  <div>
                    {ship.name ?? o.customer?.displayName ?? "?"}
                    {ship.company ? ` (${ship.company})` : ""}
                  </div>
                  <div>
                    {ship.address1}
                    {ship.address2 ? ` · ${ship.address2}` : ""}
                  </div>
                  <div>
                    {ship.city}, {ship.provinceCode} {ship.zip}{" "}
                    {ship.country && ship.country !== "United States"
                      ? `· ${ship.country}`
                      : ""}
                  </div>
                </div>
              )}

              {o.lineItems.length > 0 && (
                <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>
                  {o.lineItems.map((l, i) => (
                    <span key={i}>
                      {l.quantity}× {l.title}
                      {i < o.lineItems.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </div>
              )}

              {o.tags.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {o.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        display: "inline-block",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        padding: "2px 6px",
                        marginRight: 4,
                        color: NAVY,
                        background: "rgba(27,42,74,0.06)",
                        borderRadius: 4,
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => void dispatch(o)}
                disabled={dispatching === o.id || !complete}
                style={{
                  width: "100%",
                  border: `1px solid ${complete ? GREEN : DIM}55`,
                  background: `${complete ? GREEN : DIM}0f`,
                  color: complete ? GREEN : DIM,
                  borderRadius: 8,
                  padding: "10px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor:
                    dispatching === o.id || !complete ? "default" : "pointer",
                }}
              >
                {dispatching === o.id
                  ? "Dispatching…"
                  : complete
                    ? "📬 Dispatch to #ops-approvals"
                    : "⚠️ Ship-to incomplete"}
              </button>

              {result && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    background: result.ok ? `${GREEN}0d` : `${RED}0d`,
                    color: result.ok ? GREEN : RED,
                    fontSize: 12,
                    borderRadius: 6,
                    border: `1px solid ${result.ok ? GREEN : RED}55`,
                  }}
                >
                  {result.ok ? "✅ " : "❌ "}
                  {result.message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
