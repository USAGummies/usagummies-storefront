"use client";

/**
 * /ops/amazon-fbm — Amazon FBM daily queue + dispatch.
 *
 * Ben's actual tomorrow-morning workflow:
 *   1. Open /ops/amazon-fbm on laptop (or phone)
 *   2. See every unshipped MFN order as a card
 *   3. Click "Open Seller Central" to grab the buyer ship-to
 *   4. Paste the address into the form, hit Dispatch
 *   5. Class B proposal appears in #ops-approvals
 *   6. Approve → buy-label fires
 *
 * No shell, no API tokens, no auth juggling.
 */
import { useCallback, useEffect, useState } from "react";

import {
  NAVY,
  RED,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

const GREEN = "#16a34a";
const YELLOW = "#eab308";

interface FbmOrder {
  orderId: string;
  purchaseDate: string;
  lastUpdateDate: string;
  orderStatus: string;
  amount: number;
  currency: string;
  numberOfItemsUnshipped: number;
  salesChannel: string;
  sellerCentralUrl: string;
  latestShipDateEstimate: string;
}

interface UnshippedResponse {
  ok: boolean;
  totalUnshipped: number;
  freshlyAlerted: number;
  urgentReAlerted: number;
  orders: FbmOrder[];
  degraded?: string[];
}

interface ShipToForm {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
}

const EMPTY_SHIP_TO: ShipToForm = {
  name: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  postalCode: "",
  phone: "",
};

function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

function money(n: number, currency = "USD"): string {
  if (currency === "USD") return `$${n.toFixed(2)}`;
  return `${n.toFixed(2)} ${currency}`;
}

export function AmazonFbmView() {
  const [orders, setOrders] = useState<FbmOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shipToByOrder, setShipToByOrder] = useState<Record<string, ShipToForm>>({});
  const [dispatchingOrder, setDispatchingOrder] = useState<string | null>(null);
  const [dispatchResults, setDispatchResults] = useState<
    Record<string, { ok: boolean; message: string }>
  >({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/ops/amazon/unshipped-fbm-alert?post=false",
        { cache: "no-store" },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as UnshippedResponse;
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
    const t = setInterval(() => void load(), 120_000); // 2-min poll
    return () => clearInterval(t);
  }, [load]);

  const getShipTo = (orderId: string): ShipToForm =>
    shipToByOrder[orderId] ?? EMPTY_SHIP_TO;

  const updateShipTo = (orderId: string, patch: Partial<ShipToForm>) => {
    setShipToByOrder((prev) => ({
      ...prev,
      [orderId]: { ...getShipTo(orderId), ...patch },
    }));
  };

  const dispatch = useCallback(
    async (order: FbmOrder) => {
      const shipTo = getShipTo(order.orderId);
      const missing: string[] = [];
      if (!shipTo.name) missing.push("name");
      if (!shipTo.street1) missing.push("street1");
      if (!shipTo.city) missing.push("city");
      if (!shipTo.state || shipTo.state.length !== 2) missing.push("state (2-letter)");
      if (!shipTo.postalCode) missing.push("postalCode");
      if (missing.length > 0) {
        alert(`Missing ship-to fields: ${missing.join(", ")}`);
        return;
      }
      setDispatchingOrder(order.orderId);
      try {
        const res = await fetch("/api/ops/amazon/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: order.orderId,
            shipTo: {
              name: shipTo.name,
              street1: shipTo.street1,
              street2: shipTo.street2 || undefined,
              city: shipTo.city,
              state: shipTo.state.toUpperCase(),
              postalCode: shipTo.postalCode,
              phone: shipTo.phone || undefined,
              residential: true,
            },
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          proposal?: { summary?: string };
          refuseReason?: string;
        };
        if (!res.ok) {
          setDispatchResults((p) => ({
            ...p,
            [order.orderId]: {
              ok: false,
              message: data.error ?? data.refuseReason ?? `HTTP ${res.status}`,
            },
          }));
          return;
        }
        setDispatchResults((p) => ({
          ...p,
          [order.orderId]: {
            ok: true,
            message:
              `Dispatched! ${data.proposal?.summary ?? "Proposal in #ops-approvals"} — approve there.`,
          },
        }));
        // Clear form after successful dispatch.
        setShipToByOrder((prev) => {
          const { [order.orderId]: _omit, ...rest } = prev;
          void _omit;
          return rest;
        });
        // Refresh to pick up the "dispatched" dedupe flag.
        await load();
      } catch (err) {
        setDispatchResults((p) => ({
          ...p,
          [order.orderId]: {
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          },
        }));
      } finally {
        setDispatchingOrder(null);
      }
    },
    [load, shipToByOrder],
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
            📦 Amazon FBM Queue
          </h1>
          <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>
            Unshipped MFN orders. Copy ship-to from Seller Central, paste,
            dispatch. Handling promise: ≤ 2 business days.
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
          ✅ No unshipped FBM orders.
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
          const hoursLeft = hoursUntil(o.latestShipDateEstimate);
          const urgencyColor =
            hoursLeft < 0 ? RED : hoursLeft < 12 ? YELLOW : GREEN;
          const urgencyLabel =
            hoursLeft < 0
              ? `LATE (${Math.abs(Math.round(hoursLeft))}h past)`
              : hoursLeft < 12
                ? `${Math.round(hoursLeft)}h left`
                : `${Math.round(hoursLeft)}h until ship-by`;
          const shipTo = getShipTo(o.orderId);
          const result = dispatchResults[o.orderId];

          return (
            <div
              key={o.orderId}
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
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "ui-monospace, Menlo, monospace",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {o.orderId}
                  </div>
                  <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>
                    {o.numberOfItemsUnshipped} unit(s) · {money(o.amount, o.currency)}{" "}
                    · {o.salesChannel}
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
              <div style={{ fontSize: 11, color: DIM, marginBottom: 12 }}>
                Purchased {o.purchaseDate.slice(0, 16).replace("T", " ")}
              </div>
              <div style={{ marginBottom: 12 }}>
                <a
                  href={o.sellerCentralUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 12,
                    color: NAVY,
                    textDecoration: "underline",
                    fontWeight: 600,
                  }}
                >
                  Open in Seller Central →
                </a>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <Input
                  label="Name"
                  value={shipTo.name}
                  onChange={(v) => updateShipTo(o.orderId, { name: v })}
                />
                <Input
                  label="Street 1"
                  value={shipTo.street1}
                  onChange={(v) => updateShipTo(o.orderId, { street1: v })}
                />
                <Input
                  label="Street 2"
                  value={shipTo.street2}
                  onChange={(v) => updateShipTo(o.orderId, { street2: v })}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 110px", gap: 6 }}>
                  <Input
                    label="City"
                    value={shipTo.city}
                    onChange={(v) => updateShipTo(o.orderId, { city: v })}
                  />
                  <Input
                    label="State"
                    value={shipTo.state}
                    onChange={(v) => updateShipTo(o.orderId, { state: v.toUpperCase() })}
                  />
                  <Input
                    label="ZIP"
                    value={shipTo.postalCode}
                    onChange={(v) => updateShipTo(o.orderId, { postalCode: v })}
                  />
                </div>
                <Input
                  label="Phone (optional)"
                  value={shipTo.phone}
                  onChange={(v) => updateShipTo(o.orderId, { phone: v })}
                />
              </div>

              <button
                onClick={() => void dispatch(o)}
                disabled={dispatchingOrder === o.orderId}
                style={{
                  marginTop: 12,
                  width: "100%",
                  border: `1px solid ${GREEN}55`,
                  background: `${GREEN}0f`,
                  color: GREEN,
                  borderRadius: 8,
                  padding: "10px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor:
                    dispatchingOrder === o.orderId ? "default" : "pointer",
                }}
              >
                {dispatchingOrder === o.orderId
                  ? "Dispatching…"
                  : "📬 Dispatch to #ops-approvals"}
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

      <div
        style={{
          marginTop: 22,
          padding: "12px 16px",
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          fontSize: 12,
          color: DIM,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, color: NAVY, marginBottom: 4 }}>
          Why manual ship-to?
        </div>
        Amazon&apos;s SP-API requires a Restricted Data Token (RDT) to
        return buyer addresses. Until we&apos;re approved for PII access,
        you copy the address from Seller Central. The deeplink in each
        card opens the order directly — click, copy, paste, dispatch.
        Each dispatch posts a Class B proposal to <code>#ops-approvals</code>{" "}
        that you approve to fire the label buy.
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: 10,
          color: DIM,
          textTransform: "uppercase",
          fontWeight: 700,
          letterSpacing: 0.5,
          marginBottom: 2,
        }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: `1px solid ${BORDER}`,
          borderRadius: 6,
          padding: "6px 8px",
          fontSize: 13,
          fontFamily: "inherit",
          color: NAVY,
          background: "white",
        }}
      />
    </label>
  );
}

// Keep GOLD imported for future polish without burning a lint warning.
void GOLD;
