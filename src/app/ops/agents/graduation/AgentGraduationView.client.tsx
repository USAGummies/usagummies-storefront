"use client";

/**
 * Agent Graduation — readiness gauge for every agent in the manifest.
 *
 * Sibling view to:
 *   /ops/agents/status — runtime view (cron, last run, errors)
 *   /ops/agents/health — doctrine view (owner, approver, flags)
 *   /ops/agents/graduation — readiness view (THIS page)
 *
 * Surfaces the 8 graduation criteria per agent:
 *   - has-contract
 *   - has-named-owner
 *   - has-approver-when-required
 *   - no-doctrine-flags
 *   - has-recent-runs (last 30d)
 *   - low-error-rate (≤20% in window)
 *   - closes-loops (jobs only)
 *   - task-justification (tasks only)
 *
 * For each agent it shows a readiness percent + which criteria are
 * still blocking advancement. Operators flip the manifest entry by
 * hand once they're satisfied — the gauge never advances on its own.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  NAVY,
  GOLD,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

type Lifecycle =
  | "proposed"
  | "active"
  | "graduated"
  | "retired"
  | "parked";

interface Criterion {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

interface Gauge {
  agentId: string;
  agentName: string;
  currentStage: Lifecycle;
  nextStage: Lifecycle | null;
  criteria: Criterion[];
  passed: number;
  total: number;
  readiness: number;
  readyToGraduate: boolean;
  summary: string;
}

interface Summary {
  total: number;
  readyToGraduate: number;
  byStage: Record<Lifecycle, number>;
  atTerminal: number;
}

interface ApiResponse {
  ok: boolean;
  generatedAt: string;
  summary: Summary;
  gauges: Gauge[];
  degraded: string[];
  notes: { auditFetchLimit: number; windowDays: number };
}

const GREEN = "#16a34a";
const YELLOW = "#eab308";
const GREY = "#94a3b8";

const STAGE_COLOR: Record<Lifecycle, string> = {
  proposed: GREY,
  active: NAVY,
  graduated: GREEN,
  retired: GREY,
  parked: YELLOW,
};

const STAGE_LABEL: Record<Lifecycle, string> = {
  proposed: "Proposed",
  active: "Active",
  graduated: "Graduated",
  retired: "Retired",
  parked: "Parked",
};

function readinessColor(readiness: number): string {
  if (readiness >= 1) return GREEN;
  if (readiness >= 0.7) return YELLOW;
  return RED;
}

export function AgentGraduationView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<Lifecycle | "all">("all");
  const [sortBy, setSortBy] = useState<"readiness" | "name" | "stage">(
    "readiness",
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/agents/graduation", {
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as ApiResponse;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleGauges = useMemo(() => {
    if (!data) return [];
    let arr = [...data.gauges];
    if (stageFilter !== "all") {
      arr = arr.filter((g) => g.currentStage === stageFilter);
    }
    arr.sort((a, b) => {
      if (sortBy === "name") return a.agentName.localeCompare(b.agentName);
      if (sortBy === "stage")
        return a.currentStage.localeCompare(b.currentStage);
      // readiness: ready-to-graduate first, then ascending readiness
      // (lowest readiness floats to top so blockers are obvious).
      if (a.readyToGraduate !== b.readyToGraduate) {
        return a.readyToGraduate ? -1 : 1;
      }
      return a.readiness - b.readiness;
    });
    return arr;
  }, [data, stageFilter, sortBy]);

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto", color: NAVY }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
            🎓 Agent Graduation Gauge
          </h1>
          <div style={{ fontSize: 13, color: DIM, marginTop: 4 }}>
            Readiness to advance to the next lifecycle stage. Read-only —
            operators flip the manifest by hand once criteria pass.
          </div>
        </div>
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

      {data && (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 18,
          }}
        >
          <SummaryChip
            label="Ready to graduate"
            count={data.summary.readyToGraduate}
            color={GREEN}
            highlight
          />
          {(
            ["proposed", "active", "graduated", "retired", "parked"] as const
          ).map((stage) => (
            <SummaryChip
              key={stage}
              label={STAGE_LABEL[stage]}
              count={data.summary.byStage[stage]}
              color={STAGE_COLOR[stage]}
              onClick={() =>
                setStageFilter(stageFilter === stage ? "all" : stage)
              }
              active={stageFilter === stage}
            />
          ))}
          {stageFilter !== "all" && (
            <button
              onClick={() => setStageFilter("all")}
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: 999,
                background: CARD,
                color: DIM,
                padding: "4px 12px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              clear filter ✕
            </button>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          fontSize: 12,
          color: DIM,
        }}
      >
        <span>Sort:</span>
        {(["readiness", "name", "stage"] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setSortBy(opt)}
            style={{
              border: `1px solid ${sortBy === opt ? GOLD : BORDER}`,
              background: sortBy === opt ? `${GOLD}1a` : CARD,
              color: NAVY,
              borderRadius: 6,
              padding: "3px 9px",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {opt}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
          gap: 14,
        }}
      >
        {visibleGauges.map((g) => (
          <GaugeCard key={g.agentId} g={g} />
        ))}
      </div>

      {data && (
        <div
          style={{
            marginTop: 24,
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
            How the gauge works
          </div>
          Pulls the last {data.notes.auditFetchLimit} audit entries and
          slices by agent. Window for run/error criteria: last{" "}
          {data.notes.windowDays} days. Readiness ≥ 100% = ready to
          advance. The gauge never moves an agent's lifecycle on its
          own — flip the manifest entry in{" "}
          <code style={codeStyle}>src/lib/ops/agent-health.ts</code> once
          criteria pass.
        </div>
      )}
    </div>
  );
}

const codeStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, Menlo, monospace",
  background: "rgba(27,42,74,0.04)",
  padding: "1px 6px",
  borderRadius: 4,
  fontSize: 11,
  color: NAVY,
};

function GaugeCard({ g }: { g: Gauge }) {
  const stageBg = STAGE_COLOR[g.currentStage];
  const readBar = readinessColor(g.readiness);
  const pct = Math.round(g.readiness * 100);
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${g.readyToGraduate ? GREEN : readBar}`,
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
          marginBottom: 6,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{g.agentName}</div>
          <div
            style={{
              fontSize: 11,
              color: DIM,
              marginTop: 2,
              fontFamily: "ui-monospace, Menlo, monospace",
            }}
          >
            {g.agentId}
          </div>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            border: `1px solid ${stageBg}55`,
            background: `${stageBg}12`,
            color: stageBg,
            padding: "2px 9px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            whiteSpace: "nowrap",
          }}
        >
          {STAGE_LABEL[g.currentStage]}
          {g.nextStage && (
            <span style={{ opacity: 0.5 }}> → {STAGE_LABEL[g.nextStage]}</span>
          )}
        </span>
      </div>

      <div style={{ marginTop: 10, marginBottom: 10 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: DIM,
            marginBottom: 4,
          }}
        >
          <span>Readiness</span>
          <span style={{ color: readBar, fontWeight: 700 }}>
            {pct}% ({g.passed}/{g.total})
          </span>
        </div>
        <div
          style={{
            height: 8,
            background: "rgba(27,42,74,0.08)",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: g.readyToGraduate ? GREEN : readBar,
              transition: "width 200ms ease",
            }}
          />
        </div>
      </div>

      {g.readyToGraduate && (
        <div
          style={{
            marginBottom: 10,
            padding: "6px 10px",
            background: `${GREEN}14`,
            border: `1px solid ${GREEN}55`,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            color: GREEN,
          }}
        >
          ✓ Ready to graduate {STAGE_LABEL[g.currentStage]} →{" "}
          {g.nextStage && STAGE_LABEL[g.nextStage]}
        </div>
      )}

      <div style={{ display: "grid", gap: 4 }}>
        {g.criteria.map((c) => (
          <CriterionRow key={c.id} c={c} />
        ))}
      </div>

      <div
        style={{
          fontSize: 11,
          color: DIM,
          marginTop: 10,
          fontStyle: "italic",
        }}
      >
        {g.summary}
      </div>
    </div>
  );
}

function CriterionRow({ c }: { c: Criterion }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 8,
        alignItems: "baseline",
        padding: "4px 0",
        borderBottom: `1px dashed ${BORDER}`,
        fontSize: 12,
      }}
    >
      <span
        style={{
          color: c.passed ? GREEN : RED,
          fontWeight: 800,
          fontSize: 12,
        }}
      >
        {c.passed ? "✓" : "✗"}
      </span>
      <span style={{ color: NAVY }}>{c.label}</span>
      <span
        style={{
          color: DIM,
          fontSize: 11,
          textAlign: "right",
          maxWidth: 220,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={c.detail}
      >
        {c.detail}
      </span>
    </div>
  );
}

function SummaryChip({
  label,
  count,
  color,
  active,
  highlight,
  onClick,
}: {
  label: string;
  count: number;
  color: string;
  active?: boolean;
  highlight?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${active ? color : `${color}44`}`,
        background: active ? `${color}1f` : highlight ? `${color}14` : `${color}0d`,
        color,
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        cursor: onClick ? "pointer" : "default",
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      <span style={{ fontSize: 14 }}>●</span>
      {count} {label}
    </button>
  );
}
