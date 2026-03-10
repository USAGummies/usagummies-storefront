import {
  emitSignal,
  extractEmailSignals,
} from "@/lib/ops/abra-operational-signals";
import { listEmails, readEmail } from "@/lib/ops/gmail-reader";

type EmailCategory =
  | "production"
  | "sales"
  | "finance"
  | "retail"
  | "marketplace"
  | "regulatory"
  | "customer"
  | "compliance"
  | "noise";

type EmailPriority = "critical" | "important" | "informational" | "noise";

export type EmailFetchResult = {
  fetched: number;
  inserted: number;
  skipped: number;
  signals: number;
  note?: string;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(20000),
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

async function embedAndStoreEmail(record: Record<string, unknown>): Promise<void> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const res = await fetch(`${baseUrl}/functions/v1/embed-and-store`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ table: "email_events", record }),
    signal: AbortSignal.timeout(20000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`embed-and-store failed (${res.status}): ${text}`);
  }
}

function parseSenderName(fromHeader: string): string {
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  if (match?.[1]) return match[1].trim();
  return fromHeader.split("@")[0]?.trim() || "Unknown Sender";
}

function parseSenderEmail(fromHeader: string): string {
  const bracket = fromHeader.match(/<([^>]+)>/);
  const extracted = bracket?.[1] || fromHeader;
  const email = extracted.trim().toLowerCase();
  if (email.includes("@")) return email;
  return "unknown@example.invalid";
}

function parseReceivedAt(rawDate: string): string {
  const parsed = Date.parse(rawDate || "");
  if (!Number.isFinite(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

function summarize(subject: string, body: string): string {
  const combined = `${subject}\n${body}`.trim();
  if (combined.length <= 500) return combined;
  const truncated = combined.slice(0, 500);
  const lastPeriod = truncated.lastIndexOf(".");
  if (lastPeriod > 180) return truncated.slice(0, lastPeriod + 1);
  return `${truncated}...`;
}

function classifyEmail(params: {
  from: string;
  subject: string;
  body: string;
}): {
  category: EmailCategory;
  priority: EmailPriority;
  actionRequired: boolean;
  suggestedAction: string | null;
} {
  const text = `${params.from} ${params.subject} ${params.body.slice(0, 800)}`.toLowerCase();

  let category: EmailCategory = "noise";
  if (/\b(faire|wholesale|buyer|distributor|retailer|broker|outreach|lead)\b/.test(text)) {
    category = "sales";
  } else if (/\b(amazon|seller central|fba|asin|marketplace)\b/.test(text)) {
    category = "marketplace";
  } else if (/\b(shopify|dtc|direct to consumer|ecommerce|checkout)\b/.test(text)) {
    category = "retail";
  } else if (/\b(invoice|payment|wire|ach|tax|bookkeep|quickbooks|stripe)\b/.test(text)) {
    category = "finance";
  } else if (/\b(refund|return|complaint|support|customer|review)\b/.test(text)) {
    category = "customer";
  } else if (/\b(production|manufactur|inventory|warehouse|fulfillment|3pl|repack)\b/.test(text)) {
    category = "production";
  } else if (/\b(fda|regulatory|label|nutrition facts|coa|certificate)\b/.test(text)) {
    category = "regulatory";
  } else if (/\b(compliance|audit|inspection|recall|safety)\b/.test(text)) {
    category = "compliance";
  }

  let priority: EmailPriority = "informational";
  if (/\b(urgent|asap|critical|immediate|emergency)\b/.test(text)) {
    priority = "critical";
  } else if (/\b(order|quote|pricing|payment|wholesale|distributor)\b/.test(text)) {
    priority = "important";
  } else if (/\b(newsletter|unsubscribe|promo|marketing|noreply|no-reply)\b/.test(text)) {
    priority = "noise";
  }

  const actionRequired =
    /\b(action required|please respond|reply needed|follow up|confirm|approve)\b/.test(
      text,
    ) || priority === "critical";

  let suggestedAction: string | null = null;
  if (actionRequired) {
    if (category === "sales") suggestedAction = "Review and respond to sales thread";
    else if (category === "customer") suggestedAction = "Address customer issue";
    else if (category === "finance") suggestedAction = "Review financial request";
    else suggestedAction = "Review and respond";
  }

  return { category, priority, actionRequired, suggestedAction };
}

function mapDepartment(category: EmailCategory): string | undefined {
  switch (category) {
    case "finance":
      return "finance";
    case "production":
    case "regulatory":
    case "compliance":
      return "operations";
    case "sales":
    case "retail":
    case "marketplace":
    case "customer":
      return "sales_and_growth";
    default:
      return undefined;
  }
}

function quoteForIn(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function getExistingProviderIds(
  providerMessageIds: string[],
): Promise<Set<string>> {
  if (providerMessageIds.length === 0) return new Set();
  const existing = new Set<string>();

  for (let i = 0; i < providerMessageIds.length; i += 50) {
    const chunk = providerMessageIds.slice(i, i + 50);
    const filter = chunk.map(quoteForIn).join(",");
    const rows = (await sbFetch(
      `/rest/v1/email_events?select=provider_message_id&provider_message_id=in.(${filter})`,
    )) as Array<{ provider_message_id: string | null }>;
    for (const row of rows) {
      if (row?.provider_message_id) existing.add(row.provider_message_id);
    }
  }

  return existing;
}

export async function runEmailFetch(params?: {
  count?: number;
}): Promise<EmailFetchResult> {
  const count = Number.isFinite(params?.count) ? Number(params?.count) : 50;

  try {
    const envelopes = await listEmails({
      folder: "INBOX",
      count,
      unreadOnly: false,
    });

    const providerIds = envelopes
      .map((env) => env.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const existing = await getExistingProviderIds(providerIds);

    let inserted = 0;
    let skipped = 0;
    let signals = 0;

    for (const envelope of envelopes) {
      if (!envelope.id || existing.has(envelope.id)) {
        skipped += 1;
        continue;
      }

      const message = await readEmail(envelope.id);
      if (!message) {
        skipped += 1;
        continue;
      }

      const subject = message.subject || "(no subject)";
      const rawBody = message.body || message.htmlBody || message.subject || "";
      const body = rawBody.slice(0, 45_000);
      const fromRaw = message.from || envelope.from || "";
      const senderEmail = parseSenderEmail(fromRaw);
      const senderName = parseSenderName(fromRaw);
      const receivedAt = parseReceivedAt(message.date || envelope.date);
      const classified = classifyEmail({
        from: fromRaw,
        subject,
        body,
      });

      const record = {
        provider_message_id: message.id,
        message_id: message.id,
        source_thread_id: message.threadId || envelope.threadId || null,
        sender_name: senderName,
        sender_email: senderEmail,
        subject: subject.slice(0, 500),
        received_at: receivedAt,
        raw_text: body || subject,
        summary: summarize(subject, body),
        category: classified.category,
        priority: classified.priority,
        action_required: classified.actionRequired,
        suggested_action: classified.suggestedAction,
        status: "new",
      };

      await embedAndStoreEmail(record);
      inserted += 1;

      const extracted = extractEmailSignals({
        from: senderEmail,
        subject,
        body,
        department: mapDepartment(classified.category),
      });
      for (const signal of extracted) {
        const id = await emitSignal(signal);
        if (id) signals += 1;
      }
    }

    return {
      fetched: envelopes.length,
      inserted,
      skipped,
      signals,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/gmail api not configured/i.test(message)) {
      return {
        fetched: 0,
        inserted: 0,
        skipped: 0,
        signals: 0,
        note: "Gmail not configured — skipping",
      };
    }
    throw error;
  }
}
