/**
 * Tests for the ShipStation stores cache + channel resolver.
 *
 * Covers the `Tag: Internal` regression that hit Shopify order 1018 on
 * 2026-04-29: ShipStation V3's Shopify integration leaves
 * `advancedOptions.source` empty on imported orders, so the auto-ship
 * route's `sourceLabelFor` heuristic fell through to "Internal" instead
 * of classifying as "shopify". The fix is a `/stores` API lookup that
 * resolves `storeId → marketplaceName → channel slug`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearShipStationStoresCache,
  resolveChannelForStoreId,
  listShipStationStores,
} from "@/lib/ops/shipstation-client";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_KEY = process.env.SHIPSTATION_API_KEY;
const ORIGINAL_SECRET = process.env.SHIPSTATION_API_SECRET;

function mockStoresResponse(stores: Array<Record<string, unknown>>) {
  global.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/stores")) {
      return new Response(JSON.stringify(stores), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof global.fetch;
}

beforeEach(() => {
  clearShipStationStoresCache();
  process.env.SHIPSTATION_API_KEY = "fake-key";
  process.env.SHIPSTATION_API_SECRET = "fake-secret";
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.SHIPSTATION_API_KEY = ORIGINAL_KEY;
  process.env.SHIPSTATION_API_SECRET = ORIGINAL_SECRET;
  clearShipStationStoresCache();
});

describe("resolveChannelForStoreId", () => {
  it("resolves Shopify storeId via marketplaceName=\"Shopify\"", async () => {
    mockStoresResponse([
      { storeId: 5001, storeName: "Shopify - USA Gummies DTC", marketplaceId: 51, marketplaceName: "Shopify", active: true },
      { storeId: 5002, storeName: "Amazon - USA Gummies FBA", marketplaceId: 2, marketplaceName: "Amazon", active: true },
    ]);
    expect(await resolveChannelForStoreId(5001)).toBe("shopify");
  });

  it("resolves Amazon storeId via marketplaceName=\"Amazon\"", async () => {
    mockStoresResponse([
      { storeId: 5001, storeName: "Shopify - USA Gummies DTC", marketplaceId: 51, marketplaceName: "Shopify", active: true },
      { storeId: 5002, storeName: "Amazon - USA Gummies FBA", marketplaceId: 2, marketplaceName: "Amazon", active: true },
    ]);
    expect(await resolveChannelForStoreId(5002)).toBe("amazon");
  });

  it("resolves Faire storeId", async () => {
    mockStoresResponse([
      { storeId: 6000, storeName: "Faire", marketplaceId: 99, marketplaceName: "Faire", active: true },
    ]);
    expect(await resolveChannelForStoreId(6000)).toBe("faire");
  });

  it("falls back to storeName substring when marketplaceName is empty", async () => {
    mockStoresResponse([
      // Custom store named with vendor brand — no marketplaceName populated.
      { storeId: 7000, storeName: "USA Gummies Shopify Storefront", marketplaceId: null, marketplaceName: null, active: true },
    ]);
    expect(await resolveChannelForStoreId(7000)).toBe("shopify");
  });

  it("returns null for unknown storeId (falls through to default classifier)", async () => {
    mockStoresResponse([
      { storeId: 5001, storeName: "Shopify - USA Gummies DTC", marketplaceId: 51, marketplaceName: "Shopify", active: true },
    ]);
    expect(await resolveChannelForStoreId(9999)).toBeNull();
  });

  it("returns null for null/zero/negative storeId without making an API call", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    expect(await resolveChannelForStoreId(null)).toBeNull();
    expect(await resolveChannelForStoreId(undefined)).toBeNull();
    expect(await resolveChannelForStoreId(0)).toBeNull();
    expect(await resolveChannelForStoreId(-1)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when ShipStation auth is not configured (no env vars)", async () => {
    delete process.env.SHIPSTATION_API_KEY;
    delete process.env.SHIPSTATION_API_SECRET;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    expect(await resolveChannelForStoreId(5001)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("matches case-insensitively on marketplaceName", async () => {
    mockStoresResponse([
      { storeId: 5001, storeName: null, marketplaceId: 51, marketplaceName: "SHOPIFY", active: true },
    ]);
    expect(await resolveChannelForStoreId(5001)).toBe("shopify");
  });

  it("returns null for an unknown channel (e.g. eBay) so it doesn't get a forced label", async () => {
    mockStoresResponse([
      { storeId: 5500, storeName: "eBay USA", marketplaceId: 7, marketplaceName: "eBay", active: true },
    ]);
    expect(await resolveChannelForStoreId(5500)).toBeNull();
  });
});

describe("listShipStationStores", () => {
  it("caches across calls within the TTL window (single fetch for two reads)", async () => {
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify([{ storeId: 5001, storeName: "Shopify", marketplaceName: "Shopify", active: true }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    await listShipStationStores();
    await listShipStationStores();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns empty array on auth failure rather than throwing", async () => {
    delete process.env.SHIPSTATION_API_KEY;
    delete process.env.SHIPSTATION_API_SECRET;
    const stores = await listShipStationStores();
    expect(stores).toEqual([]);
  });

  it("returns empty array on network error (no throw)", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ENETUNREACH");
    }) as unknown as typeof global.fetch;
    const stores = await listShipStationStores();
    expect(stores).toEqual([]);
  });

  it("returns empty array on non-2xx response (no throw)", async () => {
    global.fetch = vi.fn(async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as unknown as typeof global.fetch;
    const stores = await listShipStationStores();
    expect(stores).toEqual([]);
  });
});
