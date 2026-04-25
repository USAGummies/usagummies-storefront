/**
 * recent-labels response is enriched with artifact metadata
 * (label/packing-slip Drive links + Slack permalink) when KV has it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: vi.fn(async () => true),
}));

const getRecentMock = vi.fn();
vi.mock("@/lib/ops/shipstation-client", () => ({
  getRecentShipments: getRecentMock,
}));

const bulkLookupMock = vi.fn();
vi.mock("@/lib/ops/shipping-artifacts", () => ({
  bulkLookupArtifacts: bulkLookupMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/ops/fulfillment/recent-labels", () => {
  it("merges Drive label + packing slip + Slack permalink into the response", async () => {
    getRecentMock.mockResolvedValue({
      ok: true,
      shipments: [
        {
          shipmentId: 1,
          orderNumber: "112-6147345-5547445",
          trackingNumber: "1ZJ74F69YW11720505",
          carrierCode: "ups_walleted",
          serviceCode: "ups_ground_saver",
          shipDate: "2026-04-24",
          createDate: "2026-04-24T01:00:00Z",
          voided: false,
          voidDate: null,
          shipmentCost: 11.3,
          shipToName: "Smoke Tester",
          shipToPostalCode: "98304",
        },
        {
          shipmentId: 2,
          orderNumber: "1052",
          trackingNumber: "9400",
          carrierCode: "stamps_com",
          serviceCode: "usps_first_class_mail",
          shipDate: "2026-04-24",
          createDate: "2026-04-24T02:00:00Z",
          voided: false,
          voidDate: null,
          shipmentCost: 4.1,
          shipToName: "Sarah",
          shipToPostalCode: "46062",
        },
      ],
    });

    const map = new Map<string, unknown>();
    map.set("112-6147345-5547445", {
      orderNumber: "112-6147345-5547445",
      source: "amazon",
      label: { fileId: "f1", webViewLink: "https://drive/label-1" },
      packingSlip: { fileId: "p1", webViewLink: "https://drive/slip-1" },
      slackPermalink: "https://slack/p1",
    });
    bulkLookupMock.mockResolvedValue(map);

    const { GET } = await import("../route");
    const req = new Request(
      "http://localhost/api/ops/fulfillment/recent-labels?daysBack=7&limit=10",
      { method: "GET" },
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shipments: Array<Record<string, unknown>>;
    };
    expect(body.shipments).toHaveLength(2);

    const enriched = body.shipments[0];
    expect(enriched.labelDriveLink).toBe("https://drive/label-1");
    expect(enriched.packingSlipDriveLink).toBe("https://drive/slip-1");
    expect(enriched.slackPermalink).toBe("https://slack/p1");
    expect(enriched.artifactSource).toBe("amazon");

    // Shipment with no artifact in KV gets nulls (not undefined).
    const bare = body.shipments[1];
    expect(bare.labelDriveLink).toBeNull();
    expect(bare.packingSlipDriveLink).toBeNull();
    expect(bare.slackPermalink).toBeNull();

    // bulkLookup got called with the order numbers from ShipStation.
    expect(bulkLookupMock).toHaveBeenCalledWith([
      { orderNumber: "112-6147345-5547445" },
      { orderNumber: "1052" },
    ]);
  });

  it("KV outage on bulkLookup degrades gracefully — shipments still returned", async () => {
    getRecentMock.mockResolvedValue({
      ok: true,
      shipments: [
        {
          shipmentId: 1,
          orderNumber: "1052",
          trackingNumber: null,
          carrierCode: null,
          serviceCode: null,
          shipDate: null,
          createDate: "2026-04-24T00:00:00Z",
          voided: false,
          voidDate: null,
          shipmentCost: null,
          shipToName: null,
          shipToPostalCode: null,
        },
      ],
    });
    bulkLookupMock.mockRejectedValue(new Error("kv unreachable"));

    const { GET } = await import("../route");
    const res = await GET(
      new Request("http://localhost/api/ops/fulfillment/recent-labels", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shipments: Array<Record<string, unknown>>;
    };
    expect(body.shipments).toHaveLength(1);
    expect(body.shipments[0].labelDriveLink).toBeNull();
  });
});
