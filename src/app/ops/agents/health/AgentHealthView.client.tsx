"use client";

/**
 * Agent Health — Phase 28L.4.
 *
 * Doctrine view (vs the runtime view at /ops/agents/status).
 * Surfaces job vs task classification, owner, approver, lifecycle,
 * and doctrine flags (drew-owns, unowned, job-without-approver,
 * task-without-justification, runtime-broken).
 *
 * Inspired by Nate B. Jones, "Why 97.5% of Agents Fail" (Apr 23,
 * 2026): the failure mode is shipping tasks when you needed jobs.
 * This page makes the classification visible so we can argue about
 * the answer.
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

type Classification = "task" | "job";
type ApprovalClass = "A" | "B" | "C" | "D";
type Lifecycle =
  | "proposed"
  | "active"
  | "graduated"
  | "retired"
  | "parked";
type Health = "green" | "yellow" | "red";
type Owner = "ben" | "rene" | "claude" | "drew" | "unowned";

interface DoctrineFlag {
  flag: string;
  message: string;
}

interface Row {
  id: string;
  name: string;
  contract: string;
  classification: Classification;
  approvalClass: ApprovalClass;
  owner: Owner;
  approver: Owner | null;
  lifecycle: Lifecycle;
  runtimeBroken?: boolean;
  purpose: string;
  notes?: string;
  doctrineFlags: DoctrineFlag[];
  health: Health;
}

interface Summary {
  total: number;
  green: number;
  yellow: number;
  red: number;
  jobs: number;
  tasks: number;
  byLifecycle: Record<Lifecycle, number>;
  byApprovalClass: Record<ApprovalClass, number>;
  drewOwnedCount: number;
}

interface ApiResponse {
  ok: boolean;
  generatedAt: string;
  summary: Summary;
  rows: Row[];
}

const HEALTH_COLOR: Record<Health, { bg: string; fg: string }> = {
  green: { bg: "#e6f4ea", fg: "#1e7a3a" },
  yellow: { bg: "#fff3cd", fg: "#8a5a00" },
  red: { bg: "#fde8e6", fg: "#9a1c1c" },
};

const CLASS_COLOR: Record<ApprovalClass, string> = {
  A: "#1e7a3a",
  B: GOLD,
  C: "#cc6622",
  D: RED,
};

export function AgentHealthView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "issues">("all");
  const [classFilter, setClassFilter] = useState<"all" | Classification>(
    "all",
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/ops/agents/health", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ApiResponse;
      if (!j.ok) throw new Error("API returned ok:false");
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const filteredRows = useMemo(
    () =>
      rows
        .filter((r) => filter === "all" || r.health !== "green")
        .filter((r) => classFilter === "all" || r.classification === classFilter),
    [rows, filter, classFilter],
  );
  const summary = data?.summary;

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            margin: 0,
            color: NAVY,
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: -0.5,
          }}
        >
          Agent Health
        </h1>
        <p style={{ margin: "6px 0 0 0", color: DIM, fontSize: 13 }}>
          Doctrine view: classification, owner, approver, lifecycle, and any
          doctrinal flags. Pairs with the runtime view at{" "}
          <a href="/ops/agents/status" style={{ color: NAVY }}>
            /ops/agents/status
          </a>
          .
        </p>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Tile label="Total" value={summary?.total ?? "—"} accent={NAVY} />
        <Tile label="Healthy" value={summary?.green ?? "—"} accent="#1e7a3a" />
        <Tile label="Soft flag" value={summary?.yellow ?? "—"} accent={GOLD} />
        <Tile label="Doctrinal red" value={summary?.red ?? "—"} accent={RED} />
        <Tile label="Jobs" value={summary?.jobs ?? "—"} accent={NAVY} hint="closes a loop / moves state to terminal" />
        <Tile label="Tasks" value={summary?.tasks ?? "—"} accent={NAVY} hint="runs and reports; Nate's failure mode if not justified" />
        <Tile
          label="Drew-owned"
          value={summary?.drewOwnedCount ?? "—"}
          accent={summary && summary.drewOwnedCount > 0 ? RED : "#1e7a3a"}
          hint='Ben 2026-04-27: "drew owns nothing"'
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <Field label="Show">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "issues")}
            disabled={loading}
            style={selectStyle}
          >
            <option value="all">All agents</option>
            <option value="issues">Only flagged (yellow + red)</option>
          </select>
        </Field>
        <Field label="Classification">
          <select
            value={classFilter}
            onChange={(e) =>
              setClassFilter(e.target.value as "all" | Classification)
            }
            disabled={loading}
            style={selectStyle}
          >
            <option value="all">All</option>
            <option value="job">Jobs only</option>
            <option value="task">Tasks only</option>
          </select>
        </Field>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void refresh()}
          disabled={loading}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: `1px solid ${BORDER}`,
            background: CARD,
            color: NAVY,
            fontSize: 13,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {err && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "#fde8e6",
            color: "#9a1c1c",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          Failed to load: {err}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: 12,
        }}
      >
        {filteredRows.map((r) => (
          <AgentCard key={r.id} row={r} />
        ))}
        {!loading && filteredRows.length === 0 && (
          <div
            style={{
              padding: 24,
              color: DIM,
              fontSize: 13,
              textAlign: "center",
              gridColumn: "1 / -1",
            }}
          >
            No agents match the current filter.
          </div>
        )}
      </div>

      {data && (
        <p style={{ marginTop: 16, color: DIM, fontSize: 12 }}>
          Generated at {new Date(data.generatedAt).toLocaleString()} ·{" "}
          <a href="/ops" style={{ color: NAVY }}>
            ← Back to ops
          </a>
        </p>
      )}
    </div>
  );
}

function AgentCard({ row }: { row: Row }) {
  const colors = HEALTH_COLOR[row.health];
  const classColor = CLASS_COLOR[row.approvalClass];
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderLeft: `3px solid ${colors.fg}`,
        borderRadius: 8,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 999,
            background: colors.bg,
            color: colors.fg,
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {row.health}
        </span>
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 999,
            background: row.classification === "job" ? "#dbeafe" : "#f5e9d2",
            color: row.classification === "job" ? "#1d3a78" : "#7a5300",
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
          title={
            row.classification === "job"
              ? "Closes a loop / moves state to terminal"
              : "Runs and reports; Nate's failure mode if not justified"
          }
        >
          {row.classification}
        </span>
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 999,
            background: classColor,
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.4,
          }}
          title={`Class ${row.approvalClass} approval`}
        >
          Class {row.approvalClass}
        </span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            color: DIM,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {row.lifecycle}
        </span>
      </div>

      <div>
        <div style={{ color: NAVY, fontWeight: 600, fontSize: 14 }}>
          {row.name}
        </div>
        <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>{row.id}</div>
      </div>

      <div style={{ color: NAVY, fontSize: 12, lineHeight: 1.4 }}>
        {row.purpose}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "70px 1fr",
          gap: 4,
          fontSize: 12,
        }}
      >
        <div style={{ color: DIM }}>Owner</div>
        <div
          style={{
            color: row.owner === "drew" || row.owner === "unowned" ? RED : NAVY,
            fontWeight:
              row.owner === "drew" || row.owner === "unowned" ? 600 : 400,
            textTransform: "capitalize",
          }}
        >
          {row.owner}
        </div>
        <div style={{ color: DIM }}>Approver</div>
        <div style={{ color: NAVY, textTransform: "capitalize" }}>
          {row.approver ?? "—"}
        </div>
        <div style={{ color: DIM }}>Contract</div>
        <div style={{ color: NAVY, fontSize: 11 }}>
          {row.contract ? (
            <code style={{ fontSize: 11 }}>{row.contract}</code>
          ) : (
            <span style={{ color: DIM }}>—</span>
          )}
        </div>
      </div>

      {row.notes && (
        <div
          style={{
            color: DIM,
            fontSize: 11,
            fontStyle: "italic",
            paddingTop: 4,
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          {row.notes}
        </div>
      )}

      {row.doctrineFlags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            paddingTop: 6,
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          {row.doctrineFlags.map((f) => (
            <div
              key={f.flag}
              style={{
                fontSize: 11,
                color: f.flag === "task-without-justification" ? "#8a5a00" : "#9a1c1c",
              }}
            >
              <strong style={{ textTransform: "uppercase", letterSpacing: 0.3 }}>
                {f.flag}
              </strong>
              {" — "}
              {f.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number | string;
  accent: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "10px 14px",
        minWidth: 110,
      }}
      title={hint}
    >
      <div
        style={{
          color: DIM,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      <div
        style={{ color: accent, fontSize: 22, fontWeight: 600, marginTop: 2 }}
      >
        {value}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          color: DIM,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: `1px solid ${BORDER}`,
  background: "#fff",
  color: NAVY,
  fontSize: 13,
};
