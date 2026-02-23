import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = process.env.HOME || "/Users/ben";
const REPLY_ATTENTION_FILE = path.join(HOME, ".config/usa-gummies-mcp/reply-attention-queue.json");
const APPROVED_SENDS_FILE = path.join(HOME, ".config/usa-gummies-mcp/reply-approved-sends.json");

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

function readQueue(): QueueItem[] {
  try {
    if (!fs.existsSync(REPLY_ATTENTION_FILE)) return [];
    const raw = fs.readFileSync(REPLY_ATTENTION_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.items || []);
  } catch {
    return [];
  }
}

function writeQueue(items: QueueItem[]) {
  fs.writeFileSync(REPLY_ATTENTION_FILE, JSON.stringify(items, null, 2), "utf8");
}

function readApprovedSends(): QueueItem[] {
  try {
    if (!fs.existsSync(APPROVED_SENDS_FILE)) return [];
    const raw = fs.readFileSync(APPROVED_SENDS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeApprovedSends(items: QueueItem[]) {
  fs.writeFileSync(APPROVED_SENDS_FILE, JSON.stringify(items, null, 2), "utf8");
}

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

    const items = readQueue();
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
      // Approve as-is — mark authorized and push to send queue
      items[idx] = {
        ...item,
        status: "authorized",
        authorizedAtET: now,
        authorizedBy: "ben-dashboard",
      };
      writeQueue(items);

      const approvedSends = readApprovedSends();
      approvedSends.push({ ...items[idx] });
      writeApprovedSends(approvedSends);

      return NextResponse.json({
        ok: true,
        message: `Reply authorized. The agent will send "${item.draftSubject}" to ${item.senderEmail} on its next run (within ~30 min).`,
        queueId,
        status: "authorized",
      });

    } else if (action === "edit-and-send") {
      // Ben edited the draft — send the edited version
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
        subject: editedSubject.trim(), // alias for display
        status: "authorized",
        authorizedAtET: now,
        authorizedBy: "ben-dashboard-edited",
      };
      items[idx] = updatedItem;
      writeQueue(items);

      // Push edited version to approved sends for agent pickup
      const approvedSends = readApprovedSends();
      approvedSends.push({ ...updatedItem });
      writeApprovedSends(approvedSends);

      return NextResponse.json({
        ok: true,
        message: `Edited version authorized. The agent will send your edited draft to ${item.senderEmail} on its next run (within ~30 min).`,
        queueId,
        status: "authorized",
      });

    } else {
      // Deny completely — no email will be sent
      items[idx] = {
        ...item,
        status: "denied",
        deniedAtET: now,
        deniedBy: "ben-dashboard",
      };
      writeQueue(items);

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
