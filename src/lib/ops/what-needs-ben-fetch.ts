/**
 * I/O boundary for what-needs-ben: concurrently fetches each lane
 * summary fail-soft. A single failed lane appears as `null` in the
 * aggregator input + a `lane: <error>` entry in the degraded list.
 *
 * Reuses the same lane-specific fetchers built for `email queue`,
 * `finance today`, `marketing today`, `shipping today`, `proposals`
 * — no new I/O paths.
 */
import { approvalStore } from "./control-plane/stores";
import {
  scanEmailAgentQueue,
  summarizeEmailAgentQueue,
  type EmailAgentQueueSummary,
} from "./email-agent-queue";
import { listReceiptReviewPackets } from "./docs";
import {
  summarizeFinanceToday,
  type FinanceTodaySummary,
} from "./finance-today";
import { fetchMarketingPlatforms } from "./marketing-today-fetch";
import {
  summarizeMarketingToday,
  type MarketingTodaySummary,
} from "./marketing-today";
import { fetchShippingTodayInputs } from "./shipping-today-fetch";
import {
  summarizeShippingToday,
  type ShippingTodaySummary,
} from "./shipping-today";
import {
  listExternalProposals,
  summarizeExternalProposals,
  type ExternalProposalsSummary,
} from "./external-proposals";
import type {
  ApprovalRequest,
  DivisionId,
} from "./control-plane/types";
import type { SalesLaneInput } from "./what-needs-ben";

const SALES_DIVISIONS: ReadonlySet<DivisionId> = new Set<DivisionId>(["sales"]);
const STALE_DAYS = 3;

export interface FetchWhatNeedsBenResult {
  email: EmailAgentQueueSummary | null;
  finance: FinanceTodaySummary | null;
  marketing: MarketingTodaySummary | null;
  shipping: ShippingTodaySummary | null;
  proposals: ExternalProposalsSummary | null;
  sales: SalesLaneInput | null;
  degraded: string[];
}

/**
 * Fetch every lane summary concurrently. Fail-soft per lane: a thrown
 * fetcher leaves that lane as `null` and adds an entry to `degraded`.
 *
 * `pendingApprovals` is fetched once and shared with the lanes that
 * need it (finance, marketing, shipping, sales) so we don't pay 4×
 * for the same KV read.
 */
export async function fetchWhatNeedsBenInputs(args: {
  now?: Date;
} = {}): Promise<FetchWhatNeedsBenResult> {
  const now = args.now ?? new Date();
  const degraded: string[] = [];

  // Step 1: shared approvals fetch (used by 4 lanes).
  let approvals: ApprovalRequest[] = [];
  let approvalsOk = true;
  try {
    approvals = await approvalStore().listPending();
  } catch (err) {
    approvalsOk = false;
    degraded.push(
      `approvals:${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Step 2: kick off lane-specific fetches concurrently.
  const [email, finance, marketing, shipping, proposals] = await Promise.all([
    fetchEmailLane().catch((err) => {
      degraded.push(
        `email:${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }),
    fetchFinanceLane(approvals).catch((err) => {
      degraded.push(
        `finance:${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }),
    fetchMarketingLane(approvals).catch((err) => {
      degraded.push(
        `marketing:${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }),
    fetchShippingLane(approvals).catch((err) => {
      degraded.push(
        `shipping:${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }),
    fetchProposalsLane().catch((err) => {
      degraded.push(
        `proposals:${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }),
  ]);

  // Step 3: project sales lane from the shared approvals slice.
  let sales: SalesLaneInput | null = null;
  if (approvalsOk) {
    sales = projectSalesLane(approvals, now);
  }

  return { email, finance, marketing, shipping, proposals, sales, degraded };
}

async function fetchEmailLane(): Promise<EmailAgentQueueSummary> {
  const { rows } = await scanEmailAgentQueue();
  return summarizeEmailAgentQueue(rows);
}

async function fetchFinanceLane(
  pendingApprovals: ReadonlyArray<ApprovalRequest>,
): Promise<FinanceTodaySummary> {
  const packets = await listReceiptReviewPackets({ limit: 200 });
  return summarizeFinanceToday({
    pendingApprovals,
    packets,
  });
}

async function fetchMarketingLane(
  pendingApprovals: ReadonlyArray<ApprovalRequest>,
): Promise<MarketingTodaySummary> {
  const platformFetch = await fetchMarketingPlatforms();
  return summarizeMarketingToday({
    platforms: platformFetch.platforms,
    pendingApprovals,
    degraded: platformFetch.degraded,
  });
}

async function fetchShippingLane(
  pendingApprovals: ReadonlyArray<ApprovalRequest>,
): Promise<ShippingTodaySummary> {
  const inputs = await fetchShippingTodayInputs();
  return summarizeShippingToday({
    retryQueue: inputs.retryQueue,
    pendingApprovals: pendingApprovals.length > 0
      ? pendingApprovals
      : inputs.pendingApprovals,
    wallet: inputs.wallet,
    degraded: inputs.degraded,
  });
}

async function fetchProposalsLane(): Promise<ExternalProposalsSummary> {
  const { records } = await listExternalProposals({ limit: 200 });
  return summarizeExternalProposals(records);
}

function projectSalesLane(
  pendingApprovals: ReadonlyArray<ApprovalRequest>,
  now: Date,
): SalesLaneInput {
  const nowMs = now.getTime();
  const sales = pendingApprovals.filter((a) => SALES_DIVISIONS.has(a.division));
  const stale = sales.filter((a) => {
    const ageDays = (nowMs - Date.parse(a.createdAt)) / (24 * 3600 * 1000);
    return ageDays >= STALE_DAYS;
  });
  return {
    pendingApprovals: sales.length,
    staleApprovals: stale.length,
  };
}
