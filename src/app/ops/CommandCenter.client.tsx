"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonTable } from "@/app/ops/components/Skeleton";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { useIsMobile } from "@/app/ops/hooks";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

type PulseData = {
  revenue: { shopify: number; amazon: number; total: number; vs7d: number };
  orders: { shopify: number; amazon: number; total: number; vs7d: number };
  sessions: { value: number; vs7d: number };
  aov: { value: number; vs7d: number };
  date: string;
};

type SignalItem = {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  source: string;
  created_at: string;
};

type ApprovalItem = {
  id: string;
  summary: string;
  requested_at: string;
  action_type: string;
};

type HealthResponse = {
  integrations: Array<{
    system_name: string;
    connection_status: "connected" | "expired" | "error" | "not_configured";
  }>;
  last_checked: string;
};

type FeedHealthResponse = {
  feeds: Array<{
    feed_key: string;
    is_active: boolean;
    last_run_at: string | null;
    last_status: string | null;
    consecutive_failures: number;
  }>;
  summary: {
    total_feeds: number;
    active: number;
    disabled: number;
    unresolved_dead_letters: number;
  };
};

function fmtDollar(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function fmtPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function metricDeltaColor(value: number): string {
  if (value > 0) return "#16a34a";
  if (value < 0) return RED;
  return TEXT_DIM;
}

function severityDot(severity: SignalItem["severity"]): string {
  if (severity === "critical") return "🔴";
  if (severity === "warning") return "🟡";
  return "🔵";
}

function integrationIcon(status: string) {
  if (status === "connected") return <CheckCircle2 size={14} color="#16a34a" />;
  if (status === "error") return <XCircle size={14} color={RED} />;
  return <AlertTriangle size={14} color={GOLD} />;
}

function MetricCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: TEXT_DIM,
          textTransform: "uppercase",
          fontWeight: 700,
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 30, color: NAVY, fontWeight: 800 }}>
        {value}
      </div>
      <div
        style={{
          marginTop: 6,
          color: metricDeltaColor(delta),
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {fmtPct(delta)} vs 7d
      </div>
    </div>
  );
}

export function CommandCenter() {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [signals, setSignals] = useState<SignalItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [feedHealth, setFeedHealth] = useState<FeedHealthResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pulseRes, signalsRes, approvalsRes, healthRes, feedRes] = await Promise.all([
        fetch("/api/ops/abra/pulse", { cache: "no-store" }),
        fetch("/api/ops/abra/operational-signals?limit=5", { cache: "no-store" }),
        fetch("/api/ops/abra/approvals?status=pending", { cache: "no-store" }),
        fetch("/api/ops/abra/health", { cache: "no-store" }),
        fetch("/api/ops/abra/feed-health", { cache: "no-store" }),
      ]);

      if (!pulseRes.ok) throw new Error("Failed to load pulse");
      if (!signalsRes.ok) throw new Error("Failed to load signals");
      if (!approvalsRes.ok) throw new Error("Failed to load approvals");
      if (!healthRes.ok) throw new Error("Failed to load system health");
      if (!feedRes.ok) throw new Error("Failed to load feed health");

      const pulseData = (await pulseRes.json()) as PulseData;
      const signalsData = (await signalsRes.json()) as { signals: SignalItem[] };
      const approvalsData = (await approvalsRes.json()) as { approvals: ApprovalItem[] };
      const healthData = (await healthRes.json()) as HealthResponse;
      const feedData = (await feedRes.json()) as FeedHealthResponse;

      setPulse(pulseData);
      setSignals(Array.isArray(signalsData.signals) ? signalsData.signals : []);
      setApprovals(Array.isArray(approvalsData.approvals) ? approvalsData.approvals : []);
      setHealth(healthData);
      setFeedHealth(feedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load command center");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const freshnessItems = useMemo(() => {
    return [
      { label: "Pulse", timestamp: pulse?.date || null },
      { label: "Health", timestamp: health?.last_checked || null },
    ];
  }, [pulse?.date, health?.last_checked]);

  const pageDate = useMemo(() => {
    const date = pulse?.date ? new Date(`${pulse.date}T00:00:00`) : new Date();
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [pulse?.date]);

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>
            Today&apos;s Pulse
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>{pageDate}</div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>
        <RefreshButton loading={loading} onClick={() => void load()} />
      </div>

      {error ? (
        <div
          style={{
            border: `1px solid ${RED}44`,
            background: `${RED}12`,
            color: RED,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 700,
          }}
        >
          <AlertTriangle size={15} />
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "repeat(2, minmax(0, 1fr))"
            : "repeat(4, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        {loading && !pulse ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <SkeletonTable rows={3} />
          </div>
        ) : (
          <>
            <MetricCard label="Revenue" value={fmtDollar(pulse?.revenue.total || 0)} delta={pulse?.revenue.vs7d || 0} />
            <MetricCard label="Orders" value={(pulse?.orders.total || 0).toLocaleString("en-US")} delta={pulse?.orders.vs7d || 0} />
            <MetricCard label="Sessions" value={(pulse?.sessions.value || 0).toLocaleString("en-US")} delta={pulse?.sessions.vs7d || 0} />
            <MetricCard label="AOV" value={fmtDollar(pulse?.aov.value || 0)} delta={pulse?.aov.vs7d || 0} />
          </>
        )}
      </div>

      <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
        <section
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div style={{ fontSize: 14, color: NAVY, fontWeight: 800, marginBottom: 10 }}>
            Active Signals ({signals.length})
          </div>
          {signals.length === 0 ? (
            <div style={{ color: TEXT_DIM, fontSize: 13 }}>No active signals.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {signals.map((signal) => (
                <div key={signal.id} style={{ fontSize: 13, color: NAVY, lineHeight: 1.45 }}>
                  <span style={{ marginRight: 6 }}>{severityDot(signal.severity)}</span>
                  <strong>{signal.title}</strong>
                  {signal.detail ? <span style={{ color: TEXT_DIM }}> — {signal.detail}</span> : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div style={{ fontSize: 14, color: NAVY, fontWeight: 800, marginBottom: 10 }}>
            Pending Actions ({approvals.length})
          </div>
          {approvals.length === 0 ? (
            <div style={{ color: TEXT_DIM, fontSize: 13 }}>No pending approvals.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {approvals.slice(0, 5).map((approval) => (
                <div key={approval.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <Clock3 size={14} color={GOLD} style={{ marginTop: 2 }} />
                  <div style={{ fontSize: 13, color: NAVY, lineHeight: 1.45 }}>
                    <div style={{ fontWeight: 700 }}>{approval.summary || approval.action_type}</div>
                    <div style={{ color: TEXT_DIM, fontSize: 12 }}>
                      {new Date(approval.requested_at).toLocaleString("en-US")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: 12,
        }}
      >
        <section
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div style={{ fontSize: 14, color: NAVY, fontWeight: 800, marginBottom: 10 }}>
            System Health
          </div>
          {health?.integrations?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {health.integrations.slice(0, 8).map((integration) => (
                <div
                  key={integration.system_name}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                >
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {integrationIcon(integration.connection_status)}
                    <span style={{ color: NAVY, fontSize: 13 }}>{integration.system_name}</span>
                  </div>
                  <span style={{ color: TEXT_DIM, fontSize: 12 }}>{integration.connection_status}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: TEXT_DIM, fontSize: 13 }}>No integration health data.</div>
          )}
        </section>

        <section
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div style={{ fontSize: 14, color: NAVY, fontWeight: 800, marginBottom: 10 }}>
            Feed Status
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: NAVY, fontWeight: 700, fontSize: 13 }}>
              <RefreshCw size={14} color={GOLD} />
              {feedHealth?.summary?.active || 0}/{feedHealth?.summary?.total_feeds || 0} feeds active
            </div>
            <div style={{ color: TEXT_DIM, fontSize: 12 }}>
              Disabled: {feedHealth?.summary?.disabled || 0} · Dead letters: {feedHealth?.summary?.unresolved_dead_letters || 0}
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              {(feedHealth?.feeds || []).slice(0, 5).map((feed) => (
                <div key={feed.feed_key} style={{ fontSize: 12, color: NAVY, display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>
                    {feed.is_active ? "✅" : "⚪"} {feed.feed_key}
                  </span>
                  <span style={{ color: TEXT_DIM }}>
                    {feed.last_run_at ? new Date(feed.last_run_at).toLocaleTimeString("en-US") : "never"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
