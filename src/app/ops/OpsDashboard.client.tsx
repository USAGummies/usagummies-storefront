"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Package,
  DollarSign,
  ShoppingCart,
  BarChart3,
  Clock,
  Download,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Boxes,
  Truck,
  Zap,
  Eye,
  Bot,
  Mail,
  GitBranch,
  Wallet,
  PackageOpen,
  Upload,
  Landmark,
  MessageSquare,
  Inbox,
  PieChart,
  Target,
  Users,
  CreditCard,
  TrendingUp as Forecast,
  LayoutDashboard,
  MessagesSquare,
  Shield,
} from "lucide-react";
import type { UnifiedDashboard, CashPosition } from "@/lib/amazon/types";
import type { UnifiedBalances, ForecastReport, PnLReport } from "@/lib/finance/types";
import type { InboxSummary, CommSource } from "@/lib/comms/types";
import { OpsChat } from "./OpsChat.client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SummaryData = {
  overall: string;
  counts: { healthy: number; warning: number; critical: number; unknown: number };
  agentCount: number;
  lastUpdated: string;
};

type DateRange = "7d" | "14d" | "30d";

type TabId = "overview" | "finance" | "pipeline" | "inbox" | "agents";

type PipelineData = {
  totalLeads: number;
  b2bCount: number;
  distributorCount: number;
  stageCounts: Record<string, number>;
  stages: Record<string, { id: string; name: string; status: string; email: string; lastContact: string; source: string; type: string; dealValue: number; createdAt: string; lastEdited: string }[]>;
  pipelineValue: { total: number; byStage: Record<string, number> };
  velocity: { avgDaysToClose: number; avgDaysByStage: Record<string, number> };
  conversionRates: Record<string, number>;
  recentActivity: { date: string; lead: string; event: string; details: string }[];
  weeklyTrend: { newLeads: number; stageAdvances: number; closedWon: number; closedLost: number };
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const C = {
  bg: "#0f1117",
  card: "#1a1d27",
  cardHover: "#1f2333",
  border: "rgba(255,255,255,0.06)",
  borderHover: "rgba(255,255,255,0.12)",
  text: "rgba(255,255,255,0.9)",
  textSecondary: "rgba(255,255,255,0.55)",
  textMuted: "rgba(255,255,255,0.35)",
  textFaint: "rgba(255,255,255,0.2)",
  green: "#43c46b",
  amber: "#ff9f43",
  red: "#ef3b3b",
  blue: "#7c8cf5",
  amazon: "#ff9900",
  shopify: "#95bf47",
  purple: "#a78bfa",
  cyan: "#22d3ee",
};

// ---------------------------------------------------------------------------
// Injected keyframe styles
// ---------------------------------------------------------------------------

function DashboardStyles() {
  return (
    <style>{`
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes shimmer {
        0% { background-position: -200px 0; }
        100% { background-position: 200px 0; }
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .dash-card {
        background: ${C.card};
        border: 1px solid ${C.border};
        border-radius: 14px;
        transition: all 0.2s ease;
        animation: fadeInUp 0.4s ease both;
      }
      .dash-card:hover {
        border-color: ${C.borderHover};
        transform: translateY(-1px);
        box-shadow: 0 4px 24px rgba(0,0,0,0.2);
      }
      .dash-skeleton {
        background: linear-gradient(90deg, ${C.card} 0px, #242836 100px, ${C.card} 200px);
        background-size: 400px 100%;
        animation: shimmer 1.5s ease-in-out infinite;
        border-radius: 8px;
      }
      .dash-action {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 20px;
        background: ${C.card};
        border: 1px solid ${C.border};
        border-radius: 12px;
        color: ${C.textSecondary};
        text-decoration: none;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s ease;
      }
      .dash-action:hover {
        border-color: ${C.blue};
        color: ${C.text};
        transform: translateY(-1px);
        box-shadow: 0 2px 12px rgba(124,140,245,0.15);
      }
      .dash-range-btn {
        padding: 6px 14px;
        border-radius: 8px;
        border: 1px solid transparent;
        background: transparent;
        color: ${C.textMuted};
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .dash-range-btn:hover {
        color: ${C.textSecondary};
        background: rgba(255,255,255,0.04);
      }
      .dash-range-btn.active {
        color: ${C.text};
        background: rgba(124,140,245,0.12);
        border-color: rgba(124,140,245,0.3);
      }
      .dash-tab {
        padding: 10px 20px;
        border-radius: 10px 10px 0 0;
        border: 1px solid transparent;
        border-bottom: none;
        background: transparent;
        color: ${C.textMuted};
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        gap: 8px;
        position: relative;
      }
      .dash-tab:hover {
        color: ${C.textSecondary};
        background: rgba(255,255,255,0.03);
      }
      .dash-tab.active {
        color: ${C.text};
        background: ${C.card};
        border-color: ${C.border};
      }
      .dash-tab.active::after {
        content: '';
        position: absolute;
        bottom: -1px;
        left: 0;
        right: 0;
        height: 2px;
        background: ${C.blue};
        border-radius: 2px 2px 0 0;
      }
      .dash-tab-badge {
        font-size: 10px;
        padding: 2px 7px;
        border-radius: 10px;
        background: rgba(239,59,59,0.15);
        color: ${C.red};
        font-weight: 600;
        min-width: 18px;
        text-align: center;
      }
      .recharts-cartesian-grid-horizontal line,
      .recharts-cartesian-grid-vertical line {
        stroke: rgba(255,255,255,0.04);
      }
    `}</style>
  );
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function fmt$(n: number): string {
  if (n >= 10000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtN(n: number): string {
  return n.toLocaleString("en-US");
}

function exportCSV(dashboard: UnifiedDashboard) {
  const rows = [
    ["Date", "Amazon Revenue", "Shopify Revenue", "Combined Revenue", "Amazon Orders", "Shopify Orders", "Combined Orders"],
    ...dashboard.chartData.map((d) => [
      d.date,
      d.amazon.toFixed(2),
      d.shopify.toFixed(2),
      d.combined.toFixed(2),
      d.amazonOrders.toString(),
      d.shopifyOrders.toString(),
      d.combinedOrders.toString(),
    ]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `usa-gummies-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function sourceIcon(source: CommSource): string {
  switch (source) {
    case "email": return "📧";
    case "slack": return "💬";
    case "b2b_pipeline": return "🤝";
    case "shopify_customer": return "🛍️";
    case "amazon_buyer": return "📦";
    default: return "💬";
  }
}

function sourceLabel(source: CommSource): string {
  switch (source) {
    case "email": return "Email";
    case "slack": return "Slack";
    case "b2b_pipeline": return "B2B";
    case "shopify_customer": return "Shopify";
    case "amazon_buyer": return "Amazon";
    default: return source;
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Shared UI components
// ---------------------------------------------------------------------------

function Skeleton({ width = "100%", height = 20 }: { width?: string | number; height?: number }) {
  return <div className="dash-skeleton" style={{ width, height, minHeight: height }} />;
}

function SkeletonCard() {
  return (
    <div className="dash-card" style={{ padding: "20px 24px", flex: "1 1 180px" }}>
      <Skeleton width="60%" height={12} />
      <div style={{ marginTop: 12 }}><Skeleton width="80%" height={28} /></div>
      <div style={{ marginTop: 8 }}><Skeleton width="50%" height={11} /></div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  color,
  icon: Icon,
  delay = 0,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
  icon?: React.ElementType;
  delay?: number;
}) {
  return (
    <div
      className="dash-card"
      style={{
        padding: "20px 24px",
        flex: "1 1 180px",
        animationDelay: `${delay}ms`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        {Icon && <Icon size={13} color={C.textMuted} strokeWidth={1.8} />}
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.1 }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, badge, icon: Icon }: { title: string; badge?: string; icon?: React.ElementType }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      {Icon && <Icon size={15} color={C.textMuted} strokeWidth={1.8} />}
      <h2 style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
        {title}
      </h2>
      {badge && (
        <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(124,140,245,0.1)", color: C.blue, fontWeight: 500, letterSpacing: "0.04em" }}>
          {badge}
        </span>
      )}
    </div>
  );
}

function DeltaIndicator({ value, suffix = "%", label }: { value: number; suffix?: string; label?: string }) {
  const isPositive = value > 0;
  const isZero = value === 0;
  const color = isZero ? C.textMuted : isPositive ? C.green : C.red;
  const Icon = isZero ? Minus : isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color, fontWeight: 600 }}>
      <Icon size={14} strokeWidth={2.5} />
      {isZero ? "0" : `${isPositive ? "+" : ""}${value}`}{suffix}
      {label && <span style={{ fontWeight: 400, color: C.textFaint, marginLeft: 2 }}>{label}</span>}
    </span>
  );
}

function InventoryAlertBanner({ daysOfSupply }: { daysOfSupply: number }) {
  if (daysOfSupply >= 14) return null;
  const critical = daysOfSupply < 7;
  const color = critical ? C.red : C.amber;

  return (
    <div
      style={{
        background: `${color}12`,
        border: `1px solid ${color}30`,
        borderRadius: 12,
        padding: "16px 20px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        gap: 12,
        animation: "fadeInUp 0.3s ease both",
      }}
    >
      <AlertTriangle size={20} color={color} strokeWidth={2} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color }}>
          {critical ? "Critical: Restock Immediately" : "Low Inventory Warning"}
        </div>
        <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
          FBA inventory at {daysOfSupply} days of supply — {critical ? "stockout risk is imminent" : "consider sending new shipment"}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, background: `${color}10`, border: `1px solid ${color}25`, fontSize: 12, color }}>
      <span style={{ fontWeight: 700 }}>{count}</span>
      <span style={{ opacity: 0.85 }}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1e2130",
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: "12px 16px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: i < payload.length - 1 ? 4 : 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: p.color }} />
          <span style={{ color: C.textSecondary, minWidth: 60 }}>{p.name}</span>
          <span style={{ color: C.text, fontWeight: 600 }}>{fmt$(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenue Chart
// ---------------------------------------------------------------------------

function RevenueChart({ data, range }: { data: UnifiedDashboard["chartData"]; range: DateRange }) {
  const days = range === "7d" ? 7 : range === "14d" ? 14 : 30;
  const sliced = data.slice(-days);
  const hasAmazon = sliced.some((d) => d.amazon > 0);
  const hasShopify = sliced.some((d) => d.shopify > 0);

  return (
    <div className="dash-card" style={{ padding: "24px", animationDelay: "100ms" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BarChart3 size={15} color={C.blue} strokeWidth={1.8} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Revenue Trend
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {hasAmazon && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textMuted }}>
              <div style={{ width: 10, height: 3, borderRadius: 2, background: C.amazon }} />Amazon
            </div>
          )}
          {hasShopify && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textMuted }}>
              <div style={{ width: 10, height: 3, borderRadius: 2, background: C.shopify }} />Shopify
            </div>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={sliced} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradAmazon" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.amazon} stopOpacity={0.25} />
              <stop offset="100%" stopColor={C.amazon} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradShopify" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.shopify} stopOpacity={0.2} />
              <stop offset="100%" stopColor={C.shopify} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textFaint }} axisLine={false} tickLine={false} interval={range === "30d" ? 4 : range === "14d" ? 2 : 0} />
          <YAxis tick={{ fontSize: 10, fill: C.textFaint }} axisLine={false} tickLine={false} tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)} width={48} />
          <Tooltip content={<ChartTooltip />} />
          {hasAmazon && <Area type="monotone" dataKey="amazon" name="Amazon" stroke={C.amazon} fill="url(#gradAmazon)" strokeWidth={2} dot={false} animationDuration={800} />}
          {hasShopify && <Area type="monotone" dataKey="shopify" name="Shopify" stroke={C.shopify} fill="url(#gradShopify)" strokeWidth={2} dot={false} animationDuration={800} animationBegin={200} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders Bar Chart
// ---------------------------------------------------------------------------

function OrdersChart({ data, range }: { data: UnifiedDashboard["chartData"]; range: DateRange }) {
  const days = range === "7d" ? 7 : range === "14d" ? 14 : 30;
  const sliced = data.slice(-days);
  const hasAmazon = sliced.some((d) => d.amazonOrders > 0);
  const hasShopify = sliced.some((d) => d.shopifyOrders > 0);

  return (
    <div className="dash-card" style={{ padding: "24px", animationDelay: "150ms" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <ShoppingCart size={15} color={C.purple} strokeWidth={1.8} />
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Daily Orders
        </span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={sliced} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.textFaint }} axisLine={false} tickLine={false} interval={range === "30d" ? 4 : range === "14d" ? 2 : 0} />
          <YAxis tick={{ fontSize: 10, fill: C.textFaint }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} contentStyle={{ background: "#1e2130", border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }} />
          {hasAmazon && <Bar dataKey="amazonOrders" name="Amazon" fill={C.amazon} radius={[3, 3, 0, 0]} animationDuration={600} />}
          {hasShopify && <Bar dataKey="shopifyOrders" name="Shopify" fill={C.shopify} radius={[3, 3, 0, 0]} animationDuration={600} animationBegin={200} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1: OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

function OverviewTab({
  dashboard,
  balances,
  pipeline,
  inboxData,
  range,
}: {
  dashboard: UnifiedDashboard | null;
  balances: UnifiedBalances | null;
  pipeline: PipelineData | null;
  inboxData: InboxSummary | null;
  range: DateRange;
}) {
  const amz = dashboard?.amazon;
  const shop = dashboard?.shopify;
  const combined = dashboard?.combined;
  const chartData = dashboard?.chartData || [];

  return (
    <>
      {/* Cash Position Banner */}
      {balances && (
        <div
          className="dash-card"
          style={{
            padding: "24px 28px",
            marginBottom: 24,
            background: "linear-gradient(135deg, #1a1d27 0%, #1e2538 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <Landmark size={16} color={C.green} strokeWidth={1.8} />
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Cash Position
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: C.green, lineHeight: 1 }}>
              {fmt$(balances.totalCash)}
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {balances.found && (
                <div style={{ fontSize: 12, color: C.textSecondary }}>
                  <span style={{ color: C.textMuted }}>Found: </span>
                  <span style={{ fontWeight: 600 }}>{fmt$(balances.found.available)}</span>
                </div>
              )}
              {balances.shopify && (
                <div style={{ fontSize: 12, color: C.textSecondary }}>
                  <span style={{ color: C.textMuted }}>Shopify: </span>
                  <span style={{ fontWeight: 600, color: C.shopify }}>{fmt$(balances.shopify.balance)}</span>
                </div>
              )}
              {balances.amazon && (
                <div style={{ fontSize: 12, color: C.textSecondary }}>
                  <span style={{ color: C.textMuted }}>Amazon: </span>
                  <span style={{ fontWeight: 600, color: C.amazon }}>{fmt$(balances.amazon.pendingBalance)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Inventory Alert */}
      {amz?.inventory.restockAlert && <InventoryAlertBanner daysOfSupply={amz.inventory.daysOfSupply} />}

      {/* Combined Hero Metrics */}
      {combined && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Combined Performance" badge="All Channels" icon={Zap} />
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <StatCard label="Total Revenue (MTD)" value={fmt$(combined.totalRevenue)} color={C.green} icon={DollarSign} delay={0} />
            <StatCard label="Total Orders (MTD)" value={fmtN(combined.totalOrders)} color={C.blue} icon={ShoppingCart} delay={50} />
            <StatCard label="Combined AOV" value={fmt$(combined.avgOrderValue)} color={C.amber} icon={TrendingUp} delay={100} />
            {pipeline && (
              <StatCard label="Pipeline Value" value={fmt$(pipeline.pipelineValue.total)} subtitle={`${pipeline.totalLeads} active leads`} color={C.purple} icon={Target} delay={150} />
            )}
          </div>
        </div>
      )}

      {/* Revenue Trend Chart */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <RevenueChart data={chartData} range={range} />
        </div>
      )}

      {/* Orders + Channel Mix Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 28 }}>
        {chartData.length > 0 && <OrdersChart data={chartData} range={range} />}
        {(shop || amz) && (
          <div className="dash-card" style={{ padding: "24px", animationDelay: "200ms" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <GitBranch size={15} color={C.cyan} strokeWidth={1.8} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Channel Mix
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {amz && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: C.amazon, fontWeight: 600 }}>Amazon</span>
                    <span style={{ fontSize: 14, color: C.text, fontWeight: 700 }}>{fmt$(amz.revenue.monthToDate)}</span>
                  </div>
                  <div style={{ height: 8, background: "rgba(255,255,255,0.04)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${combined && combined.totalRevenue > 0 ? (amz.revenue.monthToDate / combined.totalRevenue) * 100 : 0}%`,
                      background: `linear-gradient(90deg, ${C.amazon}, #ffb84d)`,
                      borderRadius: 4,
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
                    {fmtN(amz.orders.monthToDate)} orders · AOV {fmt$(amz.aov.weekToDate)}
                  </div>
                </div>
              )}
              {shop && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: C.shopify, fontWeight: 600 }}>Shopify</span>
                    <span style={{ fontSize: 14, color: C.text, fontWeight: 700 }}>{fmt$(shop.totalRevenue)}</span>
                  </div>
                  <div style={{ height: 8, background: "rgba(255,255,255,0.04)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${combined && combined.totalRevenue > 0 ? (shop.totalRevenue / combined.totalRevenue) * 100 : 0}%`,
                      background: `linear-gradient(90deg, ${C.shopify}, #b8d86b)`,
                      borderRadius: 4,
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
                    {fmtN(shop.totalOrders)} orders · AOV {fmt$(shop.avgOrderValue)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats Row: Amazon + Inventory + Inbox */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        {amz && (
          <>
            <StatCard label="Today's Revenue" value={fmt$(amz.revenue.today)} subtitle={`Yesterday: ${fmt$(amz.revenue.yesterday)}`} color={C.amazon} icon={DollarSign} delay={200} />
            <StatCard label="FBA Fulfillable" value={fmtN(amz.inventory.fulfillable)} subtitle={`${amz.inventory.daysOfSupply}d supply`} color={amz.inventory.daysOfSupply < 14 ? C.amber : C.green} icon={Package} delay={250} />
            <StatCard
              label="Sales Velocity"
              value={`${amz.velocity.unitsPerDay7d}/day`}
              subtitle={amz.velocity.trend === "up" ? "Trending up" : amz.velocity.trend === "down" ? "Trending down" : "Flat"}
              color={amz.velocity.trend === "up" ? C.green : amz.velocity.trend === "down" ? C.red : C.textSecondary}
              icon={amz.velocity.trend === "up" ? TrendingUp : amz.velocity.trend === "down" ? TrendingDown : Activity}
              delay={300}
            />
          </>
        )}
        {inboxData && (
          <StatCard label="Unread Messages" value={inboxData.unreadCount.total} subtitle="Across all channels" color={inboxData.unreadCount.total > 0 ? C.amber : C.green} icon={Mail} delay={350} />
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2: FINANCE
// ═══════════════════════════════════════════════════════════════════════════

function FinanceTab({
  balances,
  forecast,
  pnl,
  dashboard,
  cashPosition,
  csvUploading,
  csvResult,
  fileInputRef,
  handleCSVUpload,
  role,
}: {
  balances: UnifiedBalances | null;
  forecast: ForecastReport | null;
  pnl: PnLReport | null;
  dashboard: UnifiedDashboard | null;
  cashPosition: CashPosition | null;
  csvUploading: boolean;
  csvResult: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleCSVUpload: (file: File) => void;
  role: string;
}) {
  const amz = dashboard?.amazon;

  return (
    <>
      {/* Account Balances */}
      <SectionHeader title="Account Balances" badge="Live" icon={Landmark} />
      {balances ? (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
          <StatCard
            label="Total Cash"
            value={fmt$(balances.totalCash)}
            subtitle={`Updated ${timeAgo(balances.lastUpdated)}`}
            color={C.green}
            icon={Wallet}
          />
          {balances.found && (
            <StatCard
              label="Found.com (Bank)"
              value={fmt$(balances.found.available)}
              subtitle={`Balance: ${fmt$(balances.found.balance)}`}
              color={C.blue}
              icon={Landmark}
              delay={50}
            />
          )}
          {balances.shopify && (
            <StatCard
              label="Shopify Payments"
              value={fmt$(balances.shopify.balance)}
              subtitle={balances.shopify.lastPayout ? `Last payout: ${fmt$(balances.shopify.lastPayout.amount)}` : "No recent payouts"}
              color={C.shopify}
              icon={CreditCard}
              delay={100}
            />
          )}
          {balances.amazon && (
            <StatCard
              label="Amazon Pending"
              value={fmt$(balances.amazon.pendingBalance)}
              subtitle={balances.amazon.nextSettlementEstimate ? `Est. settlement: ${balances.amazon.nextSettlementEstimate.estimatedDate}` : ""}
              color={C.amazon}
              icon={Package}
              delay={150}
            />
          )}
        </div>
      ) : (
        <div className="dash-card" style={{ padding: "32px", textAlign: "center", marginBottom: 28 }}>
          <Landmark size={28} color={C.textFaint} strokeWidth={1.5} />
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 12 }}>
            No balance data available. Connect your accounts to see live balances.
          </div>
        </div>
      )}

      {/* P&L Summary */}
      {pnl && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Profit & Loss" badge={pnl.period.label} icon={PieChart} />
          <div className="dash-card" style={{ padding: "24px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 20 }}>
              {/* Revenue */}
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, marginBottom: 6 }}>Revenue</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.green }}>{fmt$(pnl.revenue.total)}</div>
                <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
                  AMZ {fmt$(pnl.revenue.amazon)} · Shop {fmt$(pnl.revenue.shopify)}
                  {pnl.revenue.wholesale > 0 && ` · B2B ${fmt$(pnl.revenue.wholesale)}`}
                </div>
              </div>
              {/* COGS */}
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, marginBottom: 6 }}>COGS</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.red }}>{fmt$(pnl.cogs.total)}</div>
                <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
                  Product {fmt$(pnl.cogs.productCost)} · Fees {fmt$(pnl.cogs.amazonFees + pnl.cogs.shopifyFees)}
                </div>
              </div>
              {/* Gross Profit */}
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, marginBottom: 6 }}>Gross Profit</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: pnl.grossProfit >= 0 ? C.green : C.red }}>{fmt$(pnl.grossProfit)}</div>
                <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
                  {pnl.grossMargin.toFixed(1)}% margin
                </div>
              </div>
              {/* OpEx */}
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, marginBottom: 6 }}>Operating Exp</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.amber }}>{fmt$(pnl.opex.total)}</div>
                <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
                  SW {fmt$(pnl.opex.software)} · Mkt {fmt$(pnl.opex.marketing)}
                </div>
              </div>
              {/* Net Income */}
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, marginBottom: 6 }}>Net Income</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: pnl.netIncome >= 0 ? C.green : C.red }}>{fmt$(pnl.netIncome)}</div>
                <div style={{ fontSize: 11, color: C.textFaint, marginTop: 4 }}>
                  {pnl.netMargin.toFixed(1)}% margin
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cash Flow Forecast */}
      {forecast && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Cash Flow Forecast" badge={`${forecast.runway}d runway`} icon={Forecast} />
          {/* Alerts */}
          {forecast.alerts.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {forecast.alerts.map((alert, i) => (
                <div key={i} style={{ background: "rgba(239,59,59,0.08)", border: "1px solid rgba(239,59,59,0.2)", borderRadius: 10, padding: "10px 16px", marginBottom: 8, fontSize: 12, color: C.red, display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={14} strokeWidth={2} /> {alert}
                </div>
              ))}
            </div>
          )}
          {/* Forecast Chart */}
          <div className="dash-card" style={{ padding: "24px" }}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={forecast.projections["30d"]} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.textFaint }} axisLine={false} tickLine={false} interval={4} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: C.textFaint }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} width={48} />
                <Tooltip contentStyle={{ background: "#1e2130", border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }} // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => [fmt$(Number(v ?? 0)), "Balance"]} />
                <Line type="monotone" dataKey="closingBalance" name="Projected Balance" stroke={C.blue} strokeWidth={2} dot={false} animationDuration={800} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Amazon Fees & Margin (if available) */}
      {amz && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Amazon Fees & Margin" icon={DollarSign} />
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <StatCard label="Referral Fee" value={fmt$(amz.fees.referralFee)} color={C.textSecondary} icon={DollarSign} />
            <StatCard label="FBA Fee" value={fmt$(amz.fees.fbaFee)} color={C.textSecondary} icon={DollarSign} delay={50} />
            <StatCard label="Total Fees" value={fmt$(amz.fees.totalFee)} color={C.amber} icon={Wallet} delay={100} />
            <StatCard label="Est. Net Margin" value={`${amz.fees.estimatedNetMargin}%`} color={amz.fees.estimatedNetMargin > 30 ? C.green : amz.fees.estimatedNetMargin > 15 ? C.amber : C.red} icon={TrendingUp} delay={150} />
          </div>
        </div>
      )}

      {/* Recent Transactions from Found.com */}
      {(role === "admin" || role === "investor") && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Bank Transactions" badge="Found.com" icon={Landmark} />
          {cashPosition && cashPosition.recentTransactions.length > 0 ? (
            <div className="dash-card" style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {cashPosition.recentTransactions.slice(-8).reverse().map((tx, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < 7 ? `1px solid ${C.border}` : "none" }}>
                    <div>
                      <span style={{ fontSize: 12, color: C.textSecondary }}>{tx.description}</span>
                      <span style={{ fontSize: 10, color: C.textFaint, marginLeft: 8 }}>{tx.date}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: tx.amount >= 0 ? C.green : C.red }}>
                      {tx.amount >= 0 ? "+" : ""}{fmt$(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : balances?.found?.recentTransactions?.length ? (
            <div className="dash-card" style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {balances.found.recentTransactions.slice(0, 8).map((tx, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < 7 ? `1px solid ${C.border}` : "none" }}>
                    <div>
                      <span style={{ fontSize: 12, color: C.textSecondary }}>{tx.name}</span>
                      <span style={{ fontSize: 10, color: C.textFaint, marginLeft: 8 }}>{tx.date}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: tx.amount > 0 ? C.red : C.green }}>
                      {tx.amount > 0 ? "-" : "+"}{fmt$(Math.abs(tx.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="dash-card" style={{ padding: "24px", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: C.textMuted }}>No transaction data. Upload a Found.com CSV or connect via Plaid.</div>
            </div>
          )}
          {/* CSV Upload */}
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCSVUpload(f); e.target.value = ""; }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={csvUploading} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: csvUploading ? C.textFaint : C.textSecondary, fontSize: 12, fontWeight: 500, cursor: csvUploading ? "default" : "pointer", transition: "all 0.15s" }}>
              <Upload size={14} strokeWidth={1.8} />
              {csvUploading ? "Uploading..." : "Upload Found.com CSV"}
            </button>
            {csvResult && <span style={{ fontSize: 12, color: csvResult.startsWith("✓") ? C.green : C.red, fontWeight: 500 }}>{csvResult}</span>}
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3: PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

function PipelineTab({ pipeline }: { pipeline: PipelineData | null }) {
  if (!pipeline) {
    return (
      <div className="dash-card" style={{ padding: "48px", textAlign: "center" }}>
        <Target size={32} color={C.textFaint} strokeWidth={1.5} />
        <div style={{ fontSize: 14, color: C.textMuted, marginTop: 16 }}>Pipeline data unavailable. Configure Notion B2B databases to enable.</div>
      </div>
    );
  }

  const stageColors: Record<string, string> = {
    "New Lead": C.blue, "Lead": C.blue, "Contacted": C.cyan,
    "Interested": C.amber, "Negotiation": C.purple,
    "Proposal Sent": C.purple, "Closed Won": C.green,
    "Closed Lost": C.red, "Not Interested": C.textMuted,
  };

  return (
    <>
      {/* Key Metrics */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        <StatCard label="Total Leads" value={pipeline.totalLeads} subtitle={`${pipeline.b2bCount} B2B · ${pipeline.distributorCount} dist.`} color={C.blue} icon={Users} />
        <StatCard label="Pipeline Value" value={fmt$(pipeline.pipelineValue.total)} color={C.green} icon={DollarSign} delay={50} />
        <StatCard label="Avg. Days to Close" value={pipeline.velocity.avgDaysToClose ? `${pipeline.velocity.avgDaysToClose}d` : "N/A"} color={C.purple} icon={Clock} delay={100} />
        <StatCard label="This Week" value={`+${pipeline.weeklyTrend.newLeads} leads`} subtitle={`${pipeline.weeklyTrend.closedWon} won · ${pipeline.weeklyTrend.closedLost} lost`} color={C.amber} icon={TrendingUp} delay={150} />
      </div>

      {/* Pipeline Stages (Kanban-style) */}
      <SectionHeader title="Pipeline Stages" badge={`${pipeline.totalLeads} total`} icon={GitBranch} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 28 }}>
        {Object.entries(pipeline.stageCounts)
          .sort(([a], [b]) => {
            const order = ["New Lead", "Lead", "Contacted", "Interested", "Negotiation", "Proposal Sent", "Closed Won", "Closed Lost", "Not Interested"];
            return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
          })
          .map(([stage, count]) => (
            <div key={stage} className="dash-card" style={{ padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: stageColors[stage] || C.textSecondary }}>{stage}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{count}</span>
              </div>
              <div style={{ fontSize: 11, color: C.textFaint }}>
                {fmt$(pipeline.pipelineValue.byStage[stage] || 0)} value
                {pipeline.velocity.avgDaysByStage[stage] ? ` · ${pipeline.velocity.avgDaysByStage[stage]}d avg` : ""}
              </div>
              {/* Mini lead list */}
              {pipeline.stages[stage]?.slice(0, 3).map((lead) => (
                <div key={lead.id} style={{ marginTop: 8, padding: "6px 0", borderTop: `1px solid ${C.border}`, fontSize: 11 }}>
                  <div style={{ color: C.textSecondary, fontWeight: 500 }}>{lead.name}</div>
                  {lead.dealValue > 0 && <span style={{ color: C.textFaint }}>{fmt$(lead.dealValue)}</span>}
                </div>
              ))}
            </div>
          ))}
      </div>

      {/* Conversion Rates */}
      {Object.keys(pipeline.conversionRates).length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Conversion Rates" icon={Target} />
          <div className="dash-card" style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {Object.entries(pipeline.conversionRates).map(([key, rate]) => (
                <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: rate > 40 ? C.green : rate > 20 ? C.amber : C.red }}>{rate}%</span>
                  <span style={{ fontSize: 10, color: C.textFaint, textAlign: "center", maxWidth: 100 }}>{key}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {pipeline.recentActivity.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Recent Activity" badge="Last 7 days" icon={Activity} />
          <div className="dash-card" style={{ padding: "16px 20px" }}>
            {pipeline.recentActivity.slice(0, 10).map((act, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: i < 9 ? `1px solid ${C.border}` : "none" }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: stageColors[act.event] || C.textMuted, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: C.textSecondary, fontWeight: 500 }}>{act.lead}</span>
                  <span style={{ fontSize: 11, color: C.textFaint, marginLeft: 8 }}>{act.event}</span>
                </div>
                <span style={{ fontSize: 11, color: C.textFaint }}>{act.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4: INBOX
// ═══════════════════════════════════════════════════════════════════════════

function InboxTab({ inboxData }: { inboxData: InboxSummary | null }) {
  const [sourceFilter, setSourceFilter] = useState<"all" | CommSource>("all");

  if (!inboxData) {
    return (
      <div className="dash-card" style={{ padding: "48px", textAlign: "center" }}>
        <Inbox size={32} color={C.textFaint} strokeWidth={1.5} />
        <div style={{ fontSize: 14, color: C.textMuted, marginTop: 16 }}>Loading inbox...</div>
      </div>
    );
  }

  const filteredMessages = sourceFilter === "all"
    ? inboxData.messages
    : inboxData.messages.filter((m) => m.source === sourceFilter);

  const sourceFilters: { id: "all" | CommSource; label: string; count: number }[] = [
    { id: "all", label: "All", count: inboxData.unreadCount.total },
    { id: "email", label: "Email", count: inboxData.unreadCount.email },
    { id: "slack", label: "Slack", count: inboxData.unreadCount.slack },
    { id: "b2b_pipeline", label: "B2B", count: inboxData.unreadCount.b2b },
    { id: "shopify_customer", label: "Shopify", count: inboxData.unreadCount.shopify },
    { id: "amazon_buyer", label: "Amazon", count: inboxData.unreadCount.amazon },
  ];

  return (
    <>
      {/* Unread Counts */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Total Unread" value={inboxData.unreadCount.total} color={inboxData.unreadCount.total > 0 ? C.amber : C.green} icon={Mail} />
        <StatCard label="Total Messages" value={inboxData.messages.length} color={C.blue} icon={MessageSquare} delay={50} />
      </div>

      {/* Source Filter Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {sourceFilters.map((sf) => (
          <button
            key={sf.id}
            onClick={() => setSourceFilter(sf.id)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: `1px solid ${sourceFilter === sf.id ? C.blue + "50" : "transparent"}`,
              background: sourceFilter === sf.id ? "rgba(124,140,245,0.12)" : "transparent",
              color: sourceFilter === sf.id ? C.text : C.textMuted,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s",
            }}
          >
            {sf.label}
            {sf.count > 0 && (
              <span style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 8,
                background: "rgba(239,59,59,0.15)",
                color: C.red,
                fontWeight: 600,
              }}>
                {sf.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Message List */}
      <div className="dash-card" style={{ padding: "4px 0", overflow: "hidden" }}>
        {filteredMessages.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            No messages {sourceFilter !== "all" ? `from ${sourceLabel(sourceFilter)}` : ""}
          </div>
        ) : (
          filteredMessages.slice(0, 30).map((msg, i) => (
            <div
              key={msg.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 20px",
                borderBottom: i < filteredMessages.length - 1 ? `1px solid ${C.border}` : "none",
                background: !msg.read ? "rgba(124,140,245,0.04)" : "transparent",
                transition: "background 0.15s",
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 2 }}>{sourceIcon(msg.source)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontWeight: msg.read ? 400 : 600, color: msg.read ? C.textSecondary : C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {msg.from}
                  </span>
                  {msg.priority === "high" && (
                    <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(239,59,59,0.12)", color: C.red, fontWeight: 600 }}>HIGH</span>
                  )}
                  <span style={{ fontSize: 10, color: C.textFaint, marginLeft: "auto", flexShrink: 0 }}>{timeAgo(msg.date)}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: msg.read ? 400 : 600, color: msg.read ? C.textSecondary : C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {msg.subject}
                </div>
                {msg.snippet && (
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {msg.snippet}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 5: AGENTS
// ═══════════════════════════════════════════════════════════════════════════

function AgentsTab({ summary, dashboard }: { summary: SummaryData | null; dashboard: UnifiedDashboard | null }) {
  const amz = dashboard?.amazon;

  return (
    <>
      {/* System Health */}
      <SectionHeader title="System Health" icon={Shield} />
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        <StatCard
          label="Overall Status"
          value={summary?.overall || "N/A"}
          color={summary?.overall === "healthy" ? C.green : summary?.overall === "warning" ? C.amber : summary?.overall === "critical" ? C.red : C.textMuted}
          icon={summary?.overall === "healthy" ? CheckCircle : summary?.overall === "critical" ? XCircle : AlertTriangle}
        />
        <StatCard label="Healthy" value={summary?.counts.healthy ?? "-"} color={C.green} icon={CheckCircle} delay={50} />
        <StatCard label="Warnings" value={summary?.counts.warning ?? "-"} color={C.amber} icon={AlertTriangle} delay={100} />
        <StatCard label="Critical" value={summary?.counts.critical ?? "-"} color={C.red} icon={XCircle} delay={150} />
        <StatCard label="Total Agents" value={summary?.agentCount ?? "-"} color={C.textSecondary} icon={Bot} delay={200} />
      </div>

      {/* Amazon Deep Dive */}
      {amz && (
        <div style={{ marginBottom: 28 }}>
          <SectionHeader title="Amazon Performance" badge="SP-API" icon={Package} />
          {/* Today's Sales + Velocity */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            <StatCard label="Today's Revenue" value={fmt$(amz.revenue.today)} subtitle={`Yesterday: ${fmt$(amz.revenue.yesterday)}`} color={C.amazon} icon={DollarSign} />
            <StatCard label="Today's Orders" value={fmtN(amz.orders.today)} subtitle={`Yesterday: ${fmtN(amz.orders.yesterday)}`} color={C.amazon} icon={ShoppingCart} delay={50} />
            <StatCard label="Units Sold Today" value={fmtN(amz.unitsSold.today)} color={C.amazon} icon={Boxes} delay={100} />
          </div>
          {/* Period Performance */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            <StatCard label="Week to Date" value={fmt$(amz.revenue.weekToDate)} subtitle={`${fmtN(amz.orders.weekToDate)} orders`} color={C.blue} icon={Eye} />
            <StatCard label="Last Week" value={fmt$(amz.revenue.lastWeek)} subtitle={`${fmtN(amz.orders.lastWeek)} orders`} color={C.blue} icon={Clock} delay={50} />
            <StatCard label="Month to Date" value={fmt$(amz.revenue.monthToDate)} subtitle={`${fmtN(amz.orders.monthToDate)} orders`} color={C.blue} icon={BarChart3} delay={100} />
          </div>
          {/* Order Status */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <StatusBadge label="Pending" count={amz.orderStatus.pending} color={C.amber} />
            <StatusBadge label="Unshipped" count={amz.orderStatus.unshipped} color={C.blue} />
            <StatusBadge label="Shipped" count={amz.orderStatus.shipped} color={C.green} />
            <StatusBadge label="Canceled" count={amz.orderStatus.canceled} color={C.red} />
          </div>
          {/* FBA Inventory */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            <StatCard label="FBA Fulfillable" value={fmtN(amz.inventory.fulfillable)} color={amz.inventory.daysOfSupply < 14 ? C.amber : C.green} icon={Package} />
            <StatCard label="Days of Supply" value={amz.inventory.daysOfSupply > 365 ? "N/A" : `${amz.inventory.daysOfSupply}d`} color={amz.inventory.daysOfSupply < 7 ? C.red : amz.inventory.daysOfSupply < 14 ? C.amber : C.green} icon={Zap} delay={50} />
            <StatCard label="Inbound Working" value={fmtN(amz.inventory.inboundWorking)} color={C.textSecondary} icon={Truck} delay={100} />
            <StatCard label="Inbound Shipped" value={fmtN(amz.inventory.inboundShipped)} color={C.textSecondary} icon={Truck} delay={150} />
            <StatCard label="Reserved" value={fmtN(amz.inventory.reserved)} color={C.textMuted} icon={PackageOpen} delay={200} />
          </div>
          {/* Comparisons */}
          <div className="dash-card" style={{ padding: "20px 24px", display: "flex", gap: 40, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <Activity size={12} strokeWidth={1.8} /> Today vs Yesterday
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <DeltaIndicator value={amz.comparison.todayVsYesterday.revenuePct} label="revenue" />
                <DeltaIndicator value={amz.comparison.todayVsYesterday.ordersPct} label="orders" />
              </div>
            </div>
            <div style={{ width: 1, background: C.border, alignSelf: "stretch" }} />
            <div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <TrendingUp size={12} strokeWidth={1.8} /> Week over Week
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <DeltaIndicator value={amz.comparison.weekOverWeek.revenuePct} label="revenue" />
                <DeltaIndicator value={amz.comparison.weekOverWeek.ordersPct} label="orders" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <SectionHeader title="Quick Actions" icon={Zap} />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { href: "/ops/agents", label: "View All Agents", icon: Bot },
            { href: "/ops/logs", label: "System Logs", icon: Activity },
            { href: "/ops/settings", label: "Settings", icon: Shield },
          ].map((link) => (
            <a key={link.href} href={link.href} className="dash-action">
              <link.icon size={16} strokeWidth={1.8} />
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

export function OpsDashboard() {
  const { data: session } = useSession();
  const userRole = (session?.user as { role?: string })?.role || "";

  // Existing state
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [dashboard, setDashboard] = useState<UnifiedDashboard | null>(null);
  const [cashPosition, setCashPosition] = useState<CashPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState<DateRange>("30d");
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetch, setLastFetch] = useState<number>(0);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null!);  // non-null for ref prop compat

  // New state for enterprise data
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [balances, setBalances] = useState<UnifiedBalances | null>(null);
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);
  const [forecast, setForecast] = useState<ForecastReport | null>(null);
  const [pnl, setPnl] = useState<PnLReport | null>(null);
  const [inboxData, setInboxData] = useState<InboxSummary | null>(null);

  const fetchAll = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      // Core dashboard data (always fetch)
      const [summaryRes, dashRes, cashRes] = await Promise.all([
        fetch("/api/agentic/command-center", { cache: "no-store" }).catch(() => null),
        fetch("/api/ops/dashboard", { cache: "no-store" }),
        fetch("/api/ops/finance/cash", { cache: "no-store" }).catch(() => null),
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
        setLastFetch(Date.now());
      } else {
        setError("Failed to load dashboard data");
      }

      if (cashRes?.ok) {
        const data = await cashRes.json();
        if (data && data.balance !== undefined) setCashPosition(data);
      }

      // Enterprise data (fetch in parallel, non-blocking)
      const [balancesRes, pipelineRes, forecastRes, pnlRes, inboxRes] = await Promise.allSettled([
        fetch("/api/ops/balances", { cache: "no-store" }),
        fetch("/api/ops/pipeline", { cache: "no-store" }),
        fetch("/api/ops/forecast", { cache: "no-store" }),
        fetch("/api/ops/pnl", { cache: "no-store" }),
        fetch("/api/ops/inbox", { cache: "no-store" }),
      ]);

      if (balancesRes.status === "fulfilled" && balancesRes.value.ok) {
        setBalances(await balancesRes.value.json());
      }
      if (pipelineRes.status === "fulfilled" && pipelineRes.value.ok) {
        setPipeline(await pipelineRes.value.json());
      }
      if (forecastRes.status === "fulfilled" && forecastRes.value.ok) {
        setForecast(await forecastRes.value.json());
      }
      if (pnlRes.status === "fulfilled" && pnlRes.value.ok) {
        setPnl(await pnlRes.value.json());
      }
      if (inboxRes.status === "fulfilled" && inboxRes.value.ok) {
        setInboxData(await inboxRes.value.json());
      }
    } catch {
      setError("Failed to connect to dashboard API");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleCSVUpload = useCallback(async (file: File) => {
    setCsvUploading(true);
    setCsvResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/ops/finance/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setCsvResult(`✓ ${data.written} transactions imported (${data.skipped} skipped)`);
        if (data.cashPosition) setCashPosition(data.cashPosition);
      } else {
        setCsvResult(`✗ ${data.error || "Upload failed"}`);
      }
    } catch {
      setCsvResult("✗ Upload failed — network error");
    } finally {
      setCsvUploading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(() => fetchAll(), 60000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Time since last fetch
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!lastFetch) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - lastFetch) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [lastFetch]);

  const greeting = session?.user?.name
    ? `Welcome back, ${session.user.name.split(" ")[0]}`
    : "Command Center";

  const tabs: { id: TabId; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "finance", label: "Finance", icon: Wallet },
    { id: "pipeline", label: "Pipeline", icon: GitBranch, badge: pipeline?.weeklyTrend.newLeads },
    { id: "inbox", label: "Inbox", icon: MessagesSquare, badge: inboxData?.unreadCount.total },
    { id: "agents", label: "Agents", icon: Bot },
  ];

  return (
    <div>
      <DashboardStyles />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "0.01em", color: C.text }}>
            {greeting}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 13, color: C.textMuted }}>USA Gummies — Enterprise Command Center</span>
            {lastFetch > 0 && (
              <span style={{ fontSize: 11, color: C.textFaint, display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={10} strokeWidth={1.5} />
                {elapsed < 60 ? `${elapsed}s ago` : `${Math.floor(elapsed / 60)}m ago`}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Date Range Selector (Overview tab only) */}
          {activeTab === "overview" && (
            <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3 }}>
              {(["7d", "14d", "30d"] as DateRange[]).map((r) => (
                <button key={r} onClick={() => setRange(r)} className={`dash-range-btn ${range === r ? "active" : ""}`}>
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => fetchAll(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8,
              border: `1px solid ${C.border}`, background: "transparent", color: C.textSecondary,
              fontSize: 12, cursor: "pointer", transition: "all 0.15s",
            }}
          >
            <RefreshCw size={13} strokeWidth={1.8} style={{ animation: refreshing ? "pulse 1s infinite" : "none" }} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>

          {dashboard && activeTab === "overview" && (
            <button
              onClick={() => exportCSV(dashboard)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8,
                border: `1px solid ${C.border}`, background: "transparent", color: C.textSecondary,
                fontSize: 12, cursor: "pointer", transition: "all 0.15s",
              }}
            >
              <Download size={13} strokeWidth={1.8} /> Export
            </button>
          )}
        </div>
      </div>

      {/* ── Tab Bar ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 2, marginBottom: 24, borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`dash-tab ${activeTab === tab.id ? "active" : ""}`}
          >
            <tab.icon size={14} strokeWidth={1.8} />
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="dash-tab-badge">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Error ───────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: "rgba(239,59,59,0.08)", border: "1px solid rgba(239,59,59,0.2)", borderRadius: 10, padding: "14px 18px", marginBottom: 24, color: C.red, fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
          <XCircle size={16} strokeWidth={2} /> {error}
        </div>
      )}

      {/* ── Loading Skeletons ────────────────────────────────────── */}
      {loading && (
        <div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
            <SkeletonCard /><SkeletonCard /><SkeletonCard />
          </div>
          <div className="dash-card" style={{ padding: 24, marginBottom: 24 }}>
            <Skeleton width="30%" height={14} />
            <div style={{ marginTop: 16 }}><Skeleton height={200} /></div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
          </div>
        </div>
      )}

      {/* ── Tab Content ─────────────────────────────────────────── */}
      {!loading && (
        <>
          {activeTab === "overview" && (
            <OverviewTab
              dashboard={dashboard}
              balances={balances}
              pipeline={pipeline}
              inboxData={inboxData}
              range={range}
            />
          )}
          {activeTab === "finance" && (
            <FinanceTab
              balances={balances}
              forecast={forecast}
              pnl={pnl}
              dashboard={dashboard}
              cashPosition={cashPosition}
              csvUploading={csvUploading}
              csvResult={csvResult}
              fileInputRef={fileInputRef}
              handleCSVUpload={handleCSVUpload}
              role={userRole}
            />
          )}
          {activeTab === "pipeline" && (
            <PipelineTab pipeline={pipeline} />
          )}
          {activeTab === "inbox" && (
            <InboxTab inboxData={inboxData} />
          )}
          {activeTab === "agents" && (
            <AgentsTab summary={summary} dashboard={dashboard} />
          )}
        </>
      )}

      {/* ── AI Chat Panel ────────────────────────────────────────── */}
      <OpsChat />
    </div>
  );
}
