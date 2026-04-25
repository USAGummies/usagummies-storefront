/**
 * Pure read-only helpers for the future Faire Direct send closer.
 *
 * Phase 3 (the actual send-on-approve closer) is NOT implemented here.
 * This file is the safe first step: pure functions that select which
 * approved candidates are eligible for a future Class B
 * `faire-direct.invite` approval and produce a stable payload preview.
 *
 * Why pure helpers first:
 *   1. Phase 3 needs a deterministic source of truth for "which
 *      records are ready to send" so we can show counts on
 *      `/ops/faire-direct` + the future approval card without
 *      duplicating logic across the route, the page, and the closer.
 *   2. We can lock the eligibility contract before any send code
 *      exists — anything Phase 3 actually wires must consume the
 *      same selector.
 *
 * Hard rules locked by tests:
 *   - Only `status === "approved"` records are eligible.
 *   - Records that fail re-validation (`validateInvite`) on their
 *     current fields are excluded — a stale record whose fields
 *     drifted out of policy never reaches the send closer.
 *   - Records already in lifecycle states `needs_review`, `rejected`,
 *     or `sent` are excluded. `sent` is doubly-excluded because
 *     Phase 2's review route also forbids the `sent` transition.
 *   - The `summarizeForApproval` output is a stable, scrubbed string —
 *     no internal ids, no `reviewedBy`, no notes-as-PII echo. It's
 *     the human-readable claim string a future approval card carries.
 *
 * No fetch, no I/O, no Faire API call, no Gmail call. Easy to test.
 */

import { validateInvite, type FaireInviteRecord } from "./invites";

export interface EligibilityReason {
  code: "wrong_status" | "validation_failed" | "ok";
  detail: string;
}

export interface EligibilityResult {
  /** The record under consideration. */
  record: FaireInviteRecord;
  eligible: boolean;
  reason: EligibilityReason;
}

/**
 * Classify a single record. Pure. Returns `eligible=true` iff:
 *   - status === "approved"
 *   - the record's current candidate fields still pass `validateInvite`
 *
 * Otherwise returns the reason code so the caller (UI banner, future
 * closer, audit) can surface it consistently.
 */
export function classifyForSend(record: FaireInviteRecord): EligibilityResult {
  if (record.status !== "approved") {
    return {
      record,
      eligible: false,
      reason: {
        code: "wrong_status",
        detail: `Status is "${record.status}". Only "approved" candidates are eligible for the future send closer.`,
      },
    };
  }
  // Re-run validation. A record that was `approved` two weeks ago but
  // has had its email field corrected to something invalid since then
  // (defensive — shouldn't happen because the PATCH route re-validates,
  // but tests pin this anyway) must NOT be eligible.
  const validation = validateInvite({
    retailerName: record.retailerName,
    email: record.email,
    source: record.source,
    buyerName: record.buyerName,
    city: record.city,
    state: record.state,
    notes: record.notes,
    hubspotContactId: record.hubspotContactId,
  });
  if (!validation.ok) {
    return {
      record,
      eligible: false,
      reason: {
        code: "validation_failed",
        detail: `Approved record failed re-validation: ${validation.reason}. Move it back to needs_review and correct it.`,
      },
    };
  }
  return {
    record,
    eligible: true,
    reason: { code: "ok", detail: "Eligible for the future send closer." },
  };
}

/**
 * Filter a list of records to only those eligible for a future send.
 * Pure, no I/O. The dashboard uses this to show "N approved invites
 * ready" and the future closer iterates over its output to open one
 * Class B approval card per record.
 */
export function selectApprovedInviteCandidates(
  records: readonly FaireInviteRecord[] | null | undefined,
): FaireInviteRecord[] {
  if (!Array.isArray(records)) return [];
  return records
    .map(classifyForSend)
    .filter((r) => r.eligible)
    .map((r) => r.record);
}

/**
 * Build the structured eligibility report for an entire queue.
 * Useful when an operator wants to see "what's blocking each
 * approved row" — a record stuck because its email was edited
 * after approval should appear here with `validation_failed`.
 */
export interface EligibilityReport {
  total: number;
  eligible: FaireInviteRecord[];
  ineligible: EligibilityResult[];
}

export function reportEligibility(
  records: readonly FaireInviteRecord[] | null | undefined,
): EligibilityReport {
  if (!Array.isArray(records)) {
    return { total: 0, eligible: [], ineligible: [] };
  }
  const eligible: FaireInviteRecord[] = [];
  const ineligible: EligibilityResult[] = [];
  for (const r of records) {
    const result = classifyForSend(r);
    if (result.eligible) eligible.push(result.record);
    else ineligible.push(result);
  }
  return { total: records.length, eligible, ineligible };
}

/**
 * Stable, scrubbed preview string for the future approval card. Pure.
 *
 * The future closer will use this as the approval card's `claim`
 * field. Locked by tests:
 *   - Never contains internal ids beyond the email-derived id we
 *     already expose to operators.
 *   - Never echoes `reviewedBy` (which carries operator email/PII).
 *   - Notes are truncated to the first 160 chars to keep approval
 *     cards readable.
 */
export function summarizeForApproval(record: FaireInviteRecord): string {
  const lines: string[] = [];
  lines.push(`Send Faire Direct invite to ${record.retailerName}`);
  lines.push(`Email: ${record.email}`);
  if (record.buyerName) lines.push(`Buyer: ${record.buyerName}`);
  const loc = [record.city, record.state].filter(Boolean).join(", ");
  if (loc) lines.push(`Location: ${loc}`);
  lines.push(`Source: ${record.source}`);
  if (record.notes) {
    const trimmed = record.notes.slice(0, 160);
    lines.push(
      `Notes: ${trimmed}${record.notes.length > 160 ? "…" : ""}`,
    );
  }
  return lines.join("\n");
}
