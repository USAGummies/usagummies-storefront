/**
 * Phase 28c — dispatch-board projection helper.
 *
 * Locks the contract:
 *   - Open rows sort before dispatched rows.
 *   - Within each group, shipDate DESC; tracking ASC tie-break.
 *   - Voided shipments excluded by default.
 *   - Artifact lookup tries `${source}:${orderNumber}` first, then
 *     other known sources, then bare `orderNumber`. Returns the first
 *     hit; never fabricates a `dispatchedAt`.
 *   - inferSourceFromOrderNumber: Amazon shape → "amazon", numeric
 *     (with optional #) → "shopify", everything else → null.
 *   - Counts always sum to `rows.length` after voided-exclusion.
 */
import { describe, expect, it } from "vitest";

import type { ShipStationShipment } from "@/lib/ops/shipstation-client";
import type { ShippingArtifactRecord } from "@/lib/ops/shipping-artifacts";
import {
  applyDispatchBoardFilters,
  buildDispatchBoardRows,
  dispatchBoardFilterIsActive,
  dispatchBoardFilterSpecToQuery,
  inferSourceFromOrderNumber,
  parseDispatchBoardFilterSpec,
  type DispatchBoardFilterSpec,
  type DispatchBoardView,
} from "@/lib/ops/shipping-dispatch-board";

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

function artifact(
  over: Partial<ShippingArtifactRecord>,
): ShippingArtifactRecord {
  return {
    orderNumber: "test",
    source: "amazon",
    trackingNumber: null,
    label: null,
    packingSlip: null,
    slackPermalink: null,
    persistedAt: "2026-04-25T00:00:00Z",
    driveError: null,
    ...over,
  };
}

describe("inferSourceFromOrderNumber", () => {
  it("maps Amazon shape XXX-XXXXXXX-XXXXXXX → amazon", () => {
    expect(inferSourceFromOrderNumber("112-5249905-9718616")).toBe("amazon");
    expect(inferSourceFromOrderNumber("114-3537957-6941066")).toBe("amazon");
  });
  it("maps Shopify numeric (with optional #) → shopify", () => {
    expect(inferSourceFromOrderNumber("1016")).toBe("shopify");
    expect(inferSourceFromOrderNumber("#1016")).toBe("shopify");
  });
  it("returns null on null / empty / unknown shape", () => {
    expect(inferSourceFromOrderNumber(null)).toBeNull();
    expect(inferSourceFromOrderNumber(undefined)).toBeNull();
    expect(inferSourceFromOrderNumber("")).toBeNull();
    expect(inferSourceFromOrderNumber("   ")).toBeNull();
    expect(inferSourceFromOrderNumber("X9S2VWVR8T")).toBeNull(); // Faire-ish
    expect(inferSourceFromOrderNumber("garbage")).toBeNull();
  });
});

describe("buildDispatchBoardRows", () => {
  it("returns an empty view for empty input", () => {
    const view = buildDispatchBoardRows([], new Map());
    expect(view.rows).toEqual([]);
    expect(view.counts).toEqual({ total: 0, open: 0, dispatched: 0 });
  });

  it("excludes voided shipments by default", () => {
    const view = buildDispatchBoardRows(
      [
        ship({ shipmentId: 1, orderNumber: "1001", trackingNumber: "T1" }),
        ship({
          shipmentId: 2,
          orderNumber: "1002",
          trackingNumber: "T2",
          voided: true,
          voidDate: "2026-04-25T00:00:00Z",
        }),
      ],
      new Map(),
    );
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].orderNumber).toBe("1001");
    expect(view.counts.total).toBe(1);
  });

  it("includes voided shipments when excludeVoided=false", () => {
    const view = buildDispatchBoardRows(
      [
        ship({ shipmentId: 1, orderNumber: "1001", trackingNumber: "T1" }),
        ship({
          shipmentId: 2,
          orderNumber: "1002",
          trackingNumber: "T2",
          voided: true,
        }),
      ],
      new Map(),
      { excludeVoided: false },
    );
    expect(view.rows).toHaveLength(2);
  });

  it("marks rows with no artifact as state=open + dispatchedAt=null", () => {
    const view = buildDispatchBoardRows(
      [ship({ orderNumber: "112-5249905-9718616", trackingNumber: "T1" })],
      new Map(),
    );
    expect(view.rows[0].state).toBe("open");
    expect(view.rows[0].dispatchedAt).toBeNull();
    expect(view.rows[0].dispatchedBy).toBeNull();
    // Source inferred from Amazon-shape order number.
    expect(view.rows[0].source).toBe("amazon");
  });

  it("marks rows whose artifact has dispatchedAt as state=dispatched", () => {
    const order = "112-5249905-9718616";
    const lookup = new Map<string, ShippingArtifactRecord>([
      [
        `amazon:${order}`,
        artifact({
          orderNumber: order,
          source: "amazon",
          dispatchedAt: "2026-04-26T18:00:00Z",
          dispatchedBy: "U_OPERATOR",
          slackPermalink: "https://example.slack.com/archives/C0AS4635HFG/p1",
        }),
      ],
    ]);
    const view = buildDispatchBoardRows(
      [ship({ orderNumber: order, trackingNumber: "T1" })],
      lookup,
    );
    expect(view.rows[0].state).toBe("dispatched");
    expect(view.rows[0].dispatchedAt).toBe("2026-04-26T18:00:00Z");
    expect(view.rows[0].dispatchedBy).toBe("U_OPERATOR");
    expect(view.rows[0].slackPermalink).toContain("/p1");
  });

  it("looks up artifact by bare orderNumber when source key is missing", () => {
    const order = "X9S2VWVR8T"; // Faire-ish — inferSource returns null
    const lookup = new Map<string, ShippingArtifactRecord>([
      [
        order,
        artifact({
          orderNumber: order,
          source: "faire",
          dispatchedAt: "2026-04-26T18:00:00Z",
        }),
      ],
    ]);
    const view = buildDispatchBoardRows(
      [ship({ orderNumber: order, trackingNumber: "T1" })],
      lookup,
    );
    expect(view.rows[0].state).toBe("dispatched");
    expect(view.rows[0].source).toBe("faire");
  });

  it("sorts open before dispatched, then shipDate DESC, then tracking ASC", () => {
    const lookup = new Map<string, ShippingArtifactRecord>([
      [
        "amazon:112-DISPATCH-9999999",
        artifact({
          orderNumber: "112-DISPATCH-9999999",
          source: "amazon",
          dispatchedAt: "2026-04-26T18:00:00Z",
        }),
      ],
    ]);
    const view = buildDispatchBoardRows(
      [
        // dispatched, older
        ship({
          shipmentId: 1,
          orderNumber: "112-DISPATCH-9999999",
          shipDate: "2026-04-23",
          trackingNumber: "T_DISPATCH",
        }),
        // open, oldest
        ship({
          shipmentId: 2,
          orderNumber: "112-2222222-2222222",
          shipDate: "2026-04-22",
          trackingNumber: "T_OLD",
        }),
        // open, newest
        ship({
          shipmentId: 3,
          orderNumber: "112-3333333-3333333",
          shipDate: "2026-04-26",
          trackingNumber: "T_NEW_B",
        }),
        // open, newest, tracking tie-break ASC
        ship({
          shipmentId: 4,
          orderNumber: "112-4444444-4444444",
          shipDate: "2026-04-26",
          trackingNumber: "T_NEW_A",
        }),
      ],
      lookup,
    );
    const order = view.rows.map((r) => r.trackingNumber);
    expect(order).toEqual([
      "T_NEW_A", // open, 04-26, alphabetically first
      "T_NEW_B", // open, 04-26
      "T_OLD", // open, 04-22
      "T_DISPATCH", // dispatched, last
    ]);
  });

  it("counts always sum to rows.length", () => {
    const view = buildDispatchBoardRows(
      [
        ship({ orderNumber: "1001", trackingNumber: "T1" }),
        ship({ orderNumber: "1002", trackingNumber: "T2" }),
        ship({ orderNumber: "1003", trackingNumber: "T3", voided: true }),
      ],
      new Map([
        [
          "shopify:1001",
          artifact({
            orderNumber: "1001",
            source: "shopify",
            dispatchedAt: "2026-04-26T18:00:00Z",
          }),
        ],
      ]),
    );
    expect(view.rows).toHaveLength(2);
    expect(view.counts.total).toBe(2);
    expect(view.counts.open + view.counts.dispatched).toBe(2);
    expect(view.counts.dispatched).toBe(1);
    expect(view.counts.open).toBe(1);
  });

  it("never fabricates dispatchedAt — null artifact stamp → null on row", () => {
    const lookup = new Map<string, ShippingArtifactRecord>([
      [
        "amazon:112-NULL-1234567",
        artifact({
          orderNumber: "112-NULL-1234567",
          source: "amazon",
          dispatchedAt: null,
          slackPermalink: "https://example.slack.com/archives/X/p1",
        }),
      ],
    ]);
    const view = buildDispatchBoardRows(
      [ship({ orderNumber: "112-NULL-1234567", trackingNumber: "T_NULL" })],
      lookup,
    );
    expect(view.rows[0].state).toBe("open");
    expect(view.rows[0].dispatchedAt).toBeNull();
    // Slack permalink still surfaces from the artifact.
    expect(view.rows[0].slackPermalink).toContain("/p1");
  });
});

/**
 * Phase 28d — filter helpers.
 *
 * Locks the contract:
 *   - Empty / "all" / unparseable spec is "no filter" (no rows hidden).
 *   - State filter narrows to open or dispatched.
 *   - Source filter narrows by inferred or artifact-derived source.
 *   - Date filter inclusive on both ends; rows with null/garbage
 *     shipDate excluded under any active date filter.
 *   - Search is case-insensitive substring against orderNumber,
 *     tracking, recipient, and postalCode.
 *   - parse / serialize round-trip.
 *   - dispatchBoardFilterIsActive returns false on no-op specs.
 */
describe("applyDispatchBoardFilters", () => {
  function fixture(): DispatchBoardView {
    return buildDispatchBoardRows(
      [
        ship({
          shipmentId: 1,
          orderNumber: "112-1111111-1111111",
          trackingNumber: "T1",
          shipToName: "Alice Anderson",
          shipDate: "2026-04-26",
        }),
        ship({
          shipmentId: 2,
          orderNumber: "1077",
          trackingNumber: "T2",
          shipToName: "Bob Builder",
          shipDate: "2026-04-25",
        }),
        ship({
          shipmentId: 3,
          orderNumber: "1078",
          trackingNumber: "T3",
          shipToName: "Carol Cat",
          shipDate: "2026-04-24",
        }),
      ],
      new Map<string, ShippingArtifactRecord>([
        [
          "shopify:1077",
          artifact({
            orderNumber: "1077",
            source: "shopify",
            dispatchedAt: "2026-04-26T18:00:00Z",
          }),
        ],
      ]),
    );
  }

  it("empty spec is a no-op", () => {
    const v = fixture();
    const out = applyDispatchBoardFilters(v, {});
    expect(out.rows).toHaveLength(3);
    expect(out.counts).toEqual(v.counts);
  });

  it('state="open" narrows to open rows', () => {
    const out = applyDispatchBoardFilters(fixture(), { state: "open" });
    expect(out.rows.every((r) => r.state === "open")).toBe(true);
    expect(out.counts.dispatched).toBe(0);
    expect(out.counts.open).toBe(2);
  });

  it('state="dispatched" narrows to dispatched rows', () => {
    const out = applyDispatchBoardFilters(fixture(), { state: "dispatched" });
    expect(out.rows.every((r) => r.state === "dispatched")).toBe(true);
    expect(out.counts.open).toBe(0);
    expect(out.counts.dispatched).toBe(1);
  });

  it("source filter narrows by inferred source", () => {
    const out = applyDispatchBoardFilters(fixture(), { source: "amazon" });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].source).toBe("amazon");
  });

  it("date range is inclusive on both ends", () => {
    const out = applyDispatchBoardFilters(fixture(), {
      shipDateFrom: "2026-04-25",
      shipDateTo: "2026-04-26",
    });
    expect(out.rows).toHaveLength(2);
    expect(out.rows.map((r) => r.trackingNumber).sort()).toEqual(["T1", "T2"]);
  });

  it("rows with null shipDate excluded under any active date filter", () => {
    const v: DispatchBoardView = {
      rows: [
        {
          orderNumber: "X",
          source: null,
          recipient: null,
          shipToPostalCode: null,
          carrierService: null,
          trackingNumber: "TX",
          shipmentCost: null,
          shipDate: null,
          slackPermalink: null,
          state: "open",
          dispatchedAt: null,
          dispatchedBy: null,
        },
      ],
      counts: { total: 1, open: 1, dispatched: 0 },
    };
    const out = applyDispatchBoardFilters(v, { shipDateFrom: "2026-01-01" });
    expect(out.rows).toHaveLength(0);
  });

  it("search is case-insensitive substring across orderNumber / tracking / recipient", () => {
    const out1 = applyDispatchBoardFilters(fixture(), { search: "alice" });
    expect(out1.rows).toHaveLength(1);
    expect(out1.rows[0].recipient).toBe("Alice Anderson");

    const out2 = applyDispatchBoardFilters(fixture(), { search: "T2" });
    expect(out2.rows).toHaveLength(1);
    expect(out2.rows[0].trackingNumber).toBe("T2");

    const out3 = applyDispatchBoardFilters(fixture(), { search: "1078" });
    expect(out3.rows).toHaveLength(1);
    expect(out3.rows[0].orderNumber).toBe("1078");
  });

  it("AND semantics across multiple dimensions", () => {
    const out = applyDispatchBoardFilters(fixture(), {
      state: "open",
      source: "shopify",
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].orderNumber).toBe("1078");
  });

  it("counts on the filtered view sum to filtered rows", () => {
    const out = applyDispatchBoardFilters(fixture(), { state: "open" });
    expect(out.counts.total).toBe(out.rows.length);
    expect(out.counts.open + out.counts.dispatched).toBe(out.rows.length);
  });

  it("whitespace / unparseable values collapse to no filter", () => {
    const out = applyDispatchBoardFilters(fixture(), {
      shipDateFrom: "   ",
      shipDateTo: "not-a-date",
      search: "   ",
    });
    expect(out.rows).toHaveLength(3);
  });
});

describe("dispatchBoardFilterIsActive", () => {
  it("false on empty spec", () => {
    expect(dispatchBoardFilterIsActive({})).toBe(false);
  });
  it('false on state="all"', () => {
    expect(dispatchBoardFilterIsActive({ state: "all" })).toBe(false);
  });
  it('false on whitespace search', () => {
    expect(dispatchBoardFilterIsActive({ search: "   " })).toBe(false);
  });
  it("true on populated state / source / search / dates", () => {
    expect(dispatchBoardFilterIsActive({ state: "open" })).toBe(true);
    expect(dispatchBoardFilterIsActive({ source: "amazon" })).toBe(true);
    expect(dispatchBoardFilterIsActive({ search: "abc" })).toBe(true);
    expect(
      dispatchBoardFilterIsActive({ shipDateFrom: "2026-04-26" }),
    ).toBe(true);
  });
});

describe("parse + serialize filter spec", () => {
  it("round-trips a full spec", () => {
    const spec: DispatchBoardFilterSpec = {
      state: "open",
      source: "amazon",
      shipDateFrom: "2026-04-25",
      shipDateTo: "2026-04-26",
      search: "Eric",
    };
    const q = dispatchBoardFilterSpecToQuery(spec);
    const parsed = parseDispatchBoardFilterSpec(new URLSearchParams(q));
    expect(parsed).toEqual(spec);
  });

  it("ignores unknown / unparseable values", () => {
    const parsed = parseDispatchBoardFilterSpec(
      new URLSearchParams(
        "state=destroy&source=instagram&shipDateFrom=garbage&search=",
      ),
    );
    expect(parsed).toEqual({});
  });

  it('serializer omits "all" / empty / unparseable', () => {
    const q = dispatchBoardFilterSpecToQuery({
      state: "all",
      source: "all",
      shipDateFrom: "garbage",
      search: "   ",
    });
    expect(q.toString()).toBe("");
  });
});
