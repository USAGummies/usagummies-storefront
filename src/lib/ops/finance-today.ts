/**
 * Finance Today — pure-logic aggregator for Rene's daily Slack card.
 *
 * Build 5 close-out per `docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md` §4
 * acceptance criterion "Rene has a clean approval station." The
 * receipt-review pipeline is end-to-end shipped (browser button →
 * `receipt.review.promote` Class B approval → closer → packet
 * transition). What was missing is the daily roll-up surface — what's
 * waiting on Rene right now? what's been Rene-approved and ready for
 * the (deferred) `qbo.bill.create` step? what's stale?
 *
 * This module is pure:
 *   - `summarizeFinanceToday(input)` — counts + categorize.
 *   - The route layer (`/api/ops/finance/today` + the Slack `finance
 *     today` handler) fetches the raw inputs (approvals + packets)
 *     fail-soft and feeds them here.
 *
 * No I/O. No env reads. Easy to test.
 *
 * Rules:
 *   - Read-only. Never opens approvals, never mutates packets, never
 *     writes to QBO/Plaid/HubSpot/Shopify.
 *   - No fabricated zeros — empty queue is `total: 0` + an explicit
 *     empty-state message in the brief, distinct from a degraded
 *     fetch which surfaces in `degraded`.
 */
import type { ApprovalRequest } from "./control-plane/types";
import type { ReceiptReviewPacket } from "./receipt-review-packet";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FinancePendingApproval {
  id: string;
  actorAgentId: string;
  action: string;
  createdAt: string;
  /** Days since createdAt (rounded). */
  ageDays: number;
}

export interface FinancePacketRow {
  packetId: string;
  receiptId: string;
  vendor: string | null;
  amount: number | null;
  status: ReceiptReviewPacket["status"];
  eligibilityOk: boolean;
  warnings: number;
  createdAt: string;
}

export interface FinanceTodaySummary {
  /** Pending receipt.review.promote approvals waiting on Rene. */
  pendingPromote: number;
  /** Total pending finance-class approvals (any slug). */
  pendingFinanceApprovals: number;
  /** Packets in `draft` status — captured but not yet promoted. */
  draftPackets: number;
  /** Packets in `rene-approved` status — eligible for the deferred QBO bill step. */
  reneApprovedPackets: number;
  /** Packets in `rejected` status — operator should review the reason. */
  rejectedPackets: number;
  /** Eligible-but-not-promoted packets — the actionable bucket on the dashboard. */
  draftEligiblePackets: number;
  /** Top 5 oldest pending approvals (oldest createdAt first). */
  oldestPendingApprovals: FinancePendingApproval[];
  /** Top 5 highest-priority packets for the daily card. */
  topPackets: FinancePacketRow[];
  /** Posture: green (clean) / yellow (work waiting) / red (stale > 3d) */
  posture: "green" | "yellow" | "red";
  /** Sources that failed to load. */
  degraded: string[];
}

export interface FinanceTodayInput {
  pendingApprovals: ReadonlyArray<ApprovalRequest>;
  packets: ReadonlyArray<ReceiptReviewPacket>;
  /** Override "now" for deterministic tests. */
  now?: Date;
  /** Sources that failed to load — passed through to summary. */
  degraded?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOP_N = 5;
const STALE_DAYS = 3;
const FINANCE_DIVISIONS: ReadonlySet<string> = new Set(["financials"]);
const RECEIPT_PROMOTE_SLUG = "receipt.review.promote";

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export function summarizeFinanceToday(
  input: FinanceTodayInput,
): FinanceTodaySummary {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  let pendingPromote = 0;
  let pendingFinanceApprovals = 0;
  const financePending: ApprovalRequest[] = [];

  for (const a of input.pendingApprovals) {
    if (!FINANCE_DIVISIONS.has(a.division)) continue;
    pendingFinanceApprovals += 1;
    financePending.push(a);
    // Action slug isn't on the request directly; we infer from `action`
    // string + the targetEntity label. The promote-review route uses
    // a stable phrase; we accept either.
    if (
      a.action.toLowerCase().includes("rene") ||
      a.targetEntity?.type === "receipt-review-packet" ||
      a.action.toLowerCase().includes(RECEIPT_PROMOTE_SLUG)
    ) {
      pendingPromote += 1;
    }
  }

  const oldestPendingApprovals: FinancePendingApproval[] = [...financePending]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, TOP_N)
    .map((a) => ({
      id: a.id,
      actorAgentId: a.actorAgentId,
      action: a.action,
      createdAt: a.createdAt,
      ageDays: Math.max(
        0,
        Math.round((nowMs - Date.parse(a.createdAt)) / (24 * 3600 * 1000)),
      ),
    }));

  let draftPackets = 0;
  let reneApprovedPackets = 0;
  let rejectedPackets = 0;
  let draftEligiblePackets = 0;
  const allRows: FinancePacketRow[] = [];

  for (const p of input.packets) {
    const row = projectPacket(p);
    allRows.push(row);
    if (p.status === "draft") {
      draftPackets += 1;
      if (row.eligibilityOk) draftEligiblePackets += 1;
    } else if (p.status === "rene-approved") {
      reneApprovedPackets += 1;
    } else if (p.status === "rejected") {
      rejectedPackets += 1;
    }
  }

  // Top packets priority:
  //   1. draft + eligible (Rene needs to approve)
  //   2. rene-approved (operator queues qbo.bill.create)
  //   3. draft + ineligible (warnings to fix)
  //   4. rejected (review reason)
  // Within each bucket, oldest createdAt first.
  const priority: Record<ReceiptReviewPacket["status"], number> = {
    draft: 0,
    "rene-approved": 1,
    rejected: 2,
  };
  const sorted = [...allRows].sort((a, b) => {
    const aBucket = bucket(a);
    const bBucket = bucket(b);
    if (aBucket !== bBucket) return aBucket - bBucket;
    const ap = priority[a.status];
    const bp = priority[b.status];
    if (ap !== bp) return ap - bp;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
  const topPackets = sorted.slice(0, TOP_N);

  const posture = computePosture({
    pendingFinanceApprovals,
    draftEligiblePackets,
    oldestPendingApprovals,
    nowMs,
  });

  return {
    pendingPromote,
    pendingFinanceApprovals,
    draftPackets,
    reneApprovedPackets,
    rejectedPackets,
    draftEligiblePackets,
    oldestPendingApprovals,
    topPackets,
    posture,
    degraded: [...(input.degraded ?? [])],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bucket(r: FinancePacketRow): number {
  // 0 = draft + eligible (highest priority — Rene needs to act)
  // 1 = rene-approved (operator queues bill)
  // 2 = draft + warnings (needs fixing before promotion)
  // 3 = rejected (lowest — already terminal)
  if (r.status === "draft" && r.eligibilityOk) return 0;
  if (r.status === "rene-approved") return 1;
  if (r.status === "draft") return 2;
  return 3;
}

function projectPacket(p: ReceiptReviewPacket): FinancePacketRow {
  const vendor =
    p.canonical.vendor ??
    (p.proposedFields.vendor.value as string | null) ??
    null;
  const amount = p.canonical.amount ?? p.proposedFields.amount.value ?? null;
  return {
    packetId: p.packetId,
    receiptId: p.receiptId,
    vendor,
    amount: typeof amount === "number" ? amount : null,
    status: p.status,
    eligibilityOk: p.eligibility.ok,
    warnings: p.eligibility.warnings.length,
    createdAt: p.createdAt,
  };
}

function computePosture(args: {
  pendingFinanceApprovals: number;
  draftEligiblePackets: number;
  oldestPendingApprovals: FinancePendingApproval[];
  nowMs: number;
}): "green" | "yellow" | "red" {
  const stale = args.oldestPendingApprovals.find(
    (a) => a.ageDays >= STALE_DAYS,
  );
  if (stale) return "red";
  if (args.pendingFinanceApprovals > 0 || args.draftEligiblePackets > 0) {
    return "yellow";
  }
  return "green";
}
