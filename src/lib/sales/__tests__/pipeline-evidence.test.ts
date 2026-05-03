/**
 * Pipeline evidence schema coverage.
 *
 * Pins:
 *   - 12 canonical stages, ordered.
 *   - Every stage has at least one evidence type.
 *   - All EVIDENCE_TYPES_BY_STAGE entries are valid evidence types.
 *   - Stage-to-revenue-status mapping covers every stage.
 *   - PIPELINE_STAGE_LABELS covers every stage.
 *   - HubSpot stage alone is NOT an evidence type (no `hubspot_stage`
 *     entry in EVIDENCE_TYPES).
 */
import { describe, expect, it } from "vitest";

import {
  EVIDENCE_TYPES,
  EVIDENCE_TYPES_BY_STAGE,
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
  STAGE_TO_REVENUE_STATUS,
  VERIFICATION_STATUSES,
  evidenceTypesByStageAreCanonical,
  everyStageHasEvidenceTypes,
  stageIndex,
} from "../pipeline-evidence";

describe("PIPELINE_STAGES", () => {
  it("has the 12 canonical stages in the right order", () => {
    expect(PIPELINE_STAGES).toEqual([
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
    ]);
  });

  it("stageIndex returns the correct ordinal", () => {
    expect(stageIndex("interested")).toBe(0);
    expect(stageIndex("paid")).toBe(8);
    expect(stageIndex("reordered")).toBe(11);
  });

  it("every stage has a human label", () => {
    for (const s of PIPELINE_STAGES) {
      expect(PIPELINE_STAGE_LABELS[s]).toBeTruthy();
    }
  });

  it("every stage has a revenue-status mapping", () => {
    for (const s of PIPELINE_STAGES) {
      expect(STAGE_TO_REVENUE_STATUS[s]).toBeTruthy();
    }
  });
});

describe("EVIDENCE_TYPES_BY_STAGE", () => {
  it("every stage has at least one evidence type", () => {
    expect(everyStageHasEvidenceTypes()).toBe(true);
  });

  it("every entry references a canonical evidence type", () => {
    expect(evidenceTypesByStageAreCanonical()).toBe(true);
  });

  it("HubSpot stage is NOT an evidence type", () => {
    expect(EVIDENCE_TYPES as ReadonlyArray<string>).not.toContain(
      "hubspot_stage",
    );
    expect(EVIDENCE_TYPES as ReadonlyArray<string>).not.toContain(
      "hubspot_pipeline_stage",
    );
  });

  it("paid stage requires a real payment record (not just an invoice)", () => {
    const types = EVIDENCE_TYPES_BY_STAGE.paid;
    expect(types.some((t) => t.includes("payment"))).toBe(true);
    // Invoice-sent types should NOT count as payment evidence
    expect(types.some((t) => t === "qbo_invoice_sent")).toBe(false);
  });

  it("po_received requires a real order doc, not a quote", () => {
    const types = EVIDENCE_TYPES_BY_STAGE.po_received;
    expect(types).toContain("po_document");
    expect(types).not.toContain("quote_email_sent");
    expect(types).not.toContain("quote_pdf_sent");
  });

  it("shipped requires a tracking artifact, not just an invoice", () => {
    const types = EVIDENCE_TYPES_BY_STAGE.shipped;
    expect(types.some((t) => /tracking|shipment|fulfillment/.test(t))).toBe(
      true,
    );
    expect(types).not.toContain("qbo_invoice_sent");
  });
});

describe("VERIFICATION_STATUSES", () => {
  it("contains the 5 doctrinal statuses", () => {
    expect(VERIFICATION_STATUSES).toEqual([
      "unverified",
      "system_verified",
      "human_verified",
      "needs_review",
      "conflicting_evidence",
    ]);
  });
});
