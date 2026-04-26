/**
 * Tests for `resolveHubSpotContactIdForInvite`.
 *
 * Locked contracts:
 *   - Operator-pasted hubspotContactId is preferred when present.
 *   - Empty / whitespace hubspotContactId triggers the email lookup.
 *   - When HubSpot is unconfigured (no token), no network call is made
 *     and the helper returns null.
 *   - Email lookup errors fail soft (return null, not throw).
 *   - **Never creates a HubSpot contact.** No upsert / POST call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveHubSpotContactIdForInvite } from "../hubspot-mirror";

beforeEach(() => {
  // Default: HubSpot configured. Individual tests opt out by deleting.
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = "test-hs-token";
});

afterEach(() => {
  delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  vi.clearAllMocks();
});

describe("resolveHubSpotContactIdForInvite — operator-pasted id wins", () => {
  it("returns the pasted id verbatim and does NOT call findImpl", async () => {
    const findImpl = vi.fn(async () => "should-not-be-used");
    const id = await resolveHubSpotContactIdForInvite(
      { hubspotContactId: "12345", email: "buyer@x.com" },
      { findImpl: findImpl as never },
    );
    expect(id).toBe("12345");
    expect(findImpl).not.toHaveBeenCalled();
  });

  it("trims whitespace around a pasted id", async () => {
    const findImpl = vi.fn();
    const id = await resolveHubSpotContactIdForInvite(
      { hubspotContactId: "  98765  ", email: "buyer@x.com" },
      { findImpl: findImpl as never },
    );
    expect(id).toBe("98765");
    expect(findImpl).not.toHaveBeenCalled();
  });
});

describe("resolveHubSpotContactIdForInvite — email lookup fallback", () => {
  it("falls back to findImpl when hubspotContactId is undefined", async () => {
    const findImpl = vi.fn(async () => "found-via-email-1");
    const id = await resolveHubSpotContactIdForInvite(
      { email: "buyer@x.com" },
      { findImpl: findImpl as never },
    );
    expect(id).toBe("found-via-email-1");
    expect(findImpl).toHaveBeenCalledWith("buyer@x.com");
  });

  it("falls back to findImpl when hubspotContactId is empty string", async () => {
    const findImpl = vi.fn(async () => "found-via-email-2");
    const id = await resolveHubSpotContactIdForInvite(
      { hubspotContactId: "", email: "buyer@x.com" },
      { findImpl: findImpl as never },
    );
    expect(id).toBe("found-via-email-2");
  });

  it("returns null when findImpl returns null (no contact for that email)", async () => {
    const findImpl = vi.fn(async () => null);
    const id = await resolveHubSpotContactIdForInvite(
      { email: "unknown@x.com" },
      { findImpl: findImpl as never },
    );
    expect(id).toBeNull();
  });

  it("returns null when findImpl throws (fail-soft)", async () => {
    const findImpl = vi.fn(async () => {
      throw new Error("HubSpot 502");
    });
    const id = await resolveHubSpotContactIdForInvite(
      { email: "buyer@x.com" },
      { findImpl: findImpl as never },
    );
    expect(id).toBeNull();
  });
});

describe("resolveHubSpotContactIdForInvite — unconfigured HubSpot", () => {
  it("returns null without calling findImpl when HUBSPOT_PRIVATE_APP_TOKEN is unset", async () => {
    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const findImpl = vi.fn(async () => "should-not-be-called");
    const id = await resolveHubSpotContactIdForInvite(
      { email: "buyer@x.com" },
      { findImpl: findImpl as never },
    );
    expect(id).toBeNull();
    expect(findImpl).not.toHaveBeenCalled();
  });

  it("STILL returns the pasted id even when HubSpot is unconfigured (no network needed)", async () => {
    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const findImpl = vi.fn();
    const id = await resolveHubSpotContactIdForInvite(
      { hubspotContactId: "55555", email: "buyer@x.com" },
      { findImpl: findImpl as never },
    );
    // The pasted id is operator-curated and doesn't need a HubSpot
    // round-trip to be valid. Returning it is correct even when the
    // token is missing — the eventual logEmail() call will be the one
    // that no-ops (it also short-circuits on missing token).
    expect(id).toBe("55555");
    expect(findImpl).not.toHaveBeenCalled();
  });
});

describe("resolveHubSpotContactIdForInvite — input edge cases", () => {
  it("returns null when both hubspotContactId and email are missing", async () => {
    const id = await resolveHubSpotContactIdForInvite({
      email: "",
    });
    expect(id).toBeNull();
  });

  it("does not call findImpl when email is whitespace-only", async () => {
    const findImpl = vi.fn();
    const id = await resolveHubSpotContactIdForInvite(
      { email: "   " },
      { findImpl: findImpl as never },
    );
    expect(id).toBeNull();
    expect(findImpl).not.toHaveBeenCalled();
  });
});
