/**
 * POST /api/ops/slack/upload-pdf
 *
 * Upload a PDF (or any binary) to a Slack channel/thread via the
 * 3-step files.uploadExternal flow. Wraps `uploadBufferToSlack` from
 * `src/lib/ops/slack-file-upload.ts`.
 *
 * Why this exists: the Slack MCP `slack_send_message` tool can post text
 * but cannot upload files. The bot-token-driven file-upload path lives
 * server-side; this endpoint exposes it so the MCP / Claude Code can
 * push label PDFs and pack sheets directly into channels.
 *
 * Primary consumer: sample-shipment workflow (post label + pack sheet
 * to #shipping at buy-time). Generic enough to be reused for any binary.
 *
 * Body:
 *   {
 *     channelId: string,                    // e.g. "C0AS4635HFG" (#shipping)
 *     threadTs?: string,                    // optional thread parent
 *     filename: string,                     // displayed name in Slack
 *     mimeType?: string,                    // default "application/pdf"
 *     pdfBase64: string,                    // file content as base64
 *     title?: string,
 *     comment?: string                      // initial_comment when posted
 *   }
 *
 * Auth: bearer CRON_SECRET (middleware whitelist).
 */
import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { uploadBufferToSlack } from "@/lib/ops/slack-file-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UploadRequest {
  channelId?: string;
  threadTs?: string;
  filename?: string;
  mimeType?: string;
  pdfBase64?: string;
  title?: string;
  comment?: string;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: UploadRequest;
  try {
    body = (await req.json()) as UploadRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.channelId) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }
  if (!body.filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }
  if (!body.pdfBase64) {
    return NextResponse.json({ error: "pdfBase64 required" }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(body.pdfBase64, "base64");
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid base64",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
  if (buffer.byteLength === 0) {
    return NextResponse.json(
      { error: "Decoded buffer is empty" },
      { status: 400 },
    );
  }

  const result = await uploadBufferToSlack({
    channelId: body.channelId,
    threadTs: body.threadTs,
    filename: body.filename,
    mimeType: body.mimeType || "application/pdf",
    buffer,
    title: body.title,
    comment: body.comment,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        sizeBytes: buffer.byteLength,
        filename: body.filename,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    skipped: result.skipped ?? false,
    permalink: result.permalink,
    filename: body.filename,
    sizeBytes: buffer.byteLength,
  });
}
