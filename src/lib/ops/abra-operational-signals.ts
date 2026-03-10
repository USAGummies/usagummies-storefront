/**
 * Abra Operational Heartbeat — Signal Extraction
 *
 * Extracts structured signals from operational data:
 * - Email signals (large orders, complaints, urgent requests)
 * - Inventory alerts
 * - Pipeline changes
 * - Financial anomalies
 *
 * Signals are stored in `abra_operational_signals` and surfaced
 * in the system prompt for proactive awareness.
 */

export type OperationalSignal = {
  signal_type: string; // "large_order" | "complaint" | "inventory_alert" | "deal_stalled" | "payment_overdue"
  source: string; // "email" | "shopify" | "amazon" | "pipeline" | "finance"
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  department: string | null;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
  acknowledged_by: string | null;
};

export type OperationalSignalRow = OperationalSignal & {
  id: string;
  created_at: string;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) return null;

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
    signal: init.signal || AbortSignal.timeout(5000),
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

/**
 * Store a new operational signal (best-effort).
 */
export async function emitSignal(
  signal: Omit<OperationalSignal, "acknowledged" | "acknowledged_by">,
): Promise<string | null> {
  try {
    const rows = (await sbFetch("/rest/v1/abra_operational_signals", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...signal,
        acknowledged: false,
        acknowledged_by: null,
      }),
    })) as Array<{ id: string }> | null;

    return rows?.[0]?.id || null;
  } catch (error) {
    console.error(
      "[signals] Failed to emit signal:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Get unacknowledged signals, ordered by severity then recency.
 * Used to inject alerts into the system prompt.
 */
export async function getActiveSignals(params?: {
  department?: string;
  limit?: number;
  severity?: string;
}): Promise<OperationalSignalRow[]> {
  try {
    const filters: string[] = ["acknowledged=eq.false"];
    if (params?.department) {
      filters.push(`department=eq.${params.department}`);
    }
    if (params?.severity) {
      filters.push(`severity=eq.${params.severity}`);
    }
    const limit = params?.limit || 10;
    const filterStr = filters.join("&");

    return (await sbFetch(
      `/rest/v1/abra_operational_signals?${filterStr}&select=*&order=severity.desc,created_at.desc&limit=${limit}`,
    )) as OperationalSignalRow[];
  } catch {
    return [];
  }
}

/**
 * Acknowledge a signal (mark as handled).
 */
export async function acknowledgeSignal(
  signalId: string,
  acknowledgedBy: string,
): Promise<boolean> {
  try {
    await sbFetch(`/rest/v1/abra_operational_signals?id=eq.${signalId}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        acknowledged: true,
        acknowledged_by: acknowledgedBy,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a signals section for the system prompt.
 * Only includes unacknowledged warnings/criticals.
 */
export function buildSignalsContext(
  signals: OperationalSignalRow[],
): string {
  if (signals.length === 0) return "";

  const critical = signals.filter((s) => s.severity === "critical");
  const warnings = signals.filter((s) => s.severity === "warning");
  const info = signals.filter((s) => s.severity === "info");

  const lines: string[] = [];

  if (critical.length > 0) {
    lines.push("🚨 CRITICAL ALERTS:");
    for (const s of critical) {
      lines.push(`  • [${s.source}] ${s.title}: ${s.detail}`);
    }
  }

  if (warnings.length > 0) {
    lines.push("⚠️ WARNINGS:");
    for (const s of warnings) {
      lines.push(`  • [${s.source}] ${s.title}: ${s.detail}`);
    }
  }

  if (info.length > 0) {
    lines.push("ℹ️ INFO:");
    for (const s of info.slice(0, 3)) {
      lines.push(`  • [${s.source}] ${s.title}`);
    }
  }

  return `OPERATIONAL SIGNALS (${signals.length} active):\n${lines.join("\n")}\nWhen relevant to the user's question, mention these signals proactively.`;
}

/**
 * Extract signals from an email body (simple keyword-based detection).
 * Used by the email ingest agent.
 */
export function extractEmailSignals(params: {
  subject: string;
  body: string;
  from: string;
  department?: string;
}): Array<Omit<OperationalSignal, "acknowledged" | "acknowledged_by">> {
  const signals: Array<
    Omit<OperationalSignal, "acknowledged" | "acknowledged_by">
  > = [];
  const text = `${params.subject} ${params.body}`.toLowerCase();

  // Large order detection
  const orderMatch = text.match(
    /(\d{1,3}(?:,\d{3})*)\s*(?:units?|cases?|pallets?|pieces?)/,
  );
  if (orderMatch) {
    const qty = parseInt(orderMatch[1].replace(/,/g, ""));
    if (qty >= 500) {
      signals.push({
        signal_type: "large_order",
        source: "email",
        title: `Large order inquiry: ${qty} units`,
        detail: `From: ${params.from}. Subject: ${params.subject}`,
        severity: qty >= 5000 ? "critical" : "warning",
        department: "sales_and_growth",
        metadata: { quantity: qty, from: params.from },
      });
    }
  }

  // Complaint detection
  if (
    /\b(complaint|unsatisfied|unhappy|damaged|wrong order|defective|refund|recall)\b/.test(
      text,
    )
  ) {
    signals.push({
      signal_type: "complaint",
      source: "email",
      title: `Customer complaint detected`,
      detail: `From: ${params.from}. Subject: ${params.subject}`,
      severity: /\b(recall|defective)\b/.test(text) ? "critical" : "warning",
      department: "operations",
      metadata: { from: params.from },
    });
  }

  // Urgent request
  if (/\b(urgent|asap|immediately|emergency|critical)\b/.test(text)) {
    signals.push({
      signal_type: "urgent_request",
      source: "email",
      title: `Urgent request from ${params.from}`,
      detail: `Subject: ${params.subject}`,
      severity: "warning",
      department: params.department || null,
      metadata: { from: params.from },
    });
  }

  return signals;
}
