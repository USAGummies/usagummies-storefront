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
  /** Phase 16 — the matching control-plane approval's id when one
   *  exists for this packet. `null` when the packet was never
   *  promoted (or the lookup map omitted it). NEVER fabricated. */
  approvalId: string | null;
  /** Phase 16 — the matching control-plane approval's status:
   *  `"pending"` / `"approved"` / `"rejected"` / `"expired"` /
   *  `"stood-down"`. `null` when the packet has no associated
   *  approval (Phase 8 path, or the closer hasn't surfaced one
   *  yet, or the route caller omitted the lookup map). NEVER
   *  fabricated. */
  approvalStatus: string | null;
}

/**
 * Phase 16 — read-only approval lookup map. The list route builds
 * this from `approvalStore.listPending()` + `listByAgent(...)` and
 * passes it to `buildReviewPacketsView` so each row carries the
 * matching approval's id + status. The view helper NEVER fabricates
 * these fields — when the map is omitted, rows have
 * `{approvalId: null, approvalStatus: null}`.
 */
export interface ApprovalLookup {
  id: string;
  status: string;
}
export type ApprovalsByPacketId = Map<string, ApprovalLookup>;

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
 *
 * Phase 16: accepts an optional `approvalsByPacketId` lookup map so
 * each row can carry its matching control-plane approval's id +
 * status. When the map is omitted (Phase 13/14 callers), rows have
 * `{approvalId: null, approvalStatus: null}` — the view helper
 * NEVER fabricates these fields.
 */
export function buildReviewPacketsView(
  packets: ReceiptReviewPacket[],
  approvalsByPacketId?: ApprovalsByPacketId,
): ReviewPacketsView {
  const rows: ReviewPacketRow[] = packets.map((p) => {
    const vendor = packetVendor(p);
    const amount = packetAmount(p);
    const approval = approvalsByPacketId?.get(p.packetId);
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
      approvalId: approval?.id ?? null,
      approvalStatus: approval?.status ?? null,
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

/**
 * Phase 16 — approval-status filter values.
 *
 * `"any"` (default) = no filter; `"no-approval"` matches rows
 * where the packet was never promoted (approvalStatus is null);
 * any other string filters by exact match against the row's
 * `approvalStatus`. The route currently surfaces `"pending"` /
 * `"approved"` / `"rejected"` / `"expired"` / `"stood-down"`.
 */
export type ReviewPacketsApprovalStatusFilter =
  | "any"
  | "no-approval"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "stood-down";

const APPROVAL_STATUS_FILTER_VALUES: ReviewPacketsApprovalStatusFilter[] = [
  "any",
  "no-approval",
  "pending",
  "approved",
  "rejected",
  "expired",
  "stood-down",
];

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
  /** Phase 16 — approval-status filter. `"any"` (or undefined) =
   *  no filter; `"no-approval"` matches rows where approvalStatus
   *  is null; any other value filters by exact match. */
  approvalStatus?: ReviewPacketsApprovalStatusFilter;
  /** Phase 23 — case-insensitive substring match against
   *  `packetId`, `receiptId`, OR `approvalId`. Operator pastes any
   *  id from a Slack thread / audit log / CSV row and the table
   *  narrows to the matching row(s). Empty / whitespace-only =
   *  no filter. */
  idContains?: string;
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

  const approvalFilter =
    spec.approvalStatus && spec.approvalStatus !== "any"
      ? spec.approvalStatus
      : null;

  // Phase 23 — id-substring filter. Defensive: empty / whitespace
  // collapses to "no filter" so a stray keystroke can't hide rows.
  // Match is case-insensitive on packetId / receiptId / approvalId
  // (the three ids an operator might paste from a Slack thread or
  // audit log).
  const idNeedle =
    typeof spec.idContains === "string" &&
    spec.idContains.trim().length > 0
      ? spec.idContains.trim().toLowerCase()
      : null;

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
    if (approvalFilter) {
      if (approvalFilter === "no-approval") {
        if (row.approvalStatus !== null) return false;
      } else {
        if (row.approvalStatus !== approvalFilter) return false;
      }
    }
    if (idNeedle) {
      const packetIdLc = row.packetId.toLowerCase();
      const receiptIdLc = row.receiptId.toLowerCase();
      const approvalIdLc = row.approvalId?.toLowerCase() ?? "";
      if (
        !packetIdLc.includes(idNeedle) &&
        !receiptIdLc.includes(idNeedle) &&
        !approvalIdLc.includes(idNeedle)
      ) {
        return false;
      }
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

// ---------------------------------------------------------------------------
// Phase 15 — query-string parser (server-safe, no React imports)
// ---------------------------------------------------------------------------
//
// Pure adapter that turns a `URLSearchParams` (or any object with a
// `.get(name): string | null` method) into a `ReviewPacketsFilterSpec`.
// The list route (`GET /api/ops/docs/receipt-review-packets`) calls
// this server-side so client and server share the SAME filter
// semantics — no parallel implementations.
//
// Hard rules:
//   - Reads ONLY `status`, `vendor`, `createdAfter`, `createdBefore`.
//   - Unknown / extra params are ignored (defensive — operator URLs
//     can carry tracking params without affecting the filter).
//   - `status` accepts `all | draft | rene-approved | rejected`.
//     Anything else collapses to `undefined` (= no filter via the
//     canonical helper's defensive default).
//   - Empty / whitespace-only `vendor` / dates → omitted from the
//     spec entirely so the canonical helper's "empty = no filter"
//     branch fires.

const STATUS_VALUES: Array<ReviewPacketRowStatus | "all"> = [
  "all",
  "draft",
  "rene-approved",
  "rejected",
];

interface QueryReader {
  get(name: string): string | null;
}

export function parseReviewPacketsFilterSpec(
  query: QueryReader,
): ReviewPacketsFilterSpec {
  const spec: ReviewPacketsFilterSpec = {};
  const rawStatus = query.get("status");
  if (rawStatus !== null) {
    const candidate = rawStatus.trim();
    if (
      (STATUS_VALUES as string[]).includes(candidate)
    ) {
      spec.status = candidate as ReviewPacketRowStatus | "all";
    }
  }
  const rawVendor = query.get("vendor");
  if (typeof rawVendor === "string" && rawVendor.trim().length > 0) {
    spec.vendorContains = rawVendor;
  }
  const rawAfter = query.get("createdAfter");
  if (typeof rawAfter === "string" && rawAfter.trim().length > 0) {
    spec.createdAfter = rawAfter;
  }
  const rawBefore = query.get("createdBefore");
  if (typeof rawBefore === "string" && rawBefore.trim().length > 0) {
    spec.createdBefore = rawBefore;
  }
  const rawApprovalStatus = query.get("approvalStatus");
  if (rawApprovalStatus !== null) {
    const candidate = rawApprovalStatus.trim();
    if (
      (APPROVAL_STATUS_FILTER_VALUES as string[]).includes(candidate)
    ) {
      spec.approvalStatus = candidate as ReviewPacketsApprovalStatusFilter;
    }
  }
  // Phase 23 — id-substring search. Operator pastes a packetId,
  // receiptId, or approvalId from a Slack thread / audit log / CSV
  // row and the table narrows. `id` is the canonical query name.
  const rawId = query.get("id");
  if (typeof rawId === "string" && rawId.trim().length > 0) {
    spec.idContains = rawId;
  }
  return spec;
}

/**
 * Inverse of `parseReviewPacketsFilterSpec`. Builds a
 * `URLSearchParams` payload from a spec. Used by the client view to
 * encode the operator's filters into the list-route URL so the
 * server can pre-filter for larger datasets.
 *
 * Rules:
 *   - `status: "all"` (or undefined) → omitted (default at server).
 *   - Empty / whitespace-only string fields → omitted.
 *   - Other fields → added as `URLSearchParams` entries.
 */
export function reviewPacketsFilterSpecToQuery(
  spec: ReviewPacketsFilterSpec,
): URLSearchParams {
  const params = new URLSearchParams();
  if (spec.status && spec.status !== "all") {
    params.set("status", spec.status);
  }
  if (
    typeof spec.vendorContains === "string" &&
    spec.vendorContains.trim().length > 0
  ) {
    params.set("vendor", spec.vendorContains.trim());
  }
  if (
    typeof spec.createdAfter === "string" &&
    spec.createdAfter.trim().length > 0
  ) {
    params.set("createdAfter", spec.createdAfter.trim());
  }
  if (
    typeof spec.createdBefore === "string" &&
    spec.createdBefore.trim().length > 0
  ) {
    params.set("createdBefore", spec.createdBefore.trim());
  }
  if (spec.approvalStatus && spec.approvalStatus !== "any") {
    params.set("approvalStatus", spec.approvalStatus);
  }
  if (
    typeof spec.idContains === "string" &&
    spec.idContains.trim().length > 0
  ) {
    params.set("id", spec.idContains.trim());
  }
  return params;
}

// ---------------------------------------------------------------------------
// Phase 15 — server-side filter (operates on raw packets)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase 17 — cursor-based pagination (server-safe, pure)
// ---------------------------------------------------------------------------
//
// Deterministic cursor over the canonical sort order:
//   primary: createdAt DESC (most-recent-first)
//   tie-breaker: packetId ASC (stable when timestamps collide)
//
// Cursor is base64url-encoded JSON `{ts, packetId}` of the LAST
// item shown. The client treats it as opaque — only `data.ts`
// (server) reads it. Defensive on malformed input: `decode(...)`
// returns `null` on any parse failure or schema mismatch, and the
// route treats that as "first page".

export interface ReviewPacketCursor {
  ts: number;
  packetId: string;
}

export function encodeReviewPacketCursor(cursor: ReviewPacketCursor): string {
  const json = JSON.stringify({ ts: cursor.ts, packetId: cursor.packetId });
  // base64url so it's URL-safe without explicit encodeURIComponent.
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeReviewPacketCursor(
  cursor: string | null | undefined,
): ReviewPacketCursor | null {
  if (typeof cursor !== "string" || cursor.trim().length === 0) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.ts !== "number" || !Number.isFinite(o.ts)) return null;
    if (typeof o.packetId !== "string" || o.packetId.length === 0) return null;
    return { ts: o.ts, packetId: o.packetId };
  } catch {
    return null;
  }
}

/** Canonical comparator over the dashboard's sort order: createdAt
 *  desc, then packetId asc. Pure. */
function comparePacketsCanonical(
  a: ReceiptReviewPacket,
  b: ReceiptReviewPacket,
): number {
  const tsA = Date.parse(a.createdAt);
  const tsB = Date.parse(b.createdAt);
  // Unparseable timestamps sort to the end (treat as oldest).
  if (!Number.isFinite(tsA) && !Number.isFinite(tsB))
    return a.packetId.localeCompare(b.packetId);
  if (!Number.isFinite(tsA)) return 1;
  if (!Number.isFinite(tsB)) return -1;
  if (tsA !== tsB) return tsB - tsA;
  return a.packetId.localeCompare(b.packetId);
}

/** Predicate: is `p` strictly AFTER the cursor in the canonical
 *  sort? (i.e. paginate-next-page semantics). */
function isAfterCursor(
  p: ReceiptReviewPacket,
  cursor: ReviewPacketCursor,
): boolean {
  const ts = Date.parse(p.createdAt);
  if (!Number.isFinite(ts)) return true; // unparseable → after any cursor
  if (ts < cursor.ts) return true;
  if (ts > cursor.ts) return false;
  return p.packetId > cursor.packetId;
}

export interface PaginatedReviewPackets {
  page: ReceiptReviewPacket[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Phase 18 — CSV export (server-safe, pure)
// ---------------------------------------------------------------------------
//
// `renderReviewPacketsCsv(rows)` produces an RFC-4180-compatible
// CSV string from the dashboard's typed row shape. Pure: same
// input → same output. NEVER fabricates values — null / undefined
// fields render as an empty cell, not the literal "null".
//
// Hard rules locked by tests:
//   - Header row order is fixed (see CSV_COLUMNS below). Locked
//     so downstream finance tooling can rely on it.
//   - Empty input → header-only CSV (1 line). No empty-string
//     rows, no fabricated zero-value rows.
//   - Cells containing `,` / `"` / `\n` / `\r` are quoted; `"`
//     inside a quoted cell is doubled. Locked separately.
//   - Vendor / amount cells reuse the dashboard's `(ocr)` suffix
//     so the operator sees the same source attribution in the
//     CSV that they see in the table. Locked.
//   - `eligibilityMissing` joins with `|` (NOT `,`) so it
//     survives the CSV column boundary intact.
//   - `approvalStatus` null renders as empty; non-null renders
//     verbatim ("pending" / "approved" / etc.).

const CSV_COLUMNS = [
  "status",
  "packetId",
  "receiptId",
  "vendor",
  "vendorSource",
  "amountUsd",
  "amountSource",
  "currency",
  "eligibilityOk",
  "eligibilityMissing",
  "approvalId",
  "approvalStatus",
  "createdAt",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];

/** RFC-4180-style cell escaping. Pure. Returns the escaped cell
 *  string ready to drop into a comma-joined row. */
export function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.length === 0) return "";
  // Quote when the cell contains: comma, double-quote, CR, LF, or
  // leading/trailing whitespace (which Excel is happy to strip).
  const needsQuoting =
    s.includes(",") ||
    s.includes('"') ||
    s.includes("\n") ||
    s.includes("\r") ||
    s !== s.trim();
  if (!needsQuoting) return s;
  // Double-up internal quotes per RFC-4180.
  return `"${s.replace(/"/g, '""')}"`;
}

function cellFor(row: ReviewPacketRow, col: CsvColumn): string {
  switch (col) {
    case "status":
      return row.status;
    case "packetId":
      return row.packetId;
    case "receiptId":
      return row.receiptId;
    case "vendor":
      // Empty string for missing vendor — never `"—"` in CSV (the
      // em-dash is for the dashboard's table cell, not for finance
      // ops tooling). Locked by the null-vendor test.
      if (
        row.vendor === null ||
        row.vendor === undefined ||
        row.vendor.trim().length === 0
      ) {
        return "";
      }
      return formatVendorCell(row.vendor, row.vendorSource);
    case "vendorSource":
      return row.vendorSource;
    case "amountUsd":
      return row.amountUsd === null ||
        row.amountUsd === undefined ||
        !Number.isFinite(row.amountUsd)
        ? ""
        : row.amountUsd.toFixed(2);
    case "amountSource":
      return row.amountSource;
    case "currency":
      // Currency lives on the OCR suggestion only — surfaced in
      // the dashboard's Phase 7 sub-row but not directly on the
      // ReviewPacketRow today. Reserved column for forward-compat.
      return "";
    case "eligibilityOk":
      return row.eligibilityOk ? "true" : "false";
    case "eligibilityMissing":
      // Pipe-joined so the column boundary survives.
      return row.eligibilityMissing.join("|");
    case "approvalId":
      return row.approvalId ?? "";
    case "approvalStatus":
      return row.approvalStatus ?? "";
    case "createdAt":
      return row.createdAt;
  }
}

/**
 * Render a packet rowset as RFC-4180 CSV. Pure.
 *
 * @returns A single string ending with `\r\n` (RFC-4180 line
 *   terminator). Header is always present; empty input → header
 *   only. Caller wraps in `Content-Type: text/csv` and
 *   `Content-Disposition: attachment; filename=...`.
 */
export function renderReviewPacketsCsv(rows: ReviewPacketRow[]): string {
  const lines: string[] = [];
  lines.push(CSV_COLUMNS.join(","));
  for (const row of rows) {
    const cells = CSV_COLUMNS.map((col) => escapeCsvCell(cellFor(row, col)));
    lines.push(cells.join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Stable filename helper for the CSV download. Pure. Format:
 *  `usa-gummies-review-packets-YYYY-MM-DD.csv`. */
export function reviewPacketsCsvFilename(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  return `usa-gummies-review-packets-${yyyy}-${mm}-${dd}.csv`;
}

/**
 * Pure helper: take a packet array (assumed already filtered if
 * filters apply) and return the next page + cursor.
 *
 * Hard rules:
 *   - **Sort is internal.** The function re-sorts via the canonical
 *     comparator so callers don't have to. Idempotent when the input
 *     is already sorted.
 *   - **Limit is clamped** to [1, 500] mirroring the storage helper
 *     and route.
 *   - **`nextCursor` is null** when fewer than `limit` items remain
 *     after the cursor — operator sees "Load more" disabled.
 *   - **Malformed cursor** (e.g. tampered string) falls back to the
 *     first page rather than throwing — defensive.
 */
export function paginateReviewPackets(
  packets: ReceiptReviewPacket[],
  opts: { limit?: number; cursor?: string | null } = {},
): PaginatedReviewPackets {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const sorted = [...packets].sort(comparePacketsCanonical);
  const cursor = decodeReviewPacketCursor(opts.cursor);
  const afterCursor = cursor
    ? sorted.filter((p) => isAfterCursor(p, cursor))
    : sorted;
  const page = afterCursor.slice(0, limit);
  const nextCursor =
    afterCursor.length > limit && page.length > 0
      ? encodeReviewPacketCursor({
          ts: Date.parse(page[page.length - 1].createdAt),
          packetId: page[page.length - 1].packetId,
        })
      : null;
  return { page, nextCursor };
}

/**
 * Apply the canonical filter spec to a raw packet list. Used
 * server-side by the list route. Internally projects through
 * `buildReviewPacketsView` + `applyReviewPacketsFilters` so the
 * server's filter behavior is bit-identical to the client's. The
 * matching packets are returned in the same order they came in
 * (the route returns raw packets; the client re-derives the view).
 *
 * Phase 16: accepts the same optional `approvalsByPacketId` lookup
 * as `buildReviewPacketsView`. When the spec includes an
 * `approvalStatus` filter, the map is required for that filter to
 * have any effect — without it, every row's approvalStatus is null
 * and only `"any"` / `"no-approval"` will match.
 */
export function filterPacketsBySpec(
  packets: ReceiptReviewPacket[],
  spec: ReviewPacketsFilterSpec,
  approvalsByPacketId?: ApprovalsByPacketId,
): ReceiptReviewPacket[] {
  const view = buildReviewPacketsView(packets, approvalsByPacketId);
  const filtered = applyReviewPacketsFilters(view, spec);
  const allowed = new Set(filtered.rows.map((r) => r.packetId));
  return packets.filter((p) => allowed.has(p.packetId));
}
