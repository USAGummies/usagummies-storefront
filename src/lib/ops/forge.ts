/**
 * FORGE — Production & Supply Chain Tracking
 *
 * Core module for tracking production runs at co-packers (e.g., Powers Confections)
 * and material shipments (candy, film, freight) through the supply chain.
 *
 * Data persisted in Vercel KV under keys:
 *   forge:runs      — ProductionRun[]
 *   forge:shipments — MaterialShipment[]
 */
import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProductionRun {
  batch_id: string;
  co_packer: string;
  status: "Planned" | "Running" | "Complete" | "On Hold" | "Cancelled";
  target_units: number;
  actual_units: number | null;
  start_date: string; // ISO date
  end_date?: string | null;
  candy_cost: number;
  film_cost: number;
  co_pack_labor: number;
  freight_in: number;
  other_costs: number;
  candy_lot: string;
  film_lot: string;
  invoice_ref: string;
  destination: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface MaterialShipment {
  shipment_id: string;
  material_type: string;
  supplier: string;
  destination: string;
  ship_date: string;
  eta?: string | null;
  received_date?: string | null;
  carrier: string;
  tracking_number?: string;
  freight_cost: number;
  material_cost: number;
  quantity: string;
  related_run: string;
  status: "Pending" | "In Transit" | "Received" | "Delayed" | "Cancelled";
  invoice_number: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// Computed view returned by GET endpoints
export interface ProductionRunView extends ProductionRun {
  total_cost: number;
  cost_per_unit: number | null;
  yield_pct: number | null;
}

export interface MaterialShipmentView extends MaterialShipment {
  total_cost: number;
}

// ---------------------------------------------------------------------------
// KV keys
// ---------------------------------------------------------------------------

const KV_RUNS = "forge:runs";
const KV_SHIPMENTS = "forge:shipments";

// ---------------------------------------------------------------------------
// Calculated-field helpers
// ---------------------------------------------------------------------------

export function totalCost(run: ProductionRun): number {
  return run.candy_cost + run.film_cost + run.co_pack_labor + run.freight_in + run.other_costs;
}

export function costPerUnit(run: ProductionRun): number | null {
  const units = run.actual_units ?? run.target_units;
  if (!units || units === 0) return null;
  return Math.round((totalCost(run) / units) * 100) / 100;
}

export function yieldPct(run: ProductionRun): number | null {
  if (run.actual_units == null || !run.target_units) return null;
  return Math.round((run.actual_units / run.target_units) * 10000) / 100;
}

export function shipmentTotalCost(s: MaterialShipment): number {
  return s.material_cost + s.freight_cost;
}

function toRunView(run: ProductionRun): ProductionRunView {
  return {
    ...run,
    total_cost: totalCost(run),
    cost_per_unit: costPerUnit(run),
    yield_pct: yieldPct(run),
  };
}

function toShipmentView(s: MaterialShipment): MaterialShipmentView {
  return { ...s, total_cost: shipmentTotalCost(s) };
}

// ---------------------------------------------------------------------------
// CRUD — Production Runs
// ---------------------------------------------------------------------------

export async function listRuns(): Promise<ProductionRunView[]> {
  const runs = (await kv.get<ProductionRun[]>(KV_RUNS)) ?? [];
  return runs.map(toRunView);
}

export async function upsertRun(data: Omit<ProductionRun, "created_at" | "updated_at">): Promise<ProductionRunView> {
  const runs = (await kv.get<ProductionRun[]>(KV_RUNS)) ?? [];
  const now = new Date().toISOString();
  const idx = runs.findIndex((r) => r.batch_id === data.batch_id);

  let run: ProductionRun;
  if (idx >= 0) {
    run = { ...runs[idx], ...data, updated_at: now };
    runs[idx] = run;
  } else {
    run = { ...data, created_at: now, updated_at: now };
    runs.push(run);
  }

  await kv.set(KV_RUNS, runs);
  return toRunView(run);
}

// ---------------------------------------------------------------------------
// CRUD — Material Shipments
// ---------------------------------------------------------------------------

export async function listShipments(): Promise<MaterialShipmentView[]> {
  const shipments = (await kv.get<MaterialShipment[]>(KV_SHIPMENTS)) ?? [];
  return shipments.map(toShipmentView);
}

export async function upsertShipment(
  data: Omit<MaterialShipment, "created_at" | "updated_at">,
): Promise<MaterialShipmentView> {
  const shipments = (await kv.get<MaterialShipment[]>(KV_SHIPMENTS)) ?? [];
  const now = new Date().toISOString();
  const idx = shipments.findIndex((s) => s.shipment_id === data.shipment_id);

  let shipment: MaterialShipment;
  if (idx >= 0) {
    shipment = { ...shipments[idx], ...data, updated_at: now };
    shipments[idx] = shipment;
  } else {
    shipment = { ...data, created_at: now, updated_at: now };
    shipments.push(shipment);
  }

  await kv.set(KV_SHIPMENTS, shipments);
  return toShipmentView(shipment);
}

// ---------------------------------------------------------------------------
// Notion sync (stub — will be wired up later)
// ---------------------------------------------------------------------------

export async function syncForgeToNotion(): Promise<{ synced_runs: number; synced_shipments: number }> {
  const runs = (await kv.get<ProductionRun[]>(KV_RUNS)) ?? [];
  const shipments = (await kv.get<MaterialShipment[]>(KV_SHIPMENTS)) ?? [];

  // TODO: Create/update Notion database pages for each run and shipment.
  // Will use the Notion MCP tools or Notion API client when databases are provisioned.

  return { synced_runs: runs.length, synced_shipments: shipments.length };
}
