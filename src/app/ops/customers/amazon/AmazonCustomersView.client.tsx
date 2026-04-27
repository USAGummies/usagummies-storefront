"use client";

/**
 * Amazon FBM customer registry — Phase 28k.
 *
 * One-page view of every unique buyer we've shipped to via Amazon
 * FBM. Powered by `GET /api/ops/customers/amazon`. Refreshes on
 * mount + when filters change. Each row expandable to show recent
 * order history.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  NAVY,
  GOLD,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

interface OrderEntry {
  orderNumber: string;
  shippedAt: string;
  bags: number;
  shippingCostUsd: number | null;
  revenueUsd: number | null;
  trackingNumber: string | null;
}

interface CustomerRecord {
  fingerprint: string;
  shipToName: string;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  orderCount: number;
  totalBags: number;
  totalRevenueUsd: number;
  totalShippingCostUsd: number;
  recentOrders: OrderEntry[];
}

interface Counts {
  total: number;
  repeat: number;
  oneAndDone: number;
  totalOrders: number;
  totalBags: number;
  totalRevenueUsd: number;
}

interface Response {
  ok: boolean;
  counts: Counts;
  customers: CustomerRecord[];
}

type SortBy = "lastSeen" | "firstSeen" | "orderCount" | "totalRevenue";

export function AmazonCustomersView() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("lastSeen");
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("sortBy", sortBy);
      if (repeatOnly) params.set("repeatOnly", "true");
      const r = await fetch(
        `/api/ops/customers/amazon?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Response;
      if (!j.ok) throw new Error("API returned ok:false");
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sortBy, repeatOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const customers = useMemo(() => data?.customers ?? [], [data]);
  const counts = data?.counts;

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            margin: 0,
            color: NAVY,
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: -0.5,
          }}
        >
          Amazon Customers
        </h1>
        <p style={{ margin: "6px 0 0 0", color: DIM, fontSize: 13 }}>
          Every unique buyer we&apos;ve shipped to via Amazon FBM. Updated on
          every auto-ship. Anonymized by Amazon — no email or phone, just
          ship-to.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <Tile label="Unique customers" value={counts?.total ?? "—"} accent={NAVY} />
        <Tile label="Repeat" value={counts?.repeat ?? "—"} accent={GOLD} />
        <Tile
          label="One-and-done"
          value={counts?.oneAndDone ?? "—"}
          accent="#888"
        />
        <Tile label="Total orders" value={counts?.totalOrders ?? "—"} accent={NAVY} />
        <Tile label="Total bags" value={counts?.totalBags ?? "—"} accent={NAVY} />
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <Field label="Sort">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            disabled={loading}
            style={selectStyle}
          >
            <option value="lastSeen">Most recent</option>
            <option value="firstSeen">Earliest</option>
            <option value="orderCount">Most orders</option>
            <option value="totalRevenue">Highest revenue</option>
          </select>
        </Field>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: NAVY,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={repeatOnly}
            onChange={(e) => setRepeatOnly(e.target.checked)}
            disabled={loading}
          />
          Repeat customers only
        </label>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void refresh()}
          disabled={loading}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: `1px solid ${BORDER}`,
            background: CARD,
            color: NAVY,
            fontSize: 13,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {err && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "#fde8e6",
            color: "#9a1c1c",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          Failed to load: {err}
        </div>
      )}

      <div
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ background: "#fafafa", color: NAVY }}>
              <th style={th}>Recipient</th>
              <th style={th}>Location</th>
              <th style={{ ...th, textAlign: "right" }}>Orders</th>
              <th style={{ ...th, textAlign: "right" }}>Bags</th>
              <th style={{ ...th, textAlign: "right" }}>Shipping cost</th>
              <th style={th}>First seen</th>
              <th style={th}>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const isExpanded = expanded === c.fingerprint;
              const rowBg = c.orderCount > 1 ? "#fff8e6" : undefined;
              return (
                <Fragment key={c.fingerprint}>
                  <tr
                    onClick={() =>
                      setExpanded(isExpanded ? null : c.fingerprint)
                    }
                    style={{
                      borderTop: `1px solid ${BORDER}`,
                      background: rowBg,
                      cursor: "pointer",
                    }}
                  >
                    <td style={td}>
                      <div style={{ color: NAVY, fontWeight: 500 }}>
                        {c.shipToName || (
                          <span style={{ color: DIM }}>—</span>
                        )}
                      </div>
                      {c.orderCount > 1 && (
                        <div
                          style={{
                            display: "inline-block",
                            marginTop: 4,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: GOLD,
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: 0.4,
                          }}
                        >
                          Repeat ×{c.orderCount}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      {c.shipToCity ?? <span style={{ color: DIM }}>—</span>}
                      {c.shipToState && c.shipToCity ? `, ${c.shipToState}` : ""}
                      {c.shipToPostalCode && (
                        <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
                          {c.shipToPostalCode}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {c.orderCount}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{c.totalBags}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      ${c.totalShippingCostUsd.toFixed(2)}
                    </td>
                    <td style={td}>{shortIso(c.firstSeenAt)}</td>
                    <td style={td}>{shortIso(c.lastSeenAt)}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={7} style={{ ...td, background: "#f8f8f5" }}>
                        <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>
                          Recent orders ({c.recentOrders.length} shown,
                          newest first):
                        </div>
                        <table
                          style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            fontSize: 12,
                          }}
                        >
                          <tbody>
                            {c.recentOrders.map((o) => (
                              <tr key={o.orderNumber}>
                                <td style={subTd}>
                                  <code style={{ color: NAVY }}>
                                    {o.orderNumber}
                                  </code>
                                </td>
                                <td style={subTd}>{shortIso(o.shippedAt)}</td>
                                <td style={subTd}>{o.bags} bag{o.bags === 1 ? "" : "s"}</td>
                                <td style={subTd}>
                                  {o.shippingCostUsd !== null
                                    ? `$${o.shippingCostUsd.toFixed(2)} ship`
                                    : "—"}
                                </td>
                                <td style={subTd}>
                                  {o.trackingNumber ?? "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && customers.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...td,
                    color: DIM,
                    textAlign: "center",
                    padding: 24,
                  }}
                >
                  No Amazon customers in the registry yet. Records start
                  appearing on the next auto-shipped order.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, color: DIM, fontSize: 12 }}>
        ←{" "}
        <a href="/ops/sales" style={{ color: NAVY }}>
          Back to Sales Command
        </a>
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "10px 14px",
        minWidth: 130,
      }}
    >
      <div
        style={{
          color: DIM,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      <div
        style={{ color: accent, fontSize: 22, fontWeight: 600, marginTop: 2 }}
      >
        {value}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          color: DIM,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function shortIso(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const td: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };
const subTd: React.CSSProperties = {
  padding: "4px 8px",
  color: NAVY,
  borderBottom: `1px solid ${BORDER}`,
};
const selectStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: `1px solid ${BORDER}`,
  background: "#fff",
  color: NAVY,
  fontSize: 13,
};
