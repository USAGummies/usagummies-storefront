"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import {
  NAVY,
  GOLD,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
} from "@/app/ops/tokens";

const AgenticCommandCenter = dynamic(() => import("@/components/ops/AgenticCommandCenter.client"), {
  ssr: false,
  loading: () => (
    <div style={{ color: "#12213f", padding: "40px 0", fontSize: 14, fontWeight: 600 }}>
      Loading agent dashboard...
    </div>
  ),
});

type BrainInsight = {
  insights: string[];
  sources: { title: string; source_table: string }[];
};

export function AgentsShell() {
  const [brain, setBrain] = useState<BrainInsight | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainError, setBrainError] = useState<string | null>(null);

  const fetchBrainInsights = useCallback(async () => {
    setBrainLoading(true);
    setBrainError(null);
    try {
      const res = await fetch("/api/ops/abra/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "agents automation scheduling engine runs failures self-heal operations" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch insights");
      setBrain(data);
    } catch (err) {
      setBrainError(err instanceof Error ? err.message : "Brain query failed");
    } finally {
      setBrainLoading(false);
    }
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button
          onClick={() => void fetchBrainInsights()}
          disabled={brainLoading}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            border: `1px solid ${brain ? `${GOLD}60` : BORDER}`,
            borderRadius: 10, background: brain ? `${GOLD}0d` : CARD,
            color: NAVY, padding: "8px 12px", fontSize: 12, fontWeight: 700,
            cursor: brainLoading ? "default" : "pointer",
            opacity: brainLoading ? 0.7 : 1,
          }}
        >
          {brainLoading ? "Thinking..." : brain ? "Refresh Intel" : "🧠 Agent Intel"}
        </button>
      </div>

      {brainError && (
        <div style={{ border: `1px solid ${RED}33`, background: `${RED}0a`, borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: RED }}>
          🧠 Brain: {brainError}
        </div>
      )}
      {brain && brain.insights.length > 0 && (
        <div style={{ background: `${GOLD}0d`, border: `1px solid ${GOLD}30`, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10, fontSize: 14 }}>
            🧠 Agent System Intelligence
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 18px", listStyle: "disc" }}>
            {brain.insights.map((insight, i) => (
              <li key={i} style={{ fontSize: 13, color: NAVY, lineHeight: 1.6, marginBottom: 4 }}>{insight}</li>
            ))}
          </ul>
          {brain.sources.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {brain.sources.map((s, i) => (
                <span key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: s.source_table === "email" ? `${NAVY}10` : `${GOLD}18`,
                  border: `1px solid ${s.source_table === "email" ? `${NAVY}20` : `${GOLD}30`}`,
                  borderRadius: 6, padding: "3px 8px", fontSize: 11, color: NAVY, fontWeight: 600,
                }}>
                  {s.source_table === "email" ? "📧" : "🧠"} {s.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <AgenticCommandCenter />
    </div>
  );
}
