"use client";

import { useEffect, useState } from "react";

type Lead = {
  id: string;
  name: string;
  status: string;
  email: string;
  lastContact: string;
  type: "b2b" | "distributor";
};

type PipelineData = {
  totalLeads: number;
  b2bCount: number;
  distributorCount: number;
  stageCounts: Record<string, number>;
  stages: Record<string, Lead[]>;
  generatedAt: string;
};

const STAGE_COLORS: Record<string, string> = {
  Researched: "#6366f1",
  Contacted: "#3b82f6",
  Replied: "#22d3ee",
  Interested: "#10b981",
  "Quote Sent": "#f59e0b",
  Negotiating: "#f97316",
  Won: "#22c55e",
  Lost: "#ef4444",
  Rejected: "#6b7280",
  Unknown: "#4b5563",
};

function StageCard({ stage, leads, color }: { stage: string; leads: Lead[]; color: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: "#1a1d27",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        overflow: "hidden",
        minWidth: 280,
        flex: "1 1 280px",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          cursor: "pointer",
          color: "#fff",
          fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{stage}</span>
        </div>
        <span
          style={{
            background: "rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: "2px 10px",
            fontSize: 12,
            fontWeight: 600,
            color: "rgba(255,255,255,0.6)",
          }}
        >
          {leads.length}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "8px 0", maxHeight: 300, overflowY: "auto" }}>
          {leads.length === 0 ? (
            <div style={{ padding: "12px 18px", color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
              No leads in this stage
            </div>
          ) : (
            leads.map((lead) => (
              <div
                key={lead.id}
                style={{
                  padding: "8px 18px",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>
                    {lead.name || "Unnamed"}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                    {lead.email || "No email"} · {lead.lastContact}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 6,
                    background: lead.type === "b2b" ? "rgba(99,102,241,0.15)" : "rgba(16,185,129,0.15)",
                    color: lead.type === "b2b" ? "#818cf8" : "#34d399",
                    textTransform: "uppercase",
                    fontWeight: 600,
                  }}
                >
                  {lead.type}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function PipelineView() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/ops/pipeline", { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("Failed to load pipeline data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-display)", margin: 0, marginBottom: 8 }}>
          Sales Pipeline
        </h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          B2B and distributor prospects from Notion
          {data?.generatedAt ? ` · Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ""}
        </p>
      </div>

      {error && (
        <div style={{ background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && !error && (
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 14, padding: "40px 0" }}>
          Loading pipeline...
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "16px 22px", flex: "1 1 140px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Total Leads</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{data.totalLeads}</div>
            </div>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "16px 22px", flex: "1 1 140px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>B2B</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#818cf8" }}>{data.b2bCount}</div>
            </div>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "16px 22px", flex: "1 1 140px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Distributors</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#34d399" }}>{data.distributorCount}</div>
            </div>
            <div style={{ background: "#1a1d27", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "16px 22px", flex: "1 1 140px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>Stages</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{Object.keys(data.stageCounts).length}</div>
            </div>
          </div>

          {/* Pipeline stages */}
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Pipeline Stages
          </h2>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {Object.entries(data.stages)
              .sort(([, a], [, b]) => b.length - a.length)
              .map(([stage, leads]) => (
                <StageCard
                  key={stage}
                  stage={stage}
                  leads={leads}
                  color={STAGE_COLORS[stage] || STAGE_COLORS.Unknown}
                />
              ))}
          </div>
        </>
      )}
    </div>
  );
}
