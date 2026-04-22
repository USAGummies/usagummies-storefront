/**
 * compliance-doctrine.ts tests — [FALLBACK] list shape + render.
 */
import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_DOCTRINE,
  renderComplianceDoctrineFallback,
} from "../compliance-doctrine";

describe("COMPLIANCE_DOCTRINE", () => {
  it("has entries across all 7 categories", () => {
    const cats = new Set(COMPLIANCE_DOCTRINE.map((o) => o.category));
    for (const expected of [
      "corporate",
      "tax",
      "trademark",
      "fda",
      "insurance",
      "license",
      "contracts",
    ]) {
      expect(cats.has(expected as (typeof COMPLIANCE_DOCTRINE)[number]["category"])).toBe(true);
    }
  });

  it("every entry has a non-empty title + dateSource + action", () => {
    for (const o of COMPLIANCE_DOCTRINE) {
      expect(o.title).not.toBe("");
      expect(o.dateSource).not.toBe("");
      expect(o.action).not.toBe("");
    }
  });

  it("owners are one of Ben | Rene | Drew | Counsel", () => {
    const validOwners = new Set(["Ben", "Rene", "Drew", "Counsel"]);
    for (const o of COMPLIANCE_DOCTRINE) {
      expect(validOwners.has(o.owner)).toBe(true);
    }
  });

  it("cadences are one of annual | biennial | quarterly | one-time | variable", () => {
    const valid = new Set([
      "annual",
      "biennial",
      "quarterly",
      "one-time",
      "variable",
    ]);
    for (const o of COMPLIANCE_DOCTRINE) {
      expect(valid.has(o.cadence)).toBe(true);
    }
  });

  it("IDs are unique", () => {
    const ids = new Set<string>();
    for (const o of COMPLIANCE_DOCTRINE) {
      expect(ids.has(o.id)).toBe(false);
      ids.add(o.id);
    }
  });
});

describe("renderComplianceDoctrineFallback", () => {
  it("includes the reason passed in", () => {
    const out = renderComplianceDoctrineFallback("test reason");
    expect(out).toContain("test reason");
  });

  it("tags every obligation line with [FALLBACK]", () => {
    const out = renderComplianceDoctrineFallback("x");
    const lines = out.split("\n").filter((l) => l.includes("•"));
    for (const line of lines) {
      expect(line).toContain("[FALLBACK]");
    }
  });

  it("groups rows by category", () => {
    const out = renderComplianceDoctrineFallback("x");
    expect(out).toContain("*Corporate (WY):*");
    expect(out).toContain("*Tax (Federal + WA):*");
    expect(out).toContain("*Trademark (USPTO):*");
    expect(out).toContain("*FDA:*");
  });

  it("includes the no-fabrication reminder", () => {
    const out = renderComplianceDoctrineFallback("x");
    expect(out).toContain("not authoritative");
  });

  it("includes every doctrine entry's title", () => {
    const out = renderComplianceDoctrineFallback("x");
    for (const o of COMPLIANCE_DOCTRINE) {
      expect(out).toContain(o.title);
    }
  });
});
