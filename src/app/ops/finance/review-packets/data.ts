/**
 * Pure data-shaping helpers for the Phase 13 aggregate review-packets
 * dashboard at `/ops/finance/review-packets`.
 *
 * Locked rules (covered by `__tests__/data.test.ts`):
 *   - **Sort:** draft-first, then most-recent-first by `createdAt`.
 *     Within the draft tier, eligible-but-not-yet-promoted rows
 *     surface above the rest (deterministic).
 *   - **Status → color:** draft=amber, rene-approved=green,
 *     rejected=red.
 *   - **Vendor fallback:** canonical wins; OCR is the fallback;
 *     missing renders as "—". NEVER fabricated.
 *   - **Amount fallback:** same canonical-then-OCR rule. NEVER
 *     synthesized from line items or anywhere else.
 *   - **Counts** are derived from the rows verbatim — no inflation.
 */

import type { ReceiptReviewPacket } from "@/lib/ops/receipt-review-packet";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReviewPacketRowStatus = "draft" | "rene-approved" | "rejected";

export type ReviewPacketStatusColor = "amber" | "green" | "red";

export interface ReviewPacketRow {
  packetId: string;
  /** Truncated 10-char prefix (`pkt-v1-…`) for compact display.
   *  Full id is `packetId`; the truncated form is for UI only. */
  packetIdShort: string;
  receiptId: string;
  status: ReviewPacketRowStatus;
  /** Color band hint for the status pill. Mirrors the contract on
   *  `derivePromoteReviewPill` from the per-row Phase 11/12 surface. */
  color: ReviewPacketStatusColor;
  vendor: string | null;
  /** Vendor's source: canonical | ocr-suggested | missing. Helps
   *  reviewers understand where the value came from at a glance. */
  vendorSource: "canonical" | "ocr-suggested" | "missing";
  amountUsd: number | null;
  amountSource: "canonical" | "ocr-suggested" | "missing";
  /** Eligibility flag from the original packet build. Surfaced in
   *  the table so reviewers can see why a `draft` packet hasn't
   *  produced an approval yet. */
  eligibilityOk: boolean;
  /** Missing-fields list verbatim from the original packet. Empty
   *  when eligible. */
  eligibilityMissing: string[];
  createdAt: string;
}

export interface ReviewPacketsCounts {
  total: number;
  draft: number;
  reneApproved: number;
  rejected: number;
}

export interface ReviewPacketsView {
  rows: ReviewPacketRow[];
  counts: ReviewPacketsCounts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<ReviewPacketRowStatus, ReviewPacketStatusColor> = {
  draft: "amber",
  "rene-approved": "green",
  rejected: "red",
};

// Sort priority: draft-first (because draft = "still actionable"),
// then terminal states. Within tiers, oldest first → newest first
// so the operator's eye lands on the most-recent activity.
const STATUS_PRIORITY: Record<ReviewPacketRowStatus, number> = {
  draft: 0,
  "rene-approved": 1,
  rejected: 2,
};

function packetVendor(packet: ReceiptReviewPacket): {
  value: string | null;
  source: "canonical" | "ocr-suggested" | "missing";
} {
  // Re-derive the vendor's source from the proposedFields merge that
  // the Phase 8 builder already produced. NEVER infers from any
  // other field; never falls back to a synthesized value.
  const f = packet.proposedFields.vendor;
  return { value: f.value, source: f.source };
}

function packetAmount(packet: ReceiptReviewPacket): {
  value: number | null;
  source: "canonical" | "ocr-suggested" | "missing";
} {
  const f = packet.proposedFields.amount;
  if (f.value === null || !Number.isFinite(f.value)) {
    return { value: null, source: f.source };
  }
  return { value: f.value, source: f.source };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the dashboard view from a list of packets. Pure: same
 * input → same output.
 */
export function buildReviewPacketsView(
  packets: ReceiptReviewPacket[],
): ReviewPacketsView {
  const rows: ReviewPacketRow[] = packets.map((p) => {
    const vendor = packetVendor(p);
    const amount = packetAmount(p);
    return {
      packetId: p.packetId,
      packetIdShort:
        p.packetId.length <= 14 ? p.packetId : `${p.packetId.slice(0, 14)}…`,
      receiptId: p.receiptId,
      status: p.status,
      color: STATUS_COLOR[p.status],
      vendor: vendor.value,
      vendorSource: vendor.source,
      amountUsd: amount.value,
      amountSource: amount.source,
      eligibilityOk: p.eligibility.ok,
      eligibilityMissing: [...p.eligibility.missing],
      createdAt: p.createdAt,
    };
  });

  rows.sort((a, b) => {
    const priorityDelta = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (priorityDelta !== 0) return priorityDelta;
    // Within same status: most-recent-first.
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    if (Number.isFinite(at) && Number.isFinite(bt)) return bt - at;
    if (Number.isFinite(bt)) return 1;
    if (Number.isFinite(at)) return -1;
    return 0;
  });

  const counts: ReviewPacketsCounts = {
    total: rows.length,
    draft: rows.filter((r) => r.status === "draft").length,
    reneApproved: rows.filter((r) => r.status === "rene-approved").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
  };

  return { rows, counts };
}

/**
 * Format an amount for the dashboard table cell. Pure. Returns
 * `"—"` when value is null. Never paraphrases / never invents.
 */
export function formatAmountCell(
  value: number | null,
  source: "canonical" | "ocr-suggested" | "missing",
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const formatted = `$${value.toFixed(2)}`;
  // Append a source hint so the operator can distinguish a
  // human-entered amount from an OCR suggestion at a glance.
  return source === "ocr-suggested" ? `${formatted} (ocr)` : formatted;
}

/** Format the vendor cell. Empty/null → "—". Never fabricates. */
export function formatVendorCell(
  value: string | null,
  source: "canonical" | "ocr-suggested" | "missing",
): string {
  if (!value || value.trim().length === 0) return "—";
  return source === "ocr-suggested" ? `${value} (ocr)` : value;
}
