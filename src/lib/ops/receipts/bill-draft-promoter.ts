/**
 * Receipt-OCR → Bill-Draft Promoter — P0-6 from
 * `/contracts/agent-architecture-audit.md`.
 *
 * Bridge between two existing Class B approvals:
 *
 *     receipt.review.promote  (Phase 9 — Rene reviewed the OCR packet)
 *               │
 *               ▼  (packet.status === "rene-approved")
 *     ┌──────────────────────────────────┐
 *     │  THIS PROMOTER (P0-6)            │  upstream gate
 *     │  validate · dedupe · vendor-     │  — never writes QBO,
 *     │  resolve · prepare bill draft    │    never creates a vendor
 *     └──────────────────────────────────┘
 *               │
 *               ▼
 *     qbo.bill.create  (Class B — Rene approval)
 *               │
 *               ▼
 *     QBO bill (created by separate downstream closer ON Rene approval)
 *
 * **Class A from the promoter's perspective; the underlying action it
 * stages is Class B `qbo.bill.create` per the registered taxonomy.**
 *
 * The promoter:
 *   - re-validates the slug class B + Rene approver via
 *     `taxonomy.classify()` defense-in-depth,
 *   - reads the rene-approved review packet,
 *   - resolves the vendor reference against an injected vendor probe
 *     (provided by the existing P0-4 vendor-master pipeline),
 *   - validates required canonical reviewed fields are present (NEVER
 *     promotes OCR-only fields to canonical facts),
 *   - dedupes via a stable idempotency key tied to the packet id,
 *   - delegates to an injected approval opener (which routes through
 *     the canonical `requestApproval()` path),
 *   - returns explicit status:
 *       `approval-opened`         — happy path
 *       `review-needed`           — required canonical fields missing
 *       `blocked-vendor`          — vendor missing / unapproved / ambiguous
 *       `blocked-packet-status`   — packet not yet rene-approved
 *       `duplicate`               — idempotency-key collision
 *       `fail-closed`             — slug missing / wrong class / Drew approver
 *
 * The promoter NEVER:
 *   - calls `createQBOBill()`, `createQBOVendor()`, or any QBO write
 *   - bypasses the P0-4 vendor-master coordinator (no vendor creation)
 *   - creates Notion / Drive / Slack artifacts of its own
 *   - mutates the canonical receipt fields (OCR is suggestion only)
 *   - modifies QBO Chart of Accounts (Class D — prohibited)
 *   - posts a journal entry (Class D — prohibited)
 *   - recategorizes Rene investor transfers (Class D — prohibited)
 *   - selects Drew as approver (Drew owns nothing)
 *   - introduces a new approval slug or division
 *
 * Pure DI: `vendorProbe` + `approvalOpener` + `dedupeProbe` are all
 * injected. Tests pass synthetic implementations; production wires the
 * real vendor registry / canonical `requestApproval()` / KV idempotency.
 */

import { classify } from "@/lib/ops/control-plane/taxonomy";
import { createHash } from "node:crypto";

import type { ReceiptReviewPacket } from "@/lib/ops/receipt-review-packet";

// =========================================================================
// Required canonical fields
// =========================================================================

/**
 * Canonical reviewed fields that MUST be `source: "canonical"` (not
 * `ocr-suggested` or `missing`) to open a `qbo.bill.create` approval.
 *
 * `category` is REQUIRED canonical because QBO bill needs an account
 * mapping; OCR doesn't propose categories per the existing packet
 * builder (see receipt-review-packet.ts line 230).
 *
 * Currency is recommended-only: many small-business receipts won't
 * carry an explicit currency line; QBO's company default applies.
 */
export const REQUIRED_CANONICAL_FIELDS = Object.freeze([
  "vendor",
  "date",
  "amount",
  "category",
] as const);

export const RECOMMENDED_CANONICAL_FIELDS = Object.freeze([
  "currency",
  "payment_method",
] as const);

// =========================================================================
// Vendor probe (DI — points at the P0-4 vendor-master registry)
// =========================================================================

/**
 * Outcome of a vendor lookup against the approved-vendor registry. The
 * promoter NEVER creates vendors — it only resolves an existing one.
 */
export type VendorResolution =
  | { kind: "found"; qboVendorId: string; displayName: string }
  | { kind: "not-found" }
  | {
      kind: "pending";
      /** Approval id of the pending vendor.master.create request. */
      approvalId?: string;
      dedupeKey?: string;
    }
  | { kind: "ambiguous"; candidates: ReadonlyArray<{ id: string; name: string }> };

export interface VendorProbe {
  /**
   * Resolve a vendor name (from the rene-approved packet's canonical
   * `vendor` field) to an approved vendor master record. The probe
   * MUST NOT create the vendor; if not found, return `{kind:"not-found"}`.
   */
  resolve(displayName: string): Promise<VendorResolution>;
}

// =========================================================================
// Idempotency / dedupe probe
// =========================================================================

export interface DedupeProbe {
  /**
   * Check whether an approval has already been opened (or is in flight)
   * for this idempotency key. Return null when neither exists.
   */
  check(idempotencyKey: string): Promise<
    | { kind: "approval-pending"; approvalId: string }
    | { kind: "approval-completed"; approvalId: string; status: string }
    | null
  >;
}

// =========================================================================
// Approval opener (DI)
// =========================================================================

/**
 * What the promoter hands to the canonical `requestApproval()` path.
 * Mirrors `RequestApprovalParams` in `record.ts` but typed defensively
 * so the promoter doesn't drag the full server-side import surface
 * into tests.
 */
export interface BillDraftApprovalParams {
  actionSlug: string;
  targetSystem: string;
  targetEntity: { type: string; id: string; label: string };
  payloadPreview: string;
  payloadRef?: string;
  evidence: {
    claim: string;
    sources: ReadonlyArray<{ system: string; id?: string; url?: string; retrievedAt: string }>;
    confidence: number;
  };
  rollbackPlan: string;
  /** Idempotency key for downstream consumers. NOT part of the Approval shape itself. */
  idempotencyKey: string;
}

export interface ApprovalOpener {
  /**
   * Open the bill-draft approval. The implementation routes through
   * the canonical `requestApproval()` path, which writes the audit
   * envelope and Slack mirror.
   */
  open(params: BillDraftApprovalParams): Promise<
    | { ok: true; approvalId: string; threadTs?: string | null }
    | { ok: false; error: string }
  >;
}

// =========================================================================
// Output packet
// =========================================================================

export type BillDraftPacket =
  | {
      status: "approval-opened";
      packetId: string;
      idempotencyKey: string;
      approvalId: string;
      threadTs?: string | null;
      vendor: { qboVendorId: string; displayName: string };
      preview: BillDraftPreview;
    }
  | {
      status: "review-needed";
      reason: "missing-canonical-fields";
      packetId: string;
      missing: ReadonlyArray<(typeof REQUIRED_CANONICAL_FIELDS)[number]>;
      warnings: ReadonlyArray<string>;
    }
  | {
      status: "blocked-packet-status";
      reason: "packet-not-rene-approved";
      packetId: string;
      packetStatus: ReceiptReviewPacket["status"];
    }
  | {
      status: "blocked-vendor";
      reason: "vendor-not-found" | "vendor-pending-approval" | "vendor-ambiguous";
      packetId: string;
      vendorName: string;
      /** Echo of the missing vendor-master fields the operator should fill via P0-4. */
      vendorMasterDependency: {
        coordinatorPath: "src/lib/ops/vendor-master/coordinator.ts";
        approvalSlug: "vendor.master.create";
        requiredApprover: "Rene";
        candidates?: ReadonlyArray<{ id: string; name: string }>;
        existingApprovalId?: string;
      };
    }
  | {
      status: "duplicate";
      reason: "approval-pending" | "approval-completed";
      packetId: string;
      idempotencyKey: string;
      existingApprovalId: string;
    }
  | {
      status: "fail-closed";
      reason: string;
    };

/** Compact preview payload returned with `approval-opened`. Read-only. */
export interface BillDraftPreview {
  vendorDisplayName: string;
  qboVendorId: string;
  amount: number;
  date: string;
  category: string;
  currency: string | null;
  paymentMethod: string | null;
  /** OCR vs canonical disagreements surfaced for Rene's review. */
  ocrDeltas: ReadonlyArray<{
    field: string;
    canonical: unknown;
    ocrSuggestion: unknown;
  }>;
}

// =========================================================================
// Internal: slug guard (defense-in-depth)
// =========================================================================

const REQUIRED_SLUG = "qbo.bill.create";

function assertSlugIsClassB():
  | null
  | { reason: string } {
  const spec = classify(REQUIRED_SLUG);
  if (!spec) {
    return {
      reason:
        `unknown action slug "${REQUIRED_SLUG}" — fail-closed. ` +
        `Register the slug in /contracts/approval-taxonomy.md and ` +
        `src/lib/ops/control-plane/taxonomy.ts before running the promoter.`,
    };
  }
  if (spec.class !== "B") {
    return {
      reason:
        `action slug "${REQUIRED_SLUG}" is Class ${spec.class}, but the ` +
        `promoter requires Class B. Promoter refuses to delegate.`,
    };
  }
  if (!spec.requiredApprovers || !spec.requiredApprovers.includes("Rene")) {
    return {
      reason:
        `action slug "${REQUIRED_SLUG}" must list Rene as approver per ` +
        `Drew-owns-nothing doctrine. Got: [${(spec.requiredApprovers ?? []).join(", ")}]`,
    };
  }
  if (spec.requiredApprovers.includes("Drew" as never)) {
    return {
      reason:
        `action slug "${REQUIRED_SLUG}" lists Drew as approver — ` +
        `violates CLAUDE.md "Drew owns nothing" doctrine.`,
    };
  }
  return null;
}

// =========================================================================
// Internal: idempotency-key
// =========================================================================

/**
 * Stable idempotency key. Same packet → same key. Includes the packet
 * id, the vendor display name, the canonical amount + date, and a
 * version prefix so a future schema change can rotate keys without
 * losing the dedupe contract.
 */
export function buildIdempotencyKey(
  packetId: string,
  vendorName: string,
  amount: number,
  date: string,
): string {
  const seed = `bill-draft-v1|${packetId}|${vendorName.trim().toLowerCase()}|${amount.toFixed(2)}|${date}`;
  return createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
}

// =========================================================================
// Internal: canonical-field validation
// =========================================================================

interface FieldExtract<T> {
  value: T | null;
  source: ReceiptReviewPacket["proposedFields"]["vendor"]["source"];
}

function pull<T>(packet: ReceiptReviewPacket, field: keyof ReceiptReviewPacket["proposedFields"]): FieldExtract<T> {
  const f = packet.proposedFields[field];
  return { value: f.value as T | null, source: f.source };
}

function isCanonical(packet: ReceiptReviewPacket, field: keyof ReceiptReviewPacket["proposedFields"]): boolean {
  return packet.proposedFields[field].source === "canonical";
}

function buildOcrDeltas(packet: ReceiptReviewPacket): BillDraftPreview["ocrDeltas"] {
  const deltas: Array<BillDraftPreview["ocrDeltas"][number]> = [];
  const ocr = packet.ocrSuggestion;
  if (!ocr) return deltas;
  // Surface canonical-vs-OCR differences for Rene to see in the
  // approval card. The promoter does NOT use these to overwrite
  // canonical values — they are read-only deltas.
  if (
    typeof ocr.vendor === "string" &&
    typeof packet.canonical.vendor === "string" &&
    ocr.vendor.trim() !== packet.canonical.vendor.trim()
  ) {
    deltas.push({ field: "vendor", canonical: packet.canonical.vendor, ocrSuggestion: ocr.vendor });
  }
  if (
    typeof ocr.date === "string" &&
    typeof packet.canonical.date === "string" &&
    ocr.date !== packet.canonical.date
  ) {
    deltas.push({ field: "date", canonical: packet.canonical.date, ocrSuggestion: ocr.date });
  }
  if (
    typeof ocr.amount === "number" &&
    typeof packet.canonical.amount === "number" &&
    Math.abs(ocr.amount - packet.canonical.amount) > 0.005
  ) {
    deltas.push({ field: "amount", canonical: packet.canonical.amount, ocrSuggestion: ocr.amount });
  }
  return deltas;
}

// =========================================================================
// Public API
// =========================================================================

export interface PromoteToBillDraftDeps {
  vendorProbe: VendorProbe;
  approvalOpener: ApprovalOpener;
  dedupeProbe: DedupeProbe;
}

export async function promoteReceiptToBillDraft(
  packet: ReceiptReviewPacket,
  deps: PromoteToBillDraftDeps,
): Promise<BillDraftPacket> {
  // ---- 1. Slug fail-closed guard -----------------------------------------
  const slugErr = assertSlugIsClassB();
  if (slugErr) return { status: "fail-closed", reason: slugErr.reason };

  // ---- 2. Packet status gate ---------------------------------------------
  if (packet.status !== "rene-approved") {
    return {
      status: "blocked-packet-status",
      reason: "packet-not-rene-approved",
      packetId: packet.packetId,
      packetStatus: packet.status,
    };
  }

  // ---- 3. Required canonical-field validation ----------------------------
  // OCR is suggestion only — only `source === "canonical"` counts.
  // Missing canonical fields surface honestly; the promoter does NOT
  // promote OCR values to canonical.
  const missing: Array<(typeof REQUIRED_CANONICAL_FIELDS)[number]> = [];
  for (const field of REQUIRED_CANONICAL_FIELDS) {
    if (!isCanonical(packet, field)) missing.push(field);
  }
  if (missing.length > 0) {
    const warnings: string[] = [];
    for (const field of REQUIRED_CANONICAL_FIELDS) {
      const f = packet.proposedFields[field];
      if (f.source === "ocr-suggested") {
        warnings.push(
          `${field} has OCR suggestion only; reviewer must confirm canonically before promotion (OCR is suggestion only, never overwrites canonical).`,
        );
      }
    }
    return {
      status: "review-needed",
      reason: "missing-canonical-fields",
      packetId: packet.packetId,
      missing,
      warnings,
    };
  }

  const vendorName = pull<string>(packet, "vendor").value!;
  const amount = pull<number>(packet, "amount").value!;
  const date = pull<string>(packet, "date").value!;
  const category = pull<string>(packet, "category").value!;
  const currency = pull<string>(packet, "currency").value;
  const paymentMethod = pull<string>(packet, "payment_method").value;

  // ---- 4. Vendor resolution (P0-4 dependency) ----------------------------
  // The promoter NEVER creates a vendor. If the vendor isn't in the
  // approved registry, it routes the operator to the P0-4
  // vendor-master coordinator path.
  const vendor = await deps.vendorProbe.resolve(vendorName);
  if (vendor.kind === "not-found") {
    return {
      status: "blocked-vendor",
      reason: "vendor-not-found",
      packetId: packet.packetId,
      vendorName,
      vendorMasterDependency: {
        coordinatorPath: "src/lib/ops/vendor-master/coordinator.ts",
        approvalSlug: "vendor.master.create",
        requiredApprover: "Rene",
      },
    };
  }
  if (vendor.kind === "pending") {
    return {
      status: "blocked-vendor",
      reason: "vendor-pending-approval",
      packetId: packet.packetId,
      vendorName,
      vendorMasterDependency: {
        coordinatorPath: "src/lib/ops/vendor-master/coordinator.ts",
        approvalSlug: "vendor.master.create",
        requiredApprover: "Rene",
        existingApprovalId: vendor.approvalId,
      },
    };
  }
  if (vendor.kind === "ambiguous") {
    return {
      status: "blocked-vendor",
      reason: "vendor-ambiguous",
      packetId: packet.packetId,
      vendorName,
      vendorMasterDependency: {
        coordinatorPath: "src/lib/ops/vendor-master/coordinator.ts",
        approvalSlug: "vendor.master.create",
        requiredApprover: "Rene",
        candidates: vendor.candidates,
      },
    };
  }
  // vendor.kind === "found"
  const { qboVendorId, displayName: vendorDisplayName } = vendor;

  // ---- 5. Idempotency / dedupe -------------------------------------------
  const idempotencyKey = buildIdempotencyKey(packet.packetId, vendorName, amount, date);
  const dedupe = await deps.dedupeProbe.check(idempotencyKey);
  if (dedupe) {
    return {
      status: "duplicate",
      reason: dedupe.kind === "approval-pending" ? "approval-pending" : "approval-completed",
      packetId: packet.packetId,
      idempotencyKey,
      existingApprovalId: dedupe.approvalId,
    };
  }

  // ---- 6. Build preview + open approval ---------------------------------
  const ocrDeltas = buildOcrDeltas(packet);
  const preview: BillDraftPreview = {
    vendorDisplayName,
    qboVendorId,
    amount,
    date,
    category,
    currency: currency ?? null,
    paymentMethod: paymentMethod ?? null,
    ocrDeltas,
  };

  const payloadPreview = [
    "*QBO bill draft request*",
    "",
    `Vendor: ${vendorDisplayName} (QBO ${qboVendorId})`,
    `Amount: ${amount.toFixed(2)}${currency ? ` ${currency}` : ""}`,
    `Date: ${date}`,
    `Category: ${category}`,
    paymentMethod ? `Payment method: ${paymentMethod}` : null,
    `Receipt packet: ${packet.packetId} (${packet.receiptId})`,
    ocrDeltas.length > 0
      ? `OCR deltas: ${ocrDeltas.map((d) => d.field).join(", ")} (canonical preserved; OCR is suggestion only)`
      : null,
    "",
    "_Rene approval required. No QBO write occurs before approval._",
  ]
    .filter(Boolean)
    .join("\n");

  const opened = await deps.approvalOpener.open({
    actionSlug: REQUIRED_SLUG,
    targetSystem: "qbo",
    targetEntity: {
      type: "qbo-bill-draft",
      id: idempotencyKey,
      label: `${vendorDisplayName} ${amount.toFixed(2)} (${date})`,
    },
    payloadPreview,
    payloadRef: `bill-draft:packet:${packet.packetId}`,
    evidence: {
      claim:
        `Open QBO bill draft for ${vendorDisplayName} (${amount.toFixed(2)} on ${date}) ` +
        `from receipt-review packet ${packet.packetId}. Canonical reviewed fields only — ` +
        `OCR suggestions are visible side-by-side but never overwrite canonical values.`,
      sources: [
        {
          system: "kv:docs:receipt_review_packets",
          id: packet.packetId,
          retrievedAt: new Date().toISOString(),
        },
        {
          system: "kv:docs:receipts",
          id: packet.receiptId,
          retrievedAt: new Date().toISOString(),
        },
        {
          system: "vendor-master:registry",
          id: qboVendorId,
          retrievedAt: new Date().toISOString(),
        },
      ],
      confidence:
        ocrDeltas.length === 0 ? 0.95 : 0.85, // canonical+OCR agree → high; deltas → reviewer signal
    },
    rollbackPlan:
      "If created in error, Rene voids the QBO bill via `qbo.bill.void` (or rejects the approval before it lands). " +
      "Receipt canonical fields and review-packet status remain unchanged. " +
      "No vendor record, payment, or ACH is created by this flow.",
    idempotencyKey,
  });

  if (!opened.ok) {
    return {
      status: "fail-closed",
      reason: `approval opener failed: ${opened.error}`,
    };
  }

  return {
    status: "approval-opened",
    packetId: packet.packetId,
    idempotencyKey,
    approvalId: opened.approvalId,
    threadTs: opened.threadTs ?? null,
    vendor: { qboVendorId, displayName: vendorDisplayName },
    preview,
  };
}

/** Exposed for tests. */
export const __INTERNAL = {
  REQUIRED_SLUG,
  REQUIRED_CANONICAL_FIELDS,
  RECOMMENDED_CANONICAL_FIELDS,
  assertSlugIsClassB,
  buildIdempotencyKey,
  buildOcrDeltas,
  isCanonical,
};
