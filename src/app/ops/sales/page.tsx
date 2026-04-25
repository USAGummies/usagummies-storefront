import type { Metadata } from "next";

import { SalesCommandCenterView } from "./SalesCommandCenterView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sales Command Center · USA Gummies Ops",
};

/**
 * /ops/sales — read-only consolidated view of the day's revenue
 * actions across Faire Direct, follow-ups, AP packets, retail proof,
 * and pending Slack approvals.
 *
 * Phase 1 invariants:
 *   - No mutations. No email send. No HubSpot stage / property change.
 *   - No "approve" / "send" / "buy label" buttons.
 *   - Sources without an internal list API render as `not_wired`
 *     instead of fabricating counts.
 *   - All deep links point at existing internal pages.
 */
export default function SalesCommandCenterPage() {
  return <SalesCommandCenterView />;
}
