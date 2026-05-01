/**
 * Finance Exception Agent — runtime.
 *
 * Contract: /contracts/agents/finance-exception.md (v1.0 2026-04-18).
 *
 * One job: every weekday morning (6 AM PT / 14:00 UTC), compose Rene's
 * finance digest (open AP/AR, recent Booke exceptions, open Class B/C
 * approvals, cash position) and post it to #finance with Rene mentioned.
 * Never resolves exceptions; only surfaces them with context.
 *
 * All dollar figures cite `retrievedAt` on their source per the
 * no-fabrication rule (governance §1.2). Missing data surfaces as an
 * explicit `unavailableReason` line, not a guess.
 *
 * Auth: bearer CRON_SECRET (middleware whitelist + isAuthorized fallback).
 * Scheduler: Vercel Cron (weekdays 14:00 UTC). Can also be invoked
 * on-demand via POST with `?post=false` for dry-run composition.
 */

import { NextResponse } from "next/server";

import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel, slackChannelRef } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { getQBOInvoices, getQBOBills } from "@/lib/ops/qbo-client";
import { getBalances, isPlaidConfigured, isPlaidConnected } from "@/lib/finance/plaid";
import { getBookeQueueState } from "@/lib/ops/booke-client";
import { listVoidedLabels } from "@/lib/ops/shipstation-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.AGENT_ID_FINANCE_EXCEPTION ?? "finance-exception";

// Rene's Slack user id; same canonical id used by Viktor W-7.
const RENE_SLACK_USER_ID = process.env.SLACK_USER_RENE ?? "U0ALL27JM38";

// ---- Data types for the digest -----------------------------------------

interface Provenance {
  system: string;
  retrievedAt: string;
}

interface Cell {
  value: number | null;
  unavailableReason?: string;
  provenance?: Provenance;
}

interface DigestData {
  cashBoA: Cell; // BoA checking 7020
  openApDollars: Cell; // unpaid bills
  openArDollars: Cell; // sent invoices with balance > 0
  draftInvoices: Cell; // drafts (NOT AR — 2026-03-30 rule)
  uncategorizedCount: Cell; // booke queue
  pendingApprovalsCount: Cell;
  /**
   * BUILD #6 — pending CF-09 freight-comp JE entries auto-queued by
   * the buy-label route. Rene reviews + posts as Class B approvals.
   */
  freightCompQueue: {
    queuedCount: number;
    queuedDollars: number;
    items: Array<{
      queuedAt: string;
      channelLabel: string;
      customerName: string;
      freightDollars: number;
      customerRef: string;
      trackingNumbers: string[];
    }>;
  };
  /**
   * BUILD #9 — ShipStation voided labels older than 72h without a
   * verified wallet credit. Rene opens a Stamps.com ticket if the
   * count stays non-zero for >14 days.
   */
  staleVoidRefunds: {
    count: number;
    pendingDollars: number;
    oldestHours: number | null;
    unavailableReason?: string;
  };
  degraded: string[];
}

/** Keep in sync with buy-label/route.ts. */
const KV_FREIGHT_COMP_QUEUE = "fulfillment:freight-comp-queue";

interface FreightCompQueueEntry {
  queuedAt: string;
  channel: string;
  channelLabel: string;
  customerName: string;
  customerMatch: string;
  freightDollars: number;
  trackingNumbers: string[];
  shipmentIds: Array<string | number>;
  customerRef: string;
  status: "queued" | "approved" | "posted" | "rejected";
  buyLoopKeys: string[];
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
    division: "financials",
    source: "scheduled",
    trigger: "weekday-06:00PT-digest",
  });

  const digest = await gatherDigestData();
  const rendered = renderDigest(digest, run.startedAt);

  let postedTo: string | null = null;
  if (shouldPost) {
    const channel = getChannel("finance");
    if (channel) {
      try {
        const res = await postMessage({
          channel: slackChannelRef("finance"),
          text: rendered,
        });
        if (res.ok) postedTo = channel.name;
      } catch (err) {
        digest.degraded.push(
          `slack-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      digest.degraded.push("slack-post: #finance channel not registered");
    }
  }

  // Best-effort audit append so the daily invocation is in the audit
  // log stream (governance §1.3). Failure here is logged, not fatal.
  try {
    await auditStore().append(
      buildAuditEntry(run, {
        action: "slack.post.audit",
        entityType: "finance-exception-digest",
        entityId: run.runId,
        result: "ok",
        sourceCitations: [
          ...(digest.cashBoA.provenance
            ? [{ system: digest.cashBoA.provenance.system }]
            : []),
          ...(digest.openApDollars.provenance
            ? [{ system: digest.openApDollars.provenance.system }]
            : []),
          ...(digest.openArDollars.provenance
            ? [{ system: digest.openArDollars.provenance.system }]
            : []),
        ],
        confidence: 1,
      }),
    );
  } catch {
    // governance §1.3 says audit is authoritative — but for a cron
    // digest we surface the degradation and keep going rather than
    // 500-ing on an audit-store hiccup.
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

  const [
    cashBoA,
    ap,
    ar,
    uncategorized,
    pendingApprovals,
    freightCompQueue,
    staleVoidRefunds,
  ] = await Promise.all([
    loadCash(degraded),
    loadOpenAP(degraded),
    loadOpenAR(degraded),
    loadUncategorizedCount(degraded),
    loadPendingApprovalsCount(degraded),
    loadFreightCompQueue(degraded),
    loadStaleVoidRefunds(degraded),
  ]);

  return {
    cashBoA,
    openApDollars: ap.unpaidTotal,
    openArDollars: ar.sentOutstanding,
    draftInvoices: ar.draftTotal,
    uncategorizedCount: uncategorized,
    pendingApprovalsCount: pendingApprovals,
    freightCompQueue,
    staleVoidRefunds,
    degraded,
  };
}

async function loadFreightCompQueue(
  degraded: string[],
): Promise<DigestData["freightCompQueue"]> {
  try {
    const queue =
      ((await kv.get<FreightCompQueueEntry[]>(KV_FREIGHT_COMP_QUEUE)) ??
        []) as FreightCompQueueEntry[];
    const queued = queue.filter((q) => q.status === "queued");
    const queuedDollars =
      Math.round(
        queued.reduce((sum, q) => sum + (q.freightDollars || 0), 0) * 100,
      ) / 100;
    return {
      queuedCount: queued.length,
      queuedDollars,
      items: queued.slice(0, 10).map((q) => ({
        queuedAt: q.queuedAt,
        channelLabel: q.channelLabel,
        customerName: q.customerName,
        freightDollars: q.freightDollars,
        customerRef: q.customerRef,
        trackingNumbers: q.trackingNumbers,
      })),
    };
  } catch (err) {
    degraded.push(
      `freight-comp-queue: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { queuedCount: 0, queuedDollars: 0, items: [] };
  }
}

async function loadStaleVoidRefunds(
  degraded: string[],
): Promise<DigestData["staleVoidRefunds"]> {
  try {
    const res = await listVoidedLabels({ daysBack: 14, staleAfterHours: 72 });
    if (!res.ok) {
      degraded.push(`void-refund-scan: ${res.error}`);
      return {
        count: 0,
        pendingDollars: 0,
        oldestHours: null,
        unavailableReason: res.error,
      };
    }
    const totalDollars =
      Math.round(
        res.stale.reduce((sum, v) => sum + (v.shipmentCost ?? 0), 0) * 100,
      ) / 100;
    const oldestHours = res.stale.reduce<number | null>(
      (max, v) => (v.ageHours !== null && (max === null || v.ageHours > max) ? v.ageHours : max),
      null,
    );
    return {
      count: res.stale.length,
      pendingDollars: totalDollars,
      oldestHours,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    degraded.push(`void-refund-scan: ${msg}`);
    return {
      count: 0,
      pendingDollars: 0,
      oldestHours: null,
      unavailableReason: msg,
    };
  }
}

async function loadCash(degraded: string[]): Promise<Cell> {
  if (!isPlaidConfigured()) {
    return { value: null, unavailableReason: "Plaid not configured" };
  }
  if (!(await isPlaidConnected())) {
    return { value: null, unavailableReason: "Plaid not connected" };
  }
  try {
    const balances = await getBalances();
    if (!balances || balances.length === 0) {
      return { value: null, unavailableReason: "Plaid returned no accounts" };
    }
    // Primary = BoA checking 7020. Plaid's PlaidAccount exposes
    // officialName which typically carries the masked tail ("…7020").
    const primary =
      balances.find((b) =>
        (b.officialName ?? b.name).toLowerCase().includes("7020"),
      ) ?? balances.find((b) => b.subtype === "checking") ?? balances[0];
    const available =
      typeof primary.balances?.available === "number"
        ? primary.balances.available
        : typeof primary.balances?.current === "number"
          ? primary.balances.current
          : null;
    if (available === null) {
      return { value: null, unavailableReason: "Plaid returned no balance on BoA 7020" };
    }
    return {
      value: Math.round(available * 100) / 100,
      provenance: { system: "plaid:boa-7020", retrievedAt: new Date().toISOString() },
    };
  } catch (err) {
    degraded.push(`plaid: ${err instanceof Error ? err.message : String(err)}`);
    return { value: null, unavailableReason: "Plaid query threw" };
  }
}

async function loadOpenAP(degraded: string[]): Promise<{ unpaidTotal: Cell }> {
  try {
    const bills = await getQBOBills();
    const list = (bills?.QueryResponse as { Bill?: Array<Record<string, unknown>> } | undefined)?.Bill ?? [];
    const open = list.filter((b) => {
      const bal = Number(b.Balance ?? 0);
      return bal > 0;
    });
    const total = open.reduce((a, b) => a + Number(b.Balance ?? 0), 0);
    return {
      unpaidTotal: {
        value: Math.round(total * 100) / 100,
        provenance: { system: "qbo:bills", retrievedAt: new Date().toISOString() },
      },
    };
  } catch (err) {
    degraded.push(`qbo-bills: ${err instanceof Error ? err.message : String(err)}`);
    return { unpaidTotal: { value: null, unavailableReason: "QBO bills query failed" } };
  }
}

async function loadOpenAR(
  degraded: string[],
): Promise<{ sentOutstanding: Cell; draftTotal: Cell }> {
  try {
    const resp = await getQBOInvoices();
    const invoices = (resp?.QueryResponse as { Invoice?: Array<Record<string, unknown>> } | undefined)?.Invoice ?? [];
    let sent = 0;
    let drafts = 0;
    for (const inv of invoices) {
      const balance = Number(inv.Balance ?? 0);
      if (balance <= 0) continue;
      const emailStatus = String(inv.EmailStatus ?? "");
      const printStatus = String(inv.PrintStatus ?? "");
      const wasSent =
        emailStatus === "EmailSent" || emailStatus === "Viewed" || printStatus === "PrintComplete";
      if (wasSent) sent += balance;
      else drafts += balance;
    }
    const now = new Date().toISOString();
    return {
      sentOutstanding: {
        value: Math.round(sent * 100) / 100,
        provenance: { system: "qbo:invoices:sent", retrievedAt: now },
      },
      draftTotal: {
        value: Math.round(drafts * 100) / 100,
        provenance: { system: "qbo:invoices:draft", retrievedAt: now },
      },
    };
  } catch (err) {
    degraded.push(`qbo-invoices: ${err instanceof Error ? err.message : String(err)}`);
    return {
      sentOutstanding: { value: null, unavailableReason: "QBO invoice query failed" },
      draftTotal: { value: null, unavailableReason: "QBO invoice query failed" },
    };
  }
}

async function loadUncategorizedCount(degraded: string[]): Promise<Cell> {
  const state = await getBookeQueueState();
  if (state.pendingCount === null) {
    if (state.unavailableReason) degraded.push(`booke: ${state.unavailableReason}`);
    return {
      value: null,
      unavailableReason: state.unavailableReason ?? "Booke queue unreachable",
    };
  }
  return {
    value: state.pendingCount,
    provenance: {
      system: `booke:${state.source ?? "unknown"}`,
      retrievedAt: state.retrievedAt,
    },
  };
}

async function loadPendingApprovalsCount(degraded: string[]): Promise<Cell> {
  // Pending approvals open against financials. ApprovalStore exposes
  // listPending(); we filter by division in-memory.
  try {
    const { approvalStore } = await import("@/lib/ops/control-plane/stores");
    const store = approvalStore();
    const pending = await store.listPending();
    const financials = pending.filter((a) => a.division === "financials").length;
    return {
      value: financials,
      provenance: { system: "control-plane:approval-store", retrievedAt: new Date().toISOString() },
    };
  } catch (err) {
    degraded.push(`approvals: ${err instanceof Error ? err.message : String(err)}`);
    return { value: null, unavailableReason: "approval store query failed" };
  }
}

// ---- Rendering ---------------------------------------------------------

function money(value: number | null, fallback: string): string {
  if (value === null) return fallback;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type CellFormat = "money" | "count";

function renderCell(cell: Cell, label: string, format: CellFormat): string {
  if (cell.value === null) {
    return `• *${label}:* _unavailable_ — ${cell.unavailableReason ?? "no data"}`;
  }
  const v = typeof cell.value === "number" ? cell.value : 0;
  const fmt = format === "count" ? String(Math.round(v)) : money(v, "—");
  const src = cell.provenance?.system ?? "?";
  return `• *${label}:* ${fmt}  \`[${src}]\``;
}

function renderDigest(digest: DigestData, startedAt: string): string {
  const date = new Date(startedAt);
  const dateLabel = `${date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const lines = [
    `:bank: *Finance Exception Digest — ${dateLabel}* (<@${RENE_SLACK_USER_ID}>)`,
    "",
    "*Cash + queue*",
    renderCell(digest.cashBoA, "BoA checking 7020", "money"),
    renderCell(digest.openApDollars, "Open AP (unpaid bills)", "money"),
    renderCell(digest.openArDollars, "Open AR (sent invoices)", "money"),
    renderCell(digest.draftInvoices, "Draft invoices (not AR)", "money"),
    renderCell(digest.uncategorizedCount, "Uncategorized transactions", "count"),
    renderCell(digest.pendingApprovalsCount, "Pending financials approvals", "count"),
  ];

  // BUILD #6 surface — pending CF-09 freight-comp JE entries.
  if (digest.freightCompQueue.queuedCount > 0) {
    lines.push(
      "",
      `*CF-09 freight-comp queue — ${digest.freightCompQueue.queuedCount} pending JE(s), ${money(digest.freightCompQueue.queuedDollars, "—")}*`,
      `_One-click approve via \`POST /api/ops/fulfillment/freight-comp-queue { key, approver: "Rene" }\`. Paired DEBIT 500050 / CREDIT 499010 (Class B). Source: /contracts/distributor-pricing-commitments.md §5._`,
    );
    for (const item of digest.freightCompQueue.items.slice(0, 5)) {
      const tracking =
        item.trackingNumbers.length > 0
          ? ` (tracking: \`${item.trackingNumbers.slice(0, 2).join(", ")}${item.trackingNumbers.length > 2 ? "…" : ""}\`)`
          : "";
      lines.push(
        `  • ${money(item.freightDollars, "—")} — ${item.customerName} · ${item.channelLabel} · ref \`${item.customerRef}\`${tracking}`,
      );
    }
    if (digest.freightCompQueue.items.length < digest.freightCompQueue.queuedCount) {
      lines.push(
        `  … and ${digest.freightCompQueue.queuedCount - digest.freightCompQueue.items.length} more`,
      );
    }
  }

  // BUILD #9 surface — stale void refunds.
  if (digest.staleVoidRefunds.count > 0) {
    const oldestStr =
      digest.staleVoidRefunds.oldestHours !== null
        ? ` (oldest ${Math.round(digest.staleVoidRefunds.oldestHours)}h)`
        : "";
    lines.push(
      "",
      `*:money_with_wings: ShipStation stale voids — ${digest.staleVoidRefunds.count}, ${money(digest.staleVoidRefunds.pendingDollars, "—")} pending refund${oldestStr}*`,
      `_Stamps.com refunds past SLA (>72h). Full list: \`/api/ops/shipstation/voided-labels\`. Open a Stamps.com ticket if > 14d._`,
    );
  } else if (digest.staleVoidRefunds.unavailableReason) {
    lines.push(
      "",
      `_ShipStation void scan unavailable: ${digest.staleVoidRefunds.unavailableReason}_`,
    );
  }

  if (digest.degraded.length > 0) {
    lines.push("", `_Degraded sources:_ ${digest.degraded.join(" | ")}`);
  }
  lines.push(
    "",
    "_This agent never resolves — it surfaces. Rene owns every Class B/C from this queue. Drafts are NOT AR per 2026-03-30 rule._",
  );

  return lines.join("\n");
}
