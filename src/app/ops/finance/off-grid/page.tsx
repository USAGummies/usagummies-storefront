import type { Metadata } from "next";

import { OffGridQuotesView } from "./OffGridQuotesView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Off-Grid Quotes · USA Gummies Ops",
};

/**
 * /ops/finance/off-grid
 *
 * Read-only visibility for quotes priced outside the canonical B-tier grid.
 * The page consumes GET /api/ops/finance/off-grid and never mutates pricing,
 * approvals, QBO, HubSpot, Shopify, or Slack.
 */
export default function OffGridQuotesPage() {
  return <OffGridQuotesView />;
}
