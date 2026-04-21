/**
 * Freight-Comp Queue Manager — /api/ops/fulfillment/freight-comp-queue
 *
 * Closes the BUILD #6 loop. The buy-label route auto-queues paired
 * DEBIT 500050 / CREDIT 499010 journal entries for every absorbed-
 * freight label. This route lets Rene (or an automation layer):
 *
 *   GET     — list queued + resolved entries
 *   POST    — approve one (optionally post to QBO immediately)
 *   DELETE  — reject with a documented reason
 *
 * Status lifecycle: queued → approved → posted   (happy path)
 *                   queued → rejected             (dismissed path)
 *
 * Contract: /contracts/distributor-pricing-commitments.md §5.
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import { createQBOJournalEntry } from "@/lib/ops/qbo-client";
import { logQBOAudit } from "@/lib/ops/qbo-guardrails";
import type { QBOJournalEntryInput } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_FREIGHT_COMP_QUEUE = "fulfillment:freight-comp-queue";

export type FreightCompQueueStatus =
  | "queued"
  | "approved"
  | "posted"
  | "rejected";

interface FreightCompQueueEntry {
  queuedAt: string;
  channel: string;
  channelLabel: string;
  customerName: string;
  customerMatch: string;
  freightDollars: number;
  trackingNumbers: string[];
  shipmentIds: Array<string | number>;
  customerRef: string;
  journalEntry: QBOJournalEntryInput;
  status: FreightCompQueueStatus;
  buyLoopKeys: string[];
  // Resolution metadata
  approvedBy?: string;
  approvedAt?: string;
  postedAt?: string;
  /** QBO JE Id returned by POST /journalentry. */
  qboJeId?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

async function readQueue(): Promise<FreightCompQueueEntry[]> {
  return (
    ((await kv.get<FreightCompQueueEntry[]>(KV_FREIGHT_COMP_QUEUE)) ??
      []) as FreightCompQueueEntry[]
  );
}

async function writeQueue(queue: FreightCompQueueEntry[]): Promise<void> {
  await kv.set(KV_FREIGHT_COMP_QUEUE, queue.slice(0, 500));
}

/**
 * Identify an entry uniquely. We use the composite of queuedAt +
 * customerRef because queuedAt is millisecond-resolution ISO so
 * collisions across the same customer are practically impossible.
 */
function entryKey(e: FreightCompQueueEntry): string {
  return `${e.queuedAt}|${e.customerRef}`;
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") as FreightCompQueueStatus | null;

  const queue = await readQueue();
  const filtered = statusFilter
    ? queue.filter((q) => q.status === statusFilter)
    : queue;

  const totals = queue.reduce(
    (acc, q) => {
      acc[q.status] = (acc[q.status] ?? 0) + 1;
      if (q.status === "queued") acc.queuedDollars += q.freightDollars;
      if (q.status === "posted") acc.postedDollars += q.freightDollars;
      return acc;
    },
    {
      queued: 0,
      approved: 0,
      posted: 0,
      rejected: 0,
      queuedDollars: 0,
      postedDollars: 0,
    } as Record<FreightCompQueueStatus | "queuedDollars" | "postedDollars", number>,
  );

  return NextResponse.json({
    ok: true,
    total: queue.length,
    filter: statusFilter,
    totals: {
      queued: totals.queued,
      approved: totals.approved,
      posted: totals.posted,
      rejected: totals.rejected,
      queuedDollars: Math.round(totals.queuedDollars * 100) / 100,
      postedDollars: Math.round(totals.postedDollars * 100) / 100,
    },
    entries: filtered.map((e) => ({ ...e, key: entryKey(e) })),
  });
}

/**
 * POST body:
 *   { key: "<queuedAt>|<customerRef>",
 *     approver: "Rene" | "Ben",
 *     postToQbo?: boolean   // default true
 *   }
 */
export async function POST(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  let body: {
    key?: string;
    approver?: string;
    postToQbo?: boolean;
    dryRun?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.key) {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }
  if (!body.approver || !["Rene", "Ben"].includes(body.approver)) {
    return NextResponse.json(
      { error: "approver must be 'Rene' or 'Ben'" },
      { status: 400 },
    );
  }

  const queue = await readQueue();
  const idx = queue.findIndex((q) => entryKey(q) === body.key);
  if (idx === -1) {
    return NextResponse.json(
      { error: `Queue entry not found: ${body.key}` },
      { status: 404 },
    );
  }
  const entry = queue[idx];
  if (entry.status !== "queued" && entry.status !== "approved") {
    return NextResponse.json(
      {
        error: `Entry already ${entry.status} — cannot re-approve. Reject + recreate if needed.`,
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  entry.status = "approved";
  entry.approvedBy = body.approver;
  entry.approvedAt = now;

  // Optionally post immediately. Default true — Rene's single-button
  // approve-and-post workflow (what the contract expects).
  const shouldPost = body.postToQbo !== false;
  const dryRun = body.dryRun === true;
  let qboResult: unknown = null;
  let postSucceeded = false;

  if (shouldPost && !dryRun) {
    try {
      const result = (await createQBOJournalEntry(
        entry.journalEntry,
      )) as Record<string, unknown> | null;
      qboResult = result;
      const je =
        (result && (result.JournalEntry as Record<string, unknown> | undefined)) ||
        (result as Record<string, unknown> | undefined);
      const jeId = je && typeof je.Id === "string" ? (je.Id as string) : undefined;
      if (jeId) {
        entry.qboJeId = jeId;
        entry.status = "posted";
        entry.postedAt = now;
        postSucceeded = true;
      }
    } catch (err) {
      await logQBOAudit({
        entity_type: "journal-entry",
        action: "create",
        endpoint: "/api/ops/fulfillment/freight-comp-queue",
        amount: entry.freightDollars,
        vendor_or_customer: `customer:${entry.customerName}`,
        ref_number: entry.customerRef,
        dry_run: false,
        validation_passed: false,
        issues: [
          {
            severity: "error",
            code: "FREIGHT_COMP_POST_FAILED",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        caller: body.approver,
      });
      return NextResponse.json(
        {
          ok: false,
          error: `QBO journal entry post failed: ${err instanceof Error ? err.message : String(err)}`,
          entry,
        },
        { status: 502 },
      );
    }
  }

  queue[idx] = entry;
  await writeQueue(queue);

  await logQBOAudit({
    entity_type: "journal-entry",
    action: "create",
    endpoint: "/api/ops/fulfillment/freight-comp-queue",
    amount: entry.freightDollars,
    vendor_or_customer: `customer:${entry.customerName}`,
    ref_number: entry.customerRef,
    dry_run: dryRun,
    validation_passed: true,
    issues: [],
    caller: body.approver,
  });

  return NextResponse.json({
    ok: true,
    status: entry.status,
    posted: postSucceeded,
    qboJeId: entry.qboJeId ?? null,
    qboResult: shouldPost ? qboResult : null,
    entry,
  });
}

/**
 * DELETE body:
 *   { key: "<queuedAt>|<customerRef>",
 *     rejectedBy: "Rene" | "Ben",
 *     reason: "string ≥8 chars"
 *   }
 */
export async function DELETE(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  let body: { key?: string; rejectedBy?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.key) {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }
  if (!body.rejectedBy || !["Rene", "Ben"].includes(body.rejectedBy)) {
    return NextResponse.json(
      { error: "rejectedBy must be 'Rene' or 'Ben'" },
      { status: 400 },
    );
  }
  if (!body.reason || body.reason.trim().length < 8) {
    return NextResponse.json(
      { error: "reason must be ≥8 chars" },
      { status: 400 },
    );
  }

  const queue = await readQueue();
  const idx = queue.findIndex((q) => entryKey(q) === body.key);
  if (idx === -1) {
    return NextResponse.json(
      { error: `Queue entry not found: ${body.key}` },
      { status: 404 },
    );
  }
  const entry = queue[idx];
  if (entry.status === "posted") {
    return NextResponse.json(
      { error: "Cannot reject a posted entry — it's already in QBO." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  entry.status = "rejected";
  entry.rejectedBy = body.rejectedBy;
  entry.rejectedAt = now;
  entry.rejectionReason = body.reason.trim();
  queue[idx] = entry;
  await writeQueue(queue);

  await logQBOAudit({
    entity_type: "journal-entry",
    action: "delete",
    endpoint: "/api/ops/fulfillment/freight-comp-queue",
    amount: entry.freightDollars,
    vendor_or_customer: `customer:${entry.customerName}`,
    ref_number: entry.customerRef,
    dry_run: false,
    validation_passed: true,
    issues: [
      {
        severity: "info",
        code: "FREIGHT_COMP_REJECTED",
        message: entry.rejectionReason!,
      },
    ],
    caller: body.rejectedBy,
  });

  return NextResponse.json({
    ok: true,
    status: entry.status,
    entry,
  });
}
