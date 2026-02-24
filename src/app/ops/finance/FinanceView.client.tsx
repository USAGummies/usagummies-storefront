"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

type FinanceData = {
  shopify: {
    totalOrders: number;
    totalRevenue: number;
    avgOrderValue: number;
    recentOrders: Array<{
      name: string;
      total: string;
      createdAt: string;
      financialStatus: string;
    }>;
  } | null;
  generatedAt: string;
};

export function FinanceView() {
  const { data: session } = useSession();
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const role = (session?.user as { role?: string })?.role || "employee";
  const canViewDetails = role === "admin" || role === "investor";

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/ops/finance", { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        setData(json);
      } catch {
        setError("Failed to load financial data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (!canViewDetails) {
    return (
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
          Financial Overview
        </h1>
        <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "40px 32px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 14, marginTop: 24 }}>
          Financial data is restricted to admin and investor roles.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
          Financial Overview
        </h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          Revenue, orders, and cash flow from Shopify
          {data?.generatedAt ? ` · Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ""}
        </p>
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && !error && (
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 14, padding: "40px 0" }}>Loading financial data...</div>
      )}

      {data?.shopify && (
        <>
          {/* Revenue cards */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 32 }}>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", flex: "1 1 180px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Total Revenue</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#4ade80" }}>
                ${data.shopify.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", flex: "1 1 180px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Total Orders</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#60a5fa" }}>{data.shopify.totalOrders}</div>
            </div>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "20px 24px", flex: "1 1 180px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Avg Order Value</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#a78bfa" }}>
                ${data.shopify.avgOrderValue.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Recent orders table */}
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Recent Orders
          </h2>
          <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden" }}>
            {data.shopify.recentOrders.length === 0 ? (
              <div style={{ padding: "32px", color: "rgba(255,255,255,0.25)", fontSize: 13, textAlign: "center" }}>No recent orders</div>
            ) : (
              data.shopify.recentOrders.map((order, i) => (
                <div
                  key={`${order.name}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "12px 18px",
                    borderBottom: i < data.shopify!.recentOrders.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff", minWidth: 70 }}>{order.name}</span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", flex: 1 }}>
                    ${order.total}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: order.financialStatus === "paid" ? "rgba(34,197,94,0.12)" : "rgba(251,191,36,0.12)",
                      color: order.financialStatus === "paid" ? "#4ade80" : "#fbbf24",
                    }}
                  >
                    {order.financialStatus}
                  </span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", minWidth: 80, textAlign: "right" }}>
                    {new Date(order.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {data && !data.shopify && (
        <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "40px 32px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
          Shopify Admin API not configured — add SHOPIFY_ADMIN_TOKEN to environment.
        </div>
      )}
    </div>
  );
}
