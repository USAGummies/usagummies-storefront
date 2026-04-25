/**
 * Pure helpers for the public Store Locator (`/where-to-buy`).
 *
 * The static data lives in `src/data/retailers.ts` and is hand-
 * curated as new retail partners come online. These helpers do not
 * fetch — they shape that array for display + the SEO JSON-LD.
 *
 * Hard rules locked by tests:
 *   - countStores never throws on empty / null / undefined input.
 *   - countStates dedups case-insensitively and ignores blank states
 *     (a partial record never inflates the count).
 *   - groupByState returns a stable, alphabetically-sorted shape so
 *     the page renders identically across SSR + client hydration.
 *   - normalizeStoreLocation never invents a location — when fields
 *     are missing it returns null instead of fabricating placeholders.
 *
 * No env reads. No I/O. No date dependencies. Easy to test.
 */

import type { RetailerLocation } from "@/data/retailers";

export type StoreLocation = RetailerLocation;

/** Total number of retail locations on file. Returns 0 on empty/null input. */
export function countStores(stores: readonly StoreLocation[] | null | undefined): number {
  if (!Array.isArray(stores)) return 0;
  return stores.filter((s): s is StoreLocation => Boolean(s && s.name)).length;
}

/**
 * Distinct count of US states present in the store list. Case-
 * insensitive dedup; blank states are ignored. Returns 0 on empty
 * input.
 */
export function countStates(stores: readonly StoreLocation[] | null | undefined): number {
  if (!Array.isArray(stores)) return 0;
  const set = new Set<string>();
  for (const s of stores) {
    if (!s) continue;
    const trimmed = (s.state ?? "").trim();
    if (!trimmed) continue;
    set.add(trimmed.toLowerCase());
  }
  return set.size;
}

/**
 * Group stores by state name (preserving the canonical casing of the
 * first occurrence). Returns an array of `{ state, stores }` ordered
 * alphabetically by state name. Stable across SSR + client hydration.
 */
export interface StateGroup {
  /** Canonical state name (e.g. "Washington"). Preserved from the data. */
  state: string;
  stores: StoreLocation[];
}

export function groupByState(
  stores: readonly StoreLocation[] | null | undefined,
): StateGroup[] {
  if (!Array.isArray(stores)) return [];
  // Map from lowercased state → { canonical, list } for stable casing.
  const byKey = new Map<string, StateGroup>();
  for (const s of stores) {
    if (!s || !s.name) continue;
    const trimmed = (s.state ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.stores.push(s);
    } else {
      byKey.set(key, { state: trimmed, stores: [s] });
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.state.localeCompare(b.state, "en"),
  );
}

/**
 * Defensive coercion of a free-form input record to a `StoreLocation`
 * shape — returns null when required fields are missing rather than
 * filling defaults. This is the gate for any future ingest path
 * (CSV import, manual form, etc.) that lands new retail partners
 * without going through the curated `src/data/retailers.ts` literal.
 *
 * Required: slug, name, address, cityStateZip, state, lat, lng,
 *           mapX, mapY, mapsUrl, channel, storeType.
 *
 * Optional: website, note.
 *
 * Returns null on any required-field miss. Caller decides whether to
 * skip the record or surface an operator error.
 */
export function normalizeStoreLocation(
  input: Partial<StoreLocation> | null | undefined,
): StoreLocation | null {
  if (!input || typeof input !== "object") return null;
  const required: Array<keyof StoreLocation> = [
    "slug",
    "name",
    "address",
    "cityStateZip",
    "state",
    "mapsUrl",
    "channel",
    "storeType",
  ];
  for (const key of required) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v !== "string" || v.trim().length === 0) return null;
  }
  const numericRequired: Array<keyof StoreLocation> = ["lat", "lng", "mapX", "mapY"];
  for (const key of numericRequired) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
  }
  if (input.channel !== "direct" && input.channel !== "faire") return null;
  return {
    slug: input.slug!.trim(),
    name: input.name!.trim(),
    address: input.address!.trim(),
    cityStateZip: input.cityStateZip!.trim(),
    state: input.state!.trim(),
    lat: input.lat as number,
    lng: input.lng as number,
    mapX: input.mapX as number,
    mapY: input.mapY as number,
    mapsUrl: input.mapsUrl!.trim(),
    channel: input.channel,
    storeType: input.storeType!.trim(),
    website: typeof input.website === "string" && input.website.trim().length > 0
      ? input.website.trim()
      : undefined,
    note: typeof input.note === "string" && input.note.trim().length > 0
      ? input.note.trim()
      : undefined,
  };
}
