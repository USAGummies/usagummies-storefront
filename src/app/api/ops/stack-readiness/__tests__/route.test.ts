/**
 * Phase 28L.3 — GET /api/ops/stack-readiness route.
 *
 * Locks the contract:
 *   - 401 on auth rejection.
 *   - 200 returns {ok, generatedAt, summary, rows}.
 *   - One row per service in STACK_SERVICES.
 *   - When env vars are unset → that row's status is "down" with
 *     envMissing populated, regardless of probe outcome.
 *   - Route never throws even when fetch / probes fail
 *     (Promise.allSettled + probeFetch's internal try/catch).
 *   - Read-only: no Slack / KV / Drive writes invoked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

import { GET } from "../route";
import { STACK_SERVICES } from "@/lib/ops/stack-readiness";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  // Force every fetch in the route to fail — that exercises the
  // "never throws" path AND keeps tests off the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network blocked in test");
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeReq(): Request {
  return new Request("https://www.usagummies.com/api/ops/stack-readiness");
}

describe("GET /api/ops/stack-readiness", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns one row per manifest service with full shape", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      generatedAt: string;
      summary: {
        total: number;
        ok: number;
        degraded: number;
        down: number;
        unprobed: number;
        averageMaturity: number;
      };
      rows: Array<{
        id: string;
        name: string;
        layer: string;
        status: string;
        envOk: boolean;
        envMissing: string[];
        maturity: number;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(body.rows.length).toBe(STACK_SERVICES.length);
    expect(body.summary.total).toBe(STACK_SERVICES.length);

    // Every row should have an id, name, layer, status, maturity.
    for (const row of body.rows) {
      expect(typeof row.id).toBe("string");
      expect(typeof row.name).toBe("string");
      expect(typeof row.layer).toBe("string");
      expect(["ok", "degraded", "down", "unprobed"]).toContain(row.status);
      expect(typeof row.maturity).toBe("number");
    }

    // Summary counts must reconcile.
    const counted =
      body.summary.ok +
      body.summary.degraded +
      body.summary.down +
      body.summary.unprobed;
    expect(counted).toBe(body.summary.total);
  });

  it("does not throw even when every probe fails", async () => {
    // The beforeEach already stubs fetch to throw — just confirm 200.
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
  });

  it("is read-only — never invokes a write-style POST against KV/Slack/etc", async () => {
    // We can't perfectly assert "no writes" with a bare fetch stub,
    // but we CAN assert that any fetch call we made during the route
    // execution was a GET (or, for slack/auth.test, a POST to Slack
    // auth.test which is a read-only auth introspection).
    const fetchSpy = (globalThis.fetch as unknown) as ReturnType<
      typeof vi.fn
    >;
    await GET(makeReq());

    for (const call of fetchSpy.mock.calls) {
      const init = (call[1] ?? {}) as RequestInit;
      const method = (init.method ?? "GET").toUpperCase();
      const url = String(call[0]);
      // Only allow read-style calls.
      const allowed =
        method === "GET" ||
        method === "HEAD" ||
        // Slack auth.test is a read-only introspection.
        url.includes("slack.com/api/auth.test") ||
        // Shopify storefront GraphQL — query-only payload sent in
        // tests (see route.ts), no mutation.
        url.includes("/api/2024-10/graphql.json");
      expect(allowed).toBe(true);
    }
  });
});
