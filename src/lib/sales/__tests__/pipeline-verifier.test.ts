/**
 * Pipeline verifier coverage.
 *
 * Pins:
 *   - empty evidence → unverified, no verifiedStage, revenueStatus=none
 *   - evidence row with mismatched type for stage → ignored
 *   - verifiedStage = highest stage with at least one matching row
 *   - HubSpot claim ahead of evidence → needs_review + missingEvidenceForStages
 *   - HubSpot claim equals verified → system_verified (or human_verified
 *     if any evidence row carries a human actor)
 *   - 2+ authoritative evidence rows of same type for same stage with
 *     different sourceIds → conflicting_evidence
 *   - conversion timestamps capture earliest evidenceAt per stage
 *   - revenueStatus maps from verified stage
 *   - drift detection: hubspot > verified → drift envelope
 *   - drift detection: hubspot ≤ verified → null
 *   - drift detection: missingEvidenceForStages enumerated correctly
 */
import { describe, expect, it } from "vitest";

import {
  detectPipelineDrift,
  verifyPipelineState,
} from "../pipeline-verifier";
import type {
  PipelineEvidence,
  PipelineStage,
} from "../pipeline-evidence";

let id = 1;
function ev(overrides: Partial<PipelineEvidence>): PipelineEvidence {
  const evRow: PipelineEvidence = {
    id: `ev-${id++}`,
    dealId: "deal-1",
    stage: "interested",
    evidenceType: "buyer_reply_email",
    source: "gmail",
    sourceId: "gmail-msg-1",
    evidenceAt: "2026-05-02T10:00:00.000Z",
    actor: "agent:viktor",
    confidence: 0.9,
    recordedAt: "2026-05-02T10:00:01.000Z",
    ...overrides,
  };
  return evRow;
}

beforeEachReset();
function beforeEachReset() {
  id = 1;
}

describe("verifyPipelineState — empty / mismatch", () => {
  it("returns unverified + null verifiedStage when no evidence + no claim", () => {
    const r = verifyPipelineState({ dealId: "d-1", evidence: [] });
    expect(r.verifiedStage).toBeNull();
    expect(r.verification).toBe("unverified");
    expect(r.supportedStages).toEqual([]);
    expect(r.revenueStatus).toBe("none");
  });

  it("ignores evidence rows whose evidenceType doesn't match the stage's allowlist", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({
          stage: "paid",
          evidenceType: "quote_email_sent", // wrong — not a payment
        }),
      ],
    });
    expect(r.verifiedStage).toBeNull();
    expect(r.supportedStages).toEqual([]);
  });
});

describe("verifyPipelineState — verified stage", () => {
  it("picks the highest supported stage", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({ stage: "interested", evidenceType: "buyer_reply_email" }),
        ev({ stage: "sample_shipped", evidenceType: "shipment_label" }),
        ev({ stage: "sample_delivered", evidenceType: "shipment_delivery_confirmation" }),
      ],
    });
    expect(r.verifiedStage).toBe("sample_delivered");
    expect(r.verification).toBe("system_verified");
  });

  it("system_verified when claimed stage equals verified stage", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({
          stage: "po_received",
          evidenceType: "po_document",
        }),
      ],
      claimedStage: "po_received",
    });
    expect(r.verification).toBe("system_verified");
    expect(r.missingEvidenceForStages).toEqual([]);
  });

  it("human_verified when an evidence row carries a human actor", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({
          stage: "interested",
          evidenceType: "manual_qualification_note",
          actor: "human:ben",
        }),
      ],
      claimedStage: "interested",
    });
    expect(r.verification).toBe("human_verified");
  });
});

describe("verifyPipelineState — needs_review (drift)", () => {
  it("hubspot ahead → needs_review + lists missing stages", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({
          stage: "quote_sent",
          evidenceType: "quote_email_sent",
        }),
      ],
      claimedStage: "po_received",
    });
    expect(r.verifiedStage).toBe("quote_sent");
    expect(r.verification).toBe("needs_review");
    expect(r.missingEvidenceForStages).toEqual(["po_received"]);
    expect(r.blocker).toMatch(/Missing evidence/);
  });

  it("hubspot says shipped but no tracking → needs_review with blocker", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({
          stage: "paid",
          evidenceType: "qbo_payment_record",
        }),
      ],
      claimedStage: "shipped",
    });
    expect(r.verifiedStage).toBe("paid");
    expect(r.verification).toBe("needs_review");
    expect(r.missingEvidenceForStages).toEqual(["shipped"]);
  });

  it("hubspot says paid with zero evidence → needs_review with the full chain missing", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [],
      claimedStage: "paid",
    });
    expect(r.verifiedStage).toBeNull();
    expect(r.verification).toBe("needs_review");
    expect(r.missingEvidenceForStages.length).toBeGreaterThan(0);
    expect(r.missingEvidenceForStages).toContain("paid");
  });
});

describe("verifyPipelineState — conflicting_evidence", () => {
  it("two payment records with different sources for the same stage → conflicting_evidence", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({
          stage: "paid",
          evidenceType: "qbo_payment_record",
          source: "qbo",
          sourceId: "qbo-pay-1",
        }),
        ev({
          stage: "paid",
          evidenceType: "qbo_payment_record",
          source: "qbo",
          sourceId: "qbo-pay-2",
        }),
      ],
    });
    expect(r.verification).toBe("conflicting_evidence");
    expect(r.blocker).toMatch(/disagree/);
  });

  it("non-authoritative duplicate evidence (e.g. two buyer reply emails) does NOT flag conflict", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({
          stage: "interested",
          evidenceType: "buyer_reply_email",
          sourceId: "msg-1",
        }),
        ev({
          stage: "interested",
          evidenceType: "buyer_reply_email",
          sourceId: "msg-2",
        }),
      ],
    });
    expect(r.verification).toBe("system_verified");
  });
});

describe("verifyPipelineState — KPI fields", () => {
  it("conversion timestamps capture EARLIEST evidenceAt per stage", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({
          stage: "sample_shipped",
          evidenceType: "shipment_label",
          evidenceAt: "2026-05-01T08:00:00.000Z",
        }),
        ev({
          stage: "sample_shipped",
          evidenceType: "shipment_tracking",
          evidenceAt: "2026-04-30T22:00:00.000Z", // earlier
          sourceId: "tracking-2",
        }),
      ],
    });
    expect(r.conversionTimestamps.sample_shipped).toBe(
      "2026-04-30T22:00:00.000Z",
    );
  });

  it("revenueStatus maps from verified stage", () => {
    const tests: Array<[PipelineStage | null, string]> = [
      [null, "none"],
      ["interested", "none"],
      ["sample_delivered", "none"],
      ["quote_sent", "quoted"],
      ["po_received", "ordered"],
      ["invoice_sent", "invoiced"],
      ["paid", "paid"],
      ["shipped", "shipped"],
      ["reordered", "reordered"],
    ];
    for (const [stage, expected] of tests) {
      const evidence: PipelineEvidence[] = stage
        ? [
            ev({
              stage,
              evidenceType: getValidTypeForStage(stage),
            }),
          ]
        : [];
      const r = verifyPipelineState({ dealId: "d-1", evidence });
      expect(r.revenueStatus, `for stage ${stage}`).toBe(expected);
    }
  });

  it("dateEnteredStage = earliest matching evidenceAt for verifiedStage", () => {
    const r = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({
          stage: "po_received",
          evidenceType: "po_document",
          evidenceAt: "2026-05-01T12:00:00.000Z",
        }),
      ],
    });
    expect(r.dateEnteredStage).toBe("2026-05-01T12:00:00.000Z");
  });
});

describe("detectPipelineDrift", () => {
  it("returns null when hubspot ≤ verified", () => {
    const verified = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({ stage: "po_received", evidenceType: "po_document" }),
      ],
    });
    expect(
      detectPipelineDrift({
        dealId: "d-1",
        hubspotStage: "po_received",
        verifiedState: verified,
      }),
    ).toBeNull();
    expect(
      detectPipelineDrift({
        dealId: "d-1",
        hubspotStage: "interested",
        verifiedState: verified,
      }),
    ).toBeNull();
  });

  it("returns drift envelope when hubspot ahead", () => {
    const verified = verifyPipelineState({
      dealId: "d-1",
      evidence: [
        ev({ stage: "quote_sent", evidenceType: "quote_email_sent" }),
      ],
    });
    const drift = detectPipelineDrift({
      dealId: "d-1",
      hubspotStage: "shipped",
      verifiedState: verified,
    });
    expect(drift).not.toBeNull();
    expect(drift!.driftSteps).toBe(4); // quote_sent (5) → shipped (9) = 4 steps
    expect(drift!.missingEvidenceForStages).toEqual([
      "po_received",
      "invoice_sent",
      "paid",
      "shipped",
    ]);
    expect(drift!.verification).toBe("needs_review");
    expect(drift!.reason).toMatch(/HubSpot says/);
  });

  it("returns drift envelope when verified is null + hubspot non-zero", () => {
    const verified = verifyPipelineState({ dealId: "d-1", evidence: [] });
    const drift = detectPipelineDrift({
      dealId: "d-1",
      hubspotStage: "paid",
      verifiedState: verified,
    });
    expect(drift).not.toBeNull();
    expect(drift!.reason).toMatch(/no evidence supports any stage yet/);
  });
});

// Helper — pick a valid evidence type for each stage. Used by KPI
// roll-up tests so we don't accidentally make stages unsupported.
function getValidTypeForStage(s: PipelineStage): import("../pipeline-evidence").EvidenceType {
  const map: Record<PipelineStage, import("../pipeline-evidence").EvidenceType> = {
    interested: "buyer_reply_email",
    sample_requested: "sample_request_email",
    sample_shipped: "shipment_label",
    sample_delivered: "shipment_delivery_confirmation",
    vendor_setup: "vendor_setup_request",
    quote_sent: "quote_email_sent",
    po_received: "po_document",
    invoice_sent: "qbo_invoice_sent",
    paid: "qbo_payment_record",
    shipped: "tracking_number",
    reorder_due: "reorder_due_calculation",
    reordered: "second_po_document",
  };
  return map[s];
}
