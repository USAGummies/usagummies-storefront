"use client";

import {
  NAVY,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

type CohortRow = {
  cohort: string;
  cohortLabel: string;
  size: number;
  retention: number[];
};

type Props = {
  months: string[];
  rows: CohortRow[];
};

function cellBg(pct: number): string {
  const alpha = Math.max(0.06, Math.min(0.78, pct / 100));
  return `rgba(27,42,74,${alpha})`;
}

export function CohortHeatmap({ months, rows }: Props) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 }}>
      <div style={{ color: NAVY, fontWeight: 700, marginBottom: 10 }}>Cohort Retention</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: TEXT_DIM }}>No cohort data yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Cohort</th>
                <th style={{ textAlign: "right", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>Size</th>
                {months.map((month) => (
                  <th key={month} style={{ textAlign: "center", fontSize: 11, color: TEXT_DIM, paddingBottom: 8 }}>
                    {month}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cohort}>
                  <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", color: NAVY, fontWeight: 700 }}>
                    {row.cohortLabel}
                  </td>
                  <td style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 0", textAlign: "right", color: NAVY }}>
                    {row.size}
                  </td>
                  {row.retention.map((val, idx) => (
                    <td key={`${row.cohort}-${idx}`} style={{ borderTop: `1px solid ${BORDER}`, padding: "8px 6px", textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          minWidth: 50,
                          borderRadius: 6,
                          color: (val / 100) > 0.35 ? "#fff" : NAVY,
                          background: cellBg(val),
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "4px 6px",
                        }}
                      >
                        {val.toFixed(1)}%
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
