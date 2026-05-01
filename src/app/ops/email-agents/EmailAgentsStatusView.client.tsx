"use client";

import type React from "react";
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

import type { EmailAgentsStatus } from "@/lib/ops/email-agents-status";

interface StatusResponse {
  ok?: boolean;
  status?: EmailAgentsStatus;
  error?: string;
  code?: string;
}

interface HeartbeatRunRecord {
  runId: string;
  outputState: string;
  summary: string;
  nextHumanAction: string | null;
  degradedSources: string[];
  startedAt: string;
  finishedAt: string;
}

interface HeartbeatResponse {
  ok?: boolean;
  runRecord?: HeartbeatRunRecord;
  summary?: {
    readiness: EmailAgentsStatus["readiness"];
    gatesPassed: number;
    gatesTotal: number;
  };
  degraded?: string[];
  error?: string;
  code?: string;
}

const READINESS_LABELS: Record<EmailAgentsStatus["readiness"], string> = {
  blocked: "Blocked",
  ready_for_dry_run: "Ready for dry-run",
  active: "Active",
  misconfigured: "Misconfigured",
};

const READINESS_COLORS: Record<EmailAgentsStatus["readiness"], string> = {
  blocked: RED,
  ready_for_dry_run: GOLD,
  active: "#1f7a3a",
  misconfigured: RED,
};

export function EmailAgentsStatusView() {
  const [status, setStatus] = useState<EmailAgentsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [heartbeat, setHeartbeat] = useState<HeartbeatResponse | null>(null);
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);
  const [heartbeatLoading, setHeartbeatLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/ops/email-agents/status", {
      method: "GET",
      cache: "no-store",
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as StatusResponse | null;
        if (!res.ok || !body || body.ok !== true || !body.status) {
          throw new Error(
            body?.error ?? body?.code ?? `HTTP ${res.status} ${res.statusText}`,
          );
        }
        if (!cancelled) setStatus(body.status);
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: NAVY,
        padding: "32px clamp(16px, 4vw, 48px)",
      }}
    >
      <section style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 24,
          }}
        >
          <div>
            <p style={eyebrowStyle}>Ops · Email agent group</p>
            <h1 style={{ margin: 0, fontSize: "clamp(32px, 4vw, 52px)" }}>
              Email agents readiness
            </h1>
            <p style={{ margin: "12px 0 0", color: DIM, maxWidth: 780 }}>
              Read-only status for the email-agent build: incident gates,
              HubSpot schema gate, kill switch, and cron state. This page does
              not run the email-intel pipeline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((n) => n + 1)}
            style={buttonStyle}
          >
            Refresh
          </button>
        </header>

        {loading ? <Panel>Loading email-agent readiness...</Panel> : null}
        {error ? (
          <Panel>
            <strong style={{ color: RED }}>Unable to load status.</strong>
            <div style={{ color: DIM, marginTop: 6 }}>{error}</div>
          </Panel>
        ) : null}

        {status ? (
          <>
            <section
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                borderRadius: 20,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div
                    style={{
                      color: READINESS_COLORS[status.readiness],
                      fontWeight: 950,
                      fontSize: 24,
                    }}
                  >
                    {READINESS_LABELS[status.readiness]}
                  </div>
                  <div style={{ color: DIM, marginTop: 6 }}>
                    {status.nextSafeAction}
                  </div>
                </div>
                <div style={{ color: DIM, fontWeight: 800 }}>
                  Generated {formatTimestamp(status.generatedAt)}
                </div>
              </div>
            </section>

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                marginBottom: 16,
              }}
            >
              <Stat label="Runner enabled" value={status.enabled ? "Yes" : "No"} good={!status.enabled} />
              <Stat label="Cron configured" value={status.cronConfigured ? "Yes" : "No"} good={!status.cronConfigured} />
              <Stat label="HubSpot schema" value={status.hubspotSchemaReady ? "Ready" : "Blocked"} good={status.hubspotSchemaReady} />
              <Stat label="Blockers" value={String(status.blockers.length)} good={status.blockers.length === 0} />
            </div>

            <section style={sectionStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0 }}>Readiness heartbeat dry-run</h2>
                  <p style={{ margin: "8px 0 0", color: DIM, maxWidth: 760 }}>
                    Builds a canonical agent heartbeat run record from the
                    readiness gates. This writes only a fail-soft internal audit
                    row; it does not scan Gmail, draft replies, open approvals,
                    or run the email-intel pipeline.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHeartbeatLoading(true);
                    setHeartbeatError(null);
                    fetch("/api/ops/agents/email-intel/run", {
                      method: "POST",
                      cache: "no-store",
                    })
                      .then(async (res) => {
                        const body = (await res.json().catch(() => null)) as
                          | HeartbeatResponse
                          | null;
                        if (!res.ok || !body || body.ok !== true || !body.runRecord) {
                          throw new Error(
                            body?.error ??
                              body?.code ??
                              `HTTP ${res.status} ${res.statusText}`,
                          );
                        }
                        setHeartbeat(body);
                      })
                      .catch((err) => {
                        setHeartbeat(null);
                        setHeartbeatError(
                          err instanceof Error ? err.message : String(err),
                        );
                      })
                      .finally(() => setHeartbeatLoading(false));
                  }}
                  disabled={heartbeatLoading}
                  style={{
                    ...buttonStyle,
                    opacity: heartbeatLoading ? 0.55 : 1,
                    cursor: heartbeatLoading ? "wait" : "pointer",
                  }}
                >
                  {heartbeatLoading ? "Running..." : "Run dry-run"}
                </button>
              </div>

              {heartbeatError ? (
                <div style={{ marginTop: 12, color: RED, fontWeight: 800 }}>
                  {heartbeatError}
                </div>
              ) : null}

              {heartbeat?.runRecord ? (
                <div
                  style={{
                    border: `1px solid ${BORDER}`,
                    borderRadius: 14,
                    padding: 14,
                    marginTop: 14,
                    background: "#fffaf0",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <Pill tone={heartbeat.runRecord.outputState === "failed_degraded" ? "bad" : "good"}>
                      {heartbeat.runRecord.outputState}
                    </Pill>
                    <code style={{ color: DIM }}>{heartbeat.runRecord.runId}</code>
                  </div>
                  <p style={{ margin: "10px 0 0", color: NAVY, fontWeight: 800 }}>
                    {heartbeat.runRecord.summary}
                  </p>
                  {heartbeat.runRecord.nextHumanAction ? (
                    <p style={{ margin: "8px 0 0", color: DIM }}>
                      Next: {heartbeat.runRecord.nextHumanAction}
                    </p>
                  ) : null}
                  {heartbeat.summary ? (
                    <p style={{ margin: "8px 0 0", color: DIM }}>
                      Gates passed: {heartbeat.summary.gatesPassed}/
                      {heartbeat.summary.gatesTotal} · Readiness:{" "}
                      {READINESS_LABELS[heartbeat.summary.readiness]}
                    </p>
                  ) : null}
                  {(heartbeat.degraded?.length ?? 0) > 0 ? (
                    <p style={{ margin: "8px 0 0", color: GOLD, fontWeight: 800 }}>
                      Soft degradation: {heartbeat.degraded?.join("; ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section style={sectionStyle}>
              <h2 style={{ margin: 0 }}>Gates</h2>
              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                {status.gates.map((gate) => (
                  <div
                    key={gate.id}
                    style={{
                      border: `1px solid ${BORDER}`,
                      borderRadius: 14,
                      padding: 14,
                      background: gate.ok ? "rgba(31,122,58,0.06)" : "rgba(199,54,44,0.06)",
                    }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ color: gate.ok ? "#1f7a3a" : RED, fontWeight: 950 }}>
                        {gate.ok ? "PASS" : "BLOCKED"}
                      </span>
                      <strong>{gate.label}</strong>
                    </div>
                    <div style={{ color: DIM, marginTop: 6 }}>{gate.detail}</div>
                    <div style={{ color: DIM, marginTop: 4, fontSize: 12 }}>
                      Source: <code>{gate.source}</code>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section style={sectionStyle}>
              <h2 style={{ margin: 0 }}>Source docs</h2>
              <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
                {status.sourceDocs.map((doc) => (
                  <code key={doc} style={{ color: DIM }}>
                    {doc}
                  </code>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "good" | "bad";
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        borderRadius: 999,
        padding: "5px 9px",
        fontSize: 12,
        fontWeight: 950,
        color: tone === "good" ? "#1f7a3a" : RED,
        background:
          tone === "good" ? "rgba(31,122,58,0.08)" : "rgba(199,54,44,0.08)",
        border: `1px solid ${
          tone === "good" ? "rgba(31,122,58,0.18)" : "rgba(199,54,44,0.18)"
        }`,
      }}
    >
      {children}
    </span>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: 18,
      }}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div style={{ color: DIM, fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div
        style={{
          color: good ? "#1f7a3a" : RED,
          fontSize: 28,
          fontWeight: 950,
          marginTop: 6,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

const eyebrowStyle: React.CSSProperties = {
  margin: "0 0 8px",
  color: DIM,
  textTransform: "uppercase",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.08em",
};

const buttonStyle: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  background: CARD,
  color: NAVY,
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer",
};

const sectionStyle: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  padding: 18,
  marginTop: 16,
};
