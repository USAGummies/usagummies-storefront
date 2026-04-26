/**
 * Integration tests for /api/ops/faire/direct-invites.
 *
 * Locked contracts:
 *   - 401 unauthenticated POST + GET.
 *   - POST 201 on all-valid; 207 on mixed; 200 on all-errors; 400 on
 *     missing/non-array body or invalid JSON.
 *   - GET returns invites grouped by status + degraded flag.
 *   - When FAIRE_ACCESS_TOKEN is missing, GET sets degraded=true with
 *     a reason. Queue ingest still works.
 *   - No external send happens — only KV is mocked; any other side
 *     effect (Gmail/Slack/Faire) would crash uninstrumented.
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
import type { FaireInviteCandidate } from "@/lib/faire/invites";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;

function fakeRow(
  overrides: Partial<FaireInviteCandidate> = {},
): Partial<FaireInviteCandidate> {
  return {
    retailerName: "Test Retailer",
    email: "buyer@retailer.com",
    source: "wholesale-page",
    ...overrides,
  };
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/ops/faire/direct-invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function getReq(): Request {
  return new Request("http://localhost/api/ops/faire/direct-invites", {
    method: "GET",
  });
}

beforeEach(() => {
  (kv as unknown as { __store: Map<string, unknown> }).__store.clear();
  mockedAuth.mockResolvedValue(true);
  delete process.env.FAIRE_ACCESS_TOKEN;
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.FAIRE_ACCESS_TOKEN;
  vi.clearAllMocks();
});

describe("auth gate", () => {
  it("POST 401 unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { POST } = await import("../route");
    const res = await POST(postReq({ rows: [fakeRow()] }));
    expect(res.status).toBe(401);
  });
  it("GET 401 unauthenticated", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });
});

describe("POST happy + validation", () => {
  it("all-valid → 201", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        rows: [
          fakeRow({ email: "a@x.com" }),
          fakeRow({ email: "b@x.com", retailerName: "B Co" }),
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { queued: number; errors: unknown[] };
    expect(body.queued).toBe(2);
    expect(body.errors).toHaveLength(0);
  });

  it("mixed → 207", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        rows: [
          fakeRow({ email: "ok@x.com" }),
          fakeRow({ email: "bad" }),
        ],
      }),
    );
    expect(res.status).toBe(207);
    const body = (await res.json()) as {
      queued: number;
      errors: Array<{ rowIndex: number; code: string }>;
    };
    expect(body.queued).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].rowIndex).toBe(2);
    expect(body.errors[0].code).toBe("validation_failed");
  });

  it("all-errors → 200 with errors[]", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        rows: [{ email: "bad" }, { retailerName: "" }],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: number; errors: unknown[] };
    expect(body.queued).toBe(0);
    expect(body.errors).toHaveLength(2);
  });

  it("400 on missing rows", async () => {
    const { POST } = await import("../route");
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });

  it("400 on invalid JSON", async () => {
    const { POST } = await import("../route");
    const req = new Request(
      "http://localhost/api/ops/faire/direct-invites",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("duplicate email within batch → 207 (1 queued + 1 duplicate error)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postReq({
        rows: [
          fakeRow({ email: "buyer@x.com" }),
          fakeRow({ email: "buyer@x.com" }),
        ],
      }),
    );
    expect(res.status).toBe(207);
    const body = (await res.json()) as {
      queued: number;
      errors: Array<{ code: string }>;
    };
    expect(body.queued).toBe(1);
    expect(body.errors[0].code).toBe("duplicate");
  });
});

describe("GET — grouped + degraded flag", () => {
  it("empty queue + missing FAIRE_ACCESS_TOKEN → degraded=true with reason", async () => {
    delete process.env.FAIRE_ACCESS_TOKEN;
    const { GET } = await import("../route");
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      degraded: boolean;
      degradedReason: string | null;
      totals: { total: number };
    };
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.degradedReason).toMatch(/FAIRE_ACCESS_TOKEN/);
    expect(body.totals.total).toBe(0);
  });

  it("FAIRE_ACCESS_TOKEN set → degraded=false, reason=null", async () => {
    process.env.FAIRE_ACCESS_TOKEN = "test-token";
    const { GET } = await import("../route");
    const res = await GET(getReq());
    const body = (await res.json()) as {
      degraded: boolean;
      degradedReason: string | null;
    };
    expect(body.degraded).toBe(false);
    expect(body.degradedReason).toBeNull();
    delete process.env.FAIRE_ACCESS_TOKEN;
  });

  it("groups invites by status after a successful POST", async () => {
    const { POST, GET } = await import("../route");
    await POST(
      postReq({
        rows: [
          fakeRow({ email: "a@x.com" }),
          fakeRow({ email: "b@x.com" }),
        ],
      }),
    );
    const res = await GET(getReq());
    const body = (await res.json()) as {
      totals: {
        needs_review: number;
        approved: number;
        sent: number;
        rejected: number;
        total: number;
      };
      invites: { needs_review: Array<{ status: string }> };
    };
    expect(body.totals.needs_review).toBe(2);
    expect(body.totals.total).toBe(2);
    expect(body.invites.needs_review).toHaveLength(2);
    expect(body.invites.needs_review[0].status).toBe("needs_review");
  });
});

describe("Phase 1 invariant — no sends", () => {
  it("ingest writes ONLY to KV (any other network call would crash uninstrumented)", async () => {
    const { POST } = await import("../route");
    const before = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await POST(postReq({ rows: [fakeRow({ email: "x@x.com" })] }));
    const after = (kv.set as unknown as ReturnType<typeof vi.fn>).mock.calls
      .length;
    // 1 record + 1 index = 2 KV writes.
    expect(after - before).toBe(2);
  });
});
