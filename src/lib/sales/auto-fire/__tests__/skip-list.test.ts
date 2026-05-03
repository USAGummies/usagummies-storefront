/**
 * Tests for the auto-fire skip-list. KV is mocked in-memory so we can
 * verify the cooldown semantics without a real Vercel KV.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kvStore = new Map<string, { value: unknown; expiresAt: number | null }>();

function mockClock(): () => number {
  let now = Date.parse("2026-05-03T12:00:00Z");
  return () => now;
}

let now = mockClock();

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => {
      const entry = kvStore.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt < now()) {
        kvStore.delete(key);
        return null;
      }
      return entry.value;
    }),
    set: vi.fn(
      async (
        key: string,
        value: unknown,
        opts?: { ex?: number },
      ) => {
        const expiresAt = opts?.ex ? now() + opts.ex * 1000 : null;
        kvStore.set(key, { value, expiresAt });
        return "OK";
      },
    ),
  },
}));

import {
  markNudged,
  wasNudgedRecently,
  __INTERNAL_FOR_TESTS,
} from "../skip-list";

beforeEach(() => {
  kvStore.clear();
  now = mockClock();
  vi.clearAllMocks();
});

afterEach(() => {
  kvStore.clear();
});

describe("auto-fire skip-list", () => {
  it("returns false for an unmarked buyer", async () => {
    const r = await wasNudgedRecently("reorder-offer", "vicki@example.com");
    expect(r).toBe(false);
  });

  it("markNudged + wasNudgedRecently round-trips", async () => {
    await markNudged("reorder-offer", "vicki@example.com");
    expect(
      await wasNudgedRecently("reorder-offer", "vicki@example.com"),
    ).toBe(true);
  });

  it("normalizes email (case-insensitive + trimmed)", async () => {
    await markNudged("reorder-offer", "  Vicki@Example.com  ");
    expect(
      await wasNudgedRecently("reorder-offer", "vicki@example.com"),
    ).toBe(true);
  });

  it("kind isolation — sample-touch-2 doesn't read reorder-offer marker", async () => {
    await markNudged("reorder-offer", "vicki@example.com");
    expect(
      await wasNudgedRecently("sample-touch-2", "vicki@example.com"),
    ).toBe(false);
  });

  it("each kind has its own cooldown TTL", () => {
    const ttls = __INTERNAL_FOR_TESTS.COOLDOWN_TTL_SECONDS;
    expect(ttls["reorder-offer"]).toBe(30 * 24 * 3600);
    expect(ttls["sample-touch-2"]).toBe(21 * 24 * 3600);
    expect(ttls["onboarding-nudge"]).toBe(7 * 24 * 3600);
  });

  it("skipKey shape is stable and includes the kind + normalized email", () => {
    const k = __INTERNAL_FOR_TESTS.skipKey(
      "reorder-offer",
      "Vicki@Example.com",
    );
    expect(k).toBe("auto-fire-nudges:skip:reorder-offer:vicki@example.com");
  });
});
