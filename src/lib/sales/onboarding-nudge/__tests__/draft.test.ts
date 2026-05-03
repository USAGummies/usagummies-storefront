import { describe, expect, it } from "vitest";

import { composeOnboardingNudgeDraft } from "../draft";

describe("composeOnboardingNudgeDraft", () => {
  it("renders subject + body for the 'store-type' parked step", () => {
    const r = composeOnboardingNudgeDraft({
      buyerFirstName: "Mike",
      displayName: "Thanksgiving Point",
      currentStep: "store-type",
      daysSinceLastTouch: 2,
      onboardingUrl: "https://www.usagummies.com/onboarding/wp_thanksgiving",
    });
    expect(r.subject).toContain("USA Gummies");
    expect(r.subject).toContain("Thanksgiving Point");
    expect(r.body).toContain("Hi Mike,");
    expect(r.body).toContain("2 days");
    expect(r.body).toContain("store-type selector");
    expect(r.body).toContain(
      "https://www.usagummies.com/onboarding/wp_thanksgiving",
    );
    expect(r.template).toBe("onboarding-nudge:store-type");
  });

  it("uses 'noticed earlier today' phrasing when daysSinceLastTouch <= 1", () => {
    const r = composeOnboardingNudgeDraft({
      buyerFirstName: "Mike",
      displayName: "Thanksgiving Point",
      currentStep: "info",
      daysSinceLastTouch: 1,
      onboardingUrl: "https://www.usagummies.com/onboarding/wp_t",
    });
    expect(r.body).toContain("noticed earlier today");
    expect(r.body).not.toContain("It's been 1 days");
  });

  it("uses per-step hooks: pricing-shown → 'pricing tier review'", () => {
    const r = composeOnboardingNudgeDraft({
      buyerFirstName: "Buyer",
      displayName: "Some Co",
      currentStep: "pricing-shown",
      daysSinceLastTouch: 3,
      onboardingUrl: "https://x.test/onboarding/y",
    });
    expect(r.body).toContain("pricing tier review");
    expect(r.body).toContain("master carton vs pallet");
  });

  it("uses per-step hooks: payment-path → CC vs invoice mention", () => {
    const r = composeOnboardingNudgeDraft({
      buyerFirstName: "Buyer",
      displayName: "Some Co",
      currentStep: "payment-path",
      daysSinceLastTouch: 4,
      onboardingUrl: "https://x.test/onboarding/y",
    });
    expect(r.body).toContain("credit card");
    expect(r.body).toContain("invoice");
  });

  it("uses per-step hooks: ap-info → AP team forwarding offer", () => {
    const r = composeOnboardingNudgeDraft({
      buyerFirstName: "Buyer",
      displayName: "Some Co",
      currentStep: "ap-info",
      daysSinceLastTouch: 5,
      onboardingUrl: "https://x.test/onboarding/y",
    });
    expect(r.body).toContain("AP team");
    expect(r.body).toContain("W-9");
  });

  it("falls back to 'there' when buyerFirstName missing", () => {
    const r = composeOnboardingNudgeDraft({
      displayName: "Some Co",
      currentStep: "info",
      daysSinceLastTouch: 2,
      onboardingUrl: "https://x.test/onboarding/y",
    });
    expect(r.body).toContain("Hi there,");
  });

  it("includes the 'no pressure either way' close on every step", () => {
    const r = composeOnboardingNudgeDraft({
      buyerFirstName: "Buyer",
      displayName: "Some Co",
      currentStep: "store-type",
      daysSinceLastTouch: 2,
      onboardingUrl: "https://x.test/onboarding/y",
    });
    expect(r.body).toContain("No pressure either way");
  });

  it("template includes the step suffix for downstream tracking", () => {
    const r = composeOnboardingNudgeDraft({
      displayName: "X",
      currentStep: "ap-email-sent",
      daysSinceLastTouch: 7,
      onboardingUrl: "https://x.test/onboarding/y",
    });
    expect(r.template).toBe("onboarding-nudge:ap-email-sent");
  });
});
