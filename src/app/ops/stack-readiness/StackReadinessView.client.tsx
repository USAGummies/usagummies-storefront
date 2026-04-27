"use client";

/**
 * Stack-readiness dashboard — Phase 28L.3.
 *
 * One-page view of every external service the system depends on,
 * grouped by architectural layer. Powered by
 * `GET /api/ops/stack-readiness`. Refreshes on mount + manual click.
 *
 * What's on the page:
 *   - Counts strip (ok / degraded / down / unprobed + average maturity).
 *   - Per-layer table (compute / storage / integration / auth / marketplace).
 *   - Each row: status pill, name, env-check, probe message, maturity
 *     bar, and a click-to-expand drawer with degradedMode +
 *     replacement plan + knownIssue.
 *
 * Inspired by Nate B. Jones, "stack literacy" gap — make-com being
 * silently broken for two weeks proved we needed a single surface
 * that tells the operator "your dependencies are healthy / not."
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  NAVY,
  GOLD,
  RED,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

type StackStatus = "ok" | "degraded" | "down" | "unprobed";
type StackLayer =
  | "compute"
  | "storage"
  | "integration"
  | "auth"
  | "marketplace";

interface Row {
  id: string;
  name: string;
  layer: StackLayer;
  envVars: string[];
  envOk: boolean;
  envMissing: string[];
  maturity: 1 | 2 | 3 | 4 | 5;
  status: StackStatus;
  message: string;
  latencyMs: number | null;
  probedAt: string;
  degradedMode: string;
  replacement: string;
  knownIssue?: string;
}

interface Summary {
  total: number;
  ok: number;
  degraded: number;
  down: number;
  unprobed: number;
  averageMaturity: number;
}

interface ApiResponse {
  ok: boolean;
  generatedAt: string;
  summary: Summary;
  rows: Row[];
}

const LAYER_ORDER: StackLayer[] = [
  "compute",
  "storage",
  "auth",
  "integration",
  "marketplace",
];

const LAYER_LABEL: Record<StackLayer, string> = {
  compute: "Compute",
  storage: "Storage",
  auth: "Auth",
  integration: "Integrations",
  marketplace: "Marketplaces",
};

const STATUS_COLOR: Record<StackStatus, { bg: string; fg: string }> = {
  ok: { bg: "#e6f4ea", fg: "#1e7a3a" },
  degraded: { bg: "#fff3cd", fg: "#8a5a00" },
  down: { bg: "#fde8e6", fg: "#9a1c1c" },
  unprobed: { bg: "#eef0f3", fg: "#566071" },
};

export function StackReadinessView() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/ops/stack-readiness", { cache: "no-store" });
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
  const rowsByLayer = useMemo(() => {
    const grouped: Record<StackLayer, Row[]> = {
      compute: [],
      storage: [],
      auth: [],
      integration: [],
      marketplace: [],
    };
    for (const r of rows) grouped[r.layer].push(r);
    return grouped;
  }, [rows]);

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
          Stack Readiness
        </h1>
        <p style={{ margin: "6px 0 0 0", color: DIM, fontSize: 13 }}>
          One row per external service we depend on. If a row is yellow or red,
          something downstream of us is — or is about to be — broken.
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
        <Tile label="Healthy" value={summary?.ok ?? "—"} accent="#1e7a3a" />
        <Tile label="Degraded" value={summary?.degraded ?? "—"} accent={GOLD} />
        <Tile label="Down" value={summary?.down ?? "—"} accent={RED} />
        <Tile label="Unprobed" value={summary?.unprobed ?? "—"} accent="#566071" />
        <Tile
          label="Avg maturity"
          value={
            summary
              ? summary.averageMaturity.toFixed(1)
              : "—"
          }
          accent={NAVY}
          hint="lower = more battle-tested"
        />
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
          {loading ? "Probing…" : "Re-probe"}
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

      {LAYER_ORDER.map((layer) => {
        const layerRows = rowsByLayer[layer];
        if (layerRows.length === 0) return null;
        return (
          <section key={layer} style={{ marginBottom: 20 }}>
            <h2
              style={{
                margin: "0 0 8px 0",
                color: NAVY,
                fontSize: 14,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {LAYER_LABEL[layer]}{" "}
              <span style={{ color: DIM, fontWeight: 400 }}>
                ({layerRows.length})
              </span>
            </h2>
            <div
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <table
                style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
              >
                <thead>
                  <tr style={{ background: "#fafafa", color: NAVY }}>
                    <th style={th}>Status</th>
                    <th style={th}>Service</th>
                    <th style={th}>Env</th>
                    <th style={th}>Probe</th>
                    <th style={{ ...th, textAlign: "right" }}>Maturity</th>
                  </tr>
                </thead>
                <tbody>
                  {layerRows.map((r) => {
                    const isExpanded = expanded === r.id;
                    const colors = STATUS_COLOR[r.status];
                    return (
                      <Fragment key={r.id}>
                        <tr
                          onClick={() =>
                            setExpanded(isExpanded ? null : r.id)
                          }
                          style={{
                            borderTop: `1px solid ${BORDER}`,
                            cursor: "pointer",
                          }}
                        >
                          <td style={td}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 10px",
                                borderRadius: 999,
                                background: colors.bg,
                                color: colors.fg,
                                fontSize: 11,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: 0.4,
                              }}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td style={td}>
                            <div style={{ color: NAVY, fontWeight: 500 }}>
                              {r.name}
                            </div>
                            <div
                              style={{
                                color: DIM,
                                fontSize: 11,
                                marginTop: 2,
                              }}
                            >
                              {r.id}
                            </div>
                          </td>
                          <td style={td}>
                            {r.envOk ? (
                              <span style={{ color: "#1e7a3a", fontSize: 12 }}>
                                ✓ all set
                              </span>
                            ) : (
                              <span style={{ color: "#9a1c1c", fontSize: 12 }}>
                                ✗ {r.envMissing.length} missing
                              </span>
                            )}
                          </td>
                          <td style={td}>
                            <div style={{ color: NAVY, fontSize: 12 }}>
                              {r.message}
                            </div>
                            {r.latencyMs !== null && (
                              <div
                                style={{
                                  color: DIM,
                                  fontSize: 11,
                                  marginTop: 2,
                                }}
                              >
                                {r.latencyMs}ms
                              </div>
                            )}
                          </td>
                          <td
                            style={{
                              ...td,
                              textAlign: "right",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <MaturityBar value={r.maturity} />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td
                              colSpan={5}
                              style={{ ...td, background: "#f8f8f5" }}
                            >
                              <DrawerRow
                                label="Degraded mode"
                                value={r.degradedMode}
                              />
                              <DrawerRow
                                label="Replacement plan"
                                value={r.replacement}
                              />
                              {r.knownIssue && (
                                <DrawerRow
                                  label="Known issue"
                                  value={r.knownIssue}
                                  emphasis
                                />
                              )}
                              {r.envMissing.length > 0 && (
                                <DrawerRow
                                  label="Missing env vars"
                                  value={r.envMissing.join(", ")}
                                  emphasis
                                />
                              )}
                              <DrawerRow
                                label="Required env vars"
                                value={
                                  r.envVars.length > 0
                                    ? r.envVars.join(", ")
                                    : "(none)"
                                }
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {data && (
        <p style={{ marginTop: 16, color: DIM, fontSize: 12 }}>
          Probed at {new Date(data.generatedAt).toLocaleString()} ·{" "}
          <a href="/ops" style={{ color: NAVY }}>
            ← Back to ops
          </a>
        </p>
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
        minWidth: 130,
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

function MaturityBar({ value }: { value: 1 | 2 | 3 | 4 | 5 }) {
  // 1 = battle-tested (green), 5 = deprecation-runway (red).
  const color =
    value <= 2 ? "#1e7a3a" : value === 3 ? GOLD : value === 4 ? "#cc6622" : RED;
  return (
    <span
      style={{
        display: "inline-flex",
        gap: 2,
        alignItems: "center",
      }}
      title={
        value === 1
          ? "Battle-tested core"
          : value === 2
            ? "Stable but watchable"
            : value === 3
              ? "Working but signs of fragility"
              : value === 4
                ? "Broken or known-flaky"
                : "Deprecation runway / replacing soon"
      }
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{
            width: 8,
            height: 12,
            borderRadius: 2,
            background: i <= value ? color : BORDER,
          }}
        />
      ))}
      <span style={{ marginLeft: 6, color: NAVY, fontSize: 12 }}>{value}/5</span>
    </span>
  );
}

function DrawerRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "150px 1fr",
        gap: 10,
        padding: "6px 0",
        fontSize: 12,
      }}
    >
      <div
        style={{
          color: DIM,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontSize: 10,
        }}
      >
        {label}
      </div>
      <div style={{ color: emphasis ? "#9a1c1c" : NAVY }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const td: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };
