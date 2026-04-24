/**
 * POST /api/ops/fulfillment/ap-packet/record-sent
 *
 * Retroactive bookkeeping for packets that went out outside our send
 * pipeline (e.g. Ben hit send manually from iOS Mail / phone, which
 * doesn't always push the message back to Gmail's server-side Sent
 * label, so our Gmail-API dedup is blind to it).
 *
 * Writes the canonical `ap-packets:sent:<slug>` KV entry + audits to
 * #ops-audit. The next verify call will now correctly return
 * `eligibleToSend: false` and our /send route will 409 any accidental
 * re-send attempt.
 *
 * Body:
 *   {
 *     slug: "jungle-jims",
 *     sentAt?: "2026-04-24T16:51:00Z",  // default = now
 *     messageId?: "manual-ios-mail",    // when we don't have a real Gmail id
 *     threadId?: "19dabbfc102a7861",    // thread id if known (from inbound)
 *     sentBy?: "Ben (manual, iOS Mail)",
 *     note?: "Optional free-form context for the audit entry."
 *   }
 *
 * Auth: session OR bearer CRON_SECRET (under /api/ops/fulfillment/).
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getApPacket } from "@/lib/ops/ap-packets";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import { auditStore } from "@/lib/ops/control-plane/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_SENT_PREFIX = "ap-packets:sent:";

interface SentEntry {
  slug: string;
  messageId: string;
  threadId: string | null;
  sentAt: string;
  sentBy: string;
  apEmail: string;
  subject: string;
  approvalId?: string;
  source?: "pipeline" | "manual";
  note?: string;
}

interface RecordSentBody {
  slug: string;
  sentAt?: string;
  messageId?: string;
  threadId?: string;
  sentBy?: string;
  note?: string;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: RecordSentBody;
  try {
    body = (await req.json()) as RecordSentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const slug = body.slug?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }
  const packet = getApPacket(slug);
  if (!packet) {
    return NextResponse.json({ error: `Packet ${slug} not found` }, { status: 404 });
  }

  const sentAt = body.sentAt ?? new Date().toISOString();
  const messageId = body.messageId ?? `manual:${slug}:${Date.now()}`;
  const threadId = body.threadId ?? null;
  const sentBy = body.sentBy ?? "manual";

  const entry: SentEntry = {
    slug,
    messageId,
    threadId,
    sentAt,
    sentBy,
    apEmail: packet.apEmail,
    subject: packet.replyDraft.subject,
    source: "manual",
    note: body.note,
  };

  try {
    await kv.set(`${KV_SENT_PREFIX}${slug}`, entry);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `KV write failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  // Audit mirror
  try {
    const run = newRunContext({
      agentId: "ap-packet-sender",
      division: "financials",
      source: "human-invoked",
      trigger: `ap-packet:${slug}:record-sent`,
    });
    const audit = buildAuditEntry(run, {
      action: "ap-packet.sent.manual-record",
      entityType: "ap-packet.send",
      entityId: `ap-packet:${slug}`,
      after: entry,
      result: "ok",
      sourceCitations: [{ system: "ap-packets", id: slug }],
      confidence: 1,
    });
    await auditStore().append(audit);
    try {
      await auditSurface().mirror(audit);
    } catch {
      /* best-effort */
    }
  } catch (err) {
    console.error(
      "[record-sent] audit failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return NextResponse.json({ ok: true, slug, entry });
}
