import { describe, expect, it } from "vitest";

import { composeSampleTouch2Draft } from "../draft";

describe("composeSampleTouch2Draft", () => {
  it("renders subject + body with greeting + day count + sample-case noun", () => {
    const r = composeSampleTouch2Draft({
      buyerFirstName: "Eric",
      displayName: "Red Dog Saloon",
      daysSinceShipped: 14,
    });
    expect(r.subject).toContain("USA Gummies");
    expect(r.subject).toContain("Red Dog Saloon");
    expect(r.body).toContain("Hi Eric,");
    expect(r.body).toContain("sample case");
    expect(r.body).toContain("about 14 days");
    expect(r.body).toContain("Did the box arrive intact?");
    expect(r.body).toContain("ben@usagummies.com");
    expect(r.template).toBe("sample-touch-2");
  });

  it("uses 'sample mailer' noun when sampleSize=mailer", () => {
    const r = composeSampleTouch2Draft({
      buyerFirstName: "Vicki",
      displayName: "Vicki's Shop",
      daysSinceShipped: 10,
      sampleSize: "mailer",
    });
    expect(r.body).toContain("sample mailer");
    expect(r.body).not.toContain("sample case");
  });

  it("uses 'master carton sample' noun when sampleSize=master_carton", () => {
    const r = composeSampleTouch2Draft({
      buyerFirstName: "Sydney",
      displayName: "Mitchell & Co",
      daysSinceShipped: 9,
      sampleSize: "master_carton",
    });
    expect(r.body).toContain("master carton sample");
  });

  it("includes the 'isn't a fit, just let me know' off-ramp", () => {
    const r = composeSampleTouch2Draft({
      buyerFirstName: "Eric",
      displayName: "Red Dog Saloon",
      daysSinceShipped: 14,
    });
    expect(r.body).toContain("isn't a fit");
    expect(r.body).toContain("active list");
  });

  it("falls back to 'there' when buyerFirstName is missing", () => {
    const r = composeSampleTouch2Draft({
      displayName: "Some Buyer",
      daysSinceShipped: 10,
    });
    expect(r.body).toContain("Hi there,");
  });

  it("strips em-dash suffixes from displayName for company in subject", () => {
    const r = composeSampleTouch2Draft({
      buyerFirstName: "Eric",
      displayName: "Eric Forst — Red Dog Saloon",
      daysSinceShipped: 14,
    });
    // Subject should pick up just the first half (caller-friendly).
    expect(r.subject).toContain("Eric Forst");
  });
});
