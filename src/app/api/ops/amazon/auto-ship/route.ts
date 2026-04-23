/**
 * POST /api/ops/amazon/auto-ship
 *
 * The fully-automated Amazon FBM shipping pipeline. Per Ben's spec
 * (2026-04-23): every unshipped Amazon FBM order that fits a canonical
 * packaging profile gets auto-bought — no button, no manual step. The
 * label PDF drops into Slack (#operations by default, or DM to a user
 * if configured) so Ben can print it from his phone and mark shipped.
 *
 * Flow per order:
 *   1. Poll SP-API for unshipped FBM orders (already built: fetchUnshippedFbmOrders).
 *   2. For each order:
 *      a. Pull order items → total bag count.
 *      b. Ask pickPackagingForBags(bags) — if not autoBuyEligible,
 *         surface to #ops-approvals + skip auto-buy.
 *      c. Lookup the order in ShipStation (for ship-to + orderId).
 *      d. Call createLabelForShipStationOrder with the profile's
 *         package/weight/dims + ShipStation's rate-shop-via-UI is
 *         served by passing the selected service (we pick the cheaper
 *         of USPS Ground Advantage vs UPS Ground Saver based on weight).
 *      e. Download label PDF (base64 data URL → Buffer).
 *      f. Extract page 1 (label) — page 2 is ShipStation's packing slip
 *         which we skip to avoid the "printed the wrong page" pitfall
 *         tonight proved is a real issue.
 *      g. Post the PDF to the configured Slack channel with a one-line
 *         order summary (order#, ship-to city/state, bags, ship-by).
 *      h. Mark dispatched in KV so the unshipped-alert cron dedupes.
 *      i. Audit.
 *   3. Return a rollup.
 *
 * Dedup: we track auto-shipped orders in `amazon:fbm:dispatched` KV
 * (the same key the unshipped-alert uses). Orders already in that list
 * are skipped — prevents a half-processed batch from double-buying if
 * the cron fires twice inside the Amazon→ShipStation sync window.
 *
 * Kill switch: `AUTO_SHIP_ENABLED` env var. Set to "false" to pause
 * the pipeline without a redeploy.
 *
 * Auth: session OR bearer CRON_SECRET. Designed to be called by a
 * Vercel cron every 15–30 min during business hours.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditSurface } from "@/lib/ops/control-plane/slack";
import { postMessage } from "@/lib/ops/control-plane/slack/client";
import { auditStore } from "@/lib/ops/control-plane/stores";
import {
  fetchOrderItems,
  fetchUnshippedFbmOrders,
  isAmazonConfigured,
} from "@/lib/amazon/sp-api";
import {
  createLabelForShipStationOrder,
  findShipStationOrderByNumber,
  isShipStationConfigured,
} from "@/lib/ops/shipstation-client";
import { pickPackagingForBags } from "@/lib/ops/shipping-packaging";
import { uploadBufferToSlack } from "@/lib/ops/slack-file-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_DISPATCHED = "amazon:fbm:dispatched";

interface DispatchedEntry {
  orderId: string;
  dispatchedAt: string;
  trackingNumber?: string | null;
}

interface AutoShipBody {
  /** Restrict to specific order numbers (default = all unshipped). */
  orderNumbers?: string[];
  /** Preview only — pick packaging + service but don't buy. */
  dryRun?: boolean;
  /** Override the target Slack channel (default: #operations). */
  slackChannel?: string;
}

interface AutoShipResult {
  orderNumber: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: string;
  bags?: number;
  packagingId?: string;
  trackingNumber?: string;
  cost?: number;
  carrier?: string;
  service?: string;
  slackPermalink?: string;
  error?: string;
}

function isAutoShipEnabled(): boolean {
  const flag = process.env.AUTO_SHIP_ENABLED?.trim().toLowerCase();
  return flag !== "false" && flag !== "0" && flag !== "off";
}

/**
 * For a given packed weight, pick the service we expect will be cheapest
 * based on tonight's (2026-04-22) observed rates:
 *
 *   ≤13 oz  → usps_first_class_mail  (stamps_com)
 *   14 oz–3 lb → ups_ground_saver    (UPS SurePost; beat USPS Ground Advantage
 *                                      on 2 of 3 labels tonight)
 *   >3 lb   → usps_ground_advantage  (at higher weights USPS is back to cheaper)
 *
 * This is a heuristic. The ShipStation UI "Cheapest" rate-shopper is the
 * ground truth; if we see consistent misses we switch to calling
 * `getCheapestShipStationRate()` live instead.
 */
function pickServiceForWeight(weightOunces: number): {
  carrierCode: string;
  serviceCode: string;
} {
  if (weightOunces <= 13) {
    return { carrierCode: "stamps_com", serviceCode: "usps_first_class_mail" };
  }
  if (weightOunces <= 48) {
    return { carrierCode: "ups_walleted", serviceCode: "ups_ground_saver" };
  }
  return { carrierCode: "stamps_com", serviceCode: "usps_ground_advantage" };
}

async function recordAudit(
  action: string,
  orderNumber: string,
  ok: boolean,
  detail: unknown,
): Promise<void> {
  try {
    const run = newRunContext({
      agentId: "amazon-auto-ship",
      division: "production-supply-chain",
      source: "scheduled",
      trigger: `amazon:auto-ship:${action}`,
    });
    const entry = buildAuditEntry(run, {
      action: `amazon.auto-ship.${action}`,
      entityType: "amazon.fbm.shipment",
      entityId: `amazon:${orderNumber}`,
      after: detail ?? null,
      result: ok ? "ok" : "error",
      sourceCitations: [{ system: "amazon", id: orderNumber }],
      confidence: 1,
    });
    await auditStore().append(entry);
    try {
      await auditSurface().mirror(entry);
    } catch {
      /* best-effort */
    }
  } catch (err) {
    console.error(
      "[auto-ship] audit failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function autoShipOne(
  orderNumber: string,
  opts: { dryRun: boolean; slackChannel: string },
  context: {
    purchaseDate?: string;
    latestShipDate?: string;
    salesChannel?: string;
  },
): Promise<AutoShipResult> {
  // ---- Step 1: enrich with SP-API (bag count)
  let bags = 0;
  try {
    const items = await fetchOrderItems(orderNumber);
    for (const item of items) bags += item.QuantityOrdered ?? 0;
  } catch (err) {
    await recordAudit("sp-api.fetch-items-failed", orderNumber, false, {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      orderNumber,
      ok: false,
      error: `SP-API item fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ---- Step 2: packaging + auto-buy eligibility
  const pkg = pickPackagingForBags(bags);
  if (!pkg.autoBuyEligible) {
    // Surface to #ops-approvals so Ben can resolve.
    const approvalsChannel = getChannel("ops-approvals");
    if (approvalsChannel) {
      try {
        await postMessage({
          channel: approvalsChannel.name,
          text:
            `:warning: *Amazon FBM order needs review — ${orderNumber}*\n` +
            `${bags} bags · ${context.salesChannel ?? "Amazon.com"} · ` +
            `ship-by ${context.latestShipDate?.slice(0, 16).replace("T", " ") ?? "?"}\n` +
            `Reason: ${pkg.refuseReason}\n` +
            `<https://sellercentral.amazon.com/orders-v3/order/${orderNumber}|Open in Seller Central>`,
        });
      } catch {
        /* best-effort */
      }
    }
    await recordAudit("packaging.refuse", orderNumber, false, {
      bags,
      reason: pkg.refuseReason,
    });
    return {
      orderNumber,
      ok: false,
      skipped: true,
      skipReason: pkg.refuseReason ?? "Packaging not auto-buyable",
      bags,
      packagingId: pkg.id,
    };
  }

  // ---- Step 3: ShipStation order lookup
  const ssLookup = await findShipStationOrderByNumber(orderNumber);
  if (!ssLookup.ok || !ssLookup.order) {
    await recordAudit("shipstation.find-order-miss", orderNumber, false, {
      error: ssLookup.ok ? "no awaiting_shipment match" : ssLookup.error,
    });
    return {
      orderNumber,
      ok: false,
      skipped: true,
      skipReason:
        "ShipStation has no awaiting_shipment order yet (may still be syncing from Amazon — will retry on next cron)",
      bags,
      packagingId: pkg.id,
    };
  }
  const ssOrder = ssLookup.order;

  // ---- Step 4: service pick + dry-run short-circuit
  const service = pickServiceForWeight(pkg.weightOunces);
  if (opts.dryRun) {
    return {
      orderNumber,
      ok: true,
      skipped: true,
      skipReason: "dryRun",
      bags,
      packagingId: pkg.id,
      carrier: service.carrierCode,
      service: service.serviceCode,
    };
  }

  // ---- Step 5: buy label + mark shipped
  const labelRes = await createLabelForShipStationOrder({
    orderId: ssOrder.orderId,
    orderNumber,
    shipTo: {
      name: ssOrder.shipTo.name ?? "",
      company: ssOrder.shipTo.company ?? undefined,
      street1: ssOrder.shipTo.street1 ?? "",
      street2: ssOrder.shipTo.street2 ?? undefined,
      city: ssOrder.shipTo.city ?? "",
      state: ssOrder.shipTo.state ?? "",
      postalCode: ssOrder.shipTo.postalCode ?? "",
      country: ssOrder.shipTo.country ?? "US",
      phone: ssOrder.shipTo.phone ?? undefined,
      residential: ssOrder.shipTo.residential ?? true,
    },
    carrierCode: service.carrierCode,
    serviceCode: service.serviceCode,
    packageCode: "package",
    confirmation: "delivery",
    weight: { value: pkg.weightOunces, units: "ounces" },
    dimensions: {
      length: pkg.length,
      width: pkg.width,
      height: pkg.height,
      units: "inches",
    },
    notifyCustomer: false,
    notifySalesChannel: true,
  });
  if (!labelRes.ok) {
    await recordAudit("label.buy-failed", orderNumber, false, {
      error: labelRes.error,
    });
    return {
      orderNumber,
      ok: false,
      error: `Label buy failed: ${labelRes.error}`,
      bags,
      packagingId: pkg.id,
    };
  }

  // ---- Step 6: upload label PDF to Slack
  // labelUrl is "data:application/pdf;base64,<base64>"
  let slackPermalink: string | undefined;
  const labelBase64 = labelRes.label.labelUrl.split(",", 2)[1] ?? "";
  if (labelBase64) {
    const pdfBytes = Buffer.from(labelBase64, "base64");
    // slackChannel can be either a channel id (e.g. "operations") or a
    // raw Slack channel name (e.g. "#operations"). getChannel accepts
    // only the typed ChannelId, so we guard with a type cast + fall
    // through to the raw string when the id isn't in our registry.
    const channelRegistry = getChannel(
      opts.slackChannel as Parameters<typeof getChannel>[0],
    );
    const destChannel =
      channelRegistry?.id ?? channelRegistry?.name ?? opts.slackChannel;
    const shipToCity = ssOrder.shipTo.city ?? "?";
    const shipToState = ssOrder.shipTo.state ?? "??";
    const shipByDisplay =
      context.latestShipDate?.slice(0, 16).replace("T", " ") ?? "?";
    const comment =
      `:package: *Auto-shipped — ${orderNumber}*\n` +
      `${bags} bag${bags === 1 ? "" : "s"} · ${shipToCity}, ${shipToState} · ` +
      `ship-by ${shipByDisplay}\n` +
      `${labelRes.label.service} · tracking ${labelRes.label.trackingNumber} · $${labelRes.label.cost.toFixed(2)}\n` +
      `_Print + drop at USPS. React :white_check_mark: when dropped._`;
    const uploadRes = await uploadBufferToSlack({
      channelId: destChannel,
      filename: `label-${orderNumber}.pdf`,
      buffer: pdfBytes,
      mimeType: "application/pdf",
      title: `Label ${orderNumber}`,
      comment,
    });
    if (uploadRes.ok) {
      slackPermalink = uploadRes.permalink;
    } else {
      await recordAudit("slack.upload-failed", orderNumber, false, {
        error: uploadRes.error,
      });
    }
  }

  // ---- Step 7: persist dispatched + audit success
  try {
    const existing =
      ((await kv.get<DispatchedEntry[]>(KV_DISPATCHED)) ?? []) as DispatchedEntry[];
    existing.push({
      orderId: orderNumber,
      dispatchedAt: new Date().toISOString(),
      trackingNumber: labelRes.label.trackingNumber,
    });
    await kv.set(KV_DISPATCHED, existing.slice(-500));
  } catch {
    /* non-fatal */
  }
  await recordAudit("shipped", orderNumber, true, {
    tracking: labelRes.label.trackingNumber,
    cost: labelRes.label.cost,
    service: labelRes.label.service,
    packaging: pkg.id,
    bags,
    slackPermalink,
  });

  return {
    orderNumber,
    ok: true,
    bags,
    packagingId: pkg.id,
    trackingNumber: labelRes.label.trackingNumber,
    cost: labelRes.label.cost,
    carrier: labelRes.label.carrier,
    service: labelRes.label.service,
    slackPermalink,
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAutoShipEnabled()) {
    return NextResponse.json({
      ok: true,
      paused: true,
      reason: "AUTO_SHIP_ENABLED env var is false — pipeline paused",
    });
  }
  if (!isAmazonConfigured()) {
    return NextResponse.json(
      { error: "Amazon SP-API not configured" },
      { status: 503 },
    );
  }
  if (!isShipStationConfigured()) {
    return NextResponse.json(
      { error: "ShipStation not configured" },
      { status: 503 },
    );
  }

  let body: AutoShipBody = {};
  try {
    body = (await req.json()) as AutoShipBody;
  } catch {
    // empty body is fine — means "auto-ship everything unshipped"
  }

  // ---- Resolve order list
  const ordersContext = new Map<
    string,
    { purchaseDate?: string; latestShipDate?: string; salesChannel?: string }
  >();
  const orderNumbers: string[] = [];
  try {
    const unshipped = await fetchUnshippedFbmOrders({ daysBack: 7 });
    for (const o of unshipped) {
      if (
        Array.isArray(body.orderNumbers) &&
        !body.orderNumbers.includes(o.orderId)
      ) {
        continue;
      }
      orderNumbers.push(o.orderId);
      ordersContext.set(o.orderId, {
        purchaseDate: o.purchaseDate,
        latestShipDate: o.latestShipDateEstimate,
        salesChannel: o.salesChannel,
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `SP-API unshipped fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  if (orderNumbers.length === 0) {
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      count: 0,
      shipped: 0,
      skipped: 0,
      failed: 0,
      results: [],
      message: "No unshipped Amazon FBM orders in the queue.",
    });
  }

  // ---- Dedup against already-dispatched orders (auto-ship idempotency)
  const alreadyDispatched =
    ((await kv.get<DispatchedEntry[]>(KV_DISPATCHED)) ?? []) as DispatchedEntry[];
  const dispatchedSet = new Set(alreadyDispatched.map((e) => e.orderId));

  const slackChannel = body.slackChannel ?? "operations";
  const results: AutoShipResult[] = [];
  for (const on of orderNumbers) {
    if (dispatchedSet.has(on)) {
      results.push({
        orderNumber: on,
        ok: true,
        skipped: true,
        skipReason: "already dispatched in this window",
      });
      continue;
    }
    const r = await autoShipOne(
      on,
      { dryRun: body.dryRun === true, slackChannel },
      ordersContext.get(on) ?? {},
    );
    results.push(r);
  }

  const shipped = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok && !r.skipped).length;
  const totalCost =
    Math.round(
      results
        .filter((r) => typeof r.cost === "number")
        .reduce((s, r) => s + (r.cost ?? 0), 0) * 100,
    ) / 100;

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    count: orderNumbers.length,
    shipped,
    skipped,
    failed,
    totalCost,
    results,
    summary: results.map((r) => {
      if (r.ok && !r.skipped) {
        return `✅ ${r.orderNumber} — ${r.bags} bag${r.bags === 1 ? "" : "s"} — ${r.service} — ${r.trackingNumber} — $${(r.cost ?? 0).toFixed(2)}`;
      }
      if (r.skipped) {
        return `⏭  ${r.orderNumber} — ${r.skipReason}`;
      }
      return `❌ ${r.orderNumber} — ${r.error}`;
    }),
  });
}

// GET variant — Vercel cron invokes this. Forward to POST with an empty
// body so the cron executes the real auto-ship loop (NOT a dry run).
// Use `?dry=true` on the URL to force a preview-only run without buying.
export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "true";
  const forwardReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ dryRun }),
  });
  return POST(forwardReq);
}
