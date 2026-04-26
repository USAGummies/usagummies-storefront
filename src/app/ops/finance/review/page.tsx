import type { Metadata } from "next";

import { FinanceReviewView } from "./FinanceReviewView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finance Review · USA Gummies Ops" };

/**
 * /ops/finance/review — review-only surface for Rene + Ben.
 *
 * Aggregates four queues into one Monday-action list:
 *   1. Receipt documents needing review (`docs:receipts` KV via
 *      /api/ops/docs/receipt?status=needs_review)
 *   2. Pending control-plane approvals (Class B/C — vendor.master.create,
 *      shipment.create, etc. — via /api/ops/control-plane/approvals)
 *   3. Freight-comp queue items awaiting Rene's call
 *   4. Jungle Jim's-style AP packets and their hand-maintained status
 *
 * Read-only by design. No QBO writes, no Gmail sends, no approval state
 * changes happen from this page. Decisions still go through the
 * existing Slack approval cards or the canonical decision endpoints.
 */
export default function FinanceReviewPage() {
  return <FinanceReviewView />;
}
