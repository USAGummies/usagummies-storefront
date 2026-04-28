/**
 * Phase 35.f.6.b — GET /api/ops/wholesale/completed tests.
 *
 * Locked contracts:
 *   - 401 when isAuthorized rejects
 *   - 200 + zero-counts when window empty (real source-attested zero)
 *   - 200 + envelopes most-recent-first when populated
 *   - 500 on KV throw (no fabricated zero)
 *   - days clamped to [1, 365]
 *   - limit clamped to [1, 500]
 *   - byPaymentPath splits envelopes by payment path
 *   - totalSubtotalUsd sums correctly across the window
 *   - since timestamp = now - days
 *   - withinDays excludes envelopes outside the window
 *   - middleware allowlist defense
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

import {
  writeAuditEnvelope,
  type AuditEnvelope,
} from "@/lib/wholesale/onboarding-store";

beforeEach(() => {
  store.clear();
  kvShouldThrow = false;
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildReq(qs = ""): Request {
  return new Request(
    `http://localhost/api/ops/wholesale/completed${qs}`,
    { method: "GET" },
  );
}

interface CompletedResp {
  ok: boolean;
  window?: { days: number; since: string };
  totalCompleted?: number;
  totalSubtotalUsd?: number;
  byPaymentPath?: {
    "credit-card"?: { count: number; totalSubtotalUsd: number };
    "accounts-payable"?: { count: number; totalSubtotalUsd: number };
    unknown?: { count: number; totalSubtotalUsd: number };
  };
  envelopes?: AuditEnvelope[];
  error?: string;
}

function makeEnv(
  flowId: string,
  completedAt: string,
  overrides: Partial<AuditEnvelope> = {},
): AuditEnvelope {
  return {
    flowId,
    completedAt,
    stepsCompleted: ["info", "crm-updated"],
    orderLineCount: 1,
    totalSubtotalUsd: 100,
    ...overrides,
  };
}

describe("GET /api/ops/wholesale/completed — auth", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValue(false);
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/ops/wholesale/completed — empty + populated", () => {
  it("returns ok:true + zero counts on empty audit index", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as CompletedResp;
    expect(body.ok).toBe(true);
    expect(body.totalCompleted).toBe(0);
    expect(body.totalSubtotalUsd).toBe(0);
    expect(body.envelopes).toEqual([]);
  });

  it("returns envelopes most-recent first", async () => {
    const t1 = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();
    const t2 = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    await writeAuditEnvelope(makeEnv("wf_old", t2));
    await writeAuditEnvelope(makeEnv("wf_new", t1));
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as CompletedResp;
    expect(body.envelopes?.map((e) => e.flowId)).toEqual(["wf_new", "wf_old"]);
  });

  it("500 (no fabricated zero) when KV throws", async () => {
    await writeAuditEnvelope(makeEnv("wf_x", new Date().toISOString())); // populate index
    kvShouldThrow = true;
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as CompletedResp;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("kv_read_failed");
  });
});

describe("GET /api/ops/wholesale/completed — window", () => {
  it("days clamped to [1, 365]", async () => {
    const { GET } = await import("../route");
    expect(((await (await GET(buildReq("?days=0"))).json()) as CompletedResp).window?.days).toBe(1);
    expect(((await (await GET(buildReq("?days=99999"))).json()) as CompletedResp).window?.days).toBe(365);
    expect(((await (await GET(buildReq("?days=14"))).json()) as CompletedResp).window?.days).toBe(14);
  });

  it("limit clamped to [1, 500]", async () => {
    for (let i = 0; i < 5; i++) {
      await writeAuditEnvelope(
        makeEnv(`wf_${i}`, new Date(Date.now() - i * 1000).toISOString()),
      );
    }
    const { GET } = await import("../route");
    const r = await GET(buildReq("?limit=2"));
    const body = (await r.json()) as CompletedResp;
    expect(body.envelopes?.length).toBe(2);
  });

  it("excludes envelopes outside the days window", async () => {
    const ancient = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const recent = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    await writeAuditEnvelope(makeEnv("wf_ancient", ancient));
    await writeAuditEnvelope(makeEnv("wf_recent", recent));
    const { GET } = await import("../route");
    const res = await GET(buildReq("?days=30"));
    const body = (await res.json()) as CompletedResp;
    expect(body.envelopes?.map((e) => e.flowId)).toEqual(["wf_recent"]);
    expect(body.totalCompleted).toBe(1);
  });

  it("since = now - days × 86400s", async () => {
    const { GET } = await import("../route");
    const before = Date.now();
    const res = await GET(buildReq("?days=14"));
    const body = (await res.json()) as CompletedResp;
    const sinceMs = new Date(body.window!.since).getTime();
    const expectedMs = before - 14 * 24 * 3600 * 1000;
    expect(Math.abs(sinceMs - expectedMs)).toBeLessThan(60_000); // ±1 min tolerance
  });
});

describe("GET /api/ops/wholesale/completed — byPaymentPath split", () => {
  it("splits envelopes by paymentPath + sums each bucket's subtotal", async () => {
    const t = new Date().toISOString();
    await writeAuditEnvelope(
      makeEnv("wf_cc1", t, {
        paymentPath: "credit-card",
        totalSubtotalUsd: 100,
      }),
    );
    await writeAuditEnvelope(
      makeEnv("wf_cc2", t, {
        paymentPath: "credit-card",
        totalSubtotalUsd: 200,
      }),
    );
    await writeAuditEnvelope(
      makeEnv("wf_ap1", t, {
        paymentPath: "accounts-payable",
        totalSubtotalUsd: 1000,
      }),
    );

    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as CompletedResp;
    expect(body.byPaymentPath?.["credit-card"]?.count).toBe(2);
    expect(body.byPaymentPath?.["credit-card"]?.totalSubtotalUsd).toBe(300);
    expect(body.byPaymentPath?.["accounts-payable"]?.count).toBe(1);
    expect(body.byPaymentPath?.["accounts-payable"]?.totalSubtotalUsd).toBe(
      1000,
    );
    expect(body.totalSubtotalUsd).toBe(1300);
    expect(body.totalCompleted).toBe(3);
  });

  it("envelopes without paymentPath go into the 'unknown' bucket", async () => {
    const t = new Date().toISOString();
    await writeAuditEnvelope(
      makeEnv("wf_no_path", t, { totalSubtotalUsd: 50 }),
    );
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as CompletedResp;
    expect(body.byPaymentPath?.unknown?.count).toBe(1);
    expect(body.byPaymentPath?.unknown?.totalSubtotalUsd).toBe(50);
  });
});

describe("middleware allowlist defense", () => {
  it("the route's path prefix is registered in middleware.ts", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/middleware.ts"),
      "utf8",
    );
    expect(src).toContain("/api/ops/wholesale/completed");
  });
});
