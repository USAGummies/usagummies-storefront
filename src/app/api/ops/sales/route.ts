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
 * The per-source readers live in `src/lib/ops/sales-command-readers.ts`
 * and are shared with the morning daily-brief route so both surfaces
 * read the same data the same way (no parallel implementations).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildSalesCommandCenter } from "@/lib/ops/sales-command-center";
import {
  readAllAgingItems,
  readApPackets,
  readDay1Prospects,
  readFaireFollowUps,
  readFaireInvites,
  readLocationDrafts,
  readPendingApprovals,
  readSalesPipeline,
  readSalesTourPlaybook,
  readWholesaleInquiries,
} from "@/lib/ops/sales-command-readers";
import { readAllChannelsLast7d } from "@/lib/ops/revenue-kpi-readers";
import {
  getRecentShipments,
  isShipStationConfigured,
} from "@/lib/ops/shipstation-client";
import {
  bulkLookupArtifacts,
  type ShippingArtifactRecord,
} from "@/lib/ops/shipping-artifacts";
import { buildDispatchBoardRows } from "@/lib/ops/shipping-dispatch-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    aging,
    revenueChannels,
    wholesaleInquiries,
    day1Prospects,
    salesTour,
    salesPipeline,
  ] = await Promise.all([
    readFaireInvites(),
    readFaireFollowUps(now),
    readPendingApprovals(),
    readApPackets(),
    readLocationDrafts(),
    readAllAgingItems(now),
    readAllChannelsLast7d(now),
    readWholesaleInquiries(),
    readDay1Prospects(),
    readSalesTourPlaybook(),
    readSalesPipeline(now),
  ]);

  // Phase 28f — fetch the dispatch-board rows for the new tile on
  // /ops/sales. Mirrors the daily-brief route's pattern: skip silently
  // when ShipStation isn't configured (mark the tile not_wired with
  // a specific reason), surface a transient error if the call fails.
  let dispatchRows:
    | ReadonlyArray<{
        state: "open" | "dispatched";
        shipDate: string | null;
        dispatchedAt: string | null;
      }>
    | undefined;
  let dispatchNotWiredReason: string | undefined;
  if (isShipStationConfigured()) {
    try {
      const since = new Date(now.getTime() - 14 * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      const ssRes = await getRecentShipments({
        shipDateStart: since,
        includeVoided: false,
        pageSize: 200,
      });
      if (ssRes.ok) {
        const pairs = ssRes.shipments
          .filter((s) => s.orderNumber)
          .map((s) => ({ orderNumber: s.orderNumber as string }));
        const artifactMap = await bulkLookupArtifacts(pairs);
        const lookupMap = new Map<string, ShippingArtifactRecord>();
        for (const [orderNumber, record] of artifactMap.entries()) {
          lookupMap.set(orderNumber, record);
          lookupMap.set(`${record.source}:${orderNumber}`, record);
        }
        const view = buildDispatchBoardRows(ssRes.shipments, lookupMap, {
          excludeVoided: true,
        });
        dispatchRows = view.rows;
      } else {
        dispatchNotWiredReason = `ShipStation read failed: ${ssRes.error}`;
      }
    } catch (err) {
      dispatchNotWiredReason = `ShipStation read threw: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  } else {
    dispatchNotWiredReason = "ShipStation not configured.";
  }

  const report = buildSalesCommandCenter(
    {
      faireInvites,
      faireFollowUps,
      pendingApprovals,
      apPackets,
      locationDrafts,
      wholesaleInquiries,
      day1Prospects,
      salesTour,
      salesPipeline,
      missingEnv: readMissingEnv(),
      agingItems: aging.items,
      agingMissing: aging.missing,
      revenueChannels,
      dispatchRows,
      dispatchNotWiredReason,
    },
    { now },
  );

  return NextResponse.json({ ok: true, report });
}
