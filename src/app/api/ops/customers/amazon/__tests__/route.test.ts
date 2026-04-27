/**
 * Phase 28k — GET /api/ops/customers/amazon route.
 *
 * Locks the contract:
 *   - 401 on auth rejection.
 *   - default sortBy=lastSeen, limit clamps to [1,500] default 100.
 *   - repeatOnly=true narrows to orderCount > 1.
 *   - response shape: {ok, generatedAt, counts, customers}
 *   - read-only — never writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const listMock = vi.fn();
vi.mock("@/lib/ops/amazon-customers", () => ({
  listAmazonCustomers: (...a: unknown[]) => listMock(...a),
  summarizeAmazonCustomers: (records: unknown[]) => ({
    total: records.length,
    repeat: 0,
    oneAndDone: records.length,
    totalOrders: records.length,
    totalBags: records.length,
    totalRevenueUsd: 0,
  }),
}));

import { GET } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  listMock.mockReset();
  listMock.mockResolvedValue([]);
});

afterEach(() => vi.clearAllMocks());

function makeReq(qs = ""): Request {
  return new Request(
    `https://www.usagummies.com/api/ops/customers/amazon${qs}`,
  );
}

describe("GET /api/ops/customers/amazon", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("default params: sortBy=lastSeen, limit=100, repeatOnly=false", async () => {
    await GET(makeReq());
    const args = listMock.mock.calls[0][0];
    expect(args).toEqual({ limit: 100, sortBy: "lastSeen", repeatOnly: false });
  });

  it("respects sortBy from query", async () => {
    await GET(makeReq("?sortBy=orderCount"));
    expect(listMock.mock.calls[0][0].sortBy).toBe("orderCount");

    listMock.mockClear();
    await GET(makeReq("?sortBy=totalRevenue"));
    expect(listMock.mock.calls[0][0].sortBy).toBe("totalRevenue");
  });

  it("falls back to lastSeen on unknown sortBy", async () => {
    await GET(makeReq("?sortBy=garbage"));
    expect(listMock.mock.calls[0][0].sortBy).toBe("lastSeen");
  });

  it("limit clamps to [1, 500]", async () => {
    await GET(makeReq("?limit=999"));
    expect(listMock.mock.calls[0][0].limit).toBe(500);

    listMock.mockClear();
    await GET(makeReq("?limit=0"));
    expect(listMock.mock.calls[0][0].limit).toBe(1);

    listMock.mockClear();
    await GET(makeReq("?limit=garbage"));
    expect(listMock.mock.calls[0][0].limit).toBe(100);
  });

  it("repeatOnly=true is forwarded to the helper", async () => {
    await GET(makeReq("?repeatOnly=true"));
    expect(listMock.mock.calls[0][0].repeatOnly).toBe(true);
  });

  it("returns shape: {ok, generatedAt, counts, customers}", async () => {
    listMock.mockResolvedValueOnce([
      {
        fingerprint: "ann molak|02806",
        shipToName: "ann (Molak)",
        shipToCity: "Barrington",
        shipToState: "RI",
        shipToPostalCode: "02806-5034",
        firstSeenAt: "2026-04-27T14:00:00Z",
        lastSeenAt: "2026-04-27T14:00:00Z",
        orderCount: 1,
        totalBags: 1,
        totalRevenueUsd: 6.41,
        totalShippingCostUsd: 6.95,
        recentOrders: [],
      },
    ]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      generatedAt: string;
      counts: { total: number };
      customers: Array<{ fingerprint: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.counts.total).toBe(1);
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].fingerprint).toBe("ann molak|02806");
  });
});
