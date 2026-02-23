import type { Metadata } from "next";
import { AgentsShell } from "./AgentsShell.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Agents",
};

export default function OpsAgentsPage() {
  return <AgentsShell />;
}
