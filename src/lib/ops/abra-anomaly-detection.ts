export type Anomaly = {
  metric: string;
  department: string;
  current_value: number;
  expected_value: number;
  deviation_pct: number;
  z_score: number;
  direction: "spike" | "drop";
  severity: "info" | "warning" | "critical";
  context: string;
};

type MetricRow = {
  metric_name: string;
  value: number | string;
  captured_for_date: string;
  department: string | null;
};

const METRICS: Array<{ name: string; department: string }> = [
  { name: "daily_revenue_shopify", department: "sales_and_growth" },
  { name: "daily_revenue_amazon", department: "sales_and_growth" },
  { name: "daily_sessions", department: "sales_and_growth" },
  { name: "daily_orders_shopify", department: "sales_and_growth" },
  { name: "daily_orders_amazon", department: "sales_and_growth" },
  { name: "daily_pageviews", department: "sales_and_growth" },
  { name: "daily_aov", department: "sales_and_growth" },
  { name: "conversion_rate", department: "sales_and_growth" },
];

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(12000),
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
  return json;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[], center: number): number {
  if (values.length <= 1) return 0;
  const variance = values.reduce((sum, value) => {
    const delta = value - center;
    return sum + delta * delta;
  }, 0) / values.length;
  return Math.sqrt(variance);
}

function computeSeverity(absZ: number): Anomaly["severity"] | null {
  if (absZ > 3) return "critical";
  if (absZ > 2) return "warning";
  if (absZ > 1.5) return "info";
  return null;
}

function buildContext(metric: string, current: number, expected: number): string {
  const deltaPct =
    expected === 0 ? 0 : ((current - expected) / Math.abs(expected)) * 100;
  const direction = deltaPct >= 0 ? "increased" : "dropped";
  return `${metric} ${direction} ${Math.abs(deltaPct).toFixed(1)}% vs 7-day average (${current.toFixed(2)} vs ${expected.toFixed(2)})`;
}

async function fetchMetricSeries(metricName: string): Promise<MetricRow[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const rows = (await sbFetch(
    `/rest/v1/kpi_timeseries?metric_name=eq.${encodeURIComponent(metricName)}&window_type=eq.daily&captured_for_date=gte.${since}&select=metric_name,value,captured_for_date,department&order=captured_for_date.desc&limit=60`,
  )) as MetricRow[];

  return Array.isArray(rows) ? rows : [];
}

export async function checkMetricAnomaly(
  metricName: string,
  currentValue: number,
  department: string,
): Promise<Anomaly | null> {
  const rows = await fetchMetricSeries(metricName);
  const history = rows
    .map((row) => Number(row.value || 0))
    .filter((value) => Number.isFinite(value))
    .slice(1, 8);

  if (history.length < 3) return null;

  const expected = mean(history);
  const sigma = stdDev(history, expected);
  if (sigma === 0) return null;

  const zScore = (currentValue - expected) / sigma;
  const severity = computeSeverity(Math.abs(zScore));
  if (!severity) return null;

  const deviationPct =
    expected === 0 ? 0 : ((currentValue - expected) / Math.abs(expected)) * 100;

  return {
    metric: metricName,
    department,
    current_value: currentValue,
    expected_value: expected,
    deviation_pct: deviationPct,
    z_score: zScore,
    direction: zScore >= 0 ? "spike" : "drop",
    severity,
    context: buildContext(metricName, currentValue, expected),
  };
}

export async function detectAnomalies(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];

  for (const metric of METRICS) {
    try {
      const rows = await fetchMetricSeries(metric.name);
      const latest = rows[0];
      if (!latest) continue;
      const currentValue = Number(latest.value || 0);
      if (!Number.isFinite(currentValue)) continue;

      const anomaly = await checkMetricAnomaly(
        metric.name,
        currentValue,
        latest.department || metric.department,
      );
      if (anomaly) anomalies.push(anomaly);
    } catch {
      // best-effort, skip failed metric
    }
  }

  return anomalies.sort(
    (a, b) => Math.abs(b.z_score) - Math.abs(a.z_score),
  );
}

/**
 * Enhance anomaly detections with LLM-powered root cause analysis.
 * Falls back to basic anomalies if LLM is unavailable.
 */
export async function analyzeAnomaliesWithLLM(): Promise<
  Array<Anomaly & { root_cause_hypothesis: string; recommended_action: string }>
> {
  const anomalies = await detectAnomalies();
  if (anomalies.length === 0) return [];

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return anomalies.map((a) => ({
      ...a,
      root_cause_hypothesis: "LLM analysis unavailable",
      recommended_action: a.context,
    }));
  }

  // Load versioned prompt with fallback
  const FALLBACK_PROMPT = `You are a CPG analytics expert for USA Gummies, a confectionery gummy company selling on Shopify and Amazon.

Given detected metric anomalies, provide root cause analysis. For each anomaly:
1. Generate 1-2 plausible root cause hypotheses based on the metric, direction, and magnitude
2. Recommend a specific action Ben (the founder) should take

Consider common CPG causes: seasonal demand, ad spend changes, competitor actions, supply disruptions, pricing changes, Amazon algorithm shifts, website issues, inventory stockouts.

Respond in JSON format:
[
  {
    "metric": "metric_name",
    "root_cause_hypothesis": "Most likely explanation in 1-2 sentences",
    "recommended_action": "Specific action to take"
  }
]

Be concise. Focus on actionable insights, not speculation.`;

  let systemPrompt = FALLBACK_PROMPT;
  try {
    const { getActivePrompt } = await import("@/lib/ops/auto-research-runner");
    const versioned = await getActivePrompt("anomaly_detector");
    if (versioned?.prompt_text) {
      systemPrompt = versioned.prompt_text;
    }
  } catch {
    // fallback
  }

  try {
    const { getPreferredClaudeModel } = await import("@/lib/ops/abra-cost-tracker");
    const model = await getPreferredClaudeModel(
      process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    );

    const anomalyData = anomalies.map((a) => ({
      metric: a.metric,
      direction: a.direction,
      deviation_pct: Math.round(a.deviation_pct * 10) / 10,
      z_score: Math.round(a.z_score * 100) / 100,
      severity: a.severity,
      current_value: a.current_value,
      expected_value: Math.round(a.expected_value * 100) / 100,
    }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.2,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Analyze these detected anomalies:\n${JSON.stringify(anomalyData, null, 2)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      return anomalies.map((a) => ({
        ...a,
        root_cause_hypothesis: "Analysis unavailable",
        recommended_action: a.context,
      }));
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    // Log cost
    try {
      const { logAICost } = await import("@/lib/ops/abra-cost-tracker");
      if (data.usage) {
        await logAICost({
          model,
          provider: "anthropic",
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          endpoint: "anomaly-analysis",
          department: "operations",
        });
      }
    } catch {
      // best-effort
    }

    const text = data.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text || "")
      .join("");

    // Parse JSON response
    let analyses: Array<{
      metric: string;
      root_cause_hypothesis: string;
      recommended_action: string;
    }> = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        analyses = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Parse failed — return basic anomalies
    }

    const analysisByMetric = new Map(
      analyses.map((a) => [a.metric, a]),
    );

    return anomalies.map((a) => {
      const analysis = analysisByMetric.get(a.metric);
      return {
        ...a,
        root_cause_hypothesis: analysis?.root_cause_hypothesis || "Analysis unavailable",
        recommended_action: analysis?.recommended_action || a.context,
      };
    });
  } catch {
    return anomalies.map((a) => ({
      ...a,
      root_cause_hypothesis: "Analysis unavailable",
      recommended_action: a.context,
    }));
  }
}
