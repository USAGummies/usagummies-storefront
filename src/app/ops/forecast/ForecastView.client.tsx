"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Wallet, Flame, CalendarClock, AlertTriangle, Timer } from "lucide-react";
import { useForecastData, fmtDollar } from "@/lib/ops/use-war-room-data";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonChart, SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

type Receivable = {
  source: string;
  amount: number;
  expectedDate: string;
  confidence: string;
  description: string;
};

type Payable = {
  category: string;
  amount: number;
  dueDate: string;
  recurring: boolean;
  description: string;
};

type ProjectionPoint = {
  date: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  closingBalance: number;
  receivables?: Receivable[];
  payables?: Payable[];
};

function HeaderCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "14px 14px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ color: NAVY }}>{icon}</span>
        <span
          style={{
            fontSize: 11,
            color: TEXT_DIM,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 700,
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: NAVY }}>{value}</div>
      {hint ? <div style={{ marginTop: 4, fontSize: 12, color: TEXT_DIM }}>{hint}</div> : null}
    </div>
  );
}

export function ForecastView() {
  const { data: forecast, loading, error, refresh } = useForecastData();

  const points = (forecast?.projections?.["90d"] || []) as unknown as ProjectionPoint[];
  const points30 = (forecast?.projections?.["30d"] || []) as unknown as ProjectionPoint[];

  const monthlyBurn = useMemo(() => {
    if (points30.length === 0) return 0;
    const totalOut = points30.reduce((sum, row) => sum + row.outflows, 0);
    const totalIn = points30.reduce((sum, row) => sum + row.inflows, 0);
    return totalOut - totalIn;
  }, [points30]);

  const receivables = useMemo(() => {
    return points
      .flatMap((row) => row.receivables || [])
      .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))
      .slice(0, 20);
  }, [points]);

  const payables = useMemo(() => {
    return points
      .flatMap((row) => row.payables || [])
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 20);
  }, [points]);

  const nextSettlementDate = useMemo(() => {
    const settlements = receivables
      .filter((r) => r.source === "amazon_settlement" || r.source === "shopify_payout")
      .map((r) => r.expectedDate)
      .sort((a, b) => a.localeCompare(b));
    return settlements[0] || null;
  }, [receivables]);

  const chartRows = points.map((row) => {
    const optimistic = row.closingBalance + row.inflows * 0.15;
    const pessimistic = row.closingBalance - row.outflows * 0.15;
    return {
      date: row.date.slice(5),
      base: row.closingBalance,
      optimistic,
      pessimistic,
    };
  });

  const freshnessItems = [{ label: "Forecast", timestamp: forecast?.generatedAt }];

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>Cash Forecast</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            90-day cash projection with receivables, payables, and runway risk alerts.
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>
        <RefreshButton loading={loading} onClick={() => refresh()} />
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

      {/* Awaiting data banner — Plaid not connected */}
      {!loading && !forecast?.currentBalance && points.length === 0 ? (
        <div
          style={{
            border: `1px solid ${GOLD}55`,
            background: `${GOLD}12`,
            color: NAVY,
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 12,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <strong>Awaiting Data — Plaid API pending.</strong> Cash forecast requires bank account
          connectivity via Plaid. Current balance, runway, burn rate, receivables, and payables will
          populate once Plaid is integrated. All figures below will show $0 until then.
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <HeaderCard
          icon={<Wallet size={16} />}
          label="Current Cash"
          value={fmtDollar(forecast?.currentBalance || 0)}
        />
        <HeaderCard
          icon={<Timer size={16} />}
          label="Runway"
          value={`${forecast?.runway || 0} days`}
          hint="Projected days until cash floor"
        />
        <HeaderCard
          icon={<Flame size={16} />}
          label="Monthly Burn"
          value={fmtDollar(monthlyBurn)}
          hint="30-day net outflow projection"
        />
        <HeaderCard
          icon={<CalendarClock size={16} />}
          label="Next Settlement"
          value={nextSettlementDate ? new Date(nextSettlementDate).toLocaleDateString("en-US") : "N/A"}
        />
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>90-Day Cash Projection</div>
        {loading && chartRows.length === 0 ? (
          <SkeletonChart height={280} />
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={chartRows}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <Tooltip formatter={(v: number | string | undefined) => fmtDollar(Number(v || 0))} />
                <Line type="monotone" dataKey="base" stroke={NAVY} strokeWidth={2.2} dot={false} name="Base" />
                <Line type="monotone" dataKey="optimistic" stroke="#16a34a" strokeWidth={1.8} dot={false} strokeDasharray="5 3" name="Optimistic" />
                <Line type="monotone" dataKey="pessimistic" stroke={RED} strokeWidth={1.8} dot={false} strokeDasharray="5 3" name="Pessimistic" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Receivables</div>
          {loading && receivables.length === 0 ? (
            <SkeletonTable rows={6} />
          ) : receivables.length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>No receivables in forecast horizon.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Source</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Amount</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Date</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.map((row, idx) => (
                    <tr key={`${row.source}-${row.expectedDate}-${idx}`}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", color: NAVY, fontSize: 13, fontWeight: 700 }}>
                        {row.source.replace(/_/g, " ")}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", textAlign: "right", color: NAVY, fontWeight: 700 }}>
                        {fmtDollar(row.amount)}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", color: TEXT_DIM, fontSize: 12 }}>
                        {new Date(row.expectedDate).toLocaleDateString("en-US")}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: TEXT_DIM, fontSize: 12 }}>
                        {row.confidence}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Payables</div>
          {loading && payables.length === 0 ? (
            <SkeletonTable rows={6} />
          ) : payables.length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>No payables in forecast horizon.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Category</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Amount</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8, paddingRight: 12 }}>Due Date</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Recurring</th>
                  </tr>
                </thead>
                <tbody>
                  {payables.map((row, idx) => (
                    <tr key={`${row.category}-${row.dueDate}-${idx}`}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", color: NAVY, fontSize: 13, fontWeight: 700 }}>
                        {row.category}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", textAlign: "right", color: NAVY, fontWeight: 700 }}>
                        {fmtDollar(row.amount)}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 12px 8px 0", color: TEXT_DIM, fontSize: 12 }}>
                        {new Date(row.dueDate).toLocaleDateString("en-US")}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: TEXT_DIM, fontSize: 12 }}>
                        {row.recurring ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Forecast Alerts</div>
        {(forecast?.alerts || []).length === 0 ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>
            {loading ? "Loading forecast alerts..." : "No forecast alerts right now."}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {(forecast?.alerts || []).map((alert, idx) => (
              <div key={`${idx}-${alert}`} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, display: "flex", gap: 8 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 99,
                    marginTop: 5,
                    background: /runway|negative|below/i.test(alert) ? RED : GOLD,
                  }}
                />
                <div style={{ color: NAVY, fontSize: 13, fontWeight: 600 }}>{alert}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
