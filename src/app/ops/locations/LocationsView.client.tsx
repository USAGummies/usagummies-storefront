"use client";

import { useEffect, useMemo, useState } from "react";

import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

const GREEN = "#15803d";
const AMBER = "#b45309";

interface DraftRow {
  slug: string;
  name: string;
  state: string;
  cityStateZip: string;
  status: "needs_review" | "accepted" | "rejected";
  ingestSource: string;
  draftedAt: string;
  channel: "direct" | "faire";
  storeType: string;
}

interface IngestErrorRow {
  rowIndex: number;
  code: string;
  detail: string;
  identifier: string;
}

interface IngestResponse {
  ok: boolean;
  totals: {
    needs_review: number;
    accepted: number;
    rejected: number;
    total: number;
  };
  drafts: {
    needs_review: DraftRow[];
    accepted: DraftRow[];
    rejected: DraftRow[];
  };
  lastErrors: {
    recordedAt: string;
    ingestSource: string;
    errorCount: number;
    errors: IngestErrorRow[];
  } | null;
}

const STATUS_COLOR: Record<DraftRow["status"], string> = {
  needs_review: AMBER,
  accepted: GREEN,
  rejected: RED,
};

export function LocationsView() {
  const [data, setData] = useState<IngestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/ops/locations/ingest", {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as
          | IngestResponse
          | { error?: string };
        if (cancelled) return;
        if (!res.ok || (body as IngestResponse).ok !== true) {
          setError(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
          setData(null);
        } else {
          setData(body as IngestResponse);
          setError(null);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lastErrorsAt = useMemo(() => {
    if (!data?.lastErrors?.recordedAt) return null;
    return new Date(data.lastErrors.recordedAt).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
    });
  }, [data?.lastErrors?.recordedAt]);

  return (
    <div style={{ background: BG, minHeight: "100vh", padding: "24px 28px" }}>
      <header style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 13,
            color: DIM,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          Internal · Locations Review Queue
        </div>
        <h1 style={{ color: NAVY, fontSize: 26, margin: "4px 0 0 0" }}>
          Store Locator — drafts
        </h1>
        <p style={{ color: DIM, fontSize: 13, marginTop: 4 }}>
          <strong>Review queue only — public site unchanged.</strong> Records
          here are staged via <code>POST /api/ops/locations/ingest</code> and{" "}
          <em>do not</em> appear on{" "}
          <a href="/where-to-buy" style={{ color: GOLD }}>
            /where-to-buy
          </a>{" "}
          until they&apos;re promoted to{" "}
          <code>src/data/retailers.ts</code> via a separate PR.
        </p>
      </header>

      {loading && (
        <div style={{ color: DIM, fontSize: 13 }}>Loading queue…</div>
      )}

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
          Queue fetch error: {error}
        </div>
      )}

      {data && (
        <>
          {/* Summary band */}
          <section
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 16,
              display: "flex",
              gap: 24,
              flexWrap: "wrap",
              fontSize: 13,
            }}
          >
            <span>
              Total drafts: <strong>{data.totals.total}</strong>
            </span>
            <span style={{ color: STATUS_COLOR.needs_review }}>
              Needs review: <strong>{data.totals.needs_review}</strong>
            </span>
            <span style={{ color: STATUS_COLOR.accepted }}>
              Accepted: <strong>{data.totals.accepted}</strong>
            </span>
            <span style={{ color: STATUS_COLOR.rejected }}>
              Rejected: <strong>{data.totals.rejected}</strong>
            </span>
          </section>

          {/* Last-ingest errors */}
          {data.lastErrors && (
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
                  Last ingest
                </h2>
                <span style={{ fontSize: 12, color: DIM }}>
                  {lastErrorsAt} · source:{" "}
                  <code>{data.lastErrors.ingestSource}</code>
                </span>
              </div>
              {data.lastErrors.errorCount === 0 ? (
                <div style={{ fontSize: 12, color: GREEN }}>
                  No errors in the last ingest.
                </div>
              ) : (
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
                        <Th>Row</Th>
                        <Th>Code</Th>
                        <Th>Identifier</Th>
                        <Th>Detail</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lastErrors.errors.map((e) => (
                        <tr
                          key={`${e.rowIndex}-${e.identifier}`}
                          style={{ borderTop: `1px dashed ${BORDER}` }}
                        >
                          <Td>{e.rowIndex}</Td>
                          <Td style={{ color: RED, fontWeight: 600 }}>
                            {e.code}
                          </Td>
                          <Td>
                            <code>{e.identifier || "—"}</code>
                          </Td>
                          <Td>{e.detail}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Drafts by status */}
          <DraftsTable
            title="Needs review"
            drafts={data.drafts.needs_review}
            color={STATUS_COLOR.needs_review}
          />
          <DraftsTable
            title="Accepted (awaiting public promotion)"
            drafts={data.drafts.accepted}
            color={STATUS_COLOR.accepted}
            note="To publish, append the records to src/data/retailers.ts via PR. This page never publishes."
          />
          <DraftsTable
            title="Rejected"
            drafts={data.drafts.rejected}
            color={STATUS_COLOR.rejected}
          />
        </>
      )}

      <p style={{ fontSize: 11, color: DIM, marginTop: 22 }}>
        This page is read-only. Promotion to the public store locator
        (<code>src/data/retailers.ts</code>) is a deliberate, manual step. No
        Slack alert, no QBO write, no public publish happens from this surface.
      </p>
    </div>
  );
}

function DraftsTable(props: {
  title: string;
  drafts: DraftRow[];
  color: string;
  note?: string;
}) {
  return (
    <section
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
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
            color: props.color,
            fontSize: 13,
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          {props.title}
        </h2>
        <span style={{ fontSize: 12, color: DIM }}>
          {props.drafts.length} {props.drafts.length === 1 ? "row" : "rows"}
        </span>
      </div>
      {props.drafts.length === 0 ? (
        <div style={{ fontSize: 12, color: DIM }}>(empty)</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr style={{ color: DIM, textAlign: "left" }}>
                <Th>Name</Th>
                <Th>City / State</Th>
                <Th>Channel</Th>
                <Th>Type</Th>
                <Th>Source</Th>
                <Th>Drafted</Th>
              </tr>
            </thead>
            <tbody>
              {props.drafts.map((d) => (
                <tr key={d.slug} style={{ borderTop: `1px dashed ${BORDER}` }}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{d.name}</div>
                    <div style={{ color: DIM, fontSize: 11 }}>
                      slug <code>{d.slug}</code>
                    </div>
                  </Td>
                  <Td>{d.cityStateZip}</Td>
                  <Td>{d.channel}</Td>
                  <Td>{d.storeType}</Td>
                  <Td style={{ color: DIM }}>{d.ingestSource}</Td>
                  <Td style={{ color: DIM }}>{d.draftedAt?.slice(0, 10)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.note && (
        <p style={{ fontSize: 11, color: DIM, marginTop: 8 }}>{props.note}</p>
      )}
    </section>
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
