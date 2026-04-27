/**
 * Pure projector: audit entry → dispatch-feed row.
 *
 * Phase 28g — read-side projection for the "Recent dispatch activity"
 * sub-card on `/ops/shipping/dispatch`. Server + client share this
 * helper so the rendered table can never disagree with the route's
 * shape. Defensive on malformed `after` payloads — entries that
 * don't fit the contract are SKIPPED (return null), NOT fabricated
 * with null fields. The operator only sees rows that genuinely
 * represent a state transition.
 *
 * Returned shape is JSON-safe + small: just enough for one row of
 * "what happened, on what shipment, by whom, when." The row carries
 * enough identity (source + orderNumber) that the client can build
 * a deep-link to `/ops/shipping/dispatch?search=<orderNumber>` if
 * desired.
 */
import type { AuditLogEntry } from "@/lib/ops/control-plane/types";

/** Action slug constants — exported so route + tests can lockstep. */
export const DISPATCH_AUDIT_ACTIONS = {
  mark: "shipping.dispatch.mark",
  clear: "shipping.dispatch.clear",
} as const;
export type DispatchAuditActionSlug =
  (typeof DISPATCH_AUDIT_ACTIONS)[keyof typeof DISPATCH_AUDIT_ACTIONS];

export interface DispatchFeedRow {
  /** Stable id, copied from the audit envelope. */
  id: string;
  /** ISO timestamp of the transition. */
  timestampIso: string;
  /** Action slug — narrowed for client switch statements. */
  action: "mark" | "clear";
  /** "amazon" | "shopify" | "manual" | "faire" — the source channel. */
  source: string;
  /** Marketplace order number. */
  orderNumber: string;
  /** Display-friendly short id (e.g. "…7208487266" for long Amazon ids). */
  orderNumberShort: string;
  /** "slack-reaction" or "ops-dashboard" — entry surface for the trail. */
  surface: "slack-reaction" | "ops-dashboard" | "unknown";
  /** Operator id — Slack user id ("U…") or sentinel. null when missing. */
  actorRef: string | null;
  /** Whether the transition resulted in a Slack thread reply. */
  postedThreadReply: boolean;
  /** Result — always "ok" today; "error" reserved for future failure paths. */
  result: "ok" | "error";
  /** Optional: when result==="error", the message verbatim. */
  errorMessage: string | null;
}

/**
 * Project a single audit entry to a feed row, or return null when the
 * entry doesn't represent a dispatch transition we recognize.
 *
 * Validation chain (any failure → null, no fabrication):
 *   - action is one of the registered dispatch slugs
 *   - entityId parses as `${source}:${orderNumber}` (colon required;
 *     multi-segment orderNumbers like "1016-F1" handled via slice)
 *   - entityType === "shipping.shipment" (defense-in-depth)
 *   - on result==="ok": after payload exists
 *   - on result==="error": error.message exists
 */
export function projectDispatchAuditEntryToFeedRow(
  entry: AuditLogEntry,
): DispatchFeedRow | null {
  const slug = entry.action;
  let action: "mark" | "clear";
  if (slug === DISPATCH_AUDIT_ACTIONS.mark) action = "mark";
  else if (slug === DISPATCH_AUDIT_ACTIONS.clear) action = "clear";
  else return null;

  if (entry.entityType !== "shipping.shipment") return null;

  const entityId = entry.entityId;
  if (typeof entityId !== "string" || !entityId.includes(":")) return null;
  const colonIdx = entityId.indexOf(":");
  const source = entityId.slice(0, colonIdx);
  const orderNumber = entityId.slice(colonIdx + 1);
  if (!source.trim() || !orderNumber.trim()) return null;

  // Dispatch entries always emit result==="ok" today (recordDispatchAudit
  // hard-codes it). Coerce non-ok/error variants ("skipped", "stood-down")
  // to "ok" for display — those don't reflect an actual transition we'd
  // surface differently. Future "error" path is reserved.
  const result: "ok" | "error" =
    entry.result === "error" ? "error" : "ok";

  // Defensive parse of `after` payload. Mark entries should have
  // dispatchedAt + surface + dispatchedBy. Clear entries have
  // {dispatchedAt: null}. Either is acceptable; we just probe.
  const after =
    typeof entry.after === "object" && entry.after !== null
      ? (entry.after as Record<string, unknown>)
      : {};
  const surfaceRaw =
    typeof after.surface === "string" ? after.surface : undefined;
  const surface: DispatchFeedRow["surface"] =
    surfaceRaw === "slack-reaction" || surfaceRaw === "ops-dashboard"
      ? surfaceRaw
      : "unknown";
  const actorRef =
    typeof after.dispatchedBy === "string" ? after.dispatchedBy : null;
  const postedThreadReply = Boolean(after.postedThreadReply);

  const errorMessage =
    result === "error" && entry.error && typeof entry.error === "object"
      ? typeof (entry.error as Record<string, unknown>).message === "string"
        ? ((entry.error as Record<string, unknown>).message as string)
        : null
      : null;
  // Error entries MUST carry a message — otherwise drop (no fabrication).
  if (result === "error" && !errorMessage) return null;

  return {
    id: entry.id,
    timestampIso: entry.createdAt ?? new Date().toISOString(),
    action,
    source,
    orderNumber,
    orderNumberShort: shortenOrderNumber(orderNumber),
    surface,
    actorRef,
    postedThreadReply,
    result,
    errorMessage,
  };
}

/**
 * Trim long order numbers for tighter row layout. Amazon order ids
 * are 19 chars (`XXX-XXXXXXX-XXXXXXX`); we keep only the trailing 8
 * and prefix with an ellipsis. Shopify numeric ids stay full.
 */
function shortenOrderNumber(orderNumber: string): string {
  if (orderNumber.length <= 12) return orderNumber;
  return `…${orderNumber.slice(-8)}`;
}

/**
 * Sort feed rows newest-first. Stable on identical timestamps via id.
 */
export function sortDispatchFeedRows(
  rows: readonly DispatchFeedRow[],
): DispatchFeedRow[] {
  return [...rows].sort((a, b) => {
    if (a.timestampIso !== b.timestampIso) {
      return a.timestampIso < b.timestampIso ? 1 : -1;
    }
    return a.id < b.id ? 1 : -1;
  });
}
