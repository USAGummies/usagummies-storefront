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
  SalesTourContactStatus,
  SalesTourGroup,
  SalesTourPlaybookReport,
  SalesTourPrioritySignal,
  SalesTourProspect,
} from "@/lib/sales/tour-playbook";

const GREEN = "#15803d";
const AMBER = "#b45309";

interface ResponseShape extends SalesTourPlaybookReport {
  ok: boolean;
  error?: string;
}

const GROUP_LABEL: Record<SalesTourGroup, string> = {
  route_segment: "Route segment",
  vicinity_tier1: "Vicinity Tier 1",
  vicinity_tier2: "Vicinity Tier 2",
  supplemental: "Supplemental stop",
};

const STATUS_LABEL: Record<SalesTourContactStatus, string> = {
  verified_email: "Verified email",
  generic_email: "Generic email",
  sent: "Already sent",
  phone_or_call: "Phone / call task",
  research_needed: "Research needed",
  closed_or_customer: "Closed / customer",
  gap: "Gap",
};

const SIGNAL_LABEL: Record<SalesTourPrioritySignal, string> = {
  hot: "Hot",
  warm: "Warm",
  closed: "Closed",
  new: "New",
  cold: "Cold",
  deprioritized: "Deprioritized",
  unknown: "Unknown",
};

export function SalesTourView() {
  const [data, setData] = useState<ResponseShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<SalesTourGroup | "all">("all");
  const [status, setStatus] = useState<SalesTourContactStatus | "all">("all");
  const [signal, setSignal] = useState<SalesTourPrioritySignal | "all">("all");

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/ops/sales/tour", { cache: "no-store" });
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

  const filtered = useMemo(() => {
    const rows = data?.prospects ?? [];
    return rows.filter((row) => {
      if (group !== "all" && row.group !== group) return false;
      if (status !== "all" && row.contactStatus !== status) return false;
      if (signal !== "all" && row.prioritySignal !== signal) return false;
      return true;
    });
  }, [data, group, status, signal]);

  return (
    <main style={{ background: CREAM, minHeight: "100vh", padding: "24px 28px" }}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Internal · Read-only sales tour playbook</div>
          <h1 style={{ color: NAVY, fontSize: 30, margin: "4px 0" }}>
            May 2026 Sales Tour
          </h1>
          <p style={{ color: DIM, fontSize: 13, margin: 0, maxWidth: 920 }}>
            Parses the canonical Ashford-to-Grand-Canyon prospect contract into
            a sortable operator queue. No sends, no HubSpot writes, no Apollo
            calls, no inferred buyers. Generic inboxes and TBD contacts stay
            clearly labeled until Viktor/Ben verify them.
          </p>
        </div>
        <button onClick={() => void load()} style={primaryButtonStyle}>
          Refresh
        </button>
      </header>

      {error && <Banner tone={RED}>Sales tour playbook fetch failed: {error}</Banner>}

      {data && (
        <>
          <section style={metricGridStyle}>
            <Metric label="Total prospects" value={data.summary.total} tone={NAVY} />
            <Metric
              label="Warm / hot"
              value={data.summary.warmOrHot}
              tone={GOLD}
            />
            <Metric
              label="Verified email"
              value={data.summary.verifiedEmails}
              tone={GREEN}
            />
            <Metric label="Already sent" value={data.summary.alreadySent} tone={GREEN} />
            <Metric
              label="Research needed"
              value={data.summary.researchNeeded}
              tone={AMBER}
            />
            <Metric label="Call tasks" value={data.summary.callTasks} tone={AMBER} />
          </section>

          <section style={controlPanelStyle}>
            <div style={{ color: DIM, fontSize: 12 }}>
              Source: <code>{data.source}</code> · generated{" "}
              {new Date(data.generatedAt).toLocaleString()} · gaps skipped{" "}
              {data.summary.gapsSkipped}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select
                value={group}
                onChange={(event) => setGroup(event.target.value as SalesTourGroup | "all")}
                style={selectStyle}
              >
                <option value="all">All groups</option>
                {Object.entries(GROUP_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as SalesTourContactStatus | "all")
                }
                style={selectStyle}
              >
                <option value="all">All contact status</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={signal}
                onChange={(event) =>
                  setSignal(event.target.value as SalesTourPrioritySignal | "all")
                }
                style={selectStyle}
              >
                <option value="all">All priority signals</option>
                {Object.entries(SIGNAL_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section style={sectionGridStyle}>
            {data.sections.map((section) => (
              <div key={`${section.group}-${section.title}`} style={sectionChipStyle}>
                <strong>{section.count}</strong> · {GROUP_LABEL[section.group]} ·{" "}
                {section.title}
              </div>
            ))}
          </section>

          <section style={cardGridStyle}>
            {filtered.map((prospect) => (
              <ProspectCard key={prospect.id} prospect={prospect} />
            ))}
          </section>

          {filtered.length === 0 && (
            <Banner tone={AMBER}>No prospects match the current filters.</Banner>
          )}
        </>
      )}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div style={metricStyle}>
      <div style={{ color: DIM, fontSize: 12 }}>{label}</div>
      <div style={{ color: tone, fontSize: 28, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function ProspectCard({ prospect }: { prospect: SalesTourProspect }) {
  return (
    <article style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ color: NAVY, fontSize: 17, fontWeight: 900 }}>
            {prospect.prospect}
          </div>
          <div style={{ color: DIM, fontSize: 12, marginTop: 3 }}>
            {GROUP_LABEL[prospect.group]} · {prospect.section}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Pill>{STATUS_LABEL[prospect.contactStatus]}</Pill>
          <Pill>{SIGNAL_LABEL[prospect.prioritySignal]}</Pill>
        </div>
      </div>
      <dl style={detailGridStyle}>
        <Detail label="Type" value={prospect.type} />
        <Detail label="Contact" value={prospect.contact} />
        <Detail label="Email" value={prospect.email} />
        <Detail label="Phone" value={prospect.phone} />
        <Detail label="Action" value={prospect.action} />
        <Detail label="Notes" value={prospect.notes} />
      </dl>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ color: DIM, fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>
        {label}
      </dt>
      <dd style={{ color: NAVY, fontSize: 12, margin: "2px 0 0" }}>
        {value || "—"}
      </dd>
    </div>
  );
}

function Pill({ children }: { children: string }) {
  return (
    <span
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 999,
        color: NAVY,
        fontSize: 10,
        fontWeight: 900,
        padding: "4px 7px",
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <div
      style={{
        color: tone,
        background: `${tone}10`,
        border: `1px solid ${tone}40`,
        borderRadius: 10,
        padding: 12,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 18,
};

const eyebrowStyle: CSSProperties = {
  color: DIM,
  fontSize: 12,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0.6,
};

const primaryButtonStyle: CSSProperties = {
  background: NAVY,
  color: "#fff",
  border: 0,
  borderRadius: 8,
  padding: "9px 14px",
  fontWeight: 800,
  cursor: "pointer",
};

const metricGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 12,
  marginBottom: 16,
};

const metricStyle: CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 14,
};

const controlPanelStyle: CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 14,
  marginBottom: 16,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const selectStyle: CSSProperties = {
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: "8px 10px",
  background: "#fff",
  color: NAVY,
  fontWeight: 700,
};

const sectionGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 8,
  marginBottom: 16,
};

const sectionChipStyle: CSSProperties = {
  background: "#fff",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  color: NAVY,
  fontSize: 12,
  padding: 10,
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
  gap: 12,
};

const cardStyle: CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 14,
};

const detailGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
  margin: "14px 0 0",
};
