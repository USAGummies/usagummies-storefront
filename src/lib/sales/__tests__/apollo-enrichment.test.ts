/**
 * Phase D5 — Apollo enrichment with provenance.
 *
 * Pure-function tests for the proposal builder. The Apollo client +
 * HubSpot write are tested elsewhere (`apollo-client.test.ts` +
 * existing `hubspot-client` flows).
 */
import { describe, expect, it } from "vitest";

import type { ApolloPerson } from "@/lib/ops/apollo-client";
import {
  buildEnrichmentFills,
  buildEnrichmentProposal,
  computeApolloMatchConfidence,
  fillsToContactInput,
  type EnrichableContact,
} from "@/lib/sales/apollo-enrichment";

const RETRIEVED_AT = "2026-04-30T12:00:00.000Z";

function contact(overrides: Partial<EnrichableContact> = {}): EnrichableContact {
  return {
    id: "contact-1",
    email: "buyer@example.com",
    firstname: null,
    lastname: null,
    jobtitle: null,
    phone: null,
    company: null,
    city: null,
    state: null,
    ...overrides,
  };
}

function apollo(overrides: Partial<ApolloPerson> = {}): ApolloPerson {
  return {
    id: "apollo-person-7",
    email: "buyer@example.com",
    email_status: "verified",
    first_name: "Sarah",
    last_name: "McGowan",
    title: "Director of Retail",
    mobile_phone_number: "+15551234567",
    city: "Salt Lake City",
    state: "UT",
    organization: { name: "Bryce Glamp & Camp" },
    ...overrides,
  };
}

describe("buildEnrichmentFills — only fills empty fields, never overwrites", () => {
  it("fills every supported field when HubSpot contact is empty", () => {
    const fills = buildEnrichmentFills(contact(), apollo());
    const fields = fills.map((f) => f.field).sort();
    expect(fields).toEqual([
      "city",
      "company",
      "firstname",
      "jobtitle",
      "lastname",
      "phone",
      "state",
    ]);
  });

  it("does NOT overwrite an existing HubSpot value (firstname)", () => {
    const fills = buildEnrichmentFills(contact({ firstname: "PreExisting" }), apollo());
    expect(fills.find((f) => f.field === "firstname")).toBeUndefined();
  });

  it("treats whitespace-only HubSpot values as empty (still fills)", () => {
    const fills = buildEnrichmentFills(contact({ jobtitle: "   " }), apollo());
    expect(fills.find((f) => f.field === "jobtitle")).toBeDefined();
  });

  it("skips a field when Apollo's value is empty/whitespace", () => {
    const fills = buildEnrichmentFills(
      contact(),
      apollo({ first_name: "", last_name: "   " }),
    );
    expect(fills.find((f) => f.field === "firstname")).toBeUndefined();
    expect(fills.find((f) => f.field === "lastname")).toBeUndefined();
  });

  it("does NOT touch the email field even when Apollo has a different one", () => {
    const fills = buildEnrichmentFills(contact(), apollo({ email: "different@example.com" }));
    expect(fills.map((f) => f.field)).not.toContain("email");
  });

  it("phone fallback chain: mobile → phone_numbers → org.primary_phone", () => {
    // Mobile only
    let fills = buildEnrichmentFills(contact(), apollo());
    expect(fills.find((f) => f.field === "phone")?.after).toBe("+15551234567");
    // No mobile, has phone_numbers
    fills = buildEnrichmentFills(
      contact(),
      apollo({
        mobile_phone_number: null,
        phone_numbers: [{ sanitized_number: "+15559999999", type: "work" }],
      }),
    );
    expect(fills.find((f) => f.field === "phone")?.after).toBe("+15559999999");
    // No mobile, no phone_numbers, has org primary_phone
    fills = buildEnrichmentFills(
      contact(),
      apollo({
        mobile_phone_number: null,
        phone_numbers: [],
        organization: {
          name: "Bryce Glamp & Camp",
          primary_phone: { sanitized_number: "+18005551111" },
        },
      }),
    );
    expect(fills.find((f) => f.field === "phone")?.after).toBe("+18005551111");
  });

  it("each fill carries a non-empty audit reason", () => {
    const fills = buildEnrichmentFills(contact(), apollo());
    for (const f of fills) {
      expect(f.reason.length).toBeGreaterThan(3);
      expect(f.reason).toMatch(/^apollo\./);
    }
  });
});

describe("computeApolloMatchConfidence — heuristic score", () => {
  it("max confidence (1.0) for verified + unlocked + has org + has title", () => {
    const c = computeApolloMatchConfidence({
      verified: true,
      unlocked: true,
      hasOrg: true,
      hasTitle: true,
    });
    expect(c).toBeCloseTo(1.0, 5); // 0.5 + 0.2 + 0.1 + 0.1 + 0.1 = 1.0
  });

  it("base confidence (0.5) for nothing", () => {
    expect(
      computeApolloMatchConfidence({
        verified: false,
        unlocked: false,
        hasOrg: false,
        hasTitle: false,
      }),
    ).toBe(0.5);
  });

  it("verified alone bumps to 0.7", () => {
    expect(
      computeApolloMatchConfidence({
        verified: true,
        unlocked: false,
        hasOrg: false,
        hasTitle: false,
      }),
    ).toBe(0.7);
  });

  it("clamps to [0, 1]", () => {
    const c = computeApolloMatchConfidence({
      verified: true,
      unlocked: true,
      hasOrg: true,
      hasTitle: true,
    });
    expect(c).toBeLessThanOrEqual(1);
    expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe("buildEnrichmentProposal — full proposal", () => {
  it("hasChanges=true with fills + provenance when match is good", () => {
    const p = buildEnrichmentProposal({
      contact: contact(),
      apolloPerson: apollo(),
      apolloVerified: true,
      apolloUnlocked: true,
      retrievedAt: RETRIEVED_AT,
    });
    expect(p.hasChanges).toBe(true);
    expect(p.fills.length).toBe(7);
    expect(p.apolloPersonId).toBe("apollo-person-7");
    expect(p.source).toEqual({
      system: "apollo",
      personId: "apollo-person-7",
      retrievedAt: RETRIEVED_AT,
      queryEmail: "buyer@example.com",
    });
    expect(p.confidence).toBeGreaterThanOrEqual(0.8);
    expect(p.skipReasons).toEqual([]);
  });

  it("hasChanges=false when Apollo returned no match", () => {
    const p = buildEnrichmentProposal({
      contact: contact(),
      apolloPerson: null,
      apolloVerified: false,
      apolloUnlocked: false,
      retrievedAt: RETRIEVED_AT,
    });
    expect(p.hasChanges).toBe(false);
    expect(p.fills).toEqual([]);
    expect(p.apolloPersonId).toBeNull();
    expect(p.skipReasons).toEqual(["no apollo match"]);
    expect(p.confidence).toBe(0);
  });

  it("hasChanges=false when Apollo email is LOCKED (refuses to enrich)", () => {
    const p = buildEnrichmentProposal({
      contact: contact(),
      apolloPerson: apollo(),
      apolloVerified: true,
      apolloUnlocked: false, // locked
      retrievedAt: RETRIEVED_AT,
    });
    expect(p.hasChanges).toBe(false);
    expect(p.skipReasons).toEqual([
      "apollo email is locked — refusing to enrich from a locked record",
    ]);
    expect(p.confidence).toBe(0);
  });

  it("hasChanges=false when every contact field already populated", () => {
    const p = buildEnrichmentProposal({
      contact: contact({
        firstname: "Sarah",
        lastname: "McGowan",
        jobtitle: "Director of Retail",
        phone: "+15551234567",
        company: "Bryce Glamp & Camp",
        city: "Salt Lake City",
        state: "UT",
      }),
      apolloPerson: apollo(),
      apolloVerified: true,
      apolloUnlocked: true,
      retrievedAt: RETRIEVED_AT,
    });
    expect(p.hasChanges).toBe(false);
    expect(p.fills).toEqual([]);
    expect(p.skipReasons).toEqual([
      "all enrichable fields already populated, or apollo person had nothing new",
    ]);
  });

  it("source.queryEmail is lower-cased copy of contact.email", () => {
    const p = buildEnrichmentProposal({
      contact: contact({ email: "MIXED@CASE.COM" }),
      apolloPerson: null,
      apolloVerified: false,
      apolloUnlocked: false,
      retrievedAt: RETRIEVED_AT,
    });
    expect(p.source.queryEmail).toBe("mixed@case.com");
  });

  it("partial fills (some fields exist in HubSpot, others don't)", () => {
    const p = buildEnrichmentProposal({
      contact: contact({ firstname: "Sarah", phone: "+15551234567" }),
      apolloPerson: apollo(),
      apolloVerified: true,
      apolloUnlocked: true,
      retrievedAt: RETRIEVED_AT,
    });
    expect(p.hasChanges).toBe(true);
    expect(p.fills.map((f) => f.field).sort()).toEqual([
      "city",
      "company",
      "jobtitle",
      "lastname",
      "state",
    ]);
  });
});

describe("fillsToContactInput — projection helper", () => {
  it("maps proposal fills to ContactInput shape", () => {
    const p = buildEnrichmentProposal({
      contact: contact(),
      apolloPerson: apollo(),
      apolloVerified: true,
      apolloUnlocked: true,
      retrievedAt: RETRIEVED_AT,
    });
    const input = fillsToContactInput(p, "buyer@example.com");
    expect(input.email).toBe("buyer@example.com");
    expect(input.firstname).toBe("Sarah");
    expect(input.lastname).toBe("McGowan");
    expect(input.jobtitle).toBe("Director of Retail");
    expect(input.phone).toBe("+15551234567");
    expect(input.company).toBe("Bryce Glamp & Camp");
    expect(input.city).toBe("Salt Lake City");
    expect(input.state).toBe("UT");
  });

  it("only includes fields that are in the fills (no skipped fields)", () => {
    const p = buildEnrichmentProposal({
      contact: contact({ firstname: "Sarah", lastname: "McGowan" }),
      apolloPerson: apollo(),
      apolloVerified: true,
      apolloUnlocked: true,
      retrievedAt: RETRIEVED_AT,
    });
    const input = fillsToContactInput(p, "buyer@example.com");
    expect(input.firstname).toBeUndefined();
    expect(input.lastname).toBeUndefined();
    expect(input.jobtitle).toBe("Director of Retail");
  });
});
