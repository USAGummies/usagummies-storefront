/**
 * POST /api/wholesale/onboarding/advance — Phase 35.f.1
 *
 * Single-route bridge between an HTTP request and the Phase 35.b
 * state machine + Phase 35.e KV persistence layer. Public-facing
 * (no auth) — same posture as `/api/leads`. The state machine
 * itself is the authorization boundary: out-of-order POSTs throw.
 *
 * **Request body:**
 *   {
 *     "flowId"?: string,    // required AFTER step 1
 *     "step": OnboardingStep,
 *     "payload"?: unknown   // step-specific shape — see applyStepPayload
 *   }
 *
 * **Response (success):** 200
 *   {
 *     "ok": true,
 *     "flowId": "wf_<uuid>",
 *     "currentStep": OnboardingStep,
 *     "nextStep": OnboardingStep | null,
 *     "stepsCompleted": OnboardingStep[],
 *     "sideEffectsPending": SideEffect[]
 *   }
 *
 * **Response (error):**
 *   - 400 — invalid step, missing flowId after step 1, validation
 *           errors from applyStepPayload, out-of-order step
 *   - 404 — flowId unknown / TTL-expired
 *   - 500 — KV failure
 *
 * **Side-effect dispatch is OUT OF SCOPE for this route.** The
 * route returns `sideEffectsPending` so the caller (or a separate
 * dispatcher route in Phase 35.f.3) can fire HubSpot / QBO /
 * Slack / AP-packet writes. This separation lets us:
 *   - Test the state-machine surface without external mocks.
 *   - Re-fire dispatch idempotently if the dispatcher fails
 *     (`sideEffectsPending` is a function of state, not a queue).
 *   - Batch dispatches without re-running validation.
 */
import { NextResponse } from "next/server";

import {
  ONBOARDING_STEPS,
  advanceStep,
  applyStepPayload,
  newOnboardingState,
  nextStep,
  sideEffectsForStep,
  type OnboardingStep,
} from "@/lib/wholesale/onboarding-flow";
import {
  loadOnboardingState,
  mintFlowId,
  saveOnboardingState,
} from "@/lib/wholesale/onboarding-store";

interface AdvanceRequestBody {
  flowId?: string;
  step?: string;
  payload?: unknown;
}

function json(data: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isOnboardingStep(value: unknown): value is OnboardingStep {
  return (
    typeof value === "string" &&
    (ONBOARDING_STEPS as readonly string[]).includes(value)
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: AdvanceRequestBody;
  try {
    body = (await request.json()) as AdvanceRequestBody;
  } catch {
    return json({ ok: false, errors: ["request body must be JSON"] }, 400);
  }

  const step = body.step;
  if (!isOnboardingStep(step)) {
    return json(
      {
        ok: false,
        errors: [
          `step must be one of: ${ONBOARDING_STEPS.join(", ")}`,
        ],
      },
      400,
    );
  }

  // Resolve current state: load existing, or create fresh on step 1.
  let state;
  let flowId = typeof body.flowId === "string" ? body.flowId.trim() : "";

  if (flowId) {
    const loaded = await loadOnboardingState(flowId).catch(() => null);
    if (!loaded) {
      return json(
        { ok: false, errors: [`flow ${flowId} not found`] },
        404,
      );
    }
    state = loaded;
  } else {
    if (step !== "info") {
      return json(
        {
          ok: false,
          errors: [
            "flowId required for any step beyond `info` (call with step:'info' first to mint a flowId)",
          ],
        },
        400,
      );
    }
    flowId = mintFlowId();
    state = newOnboardingState(flowId);
  }

  // Validate + translate the payload into a state mutator.
  const apply = applyStepPayload(step, body.payload);
  if (!apply.ok) {
    return json({ ok: false, errors: apply.errors, flowId }, 400);
  }

  // Advance the state machine. Out-of-order POSTs throw → 400.
  let nextState;
  try {
    nextState = advanceStep(state, step, new Date(), apply.mutator);
  } catch (err) {
    return json(
      {
        ok: false,
        errors: [err instanceof Error ? err.message : String(err)],
        flowId,
      },
      400,
    );
  }

  // Persist. If KV is hard-down, return 500 — but log the state
  // transition the caller saw so it's debuggable.
  try {
    await saveOnboardingState(nextState);
  } catch (err) {
    return json(
      {
        ok: false,
        errors: [
          `persist failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ],
        flowId,
      },
      500,
    );
  }

  return json({
    ok: true,
    flowId,
    currentStep: nextState.currentStep,
    nextStep: nextStep(nextState),
    stepsCompleted: nextState.stepsCompleted,
    sideEffectsPending: sideEffectsForStep(step, nextState),
  });
}
