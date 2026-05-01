import type { Metadata } from "next";

import { EmailAgentsStatusView } from "./EmailAgentsStatusView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Email Agents · USA Gummies Ops",
};

/**
 * /ops/email-agents
 *
 * Read-only readiness dashboard for the email-agent system. It does not
 * trigger inbox scans, Gmail drafts, approval cards, or HubSpot writes.
 */
export default function EmailAgentsPage() {
  return <EmailAgentsStatusView />;
}
