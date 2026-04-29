/**
 * Vendor-Master Coordinator — P0-4 from `/contracts/agent-architecture-audit.md`.
 *
 * Implements the upstream gate over the existing `vendor.master.create`
 * Class B approval path (`src/lib/ops/vendor-onboarding.ts`).
 *
 * **The lower-layer onboarding module already ships:**
 *   - `parseVendorOnboardingInput()` — input parser
 *   - `normalizeVendorKey()` — dedupe key
 *   - `openVendorOnboardingApproval()` — opens the Class B approval via
 *     the canonical `requestApproval()` control-plane path
 *   - `executeApprovedVendorMasterCreate()` — APPROVED-CLOSER that
 *     creates QBO vendor + Notion dossier + Drive folder atomically
 *
 * **What this coordinator adds (P0-4 surface):**
 *   - A pure validator that grades input completeness against the
 *     vendor-master required-field set (more strict than the lower
 *     module's `name`-only requirement).
 *   - An explicit "review-needed" state that returns the missing
 *     fields WITHOUT opening an approval (honest field surfacing per
 *     the build directive).
 *   - A duplicate-detection pre-check that returns the existing
 *     registry record WITHOUT opening a duplicate approval.
 *   - Defense-in-depth fail-closed on the `vendor.master.create` slug
 *     — the coordinator independently re-validates the slug against
 *     the taxonomy before delegating.
 *
 * **Class B only — Rene approver.** The coordinator NEVER:
 *   - creates a QBO vendor without approval (that's the closer's job)
 *   - writes to Notion dossier or Drive folder (closer)
 *   - modifies QBO Chart of Accounts (Class D — prohibited)
 *   - releases payment / ACH (separate Class C `payment.release` slug)
 *   - selects Drew as approver (Drew owns nothing)
 *   - invents vendor data (missing fields → review-needed, never defaulted)
 *
 * Pure DI: tests pass synthetic dedupe + approval functions; production
 * wires the existing `kv` registry and `openVendorOnboardingApproval`.
 */

import {
  parseVendorOnboardingInput,
  normalizeVendorKey,
  type VendorOnboardingInput,
  type OpenVendorOnboardingResult,
} from "@/lib/ops/vendor-onboarding-parse";
import { classify } from "@/lib/ops/control-plane/taxonomy";

// =========================================================================
// Required-field policy
// =========================================================================

/**
 * Required fields for a complete vendor master record. Missing any of
 * these blocks approval — the coordinator returns `review-needed` with
 * the list. The set comes from the QBO vendor schema's must-haves
 * (display name, billing address) plus AP doctrine (tax ID + contact
 * email so Rene can resolve disputes without Slack lookup).
 */
export const REQUIRED_VENDOR_FIELDS: readonly string[] = Object.freeze([
  "name",
  "contactName",
  "email",
  "taxIdentifier",
  "address.line1",
  "address.city",
  "address.state",
  "address.postalCode",
]);

/**
 * Recommended fields. Missing these does NOT block approval but produces
 * `warnings[]` in the packet so Rene sees the gap during review.
 */
export const RECOMMENDED_VENDOR_FIELDS: readonly string[] = Object.freeze([
  "phone",
  "terms",
  "w9DriveUrl",
  "coiDriveUrl",
  "originator",
]);

// =========================================================================
// Output shapes
// =========================================================================

export interface ValidationResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

export interface ReviewNeededPacket {
  status: "review-needed";
  reason: "missing-required-fields";
  dedupeKey: string;
  /** Field paths from REQUIRED_VENDOR_FIELDS that are absent / blank. */
  missing: string[];
  /** Field paths from RECOMMENDED_VENDOR_FIELDS that are absent. */
  warnings: string[];
  /** Echo of the parsed (NOT defaulted) input for review. */
  input: VendorOnboardingInput;
}

export interface DuplicatePacket {
  status: "duplicate";
  reason: "vendor-already-onboarded" | "vendor-onboarding-pending";
  dedupeKey: string;
  /** Existing record returned by the dedupe probe (registry or pending). */
  existing: unknown;
}

export interface ReadyPacket {
  status: "ready";
  dedupeKey: string;
  /** Validation summary (ok=true, no missing required fields). */
  validation: ValidationResult;
  /** Approval result returned by `openVendorOnboardingApproval`. */
  approval: Extract<OpenVendorOnboardingResult, { ok: true }>;
  input: VendorOnboardingInput;
}

export interface CoordinatorErrorPacket {
  status: "error";
  reason: string;
  /** Optional surface-level error details (parse / approval failures). */
  detail?: unknown;
}

export type CoordinatorPacket =
  | ReviewNeededPacket
  | DuplicatePacket
  | ReadyPacket
  | CoordinatorErrorPacket;

// =========================================================================
// Pure validator
// =========================================================================

function fieldByPath(
  input: VendorOnboardingInput,
  path: string,
): unknown {
  if (!path.includes(".")) return (input as unknown as Record<string, unknown>)[path];
  const parts = path.split(".");
  let cursor: unknown = input;
  for (const p of parts) {
    if (cursor && typeof cursor === "object" && p in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
  return Boolean(v);
}

/**
 * Pure validator. Same input → same output. Tests call directly.
 */
export function validateVendorPacket(input: VendorOnboardingInput): ValidationResult {
  const missing: string[] = [];
  for (const path of REQUIRED_VENDOR_FIELDS) {
    if (!isPresent(fieldByPath(input, path))) missing.push(path);
  }
  const warnings: string[] = [];
  for (const path of RECOMMENDED_VENDOR_FIELDS) {
    if (!isPresent(fieldByPath(input, path))) warnings.push(path);
  }
  return { ok: missing.length === 0, missing, warnings };
}

// =========================================================================
// Slug guard — defense-in-depth
// =========================================================================

const REQUIRED_SLUG = "vendor.master.create";

/**
 * Re-validate the slug against the canonical taxonomy. If a future edit
 * promoted the slug to Class D (or removed it), the coordinator
 * fail-closes BEFORE delegating. Returns null on success; an error
 * packet on failure.
 */
function assertSlugIsClassB(): CoordinatorErrorPacket | null {
  const spec = classify(REQUIRED_SLUG);
  if (!spec) {
    return {
      status: "error",
      reason: `unknown action slug "${REQUIRED_SLUG}" — fail-closed. Register the slug in /contracts/approval-taxonomy.md and src/lib/ops/control-plane/taxonomy.ts before running the coordinator.`,
    };
  }
  if (spec.class !== "B") {
    return {
      status: "error",
      reason: `action slug "${REQUIRED_SLUG}" is Class ${spec.class}, but vendor-master-coordinator requires Class B. Coordinator refuses to delegate.`,
    };
  }
  if (!spec.requiredApprovers || !spec.requiredApprovers.includes("Rene")) {
    return {
      status: "error",
      reason: `action slug "${REQUIRED_SLUG}" must list Rene as approver per Drew-owns-nothing doctrine. Got: [${(spec.requiredApprovers ?? []).join(", ")}]`,
    };
  }
  if (spec.requiredApprovers.includes("Drew" as never)) {
    return {
      status: "error",
      reason: `action slug "${REQUIRED_SLUG}" lists Drew as approver — violates CLAUDE.md "Drew owns nothing" doctrine.`,
    };
  }
  return null;
}

// =========================================================================
// Coordinator dependencies (DI for tests)
// =========================================================================

export interface DedupeProbe {
  /**
   * Check whether the dedupe key already corresponds to an existing
   * vendor record (registered) or a pending approval. Return null when
   * neither.
   */
  check(dedupeKey: string): Promise<
    | { kind: "registered"; record: unknown }
    | { kind: "pending"; record: unknown }
    | null
  >;
}

export interface ApprovalOpener {
  open(input: VendorOnboardingInput): Promise<OpenVendorOnboardingResult>;
}

export interface CoordinatorDeps {
  dedupeProbe: DedupeProbe;
  approvalOpener: ApprovalOpener;
}

// =========================================================================
// Orchestrator
// =========================================================================

/**
 * Run the coordinator over a raw input candidate. Decides between
 * `review-needed`, `duplicate`, `ready` (approval opened), or `error`.
 *
 * Crucially: the coordinator NEVER calls QBO / Notion / Drive directly.
 * The only side effect for `ready` is delegation to
 * `approvalOpener.open()`, which goes through the canonical
 * `requestApproval()` path (writes the approval-store record only).
 */
export async function runVendorMasterCoordinator(
  raw: unknown,
  deps: CoordinatorDeps,
): Promise<CoordinatorPacket> {
  // 1. Slug fail-closed guard
  const slugErr = assertSlugIsClassB();
  if (slugErr) return slugErr;

  // 2. Parse input
  const parsed = parseVendorOnboardingInput(raw);
  if (!parsed.ok) {
    return {
      status: "error",
      reason: parsed.error,
    };
  }
  const input = parsed.input;

  // 3. Dedupe pre-check (registry + pending)
  const dedupeKey = normalizeVendorKey(input);
  const existing = await deps.dedupeProbe.check(dedupeKey);
  if (existing) {
    return {
      status: "duplicate",
      reason:
        existing.kind === "registered"
          ? "vendor-already-onboarded"
          : "vendor-onboarding-pending",
      dedupeKey,
      existing: existing.record,
    };
  }

  // 4. Field validation — surface missing required fields HONESTLY,
  //    do NOT default-fill from email or address etc.
  const validation = validateVendorPacket(input);
  if (!validation.ok) {
    return {
      status: "review-needed",
      reason: "missing-required-fields",
      dedupeKey,
      missing: validation.missing,
      warnings: validation.warnings,
      input,
    };
  }

  // 5. Open approval through the canonical path
  const opened = await deps.approvalOpener.open(input);
  if (!opened.ok) {
    return {
      status: "error",
      reason: opened.error,
      detail: { existing: opened.existing, status: opened.status },
    };
  }

  return {
    status: "ready",
    dedupeKey,
    validation,
    approval: opened,
    input,
  };
}

/** Exposed for tests. */
export const __INTERNAL = {
  REQUIRED_SLUG,
  REQUIRED_VENDOR_FIELDS,
  RECOMMENDED_VENDOR_FIELDS,
  fieldByPath,
  isPresent,
  assertSlugIsClassB,
};
