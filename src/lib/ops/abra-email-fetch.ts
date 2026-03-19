import {
  emitSignal,
  extractEmailSignals,
} from "@/lib/ops/abra-operational-signals";
import { listEmails, readEmail, readAllAttachments } from "@/lib/ops/gmail-reader";

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
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

import { getVipSender } from "@/lib/ops/abra-vip-senders";

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
  const senderEmail = parseSenderEmail(params.from);
  const text = `${params.from} ${params.subject} ${params.body.slice(0, 800)}`.toLowerCase();

  // ------- VIP sender fast-path -------
  const vip = getVipSender(senderEmail);
  if (vip) {
    // Ben's own emails → skip action. Everyone else → action required.
    const isSelf = vip.relationship === "self";
    return {
      category: vip.category,
      priority: vip.priority,
      actionRequired: !isSelf,
      suggestedAction: isSelf ? null : vip.suggestedAction,
    };
  }

  // ------- Keyword-based category classification -------
  let category: EmailCategory = "noise";
  if (/\b(faire|wholesale|buyer|distributor|retailer|broker|outreach|lead)\b/.test(text)) {
    category = "sales";
  } else if (/\b(amazon|seller central|fba|asin|marketplace)\b/.test(text)) {
    category = "marketplace";
  } else if (/\b(shopify|dtc|direct to consumer|ecommerce|checkout)\b/.test(text)) {
    category = "retail";
  } else if (
    /\b(invoice|payment|wire|ach|tax|bookkeep|quickbooks|stripe|loan|agreement|contract|promissory|receivable|payable|ledger|journal|accrual|debit|credit|balance sheet|p&l|profit.?loss|revenue|expense|reimburse|deposit|escrow|lien|collateral|amortiz|depreciat|accounts?\s+payable|accounts?\s+receivable|net\s+terms)\b/.test(
      text,
    )
  ) {
    category = "finance";
  } else if (
    // Shipping receipts/labels → finance (bank reconciliation), not production noise
    /\b(shipping\s+(?:receipt|label|confirmation|charge)|pirate\s*ship|shipstation|easypost|usps\s+(?:receipt|label)|ups\s+(?:receipt|charge)|fedex\s+(?:receipt|charge)|postage\s+(?:receipt|paid|charge))\b/.test(text)
  ) {
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

  // ------- Priority classification -------
  let priority: EmailPriority = "informational";
  if (/\b(urgent|asap|critical|immediate|emergency)\b/.test(text)) {
    priority = "critical";
  } else if (/\b(order|quote|pricing|payment|wholesale|distributor|loan|agreement|contract)\b/.test(text)) {
    priority = "important";
  } else if (/\b(newsletter|unsubscribe|promo|marketing|noreply|no-reply)\b/.test(text)) {
    priority = "noise";
  }

  // ------- Action-required detection (broadened) -------
  const actionRequired =
    /\b(action required|please respond|reply needed|follow[- ]?up|confirm|approve|sign|review|your\s+signature|please\s+(?:review|sign|confirm|approve|send|provide|complete))\b/.test(
      text,
    ) ||
    priority === "critical" ||
    // Attachment-only emails from non-noise categories likely need attention
    (params.body.trim().length < 50 && category !== "noise" && priority !== "noise");

  let suggestedAction: string | null = null;
  if (actionRequired) {
    if (category === "sales") suggestedAction = "Review and respond to sales thread";
    else if (category === "customer") suggestedAction = "Address customer issue";
    else if (category === "finance") {
      // Differentiate shipping receipts from other finance emails
      if (/\b(shipping|postage|pirate\s*ship|shipstation|label)\b/.test(text)) {
        suggestedAction = "File for bank reconciliation — shipping/postage receipt";
      } else {
        suggestedAction = "Review financial request";
      }
    } else if (category === "production") suggestedAction = "Review production/supply chain update";
    else if (category === "regulatory" || category === "compliance")
      suggestedAction = "Review regulatory/compliance item";
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

/**
 * Detect outbound emails from Ben that haven't received a reply.
 * Cross-references SENT mail against INBOX to find unanswered threads.
 * Returns escalation overrides for emails where the recipient is a VIP/key contact.
 */
export async function detectAwaitingReplies(opts?: {
  sentCount?: number;
  lookbackHours?: number;
}): Promise<
  Array<{
    threadId: string;
    recipientEmail: string;
    recipientName: string;
    subject: string;
    sentAt: string;
    hoursAgo: number;
    escalation: "critical" | "important" | "info";
    reason: string;
  }>
> {
  const sentCount = opts?.sentCount ?? 30;
  const lookbackMs = (opts?.lookbackHours ?? 72) * 60 * 60 * 1000;
  const cutoff = Date.now() - lookbackMs;

  try {
    // Fetch recent sent emails
    const sentEnvelopes = await listEmails({
      folder: "SENT",
      count: sentCount,
      unreadOnly: false,
    });

    // Fetch recent inbox emails to find which threads have replies
    const inboxEnvelopes = await listEmails({
      folder: "INBOX",
      count: 100,
      unreadOnly: false,
    });

    // Build set of thread IDs that have inbox replies
    const repliedThreads = new Set(inboxEnvelopes.map((e) => e.threadId).filter(Boolean));

    // Build map: threadId → most recent SENT timestamp
    // If there are multiple sent items in a thread, only the NEWEST one
    // should be considered as "awaiting reply". This prevents false positives
    // when Ben replies to an ongoing thread (e.g., "Re: Re: ...").
    const latestSentPerThread = new Map<string, { date: number; index: number }>();
    for (let i = 0; i < sentEnvelopes.length; i++) {
      const sent = sentEnvelopes[i];
      if (!sent.threadId) continue;
      const ts = Date.parse(sent.date);
      if (!Number.isFinite(ts)) continue;
      const existing = latestSentPerThread.get(sent.threadId);
      if (!existing || ts > existing.date) {
        latestSentPerThread.set(sent.threadId, { date: ts, index: i });
      }
    }

    // Also check if the INBOX has messages NEWER than our sent message in the
    // same thread — that means someone replied even if threadId matching is off.
    const inboxThreadDates = new Map<string, number>();
    for (const env of inboxEnvelopes) {
      if (!env.threadId) continue;
      const ts = Date.parse(env.date);
      if (!Number.isFinite(ts)) continue;
      const existing = inboxThreadDates.get(env.threadId);
      if (!existing || ts > existing) {
        inboxThreadDates.set(env.threadId, ts);
      }
    }

    const awaiting: Array<{
      threadId: string;
      recipientEmail: string;
      recipientName: string;
      subject: string;
      sentAt: string;
      hoursAgo: number;
      escalation: "critical" | "important" | "info";
      reason: string;
    }> = [];

    // Track already-processed threads to avoid duplicates from multiple sent items
    const processedThreads = new Set<string>();

    for (let i = 0; i < sentEnvelopes.length; i++) {
      const sent = sentEnvelopes[i];

      // Skip if we already have a reply in inbox for this thread
      if (sent.threadId && repliedThreads.has(sent.threadId)) continue;

      // Skip old emails
      const sentDate = Date.parse(sent.date);
      if (!Number.isFinite(sentDate) || sentDate < cutoff) continue;

      // Only process the MOST RECENT sent item per thread
      if (sent.threadId) {
        if (processedThreads.has(sent.threadId)) continue;
        const latest = latestSentPerThread.get(sent.threadId);
        if (latest && latest.index !== i) continue; // Not the newest sent in this thread
        processedThreads.add(sent.threadId);
      }

      // Check if inbox has a message newer than this sent — means they replied
      if (sent.threadId) {
        const newestInbox = inboxThreadDates.get(sent.threadId);
        if (newestInbox && newestInbox > sentDate) continue;
      }

      // Extract recipient
      const recipientEmail = parseSenderEmail(sent.to || "");
      const recipientName = parseSenderName(sent.to || "");

      // Skip self-emails and system addresses
      if (
        recipientEmail.includes("ben@usagummies.com") ||
        recipientEmail.includes("benjamin.stutman@gmail.com") ||
        recipientEmail.includes("noreply") ||
        recipientEmail.includes("no-reply")
      ) {
        continue;
      }

      const hoursAgo = Math.round((Date.now() - sentDate) / (60 * 60 * 1000));

      // Check if recipient is a VIP — VIP unanswered emails escalate faster
      const vip = getVipSender(recipientEmail);
      let escalation: "critical" | "important" | "info" = "info";
      let reason = `Sent ${hoursAgo}h ago, no reply yet`;

      if (vip && (vip.priority === "critical" || vip.priority === "important")) {
        escalation = hoursAgo >= 24 ? "critical" : "important";
        reason = `${vip.name} — sent ${hoursAgo}h ago, no reply. ${vip.suggestedAction}`;
      } else if (hoursAgo >= 48) {
        escalation = "important";
        reason = `Sent ${hoursAgo}h ago to ${recipientName}, no reply — may need follow-up`;
      }

      // Only report important+ awaiting replies
      if (escalation === "info" && hoursAgo < 24) continue;

      awaiting.push({
        threadId: sent.threadId || "",
        recipientEmail,
        recipientName,
        subject: sent.subject || "(no subject)",
        sentAt: sent.date,
        hoursAgo,
        escalation,
        reason,
      });
    }

    // Sort: critical first, then by hours descending
    awaiting.sort((a, b) => {
      const esc = { critical: 0, important: 1, info: 2 };
      if (esc[a.escalation] !== esc[b.escalation]) return esc[a.escalation] - esc[b.escalation];
      return b.hoursAgo - a.hoursAgo;
    });

    return awaiting;
  } catch {
    return [];
  }
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

      // Extract attachment text for important emails (non-noise with attachments)
      let attachmentText = "";
      const attachmentSummaries: string[] = [];
      if (message.attachments.length > 0) {
        for (const att of message.attachments) {
          attachmentSummaries.push(
            `[Attachment: ${att.filename} (${att.mimeType}, ${(att.size / 1024).toFixed(0)}KB)]`,
          );
        }
        // Only download and extract text for non-tiny, non-image attachments (PDFs, spreadsheets, text)
        const extractable = message.attachments.filter(
          (a) =>
            a.size >= 1024 &&
            !a.mimeType.startsWith("image/") &&
            (a.mimeType === "application/pdf" ||
              a.mimeType.includes("spreadsheet") ||
              a.mimeType.includes("excel") ||
              a.mimeType.startsWith("text/") ||
              a.filename.toLowerCase().endsWith(".pdf") ||
              a.filename.toLowerCase().endsWith(".xlsx") ||
              a.filename.toLowerCase().endsWith(".csv")),
        );
        if (extractable.length > 0) {
          try {
            const contents = await readAllAttachments(message.id, extractable);
            for (const c of contents) {
              if (c.textContent) {
                attachmentText += `\n\n--- ATTACHMENT: ${c.filename} ---\n${c.textContent.slice(0, 10_000)}`;
              }
            }
          } catch {
            // Non-fatal — continue without attachment text
          }
        }
      }

      const body = (rawBody + attachmentText).slice(0, 45_000);
      const fromRaw = message.from || envelope.from || "";
      const senderEmail = parseSenderEmail(fromRaw);
      const senderName = parseSenderName(fromRaw);
      const receivedAt = parseReceivedAt(message.date || envelope.date);
      const classified = classifyEmail({
        from: fromRaw,
        subject,
        body: rawBody, // classify on body text, not attachment bulk
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
        summary: summarize(subject, body) +
          (attachmentSummaries.length > 0
            ? `\n${attachmentSummaries.join(" ")}`
            : ""),
        category: classified.category,
        priority: classified.priority,
        action_required: classified.actionRequired,
        suggested_action: classified.suggestedAction,
        draft_status: classified.actionRequired ? "pending_draft" : null,
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

/**
 * Detect stalled pipeline deals — leads that haven't had email activity
 * within a threshold period. VIP contacts get shorter thresholds.
 *
 * Compares pipeline data (from /api/ops/abra/pipeline) against recent
 * email activity to find deals going cold.
 */
export async function detectStalledDeals(opts?: {
  vipStallDays?: number;
  normalStallDays?: number;
}): Promise<
  Array<{
    leadName: string;
    email: string;
    stage: string;
    daysSinceContact: number;
    isVip: boolean;
    severity: "critical" | "important" | "info";
    reason: string;
  }>
> {
  const vipThreshold = opts?.vipStallDays ?? 5;
  const normalThreshold = opts?.normalStallDays ?? 10;
  const { getVipSender } = await import("@/lib/ops/abra-vip-senders");

  // Fetch pipeline leads from Supabase or Notion via the pipeline API
  const env = getSupabaseEnv();
  if (!env) return [];

  // Get deal email threads from the API
  let threads: Array<{
    contactEmail: string;
    lastActivity: string;
  }> = [];
  try {
    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:4000";
    const cronSecret = process.env.CRON_SECRET || "";
    const res = await fetch(`${baseUrl}/api/ops/abra/pipeline?view=deal-emails`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      threads = (data.threads || []).map(
        (t: { contactEmail: string; lastMessageDate: string }) => ({
          contactEmail: t.contactEmail.toLowerCase(),
          lastActivity: t.lastMessageDate,
        }),
      );
    }
  } catch {
    // Can't fetch deal emails — fall back to checking pipeline only
  }

  // Build email activity map
  const activityMap = new Map<string, Date>();
  for (const t of threads) {
    activityMap.set(t.contactEmail, new Date(t.lastActivity));
  }

  // Check recent sent emails for additional activity signals
  try {
    const sentEmails = await listEmails({ folder: "SENT", count: 50, unreadOnly: false });
    for (const env of sentEmails) {
      const to = (env.to || "").toLowerCase();
      const existing = activityMap.get(to);
      const sentDate = new Date(env.date || "");
      if (!existing || sentDate > existing) {
        activityMap.set(to, sentDate);
      }
    }
  } catch {
    // Gmail unavailable
  }

  // Now check pipeline leads
  const stalledDeals: Array<{
    leadName: string;
    email: string;
    stage: string;
    daysSinceContact: number;
    isVip: boolean;
    severity: "critical" | "important" | "info";
    reason: string;
  }> = [];

  // Fetch pipeline data
  try {
    const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:4000";
    const cronSecret = process.env.CRON_SECRET || "";
    const res = await fetch(`${baseUrl}/api/ops/abra/pipeline`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return stalledDeals;
    const data = await res.json();
    const leads = Object.values(data.stages || {}).flat() as Array<{
      name: string;
      email: string;
      status: string;
      lastContact: string;
    }>;

    const now = Date.now();
    for (const lead of leads) {
      if (!lead.email) continue;
      const email = lead.email.toLowerCase();
      const isVip = !!getVipSender(email);
      const threshold = isVip ? vipThreshold : normalThreshold;

      // Use email activity or lastContact from pipeline
      const lastActivity = activityMap.get(email)
        || (lead.lastContact ? new Date(lead.lastContact) : null);

      if (!lastActivity) continue;

      const daysSince = Math.floor((now - lastActivity.getTime()) / 86400000);
      if (daysSince < threshold) continue;

      // Skip closed/won/lost stages
      const stage = (lead.status || "").toLowerCase();
      if (stage.includes("closed") || stage.includes("won") || stage.includes("lost")) continue;

      stalledDeals.push({
        leadName: lead.name,
        email: lead.email,
        stage: lead.status,
        daysSinceContact: daysSince,
        isVip,
        severity: isVip ? "critical" : daysSince > normalThreshold * 2 ? "important" : "info",
        reason: isVip
          ? `VIP deal stalled: no contact with ${lead.name} in ${daysSince} days`
          : `Deal going cold: no contact with ${lead.name} in ${daysSince} days`,
      });
    }
  } catch {
    // Pipeline unavailable
  }

  return stalledDeals.sort((a, b) => b.daysSinceContact - a.daysSinceContact);
}
