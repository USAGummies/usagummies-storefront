/**
 * Pure data shaping helpers for the Finance Review surface.
 *
 * These functions are extracted from the client view so they can be
 * unit-tested without rendering. They take the raw API payloads and
 * return:
 *   - sectionStatus: which queues are wired vs not-wired vs erroring
 *   - mondayActionList: the prioritized action list at the top of the
 *     page, distilling the four queues into a single "what Rene/Ben do
 *     today" view.
 *
 * Important contract: when a source doesn't have data we surface a
 * "not wired" / "no data" status rather than fabricating zeros, so the
 * page stays honest. Empty queue (HTTP 200 + 0 entries) is "ok, empty",
 * not "not wired" — treat them differently.
 */

export type SectionWiring = "wired" | "not_wired" | "error" | "empty";

export interface SectionStatus {
  wiring: SectionWiring;
  /** Operator-facing label, e.g. "12 receipts need review" or "Source not wired". */
  label: string;
  /** Optional short detail used in tooltip / next-line copy. */
  detail?: string;
  /** When `wiring === "error"`, the upstream error message. Never user-facing PII. */
  error?: string;
}

export interface ReceiptSummaryPayload {
  ok?: boolean;
  total_receipts?: number;
  needs_review?: number;
  ready?: number;
  total_amount?: number;
  by_vendor?: Record<string, { count: number; total: number }>;
  by_category?: Record<string, { count: number; total: number }>;
}

export interface ControlPlaneApprovalRow {
  id: string;
  action: string;
  actorAgentId: string;
  status: string;
  class: string;
  requiredApprovers: string[];
  createdAt: string;
  targetEntity?: { type: string; id?: string; label?: string } | null;
  evidence?: { confidence?: number; claim?: string };
}

export interface ControlPlaneApprovalsPayload {
  ok?: boolean;
  count?: number;
  approvals?: ControlPlaneApprovalRow[];
  error?: string;
  detail?: string;
}

export interface FreightCompTotals {
  queued?: number;
  approved?: number;
  posted?: number;
  rejected?: number;
  queuedDollars?: number;
  postedDollars?: number;
}
export interface FreightCompPayload {
  ok?: boolean;
  total?: number;
  totals?: FreightCompTotals;
  entries?: Array<{
    queuedAt: string;
    customerName: string;
    freightDollars: number;
    status: string;
  }>;
}

export interface ApPacketRow {
  slug: string;
  accountName: string;
  apEmail?: string;
  owner?: string;
  status: string;
  dueWindow?: string;
  pricingNeedsReview?: boolean;
}
export interface ApPacketsPayload {
  ok?: boolean;
  packets?: ApPacketRow[];
}

export interface MondayActionItem {
  id: string;
  title: string;
  count: number;
  detail: string;
  href: string;
  /** Higher = more urgent. Used to sort the list. */
  priority: number;
  status: SectionWiring;
}

// ---- Status derivation -----------------------------------------------------

export function deriveReceiptStatus(
  payload: ReceiptSummaryPayload | null,
  err: string | null,
): SectionStatus {
  if (err) return { wiring: "error", label: "Receipt summary failed", error: err };
  if (!payload || payload.ok !== true) {
    return { wiring: "error", label: "No receipt summary returned" };
  }
  const total = payload.total_receipts ?? 0;
  if (total === 0) {
    return {
      wiring: "empty",
      label: "No receipts captured yet",
      detail:
        "Once email-intel queues a receipt or the upload route accepts a receipt doc, this populates.",
    };
  }
  const needs = payload.needs_review ?? 0;
  const ready = payload.ready ?? 0;
  const usd = payload.total_amount ?? 0;
  return {
    wiring: "wired",
    label: `${needs} need review · ${ready} ready · $${usd.toFixed(2)} total`,
  };
}

export function deriveApprovalsStatus(
  payload: ControlPlaneApprovalsPayload | null,
  err: string | null,
): SectionStatus {
  if (err) return { wiring: "error", label: "Approvals API failed", error: err };
  if (!payload) return { wiring: "error", label: "No response from approvals API" };
  if (payload.ok === false) {
    return {
      wiring: "error",
      label: "Approvals API reported error",
      error: payload.error ?? payload.detail,
    };
  }
  const list = Array.isArray(payload.approvals) ? payload.approvals : [];
  if (list.length === 0) {
    return { wiring: "empty", label: "0 pending approvals" };
  }
  return { wiring: "wired", label: `${list.length} pending approvals` };
}

export function deriveFreightStatus(
  payload: FreightCompPayload | null,
  err: string | null,
): SectionStatus {
  if (err) return { wiring: "error", label: "Freight-comp API failed", error: err };
  if (!payload || payload.ok === false) {
    return { wiring: "error", label: "No response from freight-comp API" };
  }
  const t = payload.totals ?? {};
  const queued = t.queued ?? 0;
  if (queued === 0 && (payload.total ?? 0) === 0) {
    return { wiring: "empty", label: "Queue empty" };
  }
  return {
    wiring: "wired",
    label: `${queued} queued · $${(t.queuedDollars ?? 0).toFixed(2)} pending`,
  };
}

export function deriveApPacketsStatus(
  payload: ApPacketsPayload | null,
  err: string | null,
): SectionStatus {
  if (err) return { wiring: "error", label: "AP packets API failed", error: err };
  if (!payload || payload.ok === false) {
    return { wiring: "error", label: "No response from AP packets API" };
  }
  const list = payload.packets ?? [];
  if (list.length === 0) return { wiring: "empty", label: "No AP packets registered" };
  const reviewCount = list.filter((p) => p.pricingNeedsReview).length;
  if (reviewCount === 0) {
    return { wiring: "wired", label: `${list.length} packets · pricing all current` };
  }
  return {
    wiring: "wired",
    label: `${list.length} packets · ${reviewCount} need pricing review`,
  };
}

// ---- Phase 11 — Promote-review pill (per-receipt button feedback) ----------
//
// The "Request Rene review" button at each `needs_review` row POSTs to
// `/api/ops/docs/receipt/promote-review`. The route returns either an
// opened approval, a draft-only packet (eligibility failed or
// taxonomy gap), or an HTTP error. This pure helper maps the
// per-row state into a typed pill description so the client view can
// render without inlining branch logic, and the unit suite can lock
// the rendering rules without spinning up React.

export type PromoteReviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "opened";
      approvalId: string;
      status: string;
      requiredApprovers: string[];
      /** Phase 12 — Slack-thread permalink. `null` until resolved
       *  (or when the bot token is missing / Slack rejected). The
       *  pill renderer falls back to a non-link pill when null. */
      permalink?: string | null;
      /** Phase 12 — packet's current status, surfaced from the
       *  status-read route during polling. Defaults to the closer's
       *  pre-decision state (`"draft"`); flips to `"rene-approved"`
       *  or `"rejected"` once the closer runs. */
      packetStatus?: "draft" | "rene-approved" | "rejected";
    }
  | {
      kind: "draft-only";
      reason: string;
      missing?: string[];
    }
  | { kind: "error"; reason: string };

export type PromoteReviewPillVariant =
  | "idle"
  | "loading"
  | "opened"
  | "draft-only"
  | "error";

export interface PromoteReviewPill {
  variant: PromoteReviewPillVariant;
  /** Operator-facing label rendered in the pill. */
  label: string;
  /** Tailwind/inline-style color hint. */
  color: "neutral" | "amber" | "green" | "red";
  /** Optional second-line detail (e.g. truncated approval id). Empty
   *  string when no detail applies — keeps the renderer simple. */
  detail: string;
  /** Phase 12 — Slack-thread permalink. `null` when not resolved
   *  yet or in degraded mode. The pill renderer renders the
   *  approval id as a clickable link when present, plain text
   *  otherwise. NEVER fabricates. */
  permalink?: string | null;
}

/**
 * Pure projection: PromoteReviewState → PromoteReviewPill.
 *
 * Locked rules (covered by data.test.ts):
 *   - "idle" → invites the operator to click; no detail.
 *   - "loading" → muted spinner-style copy.
 *   - "opened" → green pill with the approval id (truncated) +
 *     status + approvers. NEVER fabricates an id when missing.
 *   - "draft-only" → amber pill with the route's verbatim reason
 *     plus the missing-fields list when present.
 *   - "error" → red pill with the underlying error message.
 *   - Reasons / errors are surfaced verbatim — no rewriting,
 *     no "approximately", no operator-friendly paraphrase that
 *     could mask the real cause.
 */
export function derivePromoteReviewPill(
  state: PromoteReviewState,
): PromoteReviewPill {
  switch (state.kind) {
    case "idle":
      return {
        variant: "idle",
        label: "Request Rene review",
        color: "neutral",
        detail: "",
      };
    case "loading":
      return {
        variant: "loading",
        label: "Requesting…",
        color: "neutral",
        detail: "",
      };
    case "opened": {
      const truncated = state.approvalId.slice(0, 8);
      const approvers = state.requiredApprovers.join(", ");
      // Phase 12 — when `packetStatus` flips to a terminal state
      // (closer ran), the label reflects Rene's decision. Color
      // stays green for `rene-approved`; flips to amber on
      // `rejected` so the operator sees the gap.
      const labelStatus =
        state.packetStatus === "rene-approved"
          ? "Rene approved"
          : state.packetStatus === "rejected"
            ? "Rene rejected"
            : `Approval opened · ${state.status}`;
      const color: "green" | "amber" =
        state.packetStatus === "rejected" ? "amber" : "green";
      return {
        variant: "opened",
        label: labelStatus,
        color,
        detail: `id: ${truncated}… · approvers: ${approvers || "(none)"}`,
        permalink:
          typeof state.permalink === "string" && state.permalink.length > 0
            ? state.permalink
            : null,
      };
    }
    case "draft-only": {
      const missing =
        Array.isArray(state.missing) && state.missing.length > 0
          ? ` · missing: ${state.missing.join(", ")}`
          : "";
      return {
        variant: "draft-only",
        label: "Draft packet only — no Slack approval opened",
        color: "amber",
        detail: `${state.reason}${missing}`,
      };
    }
    case "error":
      return {
        variant: "error",
        label: "Request failed",
        color: "red",
        detail: state.reason,
      };
  }
}

// ---- Monday action list ----------------------------------------------------

export function buildMondayActionList(args: {
  receipts: ReceiptSummaryPayload | null;
  approvals: ControlPlaneApprovalsPayload | null;
  freight: FreightCompPayload | null;
  apPackets: ApPacketsPayload | null;
  receiptsErr: string | null;
  approvalsErr: string | null;
  freightErr: string | null;
  apPacketsErr: string | null;
}): MondayActionItem[] {
  const items: MondayActionItem[] = [];

  // Receipts needing Rene review
  const receiptsStatus = deriveReceiptStatus(args.receipts, args.receiptsErr);
  const needsReview = args.receipts?.needs_review ?? 0;
  items.push({
    id: "receipts-needs-review",
    title: "Receipts needing Rene review",
    count: needsReview,
    detail:
      receiptsStatus.wiring === "error"
        ? receiptsStatus.error ?? "Receipt summary failed"
        : needsReview > 0
          ? "Email-intel queued these without a complete vendor/date/amount/category."
          : receiptsStatus.label,
    href: "#receipts",
    priority: needsReview > 0 ? 100 : 30,
    status: receiptsStatus.wiring,
  });

  // Pending Class B/C approvals
  const approvalsStatus = deriveApprovalsStatus(
    args.approvals,
    args.approvalsErr,
  );
  const approvalCount = Array.isArray(args.approvals?.approvals)
    ? args.approvals!.approvals!.length
    : 0;
  items.push({
    id: "approvals-pending",
    title: "Pending Class B/C approvals",
    count: approvalCount,
    detail:
      approvalsStatus.wiring === "error"
        ? approvalsStatus.error ?? "Approvals API failed"
        : approvalCount > 0
          ? "Vendor master, shipment, gmail.send and similar — decide in Slack #ops-approvals."
          : "Slack #ops-approvals will surface anything new the moment an agent opens it.",
    href: "#approvals",
    priority: approvalCount > 0 ? 90 : 20,
    status: approvalsStatus.wiring,
  });

  // Freight-comp queue
  const freightStatus = deriveFreightStatus(args.freight, args.freightErr);
  const queued = args.freight?.totals?.queued ?? 0;
  items.push({
    id: "freight-comp-queued",
    title: "Freight-comp items awaiting Rene",
    count: queued,
    detail:
      freightStatus.wiring === "error"
        ? freightStatus.error ?? "Freight-comp API failed"
        : queued > 0
          ? `~$${(args.freight?.totals?.queuedDollars ?? 0).toFixed(2)} of paired DEBIT 500050 / CREDIT 499010 entries.`
          : freightStatus.label,
    href: "#freight",
    priority: queued > 0 ? 80 : 10,
    status: freightStatus.wiring,
  });

  // AP packet follow-ups
  const apStatus = deriveApPacketsStatus(args.apPackets, args.apPacketsErr);
  const reviewCount = (args.apPackets?.packets ?? []).filter(
    (p) => p.pricingNeedsReview,
  ).length;
  items.push({
    id: "ap-packets-review",
    title: "AP packet follow-ups",
    count: reviewCount,
    detail:
      apStatus.wiring === "error"
        ? apStatus.error ?? "AP packets API failed"
        : reviewCount > 0
          ? "Pricing flagged for review on at least one packet."
          : apStatus.label,
    href: "#ap-packets",
    priority: reviewCount > 0 ? 70 : 5,
    status: apStatus.wiring,
  });

  return items.sort((a, b) => b.priority - a.priority);
}
