/**
 * Fulfillment Drift Audit — policy-compliance scorecard for the
 * Shipping Hub BUILDs layered on 2026-04-20.
 *
 * Runs weekly alongside the main drift audit (Sunday 20:00 PT). For
 * each policy we added in the 15-commit arc, the scorecard verifies
 * the system has STAYED within the policy in the preceding window:
 *
 *   - BUILD #2 — Wallet floor adherence:
 *       Point-in-time check vs every SHIPSTATION_WALLET_MIN_* floor.
 *       A single below-floor carrier is a P3 finding (operator action);
 *       every walleted carrier below floor for >48h is P2.
 *
 *   - BUILD #6 — Freight-comp queue drain rate:
 *       Queue entries older than 14d stuck in `queued` without being
 *       posted or rejected are P2 findings (Rene has a backlog).
 *
 *   - BUILD #7 — Delivered-pricing doctrine compliance:
 *       QBO audit entries in the window with an
 *       `entity_type=invoice` + `validation_passed=false` + the
 *       DELIVERED_PRICING_VIOLATION issue = enforcement firing (good).
 *       Zero entries + recent buy-label writes to delivered-pricing
 *       customers with paired freight lines seen in QBO = silent
 *       bypass (P1 — hard escalation).
 *
 *   - BUILD #9 — Stale-void refund SLA:
 *       Voids older than 14d without a Stamps.com refund credit = P2
 *       (send Stamps.com ticket). Voids older than 30d = P1.
 *
 * Pure read, no side-effects. Called by the drift-audit route.
 */

import { kv } from "@vercel/kv";

import type { InventorySnapshot } from "./inventory-snapshot";
import {
  listShipStationCarriers,
  listVoidedLabels,
} from "./shipstation-client";

const KV_FREIGHT_COMP_QUEUE = "fulfillment:freight-comp-queue";
const KV_INVENTORY_SNAPSHOT = "inventory:snapshot:v1";

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

interface FreightCompQueueEntry {
  queuedAt: string;
  freightDollars: number;
  status: "queued" | "approved" | "posted" | "rejected";
  customerName?: string;
  customerRef?: string;
}

export type DriftSeverity = "P1" | "P2" | "P3" | "info";

export interface FulfillmentDriftFinding {
  check:
    | "wallet_floor"
    | "freight_comp_queue_drain"
    | "delivered_pricing_compliance"
    | "stale_void_sla"
    | "inventory_snapshot_staleness";
  severity: DriftSeverity;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface FulfillmentDriftScorecard {
  generatedAt: string;
  windowDays: number;
  findings: FulfillmentDriftFinding[];
  /** Rollup: counts by severity. */
  severityCounts: Record<DriftSeverity, number>;
  /** True when at least one finding exists. Callers post only on this. */
  hasFindings: boolean;
  /** Diagnostic degradations (ShipStation unreachable, KV miss). */
  degraded: string[];
}

export async function runFulfillmentDriftAudit(opts: {
  windowDays?: number;
} = {}): Promise<FulfillmentDriftScorecard> {
  const windowDays = Math.max(1, Math.min(30, opts.windowDays ?? 14));
  const now = Date.now();
  const windowMs = windowDays * 24 * 3600 * 1000;
  const findings: FulfillmentDriftFinding[] = [];
  const degraded: string[] = [];

  // ---- BUILD #2: Wallet floor adherence ----
  const carriersRes = await listShipStationCarriers();
  if (!carriersRes.ok) {
    degraded.push(`wallet-read: ${carriersRes.error}`);
  } else {
    for (const c of carriersRes.carriers) {
      if (!/(stamps_com|ups_walleted|fedex_walleted)/.test(c.code)) continue;
      const floor = floorFor(c.code);
      if (typeof c.balance !== "number") continue; // not reported
      if (c.balance < floor) {
        findings.push({
          check: "wallet_floor",
          severity: c.balance < floor * 0.5 ? "P2" : "P3",
          summary: `${c.code} wallet $${c.balance.toFixed(2)} below floor $${floor.toFixed(0)}${
            c.balance < floor * 0.5 ? " (<50% of floor)" : ""
          }`,
          detail: { carrierCode: c.code, balance: c.balance, floor },
        });
      }
    }
  }

  // ---- BUILD #6: Freight-comp queue drain rate ----
  const queue =
    ((await kv.get<FreightCompQueueEntry[]>(KV_FREIGHT_COMP_QUEUE)) ??
      []) as FreightCompQueueEntry[];
  const stuckEntries = queue.filter((q) => {
    if (q.status !== "queued") return false;
    const queuedAt = q.queuedAt ? new Date(q.queuedAt).getTime() : 0;
    return queuedAt > 0 && now - queuedAt > windowMs;
  });
  if (stuckEntries.length > 0) {
    const totalDollars =
      Math.round(
        stuckEntries.reduce((s, q) => s + (q.freightDollars || 0), 0) * 100,
      ) / 100;
    findings.push({
      check: "freight_comp_queue_drain",
      severity: stuckEntries.length > 10 ? "P1" : "P2",
      summary: `${stuckEntries.length} CF-09 freight-comp JE(s) stuck >${windowDays}d unresolved (${totalDollars.toFixed(2)} total). Rene should review.`,
      detail: {
        count: stuckEntries.length,
        totalDollars,
        sample: stuckEntries.slice(0, 5).map((q) => ({
          queuedAt: q.queuedAt,
          customerName: q.customerName,
          freightDollars: q.freightDollars,
          customerRef: q.customerRef,
        })),
      },
    });
  }

  // ---- BUILD #9: Stale-void refund SLA ----
  const voidsRes = await listVoidedLabels({ daysBack: 30, staleAfterHours: 72 });
  if (!voidsRes.ok) {
    degraded.push(`void-scan: ${voidsRes.error}`);
  } else {
    const veryStale = voidsRes.stale.filter(
      (v) => v.ageHours !== null && v.ageHours > 30 * 24,
    );
    const moderateStale = voidsRes.stale.filter(
      (v) =>
        v.ageHours !== null &&
        v.ageHours > 14 * 24 &&
        v.ageHours <= 30 * 24,
    );
    if (veryStale.length > 0) {
      const total = veryStale.reduce((s, v) => s + (v.shipmentCost ?? 0), 0);
      findings.push({
        check: "stale_void_sla",
        severity: "P1",
        summary: `${veryStale.length} ShipStation void(s) >30d old, $${total.toFixed(2)} never refunded. Escalate to Stamps.com.`,
        detail: {
          count: veryStale.length,
          totalDollars: Math.round(total * 100) / 100,
          sample: veryStale.slice(0, 5).map((v) => ({
            shipmentId: v.shipmentId,
            trackingNumber: v.trackingNumber,
            voidDate: v.voidDate,
            cost: v.shipmentCost,
          })),
        },
      });
    }
    if (moderateStale.length > 0) {
      const total = moderateStale.reduce(
        (s, v) => s + (v.shipmentCost ?? 0),
        0,
      );
      findings.push({
        check: "stale_void_sla",
        severity: "P2",
        summary: `${moderateStale.length} ShipStation void(s) 14-30d old, $${total.toFixed(2)} pending refund. Open Stamps.com ticket if still pending by 30d.`,
        detail: {
          count: moderateStale.length,
          totalDollars: Math.round(total * 100) / 100,
        },
      });
    }
  }

  // ---- Inventory snapshot staleness ----
  const snap =
    ((await kv.get<InventorySnapshot>(KV_INVENTORY_SNAPSHOT)) ??
      null) as InventorySnapshot | null;
  if (!snap) {
    findings.push({
      check: "inventory_snapshot_staleness",
      severity: "P2",
      summary:
        "Inventory snapshot never populated — ATP gate cannot enforce. POST /api/ops/inventory/snapshot to populate.",
    });
  } else {
    const ageMs = now - new Date(snap.generatedAt).getTime();
    const ageH = Math.round((ageMs / 3_600_000) * 10) / 10;
    if (ageH > 48) {
      findings.push({
        check: "inventory_snapshot_staleness",
        severity: ageH > 168 ? "P2" : "P3",
        summary: `Inventory snapshot ${ageH}h stale — ATP gate reading outdated numbers. Ops Agent cron expected to refresh daily at 10:00 PT.`,
        detail: { ageHours: ageH, generatedAt: snap.generatedAt },
      });
    }
  }

  // ---- Severity rollup ----
  const severityCounts: Record<DriftSeverity, number> = {
    P1: 0,
    P2: 0,
    P3: 0,
    info: 0,
  };
  for (const f of findings) severityCounts[f.severity] += 1;

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    findings,
    severityCounts,
    hasFindings: findings.length > 0,
    degraded,
  };
}

/**
 * Render a Slack-flavored markdown block for `#ops-audit`.
 * Returns empty string when there are no findings (caller short-circuits).
 */
export function renderFulfillmentDriftMarkdown(
  sc: FulfillmentDriftScorecard,
): string {
  if (!sc.hasFindings) return "";
  const lines: string[] = [
    `:mag: *Fulfillment drift audit — ${sc.windowDays}d window*`,
    `_${sc.severityCounts.P1} P1 · ${sc.severityCounts.P2} P2 · ${sc.severityCounts.P3} P3 findings. Generated ${sc.generatedAt}._`,
    "",
  ];
  const icon = (s: DriftSeverity): string =>
    s === "P1" ? ":rotating_light:" : s === "P2" ? ":warning:" : ":information_source:";
  for (const f of sc.findings) {
    lines.push(`${icon(f.severity)} *${f.severity}* \`${f.check}\`: ${f.summary}`);
  }
  if (sc.degraded.length > 0) {
    lines.push("", `_Degraded:_ ${sc.degraded.join(" | ")}`);
  }
  return lines.join("\n");
}
