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

import {
  buildReviewPacketsView,
  formatAmountCell,
  formatVendorCell,
  type ReviewPacketStatusColor,
  type ReviewPacketsView as ReviewPacketsViewShape,
} from "./data";

import type { ReceiptReviewPacket } from "@/lib/ops/receipt-review-packet";

const PILL_COLOR: Record<ReviewPacketStatusColor, string> = {
  amber: GOLD,
  green: "#1f7a3a",
  red: RED,
};

interface ListResponse {
  ok?: boolean;
  count?: number;
  packets?: ReceiptReviewPacket[];
  error?: string;
  reason?: string;
}

async function fetchPackets(): Promise<{
  view: ReviewPacketsViewShape | null;
  err: string | null;
}> {
  try {
    const res = await fetch("/api/ops/docs/receipt-review-packets?limit=200", {
      method: "GET",
      cache: "no-store",
    });
    let body: ListResponse | null = null;
    try {
      body = (await res.json()) as ListResponse;
    } catch {
      body = null;
    }
    if (!res.ok || !body || body.ok !== true) {
      const reason =
        body?.error ?? body?.reason ?? `HTTP ${res.status} ${res.statusText}`;
      return { view: null, err: reason };
    }
    const packets = Array.isArray(body.packets) ? body.packets : [];
    return { view: buildReviewPacketsView(packets), err: null };
  } catch (err) {
    return {
      view: null,
      err: err instanceof Error ? err.message : String(err),
    };
  }
}

export function ReviewPacketsView() {
  const [view, setView] = useState<ReviewPacketsViewShape | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchPackets().then((r) => {
      if (cancelled) return;
      setView(r.view);
      setErr(r.err);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const counts = view?.counts ?? null;
  const rows = view?.rows ?? [];
  const headerSummary = useMemo(() => {
    if (!counts) return "";
    return `${counts.total} packets · ${counts.draft} draft · ${counts.reneApproved} rene-approved · ${counts.rejected} rejected`;
  }, [counts]);

  return (
    <div style={{ background: BG, minHeight: "100vh", padding: 16 }}>
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: DIM }}>FINANCE / RENE QUEUE</div>
            <h1 style={{ color: NAVY, fontSize: 22, margin: "4px 0 0 0" }}>
              Receipt review packets
            </h1>
            <p style={{ color: DIM, fontSize: 12, marginTop: 4 }}>
              Read-only aggregate view. Promote a receipt from{" "}
              <a href="/ops/finance/review" style={{ color: NAVY }}>
                /ops/finance/review
              </a>{" "}
              to add a row here. No QBO writes happen on this page.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${BORDER}`,
              background: "#fff",
              color: NAVY,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {/* ---- Counts strip ---- */}
        {headerSummary && (
          <div
            style={{
              marginTop: 12,
              fontSize: 12,
              color: DIM,
              borderTop: `1px solid ${BORDER}`,
              borderBottom: `1px solid ${BORDER}`,
              padding: "8px 0",
            }}
          >
            {headerSummary}
          </div>
        )}

        {/* ---- Error / loading / empty ---- */}
        {err && (
          <p style={{ color: RED, fontSize: 12, marginTop: 12 }}>
            Failed to load packets: {err}
          </p>
        )}
        {loading && !view && (
          <p style={{ color: DIM, fontSize: 12, marginTop: 12 }}>Loading…</p>
        )}
        {view && rows.length === 0 && !err && (
          <p style={{ color: DIM, fontSize: 12, marginTop: 12 }}>
            No review packets yet. Click &ldquo;Request Rene review&rdquo; on a
            receipt at /ops/finance/review to create one.
          </p>
        )}

        {/* ---- Table ---- */}
        {rows.length > 0 && (
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
            >
              <thead>
                <tr style={{ color: DIM, textAlign: "left" }}>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Status
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Packet
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Receipt
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Vendor
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Amount
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Eligibility
                  </th>
                  <th style={{ padding: "6px 10px", fontWeight: 600 }}>
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.packetId}
                    style={{ borderTop: `1px dashed ${BORDER}` }}
                  >
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          color: PILL_COLOR[r.color],
                          fontWeight: 700,
                          textTransform: "uppercase",
                          fontSize: 10,
                          letterSpacing: 0.4,
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "6px 10px",
                        fontFamily: "monospace",
                        color: NAVY,
                      }}
                    >
                      {r.packetIdShort}
                    </td>
                    <td
                      style={{
                        padding: "6px 10px",
                        fontFamily: "monospace",
                        color: DIM,
                      }}
                    >
                      <a
                        href="/ops/finance/review#receipts"
                        style={{ color: DIM }}
                      >
                        {r.receiptId}
                      </a>
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {formatVendorCell(r.vendor, r.vendorSource)}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {formatAmountCell(r.amountUsd, r.amountSource)}
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      {r.eligibilityOk ? (
                        <span style={{ color: "#1f7a3a" }}>OK</span>
                      ) : (
                        <span style={{ color: RED }}>
                          missing: {r.eligibilityMissing.join(", ") || "(none)"}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "6px 10px",
                        color: DIM,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.createdAt.slice(0, 16)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ marginTop: 16, fontSize: 11, color: DIM }}>
          Read-only. Approve / reject decisions still go through the Slack
          approval card in <code>#ops-approvals</code>. The closer (Phase 10)
          is what flips a packet from <code>draft</code> to{" "}
          <code>rene-approved</code> or <code>rejected</code>. QBO posting
          still runs through a separate <code>qbo.bill.create</code> Class B/C
          action.
        </p>
      </div>
    </div>
  );
}
