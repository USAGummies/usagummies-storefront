"use client";

import { useEffect, useState } from "react";

import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";
import {
  deriveProbeStatus,
  type EnvFlagRow,
  type ProbeRow,
  type SmokeCheckItem,
} from "@/lib/readiness/status";

const GREEN = "#15803d";
const AMBER = "#b45309";

interface ReadinessResponse {
  ok: boolean;
  generatedAt: string;
  env: {
    rows: EnvFlagRow[];
    totals: { ready: number; fallback: number; missing: number };
  };
  smokeChecklist: SmokeCheckItem[];
  probes: Array<{ url: string; label: string }>;
}

const ENV_STATUS_COLOR: Record<EnvFlagRow["status"], string> = {
  ready: GREEN,
  fallback: AMBER,
  missing: RED,
};

const PROBE_STATUS_COLOR: Record<ProbeRow["outcome"], string> = {
  ready: GREEN,
  degraded: AMBER,
  error: RED,
  skipped: DIM,
};

export function ReadinessView() {
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probeRows, setProbeRows] = useState<ProbeRow[]>([]);
  const [probesLoading, setProbesLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      setData(null);
      setProbeRows([]);
      try {
        const res = await fetch("/api/ops/readiness", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as
          | ReadinessResponse
          | { error?: string };
        if (cancelled) return;
        if (!res.ok || (body as ReadinessResponse).ok !== true) {
          setError(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
          return;
        }
        setData(body as ReadinessResponse);

        // Client-side probe of the listed read-only ops routes. Operator's
        // session cookie travels naturally; the page never sends auth
        // headers nor logs raw bodies.
        setProbesLoading(true);
        const probeResults = await Promise.all(
          (body as ReadinessResponse).probes.map(async (p) => {
            try {
              const r = await fetch(p.url, { cache: "no-store" });
              return deriveProbeStatus({
                url: p.url,
                label: p.label,
                response: { ok: r.ok, status: r.status },
              });
            } catch (err) {
              return deriveProbeStatus({
                url: p.url,
                label: p.label,
                response: null,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }),
        );
        if (!cancelled) {
          setProbeRows(probeResults);
          setProbesLoading(false);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  return (
    <div style={{ background: BG, minHeight: "100vh", padding: "24px 28px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 18,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              color: DIM,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            Internal · Read-only
          </div>
          <h1 style={{ color: NAVY, fontSize: 26, margin: "4px 0 0 0" }}>
            Production Readiness
          </h1>
          <p style={{ color: DIM, fontSize: 13, marginTop: 4 }}>
            What&apos;s configured, what&apos;s healthy, what to smoke. This
            page never mutates anything — no labels bought, no email sent, no
            QBO write, no KV write, no approvals touched.
          </p>
        </div>
        <button
          onClick={() => setRefreshTick((n) => n + 1)}
          style={{
            background: NAVY,
            color: "#fff",
            border: 0,
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </header>

      {error && (
        <div
          style={{
            background: `${RED}10`,
            border: `1px solid ${RED}40`,
            borderRadius: 8,
            padding: "10px 12px",
            color: RED,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Readiness fetch error: {error}
        </div>
      )}

      {data && (
        <>
          {/* Env band */}
          <section
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 8,
              }}
            >
              <h2
                style={{
                  color: GOLD,
                  fontSize: 13,
                  textTransform: "uppercase",
                  margin: 0,
                }}
              >
                Environment
              </h2>
              <span style={{ fontSize: 12, color: DIM }}>
                <span style={{ color: ENV_STATUS_COLOR.ready }}>
                  {data.env.totals.ready} ready
                </span>{" "}
                ·{" "}
                <span style={{ color: ENV_STATUS_COLOR.fallback }}>
                  {data.env.totals.fallback} fallback
                </span>{" "}
                ·{" "}
                <span style={{ color: ENV_STATUS_COLOR.missing }}>
                  {data.env.totals.missing} missing
                </span>
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ color: DIM, textAlign: "left" }}>
                    <Th>Env var</Th>
                    <Th>Status</Th>
                    <Th>Purpose</Th>
                    <Th>Detail</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.env.rows.map((r) => (
                    <tr
                      key={r.key}
                      style={{ borderTop: `1px dashed ${BORDER}` }}
                    >
                      <Td>
                        <code>{r.key}</code>
                      </Td>
                      <Td
                        style={{
                          color: ENV_STATUS_COLOR[r.status],
                          fontWeight: 600,
                        }}
                      >
                        {r.status}
                      </Td>
                      <Td style={{ color: DIM }}>{r.purpose}</Td>
                      <Td style={{ color: DIM }}>
                        {r.fallbackFrom
                          ? `Using ${r.fallbackFrom} as fallback.`
                          : (r.impactWhenMissing ?? "—")}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: DIM, marginTop: 8 }}>
              Boolean fingerprints only — this page never displays a raw env
              value.
            </p>
          </section>

          {/* Probe results */}
          <section
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 8,
              }}
            >
              <h2
                style={{
                  color: GOLD,
                  fontSize: 13,
                  textTransform: "uppercase",
                  margin: 0,
                }}
              >
                Read-only route probes
              </h2>
              <span style={{ fontSize: 12, color: DIM }}>
                {probesLoading
                  ? "probing…"
                  : `${probeRows.length} routes checked`}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ color: DIM, textAlign: "left" }}>
                    <Th>Route</Th>
                    <Th>Outcome</Th>
                    <Th>HTTP</Th>
                    <Th>Detail</Th>
                  </tr>
                </thead>
                <tbody>
                  {probeRows.map((r) => (
                    <tr
                      key={r.url}
                      style={{ borderTop: `1px dashed ${BORDER}` }}
                    >
                      <Td>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: NAVY, textDecoration: "underline" }}
                        >
                          {r.label}
                        </a>
                        <div style={{ color: DIM, fontSize: 11 }}>
                          <code>{r.url}</code>
                        </div>
                      </Td>
                      <Td
                        style={{
                          color: PROBE_STATUS_COLOR[r.outcome],
                          fontWeight: 600,
                        }}
                      >
                        {r.outcome}
                      </Td>
                      <Td>{r.httpStatus ?? "—"}</Td>
                      <Td style={{ color: DIM }}>{r.detail ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: DIM, marginTop: 8 }}>
              Probes run from your browser session. They GET only — none of
              these endpoints buy labels, send email, write QBO, or update
              approvals.
            </p>
          </section>

          {/* Smoke checklist */}
          <section
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                color: GOLD,
                fontSize: 13,
                textTransform: "uppercase",
                margin: "0 0 8px 0",
              }}
            >
              Manual smoke checklist
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <ChecklistGroup
                title="Public surfaces"
                items={data.smokeChecklist.filter(
                  (c) => c.surface === "public",
                )}
              />
              <ChecklistGroup
                title="Operator surfaces"
                items={data.smokeChecklist.filter(
                  (c) => c.surface === "operator",
                )}
              />
            </div>
          </section>
        </>
      )}

      <p style={{ fontSize: 11, color: DIM, marginTop: 22 }}>
        Generated{" "}
        {data?.generatedAt
          ? new Date(data.generatedAt).toLocaleString("en-US", {
              timeZone: "America/Los_Angeles",
            })
          : "—"}
        . This page is read-only. To unblock anything red here, set the env
        var in Vercel and redeploy.
      </p>
    </div>
  );
}

function ChecklistGroup({
  title,
  items,
}: {
  title: string;
  items: SmokeCheckItem[];
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: DIM,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((c) => (
          <li
            key={c.href}
            style={{ padding: "6px 0", borderTop: `1px dashed ${BORDER}` }}
          >
            <a
              href={c.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: NAVY, fontWeight: 600, fontSize: 13 }}
            >
              {c.label}
            </a>
            <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
              {c.description}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "6px 10px", fontWeight: 600 }}>{children}</th>;
}
function Td({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <td style={{ padding: "6px 10px", ...style }}>{children}</td>;
}
