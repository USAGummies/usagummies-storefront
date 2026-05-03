/**
 * Pipeline Evidence Recorders — thin one-call helpers for in-process callers.
 *
 * Pattern: existing routes/closers (sample-dispatch, auto-ship, QBO
 * payment ingest, Shopify webhook, Gmail intake) call `recordX(...)`
 * with their canonical fields and the helper:
 *   1. Skips silently when `dealId` is missing (not every shipment is
 *      tied to a HubSpot deal).
 *   2. Picks the correct `stage` + `evidenceType` for the source.
 *   3. Calls `appendPipelineEvidence` fail-soft — recorder errors
 *      NEVER fail the caller's business operation.
 *   4. Returns `{ recorded: true, evidenceId }` or `{ recorded: false,
 *      reason }` so the caller can surface the result in its audit
 *      trail.
 *
 * No new I/O paths — every recorder is a thin shim over the canonical
 * `appendPipelineEvidence` boundary.
 *
 * Hard rules:
 *   - Helpers are best-effort. A recorder failure NEVER throws.
 *   - Stages are inferred deterministically from the recorder name
 *     (e.g. `recordShipmentEvidence` always writes to `shipped` or
 *     `sample_shipped` — never to a stage outside the shipping family).
 *   - The caller decides whether the shipment is a sample or a real
 *     order via the `kind` arg.
 */
import type { EvidenceType, PipelineStage } from "./pipeline-evidence";
import {
  appendPipelineEvidence,
  type KvLikePipelineStore,
} from "./pipeline-evidence-store";

export interface RecorderResult {
  recorded: boolean;
  evidenceId?: string;
  reason?: string;
}

interface BaseRecorderArgs {
  /** HubSpot deal id; when missing the recorder no-ops cleanly. */
  dealId?: string | null;
  /** Source system (e.g. `shipstation`, `qbo`, `shopify`, `gmail`). */
  source: string;
  /** Stable id within the source (order number, transaction id, etc.). */
  sourceId: string;
  /** Optional click-through URL. */
  url?: string;
  /** When the evidence event happened — ISO. */
  evidenceAt: string;
  /** Who recorded it (agent id / human:* / route name). */
  actor: string;
  /** 0..1 confidence — rolled up from the source. */
  confidence?: number;
  /** Optional free-form note. */
  note?: string;
  /** Override KV store for tests. */
  store?: KvLikePipelineStore;
}

// ---------------------------------------------------------------------------
// Shipment family — sample_shipped vs shipped
// ---------------------------------------------------------------------------

export interface RecordShipmentArgs extends BaseRecorderArgs {
  /** Differentiates `sample_shipped` (sample) vs `shipped` (paid order). */
  kind: "sample" | "order";
  /** Which evidence type the source maps to. */
  evidenceType:
    | "shipment_label"
    | "shipment_tracking"
    | "shipstation_shipment"
    | "pirateship_shipment"
    | "shopify_fulfillment"
    | "tracking_number";
}

export async function recordShipmentEvidence(
  args: RecordShipmentArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  // Sample-shipped accepts only the two label/tracking types.
  // Shipped accepts the full shipment family.
  const stage: PipelineStage =
    args.kind === "sample" ? "sample_shipped" : "shipped";
  if (
    stage === "sample_shipped" &&
    args.evidenceType !== "shipment_label" &&
    args.evidenceType !== "shipment_tracking"
  ) {
    return skip(
      `evidenceType ${args.evidenceType} not valid for sample_shipped — use shipment_label or shipment_tracking`,
    );
  }
  return safeAppend({
    dealId: args.dealId,
    stage,
    evidenceType: args.evidenceType,
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Delivery confirmation — sample_delivered
// ---------------------------------------------------------------------------

export async function recordSampleDeliveredEvidence(
  args: BaseRecorderArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  return safeAppend({
    dealId: args.dealId,
    stage: "sample_delivered",
    evidenceType: "shipment_delivery_confirmation",
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Payment family — paid
// ---------------------------------------------------------------------------

export interface RecordPaymentArgs extends BaseRecorderArgs {
  evidenceType:
    | "qbo_payment_record"
    | "stripe_payment_record"
    | "shopify_payment_record"
    | "amazon_settlement"
    | "bank_payment_record"
    | "explicit_paid_invoice_status";
}

export async function recordPaymentEvidence(
  args: RecordPaymentArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  return safeAppend({
    dealId: args.dealId,
    stage: "paid",
    evidenceType: args.evidenceType,
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Order family — po_received
// ---------------------------------------------------------------------------

export interface RecordOrderArgs extends BaseRecorderArgs {
  evidenceType:
    | "po_document"
    | "buyer_order_email"
    | "shopify_order"
    | "amazon_order"
    | "faire_order"
    | "accepted_order_form";
}

export async function recordOrderEvidence(
  args: RecordOrderArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  return safeAppend({
    dealId: args.dealId,
    stage: "po_received",
    evidenceType: args.evidenceType,
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Invoice family — invoice_sent
// ---------------------------------------------------------------------------

export interface RecordInvoiceArgs extends BaseRecorderArgs {
  evidenceType:
    | "qbo_invoice_sent"
    | "stripe_invoice_sent"
    | "shopify_invoice_sent"
    | "email_invoice_sent";
}

export async function recordInvoiceEvidence(
  args: RecordInvoiceArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  return safeAppend({
    dealId: args.dealId,
    stage: "invoice_sent",
    evidenceType: args.evidenceType,
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Quote family — quote_sent
// ---------------------------------------------------------------------------

export interface RecordQuoteArgs extends BaseRecorderArgs {
  evidenceType:
    | "quote_email_sent"
    | "quote_pdf_sent"
    | "line_sheet_sent"
    | "qbo_invoice_draft";
}

export async function recordQuoteEvidence(
  args: RecordQuoteArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  return safeAppend({
    dealId: args.dealId,
    stage: "quote_sent",
    evidenceType: args.evidenceType,
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Sample request — sample_requested
// ---------------------------------------------------------------------------

export interface RecordSampleRequestArgs extends BaseRecorderArgs {
  evidenceType: "sample_request_email" | "sample_dispatch_approval";
}

export async function recordSampleRequestEvidence(
  args: RecordSampleRequestArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  return safeAppend({
    dealId: args.dealId,
    stage: "sample_requested",
    evidenceType: args.evidenceType,
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Vendor setup — vendor_setup
// ---------------------------------------------------------------------------

export interface RecordVendorSetupArgs extends BaseRecorderArgs {
  evidenceType: "vendor_setup_request" | "w9_request" | "ap_packet_request";
}

export async function recordVendorSetupEvidence(
  args: RecordVendorSetupArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  return safeAppend({
    dealId: args.dealId,
    stage: "vendor_setup",
    evidenceType: args.evidenceType,
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Interest — interested
// ---------------------------------------------------------------------------

export interface RecordInterestArgs extends BaseRecorderArgs {
  evidenceType:
    | "buyer_reply_email"
    | "buyer_inbound_form"
    | "manual_qualification_note";
}

export async function recordInterestEvidence(
  args: RecordInterestArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  return safeAppend({
    dealId: args.dealId,
    stage: "interested",
    evidenceType: args.evidenceType,
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Reorder — reordered
// ---------------------------------------------------------------------------

export interface RecordReorderArgs extends BaseRecorderArgs {
  evidenceType:
    | "second_po_document"
    | "second_buyer_order_email"
    | "second_payment_record";
}

export async function recordReorderEvidence(
  args: RecordReorderArgs,
): Promise<RecorderResult> {
  if (!args.dealId) return skip("missing dealId");
  return safeAppend({
    dealId: args.dealId,
    stage: "reordered",
    evidenceType: args.evidenceType,
    base: args,
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function skip(reason: string): RecorderResult {
  return { recorded: false, reason };
}

async function safeAppend(args: {
  dealId: string;
  stage: PipelineStage;
  evidenceType: EvidenceType;
  base: BaseRecorderArgs;
}): Promise<RecorderResult> {
  try {
    const row = await appendPipelineEvidence(
      {
        dealId: args.dealId,
        stage: args.stage,
        evidenceType: args.evidenceType,
        source: args.base.source,
        sourceId: args.base.sourceId,
        url: args.base.url,
        evidenceAt: args.base.evidenceAt,
        actor: args.base.actor,
        confidence: args.base.confidence ?? 0.95,
        note: args.base.note,
      },
      { store: args.base.store },
    );
    return { recorded: true, evidenceId: row.id };
  } catch (err) {
    return {
      recorded: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
