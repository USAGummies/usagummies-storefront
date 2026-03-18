"use client";

import { useState } from "react";
import Link from "next/link";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ChannelRow = {
  channel: "shopify" | "amazon" | "faire" | "other";
  grossRevenue: number;
  fees: number;
  refunds: number;
  netPayout: number;
  bankDeposits: number;
  variance: number;
  variancePct: number;
  status: "matched" | "minor_variance" | "major_variance" | "missing_data";
  details: string[];
};

type ReconciliationReport = {
  period: { startDate: string; endDate: string; label: string };
  channels: ChannelRow[];
  totalGross: number;
  totalNet: number;
  totalBankDeposits: number;
  totalVariance: number;
  status: "clean" | "needs_review" | "discrepancies_found";
  generatedAt: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function channelLabel(c: string) {
  const map: Record<string, string> = {
    shopify: "Shopify",
    amazon: "Amazon",
    faire: "Faire",
    other: "Other",
  };
  return map[c] ?? c;
}

function statusBadge(status: ChannelRow["status"]) {
  const styles: Record<
    ChannelRow["status"],
    { bg: string; color: string; label: string }
  > = {
    matched: { bg: "#d1fae5", color: "#065f46", label: "Matched" },
    minor_variance: { bg: "#fef3c7", color: "#92400e", label: "Minor Variance" },
    major_variance: { bg: "#fee2e2", color: "#991b1b", label: "Major Variance" },
    missing_data: { bg: "#e5e7eb", color: "#374151", label: "Missing Data" },
  };
  const s = styles[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: s.bg,
        color: s.color,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function overallBanner(status: ReconciliationReport["status"]) {
  const map: Record<
    ReconciliationReport["status"],
    { bg: string; border: string; color: string; label: string }
  > = {
    clean: {
      bg: "#d1fae5",
      border: "#6ee7b7",
      color: "#065f46",
      label: "All channels reconciled -- no discrepancies.",
    },
    needs_review: {
      bg: "#fef3c7",
      border: "#fcd34d",
      color: "#92400e",
      label: "Some channels have minor variances that need review.",
    },
    discrepancies_found: {
      bg: "#fee2e2",
      border: "#fca5a5",
      color: "#991b1b",
      label: "Discrepancies found -- immediate attention required.",
    },
  };
  const s = map[status];
  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 8,
        backgroundColor: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        fontWeight: 600,
        fontSize: 14,
        marginBottom: 24,
      }}
    >
      {s.label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Month / Year selector helpers                                      */
/* ------------------------------------------------------------------ */

function getPreviousMonth(): { month: number; year: number } {
  const now = new Date();
  const m = now.getMonth(); // 0-indexed
  if (m === 0) return { month: 12, year: now.getFullYear() - 1 };
  return { month: m, year: now.getFullYear() };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ReconciliationView() {
  const prev = getPreviousMonth();
  const [month, setMonth] = useState(prev.month);
  const [year, setYear] = useState(prev.year);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(
    new Set()
  );

  async function generate() {
    setLoading(true);
    setError(null);
    setReport(null);
    setExpandedChannels(new Set());
    try {
      const res = await fetch("/api/ops/abra/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, year }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data: ReconciliationReport = await res.json();
      setReport(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function toggleChannel(ch: string) {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  }

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 3 }, (_, i) => currentYear - i);

  return (
    <div style={{ padding: 24, backgroundColor: BG, minHeight: "100vh" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <Link
            href="/ops/finance"
            style={{ color: TEXT_DIM, fontSize: 13, textDecoration: "none" }}
          >
            Finance
          </Link>
          <span style={{ color: TEXT_DIM, fontSize: 13, margin: "0 6px" }}>
            /
          </span>
          <span style={{ color: NAVY, fontSize: 13, fontWeight: 600 }}>
            Revenue Reconciliation
          </span>
          <h1 style={{ margin: "4px 0 0", color: NAVY, fontSize: 22 }}>
            Revenue Reconciliation
          </h1>
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${BORDER}`,
            backgroundColor: CARD,
            color: NAVY,
            fontSize: 14,
          }}
        >
          {MONTHS.map((m, i) => (
            <option key={i} value={i + 1}>
              {m}
            </option>
          ))}
        </select>

        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${BORDER}`,
            backgroundColor: CARD,
            color: NAVY,
            fontSize: 14,
          }}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <button
          onClick={generate}
          disabled={loading}
          style={{
            padding: "8px 20px",
            borderRadius: 6,
            border: "none",
            backgroundColor: loading ? TEXT_DIM : NAVY,
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Generating..." : "Generate Report"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            backgroundColor: "#fee2e2",
            border: "1px solid #fca5a5",
            color: "#991b1b",
            marginBottom: 24,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Report */}
      {report && (
        <>
          {/* Overall status */}
          {overallBanner(report.status)}

          {/* Period label */}
          <p
            style={{
              color: TEXT_DIM,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {report.period.label} ({report.period.startDate} &ndash;{" "}
            {report.period.endDate}) &middot; Generated{" "}
            {new Date(report.generatedAt).toLocaleString()}
          </p>

          {/* Table */}
          <div
            style={{
              backgroundColor: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              overflow: "auto",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: `1px solid ${BORDER}`,
                    textAlign: "left",
                  }}
                >
                  {[
                    "Channel",
                    "Gross Revenue",
                    "Fees",
                    "Refunds",
                    "Net Payout",
                    "Bank Deposits",
                    "Variance",
                    "Var %",
                    "Status",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 12px",
                        color: TEXT_DIM,
                        fontWeight: 600,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.channels.map((ch) => {
                  const expanded = expandedChannels.has(ch.channel);
                  return (
                    <ChannelRowComponent
                      key={ch.channel}
                      row={ch}
                      expanded={expanded}
                      onToggle={() => toggleChannel(ch.channel)}
                    />
                  );
                })}
                {/* Totals row */}
                <tr
                  style={{
                    borderTop: `2px solid ${BORDER}`,
                    fontWeight: 700,
                  }}
                >
                  <td style={{ padding: "10px 12px", color: NAVY }}>Total</td>
                  <td style={{ padding: "10px 12px", color: NAVY }}>
                    {fmt(report.totalGross)}
                  </td>
                  <td style={{ padding: "10px 12px" }} />
                  <td style={{ padding: "10px 12px" }} />
                  <td style={{ padding: "10px 12px", color: NAVY }}>
                    {fmt(report.totalNet)}
                  </td>
                  <td style={{ padding: "10px 12px", color: NAVY }}>
                    {fmt(report.totalBankDeposits)}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      color:
                        report.totalVariance === 0
                          ? "#065f46"
                          : Math.abs(report.totalVariance) < 100
                          ? "#92400e"
                          : "#991b1b",
                      fontWeight: 700,
                    }}
                  >
                    {fmt(report.totalVariance)}
                  </td>
                  <td style={{ padding: "10px 12px" }} />
                  <td style={{ padding: "10px 12px" }} />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Channel row                                                        */
/* ------------------------------------------------------------------ */

function ChannelRowComponent({
  row,
  expanded,
  onToggle,
}: {
  row: ChannelRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const varianceColor =
    row.variance === 0
      ? "#065f46"
      : Math.abs(row.variancePct) < 1
      ? "#92400e"
      : "#991b1b";

  return (
    <>
      <tr
        style={{
          borderBottom: `1px solid ${BORDER}`,
          cursor: row.details.length > 0 ? "pointer" : "default",
        }}
        onClick={row.details.length > 0 ? onToggle : undefined}
      >
        <td style={{ padding: "10px 12px", color: NAVY, fontWeight: 600 }}>
          {row.details.length > 0 && (
            <span style={{ marginRight: 6, fontSize: 10 }}>
              {expanded ? "\u25BC" : "\u25B6"}
            </span>
          )}
          {channelLabel(row.channel)}
        </td>
        <td style={{ padding: "10px 12px", color: NAVY }}>
          {fmt(row.grossRevenue)}
        </td>
        <td style={{ padding: "10px 12px", color: RED }}>
          {fmt(row.fees)}
        </td>
        <td style={{ padding: "10px 12px", color: RED }}>
          {fmt(row.refunds)}
        </td>
        <td style={{ padding: "10px 12px", color: NAVY }}>
          {fmt(row.netPayout)}
        </td>
        <td style={{ padding: "10px 12px", color: NAVY }}>
          {fmt(row.bankDeposits)}
        </td>
        <td style={{ padding: "10px 12px", color: varianceColor }}>
          {fmt(row.variance)}
        </td>
        <td style={{ padding: "10px 12px", color: varianceColor }}>
          {fmtPct(row.variancePct)}
        </td>
        <td style={{ padding: "10px 12px" }}>{statusBadge(row.status)}</td>
      </tr>
      {expanded && row.details.length > 0 && (
        <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
          <td colSpan={9} style={{ padding: "8px 12px 12px 36px" }}>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                color: TEXT_DIM,
                fontSize: 12,
                lineHeight: 1.7,
              }}
            >
              {row.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
