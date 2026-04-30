/**
 * Coverage for `GET /api/ops/sales/stale-buyers`.
 *
 * The route wires `listRecentDeals()` (HubSpot) into
 * `summarizeStaleBuyers()` and returns the structured slice for chase-prep
 * tooling (`scripts/sales/chase-stale-buyers.mjs`).
 *
 * Tests pin:
 *   - Auth gate (401 unauthenticated).
 *   - Happy path: returns `summary.stalest[]` from a mocked HubSpot pull.
 *   - Fail-soft: HubSpot throwing → `degraded:true`, summary is null,
 *     route still returns 200 (NOT 500). Same fail-soft semantics as
 *     the daily-brief route.
 *   - No fabrication: degraded response carries an explicit
 *     degradedReasons[] entry — empty stalest[] is honest, not invented.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

vi.mock("@/lib/ops/hubspot-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ops/hubspot-client")>(
    "@/lib/ops/hubspot-client",
  );
  return {
    ...actual,
    listRecentDeals: vi.fn(),
  };
});

import * as authModule from "@/lib/ops/abra-auth";
import * as hubspotModule from "@/lib/ops/hubspot-client";

const mockedAuth = authModule.isAuthorized as unknown as ReturnType<typeof vi.fn>;
const mockedListDeals =
  hubspotModule.listRecentDeals as unknown as ReturnType<typeof vi.fn>;

function req(): Request {
  return new Request("http://localhost/api/ops/sales/stale-buyers");
}

const STAGE_CONTACTED = "3017718461"; // matches HUBSPOT_B2B_STAGES "Contacted"

function freshDeal(id: string, ageDays: number): {
  id: string;
  dealname: string;
  dealstage: string;
  lastmodifieddate: string;
} {
  const ageMs = ageDays * 86_400_000;
  return {
    id,
    dealname: `Test Co ${id}`,
    dealstage: STAGE_CONTACTED,
    lastmodifieddate: new Date(Date.now() - ageMs).toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuth.mockResolvedValue(true);
});

describe("GET /api/ops/sales/stale-buyers", () => {
  it("401s unauthenticated requests", async () => {
    mockedAuth.mockResolvedValueOnce(false);
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns structured stalest[] when HubSpot is reachable", async () => {
    mockedListDeals.mockResolvedValueOnce([
      freshDeal("d-fresh", 1), // not stale (Contacted threshold = 5d)
      freshDeal("d-old", 30), // very stale
      freshDeal("d-medium", 12), // stale
    ]);
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      summary: {
        stalest: Array<{ dealId: string; daysSinceActivity: number; stageName: string }>;
        activeDealsScanned: number;
      };
      degraded: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.summary.activeDealsScanned).toBe(3);
    // Only the two stale (>5d) appear in stalest[]; sorted oldest-first.
    expect(body.summary.stalest.length).toBe(2);
    expect(body.summary.stalest[0].dealId).toBe("d-old");
    expect(body.summary.stalest[1].dealId).toBe("d-medium");
  });

  it("returns empty stalest[] (not an invented one) when HubSpot returns no deals", async () => {
    mockedListDeals.mockResolvedValueOnce([]);
    const { GET } = await import("../route");
    const res = await GET(req());
    const body = (await res.json()) as {
      ok: boolean;
      summary: { stalest: unknown[]; activeDealsScanned: number };
    };
    expect(body.ok).toBe(true);
    expect(body.summary.stalest).toEqual([]);
    expect(body.summary.activeDealsScanned).toBe(0);
  });

  it("fail-soft on HubSpot error: 200 + degraded:true + summary null + reason populated", async () => {
    mockedListDeals.mockRejectedValueOnce(new Error("rate_limited"));
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200); // not 500 — fail-soft per route doctrine
    const body = (await res.json()) as {
      ok: boolean;
      summary: unknown;
      degraded: boolean;
      degradedReasons: string[];
    };
    expect(body.ok).toBe(false);
    expect(body.summary).toBeNull();
    expect(body.degraded).toBe(true);
    expect(body.degradedReasons[0]).toContain("hubspot-deals");
    expect(body.degradedReasons[0]).toContain("rate_limited");
  });

  it("clamps `?limit=` to [1,500] to defend against runaway HubSpot pulls", async () => {
    mockedListDeals.mockResolvedValueOnce([]);
    const { GET } = await import("../route");
    await GET(
      new Request("http://localhost/api/ops/sales/stale-buyers?limit=100000"),
    );
    expect(mockedListDeals).toHaveBeenCalledWith({ limit: 500 });

    mockedListDeals.mockClear();
    mockedListDeals.mockResolvedValueOnce([]);
    await GET(
      new Request("http://localhost/api/ops/sales/stale-buyers?limit=-5"),
    );
    expect(mockedListDeals).toHaveBeenCalledWith({ limit: 1 });
  });
});
