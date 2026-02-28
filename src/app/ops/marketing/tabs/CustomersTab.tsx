"use client";

import { AlertTriangle, Repeat, Users, Wallet, ShoppingBag } from "lucide-react";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCustomersData, fmtDollar, fmtPercent } from "@/lib/ops/use-war-room-data";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { SkeletonChart, SkeletonTable } from "@/app/ops/components/Skeleton";
import { CohortHeatmap } from "@/app/ops/marketing/components/CohortHeatmap";
import {
  NAVY,
  RED,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

function repeatColor(ratePct: number): string {
  if (ratePct > 20) return "#16a34a";
  if (ratePct >= 10) return GOLD;
  return RED;
}

function MetricCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ color: NAVY }}>{icon}</span>
        <span
          style={{
            fontSize: 11,
            color: TEXT_DIM,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: NAVY }}>{value}</div>
      {sub ? <div style={{ marginTop: 4, fontSize: 12, color: TEXT_DIM }}>{sub}</div> : null}
    </div>
  );
}

export function CustomersTab() {
  const { data, loading, error, refresh } = useCustomersData();

  const repeatRate = data?.summary.repeatRate || 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, color: NAVY, fontWeight: 800, letterSpacing: "-0.01em" }}>Customers</div>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            LTV, retention cohorts, purchase frequency, and geographic concentration.
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={[{ label: "Customers", timestamp: data?.generatedAt }]} />
          </div>
        </div>
        <RefreshButton onClick={refresh} loading={loading} />
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <MetricCard label="Total Customers" value={String(data?.summary.totalCustomers || 0)} icon={<Users size={16} />} />
        <MetricCard
          label="Repeat Rate"
          value={fmtPercent(repeatRate / 100)}
          icon={<Repeat size={16} />}
          sub={
            repeatRate > 20
              ? "Strong repeat behavior"
              : repeatRate >= 10
                ? "Moderate repeat behavior"
                : "Low repeat behavior"
          }
        />
        <MetricCard label="Avg LTV" value={fmtDollar(data?.summary.avgLtv || 0)} icon={<Wallet size={16} />} />
        <MetricCard label="AOV (90d)" value={fmtDollar(data?.summary.aov || 0)} icon={<ShoppingBag size={16} />} />
      </div>

      <div style={{ marginBottom: 12, fontSize: 12, color: repeatColor(repeatRate), fontWeight: 700 }}>
        Repeat rate signal: {repeatRate.toFixed(1)}%
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>LTV Distribution</div>
          {loading && (data?.ltvDistribution || []).length === 0 ? (
            <SkeletonChart height={240} />
          ) : (
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={data?.ltvDistribution || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                  <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                  <Tooltip />
                  <Bar dataKey="count" fill={NAVY} radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Order Frequency</div>
          {loading && (data?.orderFrequency || []).length === 0 ? (
            <SkeletonChart height={240} />
          ) : (
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={data?.orderFrequency || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                  <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                  <Tooltip />
                  <Bar dataKey="count" fill={GOLD} radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <CohortHeatmap
          months={data?.cohortRetention.months || []}
          rows={data?.cohortRetention.rows || []}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Top 10 Customers</div>
          {loading && (data?.topCustomers || []).length === 0 ? (
            <SkeletonTable rows={8} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Customer</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Orders</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>LTV</th>
                    <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>AOV</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.topCustomers || []).map((customer) => (
                    <tr key={customer.id}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 700 }}>
                        {customer.name}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>
                        {customer.ordersCount}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>
                        {fmtDollar(customer.totalSpent)}
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: TEXT_DIM }}>
                        {fmtDollar(customer.avgOrderValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Top US States</div>
          {(data?.geography || []).length === 0 ? (
            <div style={{ fontSize: 13, color: TEXT_DIM }}>No state distribution data yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {(data?.geography || []).map((row) => (
                <div key={row.state}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: NAVY, fontWeight: 700 }}>{row.state}</span>
                    <span style={{ color: TEXT_DIM }}>{row.count} ({row.pct.toFixed(1)}%)</span>
                  </div>
                  <div style={{ height: 10, background: "rgba(27,42,74,0.08)", borderRadius: 999, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.max(3, Math.min(100, row.pct))}%`,
                        height: "100%",
                        background: NAVY,
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
