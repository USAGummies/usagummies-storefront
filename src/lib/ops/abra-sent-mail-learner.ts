/**
 * Abra Sent Mail Learner — Phase 4B
 *
 * Scans Ben's Gmail Sent folder to extract communication style patterns.
 * Stores representative examples as brain entries so the email drafter
 * can retrieve them via RAG during reply generation.
 *
 * Runs on schedule (daily or weekly) from inbox-scan or scheduler.
 * Idempotent: tracks processed message IDs in Supabase to avoid re-processing.
 *
 * SAFETY: Only reads sent mail. Never sends anything. No external side effects.
 */

import { listEmails, readEmail, type EmailMessage } from "@/lib/ops/gmail-reader";
import { generateEmbedding } from "@/lib/ops/abra-embeddings";
import { getVipSender } from "@/lib/ops/abra-vip-senders";

// ─── Types ──────────────────────────────────────────────────────────────

export type SentMailLearnResult = {
  scanned: number;
  learned: number;
  skipped: number;
  errors: number;
};

type StylePattern = {
  recipientEmail: string;
  recipientDomain: string;
  relationship: string; // "vendor" | "investor" | "team" | "customer" | "partner" | "unknown"
  department: string;
  subject: string;
  bodyExcerpt: string; // First 800 chars — enough for style, not enough to leak sensitive data
  wordCount: number;
  hasGreeting: boolean;
  hasSignoff: boolean;
  toneMarkers: string[]; // ["casual", "direct", "warm", "formal", etc.]
  sentAt: string;
};

// ─── Supabase helpers ───────────────────────────────────────────────────

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
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
    try { json = JSON.parse(text); } catch { json = text; }
  }
  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${String(json || "").slice(0, 300)}`,
    );
  }
  return json;
}

// ─── Noise / skip filters ───────────────────────────────────────────────

const SKIP_DOMAINS = new Set([
  "noreply.github.com",
  "notifications.google.com",
  "amazonses.com",
  "sendgrid.net",
  "mailchimp.com",
]);

/** Emails we don't want to learn from */
function shouldSkipMessage(msg: EmailMessage): boolean {
  // Skip auto-replies and forwards
  const subjectLower = (msg.subject || "").toLowerCase();
  if (subjectLower.startsWith("fwd:") || subjectLower.startsWith("fw:")) return true;

  // Skip if body is too short (likely a one-word ack)
  if ((msg.body || "").trim().length < 30) return true;

  // Skip if sent to noise domains
  const toDomain = (msg.to || "").split("@")[1]?.split(">")[0]?.toLowerCase();
  if (toDomain && SKIP_DOMAINS.has(toDomain)) return true;

  return false;
}

// ─── Style extraction ───────────────────────────────────────────────────

const GREETING_RE = /^(hi|hey|hello|good morning|good afternoon|dear|thanks|thank you)/im;
const SIGNOFF_RE = /(best|regards|cheers|thanks|thank you|sincerely|talk soon|ben)\s*[,.]?\s*$/im;
const CASUAL_MARKERS = /(!{2,}|lol|haha|btw|fyi|gonna|wanna|gotta|y'all|cool|awesome|sweet)/i;
const FORMAL_MARKERS = /(pursuant|hereby|per our conversation|as discussed|please find attached|kindly)/i;
const DIRECT_MARKERS = /(let me know|can you|need you to|please send|i'll|we'll|let's)/i;
const WARM_MARKERS = /(hope you're|hope this finds|great to hear|excited|looking forward|appreciate)/i;

function extractToneMarkers(body: string): string[] {
  const markers: string[] = [];
  if (CASUAL_MARKERS.test(body)) markers.push("casual");
  if (FORMAL_MARKERS.test(body)) markers.push("formal");
  if (DIRECT_MARKERS.test(body)) markers.push("direct");
  if (WARM_MARKERS.test(body)) markers.push("warm");
  if (markers.length === 0) markers.push("neutral");
  return markers;
}

function classifyRelationship(email: string): { relationship: string; department: string } {
  const vip = getVipSender(email);
  if (vip) {
    // Map VIP category to department
    const catToDept: Record<string, string> = {
      production: "operations",
      sales: "sales_and_growth",
      finance: "finance",
      retail: "sales_and_growth",
      marketplace: "sales_and_growth",
      regulatory: "operations",
      customer: "support",
      compliance: "operations",
    };
    return {
      relationship: vip.relationship || "known",
      department: catToDept[vip.category] || "executive",
    };
  }

  const domain = email.split("@")[1]?.toLowerCase() || "";

  // Known vendor domains
  if (domain.includes("powers") || domain.includes("albanese")) {
    return { relationship: "vendor", department: "operations" };
  }
  if (domain.includes("faire")) {
    return { relationship: "partner", department: "sales_and_growth" };
  }
  if (domain.includes("usagummies")) {
    return { relationship: "team", department: "executive" };
  }

  return { relationship: "unknown", department: "executive" };
}

function stripQuotedText(body: string): string {
  // Remove quoted replies (lines starting with >)
  const lines = body.split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    // Stop at "On ... wrote:" or "------" reply separator
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^-{3,}/.test(line.trim()) && cleaned.length > 3) break;
    if (/^>{1,}/.test(line.trim())) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}

function extractStylePattern(msg: EmailMessage): StylePattern {
  const recipientEmail = (msg.to || "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
  const recipientDomain = recipientEmail.split("@")[1] || "";
  const { relationship, department } = classifyRelationship(recipientEmail);

  const cleanBody = stripQuotedText(msg.body || "");
  const bodyExcerpt = cleanBody.slice(0, 800);
  const wordCount = cleanBody.split(/\s+/).filter(Boolean).length;

  return {
    recipientEmail,
    recipientDomain,
    relationship,
    department,
    subject: (msg.subject || "").slice(0, 200),
    bodyExcerpt,
    wordCount,
    hasGreeting: GREETING_RE.test(cleanBody),
    hasSignoff: SIGNOFF_RE.test(cleanBody),
    toneMarkers: extractToneMarkers(cleanBody),
    sentAt: msg.date || new Date().toISOString(),
  };
}

// ─── Brain storage ──────────────────────────────────────────────────────

async function storeSentMailPattern(pattern: StylePattern): Promise<void> {
  const title = `Sent mail style: ${pattern.relationship} — ${pattern.recipientDomain || pattern.recipientEmail}`;

  // Build a text block that the RAG system can retrieve contextually
  const rawText = [
    `Ben's email to ${pattern.recipientEmail} (${pattern.relationship})`,
    `Subject: ${pattern.subject}`,
    `Tone: ${pattern.toneMarkers.join(", ")}`,
    `Length: ${pattern.wordCount} words`,
    `Greeting: ${pattern.hasGreeting ? "yes" : "no"}`,
    `Sign-off: ${pattern.hasSignoff ? "yes" : "no"}`,
    `---`,
    pattern.bodyExcerpt,
  ].join("\n");

  // Generate embedding for this pattern
  const embedding = await generateEmbedding(
    `${pattern.recipientEmail} ${pattern.relationship} ${pattern.department} ${pattern.subject} ${pattern.bodyExcerpt.slice(0, 300)}`,
  );

  // Store in brain as WARM tier (useful but not critical)
  await sbFetch("/rest/v1/brain", {
    method: "POST",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      raw_text: rawText,
      summary_text: `Email style example: ${pattern.toneMarkers.join(", ")} tone, ${pattern.wordCount} words, to ${pattern.relationship} (${pattern.recipientDomain})`,
      category: "operational",
      department: pattern.department,
      confidence: "high",
      priority: "normal",
      source: "sent_mail_learner",
      source_id: `sent_${pattern.recipientEmail}_${pattern.sentAt}`,
      tags: ["writing_style", "sent_mail", pattern.relationship, pattern.department],
      embedding,
    }),
  });
}

async function getProcessedMessageIds(): Promise<Set<string>> {
  try {
    const rows = (await sbFetch(
      `/rest/v1/brain?source=eq.sent_mail_learner&select=source_id&limit=500`,
    )) as Array<{ source_id: string }>;
    return new Set(
      (rows || [])
        .map((r) => r.source_id)
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Scan Ben's sent mail and learn communication patterns.
 * Idempotent — skips already-processed messages.
 *
 * @param count Max messages to scan per run (default 30)
 * @param daysBack How far back to look (default 30)
 */
export async function learnFromSentMail(params?: {
  count?: number;
  daysBack?: number;
}): Promise<SentMailLearnResult> {
  const count = params?.count || 30;
  const daysBack = params?.daysBack || 30;

  const result: SentMailLearnResult = {
    scanned: 0,
    learned: 0,
    skipped: 0,
    errors: 0,
  };

  // 1. Get already-processed IDs
  const processedIds = await getProcessedMessageIds();

  // 2. List recent sent emails
  const afterDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const afterStr = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, "0")}/${String(afterDate.getDate()).padStart(2, "0")}`;

  const envelopes = await listEmails({
    folder: "SENT",
    count,
    query: `after:${afterStr}`,
  });

  // 3. Process each email
  for (const env of envelopes) {
    result.scanned += 1;

    // Skip if already processed
    const sourceId = `sent_${(env.to || "unknown").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase()}_${env.date}`;
    if (processedIds.has(sourceId)) {
      result.skipped += 1;
      continue;
    }

    try {
      // Read full message
      const msg = await readEmail(env.id);
      if (!msg) {
        result.skipped += 1;
        continue;
      }

      // Skip noise
      if (shouldSkipMessage(msg)) {
        result.skipped += 1;
        continue;
      }

      // Extract style and store
      const pattern = extractStylePattern(msg);
      await storeSentMailPattern(pattern);
      result.learned += 1;
    } catch (err) {
      result.errors += 1;
      console.error(
        `[sent-mail-learner] Error processing ${env.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (result.learned > 0) {
    console.log(
      `[sent-mail-learner] Learned ${result.learned} style patterns from ${result.scanned} sent emails`,
    );
  }

  return result;
}

/**
 * Get a summary of learned communication styles by relationship type.
 * Useful for debugging and for the system prompt.
 */
export async function getSentMailStyleSummary(): Promise<Record<string, {
  count: number;
  avgWordCount: number;
  commonTone: string[];
  greetingRate: number;
}>> {
  try {
    const rows = (await sbFetch(
      `/rest/v1/brain?source=eq.sent_mail_learner&select=raw_text,summary_text&limit=200`,
    )) as Array<{ raw_text: string; summary_text: string }>;

    const byRelationship: Record<string, {
      count: number;
      totalWords: number;
      tones: Record<string, number>;
      greetings: number;
    }> = {};

    for (const row of rows || []) {
      // Parse summary to get relationship and stats
      const relMatch = row.summary_text?.match(/to (\w+) \(/);
      const rel = relMatch?.[1] || "unknown";
      const wordMatch = row.summary_text?.match(/(\d+) words/);
      const words = wordMatch ? parseInt(wordMatch[1], 10) : 50;
      const toneMatch = row.summary_text?.match(/style example: ([^,]+(?:, [^,]+)*) tone/);
      const tones = toneMatch?.[1]?.split(", ") || ["neutral"];
      const greetingMatch = row.raw_text?.includes("Greeting: yes");

      if (!byRelationship[rel]) {
        byRelationship[rel] = { count: 0, totalWords: 0, tones: {}, greetings: 0 };
      }
      byRelationship[rel].count += 1;
      byRelationship[rel].totalWords += words;
      for (const t of tones) {
        byRelationship[rel].tones[t] = (byRelationship[rel].tones[t] || 0) + 1;
      }
      if (greetingMatch) byRelationship[rel].greetings += 1;
    }

    const summary: Record<string, {
      count: number;
      avgWordCount: number;
      commonTone: string[];
      greetingRate: number;
    }> = {};

    for (const [rel, data] of Object.entries(byRelationship)) {
      const sortedTones = Object.entries(data.tones)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t);

      summary[rel] = {
        count: data.count,
        avgWordCount: Math.round(data.totalWords / data.count),
        commonTone: sortedTones,
        greetingRate: Math.round((data.greetings / data.count) * 100) / 100,
      };
    }

    return summary;
  } catch (err) {
    console.error("[sent-mail-learner] getSentMailStyleSummary error:", err);
    return {};
  }
}
