import type { Metadata } from "next";

import { SlackControlBoard } from "./SlackControlBoard.client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Slack Control Board · USA Gummies Ops",
};

/**
 * /ops/slack
 *
 * Operator-facing Slack diagnostics. The page reads Slack config readiness
 * and can intentionally post a single Block Kit self-test card through
 * /api/ops/slack/self-test. No approval, Gmail, HubSpot, QBO, Shopify,
 * shipping, Faire, or customer-facing state is mutated.
 */
export default function SlackControlBoardPage() {
  return <SlackControlBoard />;
}
