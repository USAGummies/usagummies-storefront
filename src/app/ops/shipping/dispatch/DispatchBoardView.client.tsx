"use client";

/**
 * Dispatch Board — open vs. dispatched at a glance.
 *
 * Companion to the Slack `:white_check_mark:` reaction flow. Shows
 * the last N labels with their dispatch state, lets the operator
 * mark one or many as dispatched in a single click. Useful for batch
 * dispatch when 10 packages are going out at once and reacting to
 * each label post in Slack would be tedious.
 *
 * Surface contract:
 *   - List polled on mount + on every Refresh click. No auto-poll
 *     (the operator drives the rhythm).
 *   - "Mark dispatched" + "Undo" are per-row buttons.
 *   - Per-row pill: amber = open, green = dispatched.
 *   - Counts strip up top: open / dispatched / total.
 *   - "Open thread" anchor when slackPermalink is non-null.
 */
import { useCallback, useEffect, useState } from "react";

import {
  NAVY,
  GOLD,
  SURFACE_CARD as CARD,
  SURFACE_BORDER as BORDER,
  SURFACE_TEXT_DIM as DIM,
} from "@/app/ops/tokens";

interface DispatchBoardRow {
  orderNumber: string | null;
  source: string | null;
  recipient: string | null;
  shipToPostalCode: string | null;
  carrierService: string | null;
  trackingNumber: string | null;
  shipmentCost: number | null;
  shipDate: string | null;
  slackPermalink: string | null;
  state: "open" | "dispatched";
  dispatchedAt: string | null;
  dispatchedBy: string | null;
}

interface DispatchBoardCounts {
  total: number;
  open: number;
  dispatched: number;
}

interface DispatchBoardData {
  ok: boolean;
  generatedAt: string;
  daysBack: number;
  counts: DispatchBoardCounts;
  rows: DispatchBoardRow[];
}

const PILL_OPEN_BG = "#fff4d6";
const PILL_OPEN_FG = "#7a5300";
const PILL_DISPATCHED_BG = "#dcf3e0";
const PILL_DISPATCHED_FG = "#1f6c2e";

export function DispatchBoardView() {
  const [data, setData] = useState<DispatchBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/ops/shipping/dispatch-board?daysBack=14&limit=100", {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as DispatchBoardData;
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

  const handleAction = useCallback(
    async (
      row: DispatchBoardRow,
      action: "mark" | "clear",
    ): Promise<void> => {
      const key = rowKey(row);
      if (!row.orderNumber || !row.source) return;
      setBusyOrder(key);
      setRowError((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      try {
        const r = await fetch("/api/ops/shipping/mark-dispatched", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderNumber: row.orderNumber,
            source: row.source,
            action,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { ok: boolean; error?: string };
        if (!j.ok) throw new Error(j.error ?? "API returned ok:false");
        await refresh();
      } catch (e) {
        setRowError((prev) => ({
          ...prev,
          [key]: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        setBusyOrder(null);
      }
    },
    [refresh],
  );

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
          Dispatch Board
        </h1>
        <p style={{ margin: "6px 0 0 0", color: DIM, fontSize: 13 }}>
          Open packages waiting to be dropped off, dispatched packages already
          gone. Mark dispatched here OR react with{" "}
          <span style={{ fontFamily: "ui-monospace, monospace" }}>
            :white_check_mark:
          </span>{" "}
          on the label post in <code>#shipping</code>.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <CountTile label="Open" value={data?.counts.open ?? "—"} accent={GOLD} />
        <CountTile
          label="Dispatched"
          value={data?.counts.dispatched ?? "—"}
          accent={NAVY}
        />
        <CountTile
          label="Total"
          value={data?.counts.total ?? "—"}
          accent="#888"
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
          {loading ? "Refreshing…" : "Refresh"}
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
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#fafafa", color: NAVY }}>
              <th style={th}>State</th>
              <th style={th}>Order #</th>
              <th style={th}>Recipient</th>
              <th style={th}>Carrier</th>
              <th style={th}>Tracking</th>
              <th style={th}>Cost</th>
              <th style={th}>Ship Date</th>
              <th style={{ ...th, textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => {
              const key = rowKey(row);
              const busy = busyOrder === key;
              const isOpen = row.state === "open";
              const error = rowError[key];
              return (
                <tr key={key} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={td}>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: 999,
                        background: isOpen ? PILL_OPEN_BG : PILL_DISPATCHED_BG,
                        color: isOpen ? PILL_OPEN_FG : PILL_DISPATCHED_FG,
                        fontWeight: 600,
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                      }}
                    >
                      {isOpen ? "Open" : "Dispatched"}
                    </span>
                    {!isOpen && row.dispatchedAt && (
                      <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
                        {formatRelative(row.dispatchedAt)}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    <code style={{ color: NAVY }}>
                      {row.orderNumber ?? "—"}
                    </code>
                    {row.source && (
                      <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
                        {row.source}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    {row.recipient ?? <span style={{ color: DIM }}>—</span>}
                    {row.shipToPostalCode && (
                      <div style={{ color: DIM, fontSize: 11, marginTop: 2 }}>
                        {row.shipToPostalCode}
                      </div>
                    )}
                  </td>
                  <td style={td}>{row.carrierService ?? "—"}</td>
                  <td style={td}>
                    <code style={{ color: NAVY }}>
                      {row.trackingNumber ?? "—"}
                    </code>
                  </td>
                  <td style={td}>
                    {row.shipmentCost !== null
                      ? `$${row.shipmentCost.toFixed(2)}`
                      : "—"}
                  </td>
                  <td style={td}>{row.shipDate ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {row.slackPermalink && (
                      <a
                        href={row.slackPermalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 12,
                          color: NAVY,
                          marginRight: 8,
                        }}
                      >
                        Open in Slack →
                      </a>
                    )}
                    {!row.orderNumber || !row.source ? (
                      <span style={{ color: DIM, fontSize: 11 }}>
                        no source
                      </span>
                    ) : isOpen ? (
                      <button
                        onClick={() => void handleAction(row, "mark")}
                        disabled={busy}
                        style={{
                          ...btn,
                          background: GOLD,
                          color: "#fff",
                          borderColor: GOLD,
                        }}
                      >
                        {busy ? "Marking…" : "Mark dispatched"}
                      </button>
                    ) : (
                      <button
                        onClick={() => void handleAction(row, "clear")}
                        disabled={busy}
                        style={{
                          ...btn,
                          background: CARD,
                          color: NAVY,
                          borderColor: BORDER,
                        }}
                      >
                        {busy ? "Undoing…" : "Undo"}
                      </button>
                    )}
                    {error && (
                      <div
                        style={{
                          color: "#9a1c1c",
                          fontSize: 11,
                          marginTop: 4,
                        }}
                      >
                        {error}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && data && data.rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...td, color: DIM, textAlign: "center", padding: 24 }}>
                  No shipments in the last {data.daysBack} days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, color: DIM, fontSize: 12 }}>
        ←{" "}
        <a href="/ops/shipping" style={{ color: NAVY }}>
          Back to Shipping Status
        </a>
      </p>
    </div>
  );
}

function CountTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
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
    >
      <div style={{ color: DIM, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ color: accent, fontSize: 22, fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function rowKey(r: DispatchBoardRow): string {
  return `${r.source ?? ""}:${r.orderNumber ?? ""}:${r.trackingNumber ?? ""}`;
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const ageMs = Date.now() - d.getTime();
    const mins = Math.round(ageMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
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
const btn: React.CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid",
  fontSize: 12,
  cursor: "pointer",
};
