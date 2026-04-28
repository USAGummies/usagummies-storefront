/**
 * GET /api/ops/wholesale/chase-email — Phase 35.f.7
 *
 * Auth-gated read-only endpoint that returns a draft chase email
 * for a specific stalled flow. Used by the ops surface (Rene
 * copy-paste) and by a future "create Gmail draft" action.
 *
 * **Query params:**
 *   - flowId (required) — which flow to chase
 *   - resumeBase (optional) — base URL the chase email should
 *     point the customer back to (default
 *     `https://www.usagummies.com/wholesale/order`)
 *
 * **Response:**
 *   { ok: true, draft: { subject, plainText, to, greetingName },
 *     flow: { flowId, currentStep, hoursSinceLastTouch } }
 *   | { ok: false, error: "..." }
 *
 * Status codes:
 *   - 401 unauthorized
 *   - 400 missing flowId
 *   - 404 flow not found
 *   - 422 prospect missing (email cannot be drafted)
 *   - 200 happy path
 *
 * **Read-only.** Never sends email. Never persists drafts. The
 * returned plainText is what Rene pastes into Gmail (Phase 35.f.7.b
 * would add a Class A `gmail.draft.create` action that creates the
 * draft for him to review before send).
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { buildChaseEmail } from "@/lib/wholesale/chase-email";
import {
  loadOnboardingState,
} from "@/lib/wholesale/onboarding-store";
import type { OnboardingState } from "@/lib/wholesale/onboarding-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RESUME_BASE = "https://www.usagummies.com/wholesale/order";

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
  const flowId = (url.searchParams.get("flowId") ?? "").trim();
  if (!flowId) {
    return NextResponse.json(
      { ok: false, error: "flowId query param required" },
      { status: 400 },
    );
  }

  const resumeBase = (
    url.searchParams.get("resumeBase") ?? DEFAULT_RESUME_BASE
  ).trim() || DEFAULT_RESUME_BASE;

  let state: OnboardingState | null;
  try {
    state = await loadOnboardingState(flowId);
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

  if (!state) {
    return NextResponse.json(
      { ok: false, error: `flow ${flowId} not found` },
      { status: 404 },
    );
  }

  const last = mostRecentTimestamp(state);
  const hoursSinceLastTouch = last
    ? (Date.now() - new Date(last).getTime()) / 3_600_000
    : 0;

  const resumeUrl = `${resumeBase}?flowId=${encodeURIComponent(state.flowId)}`;
  const draft = buildChaseEmail(state, {
    hoursSinceLastTouch,
    resumeUrl,
  });

  if (!draft) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "draft unavailable — state.prospect missing or contactEmail empty",
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    draft,
    flow: {
      flowId: state.flowId,
      currentStep: state.currentStep,
      hoursSinceLastTouch: Math.round(hoursSinceLastTouch * 10) / 10,
    },
  });
}
