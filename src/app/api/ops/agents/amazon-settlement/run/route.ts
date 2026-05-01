/**
 * Amazon Settlement Recon — P-FIN-07 runtime.
 *
 * Weekly cron (Thursday 11:00 PT / 18:00 UTC) — runs just after the
 * Reconciliation Specialist so Rene has both feeds side-by-side.
 *
 * Pulls the most recent Amazon financial event groups (settlement
 * periods) via SP-API and posts a digest to #finance with:
 *   - Per-settlement payout total + fund-transfer date
 *   - CF-09 account-code suggestion (400015.05 Amazon Product)
 *   - Processing status (Open / Closed / AccountLocked / etc.)
 *
 * This agent does NOT post to QBO — Rene reconciles each settlement
 * into QBO manually. The runtime is the prep digest; ratification
 * of the CoA mapping is Rene's judgment call per instance (per
 * Finance Doctrine 01 §2.5).
 *
 * Degraded-mode contract: if Amazon SP-API creds are missing or
 * fail, surface `unavailable` with an explicit reason. Governance
 * §1.6 no-fabrication.
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
  fetchFinancialEventGroups,
  isAmazonConfigured,
} from "@/lib/amazon/sp-api";
import type { FinancialEventGroup } from "@/lib/amazon/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.AGENT_ID_AMAZON_SETTLEMENT ?? "amazon-settlement";
const WINDOW_DAYS = 30;
const COA_AMAZON_PRODUCT = "400015.05 Amazon Product";

interface SettlementLine {
  groupId: string;
  startISO: string | null;
  endISO: string | null;
  fundTransferISO: string | null;
  amount: number;
  currency: string;
  processingStatus: string;
  fundTransferStatus: string;
  suggestedAccount: string;
}

interface DigestData {
  windowStartISO: string;
  windowEndISO: string;
  settlements: SettlementLine[];
  totalPayout: number;
  degraded: string[];
  retrievedAt: string;
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
    division: "financials",
    source: "scheduled",
    trigger: "thursday-11:00PT-amazon-settlement-recon",
  });

  const digest = await gatherDigestData();
  const rendered = renderDigest(digest, run.startedAt);

  let postedTo: string | null = null;
  if (shouldPost) {
    const channel = getChannel("finance");
    if (channel) {
      try {
        const res = await postMessage({ channel: slackChannelRef("finance"), text: rendered });
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
        entityType: "amazon-settlement-digest",
        entityId: run.runId,
        result: "ok",
        sourceCitations: isAmazonConfigured()
          ? [{ system: "amazon:sp-api:financialEventGroups" }]
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
    postedTo,
    digest,
    rendered,
  });
}

async function gatherDigestData(): Promise<DigestData> {
  const degraded: string[] = [];
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
  const retrievedAt = now.toISOString();

  if (!isAmazonConfigured()) {
    degraded.push("Amazon SP-API creds not configured");
    return {
      windowStartISO: windowStart.toISOString(),
      windowEndISO: now.toISOString(),
      settlements: [],
      totalPayout: 0,
      degraded,
      retrievedAt,
    };
  }

  let groups: FinancialEventGroup[] = [];
  try {
    groups = await fetchFinancialEventGroups(
      windowStart.toISOString(),
      now.toISOString(),
    );
  } catch (err) {
    degraded.push(
      `sp-api: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      windowStartISO: windowStart.toISOString(),
      windowEndISO: now.toISOString(),
      settlements: [],
      totalPayout: 0,
      degraded,
      retrievedAt,
    };
  }

  const settlements: SettlementLine[] = groups.map((g): SettlementLine => {
    const amount =
      g.ConvertedTotal?.CurrencyAmount ?? g.OriginalTotal?.CurrencyAmount ?? 0;
    const currency =
      g.ConvertedTotal?.CurrencyCode ?? g.OriginalTotal?.CurrencyCode ?? "USD";
    return {
      groupId: g.FinancialEventGroupId,
      startISO: g.FinancialEventGroupStart ?? null,
      endISO: g.FinancialEventGroupEnd ?? null,
      fundTransferISO: g.FundTransferDate ?? null,
      amount: Math.round(amount * 100) / 100,
      currency,
      processingStatus: g.ProcessingStatus,
      fundTransferStatus: g.FundTransferStatus,
      suggestedAccount: COA_AMAZON_PRODUCT,
    };
  });

  // Sort newest-first by fund-transfer date (falls back to end date).
  settlements.sort((a, b) => {
    const aKey = a.fundTransferISO ?? a.endISO ?? "";
    const bKey = b.fundTransferISO ?? b.endISO ?? "";
    return bKey.localeCompare(aKey);
  });

  const totalPayout = Math.round(
    settlements.reduce((a, s) => a + s.amount, 0) * 100,
  ) / 100;

  return {
    windowStartISO: windowStart.toISOString(),
    windowEndISO: now.toISOString(),
    settlements,
    totalPayout,
    degraded,
    retrievedAt,
  };
}

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderDigest(digest: DigestData, startedAt: string): string {
  const dateLabel = new Date(startedAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const lines: string[] = [
    `📦 *Amazon Settlement Recon — Weekly (${dateLabel})*`,
    ``,
    `_30-day settlement window: ${digest.windowStartISO.slice(0, 10)} → ${digest.windowEndISO.slice(0, 10)}._`,
    ``,
  ];

  if (digest.settlements.length === 0) {
    if (digest.degraded.length > 0) {
      lines.push(`Settlements: _unavailable_ — ${digest.degraded.join("; ")}`);
    } else {
      lines.push(`No Amazon settlements closed in the window.`);
    }
  } else {
    lines.push(
      `*Total:* ${money(digest.totalPayout)} across ${digest.settlements.length} settlement group${digest.settlements.length === 1 ? "" : "s"}.`,
    );
    lines.push(``);
    const top = digest.settlements.slice(0, 8);
    for (const s of top) {
      const date = s.fundTransferISO?.slice(0, 10) ?? s.endISO?.slice(0, 10) ?? "?";
      const status =
        s.fundTransferStatus === "Successful"
          ? ":white_check_mark:"
          : s.fundTransferStatus === "Pending"
            ? "⏳"
            : "⚠️";
      lines.push(
        `  • ${date} ${status} — ${money(s.amount)} · \`${s.suggestedAccount}\` · status=${s.processingStatus}/${s.fundTransferStatus}`,
      );
    }
    if (digest.settlements.length > top.length) {
      lines.push(`  _+ ${digest.settlements.length - top.length} more in the window._`);
    }
  }

  if (digest.degraded.length > 0 && digest.settlements.length > 0) {
    lines.push(``, `_Degraded sources:_ ${digest.degraded.join(" | ")}`);
  }

  lines.push(
    ``,
    `_CF-09: Amazon settlement deposits reconcile to \`400015.05 Amazon Product\` (net after fees). This agent only suggests the account — Rene posts to QBO manually. Source: amazon:sp-api:financialEventGroups · retrievedAt ${digest.retrievedAt}._`,
  );
  return lines.join("\n");
}
