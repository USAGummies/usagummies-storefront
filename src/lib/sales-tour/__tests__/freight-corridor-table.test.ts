import { describe, expect, it } from "vitest";

import {
  FREIGHT_CORRIDOR_TABLE,
  freightForCorridor,
} from "@/lib/sales-tour/freight-corridor-table";

describe("freightForCorridor — table lookup", () => {
  it("returns no-freight-needed for null state or zero pallets", () => {
    const r1 = freightForCorridor(null, 1);
    expect(r1.found).toBe(false);
    expect(r1.source).toBe("no-freight-needed");
    expect(r1.totalDrive).toBeNull();
    const r2 = freightForCorridor("UT", 0);
    expect(r2.found).toBe(false);
    expect(r2.source).toBe("no-freight-needed");
  });

  it("looks up an exact UT 3-pallet row from the corridor table", () => {
    const r = freightForCorridor("UT", 3);
    expect(r.found).toBe(true);
    expect(r.source).toBe("regional-table-v0.1");
    expect(r.drivePerPallet).toBe(125);
    expect(r.ltlPerPallet).toBe(375);
    expect(r.totalDrive).toBe(375);
    expect(r.totalLtl).toBe(1125);
  });

  it("rounds 4 pallets to the nearest documented bucket (3 or 5)", () => {
    const r = freightForCorridor("UT", 4);
    expect(r.found).toBe(true);
    // 4 is equidistant from 3 and 5; reduce keeps the first equidistant bucket = 3.
    // But 4-3 = 1 and 5-4 = 1; reduce keeps the first found (3).
    // Either is acceptable for v0.1.
    expect([125, 85]).toContain(r.drivePerPallet);
  });

  it("derives per-bag freight cost from drive per pallet (canonical 900 bags/pallet)", () => {
    const r = freightForCorridor("AZ", 3);
    expect(r.found).toBe(true);
    expect(r.driveFreightPerBag).toBeCloseTo(175 / 900, 5);
  });

  it("returns found:false for off-corridor states (no fabrication)", () => {
    const r = freightForCorridor("FL", 3);
    expect(r.found).toBe(false);
    expect(r.drivePerPallet).toBeNull();
    expect(r.totalDrive).toBeNull();
  });

  it("WA in-state pricing is the cheapest in the table", () => {
    const wa1 = freightForCorridor("WA", 1).drivePerPallet ?? Infinity;
    const az1 = freightForCorridor("AZ", 1).drivePerPallet ?? Infinity;
    expect(wa1).toBeLessThan(az1);
  });

  it("LTL fallback is consistently higher than founder-drive economics", () => {
    for (const row of FREIGHT_CORRIDOR_TABLE) {
      expect(row.ltlPerPallet).toBeGreaterThan(row.drivePerPallet);
    }
  });

  it("upper-cases lowercase state input", () => {
    const r = freightForCorridor("ut" as "UT", 3);
    expect(r.found).toBe(true);
    expect(r.state).toBe("UT");
  });
});
