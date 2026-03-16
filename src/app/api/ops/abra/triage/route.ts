/**
 * POST /api/ops/abra/triage — Proactive email triage by Abra
 *
 * Called by inbox monitor for every new email. Abra classifies urgency,
 * suggests actions, and can auto-handle routine items.
 *
 * Body: { from: string, subject: string, snippet: string, emailId: string, labels: string[] }
 * Auth: CRON_SECRET bearer token
 */
import { NextResponse } from "next/server";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { from, subject, snippet, emailId, labels } = (await req.json()) as {
    from?: string;
    subject?: string;
    snippet?: string;
    emailId?: string;
    labels?: string[];
  };

  if (!from || !subject) {
    return NextResponse.json(
      { error: "Missing from or subject" },
      { status: 400 },
    );
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json(
      { error: "No ANTHROPIC_API_KEY" },
      { status: 500 },
    );
  }

  // Quick triage via LLM — runs after response is sent
  after(async () => {
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
          max_tokens: 512,
          system: `You are Abra, triaging emails for USA Gummies (a CPG/candy brand). Classify each email and suggest actions.

Respond in JSON:
{
  "category": "urgent|action_needed|informational|routine|spam",
  "summary": "1-sentence summary",
  "suggested_action": "What Ben should do (or null if no action needed)",
  "notify_slack": true/false (true only for urgent or action_needed),
  "slack_message": "Short message for Slack if notify_slack is true"
}

Categories:
- urgent: Customer complaints, order issues, legal, payment failures, time-sensitive business
- action_needed: Requires Ben's response but not time-critical (B2B inquiries, partnership asks, vendor quotes)
- informational: Newsletters, updates, reports — no action needed
- routine: Shipping confirmations, receipts, automated notifications
- spam: Marketing spam, cold outreach, phishing

IMPORTANT: Respond ONLY with valid JSON.`,
          messages: [
            {
              role: "user",
              content: `FROM: ${from}\nSUBJECT: ${subject}\nSNIPPET: ${(snippet || "").slice(0, 500)}\nLABELS: ${(labels || []).join(", ")}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) return;

      const data = await res.json();
      const raw = data.content?.[0]?.text || "";

      let triage: {
        category: string;
        summary: string;
        suggested_action?: string;
        notify_slack?: boolean;
        slack_message?: string;
      };
      try {
        triage = JSON.parse(raw.trim());
      } catch {
        return;
      }

      // Store triage result in Supabase
      const sbUrl =
        process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (sbUrl && serviceKey) {
        await fetch(`${sbUrl}/rest/v1/abra_email_triage`, {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            email_id: emailId || "",
            sender: from,
            subject,
            category: triage.category,
            summary: triage.summary,
            suggested_action: triage.suggested_action || null,
            auto_handled: false,
          }),
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
      }

      // Post to Slack if urgent or action_needed
      if (triage.notify_slack && triage.slack_message) {
        const botToken = process.env.SLACK_BOT_TOKEN;
        const ABRA_COMMAND_CHANNEL = "C0ALS6W7VB4";
        if (botToken) {
          const emoji = triage.category === "urgent" ? "\u{1F6A8}" : "\u{1F4CB}";
          const slackText = `${emoji} *Email Triage — ${triage.category.toUpperCase()}*\n*From:* ${from}\n*Subject:* ${subject}\n*Summary:* ${triage.summary}${triage.suggested_action ? `\n*Suggested:* ${triage.suggested_action}` : ""}`;

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
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[abra-triage] Error:", err);
    }
  });

  return NextResponse.json({ ok: true, message: "Triage started" });
}
