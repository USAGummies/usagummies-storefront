/**
 * POST /api/ops/fulfillment/gmail-draft
 *
 * Generic "draft an email for a human to review + send" primitive.
 * Lives under /api/ops/fulfillment to inherit the existing middleware
 * whitelist. Uses createGmailDraft() from gmail-reader.ts.
 *
 * Per hard-rules §11: Class B actions (customer-facing email) require
 * human approval. This route lets an agent (or Ben) prepare the full
 * email body + attachments + threading, drops it in Gmail Drafts, and
 * Ben clicks Send when he's ready. No auto-send path here — that's
 * what /api/ops/fulfillment/ap-packet/send is for.
 *
 * Body:
 *   {
 *     to: "support@stamps.com, support@shipstation.com",
 *     subject: "Re: ...",
 *     body: "plain text body",
 *     cc?, bcc?, threadId?, inReplyTo?, references?,
 *     attachments?: [{ filename, mimeType, contentBase64 }]
 *   }
 *
 * Auth: session OR CRON_SECRET bearer.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { createGmailDraft } from "@/lib/ops/gmail-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DraftBody {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    contentBase64: string;
  }>;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: DraftBody;
  try {
    body = (await req.json()) as DraftBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.to || !body.subject || !body.body) {
    return NextResponse.json(
      { error: "to, subject, body required" },
      { status: 400 },
    );
  }

  const attachments = (body.attachments ?? []).map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType,
    content: Buffer.from(a.contentBase64, "base64"),
  }));

  const res = await createGmailDraft({
    to: body.to,
    subject: body.subject,
    body: body.body,
    cc: body.cc,
    bcc: body.bcc,
    threadId: body.threadId,
    inReplyTo: body.inReplyTo,
    references: body.references,
    attachments,
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    draftId: res.draftId,
    messageId: res.messageId,
    threadId: res.threadId,
    openUrl: res.openUrl,
    instruction:
      "Open Gmail → Drafts → click the draft → review → click Send. That's the only remaining step.",
  });
}
