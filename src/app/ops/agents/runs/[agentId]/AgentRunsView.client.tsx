"use client";

/**
 * Agent runs timeline — one page per agent. Drill-down sibling of
 * /ops/agents/status (which is fleet-wide health). Shows the last ~50
 * runs as a vertical timeline with collapse-by-runId rollup, worst-
 * result badges, summaries, and error messages.
 *
 * Server-rendered first (parent page does the data load). This client
 * component handles the optional refetch button + per-row expand.
 */

import { useMemo, useState } from "react";

import {
  NAVY,
  RED,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";
import type { AgentManifestEntry } from "@/lib/ops/agents-runs/manifest";
import type {
  AgentRunHistory,
  RunHistoryItem,
} from "@/lib/ops/agents-runs/run-history";

const GREEN = "#16a34a";
const YELLOW = "#eab308";
const GREY = "#94a3b8";

interface Props {
  agentId: string;
  agent: AgentManifestEntry | null;
  history: AgentRunHistory;
  degraded: string[];
}

function colorForResult(r: RunHistoryItem["worstResult"]): string {
  if (r === "ok") return GREEN;
  if (r === "skipped") return GREY;
  if (r === "stood-down") return YELLOW;
  return RED;
}

function badgeForResult(r: RunHistoryItem["worstResult"]): string {
  if (r === "ok") return "OK";
  if (r === "skipped") return "SKIP";
  if (r === "stood-down") return "STAND-DOWN";
  return "ERROR";
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  if (ageMs < 0) return "future?";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export function AgentRunsView({ agentId, agent, history, degraded }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const summary = useMemo(() => {
    const counts = { ok: 0, error: 0, skipped: 0, "stood-down": 0 };
    for (const item of history.items) {
      counts[item.worstResult] += 1;
    }
    const errorRate =
      history.items.length > 0
        ? Math.round((counts.error / history.items.length) * 100)
        : 0;
    return { ...counts, errorRate };
  }, [history.items]);

  const toggle = (runId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", color: NAVY }}>
      <div style={{ marginBottom: 8, fontSize: 12 }}>
        <a
          href="/ops/agents/status"
          style={{ color: NAVY, textDecoration: "none" }}
        >
          ← Agent Status
        </a>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1
            style={{ margin: 0, fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}
          >
            {agent?.name ?? agentId}
          </h1>
          <div
            style={{
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 12,
              color: DIM,
              marginTop: 4,
            }}
          >
            {agentId}
          </div>
          {agent?.notes && (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: NAVY,
                background: `${GOLD}1a`,
                border: `1px solid ${GOLD}55`,
                borderRadius: 8,
                padding: "8px 12px",
              }}
            >
              {agent.notes}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill label="OK" count={summary.ok} color={GREEN} />
          <Pill label="ERROR" count={summary.error} color={RED} />
          <Pill label="SKIP" count={summary.skipped} color={GREY} />
          <Pill
            label="STAND-DOWN"
            count={summary["stood-down"]}
            color={YELLOW}
          />
          <Pill
            label="ERR%"
            count={summary.errorRate}
            color={summary.errorRate > 20 ? RED : GREY}
            suffix="%"
          />
        </div>
      </div>

      {agent && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <Meta label="Cadence" value={agent.cadence} />
          <Meta label="Channel" value={agent.channel} mono />
          <Meta label="Runtime" value={agent.runtimePath} mono />
          <Meta label="Contract" value={agent.contract} mono />
        </div>
      )}

      {degraded.length > 0 && (
        <div
          style={{
            border: `1px solid ${YELLOW}55`,
            background: `${YELLOW}0d`,
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12,
          }}
        >
          ⚠️ Degraded sources: {degraded.join(" · ")}
        </div>
      )}

      <div
        style={{
          fontSize: 12,
          color: DIM,
          marginBottom: 12,
        }}
      >
        Showing {history.items.length} of {history.totalRuns} runs ·{" "}
        {history.totalEntries} audit entries · {history.windowDescription}
      </div>

      {history.items.length === 0 ? (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            background: CARD,
            padding: 24,
            textAlign: "center",
            color: DIM,
            fontSize: 13,
          }}
        >
          No runs found in the audit window. Either this agent hasn&apos;t fired
          recently, or it doesn&apos;t write audit envelopes via the canonical
          path. Check{" "}
          <code
            style={{
              background: `${BORDER}40`,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            actorId
          </code>{" "}
          in the audit log.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {history.items.map((item) => {
            const isOpen = expanded.has(item.runId);
            const resultColor = colorForResult(item.worstResult);
            return (
              <div
                key={item.runId}
                style={{
                  border: `1px solid ${BORDER}`,
                  borderLeft: `4px solid ${resultColor}`,
                  borderRadius: 10,
                  background: CARD,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        marginBottom: 2,
                      }}
                    >
                      {formatTimestamp(item.startedAt)}
                      <span style={{ color: DIM, fontWeight: 400 }}>
                        {" "}
                        — {timeAgo(item.startedAt)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: DIM,
                        fontFamily: "ui-monospace, Menlo, monospace",
                      }}
                    >
                      {item.runId}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: resultColor,
                        border: `1px solid ${resultColor}55`,
                        background: `${resultColor}0d`,
                        padding: "3px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {badgeForResult(item.worstResult)}
                    </span>
                    <span style={{ fontSize: 11, color: DIM }}>
                      {item.entryCount}{" "}
                      {item.entryCount === 1 ? "entry" : "entries"} ·{" "}
                      {formatDuration(item.durationSeconds)}
                    </span>
                  </div>
                </div>

                {item.summary && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 13,
                      color: NAVY,
                    }}
                  >
                    {item.summary}
                  </div>
                )}

                {item.errorMessages.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: RED,
                      background: `${RED}0d`,
                      border: `1px solid ${RED}33`,
                      borderRadius: 6,
                      padding: "6px 10px",
                    }}
                  >
                    {item.errorMessages.map((m, i) => (
                      <div key={i}>✗ {m}</div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => toggle(item.runId)}
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    fontWeight: 600,
                    color: NAVY,
                    background: "transparent",
                    border: `1px solid ${BORDER}`,
                    borderRadius: 6,
                    padding: "4px 10px",
                    cursor: "pointer",
                  }}
                >
                  {isOpen ? "Hide" : "Show"} actions ({item.actions.length})
                </button>

                {isOpen && (
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 11,
                      color: NAVY,
                      background: `${BORDER}25`,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 6,
                      padding: 10,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        textTransform: "uppercase",
                        fontSize: 10,
                        color: DIM,
                        marginBottom: 6,
                      }}
                    >
                      Actions
                    </div>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        fontFamily: "ui-monospace, Menlo, monospace",
                      }}
                    >
                      {item.actions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                    {item.primaryCitations.length > 0 && (
                      <>
                        <div
                          style={{
                            fontWeight: 700,
                            textTransform: "uppercase",
                            fontSize: 10,
                            color: DIM,
                            marginTop: 10,
                            marginBottom: 6,
                          }}
                        >
                          Citations (primary entry)
                        </div>
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: 18,
                            fontFamily: "ui-monospace, Menlo, monospace",
                          }}
                        >
                          {item.primaryCitations.map((c, i) => (
                            <li key={i}>
                              {c.system}
                              {c.id ? `:${c.id}` : ""}
                              {c.url ? ` (${c.url})` : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          marginTop: 22,
          padding: "12px 16px",
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          fontSize: 12,
          color: DIM,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, color: NAVY, marginBottom: 4 }}>
          Notes
        </div>
        Runs are grouped by <code>runId</code>. A single run can produce
        multiple audit entries (orchestrator + per-fire writes); we collapse
        them and roll up the worst result. Source: last 1,000 audit entries.
      </div>
    </div>
  );
}

function Pill({
  label,
  count,
  color,
  suffix,
}: {
  label: string;
  count: number;
  color: string;
  suffix?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${color}55`,
        background: `${color}0d`,
        color,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
      }}
    >
      <span style={{ fontSize: 13 }}>●</span>
      {count}
      {suffix ?? ""} {label}
    </span>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        background: CARD,
        padding: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: DIM,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: NAVY,
          fontFamily: mono ? "ui-monospace, Menlo, monospace" : "inherit",
          wordBreak: "break-all",
        }}
      >
        {value}
      </div>
    </div>
  );
}
