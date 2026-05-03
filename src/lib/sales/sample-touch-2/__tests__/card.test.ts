import { describe, expect, it } from "vitest";

import { renderSampleTouch2Card } from "../card";

const baseInput = {
  hubspotDealId: "320851856084",
  displayName: "Eric Forst — Red Dog Saloon",
  buyerEmail: "eric@reddogsaloon.com",
  daysSinceShipped: 14,
  subject: "USA Gummies — checking in on the sample for Red Dog Saloon",
  body: "Hi Eric,\n\nFollowing up — the sample case of All American Gummy Bears we sent should have landed at Red Dog Saloon a couple weeks back (about 14 days now). Just wanted to check in:\n\n  • Did the box arrive intact?\n\nBest,\nBen",
};

describe("renderSampleTouch2Card", () => {
  it("includes header, buyer, deal id, days, subject", () => {
    const card = renderSampleTouch2Card(baseInput);
    expect(card).toContain("Sample Touch-2");
    expect(card).toContain("Eric Forst — Red Dog Saloon");
    expect(card).toContain("eric@reddogsaloon.com");
    expect(card).toContain("`320851856084`");
    expect(card).toContain("14");
    expect(card).toContain("checking in on the sample for Red Dog Saloon");
  });

  it("renders body preview in a code block", () => {
    const card = renderSampleTouch2Card(baseInput);
    expect(card).toContain("Body preview:");
    expect(card).toContain("```");
    expect(card).toContain("Hi Eric,");
  });

  it("truncates long body with ellipsis", () => {
    const long = "X".repeat(500);
    const card = renderSampleTouch2Card({ ...baseInput, body: long });
    expect(card).toContain("…");
  });

  it("renders sources as Slack links when url present", () => {
    const card = renderSampleTouch2Card({
      ...baseInput,
      sources: [
        {
          system: "hubspot:deal",
          id: "320851856084",
          url: "https://app.hubspot.com/contacts/123/deals/320851856084",
        },
      ],
    });
    expect(card).toContain(
      "<https://app.hubspot.com/contacts/123/deals/320851856084|320851856084>",
    );
  });

  it("renders the Class B gmail.send footer", () => {
    const card = renderSampleTouch2Card(baseInput);
    expect(card).toContain("Class B `gmail.send`");
    expect(card).toContain("ops-approvals");
  });

  it("escapes backticks in subject", () => {
    const card = renderSampleTouch2Card({
      ...baseInput,
      subject: "Subject with `ticks` in it",
    });
    expect(card).not.toContain("Subject with `ticks` in it");
    expect(card).toContain("Subject with ʹticksʹ in it");
  });
});
