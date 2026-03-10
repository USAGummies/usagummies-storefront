import { NextResponse } from "next/server";
import { after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { recordFeedback } from "@/lib/ops/abra-source-provenance";

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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
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
): Promise<boolean> {
  const existing = (await sbFetch(
    `/rest/v1/approvals?id=eq.${approvalId}&select=id,action_payload,proposed_payload&limit=1`,
  )) as Array<Record<string, unknown>>;
  if (!existing[0]) return false;

  const updatePayload: Record<string, unknown> = {
    status: decision,
    decision,
    decided_at: new Date().toISOString(),
    decision_reasoning: `Slack interaction by ${actor}`,
  };
  const actionPayload = existing[0].action_payload || existing[0].proposed_payload;
  if (decision === "approved" && actionPayload) {
    updatePayload.resolved_payload = actionPayload;
  }

  await sbFetch(`/rest/v1/approvals?id=eq.${approvalId}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updatePayload),
  });
  return true;
}

export async function POST(req: Request) {
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
  } = {};
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return NextResponse.json({ error: "Invalid payload JSON" }, { status: 400 });
  }

  if (payload.type !== "block_actions" || !Array.isArray(payload.actions)) {
    return NextResponse.json({ ok: true });
  }

  const action = payload.actions[0] || {};
  const actionId = action.action_id || "";
  const value = action.value || "";
  const actor = payload.user?.username || payload.user?.name || payload.user?.id || "slack-user";

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
      const ok = await processApprovalAction(value, decision, actor).catch(() => false);
      if (!responseUrl) return;
      const text = ok
        ? decision === "approved"
          ? `✅ Approved by ${actor}`
          : `❌ Rejected by ${actor}`
        : `⚠️ Failed to process decision (${value})`;
      await replaceSlackMessage(responseUrl, text);
    });
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Processing decision...",
    });
  }

  return NextResponse.json({ ok: true });
}
