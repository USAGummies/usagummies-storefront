/**
 * Wholesale onboarding → QBO payload projection — Phase 35.f.6
 *
 * Pure mapping helpers that translate a completed (or in-flight)
 * `OnboardingState` into the payloads required for two QBO writes:
 *
 *   1. **Customer master create** — fed to the
 *      `vendor.master.create` Class B approval card (Rene approves
 *      via `#ops-approvals`). NOTE: QBO calls them "customers" for
 *      AR-bound entities; the slug name `vendor.master.create` is
 *      a control-plane convention — see `/contracts/approval-
 *      taxonomy.md` v1.4 §customer-master-create.
 *
 *   2. **Invoice draft** — fed to `qbo.invoice.draft` (also Class B,
 *      Rene approves). One invoice per onboarding flow; one line
 *      item per `OrderLineSummary` in `state.orderLines`.
 *
 * **Pure** — no I/O. The dispatcher (Phase 35.f.3.b stubs at
 * `qbo.vendor-master-create.stage-approval` + future
 * `qbo.invoice.draft-stage-approval`) consumes these projections.
 *
 * **Honest defaults** — payment terms default to "Net 15" for
 * accounts-payable path (most-common request from the Rene call
 * recap §13). Credit-card path is "Paid on order" since payment
 * captures upstream of the invoice. These are PLACEHOLDERS until
 * Rene locks the canonical terms map. Any tomorrow-punch-list edit
 * is one diff.
 *
 * **No fabrication** — projection functions throw on missing
 * required fields rather than emit a half-formed payload that
 * would corrupt QBO. Callers (route layer) should validate up
 * front.
 */
import type {
  OnboardingState,
  ShippingAddress,
} from "./onboarding-flow";
import {
  TIER_INVOICE_LABEL,
  type OrderLineSummary,
} from "./pricing-tiers";

// ---------------------------------------------------------------------------
// Customer master projection (vendor.master.create Class B)
// ---------------------------------------------------------------------------

export interface QboCustomerProjection {
  /** Display name for the customer record. Required. */
  displayName: string;
  /** Primary contact name. Required. */
  contactName: string;
  /** Primary email. Required for invoice send. */
  primaryEmail: string;
  /** Primary phone. Optional. */
  primaryPhone?: string;
  /** Company / DBA name. Required. */
  companyName: string;
  /** Billing address. Defaults to shipping when AP path didn't capture
   *  a separate billing address. May be undefined if neither captured. */
  billingAddress?: ShippingAddress;
  /** Shipping address. Required for any line-shipped order. */
  shippingAddress: ShippingAddress;
  /** Payment terms (Net 15 / Net 30 / COD / Paid on order). */
  paymentTerms: string;
  /** Custom notes — free-form, used by Rene for context. */
  notes: string;
  /** Stable id binding — links the QBO record to the onboarding flow. */
  externalRef: { source: "wholesale-onboarding"; flowId: string };
}

/** Default payment terms by payment path. PLACEHOLDER pending Rene sign-off. */
const PAYMENT_TERMS_BY_PATH: Record<
  NonNullable<OnboardingState["paymentPath"]>,
  string
> = {
  "credit-card": "Paid on order",
  "accounts-payable": "Net 15",
};

/**
 * Build the QBO customer master projection. Pure.
 *
 * Throws on missing required fields (companyName, contactName,
 * contactEmail, shippingAddress) — these are the QBO record
 * minimum. The flow can't reach `qbo-customer-staged` without
 * them, but the validation here is defensive.
 */
export function projectQboCustomer(
  state: OnboardingState,
): QboCustomerProjection {
  const p = state.prospect;
  if (!p) {
    throw new Error("projectQboCustomer: state.prospect missing");
  }
  if (!p.companyName.trim()) {
    throw new Error("projectQboCustomer: companyName required");
  }
  if (!p.contactName.trim()) {
    throw new Error("projectQboCustomer: contactName required");
  }
  if (!p.contactEmail.trim()) {
    throw new Error("projectQboCustomer: contactEmail required");
  }
  if (!state.shippingAddress) {
    throw new Error("projectQboCustomer: shippingAddress required");
  }

  const paymentTerms = state.paymentPath
    ? PAYMENT_TERMS_BY_PATH[state.paymentPath]
    : "Net 15";

  return {
    displayName: p.companyName,
    contactName: p.contactName,
    primaryEmail: p.contactEmail,
    primaryPhone: p.contactPhone,
    companyName: p.companyName,
    billingAddress: state.apInfo?.billingAddress ?? state.shippingAddress,
    shippingAddress: state.shippingAddress,
    paymentTerms,
    notes: buildCustomerNotes(state),
    externalRef: { source: "wholesale-onboarding", flowId: state.flowId },
  };
}

function buildCustomerNotes(state: OnboardingState): string {
  const parts: string[] = [];
  parts.push(`Created via wholesale onboarding flow ${state.flowId}.`);
  if (state.storeType) {
    parts.push(`Store type: ${state.storeType}.`);
  }
  if (state.paymentPath) {
    parts.push(`Payment path: ${state.paymentPath}.`);
  }
  if (state.apInfo?.apEmail) {
    parts.push(`AP team email: ${state.apInfo.apEmail}.`);
  }
  if (state.apInfo?.taxId) {
    parts.push(`Tax ID on file: ${state.apInfo.taxId}.`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Invoice projection (qbo.invoice.draft Class B)
// ---------------------------------------------------------------------------

export interface QboInvoiceLine {
  /** 1-based line number for ordering in the invoice. */
  lineNumber: number;
  /** Display text — embeds the B-tier designator (audit trail). */
  description: string;
  /** Quantity in bags (atomic-bag inventory model). */
  quantity: number;
  /** Per-bag rate in USD. */
  rate: number;
  /** Line total — quantity × rate, rounded to 2dp. */
  amount: number;
  /** Designator for filtering / reporting (B2/B3/B4/B5). */
  tier: OrderLineSummary["tier"];
  /** Freight mode for this tier (UI/email use). */
  freightMode: OrderLineSummary["freightMode"];
  /** Whether custom-freight quote takes precedence over the line's
   *  freight mode (set by `shouldUseCustomFreightQuote`). */
  customFreightOverride: boolean;
}

export interface QboInvoiceProjection {
  /** Stable id for invoice → flow → audit cross-reference. */
  externalRef: { source: "wholesale-onboarding"; flowId: string };
  /** Invoice line items. One per OrderLineSummary in state. */
  lines: readonly QboInvoiceLine[];
  /** Sum of line amounts, rounded to 2dp. Excludes shipping/tax. */
  subtotalUsd: number;
  /** Payment terms (mirrors customer projection). */
  paymentTerms: string;
  /** Memo shown on the invoice — embeds the flowId + customer notes. */
  memo: string;
  /** True if ANY line crosses the custom-freight threshold (3+ pallets
   *  on B4/B5). When true, Rene must replace the line with a manual
   *  custom freight quote before sending. */
  requiresCustomFreightQuote: boolean;
}

/**
 * Build the QBO invoice draft projection. Pure.
 *
 * Throws if the flow has zero order lines — every invoice must
 * have at least one. The flow can't reach `qbo-customer-staged`
 * without an order line, but the check is defensive.
 *
 * Each line embeds the B-tier designator in the description so
 * future audits can trace the price tier even if the per-bag rate
 * changes.
 */
export function projectQboInvoice(
  state: OnboardingState,
): QboInvoiceProjection {
  if (state.orderLines.length === 0) {
    throw new Error(
      "projectQboInvoice: state.orderLines is empty — invoice requires at least one line",
    );
  }

  const lines: QboInvoiceLine[] = state.orderLines.map((l, idx) => ({
    lineNumber: idx + 1,
    description: formatInvoiceLineText(l),
    quantity: l.bags,
    rate: l.bagPriceUsd,
    amount: l.subtotalUsd,
    tier: l.tier,
    freightMode: l.freightMode,
    customFreightOverride: l.customFreightRequired,
  }));

  const subtotalUsd =
    Math.round(
      lines.reduce((acc, l) => acc + l.amount, 0) * 100,
    ) / 100;

  const paymentTerms = state.paymentPath
    ? PAYMENT_TERMS_BY_PATH[state.paymentPath]
    : "Net 15";

  const requiresCustomFreightQuote = lines.some(
    (l) => l.customFreightOverride,
  );

  return {
    externalRef: { source: "wholesale-onboarding", flowId: state.flowId },
    lines,
    subtotalUsd,
    paymentTerms,
    memo: buildInvoiceMemo(state),
    requiresCustomFreightQuote,
  };
}

function buildInvoiceMemo(state: OnboardingState): string {
  const parts: string[] = [];
  parts.push(`Wholesale order — flow ${state.flowId}.`);
  if (state.prospect?.companyName) {
    parts.push(`Customer: ${state.prospect.companyName}.`);
  }
  if (state.shippingAddress) {
    parts.push(
      `Ship to: ${state.shippingAddress.city}, ${state.shippingAddress.state}.`,
    );
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Invoice line text formatter
// ---------------------------------------------------------------------------

/**
 * Format an order line into the descriptive text shown on the QBO
 * invoice. Pure. Embeds the B-tier designator + unit count + bag
 * count so audits can verify the math even years later.
 *
 * Examples:
 *   formatInvoiceLineText({ tier: "B2", unitCount: 3, bags: 108, ... })
 *   → "B2 — Master carton (36 bags), landed × 3 master cartons (108 bags total)"
 */
export function formatInvoiceLineText(line: OrderLineSummary): string {
  const baseLabel = TIER_INVOICE_LABEL[line.tier];
  const unitNoun = line.unitCount === 1 ? unitSingular(line) : unitPlural(line);
  return `${baseLabel} × ${line.unitCount} ${unitNoun} (${line.bags} bags total)`;
}

function unitSingular(line: OrderLineSummary): string {
  switch (line.tier) {
    case "B1":
      return "case";
    case "B2":
    case "B3":
      return "master carton";
    case "B4":
    case "B5":
      return "pallet";
  }
}

function unitPlural(line: OrderLineSummary): string {
  switch (line.tier) {
    case "B1":
      return "cases";
    case "B2":
    case "B3":
      return "master cartons";
    case "B4":
    case "B5":
      return "pallets";
  }
}

// ---------------------------------------------------------------------------
// Test helpers — NOT exported from a barrel
// ---------------------------------------------------------------------------

export const __INTERNAL = {
  PAYMENT_TERMS_BY_PATH,
  buildCustomerNotes,
  buildInvoiceMemo,
};
