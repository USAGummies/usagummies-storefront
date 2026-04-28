/**
 * GET /api/wholesale/onboarding/state — Phase 35.f.2
 *
 * Resume / inspect a previously-started onboarding flow. Public-
 * facing (no auth). The flowId is the only credential — anyone
 * with the flowId can read the state. Treat flowId like a session
 * cookie: don't leak it in URLs you wouldn't accept being shared.
 *
 * **Request:** `GET /api/wholesale/onboarding/state?flowId=wf_<uuid>`
 *
 * **Response (success):** 200
 *   {
 *     "ok": true,
 *     "state": OnboardingState,
 *     "nextStep": OnboardingStep | null
 *   }
 *
 * **Response (error):**
 *   - 400 — missing flowId query param
 *   - 404 — flow not found / TTL-expired
 *
 * Used by the multi-step UI client to recover from page reloads
 * and by Rene's stalled-flow review surface (Phase 35.f+) to chase
 * leads that froze mid-onboarding.
 */
import { NextResponse } from "next/server";

import { nextStep } from "@/lib/wholesale/onboarding-flow";
import { loadOnboardingState } from "@/lib/wholesale/onboarding-store";

function json(data: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const flowId = (url.searchParams.get("flowId") ?? "").trim();

  if (!flowId) {
    return json(
      { ok: false, errors: ["flowId query param required"] },
      400,
    );
  }

  const state = await loadOnboardingState(flowId).catch(() => null);
  if (!state) {
    return json(
      { ok: false, errors: [`flow ${flowId} not found`] },
      404,
    );
  }

  return json({
    ok: true,
    state,
    nextStep: nextStep(state),
  });
}
