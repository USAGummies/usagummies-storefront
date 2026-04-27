/**
 * POST /api/ops/shipping/mark-dispatched
 *
 * Alternate path to the Slack `:white_check_mark:` reaction handler —
 * lets the dispatch dashboard mark a shipment dispatched (or undo it)
 * via a button click, useful for batch dispatch when the operator has
 * 10 packages going out at once and doesn't want to react to each one
 * individually in Slack.
 *
 * Body:
 *   {
 *     orderNumber: string;
 *     source: string;            // "amazon" | "shopify" | "manual" | "faire"
 *     action?: "mark" | "clear"; // default "mark"
 *     dispatchedBy?: string;     // optional override — defaults to "ops-dashboard"
 *   }
 *
 * Returns:
 *   { ok: true, action: "mark"|"clear", orderNumber, source,
 *     dispatchedAt: string|null, firstMark?: boolean }
 *
 * Behavior parity with the Slack reaction handler:
 *   - First-time mark: posts a single thread reply under the original
 *     label post in `#shipping`, identical to the reaction-handler
 *     message ("`:package: Dispatched — physically left WA Warehouse
 *     by <id> at <time>`"), so both surfaces produce the same audit
 *     trail in the channel.
 *   - Re-mark: idempotent, no thread re-post.
 *   - Clear: nulls the stamp, no thread reply.
 *
 * Auth: bearer CRON_SECRET OR session.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  clearDispatched,
  getShippingArtifact,
  markDispatched,
} from "@/lib/ops/shipping-artifacts";
import { permalinkToMessageTs } from "@/lib/ops/slack-file-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MarkDispatchedBody {
  orderNumber?: string;
  source?: string;
  action?: "mark" | "clear";
  dispatchedBy?: string;
}

const ALLOWED_SOURCES = new Set(["amazon", "shopify", "manual", "faire"]);

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: MarkDispatchedBody;
  try {
    body = (await req.json()) as MarkDispatchedBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const orderNumber = body.orderNumber?.trim();
  const source = body.source?.trim().toLowerCase();
  const action = body.action ?? "mark";
  const dispatchedBy = body.dispatchedBy?.trim() || "ops-dashboard";

  if (!orderNumber) {
    return NextResponse.json(
      { ok: false, error: "orderNumber required" },
      { status: 400 },
    );
  }
  if (!source || !ALLOWED_SOURCES.has(source)) {
    return NextResponse.json(
      {
        ok: false,
        error: `source required; one of ${Array.from(ALLOWED_SOURCES).join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (action !== "mark" && action !== "clear") {
    return NextResponse.json(
      { ok: false, error: 'action must be "mark" or "clear"' },
      { status: 400 },
    );
  }

  if (action === "clear") {
    const result = await clearDispatched({ source, orderNumber });
    return NextResponse.json({
      ok: true,
      action: "clear",
      orderNumber,
      source,
      dispatchedAt: null,
      hadStamp: Boolean(result.before),
    });
  }

  // mark
  const result = await markDispatched({
    source,
    orderNumber,
    dispatchedBy,
  });

  // First-time mark posts a thread reply mirroring the Slack reaction
  // handler. Re-marks (where `before` is non-null) are silent so the
  // channel doesn't accumulate duplicate dispatch confirmations.
  if (result.ok && !result.before) {
    try {
      const artifact = await getShippingArtifact(source, orderNumber);
      const messageTs = artifact?.slackPermalink
        ? permalinkToMessageTs(artifact.slackPermalink)
        : undefined;
      const shipping = getChannel("shipping");
      if (messageTs && shipping) {
        await postMessage({
          channel: shipping.name,
          text:
            ":package: *Dispatched* — physically left WA Warehouse " +
            `by ${dispatchedBy} at ${formatStamp(result.after)}.`,
          threadTs: messageTs,
        });
      }
    } catch {
      /* best-effort — never block the dashboard click on Slack */
    }
  }

  return NextResponse.json({
    ok: true,
    action: "mark",
    orderNumber,
    source,
    dispatchedAt: result.after,
    firstMark: !result.before,
  });
}

function formatStamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}
