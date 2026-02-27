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
            Inventory health, production progress, supplier lead times, and cost trends.
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
        <MetricCard label="Total SKUs" value={String(inventory?.summary.totalSKUs || 0)} icon={<Boxes size={16} />} />
        <MetricCard label="Inventory Value" value={fmtDollar(inventory?.summary.totalValue || 0)} icon={<DollarSign size={16} />} />
        <MetricCard label="Open Orders" value={String(supply?.summary.openOrders || 0)} icon={<Factory size={16} />} />
        <MetricCard label="Active Suppliers" value={String(supply?.summary.activeSuppliers || 0)} icon={<Truck size={16} />} />
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Inventory Grid</div>
        {invLoading && (inventory?.items || []).length === 0 ? (
          <SkeletonTable rows={8} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>SKU</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Stock</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Days</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Reorder</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pagedInventory.map((item) => (
                  <tr key={item.id}>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 700 }}>{item.sku}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>{item.currentStock.toLocaleString()}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>{item.daysOfSupply.toFixed(1)}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: TEXT_DIM }}>{item.reorderPoint}</td>
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
