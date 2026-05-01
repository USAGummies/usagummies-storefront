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

import type {
  OffGridQuote,
  OffGridQuotesBriefSlice,
  OffGridSeverity,
} from "@/lib/finance/off-grid-quotes";

interface OffGridResponse {
  ok?: boolean;
  generatedAt?: string;
  source?: {
    auditAction?: string;
    limit?: number;
    entriesRead?: number;
  };
  skipped?: Array<{ auditId: string; entityId?: string; reason: string }>;
  slice?: OffGridQuotesBriefSlice;
  error?: string;
  code?: string;
}

const SEVERITY_LABELS: Record<OffGridSeverity, string> = {
  below_floor: "Below floor",
  below_distributor_floor: "Distributor drift",
  between_grid_lines: "Between grid lines",
  above_grid: "Above grid",
  approved_class_c: "Class C approved",
};

const SEVERITY_COLORS: Record<OffGridSeverity, string> = {
  below_floor: RED,
  below_distributor_floor: "#b45309",
  between_grid_lines: GOLD,
  above_grid: NAVY,
  approved_class_c: "#1f7a3a",
};

export function OffGridQuotesView() {
  const [data, setData] = useState<OffGridResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/ops/finance/off-grid?limit=100", {
      method: "GET",
      cache: "no-store",
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as OffGridResponse | null;
        if (!res.ok || !body || body.ok !== true) {
          throw new Error(
            body?.error ?? body?.code ?? `HTTP ${res.status} ${res.statusText}`,
          );
        }
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
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

  const slice = data?.slice;
  const quotes = slice?.topQuotes ?? [];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: NAVY,
        padding: "32px clamp(16px, 4vw, 48px)",
      }}
    >
      <section style={{ maxWidth: 1240, margin: "0 auto" }}>
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
            <p style={eyebrowStyle}>Finance · Read-only</p>
            <h1 style={{ margin: 0, fontSize: "clamp(32px, 4vw, 52px)" }}>
              Off-grid quote visibility
            </h1>
            <p style={{ margin: "12px 0 0", color: DIM, maxWidth: 780 }}>
              Flags recent booth quotes whose per-bag price is outside the
              canonical B-tier grid. This is visibility only; Class C
              approvals and pricing doctrine stay in their existing lanes.
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

        {loading ? <Panel>Loading off-grid quote scan...</Panel> : null}
        {error ? (
          <Panel>
            <strong style={{ color: RED }}>Unable to load off-grid scan.</strong>
            <div style={{ color: DIM, marginTop: 6 }}>{error}</div>
          </Panel>
        ) : null}

        {slice ? (
          <>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                marginBottom: 16,
              }}
            >
              <Stat label="Candidates" value={slice.candidatesEvaluated} />
              <Stat
                label="Off-grid"
                value={quotes.length}
                color={slice.hasHardBlock ? RED : NAVY}
              />
              <Stat
                label="Below floor"
                value={slice.countsBySeverity.below_floor}
                color={RED}
              />
              <Stat
                label="Distributor drift"
                value={slice.countsBySeverity.below_distributor_floor}
                color="#b45309"
              />
              <Stat
                label="Skipped source rows"
                value={data?.skipped?.length ?? 0}
                color={DIM}
              />
            </div>

            <Panel>
              <div style={{ color: DIM, fontWeight: 800 }}>
                Source: {data?.source?.auditAction ?? "unknown"} ·{" "}
                {data?.source?.entriesRead ?? 0} audit entries read ·{" "}
                {slice.windowDescription}
              </div>
              <div style={{ marginTop: 6, color: DIM }}>
                Generated {formatTimestamp(data?.generatedAt)}
              </div>
            </Panel>

            <section style={sectionStyle}>
              <h2 style={{ margin: 0 }}>Flagged quotes</h2>
              {quotes.length === 0 ? (
                <div style={{ marginTop: 12, color: DIM }}>
                  No off-grid booth quotes found in the scanned audit window.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                  {quotes.map((quote) => (
                    <QuoteCard key={quote.candidate.id} quote={quote} />
                  ))}
                </div>
              )}
            </section>

            {(data?.skipped?.length ?? 0) > 0 ? (
              <section style={sectionStyle}>
                <h2 style={{ margin: 0 }}>Skipped source rows</h2>
                <p style={{ color: DIM, margin: "6px 0 12px" }}>
                  These audit rows could not be replayed from KV, so they were
                  not counted as either on-grid or off-grid.
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {data?.skipped?.map((row) => (
                    <div key={row.auditId} style={{ color: DIM }}>
                      <code>{row.entityId ?? row.auditId}</code> · {row.reason}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}

function QuoteCard({ quote }: { quote: OffGridQuote }) {
  const color = SEVERITY_COLORS[quote.severity];
  const deviation =
    quote.deviationPerBagUsd >= 0
      ? `+$${quote.deviationPerBagUsd.toFixed(2)}`
      : `-$${Math.abs(quote.deviationPerBagUsd).toFixed(2)}`;
  return (
    <article
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 16,
        background: "rgba(248,245,239,0.58)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 950 }}>
            {quote.candidate.customerName}
          </div>
          <div style={{ color: DIM, marginTop: 4 }}>
            {quote.candidate.bagCount.toLocaleString()} bags ·{" "}
            {formatTimestamp(quote.candidate.createdAt)}
          </div>
        </div>
        <span
          style={{
            alignSelf: "flex-start",
            borderRadius: 999,
            background: `${color}1A`,
            color,
            padding: "6px 10px",
            fontWeight: 950,
            fontSize: 12,
          }}
        >
          {SEVERITY_LABELS[quote.severity]}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          marginTop: 14,
        }}
      >
        <Meta label="Quoted" value={`$${quote.candidate.pricePerBagUsd.toFixed(2)}/bag`} />
        <Meta label="Nearest grid" value={`$${quote.nearestGridPrice.toFixed(2)}`} />
        <Meta label="Delta / bag" value={deviation} />
        <Meta label="Total delta" value={formatSignedUsd(quote.totalDeviationUsd)} />
      </div>
      <p style={{ margin: "14px 0 0", color: NAVY, lineHeight: 1.5 }}>
        {quote.reason}
      </p>
    </article>
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
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  color = NAVY,
}: {
  label: string;
  value: number;
  color?: string;
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
      <div style={{ color, fontSize: 30, fontWeight: 950, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: DIM, fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function formatSignedUsd(value: number): string {
  if (!Number.isFinite(value)) return "TBD";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "TBD";
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
