/**
 * POST /api/ops/wholesale/send-ap-packet — Phase 35.f.3.c (one-off route)
 *
 * Auth-gated explicit-context route for sending the wholesale-AP
 * onboarding packet. Used for:
 *
 *   1. **First-customer Mike at Thanksgiving Point** (this is the
 *      route the other agent calls once QBO invoice is created).
 *   2. Any future one-off send where the dispatcher state machine
 *      is NOT the entry point (e.g. trade-show conversations,
 *      manual sales follow-ups, retroactive sends after a flow
 *      stalled).
 *
 * The dispatcher's state-machine `apPacketSend` handler uses the
 * SAME underlying helper (`sendWholesaleApPacket`) so both surfaces
 * produce identical audit trail + BCC-Rene + email body.
 *
 * **Request body:**
 *   {
 *     "flowId"?: string,         // resume an existing flow
 *     "state"?: OnboardingState, // OR pass full state explicitly
 *     "invoiceContext"?: {
 *       "invoiceNumber"?: string,
 *       "invoiceDriveFileId"?: string,
 *       "totalUsdOverride"?: number,
 *       "personalNote"?: string
 *     }
 *   }
 *
 * Either `flowId` (load from KV) OR `state` (passed inline) is
 * required. Inline `state` is for one-offs where the customer
 * never went through the web flow (Mike is captured directly from
 * a phone call).
 *
 * **Response (success):** 200
 *   { "ok": true, "gmailMessageId": string, "to": string }
 *
 * **Response (error):**
 *   - 401 unauthorized
 *   - 400 missing flowId AND state, or invalid body shape
 *   - 404 flowId provided but state not found in KV
 *   - 422 packet-not-sendable (prospect missing, orderLines empty, etc.)
 *   - 500 Drive fetch / Gmail send / KV failure
 *
 * **Auth:** session OR Bearer $CRON_SECRET. Same posture as the
 * other /api/ops/wholesale/* routes.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { sendWholesaleApPacket } from "@/lib/wholesale/onboarding-dispatch-prod";
import { loadOnboardingState } from "@/lib/wholesale/onboarding-store";
import type { OnboardingState } from "@/lib/wholesale/onboarding-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  flowId?: string;
  state?: OnboardingState;
  invoiceContext?: {
    invoiceNumber?: string;
    invoiceDriveFileId?: string;
    totalUsdOverride?: number;
    personalNote?: string;
  };
  /**
   * Optional per-call override of bundle Drive IDs. Lets explicit-
   * context callers (one-off sends like first-customer Mike) skip
   * Vercel env config and pass the IDs inline.
   */
  attachmentBundleOverride?: {
    ncs001Id?: string;
    cif001Id?: string;
    welcomeId?: string;
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "request body must be JSON" },
      { status: 400 },
    );
  }

  const flowId = typeof body.flowId === "string" ? body.flowId.trim() : "";
  const inlineState = body.state;

  if (!flowId && !inlineState) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "either flowId (load from KV) OR state (pass inline) is required",
      },
      { status: 400 },
    );
  }

  // Resolve state: inline takes priority (caller may want to override
  // a stored state for a manual send); flowId loads from KV if no
  // inline.
  let state: OnboardingState | null;
  if (inlineState) {
    state = inlineState;
  } else {
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
  }

  const result = await sendWholesaleApPacket({
    state,
    template: "wholesale-ap",
    invoiceContext: body.invoiceContext,
    attachmentBundleOverride: body.attachmentBundleOverride,
  });

  if (!result.ok) {
    // Distinguish 422 (packet not sendable — prospect missing /
    // orderLines empty / bundle-not-configured) from 500 (Drive /
    // Gmail / KV failure during the actual send).
    const isUnsendable =
      /prospect missing|contactEmail empty|orderLines empty|bundle not configured/i.test(
        result.error,
      );
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: isUnsendable ? 422 : 500 },
    );
  }

  // Resolve recipient for the response (same logic as the handler).
  const recipient =
    state.paymentPath === "accounts-payable" && state.apInfo?.apEmail?.trim()
      ? state.apInfo.apEmail
      : state.prospect?.contactEmail ?? "(unknown)";

  return NextResponse.json({
    ok: true,
    gmailMessageId: result.gmailMessageId,
    to: recipient,
    flowId: state.flowId,
  });
}
