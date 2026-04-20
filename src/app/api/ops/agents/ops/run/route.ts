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

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { getQBOPurchaseOrders } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.AGENT_ID_OPS ?? "ops";
const DREW_SLACK_USER_ID = process.env.SLACK_USER_DREW ?? "";
const WATCHED_VENDORS = ["Powers", "Belmark", "Inderbitzin", "Albanese"] as const;
const INVENTORY_LOW_THRESHOLD = 5000;

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

interface DigestData {
  openPOs: POSummary[];
  openPOCount: number;
  openPODollars: number;
  staleVendorThreads: Array<{ vendor: string; note: string }>;
  inventoryLow: string[];
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

  const openPOs = await loadOpenPOs(degraded, provenance);
  const openPOCount = openPOs.length;
  const openPODollars = openPOs.reduce((a, p) => a + (p.balance || 0), 0);

  // Vendor-thread staleness and inventory threshold are doctrine in
  // the ops.md contract but depend on integrations we haven't wired to
  // the control plane yet (Gmail vendor-thread scraping, on-hand
  // inventory). Surfacing as explicit "unavailable" per no-fabrication.
  const staleVendorThreads: Array<{ vendor: string; note: string }> = [];
  const inventoryLow: string[] = [];
  degraded.push(
    "vendor-threads: Gmail thread freshness check not yet wired (requires labeled-thread scraper)",
  );
  degraded.push(
    "inventory-low: on-hand inventory query not yet wired (Shopify inventory cross-ref)",
  );

  return {
    openPOs,
    openPOCount,
    openPODollars: Math.round(openPODollars * 100) / 100,
    staleVendorThreads,
    inventoryLow,
    degraded,
    provenance,
  };
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

  lines.push(
    "",
    `*Watched vendors:* ${WATCHED_VENDORS.join(", ")}`,
    digest.staleVendorThreads.length === 0
      ? `  _Thread freshness not wired yet — check Gmail vendor threads manually._`
      : digest.staleVendorThreads
          .map((v) => `  • ${v.vendor}: ${v.note}`)
          .join("\n"),
    "",
    `*Inventory low-threshold (< ${INVENTORY_LOW_THRESHOLD} units):*`,
    digest.inventoryLow.length === 0
      ? "  _On-hand cross-ref not wired yet — check Shopify Admin._"
      : digest.inventoryLow.map((s) => `  • ${s}`).join("\n"),
  );

  if (digest.degraded.length > 0) {
    lines.push("", `_Degraded sources:_ ${digest.degraded.join(" | ")}`);
  }
  lines.push(
    "",
    "_Orders ship from Ashford — Ben only. Drew owns PO + sample + production. Never commit inventory without Class C approval._",
  );

  return lines.join("\n");
}
