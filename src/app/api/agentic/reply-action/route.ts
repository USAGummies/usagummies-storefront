import { NextRequest, NextResponse } from "next/server";
import { readStateArray, writeState } from "@/lib/ops/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QueueItem = {
  queueId: string;
  queuedAtET: string;
  receivedAtET?: string;
  senderEmail: string;
  subject: string;
  category: string;
  prospectType: string;
  prospectName: string;
  recommendedAction: string;
  draftSubject: string;
  draftBody: string;
  authorizationRequired: boolean;
  status: string;
  authorizedAtET?: string;
  authorizedBy?: string;
  deniedAtET?: string;
  deniedBy?: string;
};

function etNow(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date()).replace(",", "");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { queueId, action, editedSubject, editedBody } = body as {
      queueId: string;
      action: "approve" | "deny" | "edit-and-send";
      editedSubject?: string;
      editedBody?: string;
    };

    if (!queueId || !["approve", "deny", "edit-and-send"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid request: queueId and action (approve|deny|edit-and-send) required" },
        { status: 400 }
      );
    }

    const items = await readStateArray<QueueItem>("reply-queue");
    const idx = items.findIndex((i) => i.queueId === queueId);
    if (idx === -1) {
      return NextResponse.json({ error: `Queue item ${queueId} not found` }, { status: 404 });
    }

    const item = items[idx];
    if (item.status !== "pending") {
      return NextResponse.json({ error: `Item already actioned: ${item.status}` }, { status: 409 });
    }

    const now = etNow();

    if (action === "approve") {
      items[idx] = {
        ...item,
        status: "authorized",
        authorizedAtET: now,
        authorizedBy: "ben-dashboard",
      };
      await writeState("reply-queue", items);

      const approvedSends = await readStateArray<QueueItem>("approved-sends");
      approvedSends.push({ ...items[idx] });
      await writeState("approved-sends", approvedSends);

      return NextResponse.json({
        ok: true,
        message: `Reply authorized. The agent will send "${item.draftSubject}" to ${item.senderEmail} on its next run (within ~30 min).`,
        queueId,
        status: "authorized",
      });

    } else if (action === "edit-and-send") {
      if (!editedSubject?.trim() || !editedBody?.trim()) {
        return NextResponse.json(
          { error: "editedSubject and editedBody are required for edit-and-send" },
          { status: 400 }
        );
      }

      const updatedItem: QueueItem = {
        ...item,
        draftSubject: editedSubject.trim(),
        draftBody: editedBody.trim(),
        subject: editedSubject.trim(),
        status: "authorized",
        authorizedAtET: now,
        authorizedBy: "ben-dashboard-edited",
      };
      items[idx] = updatedItem;
      await writeState("reply-queue", items);

      const approvedSends = await readStateArray<QueueItem>("approved-sends");
      approvedSends.push({ ...updatedItem });
      await writeState("approved-sends", approvedSends);

      return NextResponse.json({
        ok: true,
        message: `Edited version authorized. The agent will send your edited draft to ${item.senderEmail} on its next run (within ~30 min).`,
        queueId,
        status: "authorized",
      });

    } else {
      items[idx] = {
        ...item,
        status: "denied",
        deniedAtET: now,
        deniedBy: "ben-dashboard",
      };
      await writeState("reply-queue", items);

      return NextResponse.json({
        ok: true,
        message: `Draft killed. No email will be sent to ${item.senderEmail}.`,
        queueId,
        status: "denied",
      });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
