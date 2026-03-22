/**
 * Abra Decision Log
 *
 * Logs every significant decision with reasoning, data sources,
 * confidence, and outcome. Provides audit trail for:
 *  - Financial categorizations
 *  - Action executions
 *  - Corrections applied
 *  - Recommendations made
 */

export type DecisionEntry = {
  decision_type: "categorization" | "action_execution" | "correction" | "recommendation" | "escalation";
  description: string;
  reasoning: string;
  data_sources: string[];
  confidence: number;
  outcome: "executed" | "approved" | "rejected" | "pending";
  actor: string;
  metadata?: Record<string, unknown>;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

/**
 * Log a decision to the brain (best-effort, never blocks).
 */
export async function logDecision(entry: DecisionEntry): Promise<void> {
  const env = getSupabaseEnv();
  if (!env) return;

  const title = `Decision: ${entry.decision_type} — ${entry.description.slice(0, 60)}`;
  const content = [
    `Type: ${entry.decision_type}`,
    `Description: ${entry.description}`,
    `Reasoning: ${entry.reasoning}`,
    `Sources: ${entry.data_sources.join(", ")}`,
    `Confidence: ${(entry.confidence * 100).toFixed(0)}%`,
    `Outcome: ${entry.outcome}`,
    `Actor: ${entry.actor}`,
    entry.metadata ? `Metadata: ${JSON.stringify(entry.metadata)}` : null,
  ].filter(Boolean).join("\n");

  try {
    await fetch(`${env.baseUrl}/rest/v1/open_brain_entries`, {
      method: "POST",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        source_type: "automated",
        source_ref: `decision-${Date.now()}`,
        entry_type: "decision",
        title,
        raw_text: content,
        summary_text: `${entry.decision_type}: ${entry.description}. Reasoning: ${entry.reasoning.slice(0, 200)}`,
        category: "decision_log",
        department: "executive",
        confidence: entry.confidence > 0.8 ? "high" : entry.confidence > 0.5 ? "medium" : "low",
        priority: "normal",
        tags: [`decision:${entry.decision_type}`, `outcome:${entry.outcome}`],
        processed: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* best effort */ }
}

/**
 * Query recent decisions for audit purposes.
 */
export async function getRecentDecisions(
  days = 7,
  type?: string,
): Promise<Array<{ title: string; summary_text: string; created_at: string }>> {
  const env = getSupabaseEnv();
  if (!env) return [];

  const since = new Date(Date.now() - days * 86400000).toISOString();
  const typeFilter = type ? `&tags=cs.{decision:${type}}` : "";

  try {
    const res = await fetch(
      `${env.baseUrl}/rest/v1/open_brain_entries?entry_type=eq.decision&created_at=gte.${encodeURIComponent(since)}${typeFilter}&select=title,summary_text,created_at&order=created_at.desc&limit=50`,
      {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];
    return (await res.json()) as Array<{ title: string; summary_text: string; created_at: string }>;
  } catch { return []; }
}
