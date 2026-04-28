/**
 * Phase 35.b — wholesale onboarding state machine tests.
 *
 * These tests lock the doctrinal invariants from
 * `/contracts/wholesale-onboarding-flow.md` v1.0:
 *
 *   1. Canonical 11-step order is stable.
 *   2. AP path runs `ap-info` + `ap-email-sent`. Credit-card path
 *      SKIPS those. Out-of-order POSTs throw.
 *   3. Validation rejects: empty companyName/contactName, malformed
 *      emails, B1 (internal-only), unitCount < 1, fractional
 *      unitCount, AP info missing both `apEmail` AND self-fill.
 *   4. Order-line projection sums correctly across multi-line
 *      states + flags custom-freight when ANY line hits 3+ pallets.
 *   5. `sideEffectsForStep` dispatches the correct action slugs at
 *      each step (HubSpot, KV, Slack, AP packet, QBO approval).
 */
import { describe, it, expect } from "vitest";

import { summarizeOrderLine } from "../pricing-tiers";
import {
  ONBOARDING_STEPS,
  STORE_TYPES,
  advanceStep,
  anyLineNeedsCustomFreight,
  buildOrderLine,
  newOnboardingState,
  nextStep,
  sideEffectsForStep,
  totalBags,
  totalSubtotalUsd,
  validateAPInfo,
  validateOrderLine,
  validateProspectInfo,
  validateShippingAddress,
  type OnboardingState,
} from "../onboarding-flow";

const FIXED_NOW = new Date("2026-04-27T20:00:00.000Z");

function freshState(): OnboardingState {
  return newOnboardingState("flow-test-001");
}

describe("ONBOARDING_STEPS", () => {
  it("is the locked 11-step canonical order", () => {
    expect(ONBOARDING_STEPS).toEqual([
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
    ]);
  });

  it("has exactly 11 steps", () => {
    expect(ONBOARDING_STEPS.length).toBe(11);
  });
});

describe("STORE_TYPES", () => {
  it("includes the locked 10 store types", () => {
    expect(STORE_TYPES).toContain("specialty-retail");
    expect(STORE_TYPES).toContain("park-or-museum");
    expect(STORE_TYPES).toContain("other");
    expect(STORE_TYPES.length).toBe(10);
  });
});

describe("newOnboardingState", () => {
  it("starts at step `info` with empty history", () => {
    const s = newOnboardingState("flow-001");
    expect(s.flowId).toBe("flow-001");
    expect(s.currentStep).toBe("info");
    expect(s.stepsCompleted).toEqual([]);
    expect(s.orderLines).toEqual([]);
    expect(s.timestamps).toEqual({});
  });

  it("rejects an empty flowId", () => {
    expect(() => newOnboardingState("")).toThrow(/flowId required/);
    expect(() => newOnboardingState("   ")).toThrow(/flowId required/);
  });
});

describe("nextStep — credit-card path", () => {
  it("walks the canonical order, skipping ap-info + ap-email-sent", () => {
    let s = freshState();
    expect(nextStep(s)).toBe("info");

    s = advanceStep(s, "info", FIXED_NOW);
    expect(nextStep(s)).toBe("store-type");

    s = advanceStep(s, "store-type", FIXED_NOW);
    expect(nextStep(s)).toBe("pricing-shown");

    s = advanceStep(s, "pricing-shown", FIXED_NOW);
    expect(nextStep(s)).toBe("order-type");

    s = advanceStep(s, "order-type", FIXED_NOW);
    expect(nextStep(s)).toBe("payment-path");

    // Choose credit-card. ap-info + ap-email-sent skipped.
    s = advanceStep(s, "payment-path", FIXED_NOW, () => ({
      paymentPath: "credit-card",
    }));
    expect(nextStep(s)).toBe("order-captured");

    s = advanceStep(s, "order-captured", FIXED_NOW);
    expect(nextStep(s)).toBe("shipping-info");

    s = advanceStep(s, "shipping-info", FIXED_NOW);
    expect(nextStep(s)).toBe("qbo-customer-staged");

    s = advanceStep(s, "qbo-customer-staged", FIXED_NOW);
    expect(nextStep(s)).toBe("crm-updated");

    s = advanceStep(s, "crm-updated", FIXED_NOW);
    expect(nextStep(s)).toBeNull();

    expect(s.stepsCompleted).not.toContain("ap-info");
    expect(s.stepsCompleted).not.toContain("ap-email-sent");
  });
});

describe("nextStep — AP path", () => {
  it("includes ap-info + ap-email-sent in the order", () => {
    let s = freshState();

    s = advanceStep(s, "info", FIXED_NOW);
    s = advanceStep(s, "store-type", FIXED_NOW);
    s = advanceStep(s, "pricing-shown", FIXED_NOW);
    s = advanceStep(s, "order-type", FIXED_NOW);
    s = advanceStep(s, "payment-path", FIXED_NOW, () => ({
      paymentPath: "accounts-payable",
    }));

    // AP path goes through ap-info before order-captured.
    expect(nextStep(s)).toBe("ap-info");
    s = advanceStep(s, "ap-info", FIXED_NOW);

    expect(nextStep(s)).toBe("order-captured");
    s = advanceStep(s, "order-captured", FIXED_NOW);

    expect(nextStep(s)).toBe("shipping-info");
    s = advanceStep(s, "shipping-info", FIXED_NOW);

    // ap-email-sent runs after shipping-info on AP path.
    expect(nextStep(s)).toBe("ap-email-sent");
    s = advanceStep(s, "ap-email-sent", FIXED_NOW);

    expect(nextStep(s)).toBe("qbo-customer-staged");
    s = advanceStep(s, "qbo-customer-staged", FIXED_NOW);

    expect(nextStep(s)).toBe("crm-updated");
    s = advanceStep(s, "crm-updated", FIXED_NOW);

    expect(nextStep(s)).toBeNull();

    // All 11 steps recorded on AP path.
    expect(s.stepsCompleted.length).toBe(11);
    expect(s.stepsCompleted).toContain("ap-info");
    expect(s.stepsCompleted).toContain("ap-email-sent");
  });
});

describe("advanceStep — out-of-order rejection", () => {
  it("throws when the requested step does not match the expected next", () => {
    const s = freshState();
    expect(() => advanceStep(s, "store-type", FIXED_NOW)).toThrow(
      /expected step "info"/,
    );
  });

  it("throws when re-submitting an already-completed step", () => {
    let s = freshState();
    s = advanceStep(s, "info", FIXED_NOW);
    expect(() => advanceStep(s, "info", FIXED_NOW)).toThrow(
      /expected step "store-type"/,
    );
  });

  it("records a server-side timestamp for the step", () => {
    let s = freshState();
    s = advanceStep(s, "info", FIXED_NOW);
    expect(s.timestamps.info).toBe(FIXED_NOW.toISOString());
  });

  it("appends to stepsCompleted in canonical order", () => {
    let s = freshState();
    s = advanceStep(s, "info", FIXED_NOW);
    s = advanceStep(s, "store-type", FIXED_NOW);
    expect(s.stepsCompleted).toEqual(["info", "store-type"]);
  });

  it("merges mutator output into the state", () => {
    let s = freshState();
    s = advanceStep(s, "info", FIXED_NOW, () => ({
      prospect: {
        companyName: "Acme Co",
        contactName: "Jane Doe",
        contactEmail: "jane@acme.test",
      },
    }));
    expect(s.prospect?.companyName).toBe("Acme Co");
    expect(s.currentStep).toBe("store-type");
  });
});

describe("validateProspectInfo", () => {
  it("accepts a complete contact", () => {
    const r = validateProspectInfo({
      companyName: "Acme Co",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
      contactPhone: "555-1212",
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts contact without phone (optional)", () => {
    const r = validateProspectInfo({
      companyName: "Acme Co",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validateProspectInfo("string").ok).toBe(false);
    expect(validateProspectInfo(null).ok).toBe(false);
    expect(validateProspectInfo(42).ok).toBe(false);
  });

  it("rejects empty companyName", () => {
    const r = validateProspectInfo({
      companyName: "   ",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("companyName required");
  });

  it("rejects missing contactName", () => {
    const r = validateProspectInfo({
      companyName: "Acme",
      contactEmail: "jane@acme.test",
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("contactName required");
  });

  it("rejects malformed contactEmail", () => {
    const r = validateProspectInfo({
      companyName: "Acme",
      contactName: "Jane",
      contactEmail: "not-an-email",
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("contactEmail must be a valid email address");
  });

  it("rejects non-string phone when present", () => {
    const r = validateProspectInfo({
      companyName: "Acme",
      contactName: "Jane",
      contactEmail: "jane@acme.test",
      contactPhone: 5551212,
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("contactPhone must be a string when provided");
  });
});

describe("validateOrderLine", () => {
  it("accepts B2 with unitCount=1 (online MOQ)", () => {
    const r = validateOrderLine("B2", 1);
    expect(r.ok).toBe(true);
  });

  it("accepts B5 with unitCount=10 (10 pallets)", () => {
    const r = validateOrderLine("B5", 10);
    expect(r.ok).toBe(true);
  });

  it("rejects B1 (internal-only)", () => {
    const r = validateOrderLine("B1", 5);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/INTERNAL only/);
  });

  it("rejects unknown tier strings", () => {
    const r = validateOrderLine("B6", 1);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/B2\/B3\/B4\/B5/);
  });

  it("rejects unitCount=0 (online MOQ is 1)", () => {
    const r = validateOrderLine("B2", 0);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/at least 1/);
  });

  it("rejects fractional unitCount", () => {
    const r = validateOrderLine("B2", 2.5);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/whole number/);
  });

  it("rejects negative unitCount", () => {
    const r = validateOrderLine("B2", -1);
    expect(r.ok).toBe(false);
  });

  it("rejects non-finite unitCount", () => {
    expect(validateOrderLine("B2", Number.NaN).ok).toBe(false);
    expect(validateOrderLine("B2", Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it("rejects non-number unitCount", () => {
    const r = validateOrderLine("B2", "3");
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/finite number/);
  });
});

describe("validateAPInfo", () => {
  it("accepts apEmail-only (we send packet to AP team)", () => {
    const r = validateAPInfo({ apEmail: "ap@acme.test" });
    expect(r.ok).toBe(true);
  });

  it("accepts self-fill with apContactName + taxId", () => {
    const r = validateAPInfo({
      apContactName: "John AP",
      taxId: "12-3456789",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects empty object (must provide one of two paths)", () => {
    const r = validateAPInfo({});
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Provide either apEmail/);
  });

  it("rejects self-fill missing taxId", () => {
    const r = validateAPInfo({ apContactName: "John AP" });
    expect(r.ok).toBe(false);
  });

  it("rejects malformed apEmail", () => {
    const r = validateAPInfo({ apEmail: "not-an-email" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/valid email/);
  });

  it("rejects non-object input", () => {
    expect(validateAPInfo(null).ok).toBe(false);
    expect(validateAPInfo("string").ok).toBe(false);
  });
});

describe("validateShippingAddress", () => {
  it("accepts a complete address", () => {
    const r = validateShippingAddress({
      street1: "123 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "US",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects missing required fields", () => {
    const r = validateShippingAddress({
      street1: "123 Main St",
      city: "Austin",
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("state required");
    expect(r.errors).toContain("postalCode required");
    expect(r.errors).toContain("country required");
  });

  it("rejects non-object input", () => {
    expect(validateShippingAddress(null).ok).toBe(false);
  });

  it("rejects whitespace-only fields", () => {
    const r = validateShippingAddress({
      street1: "   ",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "US",
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("street1 required");
  });
});

describe("buildOrderLine", () => {
  it("delegates to summarizeOrderLine for B2 × 3", () => {
    const built = buildOrderLine("B2", 3);
    const expected = summarizeOrderLine("B2", 3);
    expect(built).toEqual(expected);
  });
});

describe("totalSubtotalUsd", () => {
  it("returns 0 for empty lines", () => {
    expect(totalSubtotalUsd([])).toBe(0);
  });

  it("sums two B2 master cartons + one B4 pallet", () => {
    const lines = [buildOrderLine("B2", 2), buildOrderLine("B4", 1)];
    // B2 × 2 = 72 bags × $3.49 = $251.28
    // B4 × 1 = 432 bags × $3.25 = $1,404.00
    expect(totalSubtotalUsd(lines)).toBeCloseTo(251.28 + 1404.0, 2);
  });

  it("rounds to 2 decimals", () => {
    const lines = [buildOrderLine("B2", 1)]; // 36 × 3.49 = 125.64
    expect(totalSubtotalUsd(lines)).toBe(125.64);
  });
});

describe("anyLineNeedsCustomFreight", () => {
  it("is false for any quantity of B2/B3 (master cartons)", () => {
    expect(
      anyLineNeedsCustomFreight([
        buildOrderLine("B2", 100),
        buildOrderLine("B3", 50),
      ]),
    ).toBe(false);
  });

  it("is false for B4/B5 at 1-2 pallets (under threshold)", () => {
    expect(anyLineNeedsCustomFreight([buildOrderLine("B4", 1)])).toBe(false);
    expect(anyLineNeedsCustomFreight([buildOrderLine("B5", 2)])).toBe(false);
  });

  it("is true for B4/B5 at 3+ pallets", () => {
    expect(anyLineNeedsCustomFreight([buildOrderLine("B4", 3)])).toBe(true);
    expect(anyLineNeedsCustomFreight([buildOrderLine("B5", 5)])).toBe(true);
  });

  it("is true if ANY line crosses the threshold", () => {
    expect(
      anyLineNeedsCustomFreight([
        buildOrderLine("B2", 5), // not custom
        buildOrderLine("B5", 4), // custom
      ]),
    ).toBe(true);
  });
});

describe("totalBags", () => {
  it("sums bag counts atomically (no case/carton/pallet rounding)", () => {
    const lines = [
      buildOrderLine("B2", 3), // 108 bags
      buildOrderLine("B4", 2), // 864 bags
    ];
    expect(totalBags(lines)).toBe(108 + 864);
  });

  it("returns 0 for empty lines", () => {
    expect(totalBags([])).toBe(0);
  });
});

describe("sideEffectsForStep — info", () => {
  it("upserts contact, creates lead deal, archives inquiry", () => {
    const s = freshState();
    const fx = sideEffectsForStep("info", s);
    const kinds = fx.map((e) => e.kind);
    expect(kinds).toContain("hubspot.upsert-contact");
    expect(kinds).toContain("hubspot.create-deal");
    expect(kinds).toContain("kv.archive-inquiry");
  });
});

describe("sideEffectsForStep — order-captured", () => {
  it("flips HubSpot stage to pending_ap_approval on AP path", () => {
    const s: OnboardingState = {
      ...freshState(),
      paymentPath: "accounts-payable",
    };
    const fx = sideEffectsForStep("order-captured", s);
    const advance = fx.find((e) => e.kind === "hubspot.advance-stage");
    expect(advance).toBeDefined();
    expect(advance && (advance as { stage: string }).stage).toBe(
      "pending_ap_approval",
    );
  });

  it("flips HubSpot stage to PO_RECEIVED on credit-card path", () => {
    const s: OnboardingState = {
      ...freshState(),
      paymentPath: "credit-card",
    };
    const fx = sideEffectsForStep("order-captured", s);
    const advance = fx.find((e) => e.kind === "hubspot.advance-stage");
    expect(advance && (advance as { stage: string }).stage).toBe("PO_RECEIVED");
  });

  it("writes order-captured KV envelope + posts financials notif", () => {
    const fx = sideEffectsForStep("order-captured", freshState());
    const kinds = fx.map((e) => e.kind);
    expect(kinds).toContain("kv.write-order-captured");
    expect(kinds).toContain("slack.post-financials-notif");
  });
});

describe("sideEffectsForStep — ap-email-sent", () => {
  it("dispatches the wholesale-ap packet template (Q3 default)", () => {
    const fx = sideEffectsForStep("ap-email-sent", freshState());
    expect(fx).toHaveLength(1);
    expect(fx[0]).toEqual({
      kind: "ap-packet.send",
      template: "wholesale-ap",
    });
  });
});

describe("sideEffectsForStep — qbo-customer-staged", () => {
  it("stages a QBO vendor.master.create approval (Q5 default — auto-stage on submit)", () => {
    const fx = sideEffectsForStep("qbo-customer-staged", freshState());
    expect(fx.map((e) => e.kind)).toContain(
      "qbo.vendor-master-create.stage-approval",
    );
  });
});

describe("sideEffectsForStep — crm-updated", () => {
  it("marks onboarding complete + writes audit envelope", () => {
    const fx = sideEffectsForStep("crm-updated", freshState());
    const kinds = fx.map((e) => e.kind);
    expect(kinds).toContain("hubspot.set-onboarding-complete");
    expect(kinds).toContain("audit.flow-complete");
  });
});

describe("sideEffectsForStep — non-effecting steps", () => {
  it("returns empty for steps that don't touch external systems", () => {
    expect(sideEffectsForStep("store-type", freshState())).toEqual([]);
    expect(sideEffectsForStep("pricing-shown", freshState())).toEqual([]);
    expect(sideEffectsForStep("order-type", freshState())).toEqual([]);
    expect(sideEffectsForStep("payment-path", freshState())).toEqual([]);
    expect(sideEffectsForStep("ap-info", freshState())).toEqual([]);
    expect(sideEffectsForStep("shipping-info", freshState())).toEqual([]);
  });
});

describe("end-to-end — credit-card path produces no AP packet", () => {
  it("never emits an `ap-packet.send` side effect on credit-card flows", () => {
    let s = freshState();
    const allFx: string[] = [];

    for (const step of [
      "info",
      "store-type",
      "pricing-shown",
      "order-type",
      "payment-path",
    ] as const) {
      const mutator =
        step === "payment-path"
          ? () => ({ paymentPath: "credit-card" as const })
          : undefined;
      s = advanceStep(s, step, FIXED_NOW, mutator);
      sideEffectsForStep(step, s).forEach((e) => allFx.push(e.kind));
    }

    let nxt = nextStep(s);
    while (nxt !== null) {
      s = advanceStep(s, nxt, FIXED_NOW);
      sideEffectsForStep(nxt, s).forEach((e) => allFx.push(e.kind));
      nxt = nextStep(s);
    }

    expect(allFx).not.toContain("ap-packet.send");
    expect(allFx).toContain("qbo.vendor-master-create.stage-approval");
    expect(allFx).toContain("audit.flow-complete");
  });
});

describe("end-to-end — AP path produces wholesale-ap packet", () => {
  it("emits exactly one `ap-packet.send` with template wholesale-ap", () => {
    let s = freshState();
    const allFx: string[] = [];

    for (const step of [
      "info",
      "store-type",
      "pricing-shown",
      "order-type",
      "payment-path",
    ] as const) {
      const mutator =
        step === "payment-path"
          ? () => ({ paymentPath: "accounts-payable" as const })
          : undefined;
      s = advanceStep(s, step, FIXED_NOW, mutator);
      sideEffectsForStep(step, s).forEach((e) => allFx.push(e.kind));
    }

    let nxt = nextStep(s);
    while (nxt !== null) {
      s = advanceStep(s, nxt, FIXED_NOW);
      sideEffectsForStep(nxt, s).forEach((e) => allFx.push(e.kind));
      nxt = nextStep(s);
    }

    const apSends = allFx.filter((k) => k === "ap-packet.send");
    expect(apSends.length).toBe(1);
    expect(s.stepsCompleted).toContain("ap-info");
    expect(s.stepsCompleted).toContain("ap-email-sent");
  });
});
