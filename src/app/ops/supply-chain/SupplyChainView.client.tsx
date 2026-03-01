"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Truck, Boxes, Factory, DollarSign } from "lucide-react";
import { useInventoryData, useSupplyChain, fmtDollar } from "@/lib/ops/use-war-room-data";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

function statusColor(status: "healthy" | "low" | "critical" | "out-of-stock") {
  if (status === "healthy") return "#16a34a";
  if (status === "low") return GOLD;
  return RED;
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ color: NAVY }}>{icon}</span>
        <span style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: NAVY }}>{value}</div>
    </div>
  );
}

export function SupplyChainView() {
  const [inventoryPage, setInventoryPage] = useState(1);
  const {
    data: inventory,
    loading: invLoading,
    error: invError,
    refresh: refreshInventory,
  } = useInventoryData();
  const {
    data: supply,
    loading: scLoading,
    error: scError,
    refresh: refreshSupplyChain,
  } = useSupplyChain();
  const freshnessItems = [
    { label: "Inventory", timestamp: inventory?.generatedAt },
    { label: "Supply Chain", timestamp: supply?.generatedAt },
  ];
  const pageSize = 20;
  const inventoryItems = inventory?.items || [];
  const inventoryPages = Math.max(1, Math.ceil(inventoryItems.length / pageSize));
  const pagedInventory = useMemo(
    () => inventoryItems.slice((inventoryPage - 1) * pageSize, inventoryPage * pageSize),
    [inventoryItems, inventoryPage],
  );

  useEffect(() => {
    if (inventoryPage > inventoryPages) {
      setInventoryPage(inventoryPages);
    }
  }, [inventoryPage, inventoryPages]);

  const error = invError || scError;

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>Supply Chain</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Inventory health, production, and logistics. Currently 1 SKU: USA-GUMMY-12PK (12-pack case).
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>
        <RefreshButton
          loading={invLoading || scLoading}
          onClick={() => {
            refreshInventory();
            refreshSupplyChain();
          }}
        />
      </div>

      {error ? (
        <div
          style={{
            border: `1px solid ${RED}33`,
            background: `${RED}14`,
            color: RED,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 700,
          }}
        >
          <AlertTriangle size={16} />
          {error}
        </div>
      ) : null}
      {inventory?.amazonFba?.error ? (
        <div
          style={{
            border: `1px solid ${GOLD}55`,
            background: `${GOLD}18`,
            color: NAVY,
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ Amazon FBA — Awaiting Authorization</div>
          <div style={{ fontWeight: 400, lineHeight: 1.5 }}>
            {inventory.amazonFba.error.includes("403")
              ? "The SP-API app needs the FBA Inventory role enabled in Amazon Seller Central → Apps & Services → Develop Apps."
              : inventory.amazonFba.error}
            {inventory.amazonFba.lastSuccessfulFetch
              ? ` Last successful fetch: ${new Date(inventory.amazonFba.lastSuccessfulFetch).toLocaleString("en-US")}.`
              : ""}
          </div>
        </div>
      ) : null}

      {/* ── Inventory by Location ── */}
      {inventory ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 12, fontSize: 15 }}>Inventory by Location</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {/* PA */}
            <div style={{ background: `${NAVY}08`, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: TEXT_DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                🏠 Pennsylvania (PA)
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: NAVY }}>
                {inventory.homeStock?.current?.pa ?? inventory.homeStock?.baseline?.pa ?? "—"}
              </div>
              <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 2 }}>
                units • baseline {inventory.homeStock?.baseline?.pa ?? "?"} on {inventory.homeStock?.baseline?.asOf ?? "?"}
              </div>
            </div>
            {/* WA */}
            <div style={{ background: `${NAVY}08`, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: TEXT_DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                🏠 Washington (WA)
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: NAVY }}>
                {inventory.homeStock?.current?.wa ?? inventory.homeStock?.baseline?.wa ?? "—"}
              </div>
              <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 2 }}>
                units • baseline {inventory.homeStock?.baseline?.wa ?? "?"} on {inventory.homeStock?.baseline?.asOf ?? "?"}
              </div>
            </div>
            {/* Amazon FBA */}
            <div style={{ background: `${NAVY}08`, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: TEXT_DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                📦 Amazon FBA
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: inventory.amazonFba?.error ? TEXT_DIM : NAVY }}>
                {inventory.amazonFba?.error
                  ? "—"
                  : (inventory.items || []).find((i) => i.source === "amazon-api")?.currentStock ?? "—"}
              </div>
              <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 2 }}>
                {inventory.amazonFba?.error ? "API error — see alert above" : "units in FBA warehouse"}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
        <MetricCard label="Total Units" value={String(inventory?.summary.totalUnits || 0)} icon={<Boxes size={16} />} />
        <MetricCard label="Inventory Value" value={fmtDollar(inventory?.summary.totalValue || 0)} icon={<DollarSign size={16} />} />
        <MetricCard label="Open Orders" value={String(supply?.summary.openOrders || 0)} icon={<Factory size={16} />} />
        <MetricCard label="Active Suppliers" value={String(supply?.summary.activeSuppliers || 0)} icon={<Truck size={16} />} />
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Inventory Grid</div>
        {inventory?.homeStock?.source === "shopify-orders" ? (
          <div style={{ marginBottom: 10, fontSize: 11, color: TEXT_DIM }}>
            Home stock derived from baseline ({inventory.homeStock.baseline.asOf}) minus Shopify fulfilled orders.
            {inventory.homeStock.fulfilledSinceBaseline.total > 0
              ? ` ${inventory.homeStock.fulfilledSinceBaseline.total} units fulfilled since baseline.`
              : ""}
          </div>
        ) : null}
        {invLoading && (inventory?.items || []).length === 0 ? (
          <SkeletonTable rows={8} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Location</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>SKU</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Stock</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Days Supply</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Reorder Pt</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pagedInventory.map((item) => (
                  <tr key={item.id}>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 4px 8px 0", color: NAVY, fontWeight: 600, fontSize: 13 }}>{item.location || "Unknown"}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 4px", color: NAVY, fontWeight: 700 }}>{item.sku}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 4px", textAlign: "right", color: NAVY, fontWeight: 700 }}>{item.currentStock.toLocaleString()}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 4px", textAlign: "right", color: item.daysOfSupply >= 999 ? TEXT_DIM : NAVY }}>
                      {item.daysOfSupply >= 999 ? "—" : item.daysOfSupply.toFixed(0)}
                    </td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 4px", textAlign: "right", color: TEXT_DIM }}>{item.reorderPoint}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: statusColor(item.status),
                          background: `${statusColor(item.status)}16`,
                          borderRadius: 999,
                          padding: "2px 8px",
                          textTransform: "uppercase",
                        }}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {inventoryItems.length > pageSize ? (
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: TEXT_DIM }}>
              Page {inventoryPage} of {inventoryPages}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setInventoryPage((prev) => Math.max(1, prev - 1))}
                disabled={inventoryPage === 1}
                style={{
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  background: CARD,
                  color: NAVY,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: inventoryPage === 1 ? "not-allowed" : "pointer",
                  opacity: inventoryPage === 1 ? 0.5 : 1,
                }}
              >
                Prev
              </button>
              <button
                onClick={() => setInventoryPage((prev) => Math.min(inventoryPages, prev + 1))}
                disabled={inventoryPage === inventoryPages}
                style={{
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  background: CARD,
                  color: NAVY,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: inventoryPage === inventoryPages ? "not-allowed" : "pointer",
                  opacity: inventoryPage === inventoryPages ? 0.5 : 1,
                }}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Production Orders</div>
          {(supply?.productionOrders || []).length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>No active production orders.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {(supply?.productionOrders || []).slice(0, 10).map((order) => (
                <div key={order.id} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>{order.product}</div>
                    <div style={{ color: TEXT_DIM, fontSize: 12 }}>{order.supplier} • ETA {order.expectedDate}</div>
                  </div>
                  <div style={{ color: NAVY, fontWeight: 700, fontSize: 12 }}>{order.status}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Cost Trends</div>
          {(supply?.costTrends || []).length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>No cost trend rows yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {(supply?.costTrends || []).slice(0, 10).map((trend) => (
                <div key={trend.sku} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>{trend.sku}</div>
                    <div style={{ color: TEXT_DIM, fontSize: 12 }}>
                      {fmtDollar(trend.previousCost)} → {fmtDollar(trend.currentCost)}
                    </div>
                  </div>
                  <div style={{ color: trend.changePct > 0 ? RED : trend.changePct < 0 ? "#16a34a" : TEXT_DIM, fontWeight: 800, fontSize: 12 }}>
                    {trend.changePct > 0 ? "+" : ""}
                    {trend.changePct.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Supply Alerts</div>
        {(supply?.alerts || []).length === 0 ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>{scLoading ? "Loading alerts..." : "No active supply alerts."}</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {(supply?.alerts || []).slice(0, 10).map((alert, idx) => (
              <div key={idx} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, display: "flex", gap: 8 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 99,
                    marginTop: 4,
                    background: alert.severity === "critical" ? RED : alert.severity === "warning" ? GOLD : "#16a34a",
                  }}
                />
                <div>
                  <div style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>{alert.message}</div>
                  <div style={{ color: TEXT_DIM, fontSize: 12 }}>{alert.relatedItem}{alert.dueDate ? ` • Due ${alert.dueDate}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
