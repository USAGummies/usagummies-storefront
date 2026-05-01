/**
 * Faire Specialist (S-12) — runtime.
 *
 * Contract: /contracts/agents/faire-specialist.md (v1.0 2026-04-20).
 *
 * Thursday 10:00 PT (17:00 UTC) cron. One job: weekly Faire
 * reconciliation prep + Direct-share tracking. Posts to `#finance`
 * (payout reconcile prep) + `#sales` (Direct-share dashboard). Never
 * sends Direct invites autonomously — each invite is a Class B
 * `faire-direct.invite` approval per blueprint §15.3.
 *
 * Degraded-mode contract: if `FAIRE_ACCESS_TOKEN` is not set, surface
 * an `unavailable` line with the reason and do not fabricate. The
 * digest still posts so the team knows the cron ran.
 *
 * Auth: bearer CRON_SECRET (isAuthorized + middleware whitelist).
 */

import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel, slackChannelRef } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import {
  getRecentFaireOrders,
  getRecentFairePayouts,
  isFaireConfigured,
  type FaireOrderSummary,
  type FairePayoutSummary,
} from "@/lib/ops/faire-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.AGENT_ID_FAIRE ?? "faire-specialist";

interface DigestData {
  orders14d: FaireOrderSummary[] | null;
  payouts45d: FairePayoutSummary[] | null;
  degraded: string[];
  generatedAt: string;
}

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
    division: "sales",
    source: "scheduled",
    trigger: "thursday-10:00PT-faire-reconcile",
  });

  const degraded: string[] = [];
  let orders14d: FaireOrderSummary[] | null = null;
  let payouts45d: FairePayoutSummary[] | null = null;

  if (!isFaireConfigured()) {
    degraded.push("FAIRE_ACCESS_TOKEN not configured");
  } else {
    orders14d = await getRecentFaireOrders(14);
    if (orders14d === null) degraded.push("faire-orders: API unreachable");
    payouts45d = await getRecentFairePayouts(45);
    if (payouts45d === null) degraded.push("faire-payouts: API unreachable");
  }

  const digest: DigestData = {
    orders14d,
    payouts45d,
    degraded,
    generatedAt: run.startedAt,
  };

  const reconRendered = renderReconcile(digest);
  const directRendered = renderDirectShare(digest);

  const postResults: Array<{ channel: string; ok: boolean; note?: string }> = [];
  if (shouldPost) {
    for (const target of [
      { key: "finance" as const, text: reconRendered },
      { key: "sales" as const, text: directRendered },
    ]) {
      const channel = getChannel(target.key);
      if (!channel) {
        postResults.push({ channel: `#${target.key}`, ok: false, note: "channel not registered" });
        continue;
      }
      try {
        const res = await postMessage({ channel: slackChannelRef(target.key), text: target.text });
        postResults.push({ channel: channel.name, ok: res.ok });
      } catch (err) {
        postResults.push({
          channel: channel.name,
          ok: false,
          note: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  try {
    await auditStore().append(
      buildAuditEntry(run, {
        action: "slack.post.audit",
        entityType: "faire-digest",
        entityId: run.runId,
        result: "ok",
        sourceCitations: isFaireConfigured()
          ? [{ system: "faire:external-api-v2" }]
          : [],
        confidence: 1,
      }),
    );
  } catch {
    digest.degraded.push("audit-store: append failed (soft)");
  }

  return NextResponse.json({
    ok: true,
    runId: run.runId,
    mode: isFaireConfigured() ? "live" : "degraded",
    postResults,
    degraded: digest.degraded,
    reconcile: reconRendered,
    directShare: directRendered,
    stats: summarize(digest),
  });
}

// ---- Rendering + aggregation -------------------------------------------

interface Summary {
  orderCount: number;
  orderSubtotal: number;
  directCount: number;
  directShare: number;
  marketplaceCount: number;
  payoutCount: number;
  payoutTotal: number;
}

function summarize(d: DigestData): Summary {
  const orders = d.orders14d ?? [];
  const payouts = d.payouts45d ?? [];
  const orderCount = orders.length;
  const orderSubtotal = orders.reduce((a, o) => a + (o.subtotal ?? 0), 0);
  const directCount = orders.filter((o) => o.isDirect).length;
  const marketplaceCount = orderCount - directCount;
  const directShare = orderCount > 0 ? directCount / orderCount : 0;
  const payoutCount = payouts.length;
  const payoutTotal = payouts.reduce((a, p) => a + p.amount, 0);
  return {
    orderCount,
    orderSubtotal: Math.round(orderSubtotal * 100) / 100,
    directCount,
    directShare: Math.round(directShare * 1000) / 10,
    marketplaceCount,
    payoutCount,
    payoutTotal: Math.round(payoutTotal * 100) / 100,
  };
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderReconcile(d: DigestData): string {
  const header = `💸 *Faire — Weekly Reconciliation Prep (${new Date(d.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })})*`;
  if (d.payouts45d === null) {
    return [
      header,
      ``,
      `Payouts: _unavailable_ — ${d.degraded.join("; ") || "Faire API not reachable"}`,
      ``,
      `Rene: pull the weekly reconcile from the Faire brand portal manually until the API creds are wired.`,
    ].join("\n");
  }
  const s = summarize(d);
  if (d.payouts45d.length === 0) {
    return [
      header,
      ``,
      `No payouts landed in the last 45 days.`,
      ``,
      `_Source: faire:external-api-v2 · retrievedAt ${d.generatedAt}_`,
    ].join("\n");
  }
  const top = d.payouts45d.slice(0, 6);
  return [
    header,
    ``,
    `*Last 45 days:* ${s.payoutCount} payouts · ${money(s.payoutTotal)} total`,
    ...top.map((p) => `  • ${p.paidAt.slice(0, 10)} — ${money(p.amount)} (${p.currency})`),
    d.payouts45d.length > 6 ? `  _+ ${d.payouts45d.length - 6} more — full list in Faire portal._` : ``,
    ``,
    `_Source: faire:external-api-v2 · retrievedAt ${d.generatedAt}_`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderDirectShare(d: DigestData): string {
  const header = `🧭 *Faire — Direct-share Tracker (${new Date(d.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })})*`;
  if (d.orders14d === null) {
    return [
      header,
      ``,
      `Orders: _unavailable_ — ${d.degraded.join("; ") || "Faire API not reachable"}`,
      ``,
      `Ben: light up the Direct-share target once we wire \`FAIRE_ACCESS_TOKEN\` and re-run.`,
    ].join("\n");
  }
  const s = summarize(d);
  if (d.orders14d.length === 0) {
    return [
      header,
      ``,
      `No orders in the last 14 days.`,
      ``,
      `_Source: faire:external-api-v2 · retrievedAt ${d.generatedAt}_`,
    ].join("\n");
  }
  const topDirect = d.orders14d
    .filter((o) => o.isDirect)
    .sort((a, b) => (b.subtotal ?? 0) - (a.subtotal ?? 0))
    .slice(0, 5);
  return [
    header,
    ``,
    `*Last 14 days:* ${s.orderCount} orders · ${money(s.orderSubtotal)} subtotal`,
    `*Direct share:* ${s.directCount}/${s.orderCount} (${s.directShare}%) · target ≥ 60% per contract`,
    topDirect.length > 0
      ? `*Top direct orders:*\n${topDirect.map((o) => `  • ${o.retailerName ?? "(unknown retailer)"} · ${money(o.subtotal ?? 0)} · ${o.state}`).join("\n")}`
      : `_No direct orders yet — all 14-day volume is marketplace._`,
    ``,
    `_Each Direct-invite proposal is Class B (\`faire-direct.invite\`) per the specialist contract — posting one does not send it._`,
    `_Source: faire:external-api-v2 · retrievedAt ${d.generatedAt}_`,
  ].join("\n");
}
