/**
 * POST /api/ops/notify — Send notifications from agents or dashboard.
 *
 * Body: { channel: "alerts"|"pipeline"|"daily", text: string, sms?: boolean }
 * Protected by middleware (requires auth).
 */

import { NextRequest, NextResponse } from "next/server";
import { notify } from "@/lib/ops/notify";
import { validateRequest, NotifyRequestSchema } from "@/lib/ops/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const v = await validateRequest(req, NotifyRequestSchema);
    if (!v.success) return v.response;
    const { channel, text, sms } = v.data;

    const result = await notify({ channel, text, sms });

    return NextResponse.json({
      ok: result.slack || result.sms || result.imessage || false,
      result,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
