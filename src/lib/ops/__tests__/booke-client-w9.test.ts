/**
 * Booke W-9 list helpers — coverage.
 *
 * Pins:
 *   - isBookeConfigured() returns false when token absent, true when present
 *   - Each list helper returns NOT_CONFIGURED when token absent (configured=false)
 *   - Happy path: parses Booke's transactions/accounts/vendors response
 *   - HTTP non-2xx → returns reason with status code
 *   - Fetch throw → returns reason with thrown message
 *   - unwrapOrEmpty returns data on ok, [] on error
 *   - Token never leaks into reason strings
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isBookeConfigured,
  listAccounts,
  listToReviewTransactions,
  listVendors,
  unwrapOrEmpty,
  type BookeReadResult,
} from "../booke-client";

const TOKEN = "live-token-secret";

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isBookeConfigured", () => {
  it("returns false when token is absent / empty", () => {
    vi.stubEnv("BOOKE_API_TOKEN", "");
    expect(isBookeConfigured()).toBe(false);
  });
  it("returns true when token is set", () => {
    vi.stubEnv("BOOKE_API_TOKEN", TOKEN);
    expect(isBookeConfigured()).toBe(true);
  });
});

describe("not-configured branch", () => {
  beforeEach(() => {
    vi.stubEnv("BOOKE_API_TOKEN", "");
  });

  it.each([
    ["listToReviewTransactions", listToReviewTransactions],
    ["listAccounts", listAccounts],
    ["listVendors", listVendors],
  ] as const)("%s returns configured=false when token absent", async (_name, fn) => {
    const r = await fn();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.configured).toBe(false);
      expect(r.reason).toMatch(/BOOKE_API_TOKEN not configured/);
    }
  });
});

describe("list helpers — happy path", () => {
  beforeEach(() => {
    vi.stubEnv("BOOKE_API_TOKEN", TOKEN);
  });

  it("listToReviewTransactions parses { transactions: [...] }", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transactions: [
          {
            id: "t-1",
            date: "2026-05-01",
            vendor: "Albanese",
            amount: 100,
            description: "ingredient",
            suggestedCategory: "500015 COGS",
            suggestedConfidence: 0.9,
            source: "BoA",
          },
        ],
      }),
    });
    const r = await listToReviewTransactions({
      limit: 25,
      fetchImpl: fetchImpl as never,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].id).toBe("t-1");
    }
    // limit param surfaces in the URL
    const callUrl = fetchImpl.mock.calls[0][0];
    expect(callUrl).toContain("limit=25");
    expect(callUrl).toContain("status=queued,pending_review");
  });

  it("listAccounts parses { accounts: [...] }", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accounts: [
          {
            id: "a-1",
            name: "BoA Checking",
            qboAccountNumber: "100015",
            type: "bank",
          },
        ],
      }),
    });
    const r = await listAccounts({ fetchImpl: fetchImpl as never });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data[0].name).toBe("BoA Checking");
  });

  it("listVendors parses { vendors: [...] }", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        vendors: [{ id: "v-1", name: "Albanese", qboVendorId: "32" }],
      }),
    });
    const r = await listVendors({ fetchImpl: fetchImpl as never });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data[0].qboVendorId).toBe("32");
  });

  it("response missing `transactions` field still returns ok with empty array", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const r = await listToReviewTransactions({
      fetchImpl: fetchImpl as never,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual([]);
  });
});

describe("list helpers — failure paths", () => {
  beforeEach(() => {
    vi.stubEnv("BOOKE_API_TOKEN", TOKEN);
  });

  it("HTTP non-2xx returns configured=true + reason with status code", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const r = await listToReviewTransactions({
      fetchImpl: fetchImpl as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.configured).toBe(true);
      expect(r.reason).toMatch(/Booke API 500/);
    }
  });

  it("fetch throw returns reason with thrown message", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("network-down"));
    const r = await listAccounts({ fetchImpl: fetchImpl as never });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.configured).toBe(true);
      expect(r.reason).toMatch(/network-down/);
    }
  });

  it("auth header carries the token (not visible in reason on success)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accounts: [] }),
    });
    await listAccounts({ fetchImpl: fetchImpl as never });
    const init = fetchImpl.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("token never appears in error reason strings", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"));
    const a = await listToReviewTransactions({ fetchImpl: fetchImpl as never });
    const b = await listAccounts({ fetchImpl: fetchImpl as never });
    const c = await listVendors({ fetchImpl: fetchImpl as never });
    for (const r of [a, b, c]) {
      if (!r.ok) expect(r.reason).not.toContain(TOKEN);
    }
  });
});

describe("unwrapOrEmpty", () => {
  it("returns data on ok", () => {
    const r: BookeReadResult<number[]> = {
      ok: true,
      configured: true,
      data: [1, 2, 3],
    };
    expect(unwrapOrEmpty(r)).toEqual([1, 2, 3]);
  });
  it("returns [] when not configured", () => {
    const r: BookeReadResult<number[]> = {
      ok: false,
      configured: false,
      reason: "BOOKE_API_TOKEN not configured",
    };
    expect(unwrapOrEmpty(r)).toEqual([]);
  });
  it("returns [] when configured but errored", () => {
    const r: BookeReadResult<number[]> = {
      ok: false,
      configured: true,
      reason: "x",
    };
    expect(unwrapOrEmpty(r)).toEqual([]);
  });
});
