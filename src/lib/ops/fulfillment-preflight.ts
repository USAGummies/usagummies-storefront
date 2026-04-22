/**
 * Fulfillment Preflight — shared helper.
 *
 * The consolidated "can I ship right now?" state. Called by:
 *   - `GET /api/ops/fulfillment/preflight` (returns JSON)
 *   - Ops Agent daily digest (folds alerts into #operations post)
 *   - Executive Brief morning run (future wire)
 *
 * Pure logic, no side-effects. All data comes from KV + ShipStation
 * API; callers supply nothing.
 */

import { kv } from "@vercel/kv";

import {
  KV_INVENTORY_SNAPSHOT,
  type InventorySnapshot,
} from "./inventory-snapshot";
import {
  listShipStationCarriers,
  listVoidedLabels,
} from "./shipstation-client";

const KV_STAGES = "fulfillment:stages";
const KV_FREIGHT_COMP_QUEUE = "fulfillment:freight-comp-queue";

const DEFAULT_FLOORS: Record<string, number> = {
  stamps_com: 100,
  ups_walleted: 150,
  fedex_walleted: 100,
};

function floorFor(carrierCode: string): number {
  const envKey = `SHIPSTATION_WALLET_MIN_${carrierCode.toUpperCase()}`;
  const envVal = process.env[envKey]?.trim();
  if (envVal) {
    const n = Number.parseFloat(envVal);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_FLOORS[carrierCode] ?? 50;
}

export interface FulfillmentPreflight {
  ok: boolean;
  generatedAt: string;
  wallets: Array<{
    carrierCode: string;
    balance: number | null;
    floor: number;
    belowFloor: boolean;
  }>;
  walletDegraded: string | null;
  atp: {
    totalBagsOnHand: number | null;
    pendingOutboundBags: number;
    availableBags: number | null;
    snapshotAgeHours: number | null;
    unavailableReason?: string;
  };
  freightCompQueue: {
    queuedCount: number;
    queuedDollars: number;
    oldestAgeHours: number | null;
  };
  staleVoids: {
    count: number;
    pendingDollars: number;
    oldestAgeHours: number | null;
    unavailableReason?: string;
  };
  alerts: string[];
}

interface StageEntry {
  stage: "received" | "packed" | "ready" | "shipped";
  cartonsRequired: number;
  packagingType?: "mailer" | "case" | "master_carton";
}

interface FreightCompQueueEntry {
  queuedAt: string;
  freightDollars: number;
  status: "queued" | "approved" | "posted" | "rejected";
}

const BAGS_PER_CARTON: Record<"mailer" | "case" | "master_carton", number> = {
  mailer: 1,
  case: 6,
  master_carton: 36,
};

export async function computeFulfillmentPreflight(): Promise<FulfillmentPreflight> {
  const alerts: string[] = [];
  const generatedAt = new Date().toISOString();

  const [walletsRes, voidsRes, stages, snapshot, queue] = await Promise.all([
    listShipStationCarriers(),
    listVoidedLabels({ daysBack: 14, staleAfterHours: 72 }),
    (async () =>
      ((await kv.get<Record<string, StageEntry>>(KV_STAGES)) ?? {}) as Record<
        string,
        StageEntry
      >)(),
    (async () =>
      ((await kv.get<InventorySnapshot>(KV_INVENTORY_SNAPSHOT)) ??
        null) as InventorySnapshot | null)(),
    (async () =>
      ((await kv.get<FreightCompQueueEntry[]>(KV_FREIGHT_COMP_QUEUE)) ??
        []) as FreightCompQueueEntry[])(),
  ]);

  // --- Wallets ---
  let walletDegraded: string | null = null;
  const wallets: FulfillmentPreflight["wallets"] = [];
  if (!walletsRes.ok) {
    walletDegraded = walletsRes.error;
  } else {
    for (const c of walletsRes.carriers) {
      if (!/(stamps_com|ups_walleted|fedex_walleted)/.test(c.code)) continue;
      const floor = floorFor(c.code);
      const balance = typeof c.balance === "number" ? c.balance : null;
      const belowFloor = balance !== null && balance < floor;
      if (belowFloor) {
        alerts.push(
          `ShipStation ${c.code} wallet $${balance!.toFixed(2)} below floor $${floor.toFixed(0)}`,
        );
      }
      wallets.push({ carrierCode: c.code, balance, floor, belowFloor });
    }
  }

  // --- ATP ---
  let pendingOutboundBags = 0;
  for (const entry of Object.values(stages)) {
    if (entry.stage === "shipped") continue;
    const bpc = BAGS_PER_CARTON[entry.packagingType ?? "master_carton"] ?? 36;
    pendingOutboundBags += (entry.cartonsRequired ?? 0) * bpc;
  }
  let totalBagsOnHand: number | null = null;
  let snapshotAgeHours: number | null = null;
  let atpUnavailableReason: string | undefined;
  if (snapshot) {
    totalBagsOnHand = snapshot.rows.reduce((s, r) => s + (r.onHand || 0), 0);
    snapshotAgeHours =
      Math.round(
        ((Date.now() - new Date(snapshot.generatedAt).getTime()) /
          3_600_000) *
          10,
      ) / 10;
    if (snapshotAgeHours > 36) {
      alerts.push(
        `Inventory snapshot ${snapshotAgeHours}h stale — POST /api/ops/inventory/snapshot to refresh`,
      );
    }
    const availableBags = totalBagsOnHand - pendingOutboundBags;
    if (availableBags < 36) {
      alerts.push(
        `ATP low: only ${availableBags} bags available after ${pendingOutboundBags} pending outbound (< 1 master carton headroom)`,
      );
    }
  } else {
    atpUnavailableReason =
      "No snapshot in KV — POST /api/ops/inventory/snapshot to populate";
  }

  // --- Freight-comp queue ---
  const queuedEntries = queue.filter((q) => q.status === "queued");
  const queuedDollars =
    Math.round(
      queuedEntries.reduce((s, q) => s + (q.freightDollars || 0), 0) * 100,
    ) / 100;
  const freightCompOldest = queuedEntries.reduce<number | null>((max, q) => {
    if (!q.queuedAt) return max;
    const age = (Date.now() - new Date(q.queuedAt).getTime()) / 3_600_000;
    return max === null || age > max ? age : max;
  }, null);
  if (queuedEntries.length > 10) {
    alerts.push(
      `Freight-comp queue deep: ${queuedEntries.length} JEs pending Rene ($${queuedDollars.toFixed(2)})`,
    );
  }

  // --- Stale voids ---
  const staleVoids: FulfillmentPreflight["staleVoids"] = {
    count: 0,
    pendingDollars: 0,
    oldestAgeHours: null,
  };
  if (!voidsRes.ok) {
    staleVoids.unavailableReason = voidsRes.error;
  } else {
    staleVoids.count = voidsRes.stale.length;
    staleVoids.pendingDollars =
      Math.round(
        voidsRes.stale.reduce((s, v) => s + (v.shipmentCost ?? 0), 0) * 100,
      ) / 100;
    staleVoids.oldestAgeHours = voidsRes.stale.reduce<number | null>(
      (max, v) =>
        v.ageHours !== null && (max === null || v.ageHours > max)
          ? v.ageHours
          : max,
      null,
    );
    if (staleVoids.count > 0) {
      alerts.push(
        `${staleVoids.count} stale ShipStation void(s), $${staleVoids.pendingDollars.toFixed(2)} pending refund`,
      );
    }
  }

  return {
    ok: true,
    generatedAt,
    wallets,
    walletDegraded,
    atp: {
      totalBagsOnHand,
      pendingOutboundBags,
      availableBags:
        totalBagsOnHand !== null ? totalBagsOnHand - pendingOutboundBags : null,
      snapshotAgeHours,
      unavailableReason: atpUnavailableReason,
    },
    freightCompQueue: {
      queuedCount: queuedEntries.length,
      queuedDollars,
      oldestAgeHours:
        freightCompOldest !== null ? Math.round(freightCompOldest * 10) / 10 : null,
    },
    staleVoids,
    alerts,
  };
}
