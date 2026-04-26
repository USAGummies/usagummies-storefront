import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildCatalogCsv, getApPacket, listApPackets } from "@/lib/ops/ap-packets";
import { listApPacketDrafts } from "@/lib/ops/ap-packets/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_SENT_PREFIX = "ap-packets:sent:";

interface SentEntry {
  slug: string;
  messageId: string;
  threadId: string | null;
  sentAt: string;
  sentBy: string;
  apEmail?: string;
  subject?: string;
  approvalId?: string;
}

async function readLastSent(slug: string): Promise<SentEntry | null> {
  try {
    return ((await kv.get<SentEntry>(`${KV_SENT_PREFIX}${slug}`)) ?? null) as
      | SentEntry
      | null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("account")?.trim();
  const format = searchParams.get("format")?.trim();

  if (!slug) {
    // Roster view — every packet plus a `lastSent` summary so the
    // dashboard can surface "sent / not yet sent / sent at <date>" in
    // a single fetch. KV miss is non-fatal — `lastSent` becomes null.
    const packets = listApPackets();
    const enriched = await Promise.all(
      packets.map(async (packet) => {
        const lastSent = await readLastSent(packet.slug);
        return {
          slug: packet.slug,
          accountName: packet.accountName,
          apEmail: packet.apEmail,
          owner: packet.owner,
          status: packet.status,
          dueWindow: packet.dueWindow,
          pricingNeedsReview: packet.pricingNeedsReview,
          attachmentSummary: summarizeAttachments(packet.attachments),
          nextActionsCount: packet.nextActions?.length ?? 0,
          firstNextAction: packet.nextActions?.[0] ?? null,
          lastSent: lastSent
            ? {
                sentAt: lastSent.sentAt,
                sentBy: lastSent.sentBy,
                messageId: lastSent.messageId,
                threadId: lastSent.threadId,
                approvalId: lastSent.approvalId ?? null,
              }
            : null,
        };
      }),
    );
    // Drafts live in their own KV store and are intentionally separate
    // from the live packets array so consumers (including the send
    // route) can't conflate them. Surface them under a sibling
    // `drafts` field with a clear lifecycle marker.
    let drafts: Awaited<ReturnType<typeof listApPacketDrafts>> = [];
    try {
      drafts = await listApPacketDrafts();
    } catch {
      drafts = [];
    }
    return NextResponse.json({
      ok: true,
      packets: enriched,
      drafts,
      counts: {
        live: enriched.length,
        drafts: drafts.length,
        draftsIncomplete: drafts.filter((d) => !d.requiredFieldsComplete).length,
      },
    });
  }

  const packet = getApPacket(slug);
  if (!packet) {
    return NextResponse.json({ error: "Packet not found" }, { status: 404 });
  }

  if (format === "csv") {
    return new Response(buildCatalogCsv(packet), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${packet.slug}-item-list.csv"`,
      },
    });
  }

  // Detail view — also enrich with lastSent so the per-packet card
  // can show send history without a second round-trip.
  const lastSent = await readLastSent(slug);
  return NextResponse.json({
    ok: true,
    packet,
    lastSent: lastSent
      ? {
          sentAt: lastSent.sentAt,
          sentBy: lastSent.sentBy,
          messageId: lastSent.messageId,
          threadId: lastSent.threadId,
          approvalId: lastSent.approvalId ?? null,
          subject: lastSent.subject ?? null,
        }
      : null,
  });
}

// ---------------------------------------------------------------------------

function summarizeAttachments(
  attachments: Array<{ status: "ready" | "optional" | "missing" | "review" }>,
): { ready: number; optional: number; missing: number; review: number; total: number } {
  const out = { ready: 0, optional: 0, missing: 0, review: 0, total: attachments.length };
  for (const a of attachments) {
    out[a.status] += 1;
  }
  return out;
}
