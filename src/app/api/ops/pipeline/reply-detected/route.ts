/**
 * POST /api/ops/pipeline/reply-detected — SENTINEL → PIPELINE write-back
 *
 * Called by Viktor when SENTINEL detects a reply in Gmail.
 * Matches the sender email to a prospect, logs the reply as a touch,
 * auto-transitions status (Contacted→Replied), and recomputes follow-up.
 *
 * Body: { from_email, from_name?, subject, snippet?, date, gmail_message_id? }
 * Returns: { matched, prospect?, touch?, action_taken? }
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { handleReplyDetected } from "@/lib/ops/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();

    if (!body.from_email || !body.subject || !body.date) {
      return NextResponse.json(
        { error: "Required fields: from_email, subject, date" },
        { status: 400 },
      );
    }

    const result = await handleReplyDetected(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process reply" },
      { status: 500 },
    );
  }
}
