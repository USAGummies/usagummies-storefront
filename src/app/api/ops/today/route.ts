/**
 * GET /api/ops/today
 *
 * "Ben checks in once" digest. Aggregates the operator state Ben needs
 * to glance at to know what's waiting on him. In-process: pulls from
 * the approval store + audit log + agent manifest; no outbound HTTP.
 *
 * Returns a stable `TodayDigest` shape rolled up by `today-digest.ts`.
 *
 * Each source is fail-soft — a failed fetch surfaces in `degraded`,
 * the rest of the digest still loads.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  AGENT_MANIFEST,
  buildAgentHealthRows,
  summarizeAgentHealth,
} from "@/lib/ops/agent-health";
import {
  evaluateAllGraduations,
  groupAuditByAgent,
} from "@/lib/ops/agent-graduation";
import { approvalStore, auditStore } from "@/lib/ops/control-plane/stores";
import type {
  ApprovalRequest,
  AuditLogEntry,
} from "@/lib/ops/control-plane/types";
import { buildTodayDigest } from "@/lib/ops/today-digest";
import {
  detectOffGridQuotes,
  type QuoteCandidate,
} from "@/lib/finance/off-grid-quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIT_FETCH_LIMIT = 5000;

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const degraded: string[] = [];

  // ----- Source 1: pending approvals -------------------------------------
  let pending: ApprovalRequest[] = [];
  try {
    pending = await approvalStore().listPending();
  } catch (err) {
    degraded.push(
      `approvals: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ----- Source 2: audit log (for off-grid + agent run history) ----------
  let audit: AuditLogEntry[] = [];
  try {
    audit = (await auditStore().recent(AUDIT_FETCH_LIMIT)) as AuditLogEntry[];
  } catch (err) {
    degraded.push(
      `audit: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ----- Source 3: extract off-grid candidates from audit ---------------
  // We mine the audit log for any entries whose action is a quote-emitting
  // verb and whose `after` payload includes a per-bag price + bag count.
  // The booth-quote engine + sales-tour KV writers both emit this shape;
  // anything else is silently skipped.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates: QuoteCandidate[] = [];
  for (const e of audit) {
    const t = Date.parse(e.createdAt);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const after = e.after as { pricePerBagUsd?: number; bagCount?: number; customerName?: string } | undefined;
    if (!after || typeof after.pricePerBagUsd !== "number") continue;
    if (typeof after.bagCount !== "number") continue;
    candidates.push({
      id: e.id,
      source:
        e.action.includes("booth")
          ? "booth_quote"
          : e.action.includes("hubspot")
            ? "hubspot_deal"
            : e.action.includes("sales-tour") || e.action.includes("sales_tour")
              ? "sales_tour"
              : "manual_invoice",
      customerName: after.customerName ?? e.entityId ?? "unknown",
      pricePerBagUsd: after.pricePerBagUsd,
      bagCount: after.bagCount,
      createdAt: e.createdAt,
    });
  }
  const offGridQuotes = detectOffGridQuotes(candidates);

  // ----- Source 4: agent health + graduation -----------------------------
  const rows = buildAgentHealthRows(AGENT_MANIFEST);
  const healthSummary = summarizeAgentHealth(rows);
  const auditByAgent = groupAuditByAgent(audit, AGENT_MANIFEST);
  const gauges = evaluateAllGraduations({
    rows,
    auditByAgent,
    now: new Date(),
  });

  const digest = buildTodayDigest({
    pendingApprovals: pending,
    offGridQuotes,
    health: healthSummary,
    gauges,
    rows,
    degraded,
    now: new Date(),
  });

  return NextResponse.json({ ok: true, digest });
}
