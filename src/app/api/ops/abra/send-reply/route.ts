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

  // Ensure Abra signature
  let emailBody = body;
  if (!emailBody.includes("Abra — via Benjamin") && !emailBody.includes("Best,\nBen")) {
    emailBody = `${emailBody.trimEnd()}\n\n—\nAbra — via Benjamin\nUSA Gummies`;
  }

  try {
    await sendOpsEmail({
      to,
      subject: subject || "Re: (no subject)",
      body: emailBody,
      from: "Ben Stutman <ben@usagummies.com>",
    });
    return NextResponse.json({ ok: true, message: `Email sent to ${to}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
