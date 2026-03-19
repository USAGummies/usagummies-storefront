import { kv } from "@vercel/kv";
import { generateEmbedding } from "@/lib/ops/abra-embeddings";

type DecisionLogRow = {
  action_pattern?: string | null;
  decision?: string | null;
  reasoning?: string | null;
  created_at?: string | null;
};

type ApprovalRow = {
  action_type?: string | null;
  status?: string | null;
  risk_level?: string | null;
  requested_at?: string | null;
  decided_at?: string | null;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 300)}`,
    );
  }

  return json;
}

function summarizeCounts(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => `${key}: ${count}`);
}

function averageHours(rows: ApprovalRow[]): string {
  const durations = rows
    .map((row) => {
      if (!row.requested_at || !row.decided_at) return null;
      const start = Date.parse(row.requested_at);
      const end = Date.parse(row.decided_at);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      return (end - start) / 36e5;
    })
    .filter((value): value is number => typeof value === "number");

  if (durations.length === 0) return "No completed approvals yet";
  const avg = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  return `${avg.toFixed(1)} hours average turnaround`;
}

async function upsertBrainEntry(payload: {
  source_ref: string;
  title: string;
  raw_text: string;
  summary_text: string;
  tags: string[];
}) {
  const embedding = await generateEmbedding(`${payload.title}\n${payload.summary_text}\n${payload.raw_text}`);
  const existing = (await sbFetch(
    `/rest/v1/open_brain_entries?source_ref=eq.${encodeURIComponent(payload.source_ref)}&select=id&limit=1`,
  )) as Array<{ id: string }>;

  const body = {
    title: payload.title,
    raw_text: payload.raw_text,
    summary_text: payload.summary_text,
    category: "founder",
    department: "executive",
    entry_type: "teaching",
    confidence: "medium",
    priority: "normal",
    processed: true,
    tags: payload.tags.slice(0, 10),
    embedding,
    updated_at: new Date().toISOString(),
  };

  if (existing[0]?.id) {
    await sbFetch(`/rest/v1/open_brain_entries?id=eq.${existing[0].id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return;
  }

  await sbFetch("/rest/v1/open_brain_entries", {
    method: "POST",
    headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
    body: JSON.stringify({
      source_type: "agent",
      source_ref: payload.source_ref,
      ...body,
    }),
  });
}

export async function learnDecisionPatterns(options?: { force?: boolean }): Promise<void> {
  const throttleKey = "abra:memory:decision-patterns:last-run";
  if (!options?.force) {
    try {
      const lastRun = await kv.get<string>(throttleKey);
      if (lastRun && Date.now() - Date.parse(lastRun) < 6 * 60 * 60 * 1000) return;
    } catch {
      // continue without throttle if KV read fails
    }
  }

  const [decisionLog, approvals] = await Promise.all([
    sbFetch(
      "/rest/v1/decision_log?select=action_pattern,decision,reasoning,created_at&order=created_at.desc&limit=60",
    ) as Promise<DecisionLogRow[]>,
    sbFetch(
      "/rest/v1/approvals?select=action_type,status,risk_level,requested_at,decided_at&order=requested_at.desc&limit=120",
    ) as Promise<ApprovalRow[]>,
  ]);

  const patterns = summarizeCounts(
    (decisionLog || [])
      .map((row) => row.action_pattern || "")
      .filter(Boolean),
  );
  const decisions = summarizeCounts(
    (decisionLog || [])
      .map((row) => row.decision || "")
      .filter(Boolean),
  );
  const actions = summarizeCounts(
    (approvals || [])
      .map((row) => row.action_type || "")
      .filter(Boolean),
  );
  const riskMix = summarizeCounts(
    (approvals || [])
      .map((row) => row.risk_level || "")
      .filter(Boolean),
  );
  const approvalMix = summarizeCounts(
    (approvals || [])
      .map((row) => row.status || "")
      .filter(Boolean),
  );

  const raw_text = [
    "Decision pattern summary",
    "",
    "Common action patterns:",
    ...(patterns.length > 0 ? patterns.map((line) => `- ${line}`) : ["- No patterns yet"]),
    "",
    "Decision outcomes:",
    ...(decisions.length > 0 ? decisions.map((line) => `- ${line}`) : ["- No decisions yet"]),
    "",
    "Approval demand by action:",
    ...(actions.length > 0 ? actions.map((line) => `- ${line}`) : ["- No approvals yet"]),
    "",
    "Risk mix:",
    ...(riskMix.length > 0 ? riskMix.map((line) => `- ${line}`) : ["- No risk data yet"]),
    "",
    "Approval status mix:",
    ...(approvalMix.length > 0 ? approvalMix.map((line) => `- ${line}`) : ["- No status data yet"]),
    "",
    `Turnaround: ${averageHours(approvals || [])}`,
  ].join("\n");

  const summary_text = [
    patterns[0] ? `Top pattern ${patterns[0]}` : "No dominant decision pattern yet",
    approvalMix[0] ? `status mix ${approvalMix[0]}` : "",
    averageHours(approvals || []),
  ]
    .filter(Boolean)
    .join("; ")
    .slice(0, 500);

  await upsertBrainEntry({
    source_ref: "decision-patterns:latest",
    title: "Decision Patterns — Latest",
    raw_text,
    summary_text,
    tags: ["decision_pattern", "approvals", "executive"],
  });

  try {
    await kv.set(throttleKey, new Date().toISOString(), { ex: 6 * 60 * 60 });
  } catch {
    // non-critical
  }
}
