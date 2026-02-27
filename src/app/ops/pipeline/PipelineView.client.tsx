"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  Cell,
} from "recharts";
import {
  MapPin,
  Users,
  Truck,
  ShoppingBag,
  Store,
  Target,
  Calendar,
  CheckCircle2,
  BarChart3,
  Globe,
  Activity,
  TrendingUp,
  Clock,
  AlertCircle,
  ArrowRight,
  Zap,
  RefreshCw,
} from "lucide-react";
import {
  MONTHS,
  MONTH_LABELS,
  MONTH_FULL_LABELS,
  DISTRIBUTOR_NETWORK,
  DISTRIBUTOR,
  AMAZON,
  WHOLESALE,
  ANNUAL_SUMMARY,
  MILESTONES,
  UNIT_ECONOMICS,
  type Month,
} from "@/lib/ops/pro-forma";
import {
  usePipelineData,
  fmtDollar as warRoomFmtDollar,
  fmt as warRoomFmt,
  type PipelineLead,
  type PipelineData,
} from "@/lib/ops/use-war-room-data";

// ---------------------------------------------------------------------------
// Design Tokens
// ---------------------------------------------------------------------------

const NAVY = "#1B2A4A";
const RED = "#c7362c";
const GOLD = "#c7a062";
const CREAM = "#f8f5ef";
const WHITE = "#ffffff";
const LIGHT_NAVY = "rgba(27, 42, 74, 0.06)";
const BORDER = "rgba(27, 42, 74, 0.12)";
const MUTED = "rgba(27, 42, 74, 0.55)";

const fmt = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : `$${n.toLocaleString()}`;
const fmtUnits = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : n.toLocaleString();
const fmtDollar = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Stage color mapping for live pipeline
const STAGE_COLORS: Record<string, string> = {
  "New - Uncontacted": "#3b82f6",
  "New Lead": "#3b82f6",
  Lead: "#3b82f6",
  Contacted: "#c7a062",
  "Follow-Up Sent": "#c7a062",
  Interested: "#f59e0b",
  "Quote Sent": "#f97316",
  Negotiation: "#f97316",
  "Proposal Sent": "#f97316",
  "Order Placed": "#16a34a",
  "Closed Won": "#16a34a",
  "Closed Lost": "#c7362c",
  "Not Interested": "#94a3b8",
  Unresponsive: "#94a3b8",
  Unknown: "#94a3b8",
};

function stageColor(stage: string): string {
  return STAGE_COLORS[stage] || NAVY;
}

// ---------------------------------------------------------------------------
// Data Computation
// ---------------------------------------------------------------------------

type NetworkRow = {
  month: string;
  monthKey: Month;
  newDistributors: number;
  cumulativeDistributors: number;
  unitsPerDistributor: number;
  totalDistributorUnits: number;
  distributorRevenue: number;
};

function buildNetworkData(): NetworkRow[] {
  const wholesalePrice = UNIT_ECONOMICS.distributor.sellPrice; // $2.50
  let cumulative = 0;
  return MONTHS.map((m) => {
    const newDist = DISTRIBUTOR_NETWORK.filter((d) => d.startMonth === m).length;
    cumulative += newDist;
    const units = DISTRIBUTOR.units[m];
    const perDist = cumulative > 0 ? Math.round(units / cumulative) : 0;
    return {
      month: MONTH_LABELS[m],
      monthKey: m,
      newDistributors: newDist,
      cumulativeDistributors: cumulative,
      unitsPerDistributor: perDist,
      totalDistributorUnits: units,
      distributorRevenue: units * wholesalePrice,
    };
  });
}

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = React.ComponentType<any>;

function SectionTitle({ children, icon: Icon }: { children: React.ReactNode; icon?: IconComponent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, marginTop: 40 }}>
      {Icon && <Icon size={20} color={RED} />}
      <h2 style={{ fontSize: 18, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: "-0.01em" }}>
        {children}
      </h2>
    </div>
  );
}

function MetricCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div
      style={{
        background: WHITE,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "18px 22px",
        flex: "1 1 180px",
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, marginBottom: 6, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent || NAVY, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function FunnelBar({ label, value, maxValue, color, sub }: { label: string; value: number; maxValue: number; color: string; sub?: string }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
      </div>
      <div style={{ background: LIGHT_NAVY, borderRadius: 6, height: 28, overflow: "hidden", position: "relative" as const }}>
        <div
          style={{
            background: color,
            height: "100%",
            width: `${Math.max(pct, 3)}%`,
            borderRadius: 6,
            transition: "width 0.5s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: 8,
          }}
        >
          {pct > 20 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: WHITE }}>{Math.round(pct)}%</span>
          )}
        </div>
      </div>
      {sub && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TerritoryCard({
  title,
  icon: Icon,
  description,
  annualUnits,
  annualRevenue,
  status,
  statusColor,
  metrics,
}: {
  title: string;
  icon: IconComponent;
  description: string;
  annualUnits: number;
  annualRevenue: number;
  status: string;
  statusColor: string;
  metrics: { label: string; value: string }[];
}) {
  return (
    <div
      style={{
        background: WHITE,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 0,
        flex: "1 1 280px",
        minWidth: 260,
        overflow: "hidden",
      }}
    >
      <div style={{ background: NAVY, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <Icon size={22} color={GOLD} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: WHITE }}>{title}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{description}</div>
        </div>
      </div>
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, fontWeight: 600 }}>Annual Units</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{fmtUnits(annualUnits)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, fontWeight: 600 }}>Annual Revenue</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{fmtDollar(annualRevenue)}</div>
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: `${statusColor}15`,
            color: statusColor,
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            borderRadius: 20,
            marginBottom: 14,
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
          {status}
        </div>
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
          {metrics.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: MUTED }}>{m.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Recharts Tooltip
// ---------------------------------------------------------------------------

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div style={{ background: NAVY, borderRadius: 8, padding: "10px 14px", border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: WHITE, marginBottom: 6 }}>{label}</div>
      {payload.map((entry, i) => (
        <div key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginBottom: 2 }}>
          <span style={{ color: entry.color, fontWeight: 600 }}>{entry.name}:</span>{" "}
          {entry.name.toLowerCase().includes("revenue") || entry.name.toLowerCase().includes("$")
            ? fmtDollar(entry.value)
            : fmtUnits(entry.value)}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Pipeline Sub-Components
// ---------------------------------------------------------------------------

function LiveBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "#16a34a15",
        color: "#16a34a",
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 10px",
        borderRadius: 12,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "#16a34a",
          display: "inline-block",
          animation: "pulse 2s ease-in-out infinite",
        }}
      />
      LIVE
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </span>
  );
}

function LoadingShimmer({ height = 200 }: { height?: number }) {
  return (
    <div
      style={{
        background: `linear-gradient(90deg, ${LIGHT_NAVY} 25%, ${WHITE} 50%, ${LIGHT_NAVY} 75%)`,
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s infinite",
        borderRadius: 12,
        height,
        border: `1px solid ${BORDER}`,
      }}
    >
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        background: `${RED}10`,
        border: `1px solid ${RED}30`,
        borderRadius: 10,
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 20,
      }}
    >
      <AlertCircle size={18} color={RED} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>Pipeline data unavailable</div>
        <div style={{ fontSize: 12, color: MUTED }}>{message}</div>
      </div>
    </div>
  );
}

function LeadCard({ lead }: { lead: PipelineLead }) {
  const sc = stageColor(lead.status);
  const daysSinceEdit = Math.round(
    (Date.now() - new Date(lead.lastEdited).getTime()) / (1000 * 60 * 60 * 24)
  );
  return (
    <div
      style={{
        background: WHITE,
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${sc}`,
        borderRadius: 8,
        padding: "14px 16px",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{lead.name || "Unnamed Lead"}</div>
          {lead.email && (
            <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>{lead.email}</div>
          )}
        </div>
        <div style={{ textAlign: "right" as const }}>
          {lead.dealValue > 0 && (
            <div style={{ fontSize: 16, fontWeight: 800, color: NAVY }}>
              {warRoomFmtDollar(lead.dealValue)}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: sc,
            background: `${sc}15`,
            padding: "2px 8px",
            borderRadius: 10,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {lead.status}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: lead.type === "distributor" ? GOLD : "#2563eb",
            background: lead.type === "distributor" ? `${GOLD}15` : "#2563eb15",
            padding: "2px 8px",
            borderRadius: 10,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {lead.type}
        </span>
        {lead.source && (
          <span style={{ fontSize: 11, color: MUTED }}>{lead.source}</span>
        )}
        <span style={{ fontSize: 11, color: daysSinceEdit > 7 ? RED : MUTED, marginLeft: "auto" }}>
          {daysSinceEdit === 0 ? "Today" : daysSinceEdit === 1 ? "Yesterday" : `${daysSinceEdit}d ago`}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function PipelineView() {
  const networkData = useMemo(() => buildNetworkData(), []);
  const { data: pipeline, loading: pipeLoading, error: pipeError } = usePipelineData();

  // Channel annual totals
  const amazonUnits = Object.values(AMAZON.units).reduce((a, b) => a + b, 0);
  const amazonRevenue = Object.values(AMAZON.revenue).reduce((a, b) => a + b, 0);
  const wholesaleUnits = Object.values(WHOLESALE.units).reduce((a, b) => a + b, 0);
  const wholesaleRevenue = Object.values(WHOLESALE.revenue).reduce((a, b) => a + b, 0);
  const distributorUnits = Object.values(DISTRIBUTOR.units).reduce((a, b) => a + b, 0);
  const distributorRevenue = Object.values(DISTRIBUTOR.revenue).reduce((a, b) => a + b, 0);
  const totalDistributors = DISTRIBUTOR_NETWORK.length;

  // Funnel data (from plan)
  const totalNewNeeded = totalDistributors;
  const confirmed = DISTRIBUTOR_NETWORK.filter((d) => d.status === "confirmed").length;
  const prospecting = DISTRIBUTOR_NETWORK.filter((d) => d.status === "prospecting").length;

  // Chart data for composed chart
  const chartData = networkData.map((row) => ({
    month: row.month,
    newDistributors: row.newDistributors,
    cumulative: row.cumulativeDistributors,
    units: row.totalDistributorUnits,
    revenue: row.distributorRevenue,
  }));

  // Pipeline milestones
  const pipelineMilestones = MILESTONES.filter((m) =>
    ["first-distributor", "second-distributor", "third-distributor", "first-reorder", "second-reorder", "ebitda-positive", "100k-units"].includes(m.id)
  );

  // Sort live stages by STAGE_ORDER for funnel display
  const STAGE_ORDER = [
    "New - Uncontacted", "New Lead", "Lead", "Contacted", "Follow-Up Sent",
    "Interested", "Quote Sent", "Negotiation", "Proposal Sent",
    "Order Placed", "Closed Won", "Closed Lost", "Not Interested", "Unresponsive", "Unknown",
  ];

  const sortedLiveStages = useMemo(() => {
    if (!pipeline?.stageCounts) return [];
    return Object.entries(pipeline.stageCounts)
      .sort(([a], [b]) => {
        const ia = STAGE_ORDER.indexOf(a);
        const ib = STAGE_ORDER.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
  }, [pipeline?.stageCounts]);

  // Plan vs Actual comparisons
  const planDistributorCount = DISTRIBUTOR_NETWORK.length;
  const planWholesaleRevenue = Object.values(WHOLESALE.revenue).reduce((a, b) => a + b, 0);

  return (
    <div style={{ background: CREAM, minHeight: "100vh", padding: "0 0 60px" }}>
      {/* HEADER */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <MapPin size={24} color={RED} />
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: NAVY,
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Territory & Pipeline
          </h1>
          <LiveBadge />
        </div>
        <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>
          Distribution Network & B2B Growth Tracking — Live CRM + Pro Forma Plan
        </p>
      </div>

      {/* Pipeline error banner */}
      {pipeError && <ErrorBanner message={pipeError} />}

      {/* ================================================================= */}
      {/* LIVE PIPELINE OVERVIEW */}
      {/* ================================================================= */}
      <SectionTitle icon={Zap}>Live Pipeline Overview</SectionTitle>

      {pipeLoading ? (
        <LoadingShimmer height={120} />
      ) : pipeline ? (
        <>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
            <MetricCard
              label="Total Leads"
              value={warRoomFmt(pipeline.totalLeads)}
              sub={`${warRoomFmt(pipeline.b2bCount)} B2B + ${warRoomFmt(pipeline.distributorCount)} Distributor`}
              accent={NAVY}
            />
            <MetricCard
              label="Pipeline Value"
              value={warRoomFmtDollar(pipeline.pipelineValue.total)}
              sub="Active deals (excl. Closed)"
              accent={RED}
            />
            <MetricCard
              label="Avg Days to Close"
              value={pipeline.velocity.avgDaysToClose > 0 ? `${pipeline.velocity.avgDaysToClose}` : "N/A"}
              sub={pipeline.velocity.avgDaysToClose > 0 ? "From creation to Closed Won" : "No closed deals yet"}
              accent={GOLD}
            />
            <MetricCard
              label="This Week"
              value={`+${warRoomFmt(pipeline.weeklyTrend.newLeads)}`}
              sub={`${warRoomFmt(pipeline.weeklyTrend.stageAdvances)} moved  |  ${warRoomFmt(pipeline.weeklyTrend.closedWon)} won`}
              accent="#16a34a"
            />
          </div>

          {/* ============================================================= */}
          {/* PLAN VS ACTUAL COMPARISON */}
          {/* ============================================================= */}
          <div
            style={{
              background: WHITE,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 24,
              marginBottom: 28,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
              <TrendingUp size={16} color={RED} />
              <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Plan vs Actual Pipeline</div>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {/* Distributor count comparison */}
              <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, fontWeight: 600, marginBottom: 8 }}>
                  Distributor Leads
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: NAVY }}>
                    {warRoomFmt(pipeline.distributorCount)}
                  </span>
                  <span style={{ fontSize: 13, color: MUTED }}>actual</span>
                  <span style={{ fontSize: 13, color: MUTED }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: MUTED }}>
                    {planDistributorCount}
                  </span>
                  <span style={{ fontSize: 13, color: MUTED }}>plan</span>
                </div>
                <div style={{ height: 8, background: LIGHT_NAVY, borderRadius: 4, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min((pipeline.distributorCount / Math.max(planDistributorCount, 1)) * 100, 100)}%`,
                      background: pipeline.distributorCount >= planDistributorCount ? "#16a34a" : GOLD,
                      borderRadius: 4,
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
              </div>
              {/* Pipeline value vs wholesale plan */}
              <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, fontWeight: 600, marginBottom: 8 }}>
                  Pipeline Value vs Wholesale Plan
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: NAVY }}>
                    {warRoomFmtDollar(pipeline.pipelineValue.total)}
                  </span>
                  <span style={{ fontSize: 13, color: MUTED }}>pipeline</span>
                  <span style={{ fontSize: 13, color: MUTED }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: MUTED }}>
                    {fmtDollar(planWholesaleRevenue)}
                  </span>
                  <span style={{ fontSize: 13, color: MUTED }}>plan</span>
                </div>
                <div style={{ height: 8, background: LIGHT_NAVY, borderRadius: 4, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min((pipeline.pipelineValue.total / Math.max(planWholesaleRevenue, 1)) * 100, 100)}%`,
                      background: pipeline.pipelineValue.total >= planWholesaleRevenue ? "#16a34a" : RED,
                      borderRadius: 4,
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
              </div>
              {/* B2B count */}
              <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: MUTED, fontWeight: 600, marginBottom: 8 }}>
                  B2B Wholesale Leads
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: NAVY }}>
                    {warRoomFmt(pipeline.b2bCount)}
                  </span>
                  <span style={{ fontSize: 13, color: MUTED }}>leads in CRM</span>
                  <span style={{ fontSize: 13, color: MUTED }}>vs</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: MUTED }}>
                    50+
                  </span>
                  <span style={{ fontSize: 13, color: MUTED }}>target</span>
                </div>
                <div style={{ height: 8, background: LIGHT_NAVY, borderRadius: 4, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min((pipeline.b2bCount / 50) * 100, 100)}%`,
                      background: pipeline.b2bCount >= 50 ? "#16a34a" : "#2563eb",
                      borderRadius: 4,
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ============================================================= */}
          {/* LIVE PIPELINE FUNNEL */}
          {/* ============================================================= */}
          <div
            style={{
              background: WHITE,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 24,
              marginBottom: 28,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Target size={16} color={RED} />
              <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Live Pipeline Funnel</div>
              <LiveBadge />
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 20 }}>
              {warRoomFmt(pipeline.totalLeads)} total leads across{" "}
              {sortedLiveStages.length} stages &mdash; {warRoomFmtDollar(pipeline.pipelineValue.total)} active pipeline
            </div>

            {sortedLiveStages.map(([stage, count]) => {
              const value = pipeline.pipelineValue.byStage[stage] || 0;
              const avgDays = pipeline.velocity.avgDaysByStage[stage];
              const sc = stageColor(stage);
              return (
                <div key={stage} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: sc, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{stage}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: sc }}>{count}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                      {value > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>
                          {warRoomFmtDollar(value)}
                        </span>
                      )}
                      {avgDays != null && (
                        <span style={{ fontSize: 11, color: MUTED }}>
                          ~{avgDays}d avg
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ background: LIGHT_NAVY, borderRadius: 6, height: 24, overflow: "hidden" }}>
                    <div
                      style={{
                        background: sc,
                        height: "100%",
                        width: `${Math.max((count / Math.max(pipeline.totalLeads, 1)) * 100, 3)}%`,
                        borderRadius: 6,
                        transition: "width 0.5s ease",
                        opacity: 0.85,
                      }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Conversion rates */}
            {Object.keys(pipeline.conversionRates).length > 0 && (
              <div style={{ marginTop: 20, borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 10 }}>
                  Stage Conversion Rates
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(pipeline.conversionRates).map(([transition, rate]) => (
                    <div
                      key={transition}
                      style={{
                        background: LIGHT_NAVY,
                        borderRadius: 8,
                        padding: "8px 12px",
                        flex: "0 1 auto",
                      }}
                    >
                      <div style={{ fontSize: 10, color: MUTED, marginBottom: 2, whiteSpace: "nowrap" }}>
                        {transition}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>
                        {rate}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ============================================================= */}
          {/* LIVE LEAD CARDS BY STAGE */}
          {/* ============================================================= */}
          <SectionTitle icon={Users}>Lead Pipeline by Stage</SectionTitle>

          <div style={{ marginBottom: 28 }}>
            {sortedLiveStages
              .filter(([, count]) => count > 0)
              .map(([stage]) => {
                const leads = pipeline.stages[stage] || [];
                if (leads.length === 0) return null;
                const sc = stageColor(stage);
                return (
                  <div key={stage} style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: sc }} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{stage}</span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: WHITE,
                          background: sc,
                          borderRadius: 10,
                          padding: "1px 8px",
                        }}
                      >
                        {leads.length}
                      </span>
                      {(pipeline.pipelineValue.byStage[stage] || 0) > 0 && (
                        <span style={{ fontSize: 12, color: MUTED, marginLeft: 4 }}>
                          {warRoomFmtDollar(pipeline.pipelineValue.byStage[stage])}
                        </span>
                      )}
                    </div>
                    {leads
                      .sort((a, b) => new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime())
                      .map((lead) => (
                        <LeadCard key={lead.id} lead={lead} />
                      ))}
                  </div>
                );
              })}
          </div>

          {/* ============================================================= */}
          {/* VELOCITY & ACTIVITY */}
          {/* ============================================================= */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 28 }}>
            {/* Pipeline Velocity */}
            <div
              style={{
                background: WHITE,
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                padding: 24,
                flex: "1 1 320px",
                minWidth: 280,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Clock size={16} color={RED} />
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Pipeline Velocity</div>
              </div>
              {Object.keys(pipeline.velocity.avgDaysByStage).length > 0 ? (
                <div>
                  {Object.entries(pipeline.velocity.avgDaysByStage)
                    .sort(([, a], [, b]) => b - a)
                    .map(([stage, days]) => (
                      <div
                        key={stage}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "8px 0",
                          borderBottom: `1px solid ${LIGHT_NAVY}`,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: stageColor(stage) }} />
                          <span style={{ fontSize: 12, color: NAVY, fontWeight: 500 }}>{stage}</span>
                        </div>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: days > 14 ? RED : days > 7 ? GOLD : NAVY,
                          }}
                        >
                          {days}d
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: MUTED, textAlign: "center" as const, padding: 20 }}>
                  No velocity data yet
                </div>
              )}
            </div>

            {/* Weekly Trend */}
            <div
              style={{
                background: WHITE,
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                padding: 24,
                flex: "1 1 280px",
                minWidth: 240,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <TrendingUp size={16} color={RED} />
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>7-Day Trend</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
                {[
                  { label: "New Leads", value: pipeline.weeklyTrend.newLeads, color: "#3b82f6", icon: "+" },
                  { label: "Stage Advances", value: pipeline.weeklyTrend.stageAdvances, color: GOLD, icon: "\u2192" },
                  { label: "Closed Won", value: pipeline.weeklyTrend.closedWon, color: "#16a34a", icon: "\u2713" },
                  { label: "Closed Lost", value: pipeline.weeklyTrend.closedLost, color: RED, icon: "\u2717" },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 14px",
                      background: `${item.color}08`,
                      borderRadius: 8,
                      border: `1px solid ${item.color}20`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: item.color, width: 20, textAlign: "center" as const }}>
                        {item.icon}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: NAVY }}>{item.label}</span>
                    </div>
                    <span style={{ fontSize: 20, fontWeight: 800, color: item.color }}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ============================================================= */}
          {/* RECENT ACTIVITY FEED */}
          {/* ============================================================= */}
          {pipeline.recentActivity.length > 0 && (
            <>
              <SectionTitle icon={Activity}>Recent Activity</SectionTitle>
              <div
                style={{
                  background: WHITE,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  padding: "16px 20px",
                  marginBottom: 28,
                  maxHeight: 360,
                  overflowY: "auto" as const,
                }}
              >
                {pipeline.recentActivity.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "10px 0",
                      borderBottom: i < pipeline.recentActivity.length - 1 ? `1px solid ${LIGHT_NAVY}` : "none",
                      alignItems: "flex-start",
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: stageColor(item.event),
                        marginTop: 5,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{item.lead}</span>
                        <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap" as const }}>{item.date}</span>
                      </div>
                      <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>
                        <span style={{ fontWeight: 600, color: stageColor(item.event) }}>{item.event}</span>
                        {item.details && item.details !== `${(pipeline.stages[item.event]?.[0]?.type) || "b2b"} lead` && (
                          <span> &mdash; {item.details}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : null}

      {/* ================================================================= */}
      {/* 1. DISTRIBUTOR NETWORK DASHBOARD (Plan) */}
      {/* ================================================================= */}
      <SectionTitle icon={Truck}>Distributor Network Plan</SectionTitle>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        <MetricCard
          label="Target Distributors"
          value={String(totalDistributors)}
          sub="By end of Q1 2027"
          accent={NAVY}
        />
        <MetricCard
          label="Confirmed"
          value={String(confirmed)}
          sub="Brent Inderbitzin \u2014 May start"
          accent="#16a34a"
        />
        <MetricCard
          label="Annual Dist. Units"
          value={fmtUnits(distributorUnits)}
          sub={`${fmtDollar(distributorRevenue)} revenue`}
          accent={RED}
        />
        <MetricCard
          label="Wholesale Price"
          value={`$${UNIT_ECONOMICS.distributor.sellPrice.toFixed(2)}`}
          sub={`$${UNIT_ECONOMICS.distributor.gpPerUnit.toFixed(2)} GP/unit`}
          accent={GOLD}
        />
      </div>

      {/* Distributor Ramp Chart */}
      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "20px 20px 10px",
          marginBottom: 28,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
          Distributor Network Growth
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
          Monthly units through distribution channel + cumulative distributor count
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
            <YAxis yAxisId="units" tick={{ fontSize: 11, fill: MUTED }} tickFormatter={(v: number) => fmtUnits(v)} />
            <YAxis yAxisId="dist" orientation="right" domain={[0, 5]} tick={{ fontSize: 11, fill: MUTED }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar yAxisId="units" dataKey="units" name="Distributor Units" fill={NAVY} radius={[4, 4, 0, 0]} opacity={0.8}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.units > 0 ? NAVY : "rgba(27,42,74,0.15)"} />
              ))}
            </Bar>
            <Line
              yAxisId="dist"
              type="stepAfter"
              dataKey="cumulative"
              name="Total Distributors"
              stroke={RED}
              strokeWidth={3}
              dot={{ r: 5, fill: RED, stroke: WHITE, strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ================================================================= */}
      {/* 2. NETWORK RAMP TABLE */}
      {/* ================================================================= */}
      <SectionTitle icon={BarChart3}>Network Ramp Schedule</SectionTitle>

      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 28,
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: NAVY }}>
                {["Month", "New Dist.", "Cumulative", "Units/Dist.", "Total Units", "Revenue"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "12px 14px",
                      textAlign: h === "Month" ? "left" : "right",
                      color: WHITE,
                      fontWeight: 600,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {networkData.map((row, i) => {
                const isInflection = row.newDistributors > 0;
                return (
                  <tr
                    key={row.month}
                    style={{
                      background: isInflection ? `${RED}08` : i % 2 === 0 ? "transparent" : LIGHT_NAVY,
                      borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 14px",
                        fontWeight: isInflection ? 700 : 500,
                        color: NAVY,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isInflection && (
                        <span style={{ color: RED, marginRight: 6, fontSize: 10 }}>&#9679;</span>
                      )}
                      {MONTH_FULL_LABELS[row.monthKey]}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: isInflection ? 700 : 400, color: isInflection ? RED : NAVY }}>
                      {row.newDistributors > 0 ? `+${row.newDistributors}` : "\u2014"}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: NAVY }}>
                      {row.cumulativeDistributors}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", color: MUTED }}>
                      {row.unitsPerDistributor > 0 ? fmtUnits(row.unitsPerDistributor) : "\u2014"}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: NAVY }}>
                      {row.totalDistributorUnits > 0 ? fmtUnits(row.totalDistributorUnits) : "\u2014"}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: NAVY }}>
                      {row.distributorRevenue > 0 ? fmtDollar(row.distributorRevenue) : "\u2014"}
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr style={{ background: NAVY }}>
                <td style={{ padding: "12px 14px", fontWeight: 700, color: WHITE }}>TOTAL (2026)</td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: GOLD }}>
                  {DISTRIBUTOR_NETWORK.filter((d) => MONTHS.includes(d.startMonth as Month)).length}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: GOLD }}>\u2014</td>
                <td style={{ padding: "12px 14px", textAlign: "right", color: "rgba(255,255,255,0.5)" }}>\u2014</td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: GOLD }}>
                  {fmtUnits(distributorUnits)}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 700, color: GOLD }}>
                  {fmtDollar(distributorRevenue)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 3. B2B PIPELINE FUNNEL (Plan) */}
      {/* ================================================================= */}
      <SectionTitle icon={Target}>B2B Pipeline Funnel (Plan)</SectionTitle>

      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>
          Distributor acquisition funnel &mdash; target {totalDistributors} distribution partners by Q1 2027
        </div>

        <FunnelBar
          label="Prospects Identified"
          value={totalNewNeeded}
          maxValue={totalNewNeeded}
          color={NAVY}
          sub="Total distribution partners in plan"
        />
        <FunnelBar
          label="In Contact / Prospecting"
          value={confirmed + prospecting}
          maxValue={totalNewNeeded}
          color="#2563eb"
          sub="Active conversations and outreach"
        />
        <FunnelBar
          label="Sampling / Evaluation"
          value={confirmed + prospecting}
          maxValue={totalNewNeeded}
          color={GOLD}
          sub="Product samples sent, terms under review"
        />
        <FunnelBar
          label="Committed"
          value={confirmed}
          maxValue={totalNewNeeded}
          color="#16a34a"
          sub="Signed or verbally committed"
        />
        <FunnelBar
          label="Active & Ordering"
          value={0}
          maxValue={totalNewNeeded}
          color={RED}
          sub="First orders ship May 2026"
        />

        {/* Distributor detail cards */}
        <div style={{ marginTop: 24, borderTop: `1px solid ${BORDER}`, paddingTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 14 }}>Distributor Partners</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {DISTRIBUTOR_NETWORK.map((d) => {
              const statusColor =
                d.status === "confirmed" ? "#16a34a" : d.status === "prospecting" ? "#2563eb" : MUTED;
              return (
                <div
                  key={d.id}
                  style={{
                    background: CREAM,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 10,
                    padding: "14px 18px",
                    flex: "1 1 200px",
                    minWidth: 180,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Truck size={16} color={statusColor} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{d.name}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: MUTED }}>Start</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>
                      {typeof d.startMonth === "string" && MONTH_FULL_LABELS[d.startMonth as Month]
                        ? MONTH_FULL_LABELS[d.startMonth as Month]
                        : d.startMonth}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: MUTED }}>Territory</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>{d.territory}</span>
                  </div>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 11,
                      fontWeight: 600,
                      color: statusColor,
                      background: `${statusColor}12`,
                      padding: "3px 10px",
                      borderRadius: 12,
                      textTransform: "capitalize",
                      marginTop: 4,
                    }}
                  >
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor }} />
                    {d.status}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* 4. CHANNEL TERRITORY MAP */}
      {/* ================================================================= */}
      <SectionTitle icon={Globe}>Channel Territory Map</SectionTitle>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 28 }}>
        <TerritoryCard
          title="Amazon Territory"
          icon={ShoppingBag}
          description="Direct-to-Consumer via Amazon FBA"
          annualUnits={amazonUnits}
          annualRevenue={amazonRevenue}
          status="Active \u2014 Launched"
          statusColor="#16a34a"
          metrics={[
            { label: "Retail Price", value: `$${UNIT_ECONOMICS.amazon.retailPrice}` },
            { label: "FBA Fees/Unit", value: `$${UNIT_ECONOMICS.amazon.fbaFees}` },
            { label: "GP/Unit", value: `$${UNIT_ECONOMICS.amazon.gpPerUnit.toFixed(2)}` },
            { label: "Target ACoS", value: "< 30%" },
          ]}
        />
        <TerritoryCard
          title="Wholesale Territory"
          icon={Store}
          description="B2B via Faire + Direct Wholesale"
          annualUnits={wholesaleUnits}
          annualRevenue={wholesaleRevenue}
          status="Active \u2014 Growing"
          statusColor="#2563eb"
          metrics={[
            { label: "Wholesale Price", value: `$${UNIT_ECONOMICS.wholesale.price}` },
            { label: "GP/Unit", value: `$${UNIT_ECONOMICS.wholesale.gpPerUnit.toFixed(2)}` },
            { label: "Account Target", value: "50+ retailers" },
            { label: "Reorder Rate Target", value: "> 60%" },
          ]}
        />
        <TerritoryCard
          title="Distributor Territory"
          icon={Truck}
          description="Regional Distribution Network"
          annualUnits={distributorUnits}
          annualRevenue={distributorRevenue}
          status="Building \u2014 Ramp Phase"
          statusColor={GOLD}
          metrics={[
            { label: "Sell Price", value: `$${UNIT_ECONOMICS.distributor.sellPrice}` },
            { label: "GP/Unit", value: `$${UNIT_ECONOMICS.distributor.gpPerUnit.toFixed(2)}` },
            { label: "Distributor Count", value: `${totalDistributors} planned` },
            { label: "Units/Dist./Mo", value: "1.5K\u20136K ramp" },
          ]}
        />
      </div>

      {/* Channel Revenue Comparison Chart */}
      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "20px 20px 10px",
          marginBottom: 28,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
          Revenue by Channel &mdash; Monthly Plan
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
          Stacked view showing Amazon, Wholesale, and Distributor revenue targets
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={MONTHS.map((m) => ({
              month: MONTH_LABELS[m],
              Amazon: AMAZON.revenue[m],
              Wholesale: WHOLESALE.revenue[m],
              Distributor: DISTRIBUTOR.revenue[m],
            }))}
            margin={{ top: 5, right: 20, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
            <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={(v: number) => fmt(v)} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="Amazon" name="Amazon Revenue" stackId="rev" fill={GOLD} radius={[0, 0, 0, 0]} />
            <Bar dataKey="Wholesale" name="Wholesale Revenue" stackId="rev" fill="#2563eb" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Distributor" name="Distributor Revenue" stackId="rev" fill={RED} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 20, justifyContent: "center", padding: "10px 0 6px" }}>
          {[
            { label: "Amazon", color: GOLD },
            { label: "Wholesale", color: "#2563eb" },
            { label: "Distributor", color: RED },
          ].map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
              <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ================================================================= */}
      {/* 5. MONTHLY PIPELINE ACTIVITY TIMELINE */}
      {/* ================================================================= */}
      <SectionTitle icon={Calendar}>Monthly Pipeline Activity</SectionTitle>

      <div
        style={{
          background: WHITE,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>
          Key milestones and distributor ramp events across the plan period
        </div>

        <div style={{ position: "relative" as const, paddingLeft: 32 }}>
          {/* Vertical timeline line */}
          <div
            style={{
              position: "absolute" as const,
              left: 11,
              top: 0,
              bottom: 0,
              width: 2,
              background: BORDER,
            }}
          />

          {MONTHS.map((m, idx) => {
            const monthDistributors = DISTRIBUTOR_NETWORK.filter((d) => d.startMonth === m);
            const monthMilestones = pipelineMilestones.filter((ms) => ms.targetMonth === m);
            const hasActivity = monthDistributors.length > 0 || monthMilestones.length > 0;
            const distUnits = DISTRIBUTOR.units[m];
            const totalRev = AMAZON.revenue[m] + WHOLESALE.revenue[m] + DISTRIBUTOR.revenue[m];

            return (
              <div
                key={m}
                style={{
                  position: "relative" as const,
                  marginBottom: idx < MONTHS.length - 1 ? 20 : 0,
                  paddingBottom: idx < MONTHS.length - 1 ? 20 : 0,
                  borderBottom: idx < MONTHS.length - 1 ? `1px solid ${LIGHT_NAVY}` : "none",
                }}
              >
                {/* Timeline dot */}
                <div
                  style={{
                    position: "absolute" as const,
                    left: -27,
                    top: 2,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: hasActivity ? RED : BORDER,
                    border: `3px solid ${WHITE}`,
                    boxShadow: hasActivity ? `0 0 0 3px ${RED}30` : "none",
                  }}
                />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
                      {MONTH_FULL_LABELS[m]} 2026
                    </div>

                    {monthDistributors.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <Truck size={13} color={RED} />
                        <span style={{ fontSize: 12, color: RED, fontWeight: 600 }}>
                          {monthDistributors.map((d) => d.name).join(", ")} goes live
                        </span>
                      </div>
                    )}

                    {monthMilestones.map((ms) => (
                      <div key={ms.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <CheckCircle2 size={13} color="#16a34a" />
                        <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>{ms.label}</span>
                      </div>
                    ))}

                    {!hasActivity && (
                      <div style={{ fontSize: 12, color: MUTED }}>Standard operations</div>
                    )}
                  </div>

                  <div style={{ textAlign: "right" as const }}>
                    <div style={{ fontSize: 11, color: MUTED }}>Total Revenue</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: NAVY }}>{fmtDollar(totalRev)}</div>
                    {distUnits > 0 && (
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                        {fmtUnits(distUnits)} dist. units
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ================================================================= */}
      {/* ANNUAL SUMMARY FOOTER */}
      {/* ================================================================= */}
      <div
        style={{
          background: NAVY,
          borderRadius: 12,
          padding: "20px 24px",
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            2026 Total Units
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: GOLD }}>{fmtUnits(ANNUAL_SUMMARY.totalUnits)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            2026 Total Revenue
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: GOLD }}>{fmtDollar(ANNUAL_SUMMARY.totalRevenue)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            Blended Gross Margin
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: WHITE }}>{(ANNUAL_SUMMARY.blendedGrossMargin * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
            Distribution Partners
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: WHITE }}>{totalDistributors} Planned</div>
        </div>
        {pipeline && (
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>
              Live Pipeline
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#16a34a" }}>
              {warRoomFmt(pipeline.totalLeads)} Leads
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
