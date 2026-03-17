/**
 * POST /api/ops/abra/inbox-scan — Cloud Gmail inbox scanner for Abra commands
 *
 * Replaces the laptop-dependent Agent 6 inbox monitor for Abra command detection.
 * Runs on Vercel serverless, triggered by QStash every 5 minutes.
 *
 * Flow:
 * 1. Read recent unread emails from Gmail API
 * 2. Check against Supabase for already-processed message IDs
 * 3. Classify each email with LLM (detect ABRA_COMMAND vs. normal)
 * 4. Post Abra commands to Slack #abra-control for approval
 * 5. Fire triage for non-command emails
 *
 * Auth: CRON_SECRET bearer token (QStash sends this)
 */
import { NextResponse } from "next/server";
import { listEmails, readEmail } from "@/lib/ops/gmail-reader";
import { detectAwaitingReplies, detectStalledDeals } from "@/lib/ops/abra-email-fetch";
import { expireStaleApprovals } from "@/lib/ops/abra-actions";
import { autoAcknowledgeStaleSignals } from "@/lib/ops/abra-operational-signals";
import { getVipSender, type VipSender } from "@/lib/ops/abra-vip-senders";
import { readState, writeState } from "@/lib/ops/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// eslint-disable-next-line no-control-regex
const SANITIZE_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
function sanitize(text: string, maxLen = 1000): string {
  return text.replace(SANITIZE_RE, "").slice(0, maxLen);
}

function sbHeaders() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

function sbUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

function parseSenderEmail(fromHeader: string): string {
  const bracket = fromHeader.match(/<([^>]+)>/);
  const extracted = bracket?.[1] || fromHeader;
  const email = extracted.trim().toLowerCase();
  return email.includes("@") ? email : "unknown@example.invalid";
}

function parseSenderName(fromHeader: string): string {
  const match = fromHeader.match(/^"?([^"<]+)"?\s*</);
  if (match?.[1]) return match[1].trim();
  return fromHeader.split("@")[0]?.trim() || "Unknown";
}

/** Check which Gmail message IDs already exist in abra_email_commands */
async function getProcessedIds(messageIds: string[]): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const existing = new Set<string>();

  for (let i = 0; i < messageIds.length; i += 50) {
    const chunk = messageIds.slice(i, i + 50);
    const filter = chunk.map((id) => `"${id}"`).join(",");
    try {
      const res = await fetch(
        `${sbUrl()}/rest/v1/abra_email_commands?email_id=in.(${filter})&select=email_id`,
        { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<{ email_id: string }>;
        for (const row of rows) {
          if (row.email_id) existing.add(row.email_id);
        }
      }
    } catch {
      // Continue — dedup is best-effort, DB unique index is the safety net
    }
  }

  // Also check triage table to avoid re-triaging
  for (let i = 0; i < messageIds.length; i += 50) {
    const chunk = messageIds.slice(i, i + 50);
    const filter = chunk.map((id) => `"${id}"`).join(",");
    try {
      const res = await fetch(
        `${sbUrl()}/rest/v1/abra_email_triage?email_id=in.(${filter})&select=email_id`,
        { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<{ email_id: string }>;
        for (const row of rows) {
          if (row.email_id) existing.add(row.email_id);
        }
      }
    } catch {
      // Continue
    }
  }

  return existing;
}

/** Fetch recent active corrections from Supabase for injection into LLM prompts */
async function fetchRecentCorrections(): Promise<string> {
  try {
    const url = sbUrl();
    if (!url) return "";
    const res = await fetch(
      `${url}/rest/v1/abra_corrections?active=eq.true&order=created_at.desc&limit=5&select=original_claim,correction`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return "";
    const rows = (await res.json()) as Array<{ original_claim: string; correction: string }>;
    if (rows.length === 0) return "";
    return "\n\nPAST CORRECTIONS (learn from these):\n" +
      rows.map((r) => `- WRONG: "${r.original_claim}" → RIGHT: "${r.correction}"`).join("\n");
  } catch {
    return "";
  }
}

/** LLM classification — detect Abra commands vs. normal email */
async function classifyEmail(
  from: string,
  subject: string,
  body: string,
): Promise<{
  isAbraCommand: boolean;
  abraTask: string | null;
  category: string;
  urgency: string;
}> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return { isAbraCommand: false, abraTask: null, category: "other", urgency: "low" };
  }

  // Fetch recent human corrections to inject as few-shot learning
  const corrections = await fetchRecentCorrections();

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        temperature: 0.1,
        system: `You are an email classifier for USA Gummies (CPG/candy brand).

If the sender explicitly addresses "Abra" (the AI assistant) and asks it to do something, classify as ABRA_COMMAND and extract the task.

KEY CONTACTS (emails from these people are always high urgency):
- Inderbitzin Distributors (Brent Overman, Jenny) — key distributor prospect, inventory allocation pending
- Powers Confections (Bill Turley) — co-packer, active 50K production run
- Albanese (Shana Keefe) — ingredient supplier, payment coordination needed
- Dutch Valley — alternative co-packer being evaluated
- Rene Gonzalez — internal finance team

URGENCY RULES:
- Emails from distributors/co-packers about orders, inventory, or production → always HIGH
- Shipping receipts (Pirate Ship, USPS, UPS) → MEDIUM (bank reconciliation)
- B2B interest/inquiry → HIGH
- Newsletters, marketing, cold outreach → LOW

Categories: ABRA_COMMAND, INTERESTED, NOT_INTERESTED, BOUNCE, QUESTION, ROUTINE, SPAM, OTHER

Respond with ONLY JSON:
{"category": "...", "urgency": "high|medium|low", "abra_task": "task description or null"}${corrections}`,
        messages: [
          {
            role: "user",
            content: `From: ${sanitize(from, 200)}\nSubject: ${sanitize(subject, 500)}\nBody:\n${sanitize(body, 2000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return { isAbraCommand: false, abraTask: null, category: "other", urgency: "low" };
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || "";
    const parsed = JSON.parse(raw.trim());

    const isAbra = parsed.category === "ABRA_COMMAND";
    return {
      isAbraCommand: isAbra,
      abraTask: isAbra && typeof parsed.abra_task === "string" ? parsed.abra_task : null,
      category: parsed.category || "other",
      urgency: parsed.urgency || "low",
    };
  } catch {
    return { isAbraCommand: false, abraTask: null, category: "other", urgency: "low" };
  }
}

/** Post an Abra command to Slack #abra-control and insert into Supabase */
async function postAbraCommand(params: {
  senderName: string;
  senderEmail: string;
  subject: string;
  task: string;
  emailId: string;
  bodySnippet: string;
  gmailThreadId: string;
}): Promise<boolean> {
  const { senderName, senderEmail, subject, task, emailId, bodySnippet, gmailThreadId } = params;
  const ABRA_COMMAND_CHANNEL = "C0ALS6W7VB4";
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return false;

  // Resolve or create thread
  let threadId: string | null = null;
  try {
    const normalizedSubject = subject
      .replace(/^(re|fwd|fw)\s*:\s*/gi, "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const normalizedSender = senderEmail.toLowerCase().trim();

    // Look for existing thread
    const threadRes = await fetch(
      `${sbUrl()}/rest/v1/abra_email_threads?normalized_subject=eq.${encodeURIComponent(normalizedSubject)}&sender_email=eq.${encodeURIComponent(normalizedSender)}&select=id&order=created_at.desc&limit=1`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(10000) },
    );
    if (threadRes.ok) {
      const threads = await threadRes.json();
      if (threads.length > 0) {
        threadId = threads[0].id;
      } else {
        // Create new thread
        const newId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await fetch(`${sbUrl()}/rest/v1/abra_email_threads`, {
          method: "POST",
          headers: { ...sbHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({
            id: newId,
            sender_email: normalizedSender,
            sender_name: senderName,
            subject: subject.slice(0, 500),
            normalized_subject: normalizedSubject,
            gmail_thread_id: gmailThreadId || null,
          }),
          signal: AbortSignal.timeout(10000),
        });
        threadId = newId;
      }
    }
  } catch {
    // Thread resolution is best-effort
  }

  // Insert command into Supabase
  const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const insertRes = await fetch(`${sbUrl()}/rest/v1/abra_email_commands`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({
        id: commandId,
        status: "pending_approval",
        sender_name: senderName,
        sender_email: senderEmail,
        subject,
        task,
        email_id: emailId,
        body_snippet: bodySnippet.slice(0, 2000),
        thread_id: threadId,
        gmail_thread_id: gmailThreadId || null,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!insertRes.ok) return false;
  } catch {
    return false;
  }

  // Post to Slack
  const threadTag = threadId ? `\n*Thread:* \`${threadId}\`` : "";
  const slackText = `\u{1F4E8} *Abra Command Received*\n*From:* ${senderName} (${senderEmail})\n*Subject:* ${subject}\n*Task:* ${task}\n*Command ID:* \`${commandId}\`${threadTag}\n\n_Reply with:_ \`/abra approve ${commandId}\` _or_ \`/abra deny ${commandId}\``;

  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: ABRA_COMMAND_CHANNEL,
        text: slackText,
        mrkdwn: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Command is in Supabase even if Slack fails
  }

  return true;
}

/** Fire triage for non-command emails */
async function triggerTriage(params: {
  from: string;
  subject: string;
  snippet: string;
  emailId: string;
}): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";

  try {
    await fetch(`${host}/api/ops/abra/triage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Fire-and-forget
  }
}

/**
 * For VIP/team emails that need a reply, proactively draft a response
 * and queue it in #abra-control for Ben's approval.
 */
async function draftVipReply(params: {
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  vip: VipSender;
  emailId: string;
  threadId: string;
}): Promise<boolean> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!anthropicKey || !botToken) return false;

  const sbUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !serviceKey) return false;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 800,
        system: `You are drafting an email reply on behalf of Ben Stutman, founder of USA Gummies.

SENDER CONTEXT: ${params.vip.draftingContext || `${params.vip.name} — ${params.vip.relationship}`}

RULES:
- Write as Ben, not as "Abra" or an AI
- Match the tone to the relationship (casual for team, professional for partners)
- Be specific and helpful — reference details from their email
- Keep it concise — no filler
- Sign off with "Best,\\nBen" unless tone should be more casual
- If you cannot write a useful reply (e.g., the email is purely informational with no question), respond with exactly: NO_REPLY_NEEDED

Respond with ONLY the email body text. No subject line, no "Dear X" unless appropriate for the relationship.`,
        messages: [
          {
            role: "user",
            content: `FROM: ${params.senderName} <${params.senderEmail}>\nSUBJECT: ${params.subject}\n\nBODY:\n${sanitize(params.body, 2000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return false;
    const data = await res.json();
    const draft = data.content?.[0]?.text?.trim() || "";

    if (!draft || draft === "NO_REPLY_NEEDED") return false;

    // Store as draft command in Supabase
    const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const storeRes = await fetch(`${sbUrl}/rest/v1/abra_email_commands`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: commandId,
        status: "draft_reply_pending",
        sender_name: params.senderName,
        sender_email: params.senderEmail,
        subject: params.subject,
        task: `Auto-drafted reply to ${params.senderName} (${params.vip.category})`,
        draft_reply_subject: `Re: ${params.subject}`,
        draft_reply_body: draft,
        body_snippet: params.body.slice(0, 500),
        gmail_thread_id: params.threadId || "",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!storeRes.ok) return false;

    // Post to Slack for review
    const ABRA_COMMAND_CHANNEL = "C0ALS6W7VB4";
    const draftPreview =
      draft.length > 300 ? draft.slice(0, 297) + "..." : draft;
    const slackText =
      `📧 *Auto-Draft Reply to ${params.senderName}*\n` +
      `*Subject:* Re: ${params.subject}\n\n` +
      `> ${draftPreview.split("\n").join("\n> ")}\n\n` +
      `_Send:_ \`/abra sendreply ${commandId}\`  |  _Discard:_ \`/abra deny ${commandId}\``;

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: ABRA_COMMAND_CHANNEL,
        text: slackText,
        mrkdwn: true,
      }),
      signal: AbortSignal.timeout(10000),
    });

    return true;
  } catch (err) {
    console.error("[inbox-scan] draftVipReply error:", err);
    return false;
  }
}

function isSystemMailbox(email: string): boolean {
  const system = [
    "mailer-daemon", "postmaster", "noreply", "no-reply", "donotreply",
    "notifications", "notification", "bounce", "auto-confirm",
  ];
  const local = email.split("@")[0]?.toLowerCase() || "";
  return system.some((s) => local.includes(s));
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Housekeeping: expire stale approvals + auto-ack old info signals
    await Promise.allSettled([
      expireStaleApprovals(24),
      autoAcknowledgeStaleSignals(48),
    ]);

    // Read recent emails from Gmail API
    const envelopes = await listEmails({
      folder: "INBOX",
      count: 30,
      unreadOnly: true,
    });

    if (envelopes.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0, commands: 0, triaged: 0 });
    }

    // Dedup against already-processed emails
    const messageIds = envelopes.map((e) => e.id);
    const processed = await getProcessedIds(messageIds);

    let scanned = 0;
    let commands = 0;
    let triaged = 0;
    let skipped = 0;

    for (const envelope of envelopes) {
      if (processed.has(envelope.id)) {
        skipped++;
        continue;
      }

      const senderEmail = parseSenderEmail(envelope.from);
      if (isSystemMailbox(senderEmail)) {
        skipped++;
        continue;
      }

      // Read full message body
      const message = await readEmail(envelope.id);
      if (!message) {
        skipped++;
        continue;
      }

      scanned++;
      const body = message.body || "";

      // Classify with LLM
      const classification = await classifyEmail(
        envelope.from,
        envelope.subject,
        body,
      );

      if (classification.isAbraCommand && classification.abraTask) {
        // Post Abra command to Slack
        const posted = await postAbraCommand({
          senderName: parseSenderName(envelope.from),
          senderEmail,
          subject: envelope.subject || "(no subject)",
          task: classification.abraTask,
          emailId: envelope.id,
          bodySnippet: body.slice(0, 500),
          gmailThreadId: envelope.threadId || "",
        });
        if (posted) commands++;
      } else {
        // Check if sender is a VIP who needs a proactive reply draft
        const vip = getVipSender(senderEmail);
        const needsDraft =
          vip &&
          vip.relationship !== "self" &&
          vip.category !== "noise" &&
          (vip.priority === "critical" || vip.priority === "important");

        if (needsDraft && vip) {
          const drafted = await draftVipReply({
            senderName: parseSenderName(envelope.from),
            senderEmail,
            subject: envelope.subject || "(no subject)",
            body,
            vip,
            emailId: envelope.id,
            threadId: envelope.threadId || "",
          });
          if (drafted) {
            commands++; // Count as a command since a draft was queued
          } else {
            // Draft generation failed or not needed — fall back to triage
            await triggerTriage({
              from: envelope.from || "",
              subject: envelope.subject || "(no subject)",
              snippet: body.slice(0, 500),
              emailId: envelope.id,
            });
            triaged++;
          }
        } else {
          // Non-VIP: standard triage
          await triggerTriage({
            from: envelope.from || "",
            subject: envelope.subject || "(no subject)",
            snippet: body.slice(0, 500),
            emailId: envelope.id,
          });
          triaged++;
        }
      }
    }

    // ---- VIP catch-up: scan recent READ emails from VIPs that don't have drafts yet ----
    try {
      const recentAll = await listEmails({
        folder: "INBOX",
        count: 20,
        unreadOnly: false,
      });
      for (const env of recentAll) {
        const email = parseSenderEmail(env.from);
        const vip = getVipSender(email);
        if (
          !vip ||
          vip.relationship === "self" ||
          vip.category === "noise" ||
          (vip.priority !== "critical" && vip.priority !== "important")
        ) {
          continue;
        }
        // Skip if we already have a command for this email
        if (processed.has(env.id)) continue;
        // Skip if we already processed it in the unread loop above
        const alreadyHandled = envelopes.some((u) => u.id === env.id);
        if (alreadyHandled) continue;

        // Check if a draft already exists for this sender+subject
        const existingRes = await fetch(
          `${sbUrl()}/rest/v1/abra_email_commands?sender_email=eq.${encodeURIComponent(email)}&status=in.(draft_reply_pending,pending_approval,executing)&limit=1&select=id`,
          { headers: sbHeaders(), signal: AbortSignal.timeout(5000) },
        );
        if (existingRes.ok) {
          const existing = await existingRes.json();
          if (Array.isArray(existing) && existing.length > 0) continue; // Already has a pending draft
        }

        const message = await readEmail(env.id);
        if (!message) continue;

        const drafted = await draftVipReply({
          senderName: parseSenderName(env.from),
          senderEmail: email,
          subject: env.subject || "(no subject)",
          body: message.body || "",
          vip,
          emailId: env.id,
          threadId: env.threadId || "",
        });
        if (drafted) commands++;
      }
    } catch (err) {
      console.error("[inbox-scan] VIP catch-up error:", err);
    }

    // ---- Awaiting-reply detection (cross-reference sent vs inbox) ----
    // Deduplication: track which threadIds we've already alerted about so we
    // don't spam Slack on every 5-minute scan cycle.
    let awaitingAlerts = 0;
    try {
      const awaiting = await detectAwaitingReplies({ sentCount: 30, lookbackHours: 72 });
      const criticalAwaiting = awaiting.filter((a) => a.escalation === "critical" || a.escalation === "important");

      if (criticalAwaiting.length > 0) {
        // Load previously-alerted threadIds from KV state
        const alertedState = await readState("abra-awaiting-reply-alerts", {} as Record<string, number>).catch(() => ({} as Record<string, number>));
        const alerted: Record<string, number> = alertedState;

        // Filter out threads we've already alerted in the last 12 hours
        const DEDUP_TTL_MS = 12 * 60 * 60 * 1000;
        const now = Date.now();
        const newAlerts = criticalAwaiting.filter((a) => {
          if (!a.threadId) return true; // No threadId → always alert
          const lastAlerted = alerted[a.threadId];
          return !lastAlerted || now - lastAlerted > DEDUP_TTL_MS;
        });

        if (newAlerts.length > 0) {
          const botToken = process.env.SLACK_BOT_TOKEN;
          const ABRA_COMMAND_CHANNEL = "C0ALS6W7VB4";
          if (botToken) {
            const lines = newAlerts.map((a) => {
              const emoji = a.escalation === "critical" ? "\u{1F6A8}" : "\u{26A0}\u{FE0F}";
              return `${emoji} *${a.recipientName}* — _${a.subject}_ (sent ${a.hoursAgo}h ago)\n   ${a.reason}`;
            });
            const slackText = `\u{1F4EC} *Awaiting Reply Alert*\nThese outbound emails have no reply yet:\n\n${lines.join("\n\n")}`;

            try {
              await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${botToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  channel: ABRA_COMMAND_CHANNEL,
                  text: slackText,
                  mrkdwn: true,
                }),
                signal: AbortSignal.timeout(10000),
              });
              awaitingAlerts = newAlerts.length;

              // Record alert timestamps for dedup
              for (const a of newAlerts) {
                if (a.threadId) alerted[a.threadId] = now;
              }
              // Prune entries older than 72h
              for (const [tid, ts] of Object.entries(alerted)) {
                if (now - ts > 72 * 60 * 60 * 1000) delete alerted[tid];
              }
              await writeState("abra-awaiting-reply-alerts", alerted).catch(() => {});
            } catch {
              // Slack post is best-effort
            }
          }
        }
      }
    } catch {
      // Awaiting-reply detection is best-effort
    }

    // ---- Deal stall detection (with dedup) ----
    let stalledAlerts = 0;
    try {
      const stalled = await detectStalledDeals({ vipStallDays: 5, normalStallDays: 10 });
      const important = stalled.filter((d) => d.severity === "critical" || d.severity === "important");

      if (important.length > 0) {
        // Dedup: only alert once per lead per 24h
        const stalledAlerted = await readState("abra-stalled-deal-alerts", {} as Record<string, number>).catch(() => ({} as Record<string, number>));
        const now = Date.now();
        const STALL_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

        const newStalled = important.filter((d) => {
          const key = d.email || d.leadName;
          const last = stalledAlerted[key];
          return !last || now - last > STALL_DEDUP_TTL_MS;
        });

        if (newStalled.length > 0) {
          const botToken = process.env.SLACK_BOT_TOKEN;
          const ABRA_COMMAND_CHANNEL = "C0ALS6W7VB4";
          if (botToken) {
            const lines = newStalled.map((d) => {
              const emoji = d.severity === "critical" ? "\u{1F6A8}" : "\u{26A0}\u{FE0F}";
              return `${emoji} *${d.leadName}* (${d.stage}) \u2014 ${d.daysSinceContact} days silent\n   ${d.reason}`;
            });
            const slackText = `\u{1F4C9} *Stalled Deal Alert*\nThese pipeline deals are going cold:\n\n${lines.join("\n\n")}`;

            try {
              await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${botToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  channel: ABRA_COMMAND_CHANNEL,
                  text: slackText,
                  mrkdwn: true,
                }),
                signal: AbortSignal.timeout(10000),
              });
              stalledAlerts = newStalled.length;

              for (const d of newStalled) {
                stalledAlerted[d.email || d.leadName] = now;
              }
              for (const [k, ts] of Object.entries(stalledAlerted)) {
                if (now - ts > 72 * 60 * 60 * 1000) delete stalledAlerted[k];
              }
              await writeState("abra-stalled-deal-alerts", stalledAlerted).catch(() => {});
            } catch {
              // Slack post is best-effort
            }
          }
        }
      }
    } catch {
      // Deal stall detection is best-effort
    }

    return NextResponse.json({
      ok: true,
      scanned,
      commands,
      triaged,
      skipped,
      awaitingAlerts,
      stalledAlerts,
      total: envelopes.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Graceful degradation for Gmail not configured
    if (/gmail.*not configured/i.test(msg)) {
      return NextResponse.json({
        ok: true,
        scanned: 0,
        commands: 0,
        triaged: 0,
        note: "Gmail API not configured — skipping",
      });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
