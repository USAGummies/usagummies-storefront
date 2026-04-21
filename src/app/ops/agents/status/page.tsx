import type { Metadata } from "next";

import { AgentStatusView } from "./AgentStatusView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Agent Status",
};

export default function AgentStatusPage() {
  return <AgentStatusView />;
}
