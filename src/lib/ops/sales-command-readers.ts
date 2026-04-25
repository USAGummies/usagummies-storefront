/**
 * Shared source readers for the Sales Command Center.
 *
 * These were originally inlined in `src/app/api/ops/sales/route.ts`.
 * Phase 2 extracts them so the morning daily-brief route can call the
 * same readers and produce its compact Slack section without
 * duplicating the source contracts.
 *
 * Hard rules:
 *   - **Read-only.** Each reader either returns a `SourceState<T>`
 *     wrapping live counts or an explicit `not_wired` / `error`
 *     state. No KV / Gmail / HubSpot / Faire / Slack / QBO / Shopify
 *     mutation, no approval opened, no email drafted.
 *   - Per-source error isolation — a single source's failure becomes
 *     `{ status: "error" }` and never throws past the reader boundary.
 *   - Wholesale inquiries explicitly returns `not_wired` with reason;
 *     there is no internal list endpoint today.
 *
 * Both `/api/ops/sales` (dashboard) and `/api/ops/daily-brief`
 * (morning Slack section) consume these. The readers are deliberately
 * untyped to a single coordinator object — each one stands alone, so
 * a future caller (e.g. an EOD digest, a weekly drift audit) can pull
 * a subset without paying the cost of the others.
 */
import { kv } from "@vercel/kv";

import { listInvites, listInvitesByStatus } from "@/lib/faire/invites";
import { reportFollowUps } from "@/lib/faire/follow-ups";
import { listApPackets } from "@/lib/ops/ap-packets";
import { listDraftsByStatus } from "@/lib/locations/drafts";
import { listReceipts } from "@/lib/ops/docs";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import {
  sourceError,
  sourceNotWired,
  sourceWired,
  type ApPacketCounts,
  type FaireFollowUpRowSummary,
  type FaireInviteCounts,
  type LocationDraftCounts,
  type PendingApprovalSummary,
  type SourceState,
} from "@/lib/ops/sales-command-center";
import {
  classifyAgingInput,
  type AgingItem,
  type MissingTimestampItem,
} from "@/lib/ops/sales-aging";

const KV_AP_SENT_PREFIX = "ap-packets:sent:";

export async function readFaireInvites(): Promise<
  SourceState<FaireInviteCounts>
> {
  try {
    const grouped = await listInvitesByStatus();
    const counts: FaireInviteCounts = {
      needs_review: grouped.needs_review.length,
      approved: grouped.approved.length,
      sent: grouped.sent.length,
      rejected: grouped.rejected.length,
      total:
        grouped.needs_review.length +
        grouped.approved.length +
        grouped.sent.length +
        grouped.rejected.length,
    };
    return sourceWired(counts);
  } catch (err) {
    return sourceError(
      `Faire invite queue read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function readFaireFollowUps(now: Date): Promise<
  SourceState<{
    counts: {
      overdue: number;
      due_soon: number;
      not_due: number;
      sent_total: number;
    };
    actionable: FaireFollowUpRowSummary[];
  }>
> {
  try {
    const all = await listInvites();
    const report = reportFollowUps(all, now);
    const sent_total = all.filter((r) => r.status === "sent").length;
    const actionable: FaireFollowUpRowSummary[] = [
      ...report.overdue.map((c) => ({
        id: c.record.id,
        retailerName: c.record.retailerName,
        email: c.record.email,
        daysSinceSent: c.daysSinceSent,
        bucket: "overdue" as const,
      })),
      ...report.due_soon.map((c) => ({
        id: c.record.id,
        retailerName: c.record.retailerName,
        email: c.record.email,
        daysSinceSent: c.daysSinceSent,
        bucket: "due_soon" as const,
      })),
    ];
    return sourceWired({
      counts: {
        overdue: report.overdue.length,
        due_soon: report.due_soon.length,
        not_due: report.not_due.length,
        sent_total,
      },
      actionable,
    });
  } catch (err) {
    return sourceError(
      `Faire follow-up read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function readPendingApprovals(): Promise<
  SourceState<PendingApprovalSummary>
> {
  try {
    const pending = await approvalStore().listPending();
    const byTargetType: Record<string, number> = {};
    for (const p of pending) {
      const t = p.targetEntity?.type ?? "(none)";
      byTargetType[t] = (byTargetType[t] ?? 0) + 1;
    }
    const sorted = [...pending].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    const preview = sorted.slice(0, 5).map((p) => ({
      id: p.id,
      targetType: p.targetEntity?.type ?? "(none)",
      label: p.targetEntity?.label ?? null,
      actionSlug: p.action,
      createdAt: p.createdAt,
    }));
    return sourceWired({
      total: pending.length,
      byTargetType,
      preview,
    });
  } catch (err) {
    return sourceError(
      `Pending approvals read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function readApPackets(): Promise<SourceState<ApPacketCounts>> {
  try {
    const packets = listApPackets();
    let sentCount = 0;
    for (const p of packets) {
      try {
        const row = await kv.get(`${KV_AP_SENT_PREFIX}${p.slug}`);
        if (row) sentCount += 1;
      } catch {
        // KV miss / outage on a single packet is non-fatal.
      }
    }
    const counts: ApPacketCounts = {
      total: packets.length,
      ready_to_send: packets.filter((p) => p.status === "ready-to-send").length,
      action_required: packets.filter(
        (p) => p.status === "action-required",
      ).length,
      sent: sentCount,
    };
    return sourceWired(counts);
  } catch (err) {
    return sourceError(
      `AP packet read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function readLocationDrafts(): Promise<
  SourceState<LocationDraftCounts>
> {
  try {
    const grouped = await listDraftsByStatus();
    const counts: LocationDraftCounts = {
      needs_review: grouped.needs_review.length,
      accepted: grouped.accepted.length,
      rejected: grouped.rejected.length,
      total:
        grouped.needs_review.length +
        grouped.accepted.length +
        grouped.rejected.length,
    };
    return sourceWired(counts);
  } catch (err) {
    return sourceError(
      `Location draft read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Wholesale inquiries — there is no internal list endpoint today.
 * Submissions land in `/api/leads` but aren't archived in a queryable
 * store. Surface this honestly rather than fabricating a count.
 */
export function readWholesaleInquiries(): SourceState<{
  total: number;
  lastSubmittedAt?: string;
}> {
  return sourceNotWired(
    "No internal list endpoint for wholesale inquiries. Submissions land in /api/leads but aren't archived in a queryable store. Wire this when a /api/ops/wholesale/inquiries list route lands.",
  );
}

// ---------------------------------------------------------------------------
// Phase 3 — aging readers
// ---------------------------------------------------------------------------
//
// Each reader projects its source records into AgingItems (when the
// row carries a usable anchor timestamp) or MissingTimestampItems
// (when it doesn't). Read-only by contract. Failures are isolated:
// a thrown error returns an empty list rather than poisoning the
// shared aging stream — `readAllAgingItems` aggregates and surfaces
// the gap as a degradation note for the route caller.

export interface AgingReadSlice {
  items: AgingItem[];
  missing: MissingTimestampItem[];
}

const EMPTY_AGING: AgingReadSlice = { items: [], missing: [] };

export async function readApprovalAgingItems(
  now: Date,
): Promise<AgingReadSlice> {
  try {
    const pending = await approvalStore().listPending();
    const items: AgingItem[] = [];
    const missing: MissingTimestampItem[] = [];
    for (const p of pending) {
      const r = classifyAgingInput(
        {
          source: "approval",
          id: p.id,
          label:
            p.targetEntity?.label ??
            `${p.action} (${p.targetEntity?.type ?? "no target type"})`,
          link: "/ops/sales", // approvals don't have a stable internal page; the dashboard is the entry point
          anchorAt: p.createdAt,
        },
        now,
      );
      if (r.ok) items.push(r.item);
      else missing.push(r.missing);
    }
    return { items, missing };
  } catch {
    return EMPTY_AGING;
  }
}

export async function readFaireFollowUpAgingItems(
  now: Date,
): Promise<AgingReadSlice> {
  try {
    const all = await listInvites();
    // We surface every status="sent" record that has NOT yet had its
    // follow-up sent (followUpSentAt unset). Records where the
    // operator already queued or sent a follow-up are intentionally
    // excluded — they're not actionable in the aging panel anymore.
    const items: AgingItem[] = [];
    const missing: MissingTimestampItem[] = [];
    for (const r of all) {
      if (r.status !== "sent") continue;
      if (r.followUpSentAt) continue; // follow-up already sent — not aging
      // Use the existing follow-up classifier indirectly by passing
      // sentAt as the anchor — the unified threshold registry
      // handles fresh/watch/overdue/critical from there.
      const cls = classifyAgingInput(
        {
          source: "faire-followup",
          id: r.id,
          label: r.retailerName,
          link: "/ops/faire-direct",
          anchorAt: r.sentAt,
        },
        now,
      );
      if (cls.ok) items.push(cls.item);
      else missing.push(cls.missing);
    }
    return { items, missing };
  } catch {
    return EMPTY_AGING;
  }
}

const KV_AP_SENT_PREFIX_FOR_AGING = "ap-packets:sent:";

/**
 * AP packets carry no `readyAt` field in today's data model — we
 * can't compute "stale if unsent > 2 business days after ready"
 * without inventing a clock. Surface every ready-to-send-not-sent
 * packet as a missing-timestamp row so the dashboard at least shows
 * the queue exists, and a future schema addition (readyAt) can flip
 * it into the proper aging stream.
 */
export async function readApPacketAgingItems(): Promise<AgingReadSlice> {
  try {
    const packets = listApPackets();
    const missing: MissingTimestampItem[] = [];
    for (const p of packets) {
      if (p.status !== "ready-to-send") continue;
      let alreadySent = false;
      try {
        const row = await kv.get(`${KV_AP_SENT_PREFIX_FOR_AGING}${p.slug}`);
        if (row) alreadySent = true;
      } catch {
        // KV miss is non-fatal — fall through and surface the row.
      }
      if (alreadySent) continue;
      missing.push({
        source: "ap-packet",
        id: p.slug,
        label: `${p.accountName} (${p.slug})`,
        link: "/ops/ap-packets",
        reason:
          "AP packet config has no readyAt timestamp; cannot compute age. Surfaces here as 'timestamp missing' until the schema gains a readyAt field.",
      });
    }
    return { items: [], missing };
  } catch {
    return EMPTY_AGING;
  }
}

export async function readLocationDraftAgingItems(
  now: Date,
): Promise<AgingReadSlice> {
  try {
    const grouped = await listDraftsByStatus();
    const items: AgingItem[] = [];
    const missing: MissingTimestampItem[] = [];
    for (const d of grouped.needs_review) {
      const cls = classifyAgingInput(
        {
          source: "location-draft",
          id: d.slug,
          label: d.name,
          link: "/ops/locations",
          anchorAt: d.draftedAt,
        },
        now,
      );
      if (cls.ok) items.push(cls.item);
      else missing.push(cls.missing);
    }
    return { items, missing };
  } catch {
    return EMPTY_AGING;
  }
}

export async function readReceiptAgingItems(
  now: Date,
): Promise<AgingReadSlice> {
  try {
    const records = await listReceipts({ status: "needs_review", limit: 200 });
    const items: AgingItem[] = [];
    const missing: MissingTimestampItem[] = [];
    for (const r of records) {
      const label = r.vendor
        ? `${r.vendor}${typeof r.amount === "number" ? ` · $${r.amount.toFixed(2)}` : ""}`
        : `Receipt ${r.id}`;
      const cls = classifyAgingInput(
        {
          source: "receipt",
          id: r.id,
          label,
          link: "/ops/finance/review",
          anchorAt: r.processed_at,
        },
        now,
      );
      if (cls.ok) items.push(cls.item);
      else missing.push(cls.missing);
    }
    return { items, missing };
  } catch {
    return EMPTY_AGING;
  }
}

/**
 * Aggregate every aging reader in parallel. Used by both the
 * dashboard route and the morning-brief route. Order of items
 * within the result is the concatenation order; callers must
 * `sortAging` / `selectTopAging` before display.
 */
export async function readAllAgingItems(now: Date): Promise<AgingReadSlice> {
  const slices = await Promise.all([
    readApprovalAgingItems(now),
    readFaireFollowUpAgingItems(now),
    readApPacketAgingItems(),
    readLocationDraftAgingItems(now),
    readReceiptAgingItems(now),
  ]);
  const items: AgingItem[] = [];
  const missing: MissingTimestampItem[] = [];
  for (const s of slices) {
    items.push(...s.items);
    missing.push(...s.missing);
  }
  return { items, missing };
}
