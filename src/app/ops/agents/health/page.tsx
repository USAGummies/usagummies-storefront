import type { Metadata } from "next";

import { AgentHealthView } from "./AgentHealthView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Agent Health",
};

export default function AgentHealthPage() {
  return <AgentHealthView />;
}
