import type { Metadata } from "next";

import { WorkpacksView } from "./WorkpacksView.client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Workpacks · USA Gummies Ops",
};

/**
 * /ops/workpacks — read-only queue for Slack-created AI workpacks.
 *
 * Workpacks package a Slack ask into a safe, bounded task for Codex/Claude
 * or an operator. This page does not execute workpacks and does not mutate
 * Gmail, HubSpot, QBO, Shopify, Slack approvals, or shipping state.
 */
export default function WorkpacksPage() {
  return <WorkpacksView />;
}
