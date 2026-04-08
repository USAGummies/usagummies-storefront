/**
 * INVENTORY — Batch Register & Cost Tracking for USA Gummies
 *
 * Stores immutable batch records with locked landed costs, inventory
 * levels by location, and allocation tracking. Prevents cost drift
 * by storing computed unit costs as facts, not re-deriving each session.
 *
 * STORAGE: Batches use Redis hash (HSET/HGET/HGETALL) keyed by batch_id.
 * Same atomic-write pattern as PIPELINE to prevent race conditions.
 *
 * Data persisted in Vercel KV under inventory:* keys.
 * Syncs to Notion Batch Register DB.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BatchStatus = "raw_materials" | "in_production" | "finished" | "depleted";

export type LocationName = "Powers" | "Ashford" | "FBA" | "In-Transit" | "Other";

export interface ComponentCost {
  vendor: string;
  description: string;
  amount: number;
  units_covered: number; // how many units this cost covers
  per_unit: number;
}

export interface PackagingConfig {
  format: string; // e.g. "singles", "3-pack", "6-pack-clip-strip", "36-case"
  units_per_package: number;
  packages_per_case: number;
  cases_per_pallet: number;
}

export interface Batch {
  batch_id: string;
  vendor: string; // co-packer name, e.g. "Powers"
  unit_count: number; // target/actual finished units
  actual_yield?: number; // actual units produced (may differ from target)
  waste_rate?: number; // percentage, e.g. 2.5 = 2.5%
  status: BatchStatus;
  location: LocationName;
  component_costs: ComponentCost[];
  landed_cost: number; // total $ for this batch
  cost_per_unit: number; // landed_cost / unit_count (locked)
  packaging_config?: PackagingConfig;
  best_by_date?: string; // ISO date
  batch_report_id?: string; // Powers batch #
  start_date: string; // ISO date
  completion_date?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryLocation {
  location: LocationName;
  units: number;
  last_updated: string;
  notes?: string;
}

export interface AllocationRecord {
  id: string;
  batch_id: string;
  from_location: LocationName;
  to_location: LocationName;
  units: number;
  reason: string; // e.g. "FBA inbound shipment", "order fulfillment", "sample"
  order_ref?: string; // linked order ID
  date: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// KV Keys
// ---------------------------------------------------------------------------

// Batches: Redis hash — each field is batch_id → Batch object
const KV_BATCHES_HASH = "inventory:batches:h";
const KV_LOCATIONS = "inventory:locations";
const KV_ALLOCATIONS = "inventory:allocations";

// ---------------------------------------------------------------------------
// Batch hash helpers (atomic per-batch writes)
// ---------------------------------------------------------------------------

/** Get all batches from the hash map. */
async function getAllBatches(): Promise<Batch[]> {
  const hash = await kv.hgetall<Record<string, Batch>>(KV_BATCHES_HASH);
  if (!hash) return [];
  return Object.values(hash);
}

/** Get a single batch by ID. */
async function getBatchById(batchId: string): Promise<Batch | null> {
  const b = await kv.hget<Batch>(KV_BATCHES_HASH, batchId);
  return b || null;
}

/** Atomically write a single batch. */
async function setBatch(batch: Batch): Promise<void> {
  await kv.hset(KV_BATCHES_HASH, { [batch.batch_id]: batch });
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export async function listBatches(
  filters?: { status?: BatchStatus; vendor?: string }
): Promise<Batch[]> {
  let all = await getAllBatches();
  if (filters?.status) {
    all = all.filter((b) => b.status === filters.status);
  }
  if (filters?.vendor) {
    const v = filters.vendor.toLowerCase();
    all = all.filter((b) => b.vendor.toLowerCase().includes(v));
  }
  return all;
}

export async function getBatch(batchId: string): Promise<Batch | null> {
  return getBatchById(batchId);
}

export async function upsertBatch(
  input: Omit<Batch, "created_at" | "updated_at"> & { created_at?: string; updated_at?: string }
): Promise<Batch> {
  const now = new Date().toISOString();
  const existing = await getBatchById(input.batch_id);

  const batch: Batch = {
    ...input,
    created_at: existing ? existing.created_at : (input.created_at || now),
    updated_at: now,
  };

  // Atomic write — only touches this batch's hash field
  await setBatch(batch);
  return batch;
}

export async function getUnitCost(batchId: string): Promise<{
  batch_id: string;
  landed_cost: number;
  cost_per_unit: number;
  components: ComponentCost[];
  unit_count: number;
  waste_rate?: number;
} | null> {
  const batch = await getBatchById(batchId);
  if (!batch) return null;

  return {
    batch_id: batch.batch_id,
    landed_cost: batch.landed_cost,
    cost_per_unit: batch.cost_per_unit,
    components: batch.component_costs,
    unit_count: batch.unit_count,
    waste_rate: batch.waste_rate,
  };
}

/**
 * Get weighted average cost across active batches, or a specific batch's cost.
 * Used by MARGIN CHECK and CHANNEL HEALTH.
 */
export async function getActiveCostPerUnit(batchId?: string): Promise<{
  unit_cost: number;
  source: string;
  warnings: string[];
}> {
  const warnings: string[] = [];

  // If a specific batch is requested, return its cost directly
  if (batchId) {
    const batch = await getBatchById(batchId);
    if (batch) {
      return {
        unit_cost: batch.cost_per_unit,
        source: `batch:${batch.batch_id}`,
        warnings: [],
      };
    }
    warnings.push(`Batch ${batchId} not found — falling back to weighted average`);
  }

  // Weighted average across all active (non-depleted) batches
  const all = await getAllBatches();
  const active = all.filter((b) => b.status !== "depleted");

  if (active.length === 0) {
    return { unit_cost: 0, source: "none", warnings: ["No active batches in INVENTORY"] };
  }

  const totalUnits = active.reduce((sum, b) => sum + b.unit_count, 0);
  const weightedCost = active.reduce((sum, b) => sum + (b.cost_per_unit * b.unit_count), 0);
  const unitCost = totalUnits > 0 ? weightedCost / totalUnits : 0;

  return {
    unit_cost: unitCost,
    source: `weighted_avg:${active.map((b) => b.batch_id).join("+")}`,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Inventory Locations (on-hand)
// ---------------------------------------------------------------------------

export async function getOnHand(): Promise<InventoryLocation[]> {
  return (await kv.get<InventoryLocation[]>(KV_LOCATIONS)) || [];
}

export async function setLocationUnits(
  location: LocationName,
  units: number,
  notes?: string,
): Promise<InventoryLocation[]> {
  const all = (await kv.get<InventoryLocation[]>(KV_LOCATIONS)) || [];
  const now = new Date().toISOString();
  const idx = all.findIndex((l) => l.location === location);

  const loc: InventoryLocation = {
    location,
    units,
    last_updated: now,
    notes,
  };

  if (idx >= 0) {
    all[idx] = loc;
  } else {
    all.push(loc);
  }

  await kv.set(KV_LOCATIONS, all);
  return all;
}

// ---------------------------------------------------------------------------
// Allocation (move units between locations)
// ---------------------------------------------------------------------------

export async function allocate(input: {
  batch_id: string;
  from_location: LocationName;
  to_location: LocationName;
  units: number;
  reason: string;
  order_ref?: string;
}): Promise<{ allocation: AllocationRecord; locations: InventoryLocation[] }> {
  const locations = (await kv.get<InventoryLocation[]>(KV_LOCATIONS)) || [];
  const allocations = (await kv.get<AllocationRecord[]>(KV_ALLOCATIONS)) || [];
  const now = new Date().toISOString();

  // Find or create source location
  let fromIdx = locations.findIndex((l) => l.location === input.from_location);
  if (fromIdx < 0) {
    locations.push({ location: input.from_location, units: 0, last_updated: now });
    fromIdx = locations.length - 1;
  }

  // Validate enough units
  if (locations[fromIdx].units < input.units) {
    throw new Error(
      `Insufficient units at ${input.from_location}: have ${locations[fromIdx].units}, need ${input.units}`
    );
  }

  // Find or create destination location
  let toIdx = locations.findIndex((l) => l.location === input.to_location);
  if (toIdx < 0) {
    locations.push({ location: input.to_location, units: 0, last_updated: now });
    toIdx = locations.length - 1;
  }

  // Move units
  locations[fromIdx].units -= input.units;
  locations[fromIdx].last_updated = now;
  locations[toIdx].units += input.units;
  locations[toIdx].last_updated = now;

  // Create allocation record
  const allocation: AllocationRecord = {
    id: `alloc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    batch_id: input.batch_id,
    from_location: input.from_location,
    to_location: input.to_location,
    units: input.units,
    reason: input.reason,
    order_ref: input.order_ref,
    date: now.split("T")[0],
    created_at: now,
  };

  allocations.push(allocation);

  // Cap allocations at 500 records
  if (allocations.length > 500) allocations.splice(0, allocations.length - 500);

  await Promise.all([
    kv.set(KV_LOCATIONS, locations),
    kv.set(KV_ALLOCATIONS, allocations),
  ]);

  return { allocation, locations };
}

export async function listAllocations(
  filters?: { batch_id?: string; limit?: number }
): Promise<AllocationRecord[]> {
  const all = (await kv.get<AllocationRecord[]>(KV_ALLOCATIONS)) || [];
  let filtered = all;
  if (filters?.batch_id) {
    filtered = filtered.filter((a) => a.batch_id === filters.batch_id);
  }
  const limit = filters?.limit || 100;
  return filtered.slice(-limit);
}

// ---------------------------------------------------------------------------
// Notion Sync
// ---------------------------------------------------------------------------

export async function syncInventoryToNotion(): Promise<{ written: number; skipped: number; error?: string }> {
  const dbId = process.env.NOTION_DB_BATCHES;
  if (!dbId) return { written: 0, skipped: 0, error: "NOTION_DB_BATCHES not configured" };

  const token = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!token) return { written: 0, skipped: 0, error: "Notion token not configured" };

  const batches = await listBatches();
  let written = 0;
  let skipped = 0;

  for (const b of batches) {
    try {
      const checkRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          filter: { property: "Name", title: { equals: b.batch_id } },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (checkRes.ok) {
        const checkData = (await checkRes.json()) as { results: unknown[] };
        if (checkData.results.length > 0) {
          skipped++;
          continue;
        }
      }

      const componentJson = JSON.stringify(b.component_costs, null, 2);

      await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          parent: { database_id: dbId },
          properties: {
            Name: { title: [{ text: { content: b.batch_id } }] },
            Vendor: { rich_text: [{ text: { content: b.vendor } }] },
            "Unit Count": { number: b.unit_count },
            "Landed Cost": { number: b.landed_cost },
            "Cost Per Unit": { number: b.cost_per_unit },
            Status: { select: { name: b.status } },
            Location: { select: { name: b.location } },
            ...(b.packaging_config
              ? { "Packaging Config": { rich_text: [{ text: { content: JSON.stringify(b.packaging_config) } }] } }
              : {}),
            ...(b.waste_rate !== undefined
              ? { "Waste Rate": { number: b.waste_rate } }
              : {}),
            ...(b.best_by_date
              ? { "Best-By Date": { date: { start: b.best_by_date } } }
              : {}),
            "Component Costs": { rich_text: [{ text: { content: componentJson.slice(0, 2000) } }] },
            ...(b.notes
              ? { Notes: { rich_text: [{ text: { content: b.notes.slice(0, 2000) } }] } }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      written++;
    } catch (err) {
      console.error(`[inventory] Notion sync failed for batch ${b.batch_id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { written, skipped };
}
