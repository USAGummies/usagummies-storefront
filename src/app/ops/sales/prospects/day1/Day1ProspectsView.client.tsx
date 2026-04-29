"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  CREAM,
  GOLD,
  NAVY,
  RED,
  SURFACE_BORDER as BORDER,
  SURFACE_CARD as CARD,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";
import type {
  ProspectContactMode,
  ProspectPlaybookSummary,
  WholesaleProspect,
} from "@/lib/sales/prospect-playbook";

const GREEN = "#15803d";
const AMBER = "#b45309";

interface ResponseShape {
  ok: boolean;
  generatedAt: string;
  source: string;
  summary: ProspectPlaybookSummary;
  prospects: WholesaleProspect[];
  error?: string;
}

const MODE_LABEL: Record<ProspectContactMode, string> = {
  email_ready: "Email ready",
  range_me: "RangeMe / portal",
  phone_only: "Phone only",
  research_needed: "Research needed",
};

export function Day1ProspectsView() {
  const [data, setData] = useState<ResponseShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ProspectContactMode | "all">("all");
  const [priority, setPriority] = useState<string>("all");

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/ops/sales/prospects/day1", {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as ResponseShape;
      if (!res.ok || body.ok !== true) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const all = data?.prospects ?? [];
    return all.filter((row) => {
      if (mode !== "all" && row.contactMode !== mode) return false;
      if (priority !== "all" && row.priority !== priority) return false;
      return true;
    });
  }, [data, mode, priority]);

  const priorities = Object.keys(data?.summary.priorityCounts ?? {}).sort();

  return (
    <main style={{ background: CREAM, minHeight: "100vh", padding: "24px 28px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <div>
          <div
            style={{
              color: DIM,
              fontSize: 12,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            Internal · Read-only sales playbook
          </div>
          <h1 style={{ color: NAVY, fontSize: 28, margin: "4px 0" }}>
            Day 1 Wholesale Prospects
          </h1>
          <p style={{ color: DIM, fontSize: 13, margin: 0, maxWidth: 840 }}>
            Curated prospect list from the checked-in CSV. This surface never
            sends email, creates HubSpot records, calls Apollo, or fabricates
            missing addresses. Email-ready means the CSV already contains a
            syntactically valid email.
          </p>
        </div>
        <button
          onClick={() => void load()}
          style={{
            background: NAVY,
            color: "#fff",
            border: 0,
            borderRadius: 8,
            padding: "9px 14px",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </header>

      {error && (
        <div
          style={{
            color: RED,
            background: "rgba(199,54,44,0.08)",
            border: `1px solid ${RED}40`,
            borderRadius: 10,
            padding: 12,
            marginBottom: 16,
          }}
        >
          Prospect playbook fetch failed: {error}
        </div>
      )}

      {data && (
        <>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <Metric label="Total prospects" value={data.summary.total} tone={NAVY} />
            <Metric label="Email ready" value={data.summary.emailReady} tone={GREEN} />
            <Metric
              label="Manual research"
              value={data.summary.needsManualResearch}
              tone={AMBER}
            />
            <Metric
              label="Priority A"
              value={data.summary.priorityCounts.A ?? 0}
              tone={GOLD}
            />
          </section>

          <section
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ color: DIM, fontSize: 12 }}>
                Source: <code>{data.source}</code> · generated{" "}
                {new Date(data.generatedAt).toLocaleString()}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as ProspectContactMode | "all")
                  }
                  style={selectStyle}
                >
                  <option value="all">All contact modes</option>
                  {Object.entries(MODE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                  style={selectStyle}
                >
                  <option value="all">All priorities</option>
                  {priorities.map((p) => (
                    <option key={p} value={p}>
                      Priority {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 12,
            }}
          >
            {rows.map((prospect) => (
              <ProspectCard key={`${prospect.rowNumber}-${prospect.company}`} prospect={prospect} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ color: DIM, fontSize: 12 }}>{label}</div>
      <div style={{ color: tone, fontSize: 26, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function ProspectCard({ prospect }: { prospect: WholesaleProspect }) {
  const modeColor =
    prospect.contactMode === "email_ready"
      ? GREEN
      : prospect.contactMode === "research_needed"
        ? RED
        : AMBER;

  return (
    <article
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <div>
          <h2 style={{ color: NAVY, fontSize: 16, margin: 0 }}>
            {prospect.company}
          </h2>
          <div style={{ color: DIM, fontSize: 12 }}>
            {prospect.displayName} · {prospect.title || "buyer"}
          </div>
        </div>
        <span
          style={{
            color: modeColor,
            border: `1px solid ${modeColor}40`,
            background: `${modeColor}12`,
            borderRadius: 999,
            padding: "3px 8px",
            fontSize: 11,
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
        >
          {MODE_LABEL[prospect.contactMode]}
        </span>
      </div>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "90px 1fr",
          gap: "6px 10px",
          color: DIM,
          fontSize: 12,
          margin: "12px 0",
        }}
      >
        <dt>Priority</dt>
        <dd style={{ margin: 0 }}>{prospect.priority || "—"}</dd>
        <dt>Category</dt>
        <dd style={{ margin: 0 }}>{prospect.category || "—"}</dd>
        <dt>Market</dt>
        <dd style={{ margin: 0 }}>
          {[prospect.city, prospect.state].filter(Boolean).join(", ") || "—"}
        </dd>
        <dt>Email</dt>
        <dd style={{ margin: 0 }}>{prospect.email || "—"}</dd>
        <dt>Phone</dt>
        <dd style={{ margin: 0 }}>{prospect.phone || "—"}</dd>
      </dl>

      <p style={{ color: NAVY, fontSize: 13, margin: 0 }}>
        {prospect.whyTarget}
      </p>
    </article>
  );
}

const selectStyle = {
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: "8px 10px",
  color: NAVY,
  background: "#fff",
  fontWeight: 700,
} satisfies CSSProperties;
