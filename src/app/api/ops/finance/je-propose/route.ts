/**
 * POST /api/ops/finance/je-propose
 *
 * Open a Class C `qbo.journal_entry.post` approval for a manual
 * journal entry. Replaces the workflow where Ben hand-cURL's the
 * `/api/ops/qbo/journal-entry` endpoint by giving Rene (and Viktor,
 * and any future agent) a single Slack-side surface that:
 *
 *   1. Validates the proposal locally (balance, lines, memo, date
 *      format) — fail-fast with 400 if it doesn't balance.
 *   2. Persists the structured payload under the approval id so the
 *      closer can recover it when both approvers click yes.
 *   3. Opens the dual-approval card via `requestApproval()`.
 *      Approval surface posts to #ops-approvals with the rendered
 *      JE preview (lines, totals, txn_date, rationale).
 *
 * What this route DOES NOT do:
 *   - Post the JE to QBO. That happens only when BOTH Ben and Rene
 *     approve the card (Class C dual-approval), and only via the
 *     existing `/api/ops/qbo/journal-entry` route — invoked by the
 *     closer in `src/lib/finance/je-approval/approval-closer.ts`.
 *   - Compute or guess account_ids. Caller MUST resolve account
 *     names to QBO account ids before posting; this route never
 *     looks up accounts on the caller's behalf.
 *
 * Body (JSON):
 *   {
 *     proposalId: string,             // caller-supplied idempotency id
 *     lines: [{posting_type, account_id, account_name?, amount, description?}],
 *     txn_date?: "YYYY-MM-DD",        // defaults to today on QBO side
 *     memo: string,                   // header PrivateNote
 *     rationale: string,              // why this JE is being posted
 *     caller?: string,                // tag for audit (default "claude")
 *     sources?: [{system, id?, url?}],
 *     post?: boolean                  // default true; false = preview only
 *   }
 *
 * Auth: session OR bearer CRON_SECRET.
 */
import { NextResponse } from "next/server";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { newRunContext } from "@/lib/ops/control-plane/run-id";
import { requestApproval } from "@/lib/ops/control-plane/record";
import { renderJeApprovalCard } from "@/lib/finance/je-approval/card";
import { persistJeProposalPayload } from "@/lib/finance/je-approval/payload-store";
import type { JeProposal } from "@/lib/finance/je-approval/types";
import { validateJeProposal } from "@/lib/finance/je-approval/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION_SLUG = "qbo.journal_entry.post";
const TARGET_ENTITY_TYPE = "qbo-journal-entry";

interface ProposeBody extends JeProposal {
  post?: boolean;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ProposeBody;
  try {
    body = (await req.json()) as ProposeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.proposalId || typeof body.proposalId !== "string") {
    return NextResponse.json(
      { error: "proposalId required (caller-supplied idempotency string)" },
      { status: 400 },
    );
  }

  const proposal: JeProposal = {
    proposalId: body.proposalId,
    lines: body.lines,
    txn_date: body.txn_date,
    memo: body.memo,
    rationale: body.rationale,
    caller: body.caller,
    sources: body.sources,
  };

  const validation = validateJeProposal(proposal);
  if (!validation.ok) {
    return NextResponse.json(
      {
        ok: false,
        validation,
        error: "Proposal failed validation — fix the issues and re-submit",
      },
      { status: 400 },
    );
  }

  const renderedMarkdown = renderJeApprovalCard(proposal, validation);
  const shouldPost = body.post !== false;

  if (!shouldPost) {
    // Preview mode — return the rendered card without opening an approval.
    return NextResponse.json({
      ok: true,
      posted: false,
      validation,
      renderedMarkdown,
    });
  }

  const run = newRunContext({
    agentId: "je-propose",
    division: "financials",
    source: "event",
    trigger: `je-propose:${proposal.proposalId}`,
  });

  const evidenceClaim =
    `Post manual journal entry totaling $${validation.totalDebitsUsd.toFixed(2)} ` +
    `(txn_date ${proposal.txn_date ?? "today"}; ${proposal.lines.length} lines). ` +
    `Memo: ${proposal.memo}.`;
  const rollbackPlan =
    "Reverse the JE in QBO via a balancing JE (DR/CR swapped) tagged 'reversal of <id>'. " +
    "Closer never bypasses the QBO endpoint's validation layer — a typo'd JE is caught by the route's guardrails before write.";

  const retrievedAt = new Date().toISOString();
  const sources =
    proposal.sources && proposal.sources.length > 0
      ? proposal.sources.map((s) => ({
          system: s.system,
          id: s.id,
          url: s.url,
          retrievedAt,
        }))
      : [
          {
            system: "je-propose",
            id: proposal.proposalId,
            retrievedAt,
          },
        ];

  let approvalId: string | null = null;
  let approvalTs: string | null = null;
  let approvalErr: string | null = null;
  const degraded: string[] = [];

  try {
    const approval = await requestApproval(run, {
      actionSlug: ACTION_SLUG,
      targetSystem: "qbo",
      targetEntity: {
        type: TARGET_ENTITY_TYPE,
        id: proposal.proposalId,
        label: `JE ${proposal.proposalId} · $${validation.totalDebitsUsd.toFixed(2)}`,
      },
      payloadPreview: renderedMarkdown,
      payloadRef: `je-propose:${proposal.proposalId}`,
      evidence: {
        claim: evidenceClaim,
        sources,
        confidence: 0.95,
      },
      rollbackPlan,
    });
    approvalId = approval.id;
    approvalTs = approval.slackThread?.ts ?? null;

    // Persist the structured payload so the closer can post the JE
    // hours later when both approvers have signed off. Fail-soft: a
    // KV miss degrades the closer to "no payload found, can't post"
    // (audit captures the failure cleanly).
    const persisted = await persistJeProposalPayload(approval.id, proposal);
    if (!persisted.ok) {
      degraded.push(`payload-persist: ${persisted.error}`);
    }
  } catch (err) {
    approvalErr = err instanceof Error ? err.message : String(err);
    degraded.push(`approval-open: ${approvalErr}`);
  }

  return NextResponse.json({
    ok: approvalErr === null,
    posted: approvalId !== null,
    postedTo: approvalId ? "#ops-approvals" : null,
    approvalId,
    proposalTs: approvalTs,
    validation,
    renderedMarkdown,
    degraded,
    error: approvalErr,
  });
}
