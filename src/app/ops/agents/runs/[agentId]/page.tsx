import type { Metadata } from "next";

import { auditStore } from "@/lib/ops/control-plane/stores";
import {
  buildAgentRunHistory,
  type AgentRunHistory,
} from "@/lib/ops/agents-runs/run-history";
import {
  getAgentManifestEntry,
  type AgentManifestEntry,
} from "@/lib/ops/agents-runs/manifest";

import { AgentRunsView } from "./AgentRunsView.client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Agent Runs",
};

const AUDIT_WINDOW = 1000;
const DEFAULT_LIMIT = 50;

interface PageProps {
  params: Promise<{ agentId: string }>;
}

export default async function AgentRunsPage({ params }: PageProps) {
  const { agentId } = await params;
  const decodedId = decodeURIComponent(agentId);

  const agent: AgentManifestEntry | null = getAgentManifestEntry(decodedId);

  let history: AgentRunHistory;
  let degraded: string[] = [];
  try {
    const recent = await auditStore().recent(AUDIT_WINDOW);
    history = buildAgentRunHistory(recent, decodedId, {
      limit: DEFAULT_LIMIT,
      windowDescription: `last ${AUDIT_WINDOW} audit entries (${recent.length} actually retrieved)`,
    });
  } catch (err) {
    degraded.push(
      `audit-store: ${err instanceof Error ? err.message : String(err)}`,
    );
    history = {
      agentId: decodedId,
      totalEntries: 0,
      totalRuns: 0,
      items: [],
      windowDescription: "audit store unreachable",
    };
  }

  return (
    <AgentRunsView
      agentId={decodedId}
      agent={agent}
      history={history}
      degraded={degraded}
    />
  );
}
