/**
 * Integration tests for PATCH /api/ops/locations/ingest/[slug].
 *
 * Locked contracts:
 *   - 401 unauthenticated PATCH
 *   - 200 status update; review note persists; corrections that pass
 *     normalize succeed
 *   - 422 invalid_status / validation_failed
 *   - 404 unknown slug
 *   - 400 empty patch / invalid JSON
 *   - public RETAILERS array is unaffected by every successful update
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

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
import * as authModule from "@/lib/ops/abra-auth";
import type { RetailerLocation } from "@/data/retailers";
import { RETAILERS } from "@/data/retailers";
import { ingestRows } from "@/lib/locations/drafts";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;

function fakeRow(overrides: Partial<RetailerLocation> = {}): Partial<RetailerLocation> {
  return {
    slug: "abc",
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

function makePatch(slug: string, body: unknown): Request {
  return new Request(
    `http://localhost/api/ops/locations/ingest/${slug}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function makeGet(slug: string): Request {
  return new Request(
    `http://localhost/api/ops/locations/ingest/${slug}`,
    { method: "GET" },
  );
}

function ctx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  mockedAuth.mockResolvedValue(true);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

async function seedDraft(slug = "abc") {
  await ingestRows([fakeRow({ slug })], { now: new Date("2026-04-26T12:00:00Z") });
}

describe("auth gate", () => {
  it("PATCH 401 when unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    await seedDraft();
    const { PATCH } = await import("../route");
    const res = await PATCH(makePatch("abc", { status: "accepted" }), ctx("abc"));
    expect(res.status).toBe(401);
  });

  it("GET 401 when unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(makeGet("abc"), ctx("abc"));
    expect(res.status).toBe(401);
  });
});

describe("PATCH happy paths", () => {
  it("status update returns 200 with updated draft", async () => {
    await seedDraft();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch("abc", {
        status: "accepted",
        reviewedBy: "rene@usagummies.com",
      }),
      ctx("abc"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      draft: { status: string; reviewedAt?: string; reviewedBy?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.draft.status).toBe("accepted");
    expect(body.draft.reviewedAt).toBeTruthy();
    expect(body.draft.reviewedBy).toBe("rene@usagummies.com");
  });

  it("review note persists across updates", async () => {
    await seedDraft();
    const { PATCH } = await import("../route");
    const r1 = await PATCH(
      makePatch("abc", { reviewNote: "Confirmed pricing." }),
      ctx("abc"),
    );
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as {
      draft: { reviewNote?: string };
    };
    expect(body1.draft.reviewNote).toBe("Confirmed pricing.");
  });

  it("valid field correction returns 200 and persists", async () => {
    await seedDraft();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch("abc", {
        fieldCorrections: { state: "Oregon" },
      }),
      ctx("abc"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { state: string } };
    expect(body.draft.state).toBe("Oregon");
  });

  it("slug-changing field correction is silently dropped", async () => {
    await seedDraft();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch("abc", {
        fieldCorrections: { slug: "renamed" },
        reviewNote: "force a write",
      }),
      ctx("abc"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { slug: string } };
    expect(body.draft.slug).toBe("abc");
  });
});

describe("PATCH error paths", () => {
  it("invalid_status → 422 with stable code", async () => {
    await seedDraft();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch("abc", { status: "totally-bogus" }),
      ctx("abc"),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_status");
  });

  it("validation_failed (correction breaks normalize) → 422", async () => {
    await seedDraft();
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch("abc", { fieldCorrections: { name: "" } }),
      ctx("abc"),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("unknown slug → 404", async () => {
    const { PATCH } = await import("../route");
    const res = await PATCH(
      makePatch("ghost", { status: "accepted" }),
      ctx("ghost"),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });

  it("empty patch → 400 no_changes", async () => {
    await seedDraft();
    const { PATCH } = await import("../route");
    const res = await PATCH(makePatch("abc", {}), ctx("abc"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("no_changes");
  });

  it("invalid JSON body → 400", async () => {
    await seedDraft();
    const { PATCH } = await import("../route");
    const req = new Request(
      "http://localhost/api/ops/locations/ingest/abc",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
    );
    const res = await PATCH(req, ctx("abc"));
    expect(res.status).toBe(400);
  });
});

describe("public RETAILERS untouched across review actions", () => {
  it("accepted update never adds the slug to RETAILERS", async () => {
    await seedDraft("future-publish");
    const { PATCH } = await import("../route");
    await PATCH(makePatch("future-publish", { status: "accepted" }), ctx("future-publish"));
    expect(RETAILERS.find((r) => r.slug === "future-publish")).toBeUndefined();
  });

  it("rejected update never adds the slug to RETAILERS", async () => {
    await seedDraft("rejected-1");
    const { PATCH } = await import("../route");
    await PATCH(makePatch("rejected-1", { status: "rejected" }), ctx("rejected-1"));
    expect(RETAILERS.find((r) => r.slug === "rejected-1")).toBeUndefined();
  });

  it("RETAILERS JSON is byte-identical before and after a full review cycle", async () => {
    const before = JSON.stringify(RETAILERS);
    await seedDraft("cycle");
    const { PATCH } = await import("../route");
    await PATCH(
      makePatch("cycle", { status: "accepted", reviewNote: "ok" }),
      ctx("cycle"),
    );
    await PATCH(
      makePatch("cycle", {
        fieldCorrections: { storeType: "Specialty" },
      }),
      ctx("cycle"),
    );
    await PATCH(
      makePatch("cycle", { status: "rejected", reviewNote: "later" }),
      ctx("cycle"),
    );
    expect(JSON.stringify(RETAILERS)).toBe(before);
  });
});

describe("GET single draft", () => {
  it("returns the draft when slug exists", async () => {
    await seedDraft();
    const { GET } = await import("../route");
    const res = await GET(makeGet("abc"), ctx("abc"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { slug: string } };
    expect(body.draft.slug).toBe("abc");
  });
  it("404 when slug missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(makeGet("ghost"), ctx("ghost"));
    expect(res.status).toBe(404);
  });
});
