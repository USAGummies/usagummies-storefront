/**
 * GET /api/ops/fulfillment/recent-labels
 *
 * Lists recent ShipStation shipments for operational visibility.
 * Complements the Slack digests — when Ben wants to see the last N
 * labels bought without scrolling through the ShipStation UI.
 *
 * Query params:
 *   - daysBack:     default 7, clamped [1, 30]
 *   - includeVoided: "true" to include voided labels (default excluded)
 *   - limit:        default 50, max 200
 *
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getRecentShipments } from "@/lib/ops/shipstation-client";
import { bulkLookupArtifacts } from "@/lib/ops/shipping-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(
  s: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!s) return fallback;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysBack = clampInt(url.searchParams.get("daysBack"), 7, 1, 30);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
  const includeVoided = url.searchParams.get("includeVoided") === "true";

  const res = await getRecentShipments({
    shipDateStart: new Date(Date.now() - daysBack * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10),
    includeVoided,
    pageSize: Math.max(limit, 200),
  });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  }

  const shipments = res.shipments.slice(0, limit);
  const totalSpend =
    Math.round(
      shipments
        .filter((s) => !s.voided)
        .reduce((sum, s) => sum + (s.shipmentCost ?? 0), 0) * 100,
    ) / 100;
  const voidedSpend =
    Math.round(
      shipments
        .filter((s) => s.voided)
        .reduce((sum, s) => sum + (s.shipmentCost ?? 0), 0) * 100,
    ) / 100;

  // Per-carrier summary for the preflight/banner consumers.
  const byCarrier: Record<
    string,
    { active: number; voided: number; activeDollars: number }
  > = {};
  for (const s of shipments) {
    const key = s.carrierCode ?? "unknown";
    const bucket = byCarrier[key] ?? { active: 0, voided: 0, activeDollars: 0 };
    if (s.voided) {
      bucket.voided += 1;
    } else {
      bucket.active += 1;
      bucket.activeDollars =
        Math.round((bucket.activeDollars + (s.shipmentCost ?? 0)) * 100) / 100;
    }
    byCarrier[key] = bucket;
  }

  // Bulk-join with artifact metadata (Drive label + packing slip + Slack
  // permalink) recorded by the auto-ship pipeline. Best-effort: a KV
  // miss / outage just leaves those fields null.
  const orderNumbers = shipments
    .map((s) => s.orderNumber)
    .filter((n): n is string => Boolean(n));
  const artifacts =
    orderNumbers.length > 0
      ? await bulkLookupArtifacts(
          orderNumbers.map((n) => ({ orderNumber: n })),
        ).catch(() => new Map())
      : new Map();

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    daysBack,
    limit,
    includeVoided,
    totalCount: shipments.length,
    activeSpend: totalSpend,
    voidedSpend,
    byCarrier,
    shipments: shipments.map((s) => {
      const artifact = s.orderNumber ? artifacts.get(s.orderNumber) : null;
      return {
        shipmentId: s.shipmentId,
        orderNumber: s.orderNumber,
        trackingNumber: s.trackingNumber,
        carrierCode: s.carrierCode,
        serviceCode: s.serviceCode,
        shipDate: s.shipDate,
        createDate: s.createDate,
        voided: s.voided,
        voidDate: s.voidDate,
        shipmentCost: s.shipmentCost,
        shipToName: s.shipToName,
        shipToPostalCode: s.shipToPostalCode,
        // New: artifact links surfaced when present.
        labelDriveLink: artifact?.label?.webViewLink ?? null,
        packingSlipDriveLink: artifact?.packingSlip?.webViewLink ?? null,
        slackPermalink: artifact?.slackPermalink ?? null,
        artifactSource: artifact?.source ?? null,
      };
    }),
  });
}
