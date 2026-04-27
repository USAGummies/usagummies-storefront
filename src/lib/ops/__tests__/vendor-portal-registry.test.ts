/**
 * Phase 31.2.a — Vendor portal registry.
 *
 * Locks the contract:
 *   - Default registry is empty (no fabricated vendor metadata).
 *   - getVendorPortalEntry returns null for unregistered ids.
 *   - getVendorPortalEntry returns the matching entry for registered ids.
 *   - Empty / null vendorId → null (defensive).
 *   - listVendorPortalIds returns the ids in registration order.
 *   - Custom registry argument is respected (testability).
 */
import { describe, expect, it } from "vitest";

import {
  VENDOR_PORTAL_REGISTRY,
  getVendorPortalEntry,
  listVendorPortalIds,
  type VendorPortalEntry,
} from "../vendor-portal-registry";

describe("VENDOR_PORTAL_REGISTRY — registry sanity", () => {
  it("registry is empty by default — no fabricated vendor metadata", () => {
    expect(VENDOR_PORTAL_REGISTRY).toEqual([]);
  });
});

describe("getVendorPortalEntry", () => {
  it("returns null for an empty vendorId", () => {
    expect(getVendorPortalEntry("")).toBe(null);
  });

  it("returns null for an unregistered vendorId on the live registry", () => {
    expect(getVendorPortalEntry("powers-confections")).toBe(null);
    expect(getVendorPortalEntry("anything")).toBe(null);
  });

  it("returns the matching entry from a custom registry", () => {
    const fixture: VendorPortalEntry[] = [
      {
        vendorId: "powers-confections",
        displayName: "Powers Confections",
        coiDriveFolderId: null,
        defaultEmail: "ap@powersconfections.com",
      },
      {
        vendorId: "belmark",
        displayName: "Belmark Inc.",
        coiDriveFolderId: "1abc",
        defaultEmail: null,
      },
    ];
    const got = getVendorPortalEntry("belmark", fixture);
    expect(got).not.toBe(null);
    expect(got?.vendorId).toBe("belmark");
    expect(got?.displayName).toBe("Belmark Inc.");
    expect(got?.coiDriveFolderId).toBe("1abc");
  });

  it("returns null for a registered vendor when querying an unregistered id from the same fixture", () => {
    const fixture: VendorPortalEntry[] = [
      {
        vendorId: "powers-confections",
        displayName: "Powers Confections",
        coiDriveFolderId: null,
        defaultEmail: null,
      },
    ];
    expect(getVendorPortalEntry("belmark", fixture)).toBe(null);
  });

  it("vendorId match is exact (no substring / prefix matching)", () => {
    const fixture: VendorPortalEntry[] = [
      {
        vendorId: "powers-confections",
        displayName: "Powers",
        coiDriveFolderId: null,
        defaultEmail: null,
      },
    ];
    expect(getVendorPortalEntry("powers", fixture)).toBe(null);
    expect(getVendorPortalEntry("powers-confections-extra", fixture)).toBe(null);
    expect(getVendorPortalEntry("powers-confections", fixture)).not.toBe(null);
  });
});

describe("listVendorPortalIds", () => {
  it("returns empty array on empty registry", () => {
    expect(listVendorPortalIds()).toEqual([]);
  });

  it("returns ids in registration order", () => {
    const fixture: VendorPortalEntry[] = [
      {
        vendorId: "z-vendor",
        displayName: "Z",
        coiDriveFolderId: null,
        defaultEmail: null,
      },
      {
        vendorId: "a-vendor",
        displayName: "A",
        coiDriveFolderId: null,
        defaultEmail: null,
      },
    ];
    // Order matches the manifest, NOT alphabetical — operator
    // controls ordering, we don't re-sort behind their back.
    expect(listVendorPortalIds(fixture)).toEqual(["z-vendor", "a-vendor"]);
  });
});
