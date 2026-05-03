/**
 * GET|POST /api/ops/agents/crm-hygiene/run
 *
 * Wholesale Pipeline Commander — CRM hygiene scan.
 *
 * Per Ben's 2026-05-03 strategic plan ("CRM Hygiene + Follow-Up Agent"):
 * the agent should be boring and relentless. Every morning it should
 * surface the deals that need attention so HubSpot acts like a sales
 * manager instead of a passive record store. Detectors:
 *   - missing-field         — empty dealname
 *   - stale-deal            — no activity past per-stage threshold
 *   - zero-dollar           — revenue stage with amount = 0/null
 *   - stuck-in-stage        — past per-stage max dwell
 *   - duplicate-name        — multiple deals with same normalized name
 *   - closed-with-open-amount — Closed Lost still carrying $
 *
 * Fail-soft: HubSpot fetch error → audit envelope with degraded reason
 * + #ops-alerts mirror, not a 500. Quiet-collapse: zero findings = no
 * Slack post (audit envelope still records the run).
 *
 * Channel: #sales (post=true default). Override post=false for
 * dry-run / debug.
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { auditStore } from "@/lib/ops/control-plane/stores";
import { buildAuditEntry } from "@/lib/ops/control-plane/audit";
import { getChannel, slackChannelRef } from "@/lib/ops/control-plane/channels";
import { postMessage } from "@/lib/ops/control-plane/slack";
import {
  isHubSpotConfigured,
  listRecentDeals,
} from "@/lib/ops/hubspot-client";
import { runHygieneScan } from "@/lib/sales/crm-hygiene/detectors";
import { composeHygieneDigest } from "@/lib/sales/crm-hygiene/summarizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ID = "crm-hygiene";
const DEAL_FETCH_LIMIT = 500;
const DIGEST_TOP_N = 12;

interface RunResult {
  ok: boolean;
  runId: string;
  asOf: string;
  postedTo: string | null;
  totalFindings: number;
  affectedDeals: number;
  bySeverity: { critical: number; warn: number; info: number };
  byKind: Record<string, number>;
  rendered: string | null;
  degraded: string[];
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
    trigger: "weekday-morning-hygiene",
  });

  const asOf = new Date();
  const degraded: string[] = [];

  // ---- Pull deals ----
  if (!isHubSpotConfigured()) {
    degraded.push("HubSpot not configured (HUBSPOT_PRIVATE_APP_TOKEN unset).");
    return NextResponse.json({
      ok: true,
      runId: run.runId,
      asOf: asOf.toISOString(),
      postedTo: null,
      totalFindings: 0,
      affectedDeals: 0,
      bySeverity: { critical: 0, warn: 0, info: 0 },
      byKind: {},
      rendered: null,
      degraded,
    } satisfies RunResult);
  }

  let deals: Awaited<ReturnType<typeof listRecentDeals>> = [];
  try {
    deals = await listRecentDeals({ limit: DEAL_FETCH_LIMIT });
  } catch (err) {
    degraded.push(
      `listRecentDeals failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ---- Run detectors ----
  const findings = runHygieneScan(deals, asOf, { topN: DIGEST_TOP_N });

  // ---- Render digest ----
  const rendered = composeHygieneDigest(findings, {
    forDate: asOf.toISOString().slice(0, 10),
    totalDealsScanned: deals.length,
    topN: DIGEST_TOP_N,
  });

  // ---- Post to Slack (#sales) ----
  let postedTo: string | null = null;
  if (shouldPost && rendered) {
    if (getChannel("sales")) {
      try {
        const res = await postMessage({
          channel: slackChannelRef("sales"),
          text: rendered,
        });
        if (res.ok) postedTo = "#sales";
        else degraded.push(`slack-post: ${res.error ?? "unknown error"}`);
      } catch (err) {
        degraded.push(
          `slack-post: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      degraded.push("slack-post: #sales channel not registered");
    }
  }

  // ---- Audit envelope ----
  // Same `slack.post.audit` Class-A slug pattern as the other specialists
  // (finance-exception, ops, compliance, faire, reconciliation, etc.).
  // Result is "ok" even when degraded — failures surface in `after.degraded`.
  const byKindCounts: Record<string, number> = {};
  for (const [kind, list] of Object.entries(findings.byKind)) {
    byKindCounts[kind] = list.length;
  }
  try {
    await auditStore().append(
      buildAuditEntry(run, {
        action: "slack.post.audit",
        entityType: "crm-hygiene-digest",
        entityId: asOf.toISOString().slice(0, 10),
        result: "ok",
        after: {
          summary:
            findings.total === 0
              ? "CRM hygiene clean — no findings"
              : `${findings.total} hygiene finding${findings.total === 1 ? "" : "s"} across ${findings.affectedDealIds.length} deal${findings.affectedDealIds.length === 1 ? "" : "s"} (${findings.bySeverity.critical} critical · ${findings.bySeverity.warn} warn · ${findings.bySeverity.info} info)`,
          totalFindings: findings.total,
          affectedDeals: findings.affectedDealIds.length,
          dealsScanned: deals.length,
          bySeverity: findings.bySeverity,
          byKind: byKindCounts,
          postedTo,
          degraded,
        },
        sourceCitations: [
          {
            system: "hubspot:deals",
            id: `recent-${deals.length}`,
          },
        ],
        confidence: 1.0,
      }),
    );
  } catch (err) {
    degraded.push(
      `audit-store: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return NextResponse.json({
    ok: true,
    runId: run.runId,
    asOf: asOf.toISOString(),
    postedTo,
    totalFindings: findings.total,
    affectedDeals: findings.affectedDealIds.length,
    bySeverity: findings.bySeverity,
    byKind: byKindCounts,
    rendered,
    degraded,
  } satisfies RunResult);
}

export async function GET(req: Request): Promise<Response> {
  return runAgent(req);
}

export async function POST(req: Request): Promise<Response> {
  return runAgent(req);
}
