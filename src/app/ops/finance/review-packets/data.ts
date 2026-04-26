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

// ---------------------------------------------------------------------------
// Phase 14 — operator filters
// ---------------------------------------------------------------------------
//
// Pure projection: takes a built `ReviewPacketsView` + a filter
// spec and returns a new view with filtered rows + recomputed
// counts. Same input → same output. The original view is not
// mutated. Counts ALWAYS reflect the filtered rows verbatim — no
// cached aggregates, no inflation.

export interface ReviewPacketsFilterSpec {
  /** Narrow to a single status. `"all"` (or undefined) = no filter. */
  status?: ReviewPacketRowStatus | "all";
  /** Case-insensitive substring match against the formatted
   *  vendor cell. Empty / whitespace-only strings = no filter. */
  vendorContains?: string;
  /** ISO date or date-time. Inclusive lower bound on `createdAt`.
   *  Unparseable values are treated as "no filter" (defensive —
   *  the operator's keystroke shouldn't accidentally hide rows). */
  createdAfter?: string;
  /** Inclusive upper bound. Unparseable → no filter. */
  createdBefore?: string;
}

/**
 * Apply operator filters to a built view. Pure.
 *
 * Locked rules:
 *   - `status: "all"` (or undefined) → all rows pass the status check.
 *   - `vendorContains: ""` (or undefined / whitespace) → all rows pass.
 *   - Vendor matching is case-insensitive AND tolerates the
 *     `(ocr)` source suffix (so the operator's "belmark" matches
 *     "Belmark Inc (ocr)" too).
 *   - `createdAfter` / `createdBefore` use `Date.parse` — invalid
 *     timestamps fall back to "no filter" (NEVER hides rows
 *     unexpectedly).
 *   - A row with an unparseable `createdAt` is treated as NOT
 *     matching the date filter (defensive — we don't show data
 *     we can't position in time).
 *   - Counts are recomputed from the filtered rows verbatim.
 */
export function applyReviewPacketsFilters(
  view: ReviewPacketsView,
  spec: ReviewPacketsFilterSpec,
): ReviewPacketsView {
  const status =
    spec.status && spec.status !== "all" ? spec.status : null;
  const vendorNeedle =
    typeof spec.vendorContains === "string" &&
    spec.vendorContains.trim().length > 0
      ? spec.vendorContains.trim().toLowerCase()
      : null;
  const afterMs = parseFilterDate(spec.createdAfter);
  const beforeMs = parseFilterDate(spec.createdBefore);

  const filtered = view.rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (vendorNeedle) {
      const haystack = formatVendorCell(row.vendor, row.vendorSource).toLowerCase();
      if (!haystack.includes(vendorNeedle)) return false;
    }
    if (afterMs !== null || beforeMs !== null) {
      const rowMs = Date.parse(row.createdAt);
      if (!Number.isFinite(rowMs)) return false; // unparseable → excluded under any date filter
      if (afterMs !== null && rowMs < afterMs) return false;
      if (beforeMs !== null && rowMs > beforeMs) return false;
    }
    return true;
  });

  return {
    rows: filtered,
    counts: {
      total: filtered.length,
      draft: filtered.filter((r) => r.status === "draft").length,
      reneApproved: filtered.filter((r) => r.status === "rene-approved").length,
      rejected: filtered.filter((r) => r.status === "rejected").length,
    },
  };
}

/** Parse a filter date string. Returns `null` on missing /
 *  whitespace / unparseable input — caller treats `null` as "no
 *  filter". Pure. */
function parseFilterDate(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}
