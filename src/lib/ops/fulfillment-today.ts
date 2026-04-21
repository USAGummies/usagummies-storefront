/**
 * Fulfillment "today in review" — backing data for the EOD brief.
 *
 * Queries ShipStation + KV for activity since midnight PT:
 *   - labels bought (count, $ spent, carriers used)
 *   - labels voided (count, $ refund pending)
 *   - freight-comp JEs queued today + posted today
 *
 * Pure read. Called by the daily-brief route when `kind === "eod"`.
 */

import { kv } from "@vercel/kv";

import { getRecentShipments } from "./shipstation-client";

const KV_FREIGHT_COMP_QUEUE = "fulfillment:freight-comp-queue";

interface FreightCompQueueEntry {
  queuedAt: string;
  freightDollars: number;
  status: "queued" | "approved" | "posted" | "rejected";
  approvedAt?: string;
  postedAt?: string;
  rejectedAt?: string;
}

export interface FulfillmentTodaySlice {
  /** ISO timestamp for `since`. */
  sinceIso: string;
  labelsBought: {
    count: number;
    spendDollars: number;
    byCarrier: Record<string, { count: number; dollars: number }>;
  };
  labelsVoided: {
    count: number;
    pendingRefundDollars: number;
  };
  freightCompQueue: {
    queuedToday: { count: number; dollars: number };
    postedToday: { count: number; dollars: number };
    rejectedToday: { count: number; dollars: number };
  };
  /** Any non-fatal degradation during compute. */
  degraded: string[];
}

/**
 * Midnight PT = 08:00 UTC (standard) / 07:00 UTC (DST).
 * We take "today" to mean "since the most recent midnight in
 * America/Los_Angeles". Cheap: convert `now` to LA timezone via
 * Intl.DateTimeFormat, then find the start-of-day UTC equivalent.
 */
function startOfTodayPT(now: Date = new Date()): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value ?? "1970");
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const d = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  // 00:00 PT ~= 07:00 or 08:00 UTC depending on DST. We construct an
  // ISO string with -07:00 or -08:00 offset. Rather than solve DST,
  // just take the LA-date and subtract the current delta between "now
  // in LA" and "now in UTC" at midnight LA — good enough for ±1h.
  // Simpler: build Date at midnight UTC for the LA-date then subtract
  // the timezone offset derived from `now`.
  const laMidnightUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  // Determine the PT→UTC offset at `now` by comparing hour-of-day.
  const offsetMinutes =
    new Date(
      now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
    ).getTime() - now.getTime();
  // offsetMinutes negative for PT (behind UTC).
  return new Date(laMidnightUtc.getTime() - offsetMinutes);
}

export async function computeFulfillmentTodaySlice(
  now: Date = new Date(),
): Promise<FulfillmentTodaySlice> {
  const degraded: string[] = [];
  const startPT = startOfTodayPT(now);
  const sinceIso = startPT.toISOString();

  // ShipStation shipments since today. We pass yesterday as start to
  // cover timezone edges; filter precisely below.
  const yesterday = new Date(startPT.getTime() - 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const res = await getRecentShipments({
    shipDateStart: yesterday,
    includeVoided: true,
    pageSize: 500,
  });
  let shipments = res.ok ? res.shipments : [];
  if (!res.ok) {
    degraded.push(`shipstation: ${res.error}`);
    shipments = [];
  }

  const labelsBought = {
    count: 0,
    spendDollars: 0,
    byCarrier: {} as Record<string, { count: number; dollars: number }>,
  };
  const labelsVoided = { count: 0, pendingRefundDollars: 0 };

  for (const s of shipments) {
    const created = s.createDate ? new Date(s.createDate).getTime() : 0;
    if (!s.voided && created >= startPT.getTime()) {
      labelsBought.count += 1;
      labelsBought.spendDollars += s.shipmentCost ?? 0;
      const key = s.carrierCode ?? "unknown";
      const bucket =
        labelsBought.byCarrier[key] ?? { count: 0, dollars: 0 };
      bucket.count += 1;
      bucket.dollars =
        Math.round((bucket.dollars + (s.shipmentCost ?? 0)) * 100) / 100;
      labelsBought.byCarrier[key] = bucket;
    }
    if (s.voided && s.voidDate) {
      const voidedAt = new Date(s.voidDate).getTime();
      if (voidedAt >= startPT.getTime()) {
        labelsVoided.count += 1;
        labelsVoided.pendingRefundDollars += s.shipmentCost ?? 0;
      }
    }
  }
  labelsBought.spendDollars =
    Math.round(labelsBought.spendDollars * 100) / 100;
  labelsVoided.pendingRefundDollars =
    Math.round(labelsVoided.pendingRefundDollars * 100) / 100;

  // Freight-comp queue — scan all entries for today transitions.
  const queue =
    ((await kv.get<FreightCompQueueEntry[]>(KV_FREIGHT_COMP_QUEUE)) ??
      []) as FreightCompQueueEntry[];
  const todayFilter = (iso: string | undefined): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= startPT.getTime();
  };
  const queuedToday = queue.filter((q) => todayFilter(q.queuedAt));
  const postedToday = queue.filter((q) => todayFilter(q.postedAt));
  const rejectedToday = queue.filter((q) => todayFilter(q.rejectedAt));

  const sumDollars = (xs: FreightCompQueueEntry[]) =>
    Math.round(xs.reduce((a, x) => a + (x.freightDollars || 0), 0) * 100) / 100;

  return {
    sinceIso,
    labelsBought,
    labelsVoided,
    freightCompQueue: {
      queuedToday: {
        count: queuedToday.length,
        dollars: sumDollars(queuedToday),
      },
      postedToday: {
        count: postedToday.length,
        dollars: sumDollars(postedToday),
      },
      rejectedToday: {
        count: rejectedToday.length,
        dollars: sumDollars(rejectedToday),
      },
    },
    degraded,
  };
}
