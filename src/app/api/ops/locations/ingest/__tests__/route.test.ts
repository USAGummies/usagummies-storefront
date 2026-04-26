/**
 * Integration tests for /api/ops/locations/ingest.
 *
 * Locked contracts:
 *   - POST stages valid rows as drafts (status="needs_review").
 *   - POST returns row-level errors for invalid input.
 *   - POST/GET both 401 for unauthenticated traffic (auth gate active).
 *   - GET returns drafts grouped by status + the last-errors envelope.
 *   - The route NEVER writes to src/data/retailers.ts (proven by the
 *     Drafts module test; this test pins that the route uses
 *     ingestRows, which is what the Drafts module test guards).
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

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;

function makePostReq(body: unknown): Request {
  return new Request("http://localhost/api/ops/locations/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetReq(): Request {
  return new Request("http://localhost/api/ops/locations/ingest", {
    method: "GET",
  });
}

function fakeRow(overrides: Partial<RetailerLocation> = {}): Partial<RetailerLocation> {
  return {
    slug: "store-1",
    name: "Store 1",
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

beforeEach(() => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  mockedAuth.mockResolvedValue(true);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("auth gate", () => {
  it("POST 401 when unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { POST } = await import("../route");
    const res = await POST(makePostReq({ rows: [fakeRow()] }));
    expect(res.status).toBe(401);
  });
  it("GET 401 when unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
  });
});

describe("POST happy + validation paths", () => {
  it("valid rows return 201 with draftsCreated", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makePostReq({
        rows: [fakeRow({ slug: "a", name: "A" }), fakeRow({ slug: "b", name: "B" })],
        ingestSource: "test",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      draftsCreated: number;
      errors: unknown[];
      ingestSource: string;
    };
    expect(body.ok).toBe(true);
    expect(body.draftsCreated).toBe(2);
    expect(body.errors).toHaveLength(0);
    expect(body.ingestSource).toBe("test");
  });

  it("mix of valid + invalid → 207 Multi-Status with both", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makePostReq({
        rows: [
          fakeRow({ slug: "ok-1", name: "OK 1" }),
          { slug: "broken" } as Partial<RetailerLocation>,
        ],
      }),
    );
    expect(res.status).toBe(207);
    const body = (await res.json()) as {
      draftsCreated: number;
      errors: Array<{ rowIndex: number; code: string }>;
    };
    expect(body.draftsCreated).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].rowIndex).toBe(2);
    expect(body.errors[0].code).toBe("missing_required");
  });

  it("all invalid → 200 with errors[]; no drafts created", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makePostReq({
        rows: [
          { slug: "broken-1" } as Partial<RetailerLocation>,
          { slug: "broken-2" } as Partial<RetailerLocation>,
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draftsCreated: number;
      errors: unknown[];
    };
    expect(body.draftsCreated).toBe(0);
    expect(body.errors).toHaveLength(2);
  });

  it("400 when body.rows is missing or not an array", async () => {
    const { POST } = await import("../route");
    const res = await POST(makePostReq({}));
    expect(res.status).toBe(400);
  });

  it("400 on invalid JSON body", async () => {
    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/ops/locations/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("duplicate row in batch → 207 with one accepted + one duplicate error", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makePostReq({
        rows: [fakeRow({ slug: "wfm-pdx" }), fakeRow({ slug: "wfm-pdx" })],
      }),
    );
    expect(res.status).toBe(207);
    const body = (await res.json()) as {
      draftsCreated: number;
      errors: Array<{ code: string }>;
    };
    expect(body.draftsCreated).toBe(1);
    expect(body.errors[0].code).toBe("duplicate");
  });
});

describe("GET — grouped by status + last-errors", () => {
  it("empty queue returns zero counts + null lastErrors", async () => {
    const { GET } = await import("../route");
    const res = await GET(makeGetReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      totals: { needs_review: number; total: number };
      drafts: { needs_review: unknown[] };
      lastErrors: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.totals.total).toBe(0);
    expect(body.totals.needs_review).toBe(0);
    expect(body.lastErrors).toBeNull();
  });

  it("after a successful POST, GET returns the drafts grouped", async () => {
    const { POST, GET } = await import("../route");
    await POST(
      makePostReq({
        rows: [fakeRow({ slug: "a" }), fakeRow({ slug: "b" })],
        ingestSource: "test",
      }),
    );
    const res = await GET(makeGetReq());
    const body = (await res.json()) as {
      totals: {
        needs_review: number;
        accepted: number;
        rejected: number;
        total: number;
      };
      drafts: { needs_review: Array<{ slug: string; status: string }> };
      lastErrors: { errorCount: number } | null;
    };
    expect(body.totals.needs_review).toBe(2);
    expect(body.totals.total).toBe(2);
    expect(body.drafts.needs_review).toHaveLength(2);
    expect(body.drafts.needs_review[0].status).toBe("needs_review");
    expect(body.lastErrors?.errorCount).toBe(0);
  });
});
