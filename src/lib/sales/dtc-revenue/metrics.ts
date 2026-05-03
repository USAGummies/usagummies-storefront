/**
 * DTC Revenue Commander — pure aggregator over kpi_timeseries rows.
 *
 * Per Ben's 2026-05-03 strategic plan: the DTC Revenue Commander
 * gives Ben a daily pulse on usagummies.com performance — not just
 * "what was yesterday's revenue?" (the morning brief already covers
 * that) but "is the trend getting better or worse?".
 *
 * Inputs: a 14-day window of daily KPI rows pulled by the route from
 * Supabase `kpi_timeseries` (already populated by the kpi-collector
 * cron). Output: a structured digest the summarizer can render to
 * Slack mrkdwn.
 *
 * No I/O. The route handles the Supabase fetch; this module is a
 * pure transformer.
 */

export interface DtcDailyMetric {
  /** YYYY-MM-DD. */
  date: string;
  shopifyRevenue: number | null;
  shopifyOrders: number | null;
  amazonRevenue: number | null;
  amazonOrders: number | null;
}

export interface DailyRollup {
  date: string;
  shopifyRevenue: number | null;
  shopifyOrders: number | null;
  shopifyAov: number | null;
  amazonRevenue: number | null;
  amazonOrders: number | null;
  amazonAov: number | null;
  totalRevenue: number | null;
}

export interface RevenueWindow {
  /** Sum across the window. Null if no data point is available. */
  shopifyRevenue: number | null;
  shopifyOrders: number | null;
  amazonRevenue: number | null;
  amazonOrders: number | null;
  totalRevenue: number | null;
  /** Average revenue per day (Shopify only). */
  shopifyAvgPerDay: number | null;
}

export interface DtcRevenueDigest {
  /** When the digest was computed. */
  generatedAt: string;
  /** The date the digest is "for" — typically yesterday. */
  yesterday: DailyRollup;
  /** The day before yesterday — for day-over-day delta. */
  dayBefore: DailyRollup;
  /** Same weekday last week — for week-over-week delta. */
  lastWeekSameDay: DailyRollup;
  /** Last 7 days (yesterday-inclusive). */
  last7Days: RevenueWindow;
  /** Month-to-date through yesterday. */
  mtd: RevenueWindow;
  /** Percentage deltas on Shopify revenue, null when comparison base is null/0. */
  shopifyDeltas: {
    dayOverDayPct: number | null;
    weekOverWeekPct: number | null;
  };
  /** Honest unavailable reasons — surfaces what we couldn't compute. */
  degraded: string[];
}

function aov(revenue: number | null, orders: number | null): number | null {
  if (revenue === null || orders === null) return null;
  if (orders === 0) return null;
  return Math.round((revenue / orders) * 100) / 100;
}

function projectRollup(date: string, m: DtcDailyMetric | null): DailyRollup {
  if (!m) {
    return {
      date,
      shopifyRevenue: null,
      shopifyOrders: null,
      shopifyAov: null,
      amazonRevenue: null,
      amazonOrders: null,
      amazonAov: null,
      totalRevenue: null,
    };
  }
  const sRev = m.shopifyRevenue;
  const aRev = m.amazonRevenue;
  const total =
    sRev !== null || aRev !== null ? (sRev ?? 0) + (aRev ?? 0) : null;
  return {
    date,
    shopifyRevenue: sRev,
    shopifyOrders: m.shopifyOrders,
    shopifyAov: aov(m.shopifyRevenue, m.shopifyOrders),
    amazonRevenue: aRev,
    amazonOrders: m.amazonOrders,
    amazonAov: aov(m.amazonRevenue, m.amazonOrders),
    totalRevenue: total,
  };
}

function pctDelta(current: number | null, base: number | null): number | null {
  if (current === null || base === null) return null;
  if (base === 0) return null;
  return Math.round(((current - base) / base) * 1000) / 10;
}

function isoYesterday(asOf: Date): string {
  return new Date(asOf.getTime() - 86_400_000).toISOString().slice(0, 10);
}

function isoOffset(asOf: Date, daysBack: number): string {
  return new Date(asOf.getTime() - daysBack * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  let sum = 0;
  let any = false;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    sum += v;
    any = true;
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

/**
 * Compute the DTC revenue digest from a window of daily KPI rows.
 *
 * @param metrics  Daily KPI rows. Order doesn't matter — function indexes by date.
 *                 Window should include at least 8 days (yesterday + same-day-last-week)
 *                 for full deltas; 30 days for full MTD. Missing dates surface as null.
 * @param asOf     Caller-supplied "now" — typically `new Date()`. The digest is
 *                 computed for `yesterday = asOf - 1d`.
 */
export function aggregateDtcRevenue(
  metrics: readonly DtcDailyMetric[],
  asOf: Date,
): DtcRevenueDigest {
  const byDate = new Map<string, DtcDailyMetric>();
  for (const m of metrics) byDate.set(m.date, m);

  const yDate = isoYesterday(asOf);
  const dbDate = isoOffset(asOf, 2);
  const wowDate = isoOffset(asOf, 8); // same-weekday-last-week

  const yesterday = projectRollup(yDate, byDate.get(yDate) ?? null);
  const dayBefore = projectRollup(dbDate, byDate.get(dbDate) ?? null);
  const lastWeekSameDay = projectRollup(wowDate, byDate.get(wowDate) ?? null);

  // 7-day rolling: yesterday + 6 days prior.
  const last7Dates = Array.from({ length: 7 }, (_, i) =>
    isoOffset(asOf, i + 1),
  );
  const last7Rows = last7Dates.map((d) => byDate.get(d) ?? null);
  const last7Days: RevenueWindow = {
    shopifyRevenue: sumOrNull(last7Rows.map((r) => r?.shopifyRevenue ?? null)),
    shopifyOrders: sumOrNull(last7Rows.map((r) => r?.shopifyOrders ?? null)),
    amazonRevenue: sumOrNull(last7Rows.map((r) => r?.amazonRevenue ?? null)),
    amazonOrders: sumOrNull(last7Rows.map((r) => r?.amazonOrders ?? null)),
    totalRevenue: null,
    shopifyAvgPerDay: null,
  };
  if (last7Days.shopifyRevenue !== null || last7Days.amazonRevenue !== null) {
    last7Days.totalRevenue =
      Math.round(
        ((last7Days.shopifyRevenue ?? 0) + (last7Days.amazonRevenue ?? 0)) * 100,
      ) / 100;
  }
  if (last7Days.shopifyRevenue !== null) {
    // Average over days that had a non-null Shopify revenue value.
    const present = last7Rows.filter(
      (r) => r?.shopifyRevenue !== null && r?.shopifyRevenue !== undefined,
    ).length;
    if (present > 0) {
      last7Days.shopifyAvgPerDay =
        Math.round((last7Days.shopifyRevenue / present) * 100) / 100;
    }
  }

  // MTD: from first-of-month through yesterday. Use Date.UTC to avoid
  // timezone-shift bugs when the runtime is in a non-UTC tz (Vercel
  // happens to be UTC, but tests run in PT and would silently truncate
  // the window without explicit UTC construction).
  const yDateObj = new Date(`${yDate}T00:00:00.000Z`);
  const firstOfMonth = new Date(
    Date.UTC(yDateObj.getUTCFullYear(), yDateObj.getUTCMonth(), 1),
  );
  const mtdDates: string[] = [];
  for (
    let cursor = new Date(firstOfMonth);
    cursor.getTime() <= yDateObj.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    mtdDates.push(cursor.toISOString().slice(0, 10));
  }
  const mtdRows = mtdDates.map((d) => byDate.get(d) ?? null);
  const mtd: RevenueWindow = {
    shopifyRevenue: sumOrNull(mtdRows.map((r) => r?.shopifyRevenue ?? null)),
    shopifyOrders: sumOrNull(mtdRows.map((r) => r?.shopifyOrders ?? null)),
    amazonRevenue: sumOrNull(mtdRows.map((r) => r?.amazonRevenue ?? null)),
    amazonOrders: sumOrNull(mtdRows.map((r) => r?.amazonOrders ?? null)),
    totalRevenue: null,
    shopifyAvgPerDay: null,
  };
  if (mtd.shopifyRevenue !== null || mtd.amazonRevenue !== null) {
    mtd.totalRevenue =
      Math.round(((mtd.shopifyRevenue ?? 0) + (mtd.amazonRevenue ?? 0)) * 100) /
      100;
  }
  if (mtd.shopifyRevenue !== null && mtdDates.length > 0) {
    mtd.shopifyAvgPerDay =
      Math.round((mtd.shopifyRevenue / mtdDates.length) * 100) / 100;
  }

  const shopifyDeltas = {
    dayOverDayPct: pctDelta(yesterday.shopifyRevenue, dayBefore.shopifyRevenue),
    weekOverWeekPct: pctDelta(
      yesterday.shopifyRevenue,
      lastWeekSameDay.shopifyRevenue,
    ),
  };

  const degraded: string[] = [];
  if (yesterday.shopifyRevenue === null) {
    degraded.push(
      `No Shopify revenue row for ${yDate} — kpi-collector may not have run yet.`,
    );
  }
  if (dayBefore.shopifyRevenue === null) {
    degraded.push(`No Shopify revenue row for ${dbDate} (day-over-day base).`);
  }
  if (lastWeekSameDay.shopifyRevenue === null) {
    degraded.push(
      `No Shopify revenue row for ${wowDate} (week-over-week base).`,
    );
  }

  return {
    generatedAt: asOf.toISOString(),
    yesterday,
    dayBefore,
    lastWeekSameDay,
    last7Days,
    mtd,
    shopifyDeltas,
    degraded,
  };
}
