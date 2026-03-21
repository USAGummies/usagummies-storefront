import { NextResponse } from "next/server";
import { after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { recordFeedback } from "@/lib/ops/abra-source-provenance";
import { executeAction } from "@/lib/ops/abra-actions";
import { emitEvent } from "@/lib/ops/abra-event-bus";
import { postSlackMessage } from "@/lib/ops/abra-slack-responder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}) {
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }
  return json;
}

function verifySlackSignature(
  body: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  if (!SIGNING_SECRET || !timestamp || !signature) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parseInt(timestamp, 10)) > 300) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = createHmac("sha256", SIGNING_SECRET)
    .update(baseString)
    .digest("hex");
  const expected = `v0=${hmac}`;

  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch {
    return false;
  }
}

async function replaceSlackMessage(responseUrl: string, text: string): Promise<void> {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      replace_original: true,
      text,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text },
        },
      ],
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

async function processApprovalAction(
  approvalId: string,
  decision: "approved" | "denied",
  actor: string,
): Promise<{ ok: boolean; resultMsg?: string }> {
  const existing = (await sbFetch(
    `/rest/v1/approvals?id=eq.${approvalId}&select=id,status,proposed_payload&limit=1`,
  )) as Array<Record<string, unknown>>;
  if (!existing[0]) return { ok: false, resultMsg: "Approval not found" };

  // Prevent double-processing
  if (existing[0].status !== "pending") {
    return { ok: false, resultMsg: `Already ${existing[0].status}` };
  }

  if (decision === "denied") {
    await sbFetch(`/rest/v1/approvals?id=eq.${approvalId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "denied",
        decision: "denied",
        decided_at: new Date().toISOString(),
        decided_by_user_id: actor,
        decision_reasoning: `Rejected by ${actor} via Slack`,
      }),
    });
    return { ok: true };
  }

  // Approved — execute the action
  try {
    const result = await executeAction(approvalId);
    return { ok: result.success, resultMsg: result.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Execution failed";
    return { ok: false, resultMsg: msg };
  }
}

function parseEmailFields(values: Record<string, Record<string, { value?: string }>> | undefined): {
  to: string;
  subject: string;
  body: string;
} {
  const getValue = (blockId: string, actionId: string) =>
    String(values?.[blockId]?.[actionId]?.value || "").trim();
  return {
    to: getValue("email_to", "email_to"),
    subject: getValue("email_subject", "email_subject"),
    body: getValue("email_body", "email_body"),
  };
}

async function openSlackModal(triggerId: string, view: Record<string, unknown>): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN || "";
  if (!botToken) throw new Error("SLACK_BOT_TOKEN not configured");

  const res = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ trigger_id: triggerId, view }),
    signal: AbortSignal.timeout(10000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Slack modal open failed (${res.status})`);
  }
}

export async function POST(req: Request) {
  // Rate limit — generous tier (Slack retries aggressively)
  const { checkRateLimit } = await import("@/lib/ops/rate-limit");
  const rl = await checkRateLimit(req, "generous");
  if (rl.limited) return rl.response!;

  const bodyText = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");

  if (SIGNING_SECRET) {
    if (!verifySlackSignature(bodyText, timestamp, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const form = new URLSearchParams(bodyText);
  const payloadRaw = form.get("payload");
  if (!payloadRaw) {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  let payload: {
    type?: string;
    actions?: Array<{ action_id?: string; value?: string }>;
    user?: { id?: string; username?: string; name?: string };
    response_url?: string;
    trigger_id?: string;
    channel?: { id?: string };
    message?: { ts?: string; thread_ts?: string };
    view?: {
      callback_id?: string;
      private_metadata?: string;
      state?: {
        values?: Record<string, Record<string, { value?: string }>>;
      };
    };
  } = {};
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return NextResponse.json({ error: "Invalid payload JSON" }, { status: 400 });
  }

  if (payload.type === "view_submission" && payload.view?.callback_id === "edit_email_send_modal") {
    const approvalId = String(payload.view.private_metadata || "").trim();
    if (approvalId) {
      const fields = parseEmailFields(payload.view.state?.values);
      const existing = (await sbFetch(
        `/rest/v1/approvals?id=eq.${approvalId}&select=id,proposed_payload&limit=1`,
      )) as Array<Record<string, unknown>>;
      const proposedPayload = existing[0]?.proposed_payload;
      if (proposedPayload && typeof proposedPayload === "object") {
        const current = proposedPayload as Record<string, unknown>;
        const currentParams = current.params && typeof current.params === "object"
          ? { ...(current.params as Record<string, unknown>) }
          : {};
        await sbFetch(`/rest/v1/approvals?id=eq.${approvalId}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
          body: JSON.stringify({
            proposed_payload: {
              ...current,
              params: {
                ...currentParams,
                to: fields.to,
                subject: fields.subject,
                body: fields.body,
              },
            },
          }),
        });
      }
    }
    return NextResponse.json({ response_action: "clear" });
  }

  if (payload.type !== "block_actions" || !Array.isArray(payload.actions)) {
    return NextResponse.json({ ok: true });
  }

  const action = payload.actions[0] || {};
  const actionId = action.action_id || "";
  const value = action.value || "";
  const actor = payload.user?.username || payload.user?.name || payload.user?.id || "slack-user";
  const channelId = payload.channel?.id || "";
  const threadTs = payload.message?.thread_ts || payload.message?.ts || "";

  if (!actionId || !value) {
    return NextResponse.json({ ok: true });
  }

  if (actionId === "feedback_positive" || actionId === "feedback_negative") {
    after(async () => {
      await recordFeedback(
        value,
        actionId === "feedback_positive" ? "positive" : "negative",
      );
    });
    return NextResponse.json({
      response_type: "ephemeral",
      text: actionId === "feedback_positive" ? "✅ Feedback saved." : "📝 Feedback saved.",
    });
  }

  if (actionId === "approve_action" || actionId === "reject_action") {
    const decision = actionId === "approve_action" ? "approved" : "denied";
    const responseUrl = payload.response_url || "";
    after(async () => {
      const result = await processApprovalAction(value, decision, actor).catch((err) => ({
        ok: false,
        resultMsg: err instanceof Error ? err.message : "Unknown error",
      }));
      if (!responseUrl) return;
      let text: string;
      if (result.ok) {
        text = decision === "approved"
          ? `✅ Approved & executed by ${actor}${result.resultMsg ? `\n${result.resultMsg}` : ""}`
          : `❌ Rejected by ${actor}`;
      } else {
        text = `⚠️ ${result.resultMsg || `Failed to process decision (${value})`}`;
      }
      await replaceSlackMessage(responseUrl, text);
      if (channelId && threadTs) {
        await postSlackMessage(channelId, text, { threadTs }).catch(() => {});
      }
    });
    return NextResponse.json({
      response_type: "ephemeral",
      text: decision === "approved" ? "⏳ Approving & executing..." : "⏳ Rejecting...",
    });
  }

  // ─── Batch categorization buttons ───
  if (actionId === "approve_batch_categorize" || actionId === "reject_batch_categorize" || actionId === "review_batch_categorize") {
    const responseUrl = payload.response_url || "";
    if (actionId === "review_batch_categorize") {
      after(async () => {
        await replaceSlackMessage(responseUrl,
          "📋 *Review mode* — open QBO Bank Transactions to review individually: https://app.qbo.intuit.com/app/banktransactions\n_Auto-categorized items are already applied. Only flagged items remain._"
        );
      });
      return NextResponse.json({ response_type: "ephemeral", text: "📋 Opening review details..." });
    }
    if (actionId === "reject_batch_categorize") {
      after(async () => {
        await replaceSlackMessage(responseUrl, `❌ Batch rejected by ${actor}. Transactions remain uncategorized in QBO.`);
      });
      return NextResponse.json({ response_type: "ephemeral", text: "❌ Batch rejected." });
    }
    // approve_batch_categorize — already auto-applied, just acknowledge
    after(async () => {
      await replaceSlackMessage(responseUrl,
        `✅ Batch approved by ${actor}. All auto-categorized transactions confirmed.`
      );
    });
    return NextResponse.json({ response_type: "ephemeral", text: "✅ Batch approved!" });
  }

  if (actionId === "edit_email_action") {
    const approvalId = value;
    const triggerId = payload.trigger_id || "";
    if (!triggerId) {
      return NextResponse.json({ response_type: "ephemeral", text: "⚠️ Slack trigger not available." });
    }

    after(async () => {
      const existing = (await sbFetch(
        `/rest/v1/approvals?id=eq.${approvalId}&select=id,proposed_payload&limit=1`,
      )) as Array<Record<string, unknown>>;
      const proposedPayload = existing[0]?.proposed_payload;
      const params = proposedPayload && typeof proposedPayload === "object"
        ? (((proposedPayload as Record<string, unknown>).params || {}) as Record<string, unknown>)
        : {};

      await openSlackModal(triggerId, {
        type: "modal",
        callback_id: "edit_email_send_modal",
        private_metadata: approvalId,
        title: { type: "plain_text", text: "Edit email" },
        submit: { type: "plain_text", text: "Save" },
        close: { type: "plain_text", text: "Cancel" },
        blocks: [
          {
            type: "input",
            block_id: "email_to",
            label: { type: "plain_text", text: "To" },
            element: {
              type: "plain_text_input",
              action_id: "email_to",
              initial_value: String(params.to || ""),
            },
          },
          {
            type: "input",
            block_id: "email_subject",
            label: { type: "plain_text", text: "Subject" },
            element: {
              type: "plain_text_input",
              action_id: "email_subject",
              initial_value: String(params.subject || ""),
            },
          },
          {
            type: "input",
            block_id: "email_body",
            label: { type: "plain_text", text: "Body" },
            element: {
              type: "plain_text_input",
              action_id: "email_body",
              multiline: true,
              initial_value: String(params.body || params.html || params.message || ""),
            },
          },
        ],
      }).catch(() => {});
    });

    return NextResponse.json({
      response_type: "ephemeral",
      text: "✏️ Opening email editor...",
    });
  }

  // ── Email draft commands: send or discard via buttons ──
  if (actionId === "sendreply_action" || actionId === "deny_draft_action") {
    const commandId = value;
    const responseUrl = payload.response_url || "";

    after(async () => {
      try {
        if (actionId === "deny_draft_action") {
          // Deny: just update status
          await sbFetch(`/rest/v1/abra_email_commands?id=eq.${commandId}&status=eq.draft_reply_pending`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
            body: JSON.stringify({ status: "denied" }),
          });
          if (responseUrl) {
            await replaceSlackMessage(responseUrl, `❌ Draft discarded by ${actor}`);
          }
          return;
        }

        // Send: fetch the draft, then send it
        const commands = (await sbFetch(
          `/rest/v1/abra_email_commands?id=eq.${commandId}&status=eq.draft_reply_pending&select=*&limit=1`,
        )) as Array<Record<string, unknown>>;

        if (!commands[0]) {
          if (responseUrl) {
            await replaceSlackMessage(responseUrl, `⚠️ Draft ${commandId} not found or already processed`);
          }
          return;
        }

        const cmd = commands[0];

        // Atomically claim it
        const sbEnv = getSupabaseEnv();
        if (!sbEnv) {
          if (responseUrl) await replaceSlackMessage(responseUrl, "⚠️ Supabase not configured — cannot process draft");
          return;
        }
        const claimRes = await fetch(
          `${sbEnv.baseUrl}/rest/v1/abra_email_commands?id=eq.${commandId}&status=eq.draft_reply_pending`,
          {
            method: "PATCH",
            headers: {
              apikey: sbEnv.serviceKey,
              Authorization: `Bearer ${sbEnv.serviceKey}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            },
            body: JSON.stringify({ status: "sending" }),
            signal: AbortSignal.timeout(10000),
          },
        );
        const claimed = claimRes.ok ? ((await claimRes.json()) as unknown[]) : [];
        if (!Array.isArray(claimed) || claimed.length === 0) {
          if (responseUrl) {
            await replaceSlackMessage(responseUrl, `⚠️ Draft ${commandId} was already claimed — possible double-click`);
          }
          return;
        }

        // Send via internal API
        const host = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
        const cronSecret = process.env.CRON_SECRET?.trim();

        const sendRes = await fetch(`${host}/api/ops/abra/send-reply`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cronSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            commandId,
            to: cmd.sender_email,
            subject: cmd.draft_reply_subject || `Re: ${cmd.subject}`,
            body: cmd.draft_reply_body,
            threadId: cmd.gmail_thread_id || undefined,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (sendRes.ok) {
          await sbFetch(`/rest/v1/abra_email_commands?id=eq.${commandId}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
            body: JSON.stringify({ status: "completed" }),
          });
          if (responseUrl) {
            await replaceSlackMessage(
              responseUrl,
              `✅ Reply sent to ${cmd.sender_email} by ${actor}\n*Subject:* ${cmd.draft_reply_subject || cmd.subject}`,
            );
          }
          // Emit event for CRM tracking + cross-department cascades
          void emitEvent({
            type: "draft_reply_sent",
            department: "executive",
            timestamp: new Date().toISOString(),
            data: {
              command_id: commandId,
              sender_email: cmd.sender_email,
              subject: cmd.draft_reply_subject || cmd.subject,
              sent_by: actor,
            },
          });
        } else {
          // Revert to pending so they can retry
          await sbFetch(`/rest/v1/abra_email_commands?id=eq.${commandId}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal", "Content-Type": "application/json" },
            body: JSON.stringify({ status: "draft_reply_pending" }),
          });
          const errText = await sendRes.text().catch(() => "unknown error");
          if (responseUrl) {
            await replaceSlackMessage(
              responseUrl,
              `❌ Failed to send: ${errText.slice(0, 200)}\nDraft returned to pending — try again.`,
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (responseUrl) {
          await replaceSlackMessage(responseUrl, `❌ Error: ${msg.slice(0, 200)}`);
        }
      }
    });

    return NextResponse.json({
      response_type: "ephemeral",
      text: actionId === "sendreply_action" ? "📤 Sending reply..." : "🗑️ Discarding draft...",
    });
  }

  return NextResponse.json({ ok: true });
}
