/**
 * Ops Agent — runtime.
 *
 * Contract: /contracts/agents/ops.md (v1.0 2026-04-18).
 *
 * One job: every weekday 9 AM PT (17:00 UTC), post Drew's operations
 * digest to #operations — open POs, vendor-thread status (Powers,
 * Belmark, Inderbitzin), in-flight shipments, inventory threshold
 * alerts. Never ships, never commits inventory, never alters pricing
 * (hard rules from the contract).
 *
 * Every dollar / count carries provenance (system + retrievedAt).
 * Missing data surfaces as `unavailable` with a reason.
 *
 * Auth: bearer CRON_SECRET (middleware whitelist + isAuthorized fallback).
 * Scheduler: Vercel Cron weekdays 17:00 UTC. On-demand via POST.
 */

import { NextResponse } from "next/server";

import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { computeFulfillmentPreflight } from "@/lib/ops/fulfillment-preflight";
import {
  KV_INVENTORY_SNAPSHOT,
  buildSnapshotFromOnHand,
} from "@/lib/ops/inventory-snapshot";
import { getQBOPurchaseOrders } from "@/lib/ops/qbo-client";
import { getAllOnHandInventory, type OnHandRow } from "@/lib/ops/shopify-admin-actions";
import {
  getAllVendorFreshness,
  WATCHED_VENDORS as VENDOR_LIST,
  type VendorFreshness,
} from "@/lib/ops/vendor-threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.AGENT_ID_OPS ?? "ops";
const DREW_SLACK_USER_ID = process.env.SLACK_USER_DREW ?? "";
const INVENTORY_LOW_THRESHOLD = 5000;
/**
 * Reorder trigger. When total bags on-hand (across every SKU) falls
 * below this, fire a `🏭 Reorder Powers?` section in the digest so
 * Drew sees a clear cue to raise a PO.
 *
 * Default 10k bags = ~277 master cartons = ~4-8 weeks runway at a
 * 50-cartons/week ship pace (Ben's 2026-04-20 working rate). Env-
 * overridable via `OPS_REORDER_THRESHOLD_BAGS`.
 */
const REORDER_THRESHOLD_BAGS = Number.parseInt(
  process.env.OPS_REORDER_THRESHOLD_BAGS ?? "10000",
  10,
);
const VENDOR_STALE_DAYS = 7;

// ---- Types --------------------------------------------------------------

interface Provenance {
  system: string;
  retrievedAt: string;
}

interface POSummary {
  id: string;
  docNumber: string | null;
  vendor: string | null;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  status: string;
  ageDays: number;
}

interface InventorySummary {
  sku: string;
  productTitle: string;
  variantTitle: string;
  onHand: number;
}

/**
 * Shipping Hub pre-flight signals folded into the digest. Sourced
 * from `/api/ops/fulfillment/preflight` via a direct fetch against
 * our own deployment. Surfacing lets Ben see wallet / ATP / stale
 * voids / freight-comp queue depth in his morning #operations post
 * without clicking through multiple tabs.
 */
interface PreflightSlice {
  walletAlerts: Array<{ carrierCode: string; balance: number | null; floor: number }>;
  atp: {
    totalBagsOnHand: number | null;
    pendingOutboundBags: number;
    availableBags: number | null;
    snapshotAgeHours: number | null;
    unavailableReason?: string;
  };
  freightCompQueue: { queuedCount: number; queuedDollars: number };
  staleVoids: { count: number; pendingDollars: number };
  amazonFbm?: {
    unshippedCount: number;
    urgentCount: number;
    lateCount: number;
    unavailableReason?: string;
  };
  alerts: string[];
}

interface DigestData {
  openPOs: POSummary[];
  openPOCount: number;
  openPODollars: number;
  vendorFreshness: VendorFreshness[];
  inventoryLow: InventorySummary[];
  inventoryOk: InventorySummary[];
  preflight: PreflightSlice | null;
  degraded: string[];
  provenance: Provenance[];
}

interface RunResult {
  ok: boolean;
  runId: string;
  postedTo: string | null;
  digest: DigestData;
  rendered: string;
  degraded: string[];
}

// ---- Handlers -----------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  return runAgent(req);
}

export async function POST(req: Request): Promise<Response> {
  return runAgent(req);
}

async function runAgent(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const shouldPost = url.searchParams.get("post") !== "false";

  const run = newRunContext({
    agentId: AGENT_ID,
    division: "production-supply-chain",
    source: "scheduled",
    trigger: "weekday-09:00PT-digest",
  });

  const digest = await gatherDigestData();
  const rendered = renderDigest(digest, run.startedAt);

  let postedTo: string | null = null;
  if (shouldPost) {
    const channel = getChannel("operations");
    if (channel) {
      try {
        const res = await postMessage({ channel: channel.name, text: rendered });
        if (res.ok) postedTo = channel.name;
      } catch (err) {
        digest.degraded.push(
          `slack-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      digest.degraded.push("slack-post: #operations channel not registered");
    }
  }

  try {
    await auditStore().append(
      buildAuditEntry(run, {
        action: "slack.post.audit",
        entityType: "ops-agent-digest",
        entityId: run.runId,
        result: "ok",
        sourceCitations: digest.provenance.map((p) => ({ system: p.system })),
        confidence: 1,
      }),
    );
  } catch {
    digest.degraded.push("audit-store: append failed (soft)");
  }

  const result: RunResult = {
    ok: true,
    runId: run.runId,
    postedTo,
    digest,
    rendered,
    degraded: digest.degraded,
  };
  return NextResponse.json(result);
}

// ---- Data gathering ----------------------------------------------------

async function gatherDigestData(): Promise<DigestData> {
  const degraded: string[] = [];
  const provenance: Provenance[] = [];

  const [openPOs, inventory, vendorFreshness, preflight] = await Promise.all([
    loadOpenPOs(degraded, provenance),
    loadInventory(degraded, provenance),
    loadVendorFreshness(degraded, provenance),
    loadPreflight(degraded, provenance),
  ]);

  const openPOCount = openPOs.length;
  const openPODollars = openPOs.reduce((a, p) => a + (p.balance || 0), 0);

  const { low: inventoryLow, ok: inventoryOk } = inventory;

  return {
    openPOs,
    openPOCount,
    openPODollars: Math.round(openPODollars * 100) / 100,
    vendorFreshness,
    inventoryLow,
    inventoryOk,
    preflight,
    degraded,
    provenance,
  };
}

async function loadPreflight(
  degraded: string[],
  provenance: Provenance[],
): Promise<PreflightSlice | null> {
  try {
    const pf = await computeFulfillmentPreflight();
    provenance.push({
      system: "fulfillment:preflight",
      retrievedAt: pf.generatedAt,
    });
    return {
      walletAlerts: pf.wallets
        .filter((w) => w.belowFloor)
        .map((w) => ({ carrierCode: w.carrierCode, balance: w.balance, floor: w.floor })),
      atp: pf.atp,
      freightCompQueue: {
        queuedCount: pf.freightCompQueue.queuedCount,
        queuedDollars: pf.freightCompQueue.queuedDollars,
      },
      staleVoids: {
        count: pf.staleVoids.count,
        pendingDollars: pf.staleVoids.pendingDollars,
      },
      amazonFbm: pf.amazonFbm,
      alerts: pf.alerts,
    };
  } catch (err) {
    degraded.push(
      `preflight: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function loadVendorFreshness(
  degraded: string[],
  provenance: Provenance[],
): Promise<VendorFreshness[]> {
  try {
    const rows = await getAllVendorFreshness();
    provenance.push({
      system: "gmail:vendor-threads",
      retrievedAt: new Date().toISOString(),
    });
    return rows;
  } catch (err) {
    degraded.push(
      `vendor-threads: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

async function loadInventory(
  degraded: string[],
  provenance: Provenance[],
): Promise<{ low: InventorySummary[]; ok: InventorySummary[] }> {
  try {
    const rows = await getAllOnHandInventory();
    provenance.push({
      system: "shopify:inventory:on-hand",
      retrievedAt: new Date().toISOString(),
    });

    // Persist the snapshot to KV so downstream consumers (Shipping Hub
    // ATP gate, ad-hoc status checks) don't have to re-hit Shopify.
    // Best-effort: a KV write failure doesn't kill the digest.
    try {
      const snapshot = buildSnapshotFromOnHand(rows, {
        lowThreshold: INVENTORY_LOW_THRESHOLD,
      });
      await kv.set(KV_INVENTORY_SNAPSHOT, snapshot);
    } catch (err) {
      degraded.push(
        `inventory-snapshot-write: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const summary = (r: OnHandRow): InventorySummary => ({
      sku: r.sku,
      productTitle: r.productTitle,
      variantTitle: r.variantTitle,
      onHand: r.onHand,
    });
    const low: InventorySummary[] = [];
    const ok: InventorySummary[] = [];
    for (const row of rows) {
      if (row.onHand < INVENTORY_LOW_THRESHOLD) low.push(summary(row));
      else ok.push(summary(row));
    }
    low.sort((a, b) => a.onHand - b.onHand);
    return { low, ok };
  } catch (err) {
    degraded.push(
      `shopify-inventory: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { low: [], ok: [] };
  }
}

async function loadOpenPOs(
  degraded: string[],
  provenance: Provenance[],
): Promise<POSummary[]> {
  try {
    const pos = await getQBOPurchaseOrders();
    const retrievedAt = new Date().toISOString();
    provenance.push({ system: "qbo:purchaseorder", retrievedAt });

    const now = Date.now();
    const open: POSummary[] = [];
    for (const po of pos) {
      const status = String(po.POStatus ?? po.TxnStatus ?? "").trim() || "Open";
      const total = Number(po.TotalAmt ?? 0);
      // QBO PO status is informational; "Open" vs "Closed" is what we need.
      // Default to including the PO if we can't tell — Drew can scan.
      const isClosed = /closed/i.test(status);
      if (isClosed) continue;

      const txnDate = po.TxnDate ? String(po.TxnDate) : null;
      const dueDate = po.DueDate ? String(po.DueDate) : null;
      const ageDays = txnDate
        ? Math.floor((now - new Date(txnDate).getTime()) / (24 * 3600 * 1000))
        : 0;

      open.push({
        id: String(po.Id ?? ""),
        docNumber: (po.DocNumber as string | undefined) ?? null,
        vendor: ((po.VendorRef as { name?: string } | undefined)?.name) ?? null,
        txnDate,
        dueDate,
        total: Math.round(total * 100) / 100,
        balance: Math.round(total * 100) / 100, // PO "balance" == total until shipped/received
        status,
        ageDays,
      });
    }
    // Sort oldest-first so Drew sees aging risks up top.
    open.sort((a, b) => b.ageDays - a.ageDays);
    return open;
  } catch (err) {
    degraded.push(`qbo-po: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ---- Rendering ---------------------------------------------------------

function money(value: number | null): string {
  if (value === null) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function renderDigest(digest: DigestData, startedAt: string): string {
  const date = new Date(startedAt);
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const drewMention = DREW_SLACK_USER_ID ? ` (<@${DREW_SLACK_USER_ID}>)` : " (Drew)";

  const lines = [
    `:factory: *Ops Agent Digest — ${dateLabel}*${drewMention}`,
    "",
    `*Open POs* — ${digest.openPOCount} · ${money(digest.openPODollars)} total`,
  ];

  if (digest.openPOs.length === 0) {
    lines.push("  _No open POs returned by QBO._");
  } else {
    const topFive = digest.openPOs.slice(0, 5);
    for (const po of topFive) {
      lines.push(
        `  • #${po.docNumber || po.id} · ${po.vendor ?? "?"} · ${money(po.total)} · ${po.ageDays}d old${po.dueDate ? ` · due ${po.dueDate}` : ""}`,
      );
    }
    if (digest.openPOs.length > 5) {
      lines.push(`  _+ ${digest.openPOs.length - 5} more — run \`/api/ops/qbo/purchaseorder\` for the full list._`);
    }
  }

  const vendorListText = VENDOR_LIST.map((v) => v.name).join(", ");
  lines.push(
    "",
    `*Watched vendors:* ${vendorListText}`,
    digest.vendorFreshness.length === 0
      ? `  _Gmail query failed — check Gmail integration._`
      : digest.vendorFreshness
          .map((v) => {
            if (v.lastInboundISO === null) {
              return `  • ${v.vendor}: _${v.unavailableReason || "no inbound mail"}_`;
            }
            const flag =
              v.daysSince !== null && v.daysSince > VENDOR_STALE_DAYS
                ? " ⚠️ stale"
                : "";
            return `  • ${v.vendor}: last inbound ${v.daysSince}d ago${flag} — _${v.lastSubject ?? ""}_`;
          })
          .join("\n"),
    "",
    `*Inventory low-threshold (< ${INVENTORY_LOW_THRESHOLD} units on-hand, Shopify):*`,
    digest.inventoryLow.length === 0 && digest.inventoryOk.length === 0
      ? "  _Shopify inventory query returned nothing — verify tracking enabled._"
      : digest.inventoryLow.length === 0
        ? `  :white_check_mark: All ${digest.inventoryOk.length} tracked SKUs above threshold.`
        : digest.inventoryLow
            .map(
              (s) =>
                `  • *${s.sku || s.variantTitle}* — ${s.onHand} on-hand (${s.productTitle})`,
            )
            .join("\n"),
  );

  // Reorder trigger — only surfaces when Ben/Drew are close to needing
  // to place a Powers PO. Uses the preflight's total-on-hand count
  // (already computed), so no extra Shopify round-trip.
  if (digest.preflight && digest.preflight.atp.totalBagsOnHand !== null) {
    const totalOnHand = digest.preflight.atp.totalBagsOnHand;
    if (totalOnHand < REORDER_THRESHOLD_BAGS) {
      const weeksRunway = (totalOnHand / 1800).toFixed(1); // 1800 bags/week rough ship pace
      lines.push(
        "",
        `:factory: *REORDER TRIGGER* — total on-hand ${totalOnHand.toLocaleString()} bags < ${REORDER_THRESHOLD_BAGS.toLocaleString()} threshold (~${weeksRunway} weeks runway at current pace). Drew, time to place a Powers PO.`,
      );
    }
  }

  // Shipping Hub pre-flight — wallet / ATP / freight-comp / stale voids.
  if (digest.preflight) {
    const pf = digest.preflight;
    lines.push("", "*Shipping Hub pre-flight*");

    // Wallet status
    if (pf.walletAlerts.length > 0) {
      for (const w of pf.walletAlerts) {
        const bal = w.balance === null ? "—" : `$${w.balance.toFixed(2)}`;
        lines.push(
          `  :rotating_light: \`${w.carrierCode}\` wallet ${bal} (floor $${w.floor.toFixed(0)}) — top up before next buy`,
        );
      }
    } else {
      lines.push(`  :white_check_mark: All walleted carriers above floor.`);
    }

    // ATP
    const { availableBags, totalBagsOnHand, pendingOutboundBags, snapshotAgeHours, unavailableReason } = pf.atp;
    if (unavailableReason) {
      lines.push(`  :grey_question: ATP: _${unavailableReason}_`);
    } else if (totalBagsOnHand !== null && availableBags !== null) {
      const atpIcon = availableBags < 36 ? ":warning:" : ":white_check_mark:";
      const stale = snapshotAgeHours !== null && snapshotAgeHours > 36 ? ` _(snapshot ${snapshotAgeHours}h stale)_` : "";
      lines.push(
        `  ${atpIcon} ATP: ${availableBags} bags available (${totalBagsOnHand} on-hand − ${pendingOutboundBags} pending outbound)${stale}`,
      );
    }

    // Freight-comp queue
    if (pf.freightCompQueue.queuedCount > 0) {
      lines.push(
        `  :inbox_tray: Freight-comp queue: ${pf.freightCompQueue.queuedCount} JE(s) pending Rene · $${pf.freightCompQueue.queuedDollars.toFixed(2)}`,
      );
    }

    // Stale voids
    if (pf.staleVoids.count > 0) {
      lines.push(
        `  :money_with_wings: Stale voids: ${pf.staleVoids.count} · $${pf.staleVoids.pendingDollars.toFixed(2)} pending refund`,
      );
    }

    // Amazon FBM queue
    if (pf.amazonFbm && !pf.amazonFbm.unavailableReason) {
      const fbm = pf.amazonFbm;
      if (fbm.lateCount > 0) {
        lines.push(
          `  :rotating_light: Amazon FBM: ${fbm.lateCount} LATE · ${fbm.unshippedCount} total unshipped — /ops/amazon-fbm`,
        );
      } else if (fbm.urgentCount > 0) {
        lines.push(
          `  :clock1: Amazon FBM: ${fbm.urgentCount} urgent (<12h) · ${fbm.unshippedCount} total unshipped — /ops/amazon-fbm`,
        );
      } else if (fbm.unshippedCount > 0) {
        lines.push(
          `  :package: Amazon FBM: ${fbm.unshippedCount} unshipped in queue — /ops/amazon-fbm`,
        );
      }
    }
  }

  if (digest.degraded.length > 0) {
    lines.push("", `_Degraded sources:_ ${digest.degraded.join(" | ")}`);
  }
  lines.push(
    "",
    "_Orders ship from Ashford — Ben only. Drew owns PO + sample + production. Never commit inventory without Class C approval._",
  );

  return lines.join("\n");
}
