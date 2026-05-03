"use client";

/**
 * Agent Status strip — one-page green/yellow/red view of every live
 * 3.0 agent. Pairs with /api/ops/agents/status.
 *
 * Polls every 60s. Cards show cadence, last run, runs/errors in 24h,
 * channel, staleness assessment. Links to contract + runtime endpoint.
 */
import { useCallback, useEffect, useState } from "react";

import {
  NAVY,
  RED,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

interface Agent {
  id: string;
  name: string;
  contract: string;
  runtimePath: string;
  cadence: string;
  channel: string;
  notes?: string;
  lastRunAt: string | null;
  lastResult: "ok" | "error" | "skipped" | "stood-down" | null;
  lastAction: string | null;
  lastSummary: string | null;
  lastError: string | null;
  runsLast24h: number;
  errorsLast24h: number;
  staleness: "green" | "yellow" | "red" | "unknown";
  stalenessReason: string;
}

interface StatusResponse {
  ok: boolean;
  generatedAt: string;
  summary: Record<string, number>;
  agents: Agent[];
  degraded: string[];
}

const GREEN = "#16a34a";
const YELLOW = "#eab308";
const GREY = "#94a3b8";

function colorFor(state: Agent["staleness"]): string {
  if (state === "green") return GREEN;
  if (state === "yellow") return YELLOW;
  if (state === "red") return RED;
  return GREY;
}

function iconFor(state: Agent["staleness"]): string {
  if (state === "green") return "●";
  if (state === "yellow") return "●";
  if (state === "red") return "●";
  return "○";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ageMs = Date.now() - new Date(iso).getTime();
  if (ageMs < 0) return "future?";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  return `${Math.round(ageMs / 86_400_000)}d ago`;
}

export function AgentStatusView() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/agents/status", { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as StatusResponse;
      setData(json);
      setError(null);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto", color: NAVY }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
            🤖 Agent Status
          </h1>
          <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>
            Per-agent health. Refreshes every 60s.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {data && (
            <>
              <Summary
                label="green"
                count={data.summary.green ?? 0}
                color={GREEN}
              />
              <Summary
                label="yellow"
                count={data.summary.yellow ?? 0}
                color={YELLOW}
              />
              <Summary
                label="red"
                count={data.summary.red ?? 0}
                color={RED}
              />
              <Summary
                label="unknown"
                count={data.summary.unknown ?? 0}
                color={GREY}
              />
            </>
          )}
          {lastFetchedAt && (
            <span style={{ fontSize: 12, color: DIM }}>
              {lastFetchedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              background: CARD,
              color: NAVY,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            border: `1px solid ${RED}55`,
            background: `${RED}0d`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13,
            color: RED,
          }}
        >
          ❌ {error}
        </div>
      )}

      {data && data.degraded.length > 0 && (
        <div
          style={{
            border: `1px solid ${YELLOW}55`,
            background: `${YELLOW}0d`,
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12,
            color: NAVY,
          }}
        >
          ⚠️ Degraded sources: {data.degraded.join(" · ")}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 14,
        }}
      >
        {data?.agents.map((a) => (
          <div
            key={a.id}
            style={{
              border: `1px solid ${BORDER}`,
              borderLeft: `4px solid ${colorFor(a.staleness)}`,
              borderRadius: 12,
              background: CARD,
              padding: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "start",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{a.name}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: DIM,
                    marginTop: 2,
                    fontFamily: "ui-monospace, Menlo, monospace",
                  }}
                >
                  {a.id}
                </div>
              </div>
              <span
                style={{
                  color: colorFor(a.staleness),
                  fontSize: 18,
                  fontWeight: 800,
                  lineHeight: 1,
                }}
                title={a.stalenessReason}
              >
                {iconFor(a.staleness)}
              </span>
            </div>

            <Row label="Cadence" value={a.cadence} />
            <Row label="Channel" value={a.channel} mono />
            <Row label="Last run" value={timeAgo(a.lastRunAt)} />
            <Row
              label="Result"
              value={a.lastResult ?? "—"}
              mono
              color={
                a.lastResult === "error"
                  ? RED
                  : a.lastResult === "ok"
                    ? GREEN
                    : DIM
              }
            />
            <Row
              label="24h runs"
              value={`${a.runsLast24h}${a.errorsLast24h > 0 ? ` (${a.errorsLast24h} err)` : ""}`}
            />
            {a.lastSummary && (
              <Callout label="Last summary">{a.lastSummary}</Callout>
            )}
            {a.lastError && (
              <Callout label="Last error" tone="error">
                {a.lastError}
              </Callout>
            )}
            {a.notes && <Muted>{a.notes}</Muted>}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 10,
                gap: 8,
              }}
            >
              <div style={{ fontSize: 11, color: DIM, minWidth: 0, flex: 1 }}>
                <Code>{a.runtimePath}</Code>
              </div>
              <a
                href={`/ops/agents/runs/${encodeURIComponent(a.id)}`}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: NAVY,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 6,
                  padding: "3px 8px",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
                title="Run history timeline for this agent"
              >
                Runs →
              </a>
            </div>
          </div>
        ))}
      </div>

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
        Staleness is assessed from the audit log (last 1,000 entries).
        Agents with no audit history show &quot;unknown&quot; until they
        write to the log. Cadence thresholds: daily = 26h green / 48h
        yellow / else red; weekly = 7d+2h green / 9d yellow / else red;
        event-driven = always green unless no runs logged.
      </div>
    </div>
  );
}

function Summary({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        border: `1px solid ${color}44`,
        background: `${color}0d`,
        color,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        textTransform: "uppercase",
      }}
    >
      <span style={{ fontSize: 14 }}>●</span>
      {count} {label}
    </span>
  );
}

function Row({
  label,
  value,
  mono,
  color,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "4px 0",
        borderBottom: `1px dashed ${BORDER}`,
        fontSize: 12,
      }}
    >
      <span style={{ color: DIM }}>{label}</span>
      <span
        style={{
          color: color ?? NAVY,
          fontFamily: mono
            ? "ui-monospace, Menlo, monospace"
            : "inherit",
          fontSize: 12,
          textAlign: "right",
          maxWidth: "60%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: DIM,
        marginTop: 8,
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}

function Callout({
  label,
  children,
  tone = "neutral",
}: {
  label: string;
  children: React.ReactNode;
  tone?: "neutral" | "error";
}) {
  const color = tone === "error" ? RED : NAVY;
  return (
    <div
      style={{
        border: `1px solid ${tone === "error" ? `${RED}44` : BORDER}`,
        background: tone === "error" ? `${RED}0d` : "rgba(27,42,74,0.03)",
        borderRadius: 8,
        padding: "8px 10px",
        marginTop: 10,
        fontSize: 11,
        lineHeight: 1.45,
        color,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "ui-monospace, Menlo, monospace",
        background: "rgba(27,42,74,0.04)",
        padding: "1px 5px",
        borderRadius: 4,
        fontSize: 11,
      }}
    >
      {children}
    </code>
  );
}

// Tokens suppress unused warning when GOLD import is kept for future polish.
void GOLD;
