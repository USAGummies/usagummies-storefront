import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { auth } from "@/lib/auth/config";
import { appendStateArray, readStateArray, writeState } from "@/lib/ops/state";

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
  authorizationActionId?: string;
  authorizedAtET?: string;
  authorizedBy?: string;
  authorizedByUserId?: string;
  authorizedByEmail?: string;
  authorizedByRole?: string;
  authorizedByFingerprint?: string;
  deniedAtET?: string;
  deniedBy?: string;
  deniedByUserId?: string;
  deniedByEmail?: string;
  deniedByRole?: string;
  deniedByFingerprint?: string;
};

type ReplyActionAuditEntry = {
  actionId: string;
  queueId: string;
  action: "approve" | "deny" | "edit-and-send";
  atET: string;
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  actorFingerprint: string;
  senderEmail: string;
  statusAfter: "authorized" | "denied";
  draftSubjectAfter: string;
};

const ACTION_ROLES = new Set(["admin", "employee"]);

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

function actorFingerprint(req: NextRequest): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown-ip";
  const ua = req.headers.get("user-agent") || "unknown-ua";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 16);
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actorRole = String(session.user.role || "").toLowerCase();
    if (!ACTION_ROLES.has(actorRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
    const actionId = randomUUID();
    const actor = {
      userId: String(session.user.id),
      email: String(session.user.email || "unknown"),
      role: actorRole,
      fingerprint: actorFingerprint(req),
    };

    const appendAudit = async (entry: ReplyActionAuditEntry) => {
      await appendStateArray("reply-action-audit", [entry], 3000);
    };

    if (action === "approve") {
      items[idx] = {
        ...item,
        status: "authorized",
        authorizationActionId: actionId,
        authorizedAtET: now,
        authorizedBy: actor.email,
        authorizedByUserId: actor.userId,
        authorizedByEmail: actor.email,
        authorizedByRole: actor.role,
        authorizedByFingerprint: actor.fingerprint,
      };
      await writeState("reply-queue", items);

      const approvedSends = await readStateArray<QueueItem>("approved-sends");
      approvedSends.push({ ...items[idx] });
      await writeState("approved-sends", approvedSends);
      await appendAudit({
        actionId,
        queueId,
        action,
        atET: now,
        actorUserId: actor.userId,
        actorEmail: actor.email,
        actorRole: actor.role,
        actorFingerprint: actor.fingerprint,
        senderEmail: item.senderEmail,
        statusAfter: "authorized",
        draftSubjectAfter: items[idx].draftSubject,
      });

      return NextResponse.json({
        ok: true,
        message: `Reply authorized. The agent will send "${item.draftSubject}" to ${item.senderEmail} on its next run (within ~30 min).`,
        queueId,
        actionId,
        actor,
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
        authorizationActionId: actionId,
        authorizedAtET: now,
        authorizedBy: actor.email,
        authorizedByUserId: actor.userId,
        authorizedByEmail: actor.email,
        authorizedByRole: actor.role,
        authorizedByFingerprint: actor.fingerprint,
      };
      items[idx] = updatedItem;
      await writeState("reply-queue", items);

      const approvedSends = await readStateArray<QueueItem>("approved-sends");
      approvedSends.push({ ...updatedItem });
      await writeState("approved-sends", approvedSends);
      await appendAudit({
        actionId,
        queueId,
        action,
        atET: now,
        actorUserId: actor.userId,
        actorEmail: actor.email,
        actorRole: actor.role,
        actorFingerprint: actor.fingerprint,
        senderEmail: item.senderEmail,
        statusAfter: "authorized",
        draftSubjectAfter: updatedItem.draftSubject,
      });

      return NextResponse.json({
        ok: true,
        message: `Edited version authorized. The agent will send your edited draft to ${item.senderEmail} on its next run (within ~30 min).`,
        queueId,
        actionId,
        actor,
        status: "authorized",
      });

    } else {
      items[idx] = {
        ...item,
        status: "denied",
        authorizationActionId: actionId,
        deniedAtET: now,
        deniedBy: actor.email,
        deniedByUserId: actor.userId,
        deniedByEmail: actor.email,
        deniedByRole: actor.role,
        deniedByFingerprint: actor.fingerprint,
      };
      await writeState("reply-queue", items);
      await appendAudit({
        actionId,
        queueId,
        action,
        atET: now,
        actorUserId: actor.userId,
        actorEmail: actor.email,
        actorRole: actor.role,
        actorFingerprint: actor.fingerprint,
        senderEmail: item.senderEmail,
        statusAfter: "denied",
        draftSubjectAfter: items[idx].draftSubject,
      });

      return NextResponse.json({
        ok: true,
        message: `Draft killed. No email will be sent to ${item.senderEmail}.`,
        queueId,
        actionId,
        actor,
        status: "denied",
      });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
