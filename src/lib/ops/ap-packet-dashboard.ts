/**
 * Pure derivation helpers for the AP Packet Dashboard (`/ops/ap-packets`).
 *
 * Every operator-facing label, status badge, and "recommended next
 * action" string on the dashboard goes through one of these helpers.
 * They take the raw packet roster row + lastSent + attachment summary
 * and return a normalized dashboard row plus a small list of "what
 * Rene should do next."
 *
 * Pure functions — no I/O, no time-of-day side effects beyond the
 * `now` parameter (always passed by the caller, defaulting to
 * `new Date()` in production). Easy to unit-test the contract:
 *
 *   - never invents data
 *   - never says "send me" when sending isn't wired
 *   - "ready-to-send + sent <30 days ago" surfaces as Sent, not as
 *     Action-required (we don't re-pester after a recent send)
 *   - missing/review attachments surface explicitly with the count
 */

export type PacketWiringStatus = "action-required" | "ready-to-send";

export interface AttachmentSummary {
  ready: number;
  optional: number;
  missing: number;
  review: number;
  total: number;
}

export interface PacketLastSent {
  sentAt: string;
  sentBy: string;
  messageId: string;
  threadId: string | null;
  approvalId?: string | null;
  subject?: string | null;
}

export interface PacketRosterRow {
  slug: string;
  accountName: string;
  apEmail: string;
  owner: string;
  status: PacketWiringStatus;
  dueWindow: string;
  pricingNeedsReview: boolean;
  attachmentSummary?: AttachmentSummary;
  nextActionsCount?: number;
  firstNextAction?: string | null;
  lastSent?: PacketLastSent | null;
}

export type DashboardSendStatus =
  | "not_yet_sent"
  | "sent_recently"
  | "sent_long_ago"
  | "blocked_missing_docs"
  | "blocked_pricing_review";

export interface DashboardRow {
  slug: string;
  accountName: string;
  owner: string;
  apEmail: string;
  /** Short human label for the page badge. */
  statusLabel: string;
  /** Stable machine code for the row's send state. */
  sendStatus: DashboardSendStatus;
  /** Highest-priority recommended next action; never invented. */
  recommendedAction: string;
  /** Optional secondary actions (smaller, after the main one). */
  secondaryActions: string[];
  attachmentSummary: AttachmentSummary;
  lastSentAt: string | null;
  lastSentBy: string | null;
  daysSinceLastSent: number | null;
  pricingNeedsReview: boolean;
  dueWindow: string;
}

const RECENT_SEND_DAYS = 30;

function emptySummary(): AttachmentSummary {
  return { ready: 0, optional: 0, missing: 0, review: 0, total: 0 };
}

/**
 * Compute days between two ISO timestamps. Returns null when either
 * is missing/unparseable so the dashboard can show "—" honestly.
 */
export function daysBetween(
  fromIso: string | null | undefined,
  now: Date,
): number | null {
  if (!fromIso) return null;
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return null;
  const diffMs = now.getTime() - t;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 3600 * 1000));
}

/**
 * Derive the dashboard row for a single packet.
 *
 * Priority order (highest first), so `recommendedAction` always
 * reflects the single most pressing thing:
 *   1. Pricing flagged for review → "Review pricing before send."
 *   2. Required attachments missing → "Resolve missing X / Y / Z."
 *   3. Attachments needing review → "Confirm <count> attachments."
 *   4. Already sent within 30d → "Sent <N> days ago — wait for buyer."
 *   5. Sent >30d → "Stale send — refresh ack with buyer."
 *   6. Status = ready-to-send → "Open packet → Send via Class B."
 *   7. Status = action-required (catch-all) → first nextActions entry.
 */
export function deriveDashboardRow(
  row: PacketRosterRow,
  now: Date = new Date(),
): DashboardRow {
  const summary = row.attachmentSummary ?? emptySummary();
  const days = daysBetween(row.lastSent?.sentAt ?? null, now);

  let sendStatus: DashboardSendStatus;
  let recommendedAction: string;
  const secondary: string[] = [];

  if (row.pricingNeedsReview) {
    sendStatus = "blocked_pricing_review";
    recommendedAction = "Review pricing — sheet flagged before send.";
  } else if (summary.missing > 0) {
    sendStatus = "blocked_missing_docs";
    recommendedAction = `Resolve ${summary.missing} missing attachment${summary.missing === 1 ? "" : "s"} before sending.`;
  } else if (summary.review > 0) {
    // Attachments with status='review' don't block but should be looked at.
    sendStatus = row.lastSent ? "sent_recently" : "not_yet_sent";
    recommendedAction = `Confirm ${summary.review} attachment${summary.review === 1 ? "" : "s"} flagged for review.`;
    if (!row.lastSent) {
      secondary.push("Open packet → Send via Class B once review clears.");
    }
  } else if (row.lastSent && days !== null && days <= RECENT_SEND_DAYS) {
    sendStatus = "sent_recently";
    recommendedAction = `Sent ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`} — wait for buyer ack.`;
  } else if (row.lastSent && days !== null && days > RECENT_SEND_DAYS) {
    sendStatus = "sent_long_ago";
    recommendedAction = `Stale send (${days} days) — follow up with buyer.`;
  } else if (row.status === "ready-to-send") {
    sendStatus = "not_yet_sent";
    recommendedAction = "Open packet → Send via Class B approval.";
  } else {
    // Status = action-required, no missing/review, no send history. Fall
    // back to the packet's own first nextActions entry, never invented.
    sendStatus = "not_yet_sent";
    recommendedAction =
      row.firstNextAction?.trim() ||
      "Open packet to see what Rene needs next.";
  }

  // Pricing flag is a soft warning that we surface as a secondary
  // action when it's not the primary blocker.
  if (
    row.pricingNeedsReview &&
    sendStatus !== "blocked_pricing_review" &&
    !recommendedAction.toLowerCase().includes("pricing")
  ) {
    secondary.push("Pricing also flagged for review.");
  }

  // Whenever there's a send history, surface the message id as a
  // secondary action so the operator can paste it into Gmail search.
  if (row.lastSent && row.lastSent.messageId) {
    secondary.push(
      `Last Gmail message id: ${row.lastSent.messageId}${row.lastSent.threadId ? ` (thread ${row.lastSent.threadId})` : ""}`,
    );
  }

  const statusLabel = labelFor(sendStatus);

  return {
    slug: row.slug,
    accountName: row.accountName,
    owner: row.owner,
    apEmail: row.apEmail,
    statusLabel,
    sendStatus,
    recommendedAction,
    secondaryActions: secondary,
    attachmentSummary: summary,
    lastSentAt: row.lastSent?.sentAt ?? null,
    lastSentBy: row.lastSent?.sentBy ?? null,
    daysSinceLastSent: days,
    pricingNeedsReview: row.pricingNeedsReview,
    dueWindow: row.dueWindow,
  };
}

function labelFor(s: DashboardSendStatus): string {
  switch (s) {
    case "not_yet_sent":
      return "Not yet sent";
    case "sent_recently":
      return "Sent (recent)";
    case "sent_long_ago":
      return "Sent (stale)";
    case "blocked_missing_docs":
      return "Blocked — missing docs";
    case "blocked_pricing_review":
      return "Blocked — pricing review";
    default:
      return "Unknown";
  }
}

export interface DashboardSummary {
  total: number;
  notYetSent: number;
  sentRecently: number;
  sentLongAgo: number;
  blockedMissingDocs: number;
  blockedPricingReview: number;
}

/** Aggregate counts for the page header. Pure. */
export function summarizeDashboard(rows: DashboardRow[]): DashboardSummary {
  const out: DashboardSummary = {
    total: rows.length,
    notYetSent: 0,
    sentRecently: 0,
    sentLongAgo: 0,
    blockedMissingDocs: 0,
    blockedPricingReview: 0,
  };
  for (const r of rows) {
    switch (r.sendStatus) {
      case "not_yet_sent":
        out.notYetSent += 1;
        break;
      case "sent_recently":
        out.sentRecently += 1;
        break;
      case "sent_long_ago":
        out.sentLongAgo += 1;
        break;
      case "blocked_missing_docs":
        out.blockedMissingDocs += 1;
        break;
      case "blocked_pricing_review":
        out.blockedPricingReview += 1;
        break;
    }
  }
  return out;
}

/**
 * Indicates whether a packet template source exists. The dashboard
 * uses this to decide whether to show a real "Create from template"
 * link or the explicit "not wired yet" placeholder.
 *
 * Wired 2026-04-26 — `src/lib/ops/ap-packets/templates.ts` now
 * exports the USA Gummies base template + a draft-creation helper.
 * The dashboard form posts to /api/ops/ap-packets/drafts which
 * persists drafts to KV without any email / QBO / Drive write.
 */
export function hasPacketTemplateRegistry(): boolean {
  return true;
}
