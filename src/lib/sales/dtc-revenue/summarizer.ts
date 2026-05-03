/**
 * DTC Revenue Commander — Slack mrkdwn renderer. Pure function.
 *
 * Companion to metrics.ts. Takes the aggregated digest shape and turns
 * it into a focused #ops-daily post that adds drill-downs the morning
 * brief doesn't carry: day-over-day delta, week-over-week delta, 7-day
 * rolling, MTD with daily average, AOV, Amazon comparison line.
 *
 * Quiet-collapse: when there's literally no Shopify data anywhere in
 * the window, returns null so the caller skips posting. Returning a
 * "everything is unavailable" line every morning conditions operators
 * to ignore the channel.
 *
 * Honest unavailable rendering: every null cell renders as `—` rather
 * than `$0` (which would look like a real zero). Per the no-fabrication
 * doctrine.
 */

import type { DtcRevenueDigest } from "./metrics";

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtCount(n: number | null): string {
  if (n === null) return "—";
  return String(n);
}

function fmtAov(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDelta(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct >= 0 ? "+" : "";
  const emoji = pct >= 5 ? ":chart_with_upwards_trend:" : pct <= -5 ? ":chart_with_downwards_trend:" : ":heavy_minus_sign:";
  return `${emoji} ${sign}${pct.toFixed(1)}%`;
}

export function composeDtcRevenueDigest(
  digest: DtcRevenueDigest,
): string | null {
  const { yesterday, last7Days, mtd, shopifyDeltas, dayBefore, lastWeekSameDay } = digest;

  // Hard quiet-collapse: every Shopify data point is null. Nothing to say.
  const hasAnyShopify =
    yesterday.shopifyRevenue !== null ||
    last7Days.shopifyRevenue !== null ||
    mtd.shopifyRevenue !== null;
  if (!hasAnyShopify) return null;

  const lines: string[] = [];
  lines.push(
    `:bar_chart: *DTC Revenue Pulse — ${yesterday.date}*`,
  );

  // Yesterday block
  const yShop =
    `*Shopify yesterday:* ${fmtMoney(yesterday.shopifyRevenue)} · ` +
    `${fmtCount(yesterday.shopifyOrders)} order${yesterday.shopifyOrders === 1 ? "" : "s"} · ` +
    `AOV ${fmtAov(yesterday.shopifyAov)}`;
  lines.push(yShop);

  // Deltas
  const dodLabel = dayBefore.shopifyRevenue !== null
    ? ` _(vs ${dayBefore.date}: ${fmtMoney(dayBefore.shopifyRevenue)})_`
    : "";
  const wowLabel = lastWeekSameDay.shopifyRevenue !== null
    ? ` _(vs ${lastWeekSameDay.date}: ${fmtMoney(lastWeekSameDay.shopifyRevenue)})_`
    : "";
  lines.push(
    `*Day-over-day:* ${fmtDelta(shopifyDeltas.dayOverDayPct)}${dodLabel}`,
  );
  lines.push(
    `*Week-over-week:* ${fmtDelta(shopifyDeltas.weekOverWeekPct)}${wowLabel}`,
  );

  // 7-day rolling
  if (last7Days.shopifyRevenue !== null) {
    lines.push(
      `*7-day rolling:* ${fmtMoney(last7Days.shopifyRevenue)}` +
        (last7Days.shopifyAvgPerDay !== null
          ? ` _(avg ${fmtMoney(last7Days.shopifyAvgPerDay)}/day)_`
          : "") +
        ` · ${fmtCount(last7Days.shopifyOrders)} orders`,
    );
  }

  // MTD
  if (mtd.shopifyRevenue !== null) {
    lines.push(
      `*MTD Shopify:* ${fmtMoney(mtd.shopifyRevenue)}` +
        (mtd.shopifyAvgPerDay !== null
          ? ` _(avg ${fmtMoney(mtd.shopifyAvgPerDay)}/day)_`
          : "") +
        ` · ${fmtCount(mtd.shopifyOrders)} orders`,
    );
  }

  // Amazon comparison line — only when present, never fabricated.
  if (yesterday.amazonRevenue !== null || yesterday.amazonOrders !== null) {
    lines.push(
      `_Amazon yesterday for comparison:_ ${fmtMoney(yesterday.amazonRevenue)} · ${fmtCount(yesterday.amazonOrders)} orders · AOV ${fmtAov(yesterday.amazonAov)}`,
    );
  }

  // Honest "what we don't know" footer.
  // GA4 sessions / conversion rate aren't wired server-side; surface
  // that explicitly so a reader doesn't assume we're hiding bad numbers.
  lines.push(
    `_Conversion rate, sessions, ATC: unavailable — GA4 server-side not wired. Pull from GA4 console for now._`,
  );

  if (digest.degraded.length > 0) {
    lines.push("");
    lines.push(`:warning: ${digest.degraded.join(" · ")}`);
  }

  return lines.join("\n");
}
