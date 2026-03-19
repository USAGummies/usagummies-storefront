import { kv } from "@vercel/kv";
import { generateEmbedding } from "@/lib/ops/abra-embeddings";

type SignalRow = {
  severity?: string | null;
  department?: string | null;
  title?: string | null;
  source?: string | null;
  created_at?: string | null;
};

type KpiRow = {
  metric_name?: string | null;
  value?: number | string | null;
  captured_for_date?: string | null;
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
    category: "operational",
    department: "operations",
    entry_type: "summary",
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

export async function captureOperationalPatterns(options?: { force?: boolean }): Promise<void> {
  const throttleKey = "abra:memory:operational-patterns:last-run";
  if (!options?.force) {
    try {
      const lastRun = await kv.get<string>(throttleKey);
      if (lastRun && Date.now() - Date.parse(lastRun) < 4 * 60 * 60 * 1000) return;
    } catch {
      // continue without throttle if KV read fails
    }
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [signals, approvals, kpis] = await Promise.all([
    sbFetch(
      "/rest/v1/abra_operational_signals?select=severity,department,title,source,created_at&order=created_at.desc&limit=80",
    ) as Promise<SignalRow[]>,
    sbFetch(
      "/rest/v1/approvals?status=eq.pending&select=id&limit=200",
    ) as Promise<Array<{ id: string }>>,
    sbFetch(
      `/rest/v1/kpi_timeseries?captured_for_date=gte.${since}&window_type=eq.daily&select=metric_name,value,captured_for_date&order=captured_for_date.desc&limit=80`,
    ) as Promise<KpiRow[]>,
  ]);

  const severityMix = summarizeCounts((signals || []).map((row) => row.severity || "").filter(Boolean));
  const departmentMix = summarizeCounts((signals || []).map((row) => row.department || "unassigned"));
  const sourceMix = summarizeCounts((signals || []).map((row) => row.source || "").filter(Boolean));
  const headlineSignals = (signals || [])
    .slice(0, 5)
    .map((row) => `${row.title || "Signal"} [${row.severity || "info"}]`);
  const recentMetrics = (kpis || [])
    .slice(0, 6)
    .map((row) => `${row.metric_name || "metric"}=${Number(row.value || 0).toFixed(2)} on ${row.captured_for_date || "unknown"}`);

  const raw_text = [
    "Operational pattern summary",
    "",
    `Pending approvals: ${(approvals || []).length}`,
    "",
    "Signal severity mix:",
    ...(severityMix.length > 0 ? severityMix.map((line) => `- ${line}`) : ["- No active signals"]),
    "",
    "Signal departments:",
    ...(departmentMix.length > 0 ? departmentMix.map((line) => `- ${line}`) : ["- No department patterns yet"]),
    "",
    "Signal sources:",
    ...(sourceMix.length > 0 ? sourceMix.map((line) => `- ${line}`) : ["- No source patterns yet"]),
    "",
    "Headline signals:",
    ...(headlineSignals.length > 0 ? headlineSignals.map((line) => `- ${line}`) : ["- None"]),
    "",
    "Recent KPIs:",
    ...(recentMetrics.length > 0 ? recentMetrics.map((line) => `- ${line}`) : ["- No KPI data"]),
  ].join("\n");

  const summary_text = [
    severityMix[0] ? `Signals ${severityMix[0]}` : "No dominant signal pattern",
    `pending approvals ${(approvals || []).length}`,
    recentMetrics[0] || "",
  ]
    .filter(Boolean)
    .join("; ")
    .slice(0, 500);

  await upsertBrainEntry({
    source_ref: "operational-patterns:latest",
    title: "Operational Patterns — Latest",
    raw_text,
    summary_text,
    tags: ["operational_pattern", "signals", "kpis"],
  });

  try {
    await kv.set(throttleKey, new Date().toISOString(), { ex: 4 * 60 * 60 });
  } catch {
    // non-critical
  }
}
