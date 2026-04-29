/**
 * Phase 35.f.7 — chase-email projection tests.
 *
 * Locked contracts:
 *   - buildChaseEmail returns null when prospect missing or contactEmail empty
 *     (NEVER fabricates a recipient — defense-in-depth).
 *   - greetingName uses first token of contactName.
 *   - Subject embeds the company name + "Following up" / "Quick check-in"
 *     based on stallHours threshold (72h).
 *   - Body restate is step-aware: different sentences for `info`,
 *     `pricing-shown`, `order-type`, `payment-path`, `ap-info`,
 *     `shipping-info`, `order-captured`, etc.
 *   - resumeUrl is included in the body when the customer can still pick up.
 *   - Order lines blurb singularizes "1 master carton" vs pluralizes
 *     "3 pallets".
 *   - Multi-line orders show total bags + total USD subtotal.
 *   - Body NEVER includes a sender persona — Rene fills in his own
 *     signature in Gmail when he sends.
 *   - Body offers Rene as the human escalation contact.
 */
import { describe, expect, it } from "vitest";

import { buildChaseEmail, __INTERNAL } from "../chase-email";
import { summarizeOrderLine } from "../pricing-tiers";
import type { OnboardingState } from "../onboarding-flow";

function buildState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    flowId: "wf_chase_001",
    currentStep: "store-type",
    stepsCompleted: ["info"],
    orderLines: [],
    timestamps: {},
    prospect: {
      companyName: "Acme Co",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
    },
    ...overrides,
  };
}

const CTX = { hoursSinceLastTouch: 30, resumeUrl: "https://x.test/wf_001" };

describe("buildChaseEmail — defensive null returns", () => {
  it("returns null when prospect is missing", () => {
    const r = buildChaseEmail(buildState({ prospect: undefined }), CTX);
    expect(r).toBeNull();
  });

  it("returns null when contactEmail is empty", () => {
    const r = buildChaseEmail(
      buildState({
        prospect: {
          companyName: "Acme",
          contactName: "Jane",
          contactEmail: "",
        },
      }),
      CTX,
    );
    expect(r).toBeNull();
  });
});

describe("buildChaseEmail — happy path", () => {
  it("uses first-name greeting", () => {
    const r = buildChaseEmail(
      buildState({
        prospect: {
          companyName: "Acme",
          contactName: "Janet Marie Doe",
          contactEmail: "j@y.com",
        },
      }),
      CTX,
    );
    expect(r?.greetingName).toBe("Janet");
    expect(r?.plainText).toMatch(/^Hi Janet,/);
  });

  it("falls back to full contactName when single token", () => {
    const r = buildChaseEmail(
      buildState({
        prospect: {
          companyName: "Acme",
          contactName: "Cher",
          contactEmail: "c@y.com",
        },
      }),
      CTX,
    );
    expect(r?.greetingName).toBe("Cher");
  });

  it("subject embeds company name", () => {
    const r = buildChaseEmail(buildState(), CTX);
    expect(r?.subject).toContain("Acme Co");
  });

  it("subject says 'Following up' under 72h", () => {
    const r = buildChaseEmail(buildState(), {
      hoursSinceLastTouch: 30,
      resumeUrl: "x",
    });
    expect(r?.subject).toMatch(/Following up/);
  });

  it("subject says 'Quick check-in' at 72h+", () => {
    const r = buildChaseEmail(buildState(), {
      hoursSinceLastTouch: 96,
      resumeUrl: "x",
    });
    expect(r?.subject).toMatch(/Quick check-in/);
  });

  it("body offers Rene as escalation contact", () => {
    const r = buildChaseEmail(buildState(), CTX);
    expect(r?.plainText).toContain("Rene");
  });

  it("body NEVER includes a sender persona signature like 'Rene' or 'Ben'", () => {
    const r = buildChaseEmail(buildState(), CTX);
    // Body should sign "USA Gummies wholesale team", not name a sender —
    // Rene fills in his own sig in Gmail.
    expect(r?.plainText).toContain("USA Gummies wholesale team");
    // Body should not include a sender-like sign-off ("- Ben" / "—Rene")
    expect(r?.plainText).not.toMatch(/^[—–-]\s*(Ben|Rene|Drew)\s*$/m);
  });
});

describe("buildChaseEmail — step-aware copy", () => {
  it("info: subject mentions 'wholesale inquiry'", () => {
    const r = buildChaseEmail(buildState({ currentStep: "info" }), CTX);
    expect(r?.subject).toMatch(/inquiry/);
  });

  it("pricing-shown: body mentions B2-B5 tiers", () => {
    const r = buildChaseEmail(
      buildState({ currentStep: "pricing-shown" }),
      CTX,
    );
    expect(r?.plainText).toMatch(/B2-B5/);
  });

  it("order-type: body mentions master-carton + pallet pricing", () => {
    const r = buildChaseEmail(buildState({ currentStep: "order-type" }), CTX);
    expect(r?.plainText).toMatch(/master carton/);
    expect(r?.plainText).toMatch(/pallet/);
  });

  it("payment-path: subject says 'finishing your USA Gummies order setup'", () => {
    const r = buildChaseEmail(
      buildState({ currentStep: "payment-path" }),
      CTX,
    );
    expect(r?.subject).toMatch(/finishing your USA Gummies order setup/);
  });

  it("payment-path: body summarizes the captured order line", () => {
    const r = buildChaseEmail(
      buildState({
        currentStep: "payment-path",
        orderLines: [summarizeOrderLine("B2", 3)],
      }),
      CTX,
    );
    expect(r?.plainText).toMatch(/3 master cartons/);
    expect(r?.plainText).toMatch(/108 bags/);
  });

  it("ap-info: body mentions W-9 + payment instructions", () => {
    const r = buildChaseEmail(buildState({ currentStep: "ap-info" }), CTX);
    expect(r?.plainText).toMatch(/W-9/);
    expect(r?.plainText).toMatch(/payment instructions/i);
  });

  it("shipping-info: body mentions shipping + landed freight", () => {
    const r = buildChaseEmail(
      buildState({ currentStep: "shipping-info" }),
      CTX,
    );
    expect(r?.plainText).toMatch(/shipping address/i);
    expect(r?.plainText).toMatch(/landed freight/);
  });

  it("order-captured: body says 'we're waiting on AP onboarding'", () => {
    const r = buildChaseEmail(
      buildState({ currentStep: "order-captured" }),
      CTX,
    );
    expect(r?.plainText).toMatch(/AP onboarding/);
  });
});

describe("buildChaseEmail — resume URL inclusion", () => {
  it("includes resumeUrl in body for client-input steps", () => {
    for (const step of [
      "store-type",
      "pricing-shown",
      "order-type",
      "payment-path",
      "ap-info",
      "shipping-info",
    ] as const) {
      const r = buildChaseEmail(
        buildState({ currentStep: step }),
        { hoursSinceLastTouch: 30, resumeUrl: "https://x.test/STEP" },
      );
      expect(r?.plainText).toContain("https://x.test/STEP");
    }
  });

  it("server-side terminal steps don't include resume URL — different next-action", () => {
    const r = buildChaseEmail(
      buildState({ currentStep: "qbo-customer-staged" }),
      { hoursSinceLastTouch: 30, resumeUrl: "https://x.test/STEP" },
    );
    expect(r?.plainText).not.toContain("https://x.test/STEP");
    expect(r?.plainText).toMatch(/AP team/);
  });
});

describe("orderLinesBlurb (internal)", () => {
  it("singularizes 1 master carton", () => {
    const blurb = __INTERNAL.orderLinesBlurb(
      buildState({ orderLines: [summarizeOrderLine("B2", 1)] }),
    );
    expect(blurb).toMatch(/1 master carton /);
    expect(blurb).not.toMatch(/1 master cartons/);
  });

  it("pluralizes 3 pallets", () => {
    const blurb = __INTERNAL.orderLinesBlurb(
      buildState({ orderLines: [summarizeOrderLine("B4", 3)] }),
    );
    expect(blurb).toContain("3 pallets");
  });

  it("multi-line shows total bags + USD", () => {
    const blurb = __INTERNAL.orderLinesBlurb(
      buildState({
        orderLines: [
          summarizeOrderLine("B2", 1),
          summarizeOrderLine("B4", 1),
        ],
      }),
    );
    expect(blurb).toContain("936 bags"); // 36 + 900
    expect(blurb).toMatch(/\$3\d{3}\.\d{2}/); // $3,050.64 (125.64 + 2925.00)
    expect(blurb).toContain("2 line items");
  });

  it("returns empty for zero lines", () => {
    expect(__INTERNAL.orderLinesBlurb(buildState({ orderLines: [] }))).toBe(
      "",
    );
  });
});

describe("recipient field (`to`)", () => {
  it("returns the prospect.contactEmail as the to field", () => {
    const r = buildChaseEmail(buildState(), CTX);
    expect(r?.to).toBe("jane@acme.test");
  });
});
