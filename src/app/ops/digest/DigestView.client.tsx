"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useIsMobile } from "@/app/ops/hooks";
import {
  NAVY,
  RED,
  GOLD,
  CREAM as BG,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as TEXT_DIM,
} from "@/app/ops/tokens";

type DigestRow = {
  id: string;
  title: string;
  raw_text: string;
  summary_text: string | null;
  created_at: string;
};

function parseTableCells(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell, index, arr) => !(index === 0 && cell === "") && !(index === arr.length - 1 && cell === ""));
}

function stripStrongDelimiters(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("*") && trimmed.endsWith("*") && trimmed.length > 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function renderMarkdown(markdown: string, isMobile: boolean): ReactNode[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const raw = lines[i] || "";
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      blocks.push(
        <h3 key={`h3-${key++}`} style={{ margin: "14px 0 8px", color: NAVY, fontSize: 18 }}>
          {trimmed.replace(/^###\s+/, "")}
        </h3>,
      );
      i += 1;
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      blocks.push(
        <h2
          key={`h2-${key++}`}
          style={{
            margin: "18px 0 10px",
            color: NAVY,
            fontSize: 22,
            borderBottom: `1px solid ${BORDER}`,
            paddingBottom: 6,
          }}
        >
          {trimmed.replace(/^##\s+/, "")}
        </h2>,
      );
      i += 1;
      continue;
    }

    if (/^#\s+/.test(trimmed)) {
      blocks.push(
        <h1 key={`h1-${key++}`} style={{ margin: "0 0 10px", color: NAVY, fontSize: 30 }}>
          {trimmed.replace(/^#\s+/, "")}
        </h1>,
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i] || "").trim().startsWith("|")) {
        tableLines.push((lines[i] || "").trim());
        i += 1;
      }

      const headerCells = tableLines[0] ? parseTableCells(tableLines[0]) : [];
      const bodyRows = tableLines
        .slice(2)
        .map(parseTableCells)
        .filter((cells) => cells.length > 0);

      if (headerCells.length > 0) {
        blocks.push(
          <div key={`table-wrap-${key++}`} style={{ overflowX: "auto", margin: "10px 0 14px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  {headerCells.map((cell, idx) => (
                    <th
                      key={`th-${idx}`}
                      style={{
                        textAlign: idx === 0 ? "left" : "right",
                        padding: isMobile ? "8px 6px" : "10px 8px",
                        borderBottom: `1px solid ${BORDER}`,
                        color: NAVY,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {stripStrongDelimiters(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rowIndex) => (
                  <tr key={`tr-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`td-${rowIndex}-${cellIndex}`}
                        style={{
                          textAlign: cellIndex === 0 ? "left" : "right",
                          padding: isMobile ? "7px 6px" : "8px",
                          borderBottom: `1px solid ${BORDER}`,
                          color: cellIndex === 0 ? NAVY : "#111827",
                          fontSize: 13,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {stripStrongDelimiters(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test((lines[i] || "").trim())) {
        items.push((lines[i] || "").trim().replace(/^-\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${key++}`} style={{ margin: "8px 0 12px 18px", color: NAVY, padding: 0 }}>
          {items.map((item, idx) => (
            <li key={`li-${idx}`} style={{ marginBottom: 6, lineHeight: 1.45 }}>
              {stripStrongDelimiters(item)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] || "").trim())) {
        items.push((lines[i] || "").trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${key++}`} style={{ margin: "8px 0 12px 18px", color: NAVY, padding: 0 }}>
          {items.map((item, idx) => (
            <li key={`oli-${idx}`} style={{ marginBottom: 6, lineHeight: 1.45 }}>
              {stripStrongDelimiters(item)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    blocks.push(
      <p key={`p-${key++}`} style={{ margin: "8px 0", color: NAVY, lineHeight: 1.5 }}>
        {stripStrongDelimiters(trimmed)}
      </p>,
    );
    i += 1;
  }

  return blocks;
}

export function DigestView() {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<DigestRow | null>(null);

  async function loadDigest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/abra/digest", { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as {
        digest?: DigestRow | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || "Failed to load weekly digest");
      }
      setDigest(payload.digest || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load weekly digest");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDigest();
  }, []);

  const renderedDigest = useMemo(
    () => renderMarkdown(digest?.raw_text || "", isMobile),
    [digest?.raw_text, isMobile],
  );

  return (
    <div style={{ background: BG, minHeight: "100vh", paddingBottom: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: NAVY, fontSize: 30, letterSpacing: "-0.02em" }}>
            Weekly Strategy Session
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: TEXT_DIM }}>
            Latest Abra-generated Monday strategy digest.
          </div>
          {digest?.created_at ? (
            <div style={{ marginTop: 6, fontSize: 12, color: TEXT_DIM }}>
              Generated {new Date(digest.created_at).toLocaleString("en-US")}
            </div>
          ) : null}
        </div>
        <button
          onClick={() => void loadDigest()}
          disabled={loading}
          style={{
            border: `1px solid ${BORDER}`,
            background: loading ? `${GOLD}22` : CARD,
            color: NAVY,
            borderRadius: 10,
            padding: "8px 12px",
            fontWeight: 700,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div
          style={{
            border: `1px solid ${RED}55`,
            background: `${RED}0f`,
            color: RED,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      <section
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: isMobile ? "14px 12px" : "20px 24px",
        }}
      >
        {!loading && !digest ? (
          <div style={{ color: TEXT_DIM, fontSize: 14 }}>
            No weekly digest has been generated yet.
          </div>
        ) : null}
        {loading && !digest ? (
          <div style={{ color: TEXT_DIM, fontSize: 14 }}>Loading latest digest...</div>
        ) : null}
        {digest ? renderedDigest : null}
      </section>
    </div>
  );
}
