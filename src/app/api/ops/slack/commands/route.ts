/**
 * POST /api/ops/slack/commands
 *
 * Slack slash-command receiver. This is the reliable fallback when Events API
 * delivery is not available for connector/app-origin messages. It creates the
 * same safe workpacks as the Events route; it never executes a workpack.
 *
 * Configure in Slack App Admin as an app slash command, e.g. `/ops`, with:
 *   https://www.usagummies.com/api/ops/slack/commands
 */
import { NextResponse } from "next/server";

import { verifySlackSignature } from "@/lib/ops/control-plane/slack";
import { createWorkpack } from "@/lib/ops/workpacks";
import { appendSlackEventReceipt } from "@/lib/ops/slack-event-ledger";
import {
  parseSlackWorkpackCommand,
  renderWorkpackCreatedSlackCard,
} from "@/lib/ops/slack-workpack-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200): Response {
  return NextResponse.json(body, { status });
}

function helpResponse(): Response {
  return json({
    response_type: "ephemeral",
    text:
      "USA Gummies ops commands: `ask codex <task>`, `ask claude <task>`, `draft reply <context>`, `summarize <context>`, `turn into task <context>`.",
  });
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const sigCheck = await verifySlackSignature({ rawBody, timestamp, signature });
  const signatureConfigured =
    sigCheck.ok || sigCheck.reason !== "SLACK_SIGNING_SECRET not configured";
  if (signatureConfigured && !sigCheck.ok) {
    return json({ ok: false, error: `Slack signature: ${sigCheck.reason}` }, 401);
  }

  const form = new URLSearchParams(rawBody);
  const text = (form.get("text") ?? "").trim();
  const command = (form.get("command") ?? "").trim();
  const channel = (form.get("channel_id") ?? "").trim();
  const user = (form.get("user_id") ?? "").trim();

  await appendSlackEventReceipt({
    eventType: "slash_command",
    channel,
    messageTs: form.get("trigger_id") ?? undefined,
    recognizedCommand: text ? "slash-command" : null,
    skippedReason: text ? null : "empty-slash-command",
    text: `${command} ${text}`.trim(),
  }).catch(() => undefined);

  if (!text) return helpResponse();

  const parsed = parseSlackWorkpackCommand({
    text,
    channel,
    user,
  });
  if (!parsed) return helpResponse();

  try {
    const workpack = await createWorkpack(parsed.workpack);
    const card = renderWorkpackCreatedSlackCard(workpack);
    return json({
      response_type: "ephemeral",
      text: card.text,
      blocks: card.blocks,
      workpackId: workpack.id,
    });
  } catch (err) {
    return json(
      {
        response_type: "ephemeral",
        text:
          "Could not create workpack: " +
          (err instanceof Error ? err.message : String(err)),
      },
      200,
    );
  }
}
