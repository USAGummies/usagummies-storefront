/**
 * Wholesale onboarding flow — Phase 35.b state machine.
 *
 * Pure state machine for the 11-step flow described in
 * `/contracts/wholesale-onboarding-flow.md` v1.0 (graduated from
 * v0.1 DRAFT after applying the named defaults from
 * Ben + Rene call recap §3 + §4 + §13, 2026-04-27 PM).
 *
 * **Defaults applied** (Rene punch-lists tomorrow if anything is wrong):
 *   - Q1 — page path: `/wholesale/order` (separate from existing
 *     `/wholesale` lead form). Lead form remains top-of-funnel.
 *   - Q2 — credit-card checkout: Shopify B2B (existing infra).
 *   - Q3 — AP packet template: new `wholesale-ap` template
 *     (reuses the send + audit pipeline).
 *   - Q4 — order-captured-before-AP semantics: HubSpot stage
 *     `pending_ap_approval` + new `wholesale-order-captured` KV
 *     envelope; QBO invoice waits until AP ack.
 *   - Q5 — QBO `vendor.master.create` approval timing: auto-stage
 *     on form submit so Rene can review while AP ack is still
 *     pending.
 *
 * **Doctrinal rules locked in code** (per the call recap):
 *   1. Atomic bag-level inventory — order types decrement bag
 *      inventory. No case/carton/pallet SKUs.
 *   2. Online MOQ = master carton. LCD (local case, Ben delivers) is INTERNAL only.
 *   3. Designators B1-B5 are stable identifiers across order line
 *      items, QBO invoices, Slack notifications, HubSpot deal
 *      properties.
 *   4. Custom freight only at 3+ pallets.
 *   5. Everything traces to a deal/customer/source — no floating
 *      records.
 *   6. Once AP path is selected, the order is captured + counted as
 *      acknowledged intent (NOT optional). The customer is on the
 *      hook.
 *
 * **Pure** — no I/O. Routes orchestrate the side effects (HubSpot
 * write, KV write, AP packet send, QBO approval card open).
 */
import {
  isPricingTier,
  onlineTiers,
  summarizeOrderLine,
  type OrderLineSummary,
  type PricingTier,
} from "./pricing-tiers";

/** The 11 distinct steps in canonical order. */
export type OnboardingStep =
  | "info" // 1. basic prospect info (company, contact, email, phone)
  | "store-type" // 2. store / business-type select
  | "pricing-shown" // 3. pricing displayed (B2-B5 table)
  | "order-type" // 4. master carton vs pallet + unit count
  | "payment-path" // 5. CC vs AP choice
  | "ap-info" // 6. AP-only — AP email/contact OR self-fill AP info
  | "order-captured" // 7. order captured (intent acknowledged)
  | "shipping-info" // 8. destination/shipping address
  | "ap-email-sent" // 9. AP onboarding email sent (AP path only)
  | "qbo-customer-staged" // 10. QBO vendor.master.create approval staged for Rene
  | "crm-updated"; // 11. HubSpot deal updated, downstream ready

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "info",
  "store-type",
  "pricing-shown",
  "order-type",
  "payment-path",
  "ap-info",
  "order-captured",
  "shipping-info",
  "ap-email-sent",
  "qbo-customer-staged",
  "crm-updated",
] as const;

export type PaymentPath = "credit-card" | "accounts-payable";

export type StoreType =
  | "specialty-retail"
  | "grocery"
  | "convenience"
  | "gas-station"
  | "trade-show-vendor"
  | "distributor"
  | "online-marketplace"
  | "gift-shop"
  | "park-or-museum"
  | "other";

export const STORE_TYPES: readonly StoreType[] = [
  "specialty-retail",
  "grocery",
  "convenience",
  "gas-station",
  "trade-show-vendor",
  "distributor",
  "online-marketplace",
  "gift-shop",
  "park-or-museum",
  "other",
] as const;

export interface ProspectInfo {
  /** Legal company name. Required. */
  companyName: string;
  /** Contact person at the company. Required. */
  contactName: string;
  /** Contact email. Required (primary CRM key). */
  contactEmail: string;
  /** Contact phone. Optional. */
  contactPhone?: string;
}

export interface ShippingAddress {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface APInfo {
  /** Either an AP-team email to send the onboarding packet, OR self-fill below. */
  apEmail?: string;
  /** Self-fill: AP contact name. */
  apContactName?: string;
  /** Self-fill: AP contact phone. */
  apContactPhone?: string;
  /** Self-fill: tax id / EIN. */
  taxId?: string;
  /** Self-fill: legal entity type (LLC, Corp, etc.). */
  legalEntityType?: string;
  /** Self-fill: billing address (often differs from shipping). */
  billingAddress?: ShippingAddress;
}

export interface OnboardingState {
  /** Stable per-flow id. Generated server-side on step 1. */
  flowId: string;
  /** Current step the prospect is on. */
  currentStep: OnboardingStep;
  /** History — every step the flow has passed through. */
  stepsCompleted: readonly OnboardingStep[];
  /** Step 1 info. */
  prospect?: ProspectInfo;
  /** Step 2 store type. */
  storeType?: StoreType;
  /** Step 4 order-line(s). May be multi-line in future; v1.0 is 1 line. */
  orderLines: readonly OrderLineSummary[];
  /** Step 5 payment path choice. */
  paymentPath?: PaymentPath;
  /** Step 6 AP info (AP path only). */
  apInfo?: APInfo;
  /** Step 8 destination address. */
  shippingAddress?: ShippingAddress;
  /** Server-side timestamps for each step. */
  timestamps: Readonly<Partial<Record<OnboardingStep, string>>>;
  /** HubSpot deal id once created. */
  hubspotDealId?: string;
  /** QBO `vendor.master.create` approval id once staged. */
  qboCustomerApprovalId?: string;
}

// ---------------------------------------------------------------------------
// Pure state-transition functions
// ---------------------------------------------------------------------------

/** Build an empty state for a freshly-started flow. */
export function newOnboardingState(flowId: string): OnboardingState {
  if (!flowId.trim()) throw new Error("newOnboardingState: flowId required");
  return {
    flowId,
    currentStep: "info",
    stepsCompleted: [],
    orderLines: [],
    timestamps: {},
  };
}

/**
 * Advance the state by recording a step's completion + moving the
 * cursor to the next step. Pure — returns a new state object.
 *
 * Throws if the requested step doesn't follow the canonical order
 * (defense against out-of-band POSTs from a misbehaving client).
 *
 * `mutator` lets the caller fold step-specific data into the state
 * without coupling this helper to every step's payload shape.
 */
export function advanceStep(
  state: OnboardingState,
  step: OnboardingStep,
  now: Date,
  mutator?: (s: OnboardingState) => Partial<OnboardingState>,
): OnboardingState {
  const expected = nextStep(state);
  if (expected !== step) {
    throw new Error(
      `advanceStep: expected step "${expected}", got "${step}". Out-of-order POST or stale client.`,
    );
  }
  const merged: OnboardingState = mutator
    ? { ...state, ...mutator(state) }
    : state;
  return {
    ...merged,
    currentStep: stepAfter(step) ?? step,
    stepsCompleted: [...merged.stepsCompleted, step],
    timestamps: { ...merged.timestamps, [step]: now.toISOString() },
  };
}

/**
 * What step should run next given the current state. Pure.
 *
 * Branching: AP path runs `ap-info` then `ap-email-sent`. Credit-
 * card path SKIPS those (no AP packet needed) and goes straight
 * from `payment-path` → `order-captured` → `shipping-info` →
 * `qbo-customer-staged` → `crm-updated`.
 *
 * Step `order-captured` is the canonical "intent acknowledged"
 * boundary — once we're past it, the customer is on the hook for
 * the order.
 */
export function nextStep(state: OnboardingState): OnboardingStep | null {
  const visited = new Set(state.stepsCompleted);
  for (const step of ONBOARDING_STEPS) {
    if (visited.has(step)) continue;
    // Skip AP-only steps when the chosen path is credit-card.
    if (
      state.paymentPath === "credit-card" &&
      (step === "ap-info" || step === "ap-email-sent")
    ) {
      continue;
    }
    return step;
  }
  return null;
}

function stepAfter(step: OnboardingStep): OnboardingStep | null {
  const idx = ONBOARDING_STEPS.indexOf(step);
  if (idx === -1) return null;
  if (idx === ONBOARDING_STEPS.length - 1) return null;
  return ONBOARDING_STEPS[idx + 1] ?? null;
}

// ---------------------------------------------------------------------------
// Validation helpers (used at API boundary)
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  errors: readonly string[];
}

/** Validate prospect info at step 1. Pure. */
export function validateProspectInfo(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["prospect info must be an object"] };
  }
  const p = input as Record<string, unknown>;
  if (typeof p.companyName !== "string" || !p.companyName.trim()) {
    errors.push("companyName required");
  }
  if (typeof p.contactName !== "string" || !p.contactName.trim()) {
    errors.push("contactName required");
  }
  if (typeof p.contactEmail !== "string" || !p.contactEmail.trim()) {
    errors.push("contactEmail required");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.contactEmail)) {
    errors.push("contactEmail must be a valid email address");
  }
  // contactPhone optional; if present, just length-check (no carrier
  // validation — we accept whatever the customer types).
  if (
    p.contactPhone !== undefined &&
    p.contactPhone !== null &&
    typeof p.contactPhone !== "string"
  ) {
    errors.push("contactPhone must be a string when provided");
  }
  return { ok: errors.length === 0, errors };
}

/** Validate the chosen tier + unit count at step 4. Pure. */
export function validateOrderLine(
  tier: unknown,
  unitCount: unknown,
): ValidationResult {
  const errors: string[] = [];
  if (!isPricingTier(tier)) {
    errors.push(
      `tier must be one of B2/B3/B4/B5 (online tiers); got ${JSON.stringify(tier)}`,
    );
  } else if (!onlineTiers().includes(tier)) {
    errors.push(`tier ${tier} is INTERNAL only and cannot be selected online`);
  }
  if (typeof unitCount !== "number" || !Number.isFinite(unitCount)) {
    errors.push("unitCount must be a finite number");
  } else if (unitCount < 1) {
    errors.push("unitCount must be at least 1 (online MOQ is 1 master carton)");
  } else if (!Number.isInteger(unitCount)) {
    errors.push("unitCount must be a whole number");
  }
  return { ok: errors.length === 0, errors };
}

/** Validate the AP info captured at step 6. Pure. */
export function validateAPInfo(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["AP info must be an object"] };
  }
  const ap = input as Record<string, unknown>;
  // Per recap §3: "They either enter an AP email/contact, or they
  // fill out the AP/accounting information themselves. One of those
  // two things must happen before they continue."
  const hasEmail =
    typeof ap.apEmail === "string" && ap.apEmail.trim().length > 0;
  const hasSelfFill =
    typeof ap.apContactName === "string" &&
    typeof ap.taxId === "string" &&
    ap.apContactName.trim().length > 0 &&
    ap.taxId.trim().length > 0;
  if (!hasEmail && !hasSelfFill) {
    return {
      ok: false,
      errors: [
        "Provide either apEmail (we send packet to your AP team) OR self-fill (apContactName + taxId minimum)",
      ],
    };
  }
  if (
    hasEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ap.apEmail as string)
  ) {
    return { ok: false, errors: ["apEmail must be a valid email address"] };
  }
  return { ok: true, errors: [] };
}

/** Validate the shipping address at step 8. Pure. */
export function validateShippingAddress(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["shipping address must be an object"] };
  }
  const a = input as Record<string, unknown>;
  for (const field of ["street1", "city", "state", "postalCode", "country"]) {
    if (typeof a[field] !== "string" || !(a[field] as string).trim()) {
      errors.push(`${field} required`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Order-line projection
// ---------------------------------------------------------------------------

/** Build an order line from validated tier + unitCount inputs. Pure. */
export function buildOrderLine(
  tier: PricingTier,
  unitCount: number,
): OrderLineSummary {
  return summarizeOrderLine(tier, unitCount);
}

/** Sum subtotals across all order lines. Pure. */
export function totalSubtotalUsd(
  lines: readonly OrderLineSummary[],
): number {
  const sum = lines.reduce((acc, l) => acc + l.subtotalUsd, 0);
  return Math.round(sum * 100) / 100;
}

/** Whether ANY order line on this state requires custom-freight quoting. */
export function anyLineNeedsCustomFreight(
  lines: readonly OrderLineSummary[],
): boolean {
  return lines.some((l) => l.customFreightRequired);
}

/** Total bag count across all order lines. Pure. */
export function totalBags(lines: readonly OrderLineSummary[]): number {
  return lines.reduce((acc, l) => acc + l.bags, 0);
}

// ---------------------------------------------------------------------------
// Doctrine — what fires when the state advances
// ---------------------------------------------------------------------------

/**
 * What side-effects should fire when the flow reaches a given
 * step? Returns a list of action slugs the orchestrator should
 * dispatch. Pure — no I/O. The route layer dispatches.
 *
 * Rule of thumb: every state transition that touches an external
 * system surfaces here so the audit trail is buildable from a
 * single source.
 */
export function sideEffectsForStep(
  step: OnboardingStep,
  state: OnboardingState,
): readonly SideEffect[] {
  const out: SideEffect[] = [];
  switch (step) {
    case "info":
      // Same shape as `/api/leads` for trade-show + manual flows.
      out.push({ kind: "hubspot.upsert-contact" });
      out.push({ kind: "hubspot.create-deal", stage: "STAGE_LEAD" });
      out.push({ kind: "kv.archive-inquiry" });
      break;
    case "order-captured":
      // Recap §3: the order is captured + counted as acknowledged
      // intent. HubSpot stage flips to pending_ap_approval (per Q4
      // default — auto-stage on form submit).
      out.push({
        kind: "hubspot.advance-stage",
        stage:
          state.paymentPath === "accounts-payable"
            ? "pending_ap_approval"
            : "PO_RECEIVED",
      });
      out.push({ kind: "kv.write-order-captured" });
      out.push({ kind: "slack.post-financials-notif" });
      break;
    case "ap-email-sent":
      // Q3 default: new wholesale-ap template via the existing AP
      // packet send + audit pipeline.
      out.push({ kind: "ap-packet.send", template: "wholesale-ap" });
      break;
    case "qbo-customer-staged":
      // Q5 default: auto-stage QBO vendor.master.create approval
      // card to Rene the moment we have enough data (after
      // order-captured + shipping-info). Rene reviews while AP ack
      // is still pending.
      out.push({ kind: "qbo.vendor-master-create.stage-approval" });
      break;
    case "crm-updated":
      out.push({ kind: "hubspot.set-onboarding-complete", value: true });
      out.push({ kind: "audit.flow-complete" });
      break;
    default:
      // Other steps don't touch external systems (info captured,
      // displayed, validated client-side).
      break;
  }
  return out;
}

export type SideEffect =
  | { kind: "hubspot.upsert-contact" }
  | { kind: "hubspot.create-deal"; stage: string }
  | { kind: "hubspot.advance-stage"; stage: string }
  | { kind: "hubspot.set-onboarding-complete"; value: boolean }
  | { kind: "kv.archive-inquiry" }
  | { kind: "kv.write-order-captured" }
  | { kind: "slack.post-financials-notif" }
  | { kind: "ap-packet.send"; template: "wholesale-ap" }
  | { kind: "qbo.vendor-master-create.stage-approval" }
  | { kind: "audit.flow-complete" };

// ---------------------------------------------------------------------------
// Route-layer bridge — fold a request payload into the state.
// ---------------------------------------------------------------------------

/**
 * Result of `applyStepPayload`. On success, `mutator` is a pure
 * fn that the route layer hands to `advanceStep` to fold the
 * step-specific data into the OnboardingState. On failure, the
 * route returns 400 with `errors` + does not advance the cursor.
 */
export type ApplyStepResult =
  | {
      ok: true;
      mutator?: (s: OnboardingState) => Partial<OnboardingState>;
    }
  | { ok: false; errors: readonly string[] };

/**
 * Translate an untrusted-from-the-wire `payload` into a
 * step-specific state mutator. Pure — no I/O. Validates per-step
 * shape via the existing `validate*` helpers.
 *
 * Steps that have no payload (`pricing-shown`, `order-captured`,
 * `ap-email-sent`, `qbo-customer-staged`, `crm-updated`) accept
 * `payload === undefined` and return a no-op mutator. The route
 * layer never lets the client drive those steps directly — they
 * fire as server-side transitions after the data-bearing step
 * completes.
 *
 * **Defense:** order-type step rejects LCD via `validateOrderLine`,
 * so an attacker can't sneak the internal-only tier through this
 * surface even if they know the slug.
 */
export function applyStepPayload(
  step: OnboardingStep,
  payload: unknown,
): ApplyStepResult {
  const p = (payload ?? {}) as Record<string, unknown>;

  switch (step) {
    case "info": {
      const v = validateProspectInfo(p.prospect ?? p);
      if (!v.ok) return { ok: false, errors: v.errors };
      const prospect = (p.prospect ?? p) as ProspectInfo;
      return {
        ok: true,
        mutator: () => ({ prospect }),
      };
    }
    case "store-type": {
      const storeType = p.storeType;
      if (
        typeof storeType !== "string" ||
        !(STORE_TYPES as readonly string[]).includes(storeType)
      ) {
        return {
          ok: false,
          errors: [
            `storeType must be one of: ${STORE_TYPES.join(", ")}`,
          ],
        };
      }
      return {
        ok: true,
        mutator: () => ({ storeType: storeType as StoreType }),
      };
    }
    case "pricing-shown": {
      // No payload — just a "yes I saw it" advance.
      return { ok: true };
    }
    case "order-type": {
      const v = validateOrderLine(p.tier, p.unitCount);
      if (!v.ok) return { ok: false, errors: v.errors };
      const tier = p.tier as PricingTier;
      const unitCount = p.unitCount as number;
      return {
        ok: true,
        mutator: (s) => ({
          orderLines: [...s.orderLines, summarizeOrderLine(tier, unitCount)],
        }),
      };
    }
    case "payment-path": {
      const path = p.paymentPath;
      if (path !== "credit-card" && path !== "accounts-payable") {
        return {
          ok: false,
          errors: [
            "paymentPath must be 'credit-card' or 'accounts-payable'",
          ],
        };
      }
      return {
        ok: true,
        mutator: () => ({ paymentPath: path }),
      };
    }
    case "ap-info": {
      const v = validateAPInfo(p.apInfo ?? p);
      if (!v.ok) return { ok: false, errors: v.errors };
      const apInfo = (p.apInfo ?? p) as APInfo;
      return {
        ok: true,
        mutator: () => ({ apInfo }),
      };
    }
    case "order-captured": {
      // Server-internal transition — no client payload.
      return { ok: true };
    }
    case "shipping-info": {
      const v = validateShippingAddress(p.shippingAddress ?? p);
      if (!v.ok) return { ok: false, errors: v.errors };
      const shippingAddress = (p.shippingAddress ?? p) as ShippingAddress;
      return {
        ok: true,
        mutator: () => ({ shippingAddress }),
      };
    }
    case "ap-email-sent":
    case "qbo-customer-staged":
    case "crm-updated": {
      // Server-internal transitions — no client payload, side
      // effects fired by the dispatcher (Phase 35.f).
      return { ok: true };
    }
    default: {
      // Exhaustiveness guard — TS will flag a missing case if the
      // OnboardingStep union grows without updating this switch.
      const exhaustive: never = step;
      return { ok: false, errors: [`unknown step: ${String(exhaustive)}`] };
    }
  }
}
