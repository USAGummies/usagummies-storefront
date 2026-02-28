"use client";

import { useMemo, useState } from "react";
import { Lightbulb } from "lucide-react";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useIntelligenceData } from "@/lib/ops/use-war-room-data";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonChart, SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  GOLD,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

async function mutate(payload: Record<string, unknown>) {
  const res = await fetch("/api/ops/marketing/intelligence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Action failed (${res.status})`);
  return json;
}

export function IntelligenceTab() {
  const { data, loading, error, refresh } = useIntelligenceData();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [channel, setChannel] = useState("rumble");
  const [hypothesis, setHypothesis] = useState("");
  const [spend, setSpend] = useState("");
  const [revenue, setRevenue] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [creative, setCreative] = useState("");
  const [audience, setAudience] = useState("");

  const addTest = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await mutate({
        action: "add",
        test: {
          name: name.trim(),
          channel,
          hypothesis: hypothesis.trim(),
          spend: Number(spend || 0),
          revenue: Number(revenue || 0),
          impressions: Number(impressions || 0),
          clicks: Number(clicks || 0),
          creative: creative.trim(),
          audience: audience.trim(),
        },
      });
      setMsg("Test added.");
      setName("");
      setHypothesis("");
      setSpend("");
      setRevenue("");
      setImpressions("");
      setClicks("");
      setCreative("");
      setAudience("");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const closeTest = async (id: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await mutate({ action: "close", id });
      setMsg("Test closed.");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const bestOpportunity = useMemo(() => (data?.opportunities || [])[0], [data]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 22, color: NAVY, fontWeight: 800, letterSpacing: "-0.01em" }}>Intelligence</div>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Track live experiments, detect winners fast, and trigger disciplined scale-up moves.
          </div>
        </div>
        <RefreshButton onClick={refresh} loading={loading || busy} />
      </div>

      {error ? (
        <div style={{ border: `1px solid ${RED}33`, background: `${RED}14`, color: RED, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontWeight: 700 }}>
          {error}
        </div>
      ) : null}
      {msg ? (
        <div style={{ border: `1px solid ${BORDER}`, background: CARD, color: NAVY, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontWeight: 700 }}>
          {msg}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}><div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700 }}>Active Tests</div><div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>{data?.summary.activeTests || 0}</div></div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}><div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700 }}>Avg ROAS</div><div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>{(data?.summary.avgRoas || 0).toFixed(2)}</div></div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}><div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700 }}>Best Performer</div><div style={{ fontSize: 18, color: NAVY, fontWeight: 800 }}>{data?.summary.bestPerformer || "None"}</div></div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}><div style={{ fontSize: 11, color: TEXT_DIM, textTransform: "uppercase", fontWeight: 700 }}>Total Test Spend</div><div style={{ fontSize: 28, color: NAVY, fontWeight: 800 }}>${(data?.summary.totalTestSpend || 0).toLocaleString("en-US")}</div></div>
      </div>

      {bestOpportunity ? (
        <div style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}55`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: NAVY, fontWeight: 800, marginBottom: 4 }}>
            <Lightbulb size={16} /> HIGH ROAS Opportunity
          </div>
          <div style={{ color: NAVY, fontSize: 13 }}>
            {bestOpportunity.name} ({bestOpportunity.channel}) at ROAS {bestOpportunity.roas.toFixed(2)}. Suggested scale budget: ${bestOpportunity.suggestedScaleBudget.toLocaleString("en-US")}.
          </div>
        </div>
      ) : null}

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Channel ROAS Comparison</div>
        {loading && (data?.channelRoas || []).length === 0 ? (
          <SkeletonChart height={240} />
        ) : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data?.channelRoas || []}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                <XAxis dataKey="channel" tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_DIM }} />
                <Tooltip />
                <Bar dataKey="roas" fill={NAVY} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>New Test</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Test name" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 10px", fontSize: 12 }} />
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 10px", fontSize: 12 }}>
            <option value="rumble">Rumble</option>
            <option value="x">X</option>
            <option value="truth">Truth Social</option>
            <option value="instagram">Instagram</option>
            <option value="blog">Blog</option>
          </select>
          <input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="Hypothesis" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 10px", fontSize: 12 }} />
          <input value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="Spend" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 10px", fontSize: 12 }} />
          <input value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="Revenue" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 10px", fontSize: 12 }} />
          <input value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="Impressions" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 10px", fontSize: 12 }} />
          <input value={clicks} onChange={(e) => setClicks(e.target.value)} placeholder="Clicks" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 10px", fontSize: 12 }} />
          <input value={creative} onChange={(e) => setCreative(e.target.value)} placeholder="Creative" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 10px", fontSize: 12 }} />
          <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Audience" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 10px", fontSize: 12 }} />
        </div>
        <button onClick={addTest} disabled={busy || !name.trim()} style={{ marginTop: 10, border: `1px solid ${BORDER}`, borderRadius: 8, background: NAVY, color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 12px" }}>
          Add Test
        </button>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Test Log</div>
        {loading && (data?.tests || []).length === 0 ? (
          <SkeletonTable rows={8} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Test</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Channel</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>ROAS</th>
                  <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Spend</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Status</th>
                  <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.tests || []).map((test) => (
                  <tr key={test.id}>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 700 }}>{test.name}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: TEXT_DIM }}>{test.channel}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: test.roas > 3 ? GOLD : NAVY, fontWeight: 700 }}>{test.roas.toFixed(2)}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>${test.spend.toLocaleString("en-US")}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY }}>{test.status}</td>
                    <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0" }}>
                      {test.status === "active" ? (
                        <button onClick={() => closeTest(test.id)} style={{ border: `1px solid ${BORDER}`, borderRadius: 6, background: CARD, color: NAVY, fontSize: 11, fontWeight: 700, padding: "4px 8px" }}>
                          Close
                        </button>
                      ) : (
                        <span style={{ color: TEXT_DIM, fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
