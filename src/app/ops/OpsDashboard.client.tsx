"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import type { UnifiedDashboard, AmazonKPIs } from "@/lib/amazon/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SummaryData = {
  overall: string;
  counts: { healthy: number; warning: number; critical: number; unknown: number };
  agentCount: number;
  lastUpdated: string;
};

// ---------------------------------------------------------------------------
// Shared UI components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  subtitle,
  color,
  small,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
  small?: boolean;
}) {
  return (
    <div
      style={{
        background: "#1a1d27",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        padding: small ? "14px 18px" : "20px 24px",
        minWidth: small ? 120 : 160,
        flex: "1 1 160px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.4)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: small ? 22 : 28,
          fontWeight: 700,
          color,
          fontFamily: "var(--font-display)",
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <h2
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "rgba(255,255,255,0.55)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          margin: 0,
        }}
      >
        {title}
      </h2>
      {badge && (
        <span
          style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.4)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function DeltaIndicator({
  value,
  suffix = "%",
  label,
}: {
  value: number;
  suffix?: string;
  label?: string;
}) {
  const isPositive = value > 0;
  const isZero = value === 0;
  const color = isZero ? "rgba(255,255,255,0.4)" : isPositive ? "#43c46b" : "#ef3b3b";
  const arrow = isZero ? "—" : isPositive ? "▲" : "▼";

  return (
    <span style={{ fontSize: 12, color, fontWeight: 600 }}>
      {arrow} {isZero ? "0" : `${isPositive ? "+" : ""}${value}`}
      {suffix}
      {label && <span style={{ fontWeight: 400, marginLeft: 4, color: "rgba(255,255,255,0.35)" }}>{label}</span>}
    </span>
  );
}

function InventoryAlertBanner({ daysOfSupply }: { daysOfSupply: number }) {
  if (daysOfSupply >= 14) return null;

  const critical = daysOfSupply < 7;
  return (
    <div
      style={{
        background: critical ? "rgba(239,59,59,0.12)" : "rgba(255,159,67,0.12)",
        border: `1px solid ${critical ? "rgba(239,59,59,0.3)" : "rgba(255,159,67,0.3)"}`,
        borderRadius: 10,
        padding: "14px 20px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ fontSize: 20 }}>{critical ? "🚨" : "⚠️"}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: critical ? "#ef3b3b" : "#ff9f43" }}>
          {critical ? "Critical: Restock Immediately" : "Low Inventory Warning"}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
          FBA inventory at {daysOfSupply} days of supply — {critical ? "stockout risk is imminent" : "consider sending new shipment"}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        background: `${color}15`,
        border: `1px solid ${color}30`,
        fontSize: 12,
        color,
      }}
    >
      <span style={{ fontWeight: 700 }}>{count}</span>
      <span style={{ opacity: 0.8 }}>{label}</span>
    </div>
  );
}

function fmt$(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtN(n: number): string {
  return n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export function OpsDashboard() {
  const { data: session } = useSession();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [dashboard, setDashboard] = useState<UnifiedDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    try {
      const [summaryRes, dashRes] = await Promise.all([
        fetch("/api/agentic/command-center", { cache: "no-store" }).catch(() => null),
        fetch("/api/ops/dashboard", { cache: "no-store" }),
      ]);

      if (summaryRes?.ok) {
        const data = await summaryRes.json();
        setSummary({
          overall: data.overall || "unknown",
          counts: data.counts || { healthy: 0, warning: 0, critical: 0, unknown: 0 },
          agentCount: data.agents?.length || 0,
          lastUpdated: data.generatedAtET || "",
        });
      }

      if (dashRes.ok) {
        const data = await dashRes.json();
        setDashboard(data);
      } else {
        setError("Failed to load dashboard data");
      }
    } catch {
      setError("Failed to connect to dashboard API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60000); // Refresh every 60s
    return () => clearInterval(interval);
  }, [fetchAll]);

  const greeting = session?.user?.name
    ? `Welcome back, ${session.user.name.split(" ")[0]}`
    : "Welcome";

  const amz = dashboard?.amazon;
  const shop = dashboard?.shopify;
  const combined = dashboard?.combined;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            fontFamily: "var(--font-display)",
            margin: 0,
            letterSpacing: "0.01em",
          }}
        >
          {greeting}
        </h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
          USA Gummies — Unified Business Dashboard
          {dashboard?.generatedAt
            ? ` — Updated ${new Date(dashboard.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET`
            : ""}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            background: "rgba(220,38,38,0.1)",
            border: "1px solid rgba(220,38,38,0.2)",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 24,
            color: "#ef4444",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          Loading dashboard data...
        </div>
      )}

      {/* Inventory Alert */}
      {amz?.inventory.restockAlert && (
        <InventoryAlertBanner daysOfSupply={amz.inventory.daysOfSupply} />
      )}

      {/* ── Combined Revenue Row ───────────────────────────────────── */}
      {combined && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Combined Performance" badge="All Channels" />
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <StatCard
              label="Total Revenue (MTD)"
              value={fmt$(combined.totalRevenue)}
              color="#43c46b"
            />
            <StatCard
              label="Total Orders (MTD)"
              value={fmtN(combined.totalOrders)}
              color="#7c8cf5"
            />
            <StatCard
              label="Combined AOV"
              value={fmt$(combined.avgOrderValue)}
              color="#ff9f43"
            />
          </div>
        </div>
      )}

      {/* ── Channel Breakdown ──────────────────────────────────────── */}
      {(shop || amz) && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Channel Breakdown" />
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {shop && (
              <>
                <StatCard
                  label="Shopify Revenue"
                  value={fmt$(shop.totalRevenue)}
                  subtitle={`${fmtN(shop.totalOrders)} orders`}
                  color="#95bf47"
                />
                <StatCard
                  label="Shopify AOV"
                  value={fmt$(shop.avgOrderValue)}
                  color="#95bf47"
                  small
                />
              </>
            )}
            {amz && (
              <>
                <StatCard
                  label="Amazon Revenue (MTD)"
                  value={fmt$(amz.revenue.monthToDate)}
                  subtitle={`${fmtN(amz.orders.monthToDate)} orders`}
                  color="#ff9900"
                />
                <StatCard
                  label="Amazon AOV"
                  value={fmt$(amz.aov.weekToDate)}
                  color="#ff9900"
                  small
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Amazon Deep Dive ───────────────────────────────────────── */}
      {amz && <AmazonSection amz={amz} />}

      {/* ── System Health ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <SectionHeader title="System Health" />
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <StatCard
            label="Overall Status"
            value={summary?.overall || (loading ? "Loading..." : "N/A")}
            color={
              summary?.overall === "healthy"
                ? "#43c46b"
                : summary?.overall === "warning"
                  ? "#ff9f43"
                  : summary?.overall === "critical"
                    ? "#ef3b3b"
                    : "rgba(255,255,255,0.4)"
            }
            small
          />
          <StatCard label="Healthy" value={summary?.counts.healthy ?? "-"} color="#43c46b" small />
          <StatCard label="Warnings" value={summary?.counts.warning ?? "-"} color="#ff9f43" small />
          <StatCard label="Critical" value={summary?.counts.critical ?? "-"} color="#ef3b3b" small />
          <StatCard
            label="Total Agents"
            value={summary?.agentCount ?? "-"}
            color="rgba(255,255,255,0.7)"
            small
          />
        </div>
      </div>

      {/* ── Quick Actions ──────────────────────────────────────────── */}
      <div>
        <SectionHeader title="Quick Actions" />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { href: "/ops/agents", label: "View All Agents", icon: "🤖" },
            { href: "/ops/inbox", label: "Reply Queue", icon: "📨" },
            { href: "/ops/pipeline", label: "Pipeline", icon: "📈" },
            { href: "/ops/finance", label: "Finance Detail", icon: "💰" },
            { href: "/ops/wholesale", label: "Wholesale Order", icon: "📦" },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 18px",
                background: "#1a1d27",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                color: "rgba(255,255,255,0.7)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
                transition: "border-color 0.15s",
              }}
            >
              <span style={{ fontSize: 18 }}>{link.icon}</span>
              {link.label}
            </a>
          ))}
        </div>
      </div>

      {/* ── Not configured message ─────────────────────────────────── */}
      {!loading && !amz && !error && (
        <div
          style={{
            marginTop: 24,
            padding: "16px 20px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10,
            color: "rgba(255,255,255,0.4)",
            fontSize: 13,
          }}
        >
          Amazon data unavailable — SP-API credentials not configured. Add LWA_CLIENT_ID,
          LWA_CLIENT_SECRET, and LWA_REFRESH_TOKEN to environment variables.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Amazon Deep Dive Section
// ---------------------------------------------------------------------------

function AmazonSection({ amz }: { amz: AmazonKPIs }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <SectionHeader title="Amazon Performance" badge="SP-API" />

      {/* Row 1: Today's Sales + Comparisons */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <StatCard
          label="Today's Revenue"
          value={fmt$(amz.revenue.today)}
          subtitle={
            amz.comparison.todayVsYesterday.revenuePct !== 0
              ? `${amz.comparison.todayVsYesterday.revenuePct > 0 ? "+" : ""}${amz.comparison.todayVsYesterday.revenuePct}% vs yesterday`
              : "vs yesterday"
          }
          color="#ff9900"
        />
        <StatCard
          label="Today's Orders"
          value={fmtN(amz.orders.today)}
          subtitle={`Yesterday: ${fmtN(amz.orders.yesterday)}`}
          color="#ff9900"
        />
        <StatCard
          label="Units Sold Today"
          value={fmtN(amz.unitsSold.today)}
          color="#ff9900"
          small
        />
        <StatCard
          label="Sales Velocity"
          value={`${amz.velocity.unitsPerDay7d}/day`}
          subtitle={`Trend: ${amz.velocity.trend === "up" ? "📈 Up" : amz.velocity.trend === "down" ? "📉 Down" : "➡️ Flat"}`}
          color={amz.velocity.trend === "up" ? "#43c46b" : amz.velocity.trend === "down" ? "#ef3b3b" : "rgba(255,255,255,0.6)"}
          small
        />
      </div>

      {/* Row 2: Period Performance */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <StatCard
          label="Week to Date"
          value={fmt$(amz.revenue.weekToDate)}
          subtitle={`${fmtN(amz.orders.weekToDate)} orders · ${fmtN(amz.unitsSold.weekToDate)} units`}
          color="#7c8cf5"
          small
        />
        <StatCard
          label="Last Week"
          value={fmt$(amz.revenue.lastWeek)}
          subtitle={`${fmtN(amz.orders.lastWeek)} orders`}
          color="#7c8cf5"
          small
        />
        <StatCard
          label="Month to Date"
          value={fmt$(amz.revenue.monthToDate)}
          subtitle={`${fmtN(amz.orders.monthToDate)} orders · ${fmtN(amz.unitsSold.monthToDate)} units`}
          color="#7c8cf5"
          small
        />
      </div>

      {/* Row 3: Order Status */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <StatusBadge label="Pending" count={amz.orderStatus.pending} color="#ff9f43" />
        <StatusBadge label="Unshipped" count={amz.orderStatus.unshipped} color="#7c8cf5" />
        <StatusBadge label="Shipped" count={amz.orderStatus.shipped} color="#43c46b" />
        <StatusBadge label="Canceled" count={amz.orderStatus.canceled} color="#ef3b3b" />
      </div>

      {/* Row 4: FBA Inventory */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <StatCard
          label="FBA Fulfillable"
          value={fmtN(amz.inventory.fulfillable)}
          color={amz.inventory.daysOfSupply < 14 ? "#ff9f43" : "#43c46b"}
        />
        <StatCard
          label="Days of Supply"
          value={amz.inventory.daysOfSupply > 365 ? "N/A" : `${amz.inventory.daysOfSupply}d`}
          color={
            amz.inventory.daysOfSupply < 7
              ? "#ef3b3b"
              : amz.inventory.daysOfSupply < 14
                ? "#ff9f43"
                : amz.inventory.daysOfSupply < 30
                  ? "#ffd93d"
                  : "#43c46b"
          }
          small
        />
        <StatCard
          label="Inbound (Working)"
          value={fmtN(amz.inventory.inboundWorking)}
          color="rgba(255,255,255,0.6)"
          small
        />
        <StatCard
          label="Inbound (Shipped)"
          value={fmtN(amz.inventory.inboundShipped)}
          color="rgba(255,255,255,0.6)"
          small
        />
        <StatCard
          label="Reserved"
          value={fmtN(amz.inventory.reserved)}
          color="rgba(255,255,255,0.5)"
          small
        />
        <StatCard
          label="Unfulfillable"
          value={fmtN(amz.inventory.unfulfillable)}
          color={amz.inventory.unfulfillable > 0 ? "#ef3b3b" : "rgba(255,255,255,0.4)"}
          small
        />
      </div>

      {/* Row 5: Fees & Margin */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <StatCard
          label="Referral Fee (avg)"
          value={fmt$(amz.fees.referralFee)}
          color="rgba(255,255,255,0.6)"
          small
        />
        <StatCard
          label="FBA Fee (avg)"
          value={fmt$(amz.fees.fbaFee)}
          color="rgba(255,255,255,0.6)"
          small
        />
        <StatCard
          label="Total Fees (avg)"
          value={fmt$(amz.fees.totalFee)}
          color="#ff9f43"
          small
        />
        <StatCard
          label="Est. Net Margin"
          value={`${amz.fees.estimatedNetMargin}%`}
          color={amz.fees.estimatedNetMargin > 30 ? "#43c46b" : amz.fees.estimatedNetMargin > 15 ? "#ff9f43" : "#ef3b3b"}
        />
      </div>

      {/* Row 6: Week-over-Week Comparison */}
      <div
        style={{
          background: "#1a1d27",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: "16px 20px",
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
            Today vs Yesterday
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <DeltaIndicator value={amz.comparison.todayVsYesterday.revenuePct} label="revenue" />
            <DeltaIndicator value={amz.comparison.todayVsYesterday.ordersPct} label="orders" />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
            Week over Week
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <DeltaIndicator value={amz.comparison.weekOverWeek.revenuePct} label="revenue" />
            <DeltaIndicator value={amz.comparison.weekOverWeek.ordersPct} label="orders" />
          </div>
        </div>
      </div>
    </div>
  );
}
