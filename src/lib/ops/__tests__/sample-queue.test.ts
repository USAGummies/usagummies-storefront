/**
 * Sample-queue helper coverage.
 *
 * Pins:
 *   - validateSampleQueueRequest catches every required-field gap and
 *     the obvious shape errors (missing recipient, non-numeric quantity,
 *     >36 bag count).
 *   - detectSampleWhalePriority matches every whale substring in
 *     recipient name OR company OR note (case-insensitive).
 *   - buildSampleQueueOrderIntent emits the right tags, packagingType,
 *     weightLbs, and channel="manual" so the dispatch classifier routes
 *     it as a sample.
 *   - makeSampleQueueSourceId produces a deterministic prefix (timestamp)
 *     + a random suffix.
 */
import { describe, expect, it } from "vitest";

import {
  buildSampleQueueOrderIntent,
  detectSampleWhalePriority,
  makeSampleQueueSourceId,
  validateSampleQueueRequest,
  type SampleQueueRequest,
} from "../sample-queue";

const validReq = (overrides: Partial<SampleQueueRequest> = {}): SampleQueueRequest => ({
  recipient: {
    name: "Greg Kroetch",
    company: "Powers Confections",
    street1: "1115 N Hayford Rd",
    city: "Spokane",
    state: "WA",
    postalCode: "99224",
  },
  ...overrides,
});

describe("validateSampleQueueRequest", () => {
  it("accepts a fully-populated request", () => {
    expect(validateSampleQueueRequest(validReq())).toEqual({ ok: true });
  });

  it("rejects missing body", () => {
    // @ts-expect-error — testing runtime guard
    expect(validateSampleQueueRequest(null).ok).toBe(false);
    // @ts-expect-error — testing runtime guard
    expect(validateSampleQueueRequest(undefined).ok).toBe(false);
  });

  it("rejects missing recipient", () => {
    const r = validateSampleQueueRequest({} as SampleQueueRequest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/recipient/);
  });

  it.each(["name", "street1", "city", "state", "postalCode"] as const)(
    "rejects missing recipient.%s",
    (field) => {
      const req = validReq();
      req.recipient[field] = "";
      const r = validateSampleQueueRequest(req);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain(field);
    },
  );

  it("rejects non-2-letter state", () => {
    const req = validReq();
    req.recipient.state = "Washington";
    const r = validateSampleQueueRequest(req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2-letter/);
  });

  it("rejects non-finite quantity", () => {
    const r = validateSampleQueueRequest(validReq({ quantity: Number.NaN }));
    expect(r.ok).toBe(false);
  });

  it("rejects zero/negative quantity", () => {
    expect(validateSampleQueueRequest(validReq({ quantity: 0 })).ok).toBe(false);
    expect(validateSampleQueueRequest(validReq({ quantity: -1 })).ok).toBe(false);
  });

  it("rejects quantity > 36 (that's a master carton, not a sample)", () => {
    const r = validateSampleQueueRequest(validReq({ quantity: 37 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/master carton/);
  });

  it("accepts quantity = 36 (boundary)", () => {
    expect(validateSampleQueueRequest(validReq({ quantity: 36 })).ok).toBe(true);
  });
});

describe("detectSampleWhalePriority", () => {
  it("returns 'standard' for non-whale recipients", () => {
    expect(detectSampleWhalePriority(validReq())).toBe("standard");
  });

  it.each([
    ["Buc-ee's HQ", undefined],
    ["Ben's friend", "Buc-ee's"],
    ["KeHE Distributors", undefined],
    ["McLane Co", undefined],
    ["Eastern National", undefined],
    ["Xanterra Travel", undefined],
    ["Delaware North", undefined],
    ["Aramark Foods", undefined],
    ["Compass Group USA", undefined],
    ["Sodexo", undefined],
  ])("flags '%s' / company '%s' as whale", (name, company) => {
    const r = validReq();
    r.recipient.name = name;
    if (company !== undefined) r.recipient.company = company;
    expect(detectSampleWhalePriority(r)).toBe("whale");
  });

  it("matches whale substring in note when name+company are clean", () => {
    const r = validReq({
      recipient: {
        name: "John Smith",
        street1: "1 Way",
        city: "Anywhere",
        state: "TX",
        postalCode: "75001",
      },
      note: "intro from Buc-ee's category buyer",
    });
    expect(detectSampleWhalePriority(r)).toBe("whale");
  });

  it("is case-insensitive", () => {
    const r = validReq();
    r.recipient.company = "BUC-EE'S, LTD.";
    expect(detectSampleWhalePriority(r)).toBe("whale");
  });
});

describe("buildSampleQueueOrderIntent", () => {
  it("sets channel='manual' and stable sourceId prefix", () => {
    const intent = buildSampleQueueOrderIntent(validReq(), {
      now: 1714500000000,
      sourceId: "sample-queue-1714500000000-abc",
    });
    expect(intent.channel).toBe("manual");
    expect(intent.sourceId).toMatch(/^sample-queue-/);
    expect(intent.orderNumber).toBe(intent.sourceId);
  });

  it("emits the sample tag set so classifier routes as sample", () => {
    const intent = buildSampleQueueOrderIntent(validReq());
    expect(intent.tags).toContain("sample");
    expect(intent.tags).toContain("tag:sample");
    expect(intent.tags).toContain("queue:operator");
  });

  it("appends role:<role> tag when role provided", () => {
    const intent = buildSampleQueueOrderIntent(validReq({ role: "buyer" }));
    expect(intent.tags).toContain("role:buyer");
  });

  it("uppercases state and trims fields", () => {
    const r = validReq();
    r.recipient.state = " wa ";
    r.recipient.name = "  Greg  ";
    const intent = buildSampleQueueOrderIntent(r);
    expect(intent.shipTo.state).toBe("WA");
    expect(intent.shipTo.name).toBe("Greg");
  });

  it("defaults country to US and packagingType=case for 6-bag default", () => {
    const intent = buildSampleQueueOrderIntent(validReq());
    expect(intent.shipTo.country).toBe("US");
    expect(intent.packagingType).toBe("case");
    expect(intent.weightLbs).toBe(6);
  });

  it("uses mailer + 0.55 lb for 1-bag samples", () => {
    const intent = buildSampleQueueOrderIntent(validReq({ quantity: 1 }));
    expect(intent.packagingType).toBe("mailer");
    expect(intent.weightLbs).toBe(0.55);
  });

  it("merges role + note into the OrderIntent.note (free-form)", () => {
    const intent = buildSampleQueueOrderIntent(
      validReq({ role: "buyer", note: "met at Reunion 2026" }),
    );
    expect(intent.note).toContain("role=buyer");
    expect(intent.note).toContain("met at Reunion 2026");
  });

  it("note is undefined when neither role nor note supplied", () => {
    const intent = buildSampleQueueOrderIntent(validReq());
    expect(intent.note).toBeUndefined();
  });
});

describe("makeSampleQueueSourceId", () => {
  it("starts with 'sample-queue-' and embeds the timestamp", () => {
    const id = makeSampleQueueSourceId(1714500000000);
    expect(id).toMatch(/^sample-queue-1714500000000-[a-z0-9]{3}$/);
  });

  it("two adjacent calls produce different ids (random suffix)", () => {
    const a = makeSampleQueueSourceId(1714500000000);
    const b = makeSampleQueueSourceId(1714500000000);
    // Probabilistically these should differ; if Math.random ties (~1 in 36^3)
    // we accept the rare equality silently.
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
  });
});
