/**
 * Pipeline Stage Verifier — pure validator over evidence rows.
 *
 * Rule:
 *   verifiedStage = highest stage S in PIPELINE_STAGES such that
 *   at least one evidence row's `stage === S` AND `evidenceType` is
 *   in EVIDENCE_TYPES_BY_STAGE[S].
 *
 *   verification status is computed by comparing the verifiedStage to
 *   any operator-claimed stage:
 *     - `system_verified` — claimed === verified
 *     - `human_verified`  — claimed === verified AND at least one
 *                            evidence row carries `actor` matching
 *                            "human:*" / operator email / "manual"
 *     - `unverified`      — no claim provided AND no evidence
 *     - `needs_review`    — claimed > verified (claim ahead of evidence)
 *     - `conflicting_evidence` — multiple evidence rows of the same
 *                            type disagree (e.g. 2 paid records with
 *                            different amounts) — flagged as a
 *                            blocker so an operator can investigate
 *
 * Pure module: no I/O.
 */

import {
  EVIDENCE_TYPES_BY_STAGE,
  PIPELINE_STAGES,
  STAGE_TO_REVENUE_STATUS,
  stageIndex,
  type PipelineEvidence,
  type PipelineStage,
  type PipelineTransition,
  type RevenueStatus,
  type VerificationStatus,
  type VerifiedState,
} from "./pipeline-evidence";

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

export interface VerifyArgs {
  dealId: string;
  /** Evidence rows to verify against. Order doesn't matter. */
  evidence: ReadonlyArray<PipelineEvidence>;
  /**
   * Optional HubSpot-claimed stage. When provided, the verifier
   * compares it to the verified stage and produces `needs_review`
   * if the claim runs ahead of the evidence.
   */
  claimedStage?: PipelineStage | null;
  /**
   * Pre-computed transition history (e.g. from KV). Pass through
   * if available; the verifier returns the same array unchanged.
   */
  transitions?: ReadonlyArray<PipelineTransition>;
}

export function verifyPipelineState(args: VerifyArgs): VerifiedState {
  const { dealId, evidence } = args;

  // Group supported stages: a stage is supported iff at least one
  // evidence row's stage === S AND evidenceType is in the canonical
  // set for S.
  const supportedSet = new Set<PipelineStage>();
  for (const e of evidence) {
    const valid = (EVIDENCE_TYPES_BY_STAGE[e.stage] ?? []) as ReadonlyArray<string>;
    if (valid.includes(e.evidenceType)) {
      supportedSet.add(e.stage);
    }
  }
  const supportedStages = PIPELINE_STAGES.filter((s) => supportedSet.has(s));

  // Highest supported stage = furthest right in PIPELINE_STAGES.
  const verifiedStage =
    supportedStages.length === 0
      ? null
      : supportedStages[supportedStages.length - 1];

  // Detect conflicts: multiple evidence rows of the same type for
  // the same stage with different sourceIds — surfaces "did we
  // record this twice?" / "two payment records?".
  let conflict = false;
  const seenSourceByTypeStage = new Map<string, Set<string>>();
  for (const e of evidence) {
    const key = `${e.stage}|${e.evidenceType}`;
    const sources = seenSourceByTypeStage.get(key) ?? new Set<string>();
    sources.add(`${e.source}:${e.sourceId}`);
    seenSourceByTypeStage.set(key, sources);
    // Heuristic: > 1 distinct source/sourceId for an authoritative
    // type (payment / shipment / po) → flag as conflicting.
    if (
      sources.size > 1 &&
      AUTHORITATIVE_EVIDENCE_TYPES.has(e.evidenceType as string)
    ) {
      conflict = true;
    }
  }

  // Determine verification status.
  const claimedStage = args.claimedStage ?? null;
  const verification = computeVerification({
    verifiedStage,
    claimedStage,
    evidence,
    conflict,
  });

  // Stages claimed but missing evidence — only meaningful when
  // claimedStage is provided. We surface the chain from
  // `verifiedStage + 1` up through `claimedStage` so the operator
  // sees every gap.
  const missingEvidenceForStages: PipelineStage[] =
    claimedStage && verifiedStage
      ? PIPELINE_STAGES.slice(
          stageIndex(verifiedStage) + 1,
          stageIndex(claimedStage) + 1,
        )
      : claimedStage && !verifiedStage
        ? PIPELINE_STAGES.slice(0, stageIndex(claimedStage) + 1)
        : [];

  // Conversion timestamps: for each supported stage, the EARLIEST
  // evidence.evidenceAt that supported it.
  const conversionTimestamps: Partial<Record<PipelineStage, string>> = {};
  for (const e of evidence) {
    const valid = (EVIDENCE_TYPES_BY_STAGE[e.stage] ?? []) as ReadonlyArray<string>;
    if (!valid.includes(e.evidenceType)) continue;
    const cur = conversionTimestamps[e.stage];
    if (!cur || Date.parse(e.evidenceAt) < Date.parse(cur)) {
      conversionTimestamps[e.stage] = e.evidenceAt;
    }
  }

  // Date entered current verified stage = conversionTimestamps[verifiedStage].
  const dateEnteredStage =
    verifiedStage && conversionTimestamps[verifiedStage]
      ? conversionTimestamps[verifiedStage] ?? null
      : null;

  // Age of most-recent evidence (latency from event → record). The
  // larger this is, the slower we are at ingesting.
  let ageOfMostRecentEvidenceMs: number | null = null;
  for (const e of evidence) {
    const recorded = Date.parse(e.recordedAt);
    const happened = Date.parse(e.evidenceAt);
    if (!Number.isFinite(recorded) || !Number.isFinite(happened)) continue;
    const age = recorded - happened;
    if (
      ageOfMostRecentEvidenceMs === null ||
      age < ageOfMostRecentEvidenceMs
    ) {
      ageOfMostRecentEvidenceMs = age;
    }
  }

  // Blocker text — what the operator needs to do to graduate the
  // verification status. Empty when system_verified.
  const blocker = computeBlocker({
    verification,
    verifiedStage,
    claimedStage,
    missingEvidenceForStages,
    conflict,
  });

  // Revenue status maps from verified stage. When unverified, we
  // surface "none" (we can't claim revenue without evidence).
  const revenueStatus: RevenueStatus = verifiedStage
    ? STAGE_TO_REVENUE_STATUS[verifiedStage]
    : "none";

  return {
    dealId,
    verifiedStage,
    verification,
    supportedStages,
    missingEvidenceForStages,
    dateEnteredStage,
    dateVerifiedStage: dateEnteredStage,
    ageOfMostRecentEvidenceMs,
    transitions: args.transitions ?? [],
    conversionTimestamps,
    blocker,
    revenueStatus,
  };
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

export interface PipelineDrift {
  dealId: string;
  /** What HubSpot says (operator-set). */
  hubspotStage: PipelineStage;
  /** What evidence supports. */
  verifiedStage: PipelineStage | null;
  /** Number of stages HubSpot is ahead by (positive = ahead). */
  driftSteps: number;
  /** Stages that are claimed but missing evidence. */
  missingEvidenceForStages: PipelineStage[];
  /** Free-form one-line reason. */
  reason: string;
  verification: VerificationStatus;
}

/**
 * Compare a HubSpot-reported stage against the verified state.
 * Returns null when there's no drift (HubSpot ≤ verified). Returns a
 * drift envelope when HubSpot runs ahead.
 */
export function detectPipelineDrift(args: {
  dealId: string;
  hubspotStage: PipelineStage;
  verifiedState: VerifiedState;
}): PipelineDrift | null {
  const hubIdx = stageIndex(args.hubspotStage);
  const verIdx = args.verifiedState.verifiedStage
    ? stageIndex(args.verifiedState.verifiedStage)
    : -1;
  const driftSteps = hubIdx - verIdx;
  if (driftSteps <= 0) return null;
  const missing = PIPELINE_STAGES.slice(verIdx + 1, hubIdx + 1);
  const reason = formatDriftReason({
    hubspotStage: args.hubspotStage,
    verifiedStage: args.verifiedState.verifiedStage,
    driftSteps,
  });
  return {
    dealId: args.dealId,
    hubspotStage: args.hubspotStage,
    verifiedStage: args.verifiedState.verifiedStage,
    driftSteps,
    missingEvidenceForStages: missing,
    reason,
    verification: "needs_review",
  };
}

function formatDriftReason(args: {
  hubspotStage: PipelineStage;
  verifiedStage: PipelineStage | null;
  driftSteps: number;
}): string {
  if (!args.verifiedStage) {
    return `HubSpot says \`${args.hubspotStage}\` but no evidence supports any stage yet.`;
  }
  return `HubSpot says \`${args.hubspotStage}\` (${args.driftSteps} step${args.driftSteps === 1 ? "" : "s"} ahead) but evidence only supports \`${args.verifiedStage}\`.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUTHORITATIVE_EVIDENCE_TYPES: ReadonlySet<string> = new Set([
  "po_document",
  "qbo_invoice_sent",
  "qbo_payment_record",
  "stripe_payment_record",
  "shopify_payment_record",
  "amazon_settlement",
  "bank_payment_record",
  "shipstation_shipment",
  "shopify_fulfillment",
  "tracking_number",
]);

function computeVerification(args: {
  verifiedStage: PipelineStage | null;
  claimedStage: PipelineStage | null;
  evidence: ReadonlyArray<PipelineEvidence>;
  conflict: boolean;
}): VerificationStatus {
  if (args.conflict) return "conflicting_evidence";
  if (!args.verifiedStage && !args.claimedStage) return "unverified";
  if (!args.verifiedStage && args.claimedStage) return "needs_review";
  if (args.claimedStage) {
    if (stageIndex(args.claimedStage) > stageIndex(args.verifiedStage!)) {
      return "needs_review";
    }
  }
  // Verified stage exists. Decide system vs human.
  const humanActorRegex = /^(human|manual|operator|ben|rene|drew|@)/i;
  const hasHumanActor = args.evidence.some((e) =>
    humanActorRegex.test(e.actor),
  );
  return hasHumanActor ? "human_verified" : "system_verified";
}

function computeBlocker(args: {
  verification: VerificationStatus;
  verifiedStage: PipelineStage | null;
  claimedStage: PipelineStage | null;
  missingEvidenceForStages: PipelineStage[];
  conflict: boolean;
}): string | null {
  if (args.verification === "system_verified" || args.verification === "human_verified") {
    return null;
  }
  if (args.verification === "conflicting_evidence") {
    return "Multiple authoritative evidence rows disagree — operator must reconcile.";
  }
  if (args.verification === "needs_review") {
    if (args.missingEvidenceForStages.length > 0) {
      return `Missing evidence for: ${args.missingEvidenceForStages.join(", ")}.`;
    }
    return "HubSpot claim runs ahead of evidence.";
  }
  return "No evidence on file.";
}
