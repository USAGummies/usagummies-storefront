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

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { getQBOInvoices, getQBOBills } from "@/lib/ops/qbo-client";
import { getBalances, isPlaidConfigured, isPlaidConnected } from "@/lib/finance/plaid";

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
  degraded: string[];
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
          channel: channel.name,
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

  const [cashBoA, ap, ar, uncategorized, pendingApprovals] = await Promise.all([
    loadCash(degraded),
    loadOpenAP(degraded),
    loadOpenAR(degraded),
    loadUncategorizedCount(degraded),
    loadPendingApprovalsCount(degraded),
  ]);

  return {
    cashBoA,
    openApDollars: ap.unpaidTotal,
    openArDollars: ar.sentOutstanding,
    draftInvoices: ar.draftTotal,
    uncategorizedCount: uncategorized,
    pendingApprovalsCount: pendingApprovals,
    degraded,
  };
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

async function loadUncategorizedCount(_degraded: string[]): Promise<Cell> {
  // The QBO SDK we ship doesn't expose a first-class "uncategorized" count.
  // Booke (external SaaS) owns that queue. Rather than fabricate a number,
  // surface unavailable and point Rene at Booke. Wire properly in the
  // Booke-integration commit (contract: /contracts/agents/booke.md).
  return {
    value: null,
    unavailableReason: "Booke queue not queried (see Booke dashboard for uncategorized)",
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

  if (digest.degraded.length > 0) {
    lines.push("", `_Degraded sources:_ ${digest.degraded.join(" | ")}`);
  }
  lines.push(
    "",
    "_This agent never resolves — it surfaces. Rene owns every Class B/C from this queue. Drafts are NOT AR per 2026-03-30 rule._",
  );

  return lines.join("\n");
}
