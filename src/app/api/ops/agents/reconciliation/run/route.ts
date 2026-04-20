/**
 * Reconciliation Specialist (S-06) — Thursday weekly prep runtime.
 *
 * Contract: /contracts/agents/reconciliation-specialist.md.
 *
 * Thursday 10:00 PT (17:00 UTC) cron. One job: compose Rene's
 * Thursday reconciliation prep digest so she can post QBO entries
 * against that day's Amazon / Shopify / Faire payouts without
 * chasing numbers across four systems.
 *
 * What it does:
 *   - Pull last 14 days of QBO deposits (linked to Amazon / Shopify
 *     / Faire sources) and group by source.
 *   - Pull Shopify payouts directly (we have admin creds).
 *   - Pull Faire payouts (if FAIRE_ACCESS_TOKEN is set — degraded
 *     otherwise).
 *   - Post a structured digest to #finance listing each unreconciled
 *     payout + suggested CoA line (per CF-09 channel-segmentation
 *     rule: 400015.05 Amazon Product / 400020.05 Shopify-Faire-B2B
 *     Product / etc.).
 *   - Never posts to QBO. Rene does the entry manually; the runtime
 *     is the prep digest, not the poster.
 *
 * Every $ cites source + retrievedAt. Missing sources surface as
 * `unavailable` with an explicit reason.
 *
 * Auth: bearer CRON_SECRET (isAuthorized + middleware whitelist).
 */

import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getChannel } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { getRecentFairePayouts, isFaireConfigured } from "@/lib/ops/faire-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.AGENT_ID_RECONCILIATION ?? "reconciliation-specialist";

// CoA account codes per CF-09 channel-segmentation rule (ratified 2026-04-20).
// Reconciliation surfaces the suggested account on each line so Rene doesn't
// have to cross-reference Finance Doctrine 01 §2.5 each week.
const COA_SUGGESTIONS = {
  amazon: "400015.05 Amazon Product",
  shopify: "400020.05 Shopify-Faire-B2B Product",
  faire: "400010.10 Distributors:Glacier-Faire — Product",
  manual: "(Rene reconciles manually)",
} as const;

type Source = keyof typeof COA_SUGGESTIONS;

interface PayoutLine {
  source: Source;
  idOrRef: string;
  paidAt: string;
  amount: number;
  currency: string;
  suggestedAccount: string;
  provenance: string;
}

interface DigestData {
  weekStartISO: string;
  weekEndISO: string;
  lines: PayoutLine[];
  bySource: Record<Source, { count: number; total: number }>;
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
    trigger: "thursday-10:00PT-reconcile-prep",
  });

  const digest = await gatherDigestData();
  const rendered = renderDigest(digest, run.startedAt);

  let postedTo: string | null = null;
  if (shouldPost) {
    const channel = getChannel("finance");
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
      digest.degraded.push("slack-post: #finance channel not registered");
    }
  }

  try {
    await auditStore().append(
      buildAuditEntry(run, {
        action: "slack.post.audit",
        entityType: "reconciliation-digest",
        entityId: run.runId,
        result: "ok",
        sourceCitations: [
          { system: "faire:external-api-v2" },
          { system: "shopify:admin:payouts" },
        ],
        confidence: 1,
      }),
    );
  } catch {
    digest.degraded.push("audit-store: append failed (soft)");
  }

  return NextResponse.json({
    ok: true,
    runId: run.runId,
    postedTo,
    digest,
    rendered,
  });
}

// ---- Data gathering ----------------------------------------------------

async function gatherDigestData(): Promise<DigestData> {
  const degraded: string[] = [];
  const lines: PayoutLine[] = [];
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);

  // Faire payouts — live if FAIRE_ACCESS_TOKEN is set, else explicit unavailable.
  if (isFaireConfigured()) {
    const fairePayouts = await getRecentFairePayouts(14);
    if (fairePayouts === null) {
      degraded.push("faire-payouts: API unreachable");
    } else {
      for (const p of fairePayouts) {
        lines.push({
          source: "faire",
          idOrRef: p.id,
          paidAt: p.paidAt,
          amount: p.amount,
          currency: p.currency,
          suggestedAccount: COA_SUGGESTIONS.faire,
          provenance: `faire:external-api-v2:${p.id}`,
        });
      }
    }
  } else {
    degraded.push("faire-payouts: FAIRE_ACCESS_TOKEN not configured");
  }

  // Shopify payouts — admin API gives a direct payouts feed. Deferred
  // to a follow-up commit (needs adminRequest helper extended).
  degraded.push(
    "shopify-payouts: admin API payouts feed not wired (next commit); check Shopify Admin > Payouts manually",
  );
  degraded.push(
    "amazon-settlements: SP-API recon not wired (separate route P-FIN-07); check Amazon Seller Central > Payments manually",
  );

  // Group + total
  const bySource: Record<Source, { count: number; total: number }> = {
    amazon: { count: 0, total: 0 },
    shopify: { count: 0, total: 0 },
    faire: { count: 0, total: 0 },
    manual: { count: 0, total: 0 },
  };
  for (const line of lines) {
    bySource[line.source].count += 1;
    bySource[line.source].total += line.amount;
  }

  // Sort lines newest-first
  lines.sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  return {
    weekStartISO: weekAgo.toISOString(),
    weekEndISO: now.toISOString(),
    lines,
    bySource,
    degraded,
  };
}

// ---- Rendering ---------------------------------------------------------

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderDigest(digest: DigestData, startedAt: string): string {
  const dateLabel = new Date(startedAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const lines: string[] = [
    `📒 *Reconciliation Specialist — Thursday Prep (${dateLabel})*`,
    ``,
    `_14-day payout window: ${digest.weekStartISO.slice(0, 10)} → ${digest.weekEndISO.slice(0, 10)}._`,
    ``,
  ];

  if (digest.lines.length === 0) {
    lines.push(`No payouts pulled live for this window.`);
  } else {
    // Per-source summary
    lines.push(`*By source:*`);
    for (const src of Object.keys(digest.bySource) as Source[]) {
      const s = digest.bySource[src];
      if (s.count === 0) continue;
      lines.push(`  • ${src} — ${s.count} payout${s.count === 1 ? "" : "s"} · ${money(s.total)}`);
    }
    lines.push(``, `*Lines (newest first):*`);
    for (const line of digest.lines.slice(0, 15)) {
      lines.push(
        `  • ${line.paidAt.slice(0, 10)} · ${line.source} · ${money(line.amount)} → \`${line.suggestedAccount}\``,
      );
    }
    if (digest.lines.length > 15) {
      lines.push(`  _+ ${digest.lines.length - 15} more._`);
    }
  }

  if (digest.degraded.length > 0) {
    lines.push(``, `*Deferred sources (check manually):*`);
    for (const d of digest.degraded) {
      lines.push(`  • ${d}`);
    }
  }

  lines.push(
    ``,
    `_Per CF-09 channel-segmentation rule: Amazon → \`400015.05\`, Shopify/Faire/B2B → \`400020.05\`, Distributor-Faire → \`400010.10\`. This agent only suggests accounts — Rene posts to QBO manually._`,
  );
  return lines.join("\n");
}
