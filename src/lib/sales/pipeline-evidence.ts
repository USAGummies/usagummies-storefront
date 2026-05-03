/**
 * Pipeline Evidence — strict sales-stage doctrine.
 *
 * **Why this exists:** HubSpot stages can be advanced manually or
 * inferred from activity. That's noise. We want a deterministic,
 * evidence-backed system: a stage is only TRUE when verifiable
 * artifacts (PO doc, shipment tracking, payment record, etc.) back
 * it up. HubSpot stage REFLECTS the verified state — it doesn't
 * CREATE the verified state.
 *
 * Doctrine pinned by tests:
 *   - 12 canonical stages, ordered.
 *   - Per-stage minimum evidence requirements (what counts).
 *   - Verification statuses: unverified / system_verified /
 *     human_verified / needs_review / conflicting_evidence.
 *   - Drift = HubSpot stage > verified stage by ≥ 2 steps OR claims
 *     a stage with zero supporting evidence types.
 *   - Conversion timestamps captured on every transition for KPI
 *     reporting.
 *   - HubSpot stage alone is NOT evidence (see `EVIDENCE_TYPES_BY_STAGE`).
 *
 * Pure module: no I/O, no env reads. The store layer wraps KV.
 *
 * Pairs with:
 *   - src/lib/sales/pipeline-verifier.ts — pure validator
 *   - src/lib/sales/pipeline-evidence-store.ts — KV I/O boundary
 *   - /contracts/slack-card-doctrine.md — Slack drift card standard
 */

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * 12 canonical sales stages, ordered. Each stage has a numeric index
 * for drift comparison ("HubSpot says PO Received but evidence only
 * supports Quote Sent" → drift = 1 step).
 */
export const PIPELINE_STAGES = [
  "interested",
  "sample_requested",
  "sample_shipped",
  "sample_delivered",
  "vendor_setup",
  "quote_sent",
  "po_received",
  "invoice_sent",
  "paid",
  "shipped",
  "reorder_due",
  "reordered",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Numeric ordering for drift comparison. 0 = interested, 11 = reordered. */
export function stageIndex(s: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(s);
}

/** Human label for surfaces (Slack cards, dashboard, brief copy). */
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  interested: "Interested",
  sample_requested: "Sample Requested",
  sample_shipped: "Sample Shipped",
  sample_delivered: "Sample Delivered",
  vendor_setup: "Vendor Setup",
  quote_sent: "Quote Sent",
  po_received: "PO / Order Received",
  invoice_sent: "Invoice Sent",
  paid: "Paid",
  shipped: "Shipped",
  reorder_due: "Reorder Due",
  reordered: "Reordered",
};

// ---------------------------------------------------------------------------
// Evidence types
// ---------------------------------------------------------------------------

/**
 * Granular evidence type — what physical / digital artifact supports
 * a stage. Each evidence type carries a stable id so the audit trail
 * doesn't drift.
 */
export const EVIDENCE_TYPES = [
  // Interest / qualification
  "buyer_reply_email",
  "buyer_inbound_form",
  "manual_qualification_note",
  // Sample
  "sample_request_email",
  "sample_dispatch_approval",
  "shipment_label",
  "shipment_tracking",
  "shipment_delivery_confirmation",
  // Vendor onboarding
  "vendor_setup_request",
  "w9_request",
  "ap_packet_request",
  // Quote
  "quote_email_sent",
  "quote_pdf_sent",
  "line_sheet_sent",
  "qbo_invoice_draft",
  // PO / order
  "po_document",
  "buyer_order_email",
  "shopify_order",
  "amazon_order",
  "faire_order",
  "accepted_order_form",
  // Invoice
  "qbo_invoice_sent",
  "stripe_invoice_sent",
  "shopify_invoice_sent",
  "email_invoice_sent",
  // Payment
  "qbo_payment_record",
  "stripe_payment_record",
  "shopify_payment_record",
  "amazon_settlement",
  "bank_payment_record",
  "explicit_paid_invoice_status",
  // Shipment (post-order)
  "shipstation_shipment",
  "pirateship_shipment",
  "shopify_fulfillment",
  "tracking_number",
  // Reorder
  "reorder_due_calculation",
  "second_po_document",
  "second_buyer_order_email",
  "second_payment_record",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-stage evidence requirements
// ---------------------------------------------------------------------------

/**
 * For a deal to be promoted into a stage, AT LEAST ONE of the listed
 * evidence types must exist (within the relevance window — typically
 * the same deal lifetime, no expiry on the requirement).
 *
 * The verifier enforces this rule: if HubSpot claims `po_received`
 * but the deal has zero matching evidence, the verifier downgrades
 * the verified stage and flags `needs_review`.
 */
export const EVIDENCE_TYPES_BY_STAGE: Record<
  PipelineStage,
  ReadonlyArray<EvidenceType>
> = {
  interested: [
    "buyer_reply_email",
    "buyer_inbound_form",
    "manual_qualification_note",
  ],
  sample_requested: [
    "sample_request_email",
    "sample_dispatch_approval",
  ],
  sample_shipped: [
    "shipment_label",
    "shipment_tracking",
  ],
  sample_delivered: ["shipment_delivery_confirmation"],
  vendor_setup: [
    "vendor_setup_request",
    "w9_request",
    "ap_packet_request",
  ],
  quote_sent: [
    "quote_email_sent",
    "quote_pdf_sent",
    "line_sheet_sent",
    "qbo_invoice_draft",
  ],
  po_received: [
    "po_document",
    "buyer_order_email",
    "shopify_order",
    "amazon_order",
    "faire_order",
    "accepted_order_form",
  ],
  invoice_sent: [
    "qbo_invoice_sent",
    "stripe_invoice_sent",
    "shopify_invoice_sent",
    "email_invoice_sent",
  ],
  paid: [
    "qbo_payment_record",
    "stripe_payment_record",
    "shopify_payment_record",
    "amazon_settlement",
    "bank_payment_record",
    "explicit_paid_invoice_status",
  ],
  shipped: [
    "shipstation_shipment",
    "pirateship_shipment",
    "shopify_fulfillment",
    "tracking_number",
  ],
  reorder_due: ["reorder_due_calculation"],
  reordered: [
    "second_po_document",
    "second_buyer_order_email",
    "second_payment_record",
  ],
};

// ---------------------------------------------------------------------------
// Verification statuses
// ---------------------------------------------------------------------------

export const VERIFICATION_STATUSES = [
  "unverified",
  "system_verified",
  "human_verified",
  "needs_review",
  "conflicting_evidence",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Evidence + transition shapes
// ---------------------------------------------------------------------------

export interface PipelineEvidence {
  /** Stable id (uuid / nanoid) — locked once persisted. */
  id: string;
  /** HubSpot deal id this evidence belongs to. */
  dealId: string;
  /** The stage this evidence supports. */
  stage: PipelineStage;
  /** Granular evidence type. */
  evidenceType: EvidenceType;
  /** Source system — e.g. "gmail", "qbo", "shopify", "shipstation", "manual". */
  source: string;
  /** Stable id / URL / message id / document id within the source. */
  sourceId: string;
  /** Optional click-through URL. */
  url?: string;
  /** ISO timestamp of the evidence (NOT when we recorded it). */
  evidenceAt: string;
  /** Who/what recorded this — agent id, operator email, or "manual". */
  actor: string;
  /** 0..1 confidence the operator/agent assigns. */
  confidence: number;
  /** Optional free-form note. */
  note?: string;
  /** ISO timestamp when this evidence was persisted. */
  recordedAt: string;
}

export interface PipelineTransition {
  /** ISO. */
  at: string;
  /** Previous verified stage (null on first record). */
  fromStage: PipelineStage | null;
  /** New verified stage. */
  toStage: PipelineStage;
  /** Verification status produced by the validator. */
  verification: VerificationStatus;
  /** Evidence ids that backed this transition. */
  evidenceIds: ReadonlyArray<string>;
  /** Free-form reason — why the stage moved. */
  reason: string;
  /** Actor who triggered the change. */
  actor: string;
}

// ---------------------------------------------------------------------------
// Verified state — what the validator returns
// ---------------------------------------------------------------------------

export interface VerifiedState {
  dealId: string;
  /** Highest stage with at least one supporting evidence row. */
  verifiedStage: PipelineStage | null;
  verification: VerificationStatus;
  /**
   * Stages the validator believes are supported (subset of
   * PIPELINE_STAGES). Used by the drift surface to show the gap
   * between HubSpot's claim and the evidence trail.
   */
  supportedStages: PipelineStage[];
  /**
   * Stages that are claimed but missing evidence. Always empty when
   * `verification === "system_verified"`.
   */
  missingEvidenceForStages: PipelineStage[];
  /**
   * KPI fields per the doctrine — every stage transition records its
   * own timestamp here. `dateEnteredStage` is the most recent
   * `at` of the transition into the current verified stage.
   */
  dateEnteredStage: string | null;
  dateVerifiedStage: string | null;
  /** Pure roll-up of `recordedAt - evidenceAt` to surface latency. */
  ageOfMostRecentEvidenceMs: number | null;
  /** All transitions for the deal, oldest first. */
  transitions: ReadonlyArray<PipelineTransition>;
  /** Conversion timestamps for KPI reporting. */
  conversionTimestamps: Partial<Record<PipelineStage, string>>;
  /** Free-form blocker text when verification != system_verified. */
  blocker: string | null;
  /** Revenue status surfaced for daily-card consumption. */
  revenueStatus: RevenueStatus;
}

export type RevenueStatus =
  | "none"
  | "quoted"
  | "ordered"
  | "invoiced"
  | "paid"
  | "shipped"
  | "reordered";

/**
 * Map from verified stage → revenue status. Aligns with the
 * blueprint's KPI fields and is single-source for the daily cards.
 */
export const STAGE_TO_REVENUE_STATUS: Record<PipelineStage, RevenueStatus> = {
  interested: "none",
  sample_requested: "none",
  sample_shipped: "none",
  sample_delivered: "none",
  vendor_setup: "none",
  quote_sent: "quoted",
  po_received: "ordered",
  invoice_sent: "invoiced",
  paid: "paid",
  shipped: "shipped",
  reorder_due: "shipped",
  reordered: "reordered",
};

// ---------------------------------------------------------------------------
// Convenience invariants exported for tests
// ---------------------------------------------------------------------------

/**
 * Returns true iff every stage has at least one evidence type
 * configured. Used by tests + a startup self-check.
 */
export function everyStageHasEvidenceTypes(): boolean {
  for (const s of PIPELINE_STAGES) {
    if ((EVIDENCE_TYPES_BY_STAGE[s] ?? []).length === 0) return false;
  }
  return true;
}

/**
 * Returns true iff `EVIDENCE_TYPES_BY_STAGE` only references types in
 * the canonical EVIDENCE_TYPES list. Catches typos at test time.
 */
export function evidenceTypesByStageAreCanonical(): boolean {
  const valid = new Set<string>(EVIDENCE_TYPES);
  for (const s of PIPELINE_STAGES) {
    for (const t of EVIDENCE_TYPES_BY_STAGE[s] ?? []) {
      if (!valid.has(t)) return false;
    }
  }
  return true;
}
