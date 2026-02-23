/**
 * POST /api/ops/notify — Send notifications from agents or dashboard.
 *
 * Body: { channel: "alerts"|"pipeline"|"daily", text: string, sms?: boolean }
 * Protected by middleware (requires auth).
 */

import { NextRequest, NextResponse } from "next/server";
import { notify } from "@/lib/ops/notify";
import type { NotifyChannel } from "@/lib/ops/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_CHANNELS: NotifyChannel[] = ["alerts", "pipeline", "daily"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { channel, text, sms } = body as {
      channel: NotifyChannel;
      text: string;
      sms?: boolean;
    };

    if (!channel || !VALID_CHANNELS.includes(channel)) {
      return NextResponse.json(
        { error: `Invalid channel. Must be one of: ${VALID_CHANNELS.join(", ")}` },
        { status: 400 }
      );
    }

    if (!text?.trim()) {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }

    const result = await notify({ channel, text: text.trim(), sms });

    return NextResponse.json({
      ok: result.slack || result.sms || result.imessage || false,
      result,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
