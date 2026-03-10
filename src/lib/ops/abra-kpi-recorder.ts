type SourceSystem =
  | "amazon"
  | "shopify"
  | "quickbooks"
  | "found"
  | "faire"
  | "manual"
  | "calculated";

type MetricGroup =
  | "amazon"
  | "finance"
  | "inventory"
  | "sales"
  | "operations";

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
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }
  return json;
}

function inferSource(metricName: string): SourceSystem {
  if (metricName.includes("amazon")) return "amazon";
  if (metricName.includes("shopify")) return "shopify";
  if (metricName.includes("faire")) return "faire";
  if (metricName.includes("session") || metricName.includes("pageview")) {
    return "calculated";
  }
  return "calculated";
}

function inferGroup(metricName: string): MetricGroup {
  if (metricName.includes("session") || metricName.includes("pageview")) {
    return "operations";
  }
  if (metricName.includes("revenue") || metricName.includes("orders") || metricName.includes("aov")) {
    return "sales";
  }
  return "operations";
}

export async function recordKPI(params: {
  metric_name: string;
  value: number;
  department?: string;
  date?: string;
  source_system?: SourceSystem;
  metric_group?: MetricGroup;
  entity_ref?: string;
}): Promise<void> {
  const value = Number(params.value || 0);
  if (!Number.isFinite(value)) return;

  const capturedForDate =
    params.date ||
    new Date().toISOString().slice(0, 10);

  try {
    await sbFetch(
      `/rest/v1/kpi_timeseries?metric_name=eq.${encodeURIComponent(params.metric_name)}&entity_ref=eq.${encodeURIComponent(params.entity_ref || "global")}&captured_for_date=eq.${capturedForDate}&window_type=eq.daily`,
      {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      },
    );
  } catch {
    // non-fatal: continue with insert
  }

  await sbFetch("/rest/v1/kpi_timeseries", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metric_name: params.metric_name,
      metric_group: params.metric_group || inferGroup(params.metric_name),
      source_system: params.source_system || inferSource(params.metric_name),
      department: params.department || null,
      entity_ref: params.entity_ref || "global",
      value,
      window_type: "daily",
      captured_for_date: capturedForDate,
    }),
  });
}
