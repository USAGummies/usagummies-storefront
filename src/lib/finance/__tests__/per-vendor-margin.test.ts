import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parsePercentRange,
  parsePerVendorMarginLedger,
  parseUsdRange,
  slugifyVendorName,
} from "../per-vendor-margin";

const CONTRACT = readFileSync(
  join(process.cwd(), "contracts/per-vendor-margin-ledger.md"),
  "utf8",
);

describe("per-vendor margin ledger parser", () => {
  it("parses the actual ledger status and version", () => {
    const ledger = parsePerVendorMarginLedger(CONTRACT);
    expect(ledger.status).toContain("CANONICAL");
    expect(ledger.version).toBe("v0.1");
  });

  it("parses committed vendor sections without inventing missing numbers", () => {
    const ledger = parsePerVendorMarginLedger(CONTRACT);
    expect(ledger.committedVendors).toHaveLength(6);
    const redDog = ledger.committedVendors.find((v) =>
      v.name.includes("Red Dog Saloon"),
    );
    expect(redDog).toBeDefined();
    expect(redDog?.pricePerBagUsd).toBeNull();
    expect(redDog?.fields["$/bag effective"]?.needsActual).toBe(true);
    expect(redDog?.marginAlert).toBe("unknown");
  });

  it("extracts Thanksgiving Point economics from the committed table", () => {
    const ledger = parsePerVendorMarginLedger(CONTRACT);
    const thanksgiving = ledger.committedVendors.find((v) =>
      v.slug.includes("thanksgiving-point"),
    );
    expect(thanksgiving?.pricePerBagUsd).toBe(3.49);
    expect(thanksgiving?.operatingCogsUsd).toBe(1.79);
    expect(thanksgiving?.freightPerBagUsd).toEqual({ min: 0.1, max: 0.3 });
    expect(thanksgiving?.gpPerBagUsd).toEqual({ min: 1.4, max: 1.4 });
    expect(thanksgiving?.gpPct).toEqual({ min: 40, max: 40 });
    expect(thanksgiving?.marginAlert).toBe("healthy");
  });

  it("flags thin or negative distributor economics", () => {
    const ledger = parsePerVendorMarginLedger(CONTRACT);
    const inderbitzin = ledger.committedVendors.find((v) =>
      v.name.includes("Inderbitzin"),
    );
    expect(inderbitzin?.pricePerBagUsd).toBe(2.1);
    expect(inderbitzin?.gpPerBagUsd).toEqual({ min: -0.07, max: 0.13 });
    expect(inderbitzin?.gpPct).toEqual({ min: -3, max: 6 });
    expect(inderbitzin?.marginAlert).toBe("below_floor");
  });

  it("parses channel rows and preserves NEG as below-floor instead of a number", () => {
    const ledger = parsePerVendorMarginLedger(CONTRACT);
    expect(ledger.channelRows.length).toBeGreaterThanOrEqual(10);
    const fbm = ledger.channelRows.find((row) =>
      row.channel.includes("Amazon FBM"),
    );
    expect(fbm?.gpPerBag).toContain("NEG");
    expect(fbm?.marginAlert).toBe("below_floor");
  });

  it("parses pending vendors as context rows", () => {
    const ledger = parsePerVendorMarginLedger(CONTRACT);
    const bucees = ledger.pendingVendors.find((row) =>
      row.vendor.includes("Buc-ee"),
    );
    expect(bucees).toMatchObject({
      stage: "Pricing pushback — held",
      likelyTierOnCommit: "TBD — Path A/B/C decision pending",
    });
  });

  it("returns empty arrays for a partial or unrelated document", () => {
    const ledger = parsePerVendorMarginLedger("# Empty\n\nNo tables here.");
    expect(ledger.status).toBeNull();
    expect(ledger.version).toBeNull();
    expect(ledger.committedVendors).toEqual([]);
    expect(ledger.channelRows).toEqual([]);
    expect(ledger.pendingVendors).toEqual([]);
  });

  it("normalizes slugs deterministically", () => {
    expect(slugifyVendorName("Mike Hippler / Thanksgiving Point")).toBe(
      "mike-hippler-thanksgiving-point",
    );
  });

  it("parses USD and percent ranges defensively", () => {
    expect(parseUsdRange("$0.20-$0.40")).toEqual({ min: 0.2, max: 0.4 });
    expect(parseUsdRange("-$0.07 to $0.13")).toEqual({
      min: -0.07,
      max: 0.13,
    });
    expect(parseUsdRange("TBD")).toBeNull();
    expect(parsePercentRange("-3% to 6% GP")).toEqual({ min: -3, max: 6 });
  });

  it("has no forbidden runtime integrations", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/finance/per-vendor-margin.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/qbo-client|hubspot-client|fetchShopify|gmail-reader|slack-client/i);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
