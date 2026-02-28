"use client";

import { useState } from "react";
import { DollarSign } from "lucide-react";
import { useAdsData } from "@/lib/ops/use-war-room-data";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonTable } from "@/app/ops/components/Skeleton";
import { PlaceholderCard } from "@/app/ops/marketing/components/PlaceholderCard";
import { NAVY, RED, SURFACE_CARD as CARD, SURFACE_BORDER as BORDER, SURFACE_TEXT_DIM as TEXT_DIM } from "@/app/ops/tokens";

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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, color: NAVY, fontWeight: 800, letterSpacing: "-0.01em" }}>Paid Ads</div>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Rumble campaign operations now; Meta/Google/TikTok connection tracks staged next.
          </div>
        </div>
        <RefreshButton onClick={refresh} loading={loading || busy} />
      </div>

      {error ? <div style={{ marginBottom: 12, color: RED, fontWeight: 700 }}>{error}</div> : null}
      {msg ? <div style={{ marginBottom: 12, color: RED, fontWeight: 700 }}>{msg}</div> : null}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: NAVY, fontWeight: 800, marginBottom: 10 }}>
          <DollarSign size={16} />
          Add Rumble Campaign
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(120px, 1fr))", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="Spend" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="Impressions" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={clicks} onChange={(e) => setClicks(e.target.value)} placeholder="Clicks" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={conversions} onChange={(e) => setConversions(e.target.value)} placeholder="Conversions" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
          <input value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="Revenue" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 12 }} />
        </div>
        <button onClick={addCampaign} disabled={busy || !name.trim()} style={{ marginTop: 10, border: `1px solid ${BORDER}`, borderRadius: 8, background: NAVY, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 12px" }}>
          Add Campaign
        </button>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Rumble Campaigns</div>
        {loading && (data?.campaigns || []).length === 0 ? (
          <SkeletonTable rows={6} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Campaign</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Spend</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Revenue</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>ROAS</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>CTR</th>
                </tr>
              </thead>
              <tbody>
                {(data?.campaigns || []).filter((c) => c.platform === "rumble").map((campaign) => {
                  const roas = campaign.spend > 0 ? campaign.revenue / campaign.spend : 0;
                  const ctr = campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0;
                  return (
                    <tr key={campaign.id}>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 700 }}>{campaign.name}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>${campaign.spend.toLocaleString("en-US")}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>${campaign.revenue.toLocaleString("en-US")}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>{roas.toFixed(2)}</td>
                      <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: TEXT_DIM }}>{ctr.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(240px, 1fr))", gap: 12 }}>
        <PlaceholderCard title="Meta Ads" description="Connect Meta Ads account for spend + conversion sync." checklist={["Business Manager access", "Ad account ID", "Token rotation"]} />
        <PlaceholderCard title="Google Ads" description="Connect Google Ads API to ingest campaign and keyword ROAS." checklist={["OAuth client", "Developer token", "Customer ID"]} />
        <PlaceholderCard title="TikTok Ads" description="Connect TikTok Ads reporting for paid social expansion." checklist={["App credentials", "Ad account mapping", "Attribution model"]} />
      </div>
    </div>
  );
}
