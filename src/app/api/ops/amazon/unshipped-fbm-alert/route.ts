/**
 * GET /api/ops/amazon/unshipped-fbm-alert
 *
 * Amazon FBM (Merchant-Fulfilled) unshipped-order alerting. Starting
 * 2026-04-21, Ben ships single-bag Amazon FBM orders in our branded
 * mailer from Ashford. Amazon's handling-time promise is ≤2 business
 * days, so late shipments cost us the Prime badge + account health.
 *
 * This endpoint:
 *   1. Polls SP-API for every MFN order in Unshipped / PartiallyShipped
 *   2. Deduplicates against the `amazon:fbm:alerted` KV list so a given
 *      order only fires an alert once (no Slack spam every 2 hours)
 *   3. Posts a fresh batch to `#operations` with: Order ID, purchase
 *      time, ship-by deadline, Seller Central deeplink, units
 *   4. Flags any order whose latest-ship-date is within 12h with a
 *      :rotating_light: so Ben sees urgency
 *
 * Cron: business hours (09:00, 13:00, 16:00 PT = 16:00, 20:00, 23:00
 * UTC) weekdays. Evening / weekend scans cover Prime 2-day coverage.
 *
 * Auth: bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isCronAuthorized, unauthorized } from "@/lib/ops/control-plane/admin-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  fetchUnshippedFbmOrders,
  isAmazonConfigured,
  type UnshippedFbmOrder,
} from "@/lib/amazon/sp-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KV_ALERTED_IDS = "amazon:fbm:alerted";
const KV_DISPATCHED = "amazon:fbm:dispatched";
const ALERT_URGENT_HOURS = 12;
const DEDUPE_WINDOW_DAYS = 3;

interface AlertedEntry {
  orderId: string;
  alertedAt: string;
}
interface DispatchedEntry {
  orderId: string;
  dispatchedAt: string;
}

function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

export async function GET(req: Request): Promise<Response> {
  if (!isCronAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const shouldPost = url.searchParams.get("post") !== "false";
  const degraded: string[] = [];

  if (!isAmazonConfigured()) {
    return NextResponse.json({
      ok: false,
      degraded: "Amazon SP-API not configured",
    });
  }

  let orders: UnshippedFbmOrder[];
  try {
    orders = await fetchUnshippedFbmOrders({ daysBack: 7 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `SP-API fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  // Dedupe against recent alerts. Expire entries older than 3 days.
  const now = Date.now();
  const existing =
    ((await kv.get<AlertedEntry[]>(KV_ALERTED_IDS)) ?? []) as AlertedEntry[];
  const dispatched =
    ((await kv.get<DispatchedEntry[]>(KV_DISPATCHED)) ?? []) as DispatchedEntry[];
  const cutoff = now - DEDUPE_WINDOW_DAYS * 24 * 3600 * 1000;
  const stillValid = existing.filter(
    (e) => new Date(e.alertedAt).getTime() > cutoff,
  );
  const alertedSet = new Set(stillValid.map((e) => e.orderId));
  const dispatchedSet = new Set(dispatched.map((e) => e.orderId));

  const fresh = orders.filter((o) => !alertedSet.has(o.orderId));
  const urgent = orders.filter(
    (o) => hoursUntil(o.latestShipDateEstimate) < ALERT_URGENT_HOURS,
  );

  // Always re-alert urgent orders (even if previously alerted). Urgent
  // beats dedupe — if Ben hasn't shipped it yet and it's <12h from
  // ship-by, ping again.
  const toAlert = Array.from(
    new Map(
      [...fresh, ...urgent].map((o) => [o.orderId, o]),
    ).values(),
  );

  let posted = false;
  let postedTo: string | null = null;

  if (shouldPost && toAlert.length > 0) {
    const channel = getChannel("operations");
    if (!channel) {
      degraded.push("slack: #operations channel not registered");
    } else {
      const lines: string[] = [
        `:package: *Amazon FBM queue — ${toAlert.length} unshipped order(s)*`,
        `_Ship from Ashford in the branded mailer. Handling promise ≤ 2 business days._`,
        "",
      ];
      for (const o of toAlert.slice(0, 25)) {
        const hoursLeft = hoursUntil(o.latestShipDateEstimate);
        const isDispatched = dispatchedSet.has(o.orderId);
        const icon = isDispatched
          ? ":outbox_tray:"
          : hoursLeft < ALERT_URGENT_HOURS
            ? ":rotating_light:"
            : "•";
        const urgencyTag = isDispatched
          ? " *DISPATCHED — awaiting physical ship*"
          : hoursLeft < 0
            ? " *LATE*"
            : hoursLeft < ALERT_URGENT_HOURS
              ? ` *${Math.round(hoursLeft)}h left*`
              : ` (${Math.round(hoursLeft)}h to ship-by)`;
        lines.push(
          `${icon} \`${o.orderId}\` · ${o.numberOfItemsUnshipped} unit(s) · $${o.amount.toFixed(2)} · ${o.salesChannel}${urgencyTag}`,
        );
        lines.push(
          `    <${o.sellerCentralUrl}|Open in Seller Central> — purchased ${o.purchaseDate.slice(0, 16).replace("T", " ")}`,
        );
      }
      if (toAlert.length > 25) {
        lines.push(`  … and ${toAlert.length - 25} more`);
      }
      try {
        const res = await postMessage({ channel: channel.name, text: lines.join("\n") });
        if (res.ok) {
          posted = true;
          postedTo = channel.name;
        } else {
          degraded.push("slack-post: not ok");
        }
      } catch (err) {
        degraded.push(
          `slack-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Persist fresh entries to dedupe storage (skip re-alerted urgent ones
  // so they stay re-alertable next scan).
  const newAlerted: AlertedEntry[] = [
    ...stillValid,
    ...fresh.map((o) => ({
      orderId: o.orderId,
      alertedAt: new Date().toISOString(),
    })),
  ];
  await kv.set(KV_ALERTED_IDS, newAlerted);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    totalUnshipped: orders.length,
    freshlyAlerted: fresh.length,
    urgentReAlerted: urgent.filter((o) => alertedSet.has(o.orderId)).length,
    posted,
    postedTo,
    orders: toAlert,
    degraded,
  });
}
