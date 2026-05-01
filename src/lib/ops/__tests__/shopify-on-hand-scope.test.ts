/**
 * Regression coverage: `getAllOnHandInventory()` must NOT depend on the
 * `read_locations` Shopify Admin API scope.
 *
 * 2026-04-30 — every morning daily-brief was surfacing
 *
 *   ❓ ATP: No snapshot in KV — POST /api/ops/inventory/snapshot to populate
 *
 * Root cause: the `ON_HAND_QUERY` GraphQL pulled `location { id name }`
 * which requires `read_locations` (or `read_markets_home`). Production
 * Shopify token lacked the scope, so every invocation of
 * `getAllOnHandInventory()` returned an Access denied error, the snapshot
 * cron never wrote to KV, and the brief read empty forever.
 *
 * The fix dropped `name` from the query and synthesizes a stable
 * `Loc-<id-tail>` label client-side from the location GID. Production
 * code never read the human-readable name (verified via `grep
 * '\.locationName'` returning zero hits outside of tests + the OnHandRow
 * type itself), so the change is invisible to the ATP gate, the
 * snapshot, and the brief.
 *
 * This test pins:
 *   1. `shopifyAdminQuery` is invoked with a query string that does NOT
 *      ask for `location { name }` — a future contributor adding `name`
 *      back fails this test.
 *   2. Returned rows have `byLocation[].locationName` populated as the
 *      `Loc-<gidTail>` synthetic label (so downstream consumers that
 *      read the field still get a non-empty string).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// `getAllOnHandInventory()` calls `shopifyAdminQuery()` in the SAME
// module — module-internal calls bind to the local function reference,
// so mocking the module's export does not redirect them. We mock one
// layer deeper: `adminRequest` from `@/lib/shopify/admin`, which is
// what `shopifyAdminQuery` calls.
vi.mock("@/lib/shopify/admin", () => ({
  adminRequest: vi.fn(),
}));

import { adminRequest } from "@/lib/shopify/admin";
import * as shopifyMod from "../shopify-admin-actions";

const mockedQuery = adminRequest as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

describe("getAllOnHandInventory — scope-tolerance regression guard", () => {
  it("does NOT request `location { name }` (would trigger missing-scope errors)", async () => {
    mockedQuery.mockResolvedValueOnce({
      ok: true,
      data: {
        products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    });
    await shopifyMod.getAllOnHandInventory();

    expect(mockedQuery).toHaveBeenCalled();
    const queryString = String(mockedQuery.mock.calls[0]?.[0] ?? "");
    // The location subselection must contain `id` but NOT `name`.
    // Match the exact `location { ... }` block to avoid false negatives
    // from "name" appearing elsewhere in the query (e.g. quantities.name).
    const locationBlock = queryString.match(/location\s*{[^}]*}/);
    expect(locationBlock).toBeTruthy();
    expect(locationBlock![0]).toContain("id");
    expect(locationBlock![0]).not.toMatch(/\bname\b/);
  });

  it("synthesizes a `Loc-<gid-tail>` label so byLocation.locationName is never empty", async () => {
    mockedQuery.mockResolvedValueOnce({
      ok: true,
      data: {
        products: {
          edges: [
            {
              cursor: "c1",
              node: {
                id: "gid://shopify/Product/1",
                title: "All American Gummy Bears",
                variants: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/ProductVariant/v1",
                        title: "7.5 oz",
                        sku: "USG-7.5",
                        inventoryItem: {
                          id: "gid://shopify/InventoryItem/i1",
                          tracked: true,
                          inventoryLevels: {
                            edges: [
                              {
                                node: {
                                  location: { id: "gid://shopify/Location/64278822978" },
                                  quantities: [{ name: "on_hand", quantity: 540 }],
                                },
                              },
                              {
                                node: {
                                  location: { id: "gid://shopify/Location/77000000001" },
                                  quantities: [{ name: "on_hand", quantity: 0 }],
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
    const rows = await shopifyMod.getAllOnHandInventory();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.sku).toBe("USG-7.5");
    expect(row.onHand).toBe(540);
    expect(row.byLocation).toHaveLength(2);
    expect(row.byLocation[0].locationId).toBe("gid://shopify/Location/64278822978");
    expect(row.byLocation[0].locationName).toBe("Loc-64278822978");
    expect(row.byLocation[1].locationName).toBe("Loc-77000000001");
  });

  it("skips variants whose inventoryItem is null or untracked", async () => {
    mockedQuery.mockResolvedValueOnce({
      ok: true,
      data: {
        products: {
          edges: [
            {
              cursor: "c1",
              node: {
                id: "gid://shopify/Product/1",
                title: "Mixed",
                variants: {
                  edges: [
                    {
                      node: {
                        id: "v1",
                        title: "tracked",
                        sku: "T",
                        inventoryItem: {
                          id: "i1",
                          tracked: true,
                          inventoryLevels: {
                            edges: [
                              {
                                node: {
                                  location: { id: "gid://shopify/Location/1" },
                                  quantities: [{ name: "on_hand", quantity: 10 }],
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                    {
                      node: {
                        id: "v2",
                        title: "untracked",
                        sku: "U",
                        inventoryItem: {
                          id: "i2",
                          tracked: false,
                          inventoryLevels: { edges: [] },
                        },
                      },
                    },
                    {
                      node: {
                        id: "v3",
                        title: "no-inventory-item",
                        sku: "N",
                        inventoryItem: null,
                      },
                    },
                  ],
                },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
    const rows = await shopifyMod.getAllOnHandInventory();
    expect(rows.map((r) => r.sku)).toEqual(["T"]);
  });
});
