import { describe, expect, it } from "vitest";

import {
  ENRICHABLE_FIELDS,
  missingFieldsForContact,
  summarizeEnrichmentOpportunities,
} from "@/lib/sales/enrichment-opportunities";

const NOW = new Date("2026-04-30T15:00:00.000Z");
const RETRIEVED = NOW.toISOString();

describe("missingFieldsForContact", () => {
  it("returns all 7 fields when none are populated", () => {
    const r = missingFieldsForContact({});
    expect(r.length).toBe(ENRICHABLE_FIELDS.length);
    expect(r).toEqual(expect.arrayContaining(["firstname", "lastname", "jobtitle", "phone", "company", "city", "state"]));
  });

  it("returns empty array when every field is populated", () => {
    const r = missingFieldsForContact({
      firstname: "Sarah",
      lastname: "M",
      jobtitle: "Director",
      phone: "+15551234567",
      company: "Acme",
      city: "SLC",
      state: "UT",
    });
    expect(r).toEqual([]);
  });

  it("treats empty/whitespace strings as missing", () => {
    const r = missingFieldsForContact({
      firstname: "",
      lastname: "   ",
      jobtitle: "Director",
    });
    expect(r).toContain("firstname");
    expect(r).toContain("lastname");
    expect(r).not.toContain("jobtitle");
  });

  it("treats null as missing", () => {
    const r = missingFieldsForContact({
      firstname: null,
      lastname: "Real",
    });
    expect(r).toContain("firstname");
    expect(r).not.toContain("lastname");
  });
});

describe("summarizeEnrichmentOpportunities", () => {
  it("empty input → all-zero summary", () => {
    const r = summarizeEnrichmentOpportunities([], NOW, RETRIEVED);
    expect(r.scanned).toBe(0);
    expect(r.missingAny).toBe(0);
    expect(r.perField).toEqual([]);
    expect(r.source).toEqual({ system: "hubspot", retrievedAt: RETRIEVED });
  });

  it("excludes contacts without email from the scanned count", () => {
    const r = summarizeEnrichmentOpportunities(
      [
        { id: "c1", properties: { email: "buyer@x.com" } },
        { id: "c2", properties: {} }, // no email — excluded
        { id: "c3", properties: { email: "   " } }, // whitespace email — excluded
      ],
      NOW,
      RETRIEVED,
    );
    expect(r.scanned).toBe(1);
  });

  it("counts contacts with at least one missing field correctly", () => {
    const r = summarizeEnrichmentOpportunities(
      [
        { id: "c1", properties: { email: "a@x.com" } }, // missing all 7
        { id: "c2", properties: { email: "b@x.com", firstname: "B", lastname: "C", jobtitle: "D", phone: "p", company: "co", city: "ct", state: "st" } }, // fully populated
        { id: "c3", properties: { email: "c@x.com", firstname: "C" } }, // missing 6
      ],
      NOW,
      RETRIEVED,
    );
    expect(r.scanned).toBe(3);
    expect(r.missingAny).toBe(2); // c1 + c3
  });

  it("perField counts each missing field across contacts", () => {
    const r = summarizeEnrichmentOpportunities(
      [
        { id: "c1", properties: { email: "a@x.com", firstname: "A" } }, // jobtitle, phone, company, city, state, lastname missing
        { id: "c2", properties: { email: "b@x.com", phone: "p" } }, // firstname, lastname, jobtitle, company, city, state missing
        { id: "c3", properties: { email: "c@x.com", jobtitle: "J", phone: "p" } }, // firstname, lastname, company, city, state missing
      ],
      NOW,
      RETRIEVED,
    );
    const byField = Object.fromEntries(r.perField.map((p) => [p.field, p.count]));
    expect(byField.firstname).toBe(2); // c2 + c3
    expect(byField.lastname).toBe(3); // all
    expect(byField.jobtitle).toBe(2); // c1 + c2
    expect(byField.phone).toBe(1); // c1
    expect(byField.company).toBe(3);
    expect(byField.city).toBe(3);
    expect(byField.state).toBe(3);
  });

  it("perField sorts by count desc then alphabetically", () => {
    const r = summarizeEnrichmentOpportunities(
      [
        { id: "c1", properties: { email: "a@x.com" } },
        { id: "c2", properties: { email: "b@x.com" } },
      ],
      NOW,
      RETRIEVED,
    );
    // All 7 fields missing on both → all 7 have count=2 → alphabetical order.
    expect(r.perField.map((p) => p.field)).toEqual([
      "city",
      "company",
      "firstname",
      "jobtitle",
      "lastname",
      "phone",
      "state",
    ]);
  });

  it("perField excludes fields with zero misses", () => {
    const r = summarizeEnrichmentOpportunities(
      [
        { id: "c1", properties: { email: "a@x.com", firstname: "A", lastname: "B", jobtitle: "C", phone: "P", company: "Co", city: "Ct", state: "St" } }, // fully populated
        { id: "c2", properties: { email: "b@x.com", lastname: "B", jobtitle: "C", phone: "P", company: "Co", city: "Ct", state: "St" } }, // missing firstname only
      ],
      NOW,
      RETRIEVED,
    );
    expect(r.perField).toEqual([{ field: "firstname", count: 1 }]);
  });
});
