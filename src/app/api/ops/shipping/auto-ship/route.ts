/**
 * POST /api/ops/shipping/auto-ship
 *
 * The unified auto-ship pipeline — channel-agnostic. Polls ShipStation's
 * `awaiting_shipment` queue across ALL connected stores (Amazon FBM,
 * Shopify DTC, manual orders, Faire when wired), and for every order
 * that fits a canonical packaging profile, auto-buys the label + drops
 * the PDF into Slack.
 *
 * Why this primitive exists: ShipStation is already the single-pane
 * queue. Amazon integration pushes orders in, Shopify integration
 * pushes orders in, and every channel-specific sync handles ship-to
 * PII + buyer contact before we ever see the order. So the pipeline
 * doesn't need to branch by channel — just iterate awaiting_shipment
 * and ship.
 *
 * Per Ben's 2026-04-23 spec:
 *   • Auto-buy when packaging is obvious (1-4 bags mailer, 5-12 box,
 *     36 master carton).
 *   • Surface anything else to `#ops-approvals` for human review.
 *   • Drop label PDF into Slack for phone-visible self-accountability.
 *   • Everything gets logged to `#ops-audit`.
 *
 * Flow per order:
 *   1. Dedup against `shipping:auto-shipped` KV.
 *   2. Resolve bag count from order items via `totalBagsForItems`
 *      (handles Amazon's USG-FBM-* and Shopify's USG-* SKUs).
 *   3. Ask `pickPackagingForBags` — if not auto-buyable, refuse +
 *      surface to #ops-approvals.
 *   4. Pick service for weight (First-Class / Ground Saver / Ground Advantage).
 *   5. `createLabelForShipStationOrder` — buys label + marks shipped +
 *      syncs tracking back to the source marketplace.
 *   6. Extract page 1 of the 2-page PDF (skip the packing slip page).
 *   7. Upload to Slack #operations (or configured channel) with
 *      one-line summary.
 *   8. Persist to dedup KV + audit.
 *
 * Kill switch: `AUTO_SHIP_ENABLED=false`.
 * Auth: session OR bearer CRON_SECRET. Primary caller is the Vercel cron.
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
  createLabelForShipStationOrder,
  isShipStationConfigured,
  listOrdersAwaitingShipment,
  type ShipStationOrderSummary,
} from "@/lib/ops/shipstation-client";
import {
  pickPackagingForBags,
  totalBagsForItems,
} from "@/lib/ops/shipping-packaging";
import { uploadBufferToSlack } from "@/lib/ops/slack-file-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_AUTO_SHIPPED = "shipping:auto-shipped";

interface AutoShippedEntry {
  orderNumber: string;
  source: string;
  dispatchedAt: string;
  trackingNumber?: string | null;
}

interface UnifiedAutoShipBody {
  /** Only process orders for a given store id (optional). */
  storeId?: number;
  /** Specific order numbers to restrict to. Default = all awaiting shipment. */
  orderNumbers?: string[];
  /** Preview only — pick plan but don't buy. */
  dryRun?: boolean;
  /** Override the target Slack channel (default: operations). */
  slackChannel?: string;
  /** Cap the batch size — protects against runaway buys if something goes wrong. */
  maxOrders?: number;
}

interface UnifiedAutoShipResult {
  orderNumber: string;
  source: string;
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
 * Identify the source channel from a ShipStation order's advancedOptions.
 * `source` / `storeId` are what we have to work with — maps to a human
 * label so Slack + audit entries read naturally.
 */
function sourceLabelFor(order: ShipStationOrderSummary): string {
  const source = order.advancedOptions.source?.toLowerCase() ?? "";
  if (source.includes("amazon")) return "amazon";
  if (source.includes("shopify")) return "shopify";
  if (source.includes("faire")) return "faire";
  if (order.advancedOptions.storeId) return `store:${order.advancedOptions.storeId}`;
  return "manual";
}

function sellerCentralUrlFor(
  source: string,
  orderNumber: string,
): string | null {
  if (source === "amazon") {
    return `https://sellercentral.amazon.com/orders-v3/order/${orderNumber}`;
  }
  // Shopify order numbers vary by format — not always a stable deeplink.
  return null;
}

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
  source: string,
  ok: boolean,
  detail: unknown,
): Promise<void> {
  try {
    const run = newRunContext({
      agentId: "shipping-auto-ship",
      division: "production-supply-chain",
      source: "scheduled",
      trigger: `shipping:auto-ship:${action}`,
    });
    const entry = buildAuditEntry(run, {
      action: `shipping.auto-ship.${action}`,
      entityType: "shipping.shipment",
      entityId: `${source}:${orderNumber}`,
      after: detail ?? null,
      result: ok ? "ok" : "error",
      sourceCitations: [{ system: source, id: orderNumber }],
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
      "[shipping-auto-ship] audit failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function autoShipOrder(
  order: ShipStationOrderSummary,
  opts: { dryRun: boolean; slackChannel: string },
): Promise<UnifiedAutoShipResult> {
  const source = sourceLabelFor(order);
  const bags = totalBagsForItems(order.items);

  // Packaging eligibility
  const pkg = pickPackagingForBags(bags);
  if (!pkg.autoBuyEligible) {
    const approvalsChannel = getChannel("ops-approvals");
    if (approvalsChannel) {
      const deeplink = sellerCentralUrlFor(source, order.orderNumber);
      const link = deeplink ? `\n<${deeplink}|Open in Seller Central>` : "";
      try {
        await postMessage({
          channel: approvalsChannel.name,
          text:
            `:warning: *Order needs shipping review — ${order.orderNumber}* (${source})\n` +
            `${bags} bags · ${order.shipTo.city ?? "?"}, ${order.shipTo.state ?? "??"}\n` +
            `Reason: ${pkg.refuseReason}${link}`,
        });
      } catch {
        /* best-effort */
      }
    }
    await recordAudit("packaging.refuse", order.orderNumber, source, false, {
      bags,
      reason: pkg.refuseReason,
    });
    return {
      orderNumber: order.orderNumber,
      source,
      ok: false,
      skipped: true,
      skipReason: pkg.refuseReason ?? "Packaging not auto-buyable",
      bags,
      packagingId: pkg.id,
    };
  }

  const service = pickServiceForWeight(pkg.weightOunces);
  if (opts.dryRun) {
    return {
      orderNumber: order.orderNumber,
      source,
      ok: true,
      skipped: true,
      skipReason: "dryRun",
      bags,
      packagingId: pkg.id,
      carrier: service.carrierCode,
      service: service.serviceCode,
    };
  }

  // Must have a ship-to with street + ZIP. If ShipStation's sync hasn't
  // populated those yet, surface for review — don't auto-buy with partial
  // data.
  if (
    !order.shipTo.street1 ||
    !order.shipTo.postalCode ||
    !order.shipTo.state
  ) {
    await recordAudit("shipto.incomplete", order.orderNumber, source, false, {
      shipTo: order.shipTo,
    });
    return {
      orderNumber: order.orderNumber,
      source,
      ok: false,
      skipped: true,
      skipReason:
        "Ship-to missing street/state/ZIP — ShipStation sync may still be catching up. Will retry.",
      bags,
      packagingId: pkg.id,
    };
  }

  const labelRes = await createLabelForShipStationOrder({
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    shipTo: {
      name: order.shipTo.name ?? "",
      company: order.shipTo.company ?? undefined,
      street1: order.shipTo.street1,
      street2: order.shipTo.street2 ?? undefined,
      city: order.shipTo.city ?? "",
      state: order.shipTo.state,
      postalCode: order.shipTo.postalCode,
      country: order.shipTo.country ?? "US",
      phone: order.shipTo.phone ?? undefined,
      residential: order.shipTo.residential ?? true,
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
    await recordAudit("label.buy-failed", order.orderNumber, source, false, {
      error: labelRes.error,
    });
    return {
      orderNumber: order.orderNumber,
      source,
      ok: false,
      error: `Label buy failed: ${labelRes.error}`,
      bags,
      packagingId: pkg.id,
    };
  }

  // Upload label (page 1 only — strip packing slip) to Slack.
  let slackPermalink: string | undefined;
  const labelBase64 = labelRes.label.labelUrl.split(",", 2)[1] ?? "";
  if (labelBase64) {
    try {
      const pdfBytes = Buffer.from(labelBase64, "base64");
      const labelOnlyBytes = await stripPackingSlipPage(pdfBytes);
      const channelRegistry = getChannel(
        opts.slackChannel as Parameters<typeof getChannel>[0],
      );
      const destChannel =
        channelRegistry?.id ?? channelRegistry?.name ?? opts.slackChannel;
      const sourceEmoji =
        source === "amazon"
          ? ":amazon-color:"
          : source === "shopify"
            ? ":shopify-color:"
            : ":package:";
      const comment =
        `${sourceEmoji} *Auto-shipped — ${order.orderNumber}* (${source})\n` +
        `${bags} bag${bags === 1 ? "" : "s"} · ${order.shipTo.city}, ${order.shipTo.state}\n` +
        `${labelRes.label.service} · tracking ${labelRes.label.trackingNumber} · $${labelRes.label.cost.toFixed(2)}\n` +
        `_Print + drop at USPS. React :white_check_mark: when dropped._`;
      const uploadRes = await uploadBufferToSlack({
        channelId: destChannel,
        filename: `label-${order.orderNumber}.pdf`,
        buffer: labelOnlyBytes,
        mimeType: "application/pdf",
        title: `Label ${order.orderNumber}`,
        comment,
      });
      if (uploadRes.ok) {
        slackPermalink = uploadRes.permalink;
      } else {
        await recordAudit("slack.upload-failed", order.orderNumber, source, false, {
          error: uploadRes.error,
        });
      }
    } catch (err) {
      await recordAudit("slack.upload-exception", order.orderNumber, source, false, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Persist + audit success
  try {
    const existing =
      ((await kv.get<AutoShippedEntry[]>(KV_AUTO_SHIPPED)) ?? []) as AutoShippedEntry[];
    existing.push({
      orderNumber: order.orderNumber,
      source,
      dispatchedAt: new Date().toISOString(),
      trackingNumber: labelRes.label.trackingNumber,
    });
    await kv.set(KV_AUTO_SHIPPED, existing.slice(-1000));
  } catch {
    /* non-fatal */
  }
  await recordAudit("shipped", order.orderNumber, source, true, {
    tracking: labelRes.label.trackingNumber,
    cost: labelRes.label.cost,
    service: labelRes.label.service,
    packaging: pkg.id,
    bags,
    slackPermalink,
  });

  return {
    orderNumber: order.orderNumber,
    source,
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

/**
 * ShipStation's label download is a 2-page PDF: page 1 = label,
 * page 2 = packing slip. We only want the label — page 2 wastes thermal
 * media on wrong content (learned the hard way 2026-04-22).
 *
 * Uses pypdf-equivalent via the pure-JS `pdf-lib` if available, else
 * falls back to returning the full PDF (still better than failing the
 * upload). In practice pdf-lib ships with Next.js; we just import it
 * dynamically to keep the cold-start lean.
 */
async function stripPackingSlipPage(pdfBytes: Buffer): Promise<Buffer> {
  try {
    // Dynamic import so we don't pull pdf-lib into every cold start.
    const { PDFDocument } = await import("pdf-lib");
    const src = await PDFDocument.load(pdfBytes);
    if (src.getPageCount() < 2) return pdfBytes; // single-page — already label only
    const dest = await PDFDocument.create();
    const [labelPage] = await dest.copyPages(src, [0]);
    dest.addPage(labelPage);
    const outBytes = await dest.save();
    return Buffer.from(outBytes);
  } catch (err) {
    console.warn(
      "[shipping-auto-ship] stripPackingSlipPage failed, returning full PDF:",
      err instanceof Error ? err.message : String(err),
    );
    return pdfBytes;
  }
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
  if (!isShipStationConfigured()) {
    return NextResponse.json(
      { error: "ShipStation not configured" },
      { status: 503 },
    );
  }

  let body: UnifiedAutoShipBody = {};
  try {
    body = (await req.json()) as UnifiedAutoShipBody;
  } catch {
    // empty body = default auto-ship-everything behavior
  }

  // 1. Pull awaiting-shipment queue
  const listRes = await listOrdersAwaitingShipment({
    storeId: body.storeId,
    pageSize: 200,
  });
  if (!listRes.ok) {
    return NextResponse.json(
      { ok: false, error: `ShipStation list failed: ${listRes.error}` },
      { status: 502 },
    );
  }
  let queue = listRes.orders;
  if (Array.isArray(body.orderNumbers) && body.orderNumbers.length > 0) {
    const wanted = new Set(body.orderNumbers);
    queue = queue.filter((o) => wanted.has(o.orderNumber));
  }
  if (typeof body.maxOrders === "number" && body.maxOrders > 0) {
    queue = queue.slice(0, body.maxOrders);
  }

  if (queue.length === 0) {
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      count: 0,
      shipped: 0,
      skipped: 0,
      failed: 0,
      results: [],
      message: "Awaiting-shipment queue is empty.",
    });
  }

  // 2. Dedup against already auto-shipped
  const alreadyShipped =
    ((await kv.get<AutoShippedEntry[]>(KV_AUTO_SHIPPED)) ?? []) as AutoShippedEntry[];
  // Only consider recent (last 7 days) entries — after that we don't
  // care if the same orderNumber somehow re-surfaces.
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const recentSet = new Set(
    alreadyShipped
      .filter((e) => new Date(e.dispatchedAt).getTime() > cutoff)
      .map((e) => `${e.source}:${e.orderNumber}`),
  );

  const slackChannel = body.slackChannel ?? "operations";
  const results: UnifiedAutoShipResult[] = [];
  for (const order of queue) {
    const source = sourceLabelFor(order);
    if (recentSet.has(`${source}:${order.orderNumber}`)) {
      results.push({
        orderNumber: order.orderNumber,
        source,
        ok: true,
        skipped: true,
        skipReason: "already auto-shipped within 7d window",
      });
      continue;
    }
    const r = await autoShipOrder(order, {
      dryRun: body.dryRun === true,
      slackChannel,
    });
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
  const byChannel = results.reduce<Record<string, number>>((acc, r) => {
    if (r.ok && !r.skipped) acc[r.source] = (acc[r.source] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    count: queue.length,
    shipped,
    skipped,
    failed,
    totalCost,
    byChannel,
    results,
    summary: results.map((r) => {
      if (r.ok && !r.skipped) {
        return `✅ ${r.orderNumber} (${r.source}) — ${r.bags} bag${r.bags === 1 ? "" : "s"} — ${r.service} — ${r.trackingNumber} — $${(r.cost ?? 0).toFixed(2)}`;
      }
      if (r.skipped) {
        return `⏭  ${r.orderNumber} (${r.source}) — ${r.skipReason}`;
      }
      return `❌ ${r.orderNumber} (${r.source}) — ${r.error}`;
    }),
  });
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "true";
  const storeId = url.searchParams.get("storeId");
  const forwardReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({
      dryRun,
      storeId: storeId ? Number(storeId) : undefined,
    }),
  });
  return POST(forwardReq);
}
