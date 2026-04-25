/**
 * POST /api/ops/vendors/onboard
 *
 * Opens a real Class B `vendor.master.create` approval for Rene.
 * The route stores the proposed vendor payload in KV, opens the control-
 * plane approval card, and returns the approval id. It does NOT create
 * the QBO vendor until Rene approves in Slack.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import {
  openVendorOnboardingApproval,
  parseVendorOnboardingInput,
} from "@/lib/ops/vendor-onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseVendorOnboardingInput(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const opened = await openVendorOnboardingApproval(parsed.input);
  if (!opened.ok) {
    return NextResponse.json(
      { ok: false, error: opened.error, existing: opened.existing },
      { status: opened.status ?? 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    approvalId: opened.approvalId,
    proposalTs: opened.proposalTs,
    payloadRef: opened.payloadRef,
    dedupeKey: opened.dedupeKey,
  });
}
