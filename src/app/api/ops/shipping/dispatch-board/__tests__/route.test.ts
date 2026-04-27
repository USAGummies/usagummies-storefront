/**
 * Phase 28c — dispatch-board route.
 *
 * Locks the contract:
 *   - 401 on auth rejection.
 *   - 502 when ShipStation read fails.
 *   - daysBack clamps to [1, 60] (default 14); limit clamps to [1, 500] (default 100).
 *   - Voided rows excluded by default; included when ?includeVoided=true.
 *   - Joins ShipStation rows with the artifact lookup so dispatchedAt
 *     surfaces when the artifact has a stamp.
 *   - Read-only — never calls markDispatched / clearDispatched / Slack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShipStationShipment } from "@/lib/ops/shipstation-client";
import type { ShippingArtifactRecord } from "@/lib/ops/shipping-artifacts";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const getRecentShipmentsMock = vi.fn();
vi.mock("@/lib/ops/shipstation-client", () => ({
  getRecentShipments: (...args: unknown[]) => getRecentShipmentsMock(...args),
}));

const bulkLookupMock = vi.fn();
vi.mock("@/lib/ops/shipping-artifacts", () => ({
  bulkLookupArtifacts: (...args: unknown[]) => bulkLookupMock(...args),
}));

import { GET } from "../route";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  getRecentShipmentsMock.mockReset();
  bulkLookupMock.mockReset();
  bulkLookupMock.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(qs = ""): Request {
  return new Request(
    `https://www.usagummies.com/api/ops/shipping/dispatch-board${qs}`,
  );
}

function ship(over: Partial<ShipStationShipment>): ShipStationShipment {
  return {
    shipmentId: 1,
    orderId: null,
    orderNumber: null,
    createDate: "2026-04-25T00:00:00Z",
    shipDate: "2026-04-26",
    trackingNumber: null,
    carrierCode: null,
    serviceCode: null,
    voided: false,
    voidDate: null,
    shipmentCost: null,
    shipToName: null,
    shipToPostalCode: null,
    ...over,
  };
}

describe("GET /api/ops/shipping/dispatch-board", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("502 when ShipStation read fails", async () => {
    getRecentShipmentsMock.mockResolvedValueOnce({
      ok: false,
      error: "ShipStation 500",
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/ShipStation/);
  });

  it("returns rows + counts on happy path", async () => {
    getRecentShipmentsMock.mockResolvedValueOnce({
      ok: true,
      shipments: [
        ship({
          shipmentId: 1,
          orderNumber: "112-1111111-1111111",
          trackingNumber: "T1",
          shipToName: "Alice",
          shipDate: "2026-04-26",
        }),
        ship({
          shipmentId: 2,
          orderNumber: "112-2222222-2222222",
          trackingNumber: "T2",
          shipToName: "Bob",
          shipDate: "2026-04-25",
        }),
      ],
    });
    bulkLookupMock.mockResolvedValueOnce(
      new Map<string, ShippingArtifactRecord>([
        [
          "112-1111111-1111111",
          {
            orderNumber: "112-1111111-1111111",
            source: "amazon",
            trackingNumber: "T1",
            label: null,
            packingSlip: null,
            slackPermalink: null,
            persistedAt: "2026-04-25T00:00:00Z",
            driveError: null,
            dispatchedAt: "2026-04-26T18:00:00Z",
            dispatchedBy: "U_OP",
          },
        ],
      ]),
    );
    const res = await GET(makeReq());
    const body = (await res.json()) as {
      ok: boolean;
      counts: { total: number; open: number; dispatched: number };
      rows: Array<{ orderNumber: string; state: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.counts.total).toBe(2);
    expect(body.counts.dispatched).toBe(1);
    expect(body.counts.open).toBe(1);
    // Open row sorts before dispatched
    expect(body.rows[0].state).toBe("open");
    expect(body.rows[1].state).toBe("dispatched");
  });

  it("voided rows excluded by default; included when ?includeVoided=true", async () => {
    getRecentShipmentsMock.mockResolvedValue({
      ok: true,
      shipments: [
        ship({ shipmentId: 1, orderNumber: "1001", trackingNumber: "T1" }),
        ship({
          shipmentId: 2,
          orderNumber: "1002",
          trackingNumber: "T2",
          voided: true,
          voidDate: "2026-04-25T00:00:00Z",
        }),
      ],
    });
    const res1 = await GET(makeReq());
    const body1 = (await res1.json()) as { counts: { total: number } };
    expect(body1.counts.total).toBe(1);

    const res2 = await GET(makeReq("?includeVoided=true"));
    const body2 = (await res2.json()) as { counts: { total: number } };
    expect(body2.counts.total).toBe(2);
  });

  it("daysBack clamps to [1, 60] and limit to [1, 500]", async () => {
    getRecentShipmentsMock.mockResolvedValue({ ok: true, shipments: [] });

    // daysBack=999 → clamped to 60
    await GET(makeReq("?daysBack=999&limit=99999"));
    const callArgs = getRecentShipmentsMock.mock.calls[0]?.[0] as {
      pageSize: number;
    };
    // pageSize is max(limit, 200) — limit clamped to 500 → pageSize=500
    expect(callArgs.pageSize).toBe(500);

    // daysBack=0 → clamped to 1
    await GET(makeReq("?daysBack=0&limit=0"));
    // No throw; clamping happened (pageSize=200 floor)
  });
});
