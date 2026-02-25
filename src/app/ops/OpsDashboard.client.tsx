"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback, useMemo } from "react";
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
} from "lucide-react";
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

type DateRange = "7d" | "14d" | "30d";

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

function RevenueChart({
  data,
  range,
}: {
  data: UnifiedDashboard["chartData"];
  range: DateRange;
}) {
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
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: C.textFaint }}
            axisLine={false}
            tickLine={false}
            interval={range === "30d" ? 4 : range === "14d" ? 2 : 0}
          />
          <YAxis
            tick={{ fontSize: 10, fill: C.textFaint }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
            width={48}
          />
          <Tooltip content={<ChartTooltip />} />
          {hasAmazon && (
            <Area
              type="monotone"
              dataKey="amazon"
              name="Amazon"
              stroke={C.amazon}
              fill="url(#gradAmazon)"
              strokeWidth={2}
              dot={false}
              animationDuration={800}
            />
          )}
          {hasShopify && (
            <Area
              type="monotone"
              dataKey="shopify"
              name="Shopify"
              stroke={C.shopify}
              fill="url(#gradShopify)"
              strokeWidth={2}
              dot={false}
              animationDuration={800}
              animationBegin={200}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders Bar Chart
// ---------------------------------------------------------------------------

function OrdersChart({
  data,
  range,
}: {
  data: UnifiedDashboard["chartData"];
  range: DateRange;
}) {
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
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: C.textFaint }}
            axisLine={false}
            tickLine={false}
            interval={range === "30d" ? 4 : range === "14d" ? 2 : 0}
          />
          <YAxis
            tick={{ fontSize: 10, fill: C.textFaint }}
            axisLine={false}
            tickLine={false}
            width={30}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            contentStyle={{
              background: "#1e2130",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              fontSize: 12,
            }}
          />
          {hasAmazon && (
            <Bar dataKey="amazonOrders" name="Amazon" fill={C.amazon} radius={[3, 3, 0, 0]} animationDuration={600} />
          )}
          {hasShopify && (
            <Bar dataKey="shopifyOrders" name="Shopify" fill={C.shopify} radius={[3, 3, 0, 0]} animationDuration={600} animationBegin={200} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Amazon Deep Dive Section
// ---------------------------------------------------------------------------

function AmazonSection({ amz }: { amz: AmazonKPIs }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <SectionHeader title="Amazon Performance" badge="SP-API" icon={Package} />

      {/* Row 1: Today's Sales + Velocity */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <StatCard label="Today's Revenue" value={fmt$(amz.revenue.today)} subtitle={`Yesterday: ${fmt$(amz.revenue.yesterday)}`} color={C.amazon} icon={DollarSign} delay={200} />
        <StatCard label="Today's Orders" value={fmtN(amz.orders.today)} subtitle={`Yesterday: ${fmtN(amz.orders.yesterday)}`} color={C.amazon} icon={ShoppingCart} delay={250} />
        <StatCard label="Units Sold Today" value={fmtN(amz.unitsSold.today)} color={C.amazon} icon={Boxes} delay={300} />
        <StatCard
          label="Sales Velocity"
          value={`${amz.velocity.unitsPerDay7d}/day`}
          subtitle={amz.velocity.trend === "up" ? "Trending up" : amz.velocity.trend === "down" ? "Trending down" : "Flat"}
          color={amz.velocity.trend === "up" ? C.green : amz.velocity.trend === "down" ? C.red : C.textSecondary}
          icon={amz.velocity.trend === "up" ? TrendingUp : amz.velocity.trend === "down" ? TrendingDown : Activity}
          delay={350}
        />
      </div>

      {/* Row 2: Period Performance */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <StatCard label="Week to Date" value={fmt$(amz.revenue.weekToDate)} subtitle={`${fmtN(amz.orders.weekToDate)} orders · ${fmtN(amz.unitsSold.weekToDate)} units`} color={C.blue} icon={Eye} delay={400} />
        <StatCard label="Last Week" value={fmt$(amz.revenue.lastWeek)} subtitle={`${fmtN(amz.orders.lastWeek)} orders`} color={C.blue} icon={Clock} delay={450} />
        <StatCard label="Month to Date" value={fmt$(amz.revenue.monthToDate)} subtitle={`${fmtN(amz.orders.monthToDate)} orders · ${fmtN(amz.unitsSold.monthToDate)} units`} color={C.blue} icon={BarChart3} delay={500} />
      </div>

      {/* Row 3: Order Status */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <StatusBadge label="Pending" count={amz.orderStatus.pending} color={C.amber} />
        <StatusBadge label="Unshipped" count={amz.orderStatus.unshipped} color={C.blue} />
        <StatusBadge label="Shipped" count={amz.orderStatus.shipped} color={C.green} />
        <StatusBadge label="Canceled" count={amz.orderStatus.canceled} color={C.red} />
      </div>

      {/* Row 4: FBA Inventory */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <StatCard label="FBA Fulfillable" value={fmtN(amz.inventory.fulfillable)} color={amz.inventory.daysOfSupply < 14 ? C.amber : C.green} icon={Package} delay={550} />
        <StatCard
          label="Days of Supply"
          value={amz.inventory.daysOfSupply > 365 ? "N/A" : `${amz.inventory.daysOfSupply}d`}
          color={amz.inventory.daysOfSupply < 7 ? C.red : amz.inventory.daysOfSupply < 14 ? C.amber : amz.inventory.daysOfSupply < 30 ? "#ffd93d" : C.green}
          icon={Zap}
          delay={600}
        />
        <StatCard label="Inbound Working" value={fmtN(amz.inventory.inboundWorking)} color={C.textSecondary} icon={Truck} delay={650} />
        <StatCard label="Inbound Shipped" value={fmtN(amz.inventory.inboundShipped)} color={C.textSecondary} icon={Truck} delay={700} />
        <StatCard label="Reserved" value={fmtN(amz.inventory.reserved)} color={C.textMuted} icon={PackageOpen} delay={750} />
      </div>

      {/* Row 5: Fees & Margin */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <StatCard label="Referral Fee" value={fmt$(amz.fees.referralFee)} color={C.textSecondary} icon={DollarSign} delay={800} />
        <StatCard label="FBA Fee" value={fmt$(amz.fees.fbaFee)} color={C.textSecondary} icon={DollarSign} delay={850} />
        <StatCard label="Total Fees" value={fmt$(amz.fees.totalFee)} color={C.amber} icon={Wallet} delay={900} />
        <StatCard
          label="Est. Net Margin"
          value={`${amz.fees.estimatedNetMargin}%`}
          color={amz.fees.estimatedNetMargin > 30 ? C.green : amz.fees.estimatedNetMargin > 15 ? C.amber : C.red}
          icon={TrendingUp}
          delay={950}
        />
      </div>

      {/* Row 6: Comparisons */}
      <div className="dash-card" style={{ padding: "20px 24px", display: "flex", gap: 40, flexWrap: "wrap", animationDelay: "1000ms" }}>
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
  );
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
  const [range, setRange] = useState<DateRange>("30d");
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetch, setLastFetch] = useState<number>(0);

  const fetchAll = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
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
        setLastFetch(Date.now());
      } else {
        setError("Failed to load dashboard data");
      }
    } catch {
      setError("Failed to connect to dashboard API");
    } finally {
      setLoading(false);
      setRefreshing(false);
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
    : "Dashboard";

  const amz = dashboard?.amazon;
  const shop = dashboard?.shopify;
  const combined = dashboard?.combined;
  const chartData = useMemo(() => dashboard?.chartData || [], [dashboard]);

  return (
    <div>
      <DashboardStyles />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "0.01em", color: C.text }}>
            {greeting}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 13, color: C.textMuted }}>USA Gummies — Unified Business Dashboard</span>
            {lastFetch > 0 && (
              <span style={{ fontSize: 11, color: C.textFaint, display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={10} strokeWidth={1.5} />
                {elapsed < 60 ? `${elapsed}s ago` : `${Math.floor(elapsed / 60)}m ago`}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Date Range Selector */}
          <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 3 }}>
            {(["7d", "14d", "30d"] as DateRange[]).map((r) => (
              <button key={r} onClick={() => setRange(r)} className={`dash-range-btn ${range === r ? "active" : ""}`}>
                {r.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Refresh */}
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

          {/* Export */}
          {dashboard && (
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

      {/* ── Error ───────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: "rgba(239,59,59,0.08)", border: `1px solid rgba(239,59,59,0.2)`, borderRadius: 10, padding: "14px 18px", marginBottom: 24, color: C.red, fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
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

      {!loading && (
        <>
          {/* ── Inventory Alert ───────────────────────────────────── */}
          {amz?.inventory.restockAlert && (
            <InventoryAlertBanner daysOfSupply={amz.inventory.daysOfSupply} />
          )}

          {/* ── Combined Hero Metrics ──────────────────────────────── */}
          {combined && (
            <div style={{ marginBottom: 28 }}>
              <SectionHeader title="Combined Performance" badge="All Channels" icon={Zap} />
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <StatCard label="Total Revenue (MTD)" value={fmt$(combined.totalRevenue)} color={C.green} icon={DollarSign} delay={0} />
                <StatCard label="Total Orders (MTD)" value={fmtN(combined.totalOrders)} color={C.blue} icon={ShoppingCart} delay={50} />
                <StatCard label="Combined AOV" value={fmt$(combined.avgOrderValue)} color={C.amber} icon={TrendingUp} delay={100} />
              </div>
            </div>
          )}

          {/* ── Revenue Trend Chart ────────────────────────────────── */}
          {chartData.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <RevenueChart data={chartData} range={range} />
            </div>
          )}

          {/* ── Orders Bar Chart + Channel Breakdown ──────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 28 }}>
            {chartData.length > 0 && (
              <OrdersChart data={chartData} range={range} />
            )}
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
                  {combined && combined.totalRevenue > 0 && amz && shop && (
                    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, marginTop: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textMuted }}>
                        <span>Amazon share</span>
                        <span style={{ fontWeight: 600, color: C.amazon }}>{Math.round((amz.revenue.monthToDate / combined.totalRevenue) * 100)}%</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                        <span>Shopify share</span>
                        <span style={{ fontWeight: 600, color: C.shopify }}>{Math.round((shop.totalRevenue / combined.totalRevenue) * 100)}%</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Amazon Deep Dive ───────────────────────────────────── */}
          {amz && <AmazonSection amz={amz} />}

          {/* ── System Health ──────────────────────────────────────── */}
          <div style={{ marginBottom: 32 }}>
            <SectionHeader title="System Health" icon={Activity} />
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <StatCard
                label="Overall Status"
                value={summary?.overall || "N/A"}
                color={summary?.overall === "healthy" ? C.green : summary?.overall === "warning" ? C.amber : summary?.overall === "critical" ? C.red : C.textMuted}
                icon={summary?.overall === "healthy" ? CheckCircle : summary?.overall === "critical" ? XCircle : AlertTriangle}
                delay={1050}
              />
              <StatCard label="Healthy" value={summary?.counts.healthy ?? "-"} color={C.green} icon={CheckCircle} delay={1100} />
              <StatCard label="Warnings" value={summary?.counts.warning ?? "-"} color={C.amber} icon={AlertTriangle} delay={1150} />
              <StatCard label="Critical" value={summary?.counts.critical ?? "-"} color={C.red} icon={XCircle} delay={1200} />
              <StatCard label="Total Agents" value={summary?.agentCount ?? "-"} color={C.textSecondary} icon={Bot} delay={1250} />
            </div>
          </div>

          {/* ── Quick Actions ──────────────────────────────────────── */}
          <div>
            <SectionHeader title="Quick Actions" icon={Zap} />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { href: "/ops/agents", label: "View All Agents", icon: Bot },
                { href: "/ops/inbox", label: "Reply Queue", icon: Mail },
                { href: "/ops/pipeline", label: "Pipeline", icon: GitBranch },
                { href: "/ops/finance", label: "Finance Detail", icon: Wallet },
                { href: "/ops/wholesale", label: "Wholesale Order", icon: PackageOpen },
              ].map((link) => (
                <a key={link.href} href={link.href} className="dash-action">
                  <link.icon size={16} strokeWidth={1.8} />
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          {/* ── Not configured ─────────────────────────────────────── */}
          {!amz && !error && (
            <div style={{ marginTop: 28, padding: "18px 22px", background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: 12, color: C.textMuted, fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
              <AlertTriangle size={16} strokeWidth={1.8} />
              Amazon data unavailable — SP-API credentials not configured.
            </div>
          )}
        </>
      )}
    </div>
  );
}
