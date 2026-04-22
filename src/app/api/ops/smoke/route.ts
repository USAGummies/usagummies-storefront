/**
 * GET /api/ops/smoke
 *
 * One-shot smoke test for all the critical 3.0 endpoints. Hits each
 * downstream integration cheaply and reports green/red/degraded per
 * integration so Ben has a single URL for "is the system healthy?".
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { isAmazonConfigured } from "@/lib/amazon/sp-api";
import {
  getBalances,
  isPlaidConfigured,
  isPlaidConnected,
} from "@/lib/finance/plaid";
import { isHubSpotConfigured, listRecentDeals } from "@/lib/ops/hubspot-client";
import {
  isShipStationConfigured,
  listShipStationCarriers,
  listVoidedLabels,
} from "@/lib/ops/shipstation-client";
import {
  KV_INVENTORY_SNAPSHOT,
  type InventorySnapshot,
} from "@/lib/ops/inventory-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = "green" | "yellow" | "red" | "skipped";

interface Check {
  name: string;
  status: Status;
  detail: string;
  elapsedMs: number;
}

async function timed<T>(
  name: string,
  run: () => Promise<{ status: Status; detail: string }>,
): Promise<Check> {
  const t0 = Date.now();
  try {
    const r = await run();
    return { name, status: r.status, detail: r.detail, elapsedMs: Date.now() - t0 };
  } catch (err) {
    return {
      name,
      status: "red",
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - t0,
    };
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks = await Promise.all([
    timed("shipstation.carriers", async () => {
      if (!isShipStationConfigured())
        return { status: "skipped" as const, detail: "creds not configured" };
      const res = await listShipStationCarriers();
      if (!res.ok) return { status: "red" as const, detail: res.error };
      return {
        status: "green" as const,
        detail: `${res.carriers.length} carriers connected`,
      };
    }),
    timed("shipstation.voids", async () => {
      if (!isShipStationConfigured())
        return { status: "skipped" as const, detail: "creds not configured" };
      const res = await listVoidedLabels({ daysBack: 7, staleAfterHours: 72 });
      if (!res.ok) return { status: "red" as const, detail: res.error };
      return {
        status: res.stale.length > 0 ? ("yellow" as const) : ("green" as const),
        detail: `${res.stale.length} stale / ${res.voided.length} voided last 7d`,
      };
    }),
    timed("amazon.sp-api", async () => {
      if (!isAmazonConfigured())
        return { status: "skipped" as const, detail: "SP-API creds not configured" };
      // Don't actually hit Amazon on smoke — the LWA token refresh is
      // ~10s and Amazon rate-limits hard. Just confirm config is present.
      return { status: "green" as const, detail: "creds present, not test-fetched" };
    }),
    timed("plaid.balance", async () => {
      if (!isPlaidConfigured())
        return { status: "skipped" as const, detail: "Plaid not configured" };
      if (!(await isPlaidConnected()))
        return { status: "yellow" as const, detail: "Plaid configured but not connected" };
      const balances = await getBalances();
      return {
        status: balances.length > 0 ? ("green" as const) : ("yellow" as const),
        detail: `${balances.length} account(s)`,
      };
    }),
    timed("hubspot.pipeline", async () => {
      if (!isHubSpotConfigured())
        return { status: "skipped" as const, detail: "token not configured" };
      const deals = await listRecentDeals({ limit: 5 });
      return {
        status: "green" as const,
        detail: `fetched ${deals.length} recent deals`,
      };
    }),
    timed("kv.inventory-snapshot", async () => {
      const snap =
        ((await kv.get<InventorySnapshot>(KV_INVENTORY_SNAPSHOT)) ??
          null) as InventorySnapshot | null;
      if (!snap) return { status: "yellow" as const, detail: "no snapshot in KV" };
      const ageH = Math.round(
        (Date.now() - new Date(snap.generatedAt).getTime()) / 3_600_000,
      );
      return {
        status: ageH > 48 ? ("yellow" as const) : ("green" as const),
        detail: `${snap.rows.length} rows · ${ageH}h old`,
      };
    }),
    timed("kv.freight-comp-queue", async () => {
      const queue =
        ((await kv.get<Array<{ status: string }>>("fulfillment:freight-comp-queue")) ??
          []) as Array<{ status: string }>;
      const queued = queue.filter((q) => q.status === "queued").length;
      return {
        status: queued > 10 ? ("yellow" as const) : ("green" as const),
        detail: `${queued} queued · ${queue.length} total in KV`,
      };
    }),
    timed("kv.stages", async () => {
      const stages =
        ((await kv.get<Record<string, unknown>>("fulfillment:stages")) ??
          {}) as Record<string, unknown>;
      return {
        status: "green" as const,
        detail: `${Object.keys(stages).length} stage entries`,
      };
    }),
    timed("kv.dispatch-retry-queue", async () => {
      const { pendingRetryCount, exhaustedRetryCount } = await import(
        "@/lib/ops/dispatch-retry-queue"
      );
      const pending = await pendingRetryCount();
      const exhausted = await exhaustedRetryCount();
      if (exhausted > 0) {
        return {
          status: "red" as const,
          detail: `${exhausted} exhausted dispatches pending manual review · ${pending} retrying`,
        };
      }
      if (pending > 5) {
        return {
          status: "yellow" as const,
          detail: `${pending} pending retries (Slack outage suspected)`,
        };
      }
      return {
        status: "green" as const,
        detail: pending === 0 ? "queue empty" : `${pending} pending (retrying)`,
      };
    }),
  ]);

  const summary = checks.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    },
    { green: 0, yellow: 0, red: 0, skipped: 0 } as Record<Status, number>,
  );
  const overall: Status =
    summary.red > 0 ? "red" : summary.yellow > 0 ? "yellow" : "green";

  return NextResponse.json({
    ok: overall !== "red",
    overall,
    summary,
    generatedAt: new Date().toISOString(),
    checks,
  });
}
