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
import { getVipSender } from "@/lib/ops/abra-vip-senders";
import { readState, writeState } from "@/lib/ops/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Strip control chars from untrusted input before injecting into LLM prompts */
function sanitize(text: string, maxLen = 1000): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, maxLen);
}

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
          system: `You are Abra, triaging emails for USA Gummies (a CPG/candy brand). Classify each email and suggest specific, actionable next steps.

BUSINESS CONTEXT (use this to assess urgency):
- Active co-packer: Powers Confections (Bill Turley), Spokane WA. Rate: $0.35/bag tolling. 50K unit production run in planning.
- Key distributor prospect: Inderbitzin Distributors (Brent Overman). Their inventory allocation decision directly impacts the production run. TREAT AS HIGHEST PRIORITY if they haven't replied to Ben's outreach.
- Ingredient supplier: Albanese Confectionery (Shana Keefe). Payment timing depends on freight confirmation from Bill/Powers.
- Alternative co-packer being evaluated: Dutch Valley. Compare quotes against Powers' $0.35/bag.
- Shipping provider: Pirate Ship. Receipts matter for bank reconciliation — NOT routine noise.
- Available inventory: 500 units in 7 days, 100 units in 24 hours.
- Finance team: Rene Gonzalez handles bookkeeping.

Respond in JSON:
{
  "category": "urgent|action_needed|informational|routine|spam",
  "summary": "1-sentence summary",
  "suggested_action": "SPECIFIC next step Ben should take (not generic — reference the business context above)",
  "notify_slack": true/false (true for urgent or action_needed),
  "slack_message": "Short Slack notification if notify_slack is true"
}

Categories:
- urgent: Unanswered emails from distributors/co-packers affecting production decisions, customer complaints, order issues, legal, payment failures, time-sensitive business
- action_needed: Requires Ben's response but not time-critical (B2B inquiries, vendor quotes, partnership asks)
- informational: Newsletters, updates, reports
- routine: Automated notifications (but NOT shipping receipts — those are action_needed for reconciliation)
- spam: Marketing spam, cold outreach, phishing

IMPORTANT: Respond ONLY with valid JSON. Make suggested_action SPECIFIC — reference names, amounts, deadlines from the email.`,
          messages: [
            {
              role: "user",
              content: `FROM: ${sanitize(from)}\nSUBJECT: ${sanitize(subject)}\nSNIPPET: ${sanitize((snippet || "").slice(0, 500))}\nLABELS: ${(labels || []).join(", ")}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) return;

      const data = await res.json();
      const raw = data.content?.[0]?.text || "";

      // Strip markdown code fences if the LLM wraps its JSON response
      const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

      let triage: {
        category: string;
        summary: string;
        suggested_action?: string;
        notify_slack?: boolean;
        slack_message?: string;
      };
      try {
        triage = JSON.parse(jsonStr);
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
        }).then((r) => {
          if (!r.ok) r.text().then((t) => console.error("[abra-triage] Supabase insert failed:", r.status, t));
        }).catch((err) => console.error("[abra-triage] Supabase insert error:", err));
      }

      // Post to Slack if urgent or action_needed
      const botToken = process.env.SLACK_BOT_TOKEN;
      const ABRA_COMMAND_CHANNEL = "C0ALS6W7VB4";

      if (triage.notify_slack && triage.slack_message && botToken) {
        const emoji = triage.category === "urgent" ? "\u{1F6A8}" : "\u{1F4CB}";
        const slackText = `${emoji} *Email Triage — ${triage.category.toUpperCase()}*\n*From:* ${from}\n*Subject:* ${subject}\n*Summary:* ${triage.summary}${triage.suggested_action ? `\n*Suggested:* ${triage.suggested_action}` : ""}`;

        // For VIP senders, try to post as thread reply to keep conversations grouped
        const senderEmail = from.match(/<([^>]+)>/)?.[1] || from;
        const vip = getVipSender(senderEmail);

        if (vip && vip.relationship !== "self") {
          // Look for an existing Slack thread for this VIP
          const domain = senderEmail.split("@")[1]?.toLowerCase() || "";
          const threadLookupKey = domain || senderEmail.toLowerCase();

          const vipThreads = await readState("abra-vip-slack-threads", {} as Record<string, string>);
          const threadTs = vipThreads[threadLookupKey] || null;

          if (threadTs) {
            // Post as thread reply
            await fetch("https://slack.com/api/chat.postMessage", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${botToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                channel: ABRA_COMMAND_CHANNEL,
                thread_ts: threadTs,
                text: slackText,
                mrkdwn: true,
              }),
              signal: AbortSignal.timeout(10000),
            }).catch(() => {});
          } else {
            // Create new thread with VIP header
            const headerText = `\u{1F465} *${vip.name}* \u2014 Deal Thread\n_All emails from ${domain || senderEmail} will be grouped here._`;
            try {
              const headerRes = await fetch("https://slack.com/api/chat.postMessage", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${botToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  channel: ABRA_COMMAND_CHANNEL,
                  text: headerText,
                  mrkdwn: true,
                }),
                signal: AbortSignal.timeout(10000),
              });
              if (headerRes.ok) {
                const headerData = await headerRes.json();
                const newThreadTs = headerData.ts;
                if (newThreadTs) {
                  // Store thread_ts in KV for future replies
                  vipThreads[threadLookupKey] = newThreadTs;
                  await writeState("abra-vip-slack-threads", vipThreads).catch(() => {});

                  // Post the actual triage as thread reply
                  await fetch("https://slack.com/api/chat.postMessage", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${botToken}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      channel: ABRA_COMMAND_CHANNEL,
                      thread_ts: newThreadTs,
                      text: slackText,
                      mrkdwn: true,
                    }),
                    signal: AbortSignal.timeout(10000),
                  }).catch(() => {});
                }
              }
            } catch { /* best-effort */ }
          }
        } else {
          // Non-VIP: standard flat message
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

      // Auto-handle routine emails (shipping receipts, newsletters, etc.)
      if (triage.category === "routine" || triage.category === "spam") {
        if (sbUrl && serviceKey) {
          await fetch(
            `${sbUrl}/rest/v1/abra_email_triage?email_id=eq.${encodeURIComponent(emailId || "")}`,
            {
              method: "PATCH",
              headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json",
                Prefer: "return=minimal",
              },
              body: JSON.stringify({ auto_handled: true }),
              signal: AbortSignal.timeout(5000),
            },
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[abra-triage] Error:", err);
    }
  });

  return NextResponse.json({ ok: true, message: "Triage started" });
}
