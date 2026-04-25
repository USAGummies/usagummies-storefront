/**
 * GET /api/ops/sales
 *
 * Phase 1 Sales Command Center — read-only aggregator. Reads each
 * underlying source server-side (no self-fetch) and returns the
 * consolidated `SalesCommandCenterReport` shape.
 *
 * Hard rules:
 *   - **Read-only.** No KV / Gmail / HubSpot / Faire / Slack / QBO /
 *     Shopify mutation. No approval is opened, no email is drafted.
 *   - Each source is wrapped in a try/catch that converts a thrown
 *     error into `{ status: "error", reason }` — a single source
 *     failing never breaks the whole dashboard.
 *   - Sources without a list API return `{ status: "not_wired" }`
 *     with an explicit reason. The aggregator surfaces this honestly
 *     instead of inventing a count.
 *   - Auth: middleware blocks `/api/ops/*` for unauthenticated
 *     traffic; `isAuthorized()` rechecks (session OR CRON_SECRET).
 *
 * Sources surveyed:
 *   - `listInvitesByStatus()` — KV-backed Faire Direct invite queue.
 *   - `reportFollowUps(listInvites())` — pure helper over the same
 *     KV store.
 *   - `approvalStore().listPending()` — control-plane approvals.
 *   - `listApPackets()` (in-memory packet config) plus a KV scan for
 *     `ap-packets:sent:*` rows to count completed sends.
 *   - `listDraftsByStatus()` — KV-backed location drafts.
 *   - Wholesale inquiries: explicitly `not_wired` — there's no list
 *     endpoint today (the existing surface is a token-receipt page
 *     keyed on a per-inquiry HMAC).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  buildSalesCommandCenter,
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
import { listInvites, listInvitesByStatus } from "@/lib/faire/invites";
import { reportFollowUps } from "@/lib/faire/follow-ups";
import { listApPackets } from "@/lib/ops/ap-packets";
import { listDraftsByStatus } from "@/lib/locations/drafts";
import { approvalStore } from "@/lib/ops/control-plane/stores";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_AP_SENT_PREFIX = "ap-packets:sent:";

// ---------------------------------------------------------------------------
// Source readers
// ---------------------------------------------------------------------------

async function readFaireInvites(): Promise<SourceState<FaireInviteCounts>> {
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

async function readFaireFollowUps(now: Date): Promise<
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
    // Pre-sorted most-stale-first by `reportFollowUps` — preserve order.
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

async function readPendingApprovals(): Promise<
  SourceState<PendingApprovalSummary>
> {
  try {
    const pending = await approvalStore().listPending();
    const byTargetType: Record<string, number> = {};
    for (const p of pending) {
      const t = p.targetEntity?.type ?? "(none)";
      byTargetType[t] = (byTargetType[t] ?? 0) + 1;
    }
    // Take 5 oldest-first so the dashboard nudges Ben on the most
    // stale approval first.
    const sorted = [...pending].sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt),
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

async function readApPackets(): Promise<SourceState<ApPacketCounts>> {
  try {
    const packets = listApPackets();
    let sentCount = 0;
    // Best-effort scan: for each packet slug, check if a `lastSent`
    // KV row exists. This mirrors how /api/ops/ap-packets surfaces
    // the same flag — kept consistent.
    for (const p of packets) {
      try {
        const row = await kv.get(`${KV_AP_SENT_PREFIX}${p.slug}`);
        if (row) sentCount += 1;
      } catch {
        // KV miss / outage on a single packet is non-fatal; fall through.
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

async function readLocationDrafts(): Promise<SourceState<LocationDraftCounts>> {
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

function readWholesaleInquiries(): SourceState<{
  total: number;
  lastSubmittedAt?: string;
}> {
  // Phase 1: there is NO internal list endpoint for wholesale
  // inquiries. The existing public surface (`/api/wholesale/inquiries`)
  // is a token-keyed receipt page, not an aggregation source. The
  // submission path lives at `/api/leads`, but there's no internal
  // archive we can scan. Surface this honestly.
  return sourceNotWired(
    "No internal list endpoint for wholesale inquiries. Submissions land in /api/leads but aren't archived in a queryable store. Wire this when a /api/ops/wholesale/inquiries list route lands.",
  );
}

function readMissingEnv(): string[] {
  // The dashboard's "Blockers" panel surfaces ENV vars that the
  // codebase reads when wiring deeper sources. We only flag ones
  // that are unset; a wired source has already proven its env is
  // good. Keep this list short and honest.
  const candidates: Array<{ name: string; reason: string }> = [
    {
      name: "FAIRE_ACCESS_TOKEN",
      reason:
        "Faire brand-portal API client. Phase 3 send closer doesn't need it (Gmail-only), but the legacy read-only client surfaces a degraded banner without it.",
    },
    {
      name: "HUBSPOT_PRIVATE_APP_TOKEN",
      reason:
        "HubSpot read/write. Email-association fallback in the Faire send mirror is a no-op without this.",
    },
  ];
  return candidates
    .filter((c) => !((process.env[c.name] ?? "").trim().length > 0))
    .map((c) => c.name);
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Run readers in parallel — each is independently wrapped, so a
  // single source failure never aborts the others.
  const [
    faireInvites,
    faireFollowUps,
    pendingApprovals,
    apPackets,
    locationDrafts,
  ] = await Promise.all([
    readFaireInvites(),
    readFaireFollowUps(now),
    readPendingApprovals(),
    readApPackets(),
    readLocationDrafts(),
  ]);

  const report = buildSalesCommandCenter(
    {
      faireInvites,
      faireFollowUps,
      pendingApprovals,
      apPackets,
      locationDrafts,
      wholesaleInquiries: readWholesaleInquiries(),
      missingEnv: readMissingEnv(),
    },
    { now },
  );

  return NextResponse.json({ ok: true, report });
}
