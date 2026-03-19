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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
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
 * Auto-acknowledge stale info-level signals older than the given TTL.
 * Run periodically to prevent signal pile-up in the Command Center.
 */
export async function autoAcknowledgeStaleSignals(
  ttlHours = 48,
): Promise<number> {
  try {
    const cutoff = new Date(
      Date.now() - ttlHours * 60 * 60 * 1000,
    ).toISOString();

    const rows = (await sbFetch(
      `/rest/v1/abra_operational_signals?acknowledged=eq.false&severity=eq.info&created_at=lt.${cutoff}&select=id`,
      { method: "GET" },
    )) as Array<{ id: string }> | null;

    if (!rows || rows.length === 0) return 0;

    await sbFetch(
      `/rest/v1/abra_operational_signals?acknowledged=eq.false&severity=eq.info&created_at=lt.${cutoff}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          acknowledged: true,
          acknowledged_by: "auto-stale-cleanup",
        }),
      },
    );

    return rows.length;
  } catch {
    return 0;
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
/** Senders that should never generate operational signals */
const NOISE_SENDERS_RE =
  /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster)@/i;
const NOISE_DOMAINS = new Set([
  "email.claude.com",
  "accounts.google.com",
  "noreply.github.com",
  "notify.bugsnag.com",
  "amazonses.com",
  "sendgrid.net",
  "mailchimp.com",
  "email.mailgun.org",
]);

function isNoiseSender(from: string): boolean {
  if (NOISE_SENDERS_RE.test(from)) return true;
  const domain = from.split("@")[1]?.toLowerCase();
  return domain ? NOISE_DOMAINS.has(domain) : false;
}

export function extractEmailSignals(params: {
  subject: string;
  body: string;
  from: string;
  department?: string;
}): Array<Omit<OperationalSignal, "acknowledged" | "acknowledged_by">> {
  // Skip noise senders entirely — no signals from automated/marketing senders
  if (isNoiseSender(params.from)) return [];

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

  // Payment and invoice mentions
  if (
    /\b(invoice|payment due|past due|remittance|wire transfer|net\s?\d+)\b/.test(
      text,
    )
  ) {
    const amountMatch = text.match(/(?:\$|usd\s?)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null;
    const pastDue = /\b(past due|overdue|late payment)\b/.test(text);
    signals.push({
      signal_type: "payment_invoice",
      source: "email",
      title: pastDue
        ? "Past-due payment signal"
        : "Invoice/payment discussion detected",
      detail: `From: ${params.from}. Subject: ${params.subject}`,
      severity: pastDue ? "critical" : "warning",
      department: "finance",
      metadata: { from: params.from, amount },
    });
  }

  // Payment confirmations, receipts, and order completions
  if (
    /\b(payment (?:received|confirmed|processed|completed|successful)|(?:invoice|order) (?:paid|fulfilled|shipped)|receipt (?:attached|enclosed|for your records)|(?:ach|wire|zelle) (?:transfer|payment) (?:received|confirmed)|transaction (?:confirmed|approved|completed)|(?:shipped|tracking|delivered|dispatched)|order (?:confirmation|received|placed|complete))\b/i.test(
      text,
    )
  ) {
    const amountMatch = text.match(/(?:\$|usd\s?)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null;
    const isPayment = /\b(payment|paid|receipt|ach|wire|zelle|transaction)\b/i.test(text);
    const isShipment = /\b(shipped|tracking|delivered|dispatched)\b/i.test(text);
    signals.push({
      signal_type: isPayment ? "payment_confirmed" : isShipment ? "order_shipped" : "order_confirmed",
      source: "email",
      title: isPayment
        ? `Payment confirmed${amount ? ` ($${amount.toLocaleString()})` : ""}`
        : isShipment
          ? "Shipment/delivery update"
          : "Order confirmation received",
      detail: `From: ${params.from}. Subject: ${params.subject}`,
      severity: "info",
      department: "finance",
      metadata: { from: params.from, amount },
    });
  }

  // Supplier updates
  if (
    /\b(price increase|lead time|out of stock|discontinue|new product|allocation|minimum order)\b/.test(
      text,
    )
  ) {
    const isCritical = /\b(out of stock|discontinue|allocation)\b/.test(text);
    signals.push({
      signal_type: "supplier_update",
      source: "email",
      title: isCritical
        ? "Critical supplier update"
        : "Supplier update detected",
      detail: `From: ${params.from}. Subject: ${params.subject}`,
      severity: isCritical ? "critical" : "warning",
      department: "supply_chain",
      metadata: { from: params.from },
    });
  }

  // Regulatory mentions
  if (
    /\b(fda|compliance|recall|warning letter|inspection|labeling violation)\b/.test(
      text,
    )
  ) {
    signals.push({
      signal_type: "regulatory",
      source: "email",
      title: "Regulatory/compliance mention detected",
      detail: `From: ${params.from}. Subject: ${params.subject}`,
      severity: "critical",
      department: "operations",
      metadata: { from: params.from },
    });
  }

  // Partnership and channel opportunities
  if (
    /\b(partnership|collaboration|distribute|carry your product|retail placement|co-brand)\b/.test(
      text,
    )
  ) {
    signals.push({
      signal_type: "partnership_opportunity",
      source: "email",
      title: "Partnership opportunity detected",
      detail: `From: ${params.from}. Subject: ${params.subject}`,
      severity: "info",
      department: "sales_and_growth",
      metadata: { from: params.from },
    });
  }

  return signals;
}

/**
 * LLM-powered signal extraction from email content.
 * Provides semantic understanding beyond regex pattern matching.
 * Falls back to rule-based extractEmailSignals() if LLM unavailable.
 */
export async function extractEmailSignalsWithLLM(params: {
  subject: string;
  body: string;
  from: string;
  department?: string;
}): Promise<Array<Omit<OperationalSignal, "acknowledged" | "acknowledged_by">>> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return extractEmailSignals(params);
  }

  const FALLBACK_PROMPT = `You are an operational signal detector for USA Gummies, a CPG confectionery gummy company.

Analyze the email below and extract operational signals. For each signal, determine:
- signal_type: one of "large_order", "complaint", "urgent_request", "payment_invoice", "supplier_update", "regulatory", "partnership_opportunity", "competitor_intel", "logistics_issue"
- title: brief descriptive title (under 80 chars)
- detail: 1-sentence explanation
- severity: "info" | "warning" | "critical"
- department: "sales_and_growth" | "operations" | "finance" | "supply_chain" | null

Respond in JSON array format:
[{ "signal_type": "...", "title": "...", "detail": "...", "severity": "...", "department": "..." }]

Rules:
- Only extract genuine signals, not routine correspondence
- A single email can have 0-3 signals
- "critical" = requires same-day action
- "warning" = requires attention within 48 hours
- "info" = good to know, no immediate action
- Empty array [] if no signals detected
- Consider context: quantities > 500 units are notable, dollar amounts > $5000 are significant`;

  let systemPrompt = FALLBACK_PROMPT;
  try {
    const { getActivePrompt } = await import("@/lib/ops/auto-research-runner");
    const versioned = await getActivePrompt("operational_signals");
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

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `From: ${params.from}\nSubject: ${params.subject}\n\n${params.body.slice(0, 3000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return extractEmailSignals(params);
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
          endpoint: "signal-extraction",
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

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          signal_type: string;
          title: string;
          detail: string;
          severity: "info" | "warning" | "critical";
          department: string | null;
        }>;

        return parsed.map((s) => ({
          signal_type: s.signal_type || "unknown",
          source: "email",
          title: s.title || "Signal detected",
          detail: s.detail || `From: ${params.from}`,
          severity: s.severity || "info",
          department: s.department || params.department || null,
          metadata: { from: params.from, llm_extracted: true },
        }));
      }
    } catch {
      // parse failed
    }

    return extractEmailSignals(params);
  } catch {
    return extractEmailSignals(params);
  }
}
