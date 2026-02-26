/**
 * B2B Pipeline Communications — USA Gummies
 *
 * Extracts communication signals from the B2B Prospects Notion database.
 * Uses "Last Contact", "Notes", "Email" fields to build messages.
 */

import { readState } from "@/lib/ops/state";
import type { CacheEnvelope } from "@/lib/amazon/types";
import type { CommMessage } from "./types";

type PipelineLead = {
  id: string;
  name: string;
  status: string;
  email: string;
  lastContact: string;
  notes: string;
  type: "b2b" | "distributor";
  lastEdited: string;
};

/**
 * Extract communication signals from pipeline data (cached).
 * Derives "messages" from recent pipeline activity.
 */
export async function fetchB2BPipelineComms(limit = 15): Promise<CommMessage[]> {
  // Use the pipeline cache (populated by the pipeline route)
  const cached = await readState<CacheEnvelope<{
    stages: Record<string, PipelineLead[]>;
    recentActivity: { date: string; lead: string; event: string; details: string }[];
  }> | null>("pipeline-cache", null);

  if (!cached?.data) return [];

  const messages: CommMessage[] = [];

  // Convert recent activity into comm messages
  const activity = cached.data.recentActivity || [];
  for (const item of activity.slice(0, limit)) {
    messages.push({
      id: `b2b-activity-${item.date}-${item.lead}`,
      source: "b2b_pipeline",
      from: item.lead,
      subject: `Pipeline: ${item.event}`,
      snippet: item.details || `${item.lead} moved to ${item.event}`,
      date: new Date(item.date).toISOString(),
      read: true,
      priority: item.event.toLowerCase().includes("closed") ? "high" : "normal",
      category: "sales",
    });
  }

  // Also check for leads with recent notes
  const allLeads: PipelineLead[] = [];
  for (const leads of Object.values(cached.data.stages || {})) {
    allLeads.push(...(leads as PipelineLead[]));
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentLeads = allLeads
    .filter((l) => new Date(l.lastEdited).getTime() > sevenDaysAgo && l.notes)
    .sort((a, b) => new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime())
    .slice(0, 10);

  for (const lead of recentLeads) {
    // Avoid duplicates with activity feed
    if (messages.some((m) => m.from === lead.name)) continue;

    messages.push({
      id: `b2b-note-${lead.id}`,
      source: "b2b_pipeline",
      from: lead.name,
      subject: `${lead.type === "distributor" ? "Distributor" : "B2B"}: ${lead.status}`,
      snippet: lead.notes.slice(0, 200),
      date: lead.lastEdited,
      read: false,
      priority: lead.status.toLowerCase().includes("negotiation") ? "high" : "normal",
      category: "sales",
    });
  }

  return messages
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}
