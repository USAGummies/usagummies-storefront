/**
 * Abra Email Response Drafter
 *
 * Proactively drafts email replies for action-required emails.
 * Pipeline: email_events (action_required=true, draft_status=NULL)
 *   → embedding + brain search for context
 *   → Claude drafts a response
 *   → proposeAction() creates an approval (action_type=auto_reply)
 *   → Slack notification for Ben to review
 *   → Ben approves → sendOpsEmail() sends it
 *
 * SAFETY: Drafts NEVER auto-send. Always requires human approval.
 */

import { generateEmbedding } from "@/lib/ops/abra-embeddings";
import { searchTiered, buildTieredContext } from "@/lib/ops/abra-memory-tiers";
import { proposeAction } from "@/lib/ops/abra-actions";
import { notify } from "@/lib/ops/notify";
import {
  logAICost,
  extractClaudeUsage,
  getPreferredClaudeModel,
} from "@/lib/ops/abra-cost-tracker";
import { getVipSender } from "@/lib/ops/abra-vip-senders";
import { getActivePrompt } from "@/lib/ops/auto-research-runner";

export type EmailDraftResult = {
  processed: number;
  drafted: number;
  skipped: number;
  errors: number;
};

type EmailRow = {
  id: string;
  sender_name: string | null;
  sender_email: string;
  subject: string | null;
  summary: string | null;
  raw_text: string | null;
  category: string | null;
  priority: string | null;
};

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials for email drafter");
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

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return key;
}

// Cache the Supabase prompt for 5 minutes to avoid per-email fetches
let _cachedPrompt: { text: string; version: number; fetchedAt: number } | null = null;
const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000;

async function getVersionedPrompt(): Promise<{ text: string; version: number } | null> {
  if (_cachedPrompt && Date.now() - _cachedPrompt.fetchedAt < PROMPT_CACHE_TTL_MS) {
    return { text: _cachedPrompt.text, version: _cachedPrompt.version };
  }

  try {
    const result = await getActivePrompt("email_drafter");
    if (result) {
      _cachedPrompt = {
        text: result.prompt_text,
        version: result.version,
        fetchedAt: Date.now(),
      };
      return { text: result.prompt_text, version: result.version };
    }
  } catch (err) {
    console.warn("[email-drafter] Could not load versioned prompt, using hardcoded fallback:", err instanceof Error ? err.message : err);
  }
  return null;
}

async function buildDraftingPrompt(params: {
  senderName: string;
  senderEmail: string;
  subject: string;
  emailBody: string;
  category: string;
  brainContext: string;
  vipContext: string | null;
  senderRelationship: string | null;
}): Promise<string> {
  const vipBlock = params.vipContext
    ? `\nSENDER CONTEXT (IMPORTANT — this person is known to us):\nRelationship: ${params.senderRelationship || "known contact"}\n${params.vipContext}\n`
    : "";

  const toneRule = params.senderRelationship === "team"
    ? "- This is an INTERNAL team member. Write casually, like a Slack message or quick text. No formal greetings or sign-offs needed. Get straight to the point."
    : params.senderRelationship === "vendor"
    ? "- This is a known vendor/supplier. Be direct and professional but warm."
    : params.senderRelationship === "investor"
    ? "- This is an investor. Be professional, transparent, and proactive with updates."
    : "- Write as Ben. Friendly, professional, concise.";

  // Try loading versioned prompt from Supabase (auto-research managed)
  const versioned = await getVersionedPrompt();
  if (versioned) {
    let prompt = versioned.text;
    prompt = prompt.replace(/\{\{SENDER_NAME\}\}/g, params.senderName);
    prompt = prompt.replace(/\{\{SENDER_EMAIL\}\}/g, params.senderEmail);
    prompt = prompt.replace(/\{\{SUBJECT\}\}/g, params.subject);
    prompt = prompt.replace(/\{\{CATEGORY\}\}/g, params.category);
    prompt = prompt.replace(/\{\{VIP_BLOCK\}\}/g, vipBlock);
    prompt = prompt.replace(/\{\{EMAIL_BODY\}\}/g, params.emailBody.slice(0, 3000));
    prompt = prompt.replace(/\{\{BRAIN_CONTEXT\}\}/g, params.brainContext.slice(0, 2000));
    prompt = prompt.replace(/\{\{TONE_RULE\}\}/g, toneRule);
    return prompt;
  }

  // Hardcoded fallback — always works even if Supabase is down
  return `You are drafting an email reply on behalf of Ben Stutman, CEO of USA Gummies (a dye-free gummy candy company).

SENDER: ${params.senderName} <${params.senderEmail}>
SUBJECT: ${params.subject}
CATEGORY: ${params.category}
${vipBlock}
EMAIL BODY (truncated):
${params.emailBody.slice(0, 3000)}

BRAIN CONTEXT (what we know about this sender/topic):
${params.brainContext.slice(0, 2000)}

DRAFTING RULES:
${toneRule}
- FINANCIAL DATA REQUESTS (HIGHEST PRIORITY — overrides all other rules): If the sender asks for expenses, reports, bookkeeping data, financial records, or any accounting info → DO NOT ask clarifying questions. DELIVER THE DATA IMMEDIATELY. Share this Notion ledger link: https://www.notion.so/6325d16870024b83876b9e591b3d2d9c — tell them they can filter by date, category, vendor, or fiscal year, and export to CSV/Excel directly from Notion. If they specified a format (e.g., "Excel"), confirm they can export from the link. Be the accountant who delivers, not a secretary who asks questions.
- Sales inquiries → express interest, suggest a call, do NOT commit to pricing or terms.
- Vendor communications → acknowledge, confirm receipt, ask clarifying questions if needed.
- Customer issues → empathize, propose resolution, offer to follow up.
- Finance (invoices/payments) → acknowledge receipt, confirm timeline for processing.
- NEVER commit to specific pricing, delivery dates, contract terms, or payment amounts.
- ALWAYS include a [NOTE FOR BEN] section at the end flagging items that need human judgment.
- Do NOT include a sign-off or signature — one is added automatically ("Abra — via Benjamin").
- Keep the reply under 200 words.

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "subject": "Re: ...",
  "body": "The email reply text",
  "confidence": 0.0-1.0,
  "note_for_ben": "What needs human review before sending"
}`;
}

async function draftReplyForEmail(email: EmailRow): Promise<{
  drafted: boolean;
  error?: string;
}> {
  const subject = email.subject || "(no subject)";
  const body = email.raw_text || email.summary || subject;
  const senderName = email.sender_name || email.sender_email.split("@")[0] || "Unknown";

  // 1. Generate embedding for context search
  const embeddingText = `${subject} ${body.slice(0, 500)} ${senderName} ${email.sender_email}`;
  const embedding = await generateEmbedding(embeddingText);

  // 2. Search brain for relevant context about sender/topic
  const tieredResults = await searchTiered({
    embedding,
    matchCount: 6,
    filterTables: ["brain", "email"],
  });
  const brainContext = buildTieredContext(tieredResults);

  // 3. Call Claude to draft the reply (with VIP context if available)
  const vip = getVipSender(email.sender_email);
  const model = await getPreferredClaudeModel("claude-sonnet-4-20250514");
  const prompt = await buildDraftingPrompt({
    senderName,
    senderEmail: email.sender_email,
    subject,
    emailBody: body,
    category: email.category || "general",
    brainContext,
    vipContext: vip?.draftingContext || null,
    senderRelationship: vip?.relationship || null,
  });

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getAnthropicKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => "");
    throw new Error(`Claude API failed (${anthropicRes.status}): ${errText.slice(0, 200)}`);
  }

  const payload = (await anthropicRes.json()) as Record<string, unknown>;

  // Log cost
  const usage = extractClaudeUsage(payload);
  if (usage) {
    void logAICost({
      model,
      provider: "anthropic",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      endpoint: "email_drafter",
      department: email.category === "finance" ? "finance" : "operations",
    });
  }

  // 4. Parse Claude's response
  const content = payload.content;
  const textBlock =
    Array.isArray(content) &&
    content[0] &&
    typeof content[0] === "object" &&
    "text" in (content[0] as Record<string, unknown>)
      ? String((content[0] as Record<string, unknown>).text)
      : "";

  let parsed: {
    subject?: string;
    body?: string;
    confidence?: number;
    note_for_ben?: string;
  };
  try {
    parsed = JSON.parse(textBlock) as typeof parsed;
  } catch {
    // Try extracting JSON from text
    const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
    } else {
      return { drafted: false, error: "Could not parse draft response" };
    }
  }

  if (!parsed.body || parsed.body.length < 10) {
    return { drafted: false, error: "Draft body too short or missing" };
  }

  // 4b. Append Abra signature to draft body
  const signedBody = `${parsed.body.trimEnd()}\n\n—\nAbra — via Benjamin\nUSA Gummies`;

  // 5. Create approval via proposeAction
  await proposeAction({
    action_type: "draft_email_reply",
    title: `Draft reply to ${senderName}: ${subject.slice(0, 60)}`,
    description: `Auto-drafted email reply. ${parsed.note_for_ben || ""}`,
    department: email.category === "finance" ? "finance" : email.category === "sales" ? "sales_and_growth" : "operations",
    risk_level: "medium",
    requires_approval: true,
    confidence: parsed.confidence || 0.7,
    params: {
      to: email.sender_email,
      subject: parsed.subject || `Re: ${subject}`,
      body: signedBody,
      source_email_id: email.id,
      note_for_ben: parsed.note_for_ben || null,
    },
  });

  // 6. Update draft_status
  await sbFetch(
    `/rest/v1/email_events?id=eq.${encodeURIComponent(email.id)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ draft_status: "draft_ready" }),
    },
  );

  // 7. Notify on Slack
  const truncSubject = subject.length > 50 ? subject.slice(0, 47) + "..." : subject;
  void notify({
    channel: "alerts",
    text: `📧 *Draft reply ready* for ${senderName} re: "${truncSubject}"\n${parsed.note_for_ben ? `⚠️ ${parsed.note_for_ben}` : "Review in ops dashboard or approve via Slack."}`,
  }).catch(() => {});

  return { drafted: true };
}

/**
 * Main entry point: process action-required emails that haven't been drafted yet.
 */
export async function generateActionableEmailDrafts(params?: {
  limit?: number;
}): Promise<EmailDraftResult> {
  const limit = params?.limit || 10;
  const result: EmailDraftResult = {
    processed: 0,
    drafted: 0,
    skipped: 0,
    errors: 0,
  };

  // Fetch emails needing drafts
  const rows = (await sbFetch(
    `/rest/v1/email_events?action_required=eq.true&draft_status=eq.pending_draft&select=id,sender_name,sender_email,subject,summary,raw_text,category,priority&order=received_at.desc&limit=${limit}`,
  )) as EmailRow[];

  if (!Array.isArray(rows) || rows.length === 0) {
    return result;
  }

  for (const email of rows) {
    result.processed += 1;

    // Skip noise emails
    if (email.priority === "noise" || email.category === "noise") {
      await sbFetch(
        `/rest/v1/email_events?id=eq.${encodeURIComponent(email.id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ draft_status: "skipped" }),
        },
      );
      result.skipped += 1;
      continue;
    }

    try {
      const outcome = await draftReplyForEmail(email);
      if (outcome.drafted) {
        result.drafted += 1;
      } else {
        result.skipped += 1;
        console.warn(`[email-drafter] Skipped ${email.id}: ${outcome.error}`);
      }
    } catch (error) {
      result.errors += 1;
      console.error(
        `[email-drafter] Error drafting for ${email.id}:`,
        error instanceof Error ? error.message : error,
      );
      // Don't block other emails — continue processing
    }
  }

  return result;
}
