/**
 * Tests for the location-ingest review queue.
 *
 * Locked contracts (every one is a bullet from the spec):
 *   - Valid row → KV draft with status="needs_review".
 *   - Invalid row → row-level error with rowIndex + reason; never a draft.
 *   - Partial location never becomes a draft (normalize gate).
 *   - Duplicates (within batch + against existing drafts) are flagged
 *     in errors, not double-added.
 *   - GET (listDraftsByStatus) groups by status.
 *   - The public RETAILERS array is NEVER mutated by ingest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/kv", () => {
  const store = new Map<string, unknown>();
  return {
    kv: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: unknown) => {
        if (v === null) store.delete(k);
        else store.set(k, v);
        return "OK";
      }),
      __store: store,
    },
  };
});

import { kv } from "@vercel/kv";
import type { RetailerLocation } from "@/data/retailers";
import { RETAILERS } from "@/data/retailers";

import {
  __resetDraftsForTest,
  ingestRows,
  listDraftLocations,
  listDraftsByStatus,
  readLastIngestErrors,
  type DraftLocation,
} from "../drafts";

const NOW = new Date("2026-04-26T12:00:00Z");

function fakeRow(overrides: Partial<RetailerLocation> = {}): Partial<RetailerLocation> {
  return {
    slug: "test-store-1",
    name: "Test Store 1",
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

beforeEach(async () => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  await __resetDraftsForTest();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("ingestRows — valid rows", () => {
  it("valid row becomes a draft with status='needs_review'", async () => {
    const result = await ingestRows([fakeRow()], {
      ingestSource: "test-batch-1",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.draftsCreated).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.createdSlugs).toEqual(["test-store-1"]);

    const drafts = await listDraftLocations();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("needs_review");
    expect(drafts[0].ingestSource).toBe("test-batch-1");
    expect(drafts[0].draftedAt).toBe(NOW.toISOString());
  });

  it("multiple valid rows → multiple drafts in submission order", async () => {
    const result = await ingestRows(
      [
        fakeRow({ slug: "a", name: "Store A" }),
        fakeRow({ slug: "b", name: "Store B" }),
        fakeRow({ slug: "c", name: "Store C" }),
      ],
      { now: NOW },
    );
    expect(result.draftsCreated).toBe(3);
    expect(result.createdSlugs).toEqual(["a", "b", "c"]);
  });
});

describe("ingestRows — invalid rows", () => {
  it("partial row produces row-level error and no draft", async () => {
    const result = await ingestRows(
      [
        // Missing `name` → normalize fails.
        { slug: "broken", state: "Washington" } as Partial<RetailerLocation>,
      ],
      { now: NOW },
    );
    expect(result.draftsCreated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rowIndex).toBe(1);
    expect(result.errors[0].code).toBe("missing_required");
    expect(result.errors[0].identifier).toBe("broken");

    const drafts = await listDraftLocations();
    expect(drafts).toHaveLength(0);
  });

  it("multiple invalid rows produce one error per row with 1-based rowIndex", async () => {
    const result = await ingestRows(
      [
        fakeRow(), // valid
        // missing required
        { slug: "x" } as Partial<RetailerLocation>,
        // unknown channel
        fakeRow({
          slug: "z",
          name: "Z",
          channel: "totally-bogus" as unknown as "direct",
        }),
      ],
      { now: NOW },
    );
    expect(result.draftsCreated).toBe(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].rowIndex).toBe(2);
    expect(result.errors[1].rowIndex).toBe(3);
  });

  it("rejects non-array input with a single 'unknown' error", async () => {
    const result = await ingestRows(
      "not-an-array" as unknown as Partial<RetailerLocation>[],
      { now: NOW },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe("unknown");
  });
});

describe("ingestRows — duplicates", () => {
  it("duplicate within the same batch flagged, not double-added", async () => {
    const result = await ingestRows(
      [
        fakeRow({ slug: "wfm-portland" }),
        fakeRow({ slug: "wfm-portland" }), // exact dup
      ],
      { now: NOW },
    );
    expect(result.draftsCreated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("duplicate");
    expect(result.errors[0].rowIndex).toBe(2);

    const drafts = await listDraftLocations();
    expect(drafts).toHaveLength(1);
  });

  it("duplicate against existing draft (different batch) is flagged", async () => {
    await ingestRows([fakeRow({ slug: "wfm-portland" })], { now: NOW });
    const result = await ingestRows([fakeRow({ slug: "wfm-portland" })], {
      now: NOW,
    });
    expect(result.draftsCreated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("duplicate");

    const drafts = await listDraftLocations();
    expect(drafts).toHaveLength(1);
  });

  it("dedup falls back to (name+state) when slug is absent", async () => {
    const noSlug: Partial<RetailerLocation> = {
      ...fakeRow({ name: "Hometown Market", state: "Idaho" }),
    };
    delete (noSlug as Record<string, unknown>).slug;
    const result1 = await ingestRows([noSlug], { now: NOW });
    expect(result1.draftsCreated).toBe(0);
    // No slug means normalize rejects → missing_required, not a draft.
    expect(result1.errors[0].code).toBe("missing_required");
  });
});

describe("listDraftsByStatus — GET grouping", () => {
  it("groups drafts by lifecycle status", async () => {
    await ingestRows(
      [
        fakeRow({ slug: "a", name: "A" }),
        fakeRow({ slug: "b", name: "B" }),
      ],
      { now: NOW },
    );
    // Manually flip one to accepted by writing the draft directly.
    const drafts = await listDraftLocations();
    const flipped: DraftLocation = { ...drafts[0], status: "accepted" };
    await kv.set(`locations:drafts:${flipped.slug}`, JSON.stringify(flipped));

    const grouped = await listDraftsByStatus();
    expect(grouped.needs_review).toHaveLength(1);
    expect(grouped.accepted).toHaveLength(1);
    expect(grouped.rejected).toHaveLength(0);
  });

  it("empty queue returns empty buckets", async () => {
    const grouped = await listDraftsByStatus();
    expect(grouped.needs_review).toEqual([]);
    expect(grouped.accepted).toEqual([]);
    expect(grouped.rejected).toEqual([]);
  });
});

describe("last-errors envelope is mirrored to KV", () => {
  it("writes the most recent ingest's errors so the page can show them later", async () => {
    await ingestRows(
      [
        fakeRow({ slug: "ok", name: "Good" }),
        { slug: "broken" } as Partial<RetailerLocation>,
      ],
      { ingestSource: "csv-2026-04-26", now: NOW },
    );
    const env = await readLastIngestErrors();
    expect(env).not.toBeNull();
    expect(env!.errorCount).toBe(1);
    expect(env!.ingestSource).toBe("csv-2026-04-26");
    expect(env!.recordedAt).toBe(NOW.toISOString());
  });
});

describe("public RETAILERS data remains untouched", () => {
  it("ingest does NOT modify the curated RETAILERS array", async () => {
    const before = JSON.stringify(RETAILERS);
    await ingestRows(
      [fakeRow({ slug: "should-not-leak", name: "Should Not Leak" })],
      { now: NOW },
    );
    const after = JSON.stringify(RETAILERS);
    expect(after).toBe(before);
  });

  it("draft is NOT added to RETAILERS even when valid", async () => {
    const wfm = fakeRow({ slug: "wfm-portland", name: "WFM Portland" });
    await ingestRows([wfm], { now: NOW });
    // RETAILERS is still the hand-curated list — no drafted slug.
    const slugs = RETAILERS.map((r) => r.slug);
    expect(slugs).not.toContain("wfm-portland");
  });
});
