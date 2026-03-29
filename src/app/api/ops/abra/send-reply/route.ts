/**
 * POST /api/ops/abra/send-reply — Send an email reply for an approved Abra command
 *
 * Body: { to: string, subject: string, body: string }
 * Auth: CRON_SECRET bearer token
 */

import { NextResponse } from "next/server";
import { sendOpsEmail } from "@/lib/ops/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Basic email safety check — this endpoint is already auth-gated by CRON_SECRET
 * and all sends go through human approval (/abra sendreply <id>), so we only
 * block obviously invalid recipients rather than maintaining a domain allowlist.
 * This was previously a strict allowlist that blocked replies to external contacts (P0 bug).
 */
const BLOCKED_RECIPIENT_RE = /^(noreply|no-reply|donotreply|mailer-daemon|postmaster)@/i;

function isAllowedRecipient(email: string): boolean {
  const normalized = email.toLowerCase().trim();
  if (!normalized || !normalized.includes("@")) return false;
  if (BLOCKED_RECIPIENT_RE.test(normalized)) return false;
  return true;
}

export async function POST(req: Request) {
  // Auth: check CRON_SECRET
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { to, subject, body } = (await req.json()) as {
    to?: string;
    subject?: string;
    body?: string;
  };

  if (!to || !body) {
    return NextResponse.json({ error: "Missing to or body" }, { status: 400 });
  }

  // Validate recipient against allowlist
  if (!isAllowedRecipient(to)) {
    return NextResponse.json(
      { error: `Recipient "${to}" is not in the allowed list` },
      { status: 403 },
    );
  }

  // Ensure signature
  let emailBody = body;
  if (!emailBody.includes("Best,\nBen") && !emailBody.includes("Best,\r\nBen")) {
    emailBody = `${emailBody.trimEnd()}\n\nBest,\nBen`;
  }

  try {
    const result = await sendOpsEmail({
      to,
      subject: subject || "Re: (no subject)",
      body: emailBody,
      from: "Ben Stutman <ben@usagummies.com>",
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.message, blocked: result.blocked },
        { status: result.blocked ? 429 : 500 },
      );
    }
    return NextResponse.json({ ok: true, message: result.message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
