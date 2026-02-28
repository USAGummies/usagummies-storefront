"use client";

import { useState } from "react";
import { DollarSign, RefreshCw, CheckCircle, XCircle, Clock } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { useAdsData, fmtDollar } from "@/lib/ops/use-war-room-data";
import type { AdsData } from "@/lib/ops/use-war-room-data";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonChart, SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

async function mutate(payload: Record<string, unknown>) {
  const res = await fetch("/api/ops/marketing/ads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Action failed (${res.status})`);
  return json;
}

const PLATFORM_COLORS: Record<string, string> = {
  rumble: "#85bb65",
  meta: "#1877F2",
  google: "#EA4335",
  tiktok: "#010101",
};

const PLATFORM_LABELS: Record<string, string> = {
  rumble: "Rumble",
  meta: "Meta (FB/IG)",
  google: "Google Ads",
  tiktok: "TikTok Ads",
};

type PlatformStatus = AdsData["platformStatus"][number];

export function PaidAdsTab() {
  const { data, loading, error, refresh } = useAdsData();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [spend, setSpend] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [conversions, setConversions] = useState("");
  const [revenue, setRevenue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const addCampaign = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await mutate({
        action: "add",
        campaign: {
          platform: "rumble",
          name: name.trim(),
          spend: Number(spend || 0),
          impressions: Number(impressions || 0),
          clicks: Number(clicks || 0),
          conversions: Number(conversions || 0),
          revenue: Number(revenue || 0),
        },
      });
      setName("");
      setSpend("");
      setImpressions("");
      setClicks("");
      setConversions("");
      setRevenue("");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const syncPlatform = async (platform: string) => {
    setSyncing(platform);
    setMsg(null);
    try {
      await mutate({ action: "sync", platform });
      setMsg(`${PLATFORM_LABELS[platform] || platform} synced successfully.`);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(null);
    }
  };

  const platforms: PlatformStatus[] = data?.platformStatus || [];
  const campaigns = data?.campaigns || [];
  const byPlatform = data?.byPlatform || [];

  // Summary cards
  const totalSpend = byPlatform.reduce((s, p) => s + p.spend, 0);
  const totalRevenue = byPlatform.reduce((s, p) => s + p.revenue, 0);
  const totalRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const activePlatforms = platforms.filter((p) => p.configured).length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, color: NAVY, fontWeight: 800, letterSpacing: "-0.01em" }}>Paid Ads</div>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Multi-platform ad operations — Rumble manual entry, Meta/Google/TikTok auto-sync.
          </div>
        </div>
        <RefreshButton onClick={refresh} loading={loading || busy} />
      </div>

      {error ? <div style={{ marginBottom: 12, color: RED, fontWeight: 700 }}>{error}</div> : null}
      {msg ? (
        <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: `${GOLD}18`, border: `1px solid ${GOLD}33`, color: NAVY, fontWeight: 600, fontSize: 13 }}>
          {msg}
        </div>
      ) : null}

      {/* Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Total Ad Spend</div>
          <div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>{fmtDollar(totalSpend)}</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Total Ad Revenue</div>
          <div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>{fmtDollar(totalRevenue)}</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Blended ROAS</div>
          <div style={{ fontSize: 28, color: totalRoas >= 3 ? "#16a34a" : totalRoas >= 1.5 ? GOLD : RED, fontWeight: 800 }}>{totalRoas.toFixed(2)}x</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Active Platforms</div>
          <div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>{activePlatforms}</div>
        </div>
      </div>

      {/* Platform Connection Status */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
        {(["rumble", "meta", "google", "tiktok"] as const).map((key) => {
          const ps = platforms.find((p) => p.platform === key);
          const configured = ps?.configured || key === "rumble";
          const hasError = !!ps?.error;
          const synced = ps?.lastSynced;
          const count = ps?.campaignCount || 0;

          return (
            <div
              key={key}
              style={{
                background: CARD,
                border: `1px solid ${hasError ? `${RED}44` : configured ? `${PLATFORM_COLORS[key]}33` : BORDER}`,
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>{PLATFORM_LABELS[key]}</div>
                {configured ? (
                  hasError ? <XCircle size={16} color={RED} /> : <CheckCircle size={16} color="#16a34a" />
                ) : (
                  <Clock size={16} color={TEXT_DIM} />
                )}
              </div>
              <div style={{ fontSize: 12, color: TEXT_DIM }}>
                {configured
                  ? hasError
                    ? `Error: ${ps?.error?.slice(0, 60)}`
                    : `${count} campaign${count !== 1 ? "s" : ""} synced`
                  : "Not connected — add credentials to enable"}
              </div>
              {synced && !hasError ? (
                <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 4 }}>
                  Synced {new Date(synced).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </div>
              ) : null}
              {configured && key !== "rumble" ? (
                <button
                  onClick={() => syncPlatform(key)}
                  disabled={syncing === key}
                  style={{
                    marginTop: 8,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 6,
                    background: syncing === key ? BORDER : NAVY,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "4px 10px",
                    cursor: syncing === key ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <RefreshCw size={12} className={syncing === key ? "animate-spin" : ""} />
                  {syncing === key ? "Syncing…" : "Re-sync"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Cross-Platform ROAS Comparison */}
      {byPlatform.length > 0 ? (
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Platform ROAS Comparison</div>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={byPlatform.map((p) => ({ ...p, label: PLATFORM_LABELS[p.platform] || p.platform }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <Tooltip formatter={(v, n) => { const val = Number(v ?? 0); const nm = String(n ?? ""); return [nm === "roas" ? `${val.toFixed(2)}x` : fmtDollar(val), nm === "roas" ? "ROAS" : nm === "spend" ? "Spend" : "Revenue"]; }} />
                <Legend />
                <Bar dataKey="spend" fill={NAVY} name="Spend" radius={[4, 4, 0, 0]} />
                <Bar dataKey="revenue" fill={GOLD} name="Revenue" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {/* Add Rumble Campaign */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: NAVY, fontWeight: 800, marginBottom: 10 }}>
          <DollarSign size={16} />
          Add Rumble Campaign (Manual Entry)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(120px, 1fr))", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="Spend" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="Impressions" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={clicks} onChange={(e) => setClicks(e.target.value)} placeholder="Clicks" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={conversions} onChange={(e) => setConversions(e.target.value)} placeholder="Conversions" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="Revenue" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
        </div>
        <button onClick={addCampaign} disabled={busy || !name.trim()} style={{ marginTop: 10, border: `1px solid ${BORDER}`, borderRadius: 8, background: NAVY, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 12px", cursor: busy || !name.trim() ? "not-allowed" : "pointer", opacity: busy || !name.trim() ? 0.6 : 1 }}>
          Add Campaign
        </button>
      </div>

      {/* All Campaigns Table */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>All Campaigns</div>
        {loading && campaigns.length === 0 ? (
          <SkeletonTable rows={6} />
        ) : campaigns.length === 0 ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: TEXT_DIM, fontSize: 13 }}>
            No campaigns yet. Add a Rumble campaign above or connect Meta/Google/TikTok accounts.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Platform</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Campaign</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Spend</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Revenue</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>ROAS</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Clicks</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>CTR</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => {
                  const roas = campaign.spend > 0 ? campaign.revenue / campaign.spend : 0;
                  const ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0;
                  return (
                    <tr key={campaign.id}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0" }}>
                        <span style={{
                          display: "inline-block",
                          fontSize: 10,
                          fontWeight: 800,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: `${PLATFORM_COLORS[campaign.platform] || NAVY}18`,
                          color: PLATFORM_COLORS[campaign.platform] || NAVY,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}>
                          {campaign.platform}
                        </span>
                      </td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 700 }}>{campaign.name}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>{fmtDollar(campaign.spend)}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>{fmtDollar(campaign.revenue)}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", fontWeight: 700, color: roas >= 3 ? "#16a34a" : roas >= 1.5 ? GOLD : RED }}>{roas.toFixed(2)}x</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: TEXT_DIM }}>{campaign.clicks.toLocaleString("en-US")}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: TEXT_DIM }}>{ctr.toFixed(2)}%</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0" }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: campaign.status === "active" ? "#16a34a18" : campaign.status === "paused" ? `${GOLD}18` : `${TEXT_DIM}18`,
                          color: campaign.status === "active" ? "#16a34a" : campaign.status === "paused" ? GOLD : TEXT_DIM,
                        }}>
                          {campaign.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
