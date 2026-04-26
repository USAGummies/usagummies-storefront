/**
 * Receipt review packet — Phase 8.
 *
 * Pure helper that turns a `ReceiptRecord` (optionally carrying an
 * `ocr_suggestion` from Phase 7) into a Rene approval packet draft.
 *
 * **Prepare-for-review only.** Building a packet does NOT:
 *   - mutate the underlying receipt's status or canonical fields;
 *   - create a QBO bill, expense, vendor, or category;
 *   - open a Slack/control-plane approval (the taxonomy has no
 *     `receipt.review.promote` slug yet — this packet is the
 *     review-queue item that documents the gap, per the
 *     blueprint's "fail-closed: register slug in taxonomy.ts
 *     before the agent may use it" rule).
 *
 * Hard rules (every one tested):
 *   - **Pure.** No I/O. No env reads. Pure function of input.
 *   - **Never fabricates.** Each proposed field is either
 *     `{ value, source: "canonical" }` (the human-edited /
 *     processReceipt-set field), `{ value, source: "ocr-suggested" }`
 *     (falling back to OCR when canonical is empty AND OCR has a
 *     value), or `{ value: null, source: "missing" }`. The packet
 *     NEVER infers a value not present in either source.
 *   - **Canonical preferred over OCR.** When both have a value,
 *     canonical wins. The OCR field stays accessible for review
 *     side-by-side; promotion never silently overwrites a human's
 *     entry with the OCR.
 *   - **Eligibility is honest.** `eligibility.ok` is true iff every
 *     required field (`vendor`, `date`, `amount`, `category`) has a
 *     non-null `value` in `proposedFields`. Missing fields are
 *     listed verbatim in `eligibility.missing[]`.
 *   - **Taxonomy slug is null today.** The `taxonomy.slug` is `null`
 *     until a future blueprint update adds `receipt.review.promote`
 *     (or similar). The packet always reports the missing-slug
 *     state honestly so reviewers see why a Slack/control-plane
 *     approval wasn't opened.
 */

import type { ReceiptRecord } from "./docs";
import type { ReceiptOcrSuggestion } from "./receipt-ocr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewFieldSource = "canonical" | "ocr-suggested" | "missing";

export interface ReviewField<T> {
  value: T | null;
  source: ReviewFieldSource;
}

export interface ProposedFields {
  vendor: ReviewField<string>;
  date: ReviewField<string>;
  amount: ReviewField<number>;
  currency: ReviewField<string>;
  category: ReviewField<string>;
  payment_method: ReviewField<string>;
}

export interface PacketEligibility {
  ok: boolean;
  /** Field names that lack a value in both canonical AND OCR. */
  missing: Array<keyof ProposedFields>;
  /** Free-form reasons (e.g. "amount too small to be meaningful"). */
  warnings: string[];
}

export interface PacketTaxonomy {
  /** Action slug if the taxonomy has one for receipt promotion.
   *  `null` today — see `reason`. */
  slug: string | null;
  /** Class we'd expect ("B" — Rene single-approval) when a slug
   *  eventually lands in `contracts/approval-taxonomy.md`. */
  classExpected: "B";
  /** Why `slug` is null (or, in the future, why the packet still
   *  routes through the queue rather than auto-filing a Slack
   *  approval). Human-readable. */
  reason: string;
}

export interface ReceiptReviewPacket {
  /** Stable id derived from the receipt id + a version string.
   *  Re-building for the same receipt produces the same packet id
   *  so subsequent posts replace, not duplicate. */
  packetId: string;
  receiptId: string;
  /** Canonical (human-edited / processReceipt-set) fields surfaced
   *  side-by-side with OCR. The reviewer sees what's currently
   *  written to the record vs. what the extractor proposed. */
  canonical: {
    vendor: string | null;
    date: string | null;
    amount: number | null;
    currency: string | null;
    category: string | null;
    payment_method: string | null;
  };
  ocrSuggestion: ReceiptOcrSuggestion | null;
  /** Per-field merge: canonical wins; OCR is the fallback; missing
   *  is missing. NEVER infers a value not present in either source. */
  proposedFields: ProposedFields;
  eligibility: PacketEligibility;
  taxonomy: PacketTaxonomy;
  /**
   * Phase 8: `"draft"` — packet is a queue item.
   * Phase 10: `"rene-approved"` once Rene approves the Class B
   *           `receipt.review.promote` request; `"rejected"` if
   *           Rene rejects. Transitions are exclusively driven by
   *           the closer at `src/lib/ops/receipt-review-closer.ts`
   *           when the canonical approval store flips status.
   *
   * The transition NEVER auto-promotes the underlying receipt's
   * status (`needs_review` / `ready` is unchanged), NEVER fills
   * canonical receipt fields, and NEVER fires a QBO write. A
   * separate Class B `qbo.bill.create` action runs later for the
   * actual posting.
   */
  status: "draft" | "rene-approved" | "rejected";
  /** Receipt's `status` at packet build time. Locked for visibility
   *  — if a reviewer promoted this receipt to `ready` outside the
   *  packet flow, the packet still records what state it saw. */
  receiptStatusAtBuild: ReceiptRecord["status"];
  createdAt: string;
}

export interface BuildPacketOptions {
  /** Override for determinism. Defaults to `new Date()`. */
  now?: Date;
  /** Override for testing the missing-slug taxonomy contract. */
  taxonomyOverride?: Partial<PacketTaxonomy>;
}

// ---------------------------------------------------------------------------
// Required fields for eligibility
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Array<keyof ProposedFields> = [
  "vendor",
  "date",
  "amount",
  "category",
];

// Phase 9 — taxonomy slug `receipt.review.promote` is registered.
// The packet builder reports the registered slug in every build;
// the route opens a Class B Rene approval when `eligibility.ok` is
// true and falls back to a draft-only packet otherwise (with the
// reason naming why no approval was opened).
const DEFAULT_TAXONOMY: PacketTaxonomy = {
  slug: "receipt.review.promote",
  classExpected: "B",
  reason:
    "`receipt.review.promote` is registered (Class B, Rene). " +
    "The route opens a Slack approval when `eligibility.ok` is true; " +
    "ineligible packets stay draft-only with `eligibility.missing` listing " +
    "the gaps. Approval acknowledges Rene reviewed — it does NOT post to " +
    "QBO. A separate Class B `qbo.bill.create` action runs later.",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickStringField(
  canonical: string | null | undefined,
  ocrValue: string | null | undefined,
): ReviewField<string> {
  if (typeof canonical === "string" && canonical.trim().length > 0) {
    return { value: canonical, source: "canonical" };
  }
  if (typeof ocrValue === "string" && ocrValue.trim().length > 0) {
    return { value: ocrValue, source: "ocr-suggested" };
  }
  return { value: null, source: "missing" };
}

function pickNumberField(
  canonical: number | null | undefined,
  ocrValue: number | null | undefined,
): ReviewField<number> {
  if (typeof canonical === "number" && Number.isFinite(canonical)) {
    return { value: canonical, source: "canonical" };
  }
  if (typeof ocrValue === "number" && Number.isFinite(ocrValue)) {
    return { value: ocrValue, source: "ocr-suggested" };
  }
  return { value: null, source: "missing" };
}

function buildPacketId(receiptId: string): string {
  // Stable derivation: the packet id is deterministic in the
  // receipt id and the packet version. Re-building overwrites in
  // KV by id, never duplicates.
  return `pkt-v1-${receiptId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildReceiptReviewPacket(
  receipt: ReceiptRecord,
  options: BuildPacketOptions = {},
): ReceiptReviewPacket {
  const now = options.now ?? new Date();
  const ocr = receipt.ocr_suggestion ?? null;

  const canonical = {
    vendor: receipt.vendor ?? null,
    date: receipt.date ?? null,
    amount:
      typeof receipt.amount === "number" && Number.isFinite(receipt.amount)
        ? receipt.amount
        : null,
    // Currency isn't on ReceiptRecord today — canonical is always
    // null for currency, OCR may fill it. Keep the field shape
    // so the UI can render side-by-side.
    currency: null as string | null,
    category: receipt.category ?? null,
    payment_method: receipt.payment_method ?? null,
  };

  const proposedFields: ProposedFields = {
    vendor: pickStringField(canonical.vendor, ocr?.vendor),
    date: pickStringField(canonical.date, ocr?.date),
    amount: pickNumberField(canonical.amount, ocr?.amount),
    currency: pickStringField(canonical.currency, ocr?.currency),
    category: pickStringField(canonical.category, null), // OCR doesn't propose categories
    payment_method: pickStringField(canonical.payment_method, ocr?.paymentHint),
  };

  // Eligibility: every required field must have a non-null value
  // in proposedFields. Missing fields are listed verbatim — no
  // free-form interpretation.
  const missing = REQUIRED_FIELDS.filter(
    (k) => proposedFields[k].value === null,
  );
  const warnings: string[] = [];
  // Surface OCR warnings up so reviewers see what the extractor
  // flagged. We mirror them as packet warnings (read-only).
  if (ocr && ocr.warnings.length > 0) {
    for (const w of ocr.warnings) {
      warnings.push(`OCR: ${w}`);
    }
  }
  const eligibility: PacketEligibility = {
    ok: missing.length === 0,
    missing,
    warnings,
  };

  const taxonomy: PacketTaxonomy = {
    ...DEFAULT_TAXONOMY,
    ...(options.taxonomyOverride ?? {}),
  };

  return {
    packetId: buildPacketId(receipt.id),
    receiptId: receipt.id,
    canonical,
    ocrSuggestion: ocr,
    proposedFields,
    eligibility,
    taxonomy,
    status: "draft",
    receiptStatusAtBuild: receipt.status,
    createdAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Phase 10 — pure status transitions
// ---------------------------------------------------------------------------

/**
 * Map a control-plane approval decision to the packet's next status.
 * Pure: same input → same output. No I/O. The closer
 * (`src/lib/ops/receipt-review-closer.ts`) calls this after the
 * approval store records the decision.
 *
 * Hard rules (locked by tests):
 *   - `approve` → `"rene-approved"` (only valid when current is `"draft"`).
 *   - `reject`  → `"rejected"` (only valid when current is `"draft"`).
 *   - `ask`     → no transition (returns `null`). The approver is
 *                 asking for clarification; the packet stays `"draft"`.
 *   - Re-applying the same decision to a packet already in a
 *     terminal state (`"rene-approved"`, `"rejected"`) is a no-op
 *     (returns `null`). Idempotency preserves whatever the operator
 *     already saw.
 *   - The transition NEVER touches `canonical`, `proposedFields`,
 *     `eligibility`, `taxonomy`, `ocrSuggestion`, or
 *     `receiptStatusAtBuild`. Only the `status` field changes.
 */
export type PacketDecision = "approve" | "reject" | "ask";

export function applyDecisionToPacket(
  packet: ReceiptReviewPacket,
  decision: PacketDecision,
): ReceiptReviewPacket | null {
  if (decision === "ask") return null;
  if (packet.status !== "draft") return null; // idempotent on terminal state

  const nextStatus: "rene-approved" | "rejected" =
    decision === "approve" ? "rene-approved" : "rejected";

  return {
    ...packet,
    status: nextStatus,
  };
}
