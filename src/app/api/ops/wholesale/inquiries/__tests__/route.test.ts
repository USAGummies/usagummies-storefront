/**
 * Integration tests for GET /api/ops/wholesale/inquiries.
 *
 * Locks the Phase 6 contract:
 *   - 401 when isAuthorized rejects (auth-gated).
 *   - 200 with `{ ok:true, total, recent: [...] }` when KV has data.
 *   - 200 with `{ ok:true, total: 0, recent: [] }` when KV reachable but empty.
 *   - 500 (NOT 200 with total:0) when KV throws — no fabricated zero.
 *   - `limit` query param is server-clamped to [1, 500].
 *   - The route does NOT import HubSpot or QBO modules — locked by
 *     a static-source assertion alongside the existing readers'
 *     no-pipeline-as-revenue rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const store = new Map<string, unknown>();
let kvShouldThrow = false;

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => {
      if (kvShouldThrow) throw new Error("ECONNREFUSED");
      return store.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

import { GET } from "../route";
import { appendWholesaleInquiry } from "@/lib/wholesale/inquiries";

beforeEach(() => {
  store.clear();
  kvShouldThrow = false;
  isAuthorizedMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(path = "/api/ops/wholesale/inquiries"): Request {
  return new Request(`https://www.usagummies.com${path}`, { method: "GET" });
}

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe("auth gate", () => {
  it("401 when isAuthorized returns false", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("calls isAuthorized with the request (session OR CRON_SECRET path)", async () => {
    isAuthorizedMock.mockResolvedValueOnce(true);
    await GET(makeReq());
    expect(isAuthorizedMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("authorized read", () => {
  beforeEach(() => {
    isAuthorizedMock.mockResolvedValue(true);
  });

  it("returns total:0 + recent:[] when archive is empty (real source-attested zero)", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      total: number;
      recent: unknown[];
      lastSubmittedAt: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.total).toBe(0);
    expect(body.recent).toEqual([]);
    expect(body.lastSubmittedAt).toBeNull();
  });

  it("returns total + recent when archive has entries", async () => {
    await appendWholesaleInquiry({ email: "a@x.com" });
    await appendWholesaleInquiry({ email: "b@x.com" });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      recent: Array<{ email: string }>;
    };
    expect(body.total).toBe(2);
    expect(body.recent).toHaveLength(2);
    expect(body.recent[0].email).toBe("b@x.com"); // most-recent first
  });

  it("clamps limit query param to [1, 500]", async () => {
    for (let i = 0; i < 60; i++) {
      await appendWholesaleInquiry({ email: `r${i}@x.com` });
    }
    const lo = await GET(makeReq("/api/ops/wholesale/inquiries?limit=0"));
    const hi = await GET(makeReq("/api/ops/wholesale/inquiries?limit=999999"));
    const negative = await GET(makeReq("/api/ops/wholesale/inquiries?limit=-5"));
    const loBody = (await lo.json()) as { recent: unknown[] };
    const hiBody = (await hi.json()) as { recent: unknown[] };
    const negBody = (await negative.json()) as { recent: unknown[] };
    expect(loBody.recent.length).toBeGreaterThanOrEqual(1);
    expect(hiBody.recent.length).toBeLessThanOrEqual(500);
    expect(negBody.recent.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Error path — never fabricates zero
// ---------------------------------------------------------------------------

describe("KV exception path", () => {
  beforeEach(() => {
    isAuthorizedMock.mockResolvedValue(true);
  });

  it("returns 500 with reason when KV throws (NOT 200 with total:0)", async () => {
    kvShouldThrow = true;
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string; reason: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("kv_read_failed");
    expect(body.reason).toContain("ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------
// Static-source assertions (drift guard)
// ---------------------------------------------------------------------------

describe("read-only / no forbidden imports", () => {
  it("the route module imports nothing from HubSpot or QBO helpers", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../route.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["'].*hubspot/);
    expect(src).not.toMatch(/from\s+["'].*qbo/);
    // The route is GET-only — no POST / PUT / DELETE / PATCH exports.
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|DELETE|PATCH)/);
  });
});
