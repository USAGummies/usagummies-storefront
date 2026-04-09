/**
 * POST /api/ops/alerts/dedup — Check if an alert is a duplicate before sending
 *
 * Body: { content, channel, ttl_hours? }
 *   content: the alert text
 *   channel: Slack channel name or ID
 *   ttl_hours: dedup window (default 8h for inbox, 24h for daily brief)
 *
 * Returns: { duplicate: boolean, should_send: boolean, last_sent? }
 *
 * If should_send is true, the alert is also auto-recorded (no separate call needed).
 *
 * GET /api/ops/alerts/dedup?action=record — Record an alert as sent
 * Body: { content, channel }
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { isAlertDuplicate, recordAlertSent } from "@/lib/ops/qbo-guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.content || !body.channel) {
      return NextResponse.json(
        { error: "Required: content and channel" },
        { status: 400 },
      );
    }

    const ttlHours = body.ttl_hours || 8;
    const { duplicate, last_sent } = await isAlertDuplicate(body.content, body.channel, ttlHours);

    if (!duplicate) {
      // Auto-record if not a duplicate (Viktor doesn't need a second call)
      await recordAlertSent(body.content, body.channel);
    }

    return NextResponse.json({
      duplicate,
      should_send: !duplicate,
      last_sent: last_sent || null,
      ttl_hours: ttlHours,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dedup check failed" },
      { status: 500 },
    );
  }
}
