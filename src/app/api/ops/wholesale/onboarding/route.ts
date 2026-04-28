/**
 * GET /api/ops/wholesale/onboarding — Phase 35.f.5
 *
 * Auth-gated read-only surface for Rene's stalled-flow review.
 * Lists recent OnboardingState envelopes so Rene can spot leads
 * that froze mid-onboarding and chase them.
 *
 * Per-flow shape returned:
 *   - flowId, currentStep, stepsCompleted, completedCount
 *   - prospect (companyName, contactName, contactEmail) — minimal
 *   - paymentPath, orderLines (count + total subtotal)
 *   - hubspotDealId, qboCustomerApprovalId (when present)
 *   - lastTimestamp — most recent step transition
 *   - stalled — heuristic: nextStep is non-null AND lastTimestamp
 *               is older than 24h (configurable via ?stallHours=N)
 *
 * **Auth:** session OR `Authorization: Bearer $CRON_SECRET`. Same
 * pattern as `/api/ops/wholesale/inquiries`. Middleware-level
 * session gate applies for browser callers; CRON callers need the
 * prefix to be in `SELF_AUTHENTICATED_PREFIXES` (handled in this
 * commit).
 *
 * **Read-only.** No KV / HubSpot / QBO mutation.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  nextStep,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/wholesale/onboarding-flow";
import { listRecentFlows } from "@/lib/wholesale/onboarding-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FlowSummary {
  flowId: string;
  currentStep: OnboardingStep;
  stepsCompleted: OnboardingStep[];
  completedCount: number;
  nextStep: OnboardingStep | null;
  prospect?: {
    companyName: string;
    contactName: string;
    contactEmail: string;
  };
  paymentPath?: "credit-card" | "accounts-payable";
  orderLineCount: number;
  totalSubtotalUsd: number;
  hubspotDealId?: string;
  qboCustomerApprovalId?: string;
  lastTimestamp?: string;
  stalled: boolean;
}

const DEFAULT_STALL_HOURS = 24;

function summarizeFlow(
  state: OnboardingState,
  stallMs: number,
  now: Date,
): FlowSummary {
  const completedCount = state.stepsCompleted.length;
  const next = nextStep(state);
  const totalSubtotalUsd = state.orderLines.reduce(
    (acc, l) => acc + l.subtotalUsd,
    0,
  );
  const lastTimestamp = mostRecentTimestamp(state);
  const stalled =
    next !== null &&
    lastTimestamp !== undefined &&
    now.getTime() - new Date(lastTimestamp).getTime() > stallMs;

  return {
    flowId: state.flowId,
    currentStep: state.currentStep,
    stepsCompleted: state.stepsCompleted as OnboardingStep[],
    completedCount,
    nextStep: next,
    prospect: state.prospect,
    paymentPath: state.paymentPath,
    orderLineCount: state.orderLines.length,
    totalSubtotalUsd: Math.round(totalSubtotalUsd * 100) / 100,
    hubspotDealId: state.hubspotDealId,
    qboCustomerApprovalId: state.qboCustomerApprovalId,
    lastTimestamp,
    stalled,
  };
}

function mostRecentTimestamp(state: OnboardingState): string | undefined {
  const stamps = Object.values(state.timestamps).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (stamps.length === 0) return undefined;
  return stamps.reduce((a, b) => (a > b ? a : b));
}

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, rawLimit))
    : 50;
  const rawStall = Number.parseInt(
    url.searchParams.get("stallHours") ?? String(DEFAULT_STALL_HOURS),
    10,
  );
  const stallHours = Number.isFinite(rawStall)
    ? Math.max(1, Math.min(720, rawStall))
    : DEFAULT_STALL_HOURS;
  const stallMs = stallHours * 3_600_000;
  const onlyStalled = url.searchParams.get("stalledOnly") === "true";

  const now = new Date();
  try {
    const flows = await listRecentFlows({ limit });
    let summaries = flows.map((s) => summarizeFlow(s, stallMs, now));
    if (onlyStalled) {
      summaries = summaries.filter((s) => s.stalled);
    }
    return NextResponse.json({
      ok: true,
      total: summaries.length,
      stallHours,
      flows: summaries,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "kv_read_failed",
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
