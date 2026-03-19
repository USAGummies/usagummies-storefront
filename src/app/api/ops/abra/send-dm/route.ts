/**
 * POST /api/ops/abra/send-dm — Send a DM from Abra to a Slack user
 *
 * Body: { email?: string, userId?: string, message: string }
 * Requires CRON_SECRET auth.
 */
import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  sendDirectMessage,
  findSlackUserByEmail,
} from "@/lib/ops/abra-slack-responder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    email?: string;
    userId?: string;
    message?: string;
  } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Resolve Slack user ID
  let userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (!userId && payload.email) {
    const found = await findSlackUserByEmail(payload.email);
    if (!found) {
      return NextResponse.json(
        { error: `Could not find Slack user with email: ${payload.email}` },
        { status: 404 },
      );
    }
    userId = found;
  }

  if (!userId) {
    return NextResponse.json(
      { error: "Either email or userId is required" },
      { status: 400 },
    );
  }

  const sent = await sendDirectMessage(userId, message);
  if (!sent) {
    return NextResponse.json(
      { error: "Failed to send DM — check SLACK_BOT_TOKEN and user permissions" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, userId });
}
