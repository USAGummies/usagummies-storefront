/**
 * Phase 37.5 — Strategic Framework analyzer tests.
 *
 * Coverage targets per /contracts/email-agents-system.md §2.5b:
 *   - All 8 StrategicFrame fields populated by buildStrategicFrame.
 *   - Whale-class records always produce relationship="whale" + goal="hold"
 *     regardless of category default (defense-in-depth).
 *   - Tier scaling on opportunity for T0/T1/T2/T3.
 *   - Cashflow signal elevates Class-C requirement when speed=today/this_week
 *     AND opportunity.highUsd >= $10K.
 *   - Universal dontShare floor included on every frame.
 *   - Distributor vertical → relationship="distributor".
 *   - HubSpot lifecycle → cold/warm/established mapping.
 *   - Per-category defaults: A (sample) → goal=qualify; D (pricing) →
 *     goal=hold + requiresClassC=true; S (whale) → goal=hold +
 *     escalationClauseRequired=true; C (polite no) → goal=deflect.
 *   - validateStrategicFrame: ok when all 8 populated; rejects on null /
 *     missing premise / empty risks / missing financial / empty dontShare
 *     / empty play.
 *   - renderStrategicFrameForCard: includes every section title.
 */
import { describe, expect, it } from "vitest";

import {
  buildStrategicFrame,
  renderStrategicFrameForCard,
  validateStrategicFrame,
  type StrategicFrame,
} from "../strategic-frame";
import type { ClassifiedRecord, EmailCategoryV1 } from "../classifier";
import type { VerificationMetadata } from "../hubspot-verification";
import type { ScanStatus } from "../inbox-scanner";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function rec(
  category: EmailCategoryV1 = "A_sample_request",
  partial: Partial<ClassifiedRecord> = {},
): ClassifiedRecord {
  return {
    messageId: "msg-1",
    threadId: "thr-1",
    fromEmail: "buyer@christmasmouse.com",
    fromHeader: "Buyer <buyer@christmasmouse.com>",
    subject: "Sample request",
    date: "Fri, 24 Apr 2026 12:00:00 -0700",
    snippet: "",
    labelIds: ["INBOX"],
    status: "classified" as ScanStatus,
    noiseReason: "",
    observedAt: "2026-04-30T20:00:00.000Z",
    category,
    confidence: 0.88,
    ruleId: "legacy:sample-request",
    classificationReason: "Sample request keywords",
    classifiedAt: "2026-04-30T20:01:00.000Z",
    ...partial,
  };
}

function verification(
  partial: Partial<VerificationMetadata> = {},
): VerificationMetadata {
  return {
    status: "verified",
    reason: "ok",
    hardBlock: false,
    contact: null,
    whaleDomainMatch: "",
    verifiedAt: "2026-04-30T20:02:00.000Z",
    notes: [],
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// buildStrategicFrame — happy paths
// ---------------------------------------------------------------------------

describe("buildStrategicFrame / sample request (A)", () => {
  it("populates all 8 fields with category defaults", () => {
    const frame = buildStrategicFrame({ record: rec("A_sample_request") });
    expect(frame.premise).toContain("buyer@christmasmouse.com");
    expect(frame.relationship).toBe("cold"); // no HubSpot context
    expect(frame.goal).toBe("qualify");
    expect(frame.risks.length).toBeGreaterThan(0);
    expect(frame.opportunity.lowUsd).toBeGreaterThan(0);
    expect(frame.financialFrame.marginBand).toContain("B-tier");
    expect(frame.dontShare.length).toBeGreaterThan(0);
    expect(frame.play).toContain("Ship sample");
    const v = validateStrategicFrame(frame);
    expect(v.ok).toBe(true);
  });

  it("scales opportunity for T0 (whale tier × 50)", () => {
    const base = buildStrategicFrame({ record: rec("A_sample_request") });
    const t0 = buildStrategicFrame({
      record: rec("A_sample_request"),
      prospect: { tier: "T0" },
    });
    expect(t0.opportunity.highUsd).toBe(base.opportunity.highUsd * 50);
    expect(t0.opportunity.rationale).toContain("×50 for tier T0");
  });

  it("scales opportunity for T2 (regional × 3)", () => {
    const base = buildStrategicFrame({ record: rec("A_sample_request") });
    const t2 = buildStrategicFrame({
      record: rec("A_sample_request"),
      prospect: { tier: "T2" },
    });
    expect(t2.opportunity.highUsd).toBe(base.opportunity.highUsd * 3);
  });
});

describe("buildStrategicFrame / pricing pushback (D)", () => {
  it("goal=hold, requiresClassC=true, escalationClauseRequired=true", () => {
    const frame = buildStrategicFrame({ record: rec("D_pricing_pushback") });
    expect(frame.goal).toBe("hold");
    expect(frame.financialFrame.requiresClassC).toBe(true);
    expect(frame.financialFrame.escalationClauseRequired).toBe(true);
    expect(frame.dontShare.some((d) => /distributor/i.test(d))).toBe(true);
  });
});

describe("buildStrategicFrame / polite no (C)", () => {
  it("goal=deflect, opportunity zeroed", () => {
    const frame = buildStrategicFrame({ record: rec("C_polite_no") });
    expect(frame.goal).toBe("deflect");
    expect(frame.opportunity.highUsd).toBe(0);
    expect(frame.play).toContain("Mark contact UNQUALIFIED");
  });
});

describe("buildStrategicFrame / whale (S)", () => {
  it("relationship=whale, goal=hold, requiresClassC=true regardless of inputs", () => {
    const frame = buildStrategicFrame({
      record: rec("S_whale_class", {
        fromEmail: "charmaine@buc-ees.com",
      }),
    });
    expect(frame.relationship).toBe("whale");
    expect(frame.goal).toBe("hold");
    expect(frame.financialFrame.requiresClassC).toBe(true);
    expect(frame.financialFrame.escalationClauseRequired).toBe(true);
    expect(
      frame.dontShare.some((d) => /whale-class lock/i.test(d)),
    ).toBe(true);
  });

  it("verification whale-domain match overrides classifier (defense-in-depth)", () => {
    // Even if classifier somehow missed the whale, verification's
    // whaleDomainMatch should still elevate the frame.
    const frame = buildStrategicFrame({
      record: rec("B_qualifying_question"),
      verification: verification({
        whaleDomainMatch: "buc-ees.com",
        hardBlock: true,
      }),
    });
    expect(frame.relationship).toBe("whale");
    expect(frame.goal).toBe("hold");
  });
});

describe("buildStrategicFrame / relationship lookup", () => {
  it("HubSpot lifecycle=customer → established", () => {
    const frame = buildStrategicFrame({
      record: rec("B_qualifying_question"),
      verification: verification({
        contact: {
          contactId: "c-1",
          email: "buyer@store.com",
          firstname: "Buyer",
          lastname: "Person",
          fullName: "Buyer Person",
          company: "Store",
          jobtitle: "Buyer",
          lifecycleStage: "customer",
          leadStatus: "OPEN",
          usaVertical: "souvenir_destination",
          usaTier: "T2",
          usaCadenceState: "closed_won",
          hubspotGateComplete: true,
        },
      }),
    });
    expect(frame.relationship).toBe("established");
  });

  it("HubSpot lifecycle=opportunity → warm", () => {
    const frame = buildStrategicFrame({
      record: rec("B_qualifying_question"),
      verification: verification({
        contact: {
          contactId: "c-1",
          email: "buyer@store.com",
          firstname: "",
          lastname: "",
          fullName: "",
          company: "",
          jobtitle: "",
          lifecycleStage: "opportunity",
          leadStatus: "",
          usaVertical: "",
          usaTier: "",
          usaCadenceState: "",
          hubspotGateComplete: false,
        },
      }),
    });
    expect(frame.relationship).toBe("warm");
  });

  it("distributor vertical → relationship=distributor", () => {
    const frame = buildStrategicFrame({
      record: rec("B_qualifying_question"),
      prospect: { vertical: "distributor_regional" },
    });
    expect(frame.relationship).toBe("distributor");
  });

  it("contact present without lifecycle signal → warm fallback", () => {
    const frame = buildStrategicFrame({
      record: rec("B_qualifying_question"),
      verification: verification({
        contact: {
          contactId: "c-1",
          email: "buyer@store.com",
          firstname: "",
          lastname: "",
          fullName: "",
          company: "",
          jobtitle: "",
          lifecycleStage: "",
          leadStatus: "OPEN",
          usaVertical: "",
          usaTier: "",
          usaCadenceState: "",
          hubspotGateComplete: false,
        },
      }),
    });
    expect(frame.relationship).toBe("warm");
  });

  it("no HubSpot context → cold", () => {
    const frame = buildStrategicFrame({ record: rec("B_qualifying_question") });
    expect(frame.relationship).toBe("cold");
  });
});

describe("buildStrategicFrame / cashflow elevation", () => {
  it("cashSpeed=today + opportunity >= $10K → requiresClassC=true", () => {
    const frame = buildStrategicFrame({
      record: rec("B_qualifying_question"),
      prospect: { tier: "T1" }, // T1 × 10 → $20,000 high
      cashflow: { cashSpeed: "today" },
    });
    expect(frame.opportunity.highUsd).toBeGreaterThanOrEqual(10_000);
    expect(frame.financialFrame.requiresClassC).toBe(true);
  });

  it("cashSpeed=this_week + opportunity >= $10K → requiresClassC=true", () => {
    const frame = buildStrategicFrame({
      record: rec("B_qualifying_question"),
      prospect: { tier: "T1" },
      cashflow: { cashSpeed: "this_week" },
    });
    expect(frame.financialFrame.requiresClassC).toBe(true);
  });

  it("cashSpeed=strategic does NOT elevate requiresClassC", () => {
    const frame = buildStrategicFrame({
      record: rec("B_qualifying_question"),
      prospect: { tier: "T1" },
      cashflow: { cashSpeed: "strategic" },
    });
    // Category default for B is requiresClassC=false; strategic shouldn't flip it.
    expect(frame.financialFrame.requiresClassC).toBe(false);
  });

  it("cashSpeed=today but small opportunity → no elevation", () => {
    const frame = buildStrategicFrame({
      record: rec("B_qualifying_question"),
      prospect: { tier: "T3" }, // small
      cashflow: { cashSpeed: "today" },
    });
    expect(frame.financialFrame.requiresClassC).toBe(false);
  });
});

describe("buildStrategicFrame / dontShare composition", () => {
  it("includes the universal floor on every frame", () => {
    const frame = buildStrategicFrame({ record: rec("A_sample_request") });
    expect(
      frame.dontShare.some((d) => d.includes("route doctrine")),
    ).toBe(true);
    expect(frame.dontShare.some((d) => d.includes("COGS"))).toBe(true);
    expect(frame.dontShare.some((d) => d.includes("Ashford"))).toBe(true);
    expect(
      frame.dontShare.some((d) => d.includes("regulatory tailwind")),
    ).toBe(true);
  });

  it("T0/T1 prospect adds competitor + delivered-pricing guard", () => {
    const t0 = buildStrategicFrame({
      record: rec("A_sample_request"),
      prospect: { tier: "T0" },
    });
    expect(
      t0.dontShare.some((d) => /competitor account/i.test(d)),
    ).toBe(true);
    const t1 = buildStrategicFrame({
      record: rec("A_sample_request"),
      prospect: { tier: "T1" },
    });
    expect(
      t1.dontShare.some((d) => /competitor account/i.test(d)),
    ).toBe(true);
    const t2 = buildStrategicFrame({
      record: rec("A_sample_request"),
      prospect: { tier: "T2" },
    });
    expect(
      t2.dontShare.some((d) => /competitor account/i.test(d)),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateStrategicFrame
// ---------------------------------------------------------------------------

describe("validateStrategicFrame", () => {
  it("ok when frame is fully populated", () => {
    const frame = buildStrategicFrame({ record: rec("A_sample_request") });
    const v = validateStrategicFrame(frame);
    expect(v.ok).toBe(true);
    expect(v.missingFields).toHaveLength(0);
  });

  it("rejects null", () => {
    const v = validateStrategicFrame(null);
    expect(v.ok).toBe(false);
    expect(v.missingFields).toContain("premise");
    expect(v.reason).toContain("null/undefined");
  });

  it("rejects empty premise", () => {
    const frame = buildStrategicFrame({ record: rec("A_sample_request") });
    const broken: StrategicFrame = { ...frame, premise: "" };
    const v = validateStrategicFrame(broken);
    expect(v.ok).toBe(false);
    expect(v.missingFields).toContain("premise");
  });

  it("rejects empty risks array", () => {
    const frame = buildStrategicFrame({ record: rec("A_sample_request") });
    const broken: StrategicFrame = { ...frame, risks: [] };
    const v = validateStrategicFrame(broken);
    expect(v.ok).toBe(false);
    expect(v.missingFields).toContain("risks");
  });

  it("rejects empty dontShare array", () => {
    const frame = buildStrategicFrame({ record: rec("A_sample_request") });
    const broken: StrategicFrame = { ...frame, dontShare: [] };
    const v = validateStrategicFrame(broken);
    expect(v.ok).toBe(false);
    expect(v.missingFields).toContain("dontShare");
  });

  it("rejects empty play", () => {
    const frame = buildStrategicFrame({ record: rec("A_sample_request") });
    const broken: StrategicFrame = { ...frame, play: "" };
    const v = validateStrategicFrame(broken);
    expect(v.ok).toBe(false);
    expect(v.missingFields).toContain("play");
  });

  it("rejects opportunity missing rationale", () => {
    const frame = buildStrategicFrame({ record: rec("A_sample_request") });
    const broken: StrategicFrame = {
      ...frame,
      opportunity: { ...frame.opportunity, rationale: "" },
    };
    const v = validateStrategicFrame(broken);
    expect(v.ok).toBe(false);
    expect(v.missingFields).toContain("opportunity");
  });

  it("rejects financialFrame with empty marginBand", () => {
    const frame = buildStrategicFrame({ record: rec("A_sample_request") });
    const broken: StrategicFrame = {
      ...frame,
      financialFrame: { ...frame.financialFrame, marginBand: "" },
    };
    const v = validateStrategicFrame(broken);
    expect(v.ok).toBe(false);
    expect(v.missingFields).toContain("financialFrame");
  });
});

// ---------------------------------------------------------------------------
// renderStrategicFrameForCard
// ---------------------------------------------------------------------------

describe("renderStrategicFrameForCard", () => {
  it("includes every section title in the rendered output", () => {
    const frame = buildStrategicFrame({
      record: rec("D_pricing_pushback", {
        fromEmail: "charmaine@buc-ees.com",
        fromHeader: "Charmaine <charmaine@buc-ees.com>",
      }),
      prospect: { tier: "T0" },
    });
    const card = renderStrategicFrameForCard(frame);
    expect(card).toContain("STRATEGIC FRAMEWORK");
    expect(card).toContain("Premise:");
    expect(card).toContain("Relationship:");
    expect(card).toContain("Opportunity:");
    expect(card).toContain("Goal:");
    expect(card).toContain("Risks:");
    expect(card).toContain("Financial frame:");
    expect(card).toContain("Don't-share:");
    expect(card).toContain("Play:");
  });

  it("highlights requiresClassC + escalation flag in the financial-frame line", () => {
    const frame = buildStrategicFrame({ record: rec("D_pricing_pushback") });
    const card = renderStrategicFrameForCard(frame);
    expect(card).toContain("requires Class C");
    expect(card).toContain("escalation clause required");
  });
});

// ---------------------------------------------------------------------------
// Sanity — every category has a default playbook
// ---------------------------------------------------------------------------

describe("strategic-frame / coverage", () => {
  const sampleCategories: EmailCategoryV1[] = [
    "A_sample_request",
    "B_qualifying_question",
    "C_polite_no",
    "D_pricing_pushback",
    "E_vendor_portal_step",
    "F_thread_continuity_issue",
    "G_status_check_urgency",
    "H_ap_vendor_setup",
    "I_ooo_with_return_date",
    "J_ooo_with_alternate_contact",
    "N_hard_bounce",
    "S_whale_class",
    "T_executive_inbound",
    "U_legal_language",
    "V_volume_commitment",
    "W_vendor_invoice_inbound",
    "X_receipt_cc_ach",
    "Y_customer_payment_inbound",
    "Z_obvious_spam",
  ];

  it.each(sampleCategories)(
    "category %s yields a valid frame",
    (cat) => {
      const frame = buildStrategicFrame({ record: rec(cat) });
      const v = validateStrategicFrame(frame);
      expect(v.ok).toBe(true);
    },
  );

  it("unmapped category falls back gracefully (still valid)", () => {
    const frame = buildStrategicFrame({ record: rec("_unclassified") });
    const v = validateStrategicFrame(frame);
    expect(v.ok).toBe(true);
    expect(frame.goal).toBe("info-gather");
  });
});
