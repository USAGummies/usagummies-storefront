"use client";

import { useMemo, useState } from "react";
import {
  Mail,
  StickyNote,
  Clock3,
  DollarSign,
  MapPin,
  AlertTriangle,
} from "lucide-react";

import {
  usePipelineData,
  useDealEmails,
  fmtDollar,
} from "@/lib/ops/use-war-room-data";
import { StalenessBadge } from "@/app/ops/components/StalenessBadge";
import { RefreshButton } from "@/app/ops/components/RefreshButton";
import { SkeletonTable } from "@/app/ops/components/Skeleton";
import {
  NAVY,
  RED,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

const KANBAN_STAGES = [
  "Lead",
  "Outreach",
  "Sampling",
  "Negotiation",
  "Committed",
  "Shipping",
] as const;

type KanbanStage = (typeof KANBAN_STAGES)[number];
type DealThread = {
  contactEmail: string;
  latestEmail: { snippet: string; date: string } | null;
};

function mapToKanbanStage(status: string): KanbanStage {
  const s = status.toLowerCase();
  if (/committed|order placed|closed won/.test(s)) return "Committed";
  if (/shipping|ship/.test(s)) return "Shipping";
  if (/negotiation/.test(s)) return "Negotiation";
  if (/sample|interested|quote|proposal/.test(s)) return "Sampling";
  if (/contact|follow|outreach/.test(s)) return "Outreach";
  return "Lead";
}

function daysSince(date: string): number {
  const ts = Date.parse(date);
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "14px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: TEXT_DIM,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: NAVY }}>{value}</div>
      {sub ? <div style={{ marginTop: 4, fontSize: 12, color: TEXT_DIM }}>{sub}</div> : null}
    </div>
  );
}

export function PipelineView() {
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const {
    data: pipeline,
    loading: pipeLoading,
    error: pipeError,
    refresh: refreshPipeline,
  } = usePipelineData();
  const {
    data: dealEmails,
    loading: emailLoading,
    refresh: refreshEmails,
  } = useDealEmails();
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const freshnessItems = [
    { label: "Pipeline", timestamp: pipeline?.generatedAt },
    { label: "Deal Emails", timestamp: dealEmails?.generatedAt },
  ];

  const leads = useMemo(() => {
    const rows = Object.values(pipeline?.stages || {}).flat();
    return rows.map((lead) => ({
      ...lead,
      kanbanStage: mapToKanbanStage(lead.status || ""),
    }));
  }, [pipeline]);

  const emailByContact = useMemo(() => {
    const map = new Map<string, DealThread>();
    for (const thread of dealEmails?.threads || []) {
      map.set(thread.contactEmail.toLowerCase(), thread);
    }
    return map;
  }, [dealEmails]);

  const grouped = useMemo(() => {
    const bucket: Record<KanbanStage, typeof leads> = {
      Lead: [],
      Outreach: [],
      Sampling: [],
      Negotiation: [],
      Committed: [],
      Shipping: [],
    };

    for (const lead of leads) {
      bucket[lead.kanbanStage].push(lead);
    }

    for (const stage of KANBAN_STAGES) {
      bucket[stage].sort((a, b) => (b.dealValue || 0) - (a.dealValue || 0));
    }

    return bucket;
  }, [leads]);

  const confirmedAccounts = useMemo(() => {
    return [...grouped.Committed, ...grouped.Shipping]
      .filter((lead) => (lead.dealValue || 0) > 0)
      .sort((a, b) => (b.dealValue || 0) - (a.dealValue || 0));
  }, [grouped]);

  async function logNote(leadName: string, stage: string) {
    try {
      const res = await fetch("/api/ops/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "pipeline",
          text: `[Pipeline Note] ${leadName} in ${stage} reviewed at ${new Date().toISOString()}`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActionMsg(`Logged note for ${leadName}.`);
      setTimeout(() => setActionMsg(null), 2500);
    } catch {
      setActionMsg(`Could not log note for ${leadName}.`);
      setTimeout(() => setActionMsg(null), 2500);
    }
  }

  function draftFollowUp(lead: { name: string; email: string; status: string }, snippet?: string) {
    if (!lead.email) {
      setActionMsg(`No email on file for ${lead.name}.`);
      setTimeout(() => setActionMsg(null), 2500);
      return;
    }

    const subject = `Following up on USA Gummies partnership`;
    const body = [
      `Hi ${lead.name},`,
      "",
      "Following up on our USA Gummies conversation.",
      snippet ? `Last thread context: ${snippet}` : "",
      "",
      "Let me know the next step to move this forward.",
      "",
      "Best,",
      "USA Gummies",
    ]
      .filter(Boolean)
      .join("\n");

    window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, color: NAVY, letterSpacing: "-0.02em" }}>
            Pipeline & Deals
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Honest Kanban stages with live email context and follow-up actions.
          </div>
          <div style={{ marginTop: 8 }}>
            <StalenessBadge items={freshnessItems} />
          </div>
        </div>
        <RefreshButton
          loading={pipeLoading || emailLoading}
          onClick={() => {
            refreshPipeline();
            refreshEmails();
          }}
        />
      </div>

      {pipeError ? (
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
          {pipeError}
        </div>
      ) : null}

      {actionMsg ? (
        <div
          style={{
            border: `1px solid ${NAVY}2b`,
            background: `${NAVY}10`,
            color: NAVY,
            borderRadius: 10,
            padding: "8px 12px",
            marginBottom: 12,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {actionMsg}
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
        <MetricCard label="Total Leads" value={String(pipeline?.totalLeads || 0)} />
        <MetricCard label="Pipeline Value" value={fmtDollar(pipeline?.pipelineValue.total || 0)} />
        <MetricCard label="Avg Days to Close" value={`${pipeline?.velocity.avgDaysToClose || 0}d`} />
        <MetricCard
          label="Weekly Movement"
          value={`+${pipeline?.weeklyTrend.newLeads || 0}`}
          sub={`${pipeline?.weeklyTrend.stageAdvances || 0} stage moves`}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, color: NAVY, marginBottom: 10 }}>Kanban</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(260px, 1fr))",
            gap: 10,
            overflowX: "auto",
            paddingBottom: 6,
          }}
        >
          {KANBAN_STAGES.map((stage) => {
            const stageLeads = grouped[stage] || [];
            return (
              <div
                key={stage}
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  padding: "10px",
                  minHeight: 380,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, color: NAVY }}>{stage}</div>
                  <div style={{ fontSize: 12, color: TEXT_DIM, fontWeight: 700 }}>{stageLeads.length}</div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {(expandedStages[stage] ? stageLeads : stageLeads.slice(0, 15)).map((lead) => {
                    const email = lead.email ? emailByContact.get(lead.email.toLowerCase()) : undefined;
                    const snippet = email?.latestEmail?.snippet || "No recent email thread.";
                    const lastEmailDate = email?.latestEmail?.date
                      ? new Date(email.latestEmail.date).toLocaleDateString("en-US")
                      : "No email yet";

                    return (
                      <div
                        key={lead.id}
                        style={{
                          border: `1px solid ${BORDER}`,
                          background: "#fcfbf8",
                          borderRadius: 10,
                          padding: "10px",
                          display: "grid",
                          gap: 7,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontWeight: 700, color: NAVY, fontSize: 13 }}>{lead.name}</div>
                          <div style={{ fontWeight: 800, color: NAVY, fontSize: 12 }}>
                            {fmtDollar(lead.dealValue || 0)}
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 5, fontSize: 12, color: TEXT_DIM }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Clock3 size={12} />
                            {daysSince(lead.lastEdited || lead.createdAt || "")} days in stage
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Mail size={12} />
                            Last email: {lastEmailDate}
                          </div>
                        </div>

                        <div
                          style={{
                            fontSize: 12,
                            color: TEXT_DIM,
                            background: "#f2efe8",
                            borderRadius: 8,
                            padding: "6px 7px",
                            minHeight: 42,
                          }}
                        >
                          {snippet}
                        </div>

                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => draftFollowUp(lead, snippet)}
                            style={{
                              flex: 1,
                              border: "none",
                              borderRadius: 8,
                              background: NAVY,
                              color: "#fff",
                              padding: "7px 8px",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Draft Follow-up
                          </button>
                          <button
                            onClick={() => logNote(lead.name, stage)}
                            style={{
                              flex: 1,
                              border: `1px solid ${BORDER}`,
                              borderRadius: 8,
                              background: CARD,
                              color: NAVY,
                              padding: "7px 8px",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                            }}
                          >
                            <StickyNote size={12} />
                            Log Note
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {stageLeads.length === 0 ? (
                    pipeLoading || emailLoading ? (
                      <SkeletonTable rows={4} />
                    ) : (
                      <div style={{ fontSize: 12, color: TEXT_DIM }}>
                        No deals in this stage.
                      </div>
                    )
                  ) : null}
                  {stageLeads.length > 15 ? (
                    <button
                      onClick={() =>
                        setExpandedStages((prev) => ({
                          ...prev,
                          [stage]: !prev[stage],
                        }))
                      }
                      style={{
                        border: `1px solid ${BORDER}`,
                        borderRadius: 8,
                        background: CARD,
                        color: NAVY,
                        padding: "7px 8px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {expandedStages[stage] ? "Show top 15" : `Show all (${stageLeads.length})`}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <MapPin size={16} color={NAVY} />
          <div style={{ fontWeight: 700, color: NAVY }}>Confirmed Accounts Territory Map</div>
        </div>

        {confirmedAccounts.length === 0 ? (
          <div style={{ fontSize: 13, color: TEXT_DIM }}>
            No confirmed accounts yet. This section only displays accounts with committed/shipping revenue.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {confirmedAccounts.slice(0, 12).map((lead) => (
              <div
                key={lead.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderTop: `1px solid ${BORDER}`,
                  paddingTop: 8,
                }}
              >
                <div>
                  <div style={{ color: NAVY, fontWeight: 700, fontSize: 13 }}>{lead.name}</div>
                  <div style={{ color: TEXT_DIM, fontSize: 12 }}>{lead.source || "Source unknown"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: TEXT_DIM }}>{lead.kanbanStage}</span>
                  <span style={{ fontSize: 13, color: NAVY, fontWeight: 800 }}>
                    <DollarSign size={12} style={{ marginBottom: -1 }} /> {fmtDollar(lead.dealValue || 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
