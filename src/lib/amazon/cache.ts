/**
 * Amazon KPI Cache Layer
 *
 * Uses the existing KV-backed state abstraction (readState/writeState)
 * to cache Amazon SP-API responses with per-data-type TTLs.
 *
 * TTLs:
 *   Orders:    15 min (rate limit: 1 req / 5 sec)
 *   Inventory: 30 min (rate limit: 2 req / sec)
 *   Fees:      60 min (rate limit: 10 req / sec, single ASIN)
 */

import { readState, writeState } from "@/lib/ops/state";
import type { CacheEnvelope } from "./types";

// ---------------------------------------------------------------------------
// TTL constants (ms)
// ---------------------------------------------------------------------------

const TTL_ORDERS = 15 * 60 * 1000;     // 15 minutes
const TTL_INVENTORY = 30 * 60 * 1000;  // 30 minutes
const TTL_FEES = 60 * 60 * 1000;       // 60 minutes

// ---------------------------------------------------------------------------
// Generic cache helpers
// ---------------------------------------------------------------------------

type CacheKey = "amazon-kpi-cache" | "amazon-inventory-cache" | "amazon-orders-cache";

async function getCached<T>(key: CacheKey, ttl: number): Promise<T | null> {
  const envelope = await readState<CacheEnvelope<T> | null>(key, null);
  if (!envelope) return null;

  const age = Date.now() - envelope.cachedAt;
  if (age > ttl) return null; // stale

  return envelope.data;
}

async function setCache<T>(key: CacheKey, data: T): Promise<void> {
  const envelope: CacheEnvelope<T> = {
    data,
    cachedAt: Date.now(),
  };
  await writeState(key, envelope);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get cached Amazon KPI data (15-min TTL) */
export async function getCachedKPIs<T>(): Promise<T | null> {
  return getCached<T>("amazon-kpi-cache", TTL_ORDERS);
}

/** Store Amazon KPI data in cache */
export async function setCachedKPIs<T>(data: T): Promise<void> {
  await setCache("amazon-kpi-cache", data);
}

/** Get cached FBA inventory data (30-min TTL) */
export async function getCachedInventory<T>(): Promise<T | null> {
  return getCached<T>("amazon-inventory-cache", TTL_INVENTORY);
}

/** Store FBA inventory data in cache */
export async function setCachedInventory<T>(data: T): Promise<void> {
  await setCache("amazon-inventory-cache", data);
}

/** Get cached orders data (15-min TTL) */
export async function getCachedOrders<T>(): Promise<T | null> {
  return getCached<T>("amazon-orders-cache", TTL_ORDERS);
}

/** Store orders data in cache */
export async function setCachedOrders<T>(data: T): Promise<void> {
  await setCache("amazon-orders-cache", data);
}

/** Get cache age in seconds for display */
export async function getCacheAge(key: CacheKey): Promise<number | null> {
  const envelope = await readState<CacheEnvelope<unknown> | null>(key, null);
  if (!envelope) return null;
  return Math.floor((Date.now() - envelope.cachedAt) / 1000);
}

/** Check if the KPI cache is fresh enough to skip fee refetch (60-min TTL) */
export async function isFeesCacheFresh(): Promise<boolean> {
  // Fees are embedded in the KPI cache — check if it's fresh enough
  // that we don't need to re-fetch fees (which have a longer TTL than orders)
  const envelope = await readState<CacheEnvelope<unknown> | null>("amazon-kpi-cache", null);
  if (!envelope) return false;
  return (Date.now() - envelope.cachedAt) < TTL_FEES;
}
