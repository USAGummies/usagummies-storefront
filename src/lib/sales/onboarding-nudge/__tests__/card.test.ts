import { describe, expect, it } from "vitest";

import { renderOnboardingNudgeCard } from "../card";

const baseInput = {
  flowId: "wp_thanksgiving_2026_05",
  displayName: "Thanksgiving Point",
  buyerEmail: "buyer@thanksgivingpoint.org",
  currentStep: "store-type" as const,
  daysSinceLastTouch: 2,
  onboardingUrl:
    "https://www.usagummies.com/onboarding/wp_thanksgiving_2026_05",
  subject: "USA Gummies — picking up your onboarding for Thanksgiving Point",
  body: "Hi Mike,\n\nIt's been 2 days since you started on the USA Gummies wholesale onboarding form for Thanksgiving Point — looked like you stopped at the store-type selector.\n\nBest,\nBen",
};

describe("renderOnboardingNudgeCard", () => {
  it("includes header, buyer, flow id, parked step, days, resume URL, subject", () => {
    const card = renderOnboardingNudgeCard(baseInput);
    expect(card).toContain("Onboarding nudge");
    expect(card).toContain("Thanksgiving Point");
    expect(card).toContain("buyer@thanksgivingpoint.org");
    expect(card).toContain("`wp_thanksgiving_2026_05`");
    expect(card).toContain("`store type`");
    expect(card).toContain("2d");
    expect(card).toContain("https://www.usagummies.com/onboarding/wp_thanksgiving_2026_05");
    expect(card).toContain("picking up your onboarding for Thanksgiving Point");
  });

  it("includes hubspotDealId line when provided", () => {
    const card = renderOnboardingNudgeCard({
      ...baseInput,
      hubspotDealId: "320851856084",
    });
    expect(card).toContain("HubSpot deal:");
    expect(card).toContain("`320851856084`");
  });

  it("omits hubspotDealId line when absent", () => {
    const card = renderOnboardingNudgeCard(baseInput);
    expect(card).not.toContain("HubSpot deal:");
  });

  it("renders body preview in a code block", () => {
    const card = renderOnboardingNudgeCard(baseInput);
    expect(card).toContain("Body preview:");
    expect(card).toContain("```");
    expect(card).toContain("Hi Mike,");
  });

  it("renders the Class B gmail.send footer", () => {
    const card = renderOnboardingNudgeCard(baseInput);
    expect(card).toContain("Class B `gmail.send`");
    expect(card).toContain("ops-approvals");
  });

  it("renders sources as Slack links when url present", () => {
    const card = renderOnboardingNudgeCard({
      ...baseInput,
      sources: [
        {
          system: "wholesale-onboarding-kv",
          id: "wp_thanksgiving",
          url: "https://www.usagummies.com/ops/wholesale/onboarding",
        },
      ],
    });
    expect(card).toContain(
      "<https://www.usagummies.com/ops/wholesale/onboarding|wp_thanksgiving>",
    );
  });

  it("displays human-readable parked step (hyphens → spaces)", () => {
    const card = renderOnboardingNudgeCard({
      ...baseInput,
      currentStep: "qbo-customer-staged",
    });
    expect(card).toContain("`qbo customer staged`");
    expect(card).not.toContain("`qbo-customer-staged`");
  });
});
