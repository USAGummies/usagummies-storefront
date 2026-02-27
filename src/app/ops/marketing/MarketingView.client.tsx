"use client";

import { AlertTriangle, Users, MousePointerClick, Funnel } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { useMarketingData, fmtPercent } from "@/lib/ops/use-war-room-data";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonChart } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

function MetricCard({ label, value, icon, sub }: { label: string; value: string; icon: React.ReactNode; sub?: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ color: NAVY }}>{icon}</span>
        <span style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: NAVY }}>{value}</div>
      {sub ? <div style={{ marginTop: 4, fontSize: 12, color: TEXT_DIM }}>{sub}</div> : null}
    </div>
  );
}

export function MarketingView() {
  const { data, loading, error, refresh } = useMarketingData();

  const funnel = data?.funnel;
  const freshnessItems = [{ label: "Marketing", timestamp: data?.generatedAt }];

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>Marketing & ROAS</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            GA4 traffic, conversion funnel, top pages, and budget-ready ad channels.
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
        <MetricCard label="Sessions" value={String(data?.overview.sessions || 0)} icon={<Users size={16} />} />
        <MetricCard label="Users" value={String(data?.overview.users || 0)} icon={<Users size={16} />} />
        <MetricCard
          label="Conversion Rate"
          value={fmtPercent((funnel?.conversionRate || 0) / 100)}
          icon={<MousePointerClick size={16} />}
          sub="Purchases / Sessions"
        />
        <MetricCard
          label="Cart to Purchase"
          value={fmtPercent((funnel?.cartToCheckoutRate || 0) / 100)}
          icon={<Funnel size={16} />}
          sub="Purchases / Add-to-cart"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Daily Traffic (30d)</div>
          {loading && (data?.dailyTraffic || []).length === 0 ? (
            <SkeletonChart height={260} />
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={data?.dailyTraffic || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                  <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="sessions" stroke={NAVY} strokeWidth={2.2} dot={false} name="Sessions" />
                  <Line type="monotone" dataKey="users" stroke={GOLD} strokeWidth={2.2} dot={false} name="Users" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Funnel Snapshot</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Sessions</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{funnel?.sessions || 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Add to cart</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{funnel?.addToCart || 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: TEXT_DIM }}>Purchases</span>
              <span style={{ color: NAVY, fontWeight: 700 }}>{funnel?.purchases || 0}</span>
            </div>
            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: TEXT_DIM }}>Bounce rate</span>
                <span style={{ color: NAVY, fontWeight: 700 }}>{(data?.overview.bounceRate || 0).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Top Sources</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Source / Medium</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Sessions</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {(data?.sources || []).slice(0, 12).map((row) => (
                  <tr key={`${row.source}-${row.medium}`}>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 600 }}>
                      {row.source} / {row.medium}
                    </td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>{row.sessions}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: TEXT_DIM }}>{row.pctOfTotal.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Top Landing Pages</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Page</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Views</th>
                </tr>
              </thead>
              <tbody>
                {(data?.topPages || []).slice(0, 12).map((page) => (
                  <tr key={`${page.path}-${page.title}`}>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 600 }}>
                      {page.title || page.path}
                    </td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>
                      {page.pageviews}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Ad Channels (Budget-ready)</div>
        {(data?.adChannels || []).length === 0 ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>
            Ad accounts are not connected yet. Budget fields are present and remain `null` until funding and channel setup.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {(data?.adChannels || []).map((channel) => (
              <div key={channel.channel} style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>{channel.channel}</div>
                  <div style={{ color: TEXT_DIM, fontSize: 12 }}>ROAS {channel.roas.toFixed(2)} • CTR {channel.ctr.toFixed(2)}%</div>
                </div>
                <div style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>${channel.spend.toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? <div style={{ marginTop: 10, fontSize: 12, color: TEXT_DIM }}>Loading marketing metrics...</div> : null}
    </div>
  );
}
