/**
 * POST /api/ops/sales-tour/booth
 *
 * The Sales-Tour booth-visit entry point. Ben sends a Slack DM or channel
 * post (e.g. `/booth 3 pallets to Bryce Glamp UT, anchor, contact Sarah
 * 555-1212`); this route parses, composes, replies, and audits.
 *
 * Doctrine: `/contracts/sales-tour-field-workflow.md` v0.1.
 *
 * Flow:
 *   1. Auth (session OR Bearer CRON_SECRET).
 *   2. Parse `{ message: string, slackChannel?: string, slackThreadTs?: string }`.
 *   3. `parseBoothMessage` → `BoothVisitIntent` (regex + LLM fallback).
 *   4. `composeBoothQuote` → `BoothQuote`.
 *   5. `formatBoothQuoteReply` → Slack-ready text.
 *   6. KV persist under `sales-tour:booth-visits:{tourId}:{visitId}`.
 *   7. Optional: `chat.postMessage` to the configured channel.
 *   8. Audit envelope to `#ops-audit`.
 *   9. Return the structured quote payload as JSON for the caller.
 *
 * When `dryRun: true`, steps 1–5 + 9 run; KV + Slack + audit are skipped.
 *
 * Auth: session OR bearer CRON_SECRET (`isAuthorized`).
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { postMessage } from "@/lib/ops/control-plane/slack/client";

import { composeBoothQuote, DEFAULT_TOUR_ID } from "@/lib/sales-tour/compose-booth-quote";
import { formatBoothQuoteReply } from "@/lib/sales-tour/format-booth-reply";
import { parseBoothMessage } from "@/lib/sales-tour/parse-booth-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_BOOTH_PREFIX = "sales-tour:booth-visits";
const KV_TTL_SECONDS = 60 * 24 * 3600; // 60-day retention covers the trip + post-trip drain

interface BoothRequestBody {
  message?: string;
  slackChannel?: string; // default: #wholesale (or "#ops-audit" in dry mode)
  slackThreadTs?: string; // when posting in-thread
  tourId?: string;
  dryRun?: boolean;
  /** Internal escape hatch — disables LLM fallback. Used in tests. */
  noLlm?: boolean;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: BoothRequestBody = {};
  try {
    body = (await req.json()) as BoothRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json(
      {
        error: "Missing `message` in request body",
        hint: "Try: { \"message\": \"/booth 36 to Bryce Glamp UT, landed, contact Sarah 555-1212\" }",
      },
      { status: 400 },
    );
  }
  const tourId = body.tourId ?? DEFAULT_TOUR_ID;
  const dryRun = body.dryRun === true;

  // Step 3 — parse intent.
  const intent = await parseBoothMessage(message, { useLlm: !body.noLlm });
  if (!intent) {
    return NextResponse.json(
      {
        error: "Could not parse booth message",
        hint: "Format: `/booth <count> <unit> to <prospect> <state>, <freight>, contact <name> <phone-or-email>`",
        example: "/booth 36 to Bryce Glamp UT, landed, contact Sarah 555-1212",
      },
      { status: 422 },
    );
  }

  // Step 4 — compose quote.
  const now = new Date();
  const quote = composeBoothQuote(intent, { tourId, now });

  // Step 5 — format Slack reply.
  const slackText = formatBoothQuoteReply(quote);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      intent,
      quote,
      slackText,
    });
  }

  const run = newRunContext({
    division: "sales",
    agentId: "sales-tour-booth-quote",
    source: "human-invoked",
    trigger: "POST /api/ops/sales-tour/booth",
  });

  // Step 6 — persist to KV (idempotent on visitId).
  const kvKey = `${KV_BOOTH_PREFIX}:${quote.tourId}:${quote.visitId}`;
  try {
    await kv.set(
      kvKey,
      JSON.stringify({
        ...quote,
        createdAt: now.toISOString(),
      }),
      { ex: KV_TTL_SECONDS },
    );
  } catch (err) {
    // KV failure is non-fatal — the quote is still posted to Slack which
    // is the audit truth per `slack-operating.md`. Capture in audit so
    // operators can replay later.
    const errMsg = err instanceof Error ? err.message : String(err);
    const audit = buildAuditEntry(run, {
      action: "sales-tour.booth-quote.kv-degraded",
      entityType: "booth-visit",
      entityId: quote.visitId,
      result: "error",
      error: { message: errMsg },
      after: { kvKey },
      sourceCitations: [],
      confidence: 0.5,
    });
    await auditStore().append(audit);
    await auditSurface().mirror(audit).catch(() => void 0);
  }

  // Step 7 — post Slack reply (optional channel + thread).
  let slackResult: { ok: boolean; ts?: string; error?: string } = { ok: false, error: "no channel" };
  const slackChannel = body.slackChannel ?? "#wholesale";
  try {
    const res = await postMessage({
      channel: slackChannel,
      text: slackText,
      threadTs: body.slackThreadTs,
    });
    slackResult = { ok: res.ok, ts: res.ts ?? undefined, error: res.error };
  } catch (err) {
    slackResult = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Step 8 — audit envelope.
  const auditEntry = buildAuditEntry(run, {
    action: "sales-tour.booth-quote.composed",
    entityType: "booth-visit",
    entityId: quote.visitId,
    result: "ok",
    after: {
      tourId: quote.tourId,
      visitId: quote.visitId,
      pricingClass: quote.lines[0].pricingClass,
      approval: quote.approval,
      dealCheckRequired: quote.dealCheckRequired,
      slackTs: slackResult.ts,
      slackError: slackResult.error,
      kvKey,
    },
    sourceCitations: [
      { system: "regional-table-v0.1", id: `${quote.freight.state ?? "?"}-${quote.intent.scale}-${quote.intent.count}` },
    ],
    confidence: quote.intent.confidence,
  });
  await auditStore().append(auditEntry);
  await auditSurface().mirror(auditEntry).catch(() => void 0);

  // Step 9 — return.
  return NextResponse.json({
    ok: true,
    intent,
    quote,
    slackText,
    slack: slackResult,
    kvKey,
  });
}

/** GET handler for readiness probes — returns 200 with the contract version. */
export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    surface: "sales-tour.booth",
    version: "0.1",
    doctrine: "/contracts/sales-tour-field-workflow.md",
  });
}
