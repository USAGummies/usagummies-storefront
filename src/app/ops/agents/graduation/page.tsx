import type { Metadata } from "next";

import { AgentGraduationView } from "./AgentGraduationView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Agent Graduation",
};

export default function AgentGraduationPage() {
  return <AgentGraduationView />;
}
