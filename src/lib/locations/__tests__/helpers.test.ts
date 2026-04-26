/**
 * Tests for the Store Locator pure helpers.
 *
 * Locked contracts:
 *   - never throws on empty / null / undefined input
 *   - countStates dedups case-insensitively, ignores blanks
 *   - groupByState is stable + alphabetically sorted, preserves
 *     canonical casing from the first occurrence
 *   - normalizeStoreLocation refuses partial input (returns null
 *     rather than fabricating defaults)
 */
import { describe, expect, it } from "vitest";

import {
  countStates,
  countStores,
  groupByState,
  normalizeStoreLocation,
  type StoreLocation,
} from "../helpers";

function fakeStore(overrides: Partial<StoreLocation> = {}): StoreLocation {
  return {
    slug: "test-store",
    name: "Test Store",
    address: "1 Main St",
    cityStateZip: "Anywhere, ZZ 00000",
    state: "Washington",
    lat: 47.6,
    lng: -122.3,
    mapX: 100,
    mapY: 100,
    mapsUrl: "https://maps.google.com/?q=test",
    channel: "direct",
    storeType: "Grocery",
    ...overrides,
  };
}

describe("countStores", () => {
  it("returns 0 for null / undefined / empty array", () => {
    expect(countStores(null)).toBe(0);
    expect(countStores(undefined)).toBe(0);
    expect(countStores([])).toBe(0);
  });
  it("counts only valid records (defensive against malformed entries)", () => {
    const list: unknown[] = [
      fakeStore(),
      fakeStore({ slug: "x", name: "" }), // missing name → skipped
      null,
      fakeStore({ slug: "y", state: "Oregon" }),
    ];
    expect(countStores(list as StoreLocation[])).toBe(2);
  });
});

describe("countStates", () => {
  it("returns 0 on empty input", () => {
    expect(countStates([])).toBe(0);
    expect(countStates(null)).toBe(0);
  });
  it("dedups case-insensitively", () => {
    const list = [
      fakeStore({ slug: "a", state: "Washington" }),
      fakeStore({ slug: "b", state: "washington" }),
      fakeStore({ slug: "c", state: "WASHINGTON" }),
    ];
    expect(countStates(list)).toBe(1);
  });
  it("ignores blank state strings (a partial record never inflates)", () => {
    const list = [
      fakeStore({ slug: "a", state: "Oregon" }),
      fakeStore({ slug: "b", state: "" }),
      fakeStore({ slug: "c", state: "   " }),
    ];
    expect(countStates(list)).toBe(1);
  });
  it("counts distinct states", () => {
    const list = [
      fakeStore({ slug: "a", state: "Washington" }),
      fakeStore({ slug: "b", state: "Oregon" }),
      fakeStore({ slug: "c", state: "Idaho" }),
      fakeStore({ slug: "d", state: "Washington" }),
    ];
    expect(countStates(list)).toBe(3);
  });
});

describe("groupByState", () => {
  it("returns empty array on no input", () => {
    expect(groupByState([])).toEqual([]);
    expect(groupByState(null)).toEqual([]);
  });
  it("groups stores under each state and sorts states alphabetically", () => {
    const wa = fakeStore({ slug: "wa-1", state: "Washington" });
    const ny = fakeStore({ slug: "ny-1", state: "New York" });
    const ca = fakeStore({ slug: "ca-1", state: "California" });
    const groups = groupByState([wa, ny, ca]);
    expect(groups.map((g) => g.state)).toEqual([
      "California",
      "New York",
      "Washington",
    ]);
  });
  it("preserves canonical casing from the first occurrence", () => {
    const a = fakeStore({ slug: "a", state: "New York" });
    const b = fakeStore({ slug: "b", state: "new york" });
    const groups = groupByState([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].state).toBe("New York");
    expect(groups[0].stores).toHaveLength(2);
  });
  it("skips records missing name (defensive — never fabricates)", () => {
    const list = [
      fakeStore({ slug: "ok-1" }),
      fakeStore({ slug: "no-name", name: "" }),
    ];
    const groups = groupByState(list);
    expect(groups).toHaveLength(1);
    expect(groups[0].stores).toHaveLength(1);
  });
});

describe("normalizeStoreLocation", () => {
  it("returns null on null / undefined / non-object input", () => {
    expect(normalizeStoreLocation(null)).toBeNull();
    expect(normalizeStoreLocation(undefined)).toBeNull();
    expect(
      normalizeStoreLocation("not-an-object" as unknown as null),
    ).toBeNull();
  });
  it("returns null when any required string field is missing or blank", () => {
    const valid = fakeStore();
    const fields: Array<keyof StoreLocation> = [
      "slug",
      "name",
      "address",
      "cityStateZip",
      "state",
      "mapsUrl",
      "channel",
      "storeType",
    ];
    for (const f of fields) {
      const partial = { ...valid, [f]: "" };
      expect(normalizeStoreLocation(partial)).toBeNull();
    }
  });
  it("returns null on non-finite numerics (lat/lng/mapX/mapY)", () => {
    expect(
      normalizeStoreLocation({
        ...fakeStore(),
        lat: Number.NaN,
      }),
    ).toBeNull();
    expect(
      normalizeStoreLocation({
        ...fakeStore(),
        lng: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull();
  });
  it("returns null on unrecognized channel value", () => {
    expect(
      normalizeStoreLocation({
        ...fakeStore(),
        channel: "wholesale" as unknown as "direct",
      }),
    ).toBeNull();
  });
  it("trims string fields and drops blank optional fields", () => {
    const r = normalizeStoreLocation({
      ...fakeStore({
        slug: " test-store ",
        name: " Test Store ",
        website: "   ",
        note: "",
      }),
    });
    expect(r).not.toBeNull();
    expect(r!.slug).toBe("test-store");
    expect(r!.name).toBe("Test Store");
    expect(r!.website).toBeUndefined();
    expect(r!.note).toBeUndefined();
  });
  it("preserves valid optional fields", () => {
    const r = normalizeStoreLocation(
      fakeStore({
        website: "https://example.com",
        note: "Hand-stocked Tuesdays.",
      }),
    );
    expect(r).not.toBeNull();
    expect(r!.website).toBe("https://example.com");
    expect(r!.note).toBe("Hand-stocked Tuesdays.");
  });
  it("never fabricates a location for partial input", () => {
    // Empty object → null. The point: no defaults, no fake stores.
    expect(normalizeStoreLocation({})).toBeNull();
    expect(normalizeStoreLocation({ name: "Some Place" })).toBeNull();
  });
});

describe("no-data behavior across helpers", () => {
  it("all helpers handle [] without throwing or returning truthy counts", () => {
    expect(countStores([])).toBe(0);
    expect(countStates([])).toBe(0);
    expect(groupByState([])).toEqual([]);
  });
});
