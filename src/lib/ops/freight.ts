/**
 * FREIGHT — Shipping & Logistics tracking for USA Gummies.
 *
 * Tracks ALL shipping activity across channels: DTC fulfillment, Faire orders,
 * FBA inbound, wholesale PO fulfillment, distributor restocking, sample mailers,
 * warehouse transfers, and raw material shipments.
 *
 * Persistence: Vercel KV (index at `freight:index`, records at `freight:{id}`).
 */
import { kv } from "@vercel/kv";
import { adminRequest } from "@/lib/shopify/admin";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShipmentChannel =
  | "DTC"
  | "FBA Inbound"
  | "Wholesale B2B"
  | "Distributor"
  | "Faire"
  | "Sample"
  | "Internal Transfer"
  | "Raw Material";

export type ShipmentStatus =
  | "Label Created"
  | "Picked Up"
  | "In Transit"
  | "Delivered"
  | "Exception"
  | "Returned";

export type DestinationType =
  | "Customer DTC"
  | "FBA Warehouse"
  | "Co-Packer"
  | "Our Warehouse"
  | "Distributor"
  | "Retailer"
  | "Sample Prospect"
  | "Broker";

export type CarrierType =
  | "Pirate Ship"
  | "USPS"
  | "UPS"
  | "FedEx"
  | "LTL Freight"
  | "Self-Haul";

export type Shipment = {
  shipment_id: string;
  order_reference: string;
  ship_date: string;
  carrier: CarrierType;
  tracking_number: string;
  destination_name: string;
  destination_type: DestinationType;
  channel: ShipmentChannel;
  units_shipped: number;
  weight_lbs?: number;
  shipping_cost: number;
  cost_per_unit?: number;
  status: ShipmentStatus;
  source_system: "Pirate Ship" | "Shopify" | "Amazon FBA" | "Manual";
  related_production?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type ShipmentFilters = {
  channel?: ShipmentChannel;
  status?: ShipmentStatus;
  start_date?: string;
  end_date?: string;
};

// ---------------------------------------------------------------------------
// KV keys
// ---------------------------------------------------------------------------

const INDEX_KEY = "freight:index";
function shipmentKey(id: string) {
  return `freight:${id}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createShipment(
  input: Omit<Shipment, "shipment_id" | "cost_per_unit" | "created_at" | "updated_at">,
): Promise<Shipment> {
  const now = new Date().toISOString();
  const shipment: Shipment = {
    ...input,
    shipment_id: crypto.randomUUID(),
    cost_per_unit:
      input.units_shipped > 0
        ? Math.round((input.shipping_cost / input.units_shipped) * 100) / 100
        : undefined,
    created_at: now,
    updated_at: now,
  };

  await kv.set(shipmentKey(shipment.shipment_id), shipment);

  const index = (await kv.get<string[]>(INDEX_KEY)) || [];
  index.push(shipment.shipment_id);
  await kv.set(INDEX_KEY, index);

  return shipment;
}

export async function updateShipment(
  shipment_id: string,
  updates: Partial<Omit<Shipment, "shipment_id" | "created_at">>,
): Promise<Shipment | null> {
  const existing = await kv.get<Shipment>(shipmentKey(shipment_id));
  if (!existing) return null;

  const merged: Shipment = {
    ...existing,
    ...updates,
    shipment_id,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  };

  // Recalculate cost_per_unit
  if (merged.units_shipped > 0) {
    merged.cost_per_unit =
      Math.round((merged.shipping_cost / merged.units_shipped) * 100) / 100;
  }

  await kv.set(shipmentKey(shipment_id), merged);
  return merged;
}

export async function getShipments(filters?: ShipmentFilters): Promise<Shipment[]> {
  const index = (await kv.get<string[]>(INDEX_KEY)) || [];
  if (!index.length) return [];

  const pipeline = kv.pipeline();
  for (const id of index) {
    pipeline.get(shipmentKey(id));
  }
  const results = await pipeline.exec();

  let shipments = (results as (Shipment | null)[]).filter(
    (s): s is Shipment => s !== null,
  );

  if (filters?.channel) {
    shipments = shipments.filter((s) => s.channel === filters.channel);
  }
  if (filters?.status) {
    shipments = shipments.filter((s) => s.status === filters.status);
  }
  if (filters?.start_date) {
    shipments = shipments.filter((s) => s.ship_date >= filters.start_date!);
  }
  if (filters?.end_date) {
    shipments = shipments.filter((s) => s.ship_date <= filters.end_date!);
  }

  return shipments.sort(
    (a, b) => new Date(b.ship_date).getTime() - new Date(a.ship_date).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Cost Aggregation
// ---------------------------------------------------------------------------

type CostBucket = {
  group: string;
  total_cost: number;
  total_units: number;
  shipment_count: number;
  avg_cost_per_unit: number;
};

export async function getShippingCostsByChannel(
  start_date: string,
  end_date: string,
): Promise<CostBucket[]> {
  const shipments = await getShipments({ start_date, end_date });
  return aggregateCosts(shipments, "channel");
}

export async function getShippingCostsByCarrier(
  start_date: string,
  end_date: string,
): Promise<CostBucket[]> {
  const shipments = await getShipments({ start_date, end_date });
  return aggregateCosts(shipments, "carrier");
}

function aggregateCosts(
  shipments: Shipment[],
  groupBy: "channel" | "carrier",
): CostBucket[] {
  const buckets = new Map<string, { cost: number; units: number; count: number }>();

  for (const s of shipments) {
    const key = s[groupBy];
    const bucket = buckets.get(key) || { cost: 0, units: 0, count: 0 };
    bucket.cost += s.shipping_cost;
    bucket.units += s.units_shipped;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .map(([group, b]) => ({
      group,
      total_cost: Math.round(b.cost * 100) / 100,
      total_units: b.units,
      shipment_count: b.count,
      avg_cost_per_unit:
        b.units > 0 ? Math.round((b.cost / b.units) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.total_cost - a.total_cost);
}

// ---------------------------------------------------------------------------
// Shopify Fulfillment Sync
// ---------------------------------------------------------------------------

const FULFILLMENTS_QUERY = /* GraphQL */ `
  query recentFulfillments($query: String!, $first: Int!) {
    orders(query: $query, first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        fulfillments {
          id
          createdAt
          status
          trackingInfo {
            company
            number
            url
          }
          fulfillmentLineItems(first: 50) {
            nodes {
              quantity
            }
          }
        }
      }
    }
  }
`;

interface ShopifyFulfillmentData {
  orders: {
    nodes: Array<{
      id: string;
      name: string;
      createdAt: string;
      fulfillments: Array<{
        id: string;
        createdAt: string;
        status: string;
        trackingInfo: Array<{
          company: string | null;
          number: string | null;
          url: string | null;
        }>;
        fulfillmentLineItems: {
          nodes: Array<{ quantity: number }>;
        };
      }>;
    }>;
  };
}

function mapShopifyCarrier(company: string | null): CarrierType {
  if (!company) return "USPS";
  const c = company.toLowerCase();
  if (c.includes("ups")) return "UPS";
  if (c.includes("fedex")) return "FedEx";
  if (c.includes("pirate")) return "Pirate Ship";
  if (c.includes("usps") || c.includes("postal")) return "USPS";
  return "USPS";
}

function mapShopifyStatus(status: string): ShipmentStatus {
  switch (status.toUpperCase()) {
    case "SUCCESS":
      return "Delivered";
    case "IN_TRANSIT":
      return "In Transit";
    case "FAILURE":
    case "ERROR":
      return "Exception";
    case "CANCELLED":
      return "Returned";
    default:
      return "Label Created";
  }
}

export async function syncFromShopify(
  lookbackDays = 30,
): Promise<{ synced: number; errors: string[] }> {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const sinceStr = since.toISOString().slice(0, 10);

  const result = await adminRequest<ShopifyFulfillmentData>(FULFILLMENTS_QUERY, {
    query: `created_at:>=${sinceStr} fulfillment_status:shipped`,
    first: 50,
  });

  if (!result.ok || !result.data) {
    return { synced: 0, errors: [result.error || "Shopify query failed"] };
  }

  const existingShipments = await getShipments();
  const existingRefs = new Set(
    existingShipments
      .filter((s) => s.source_system === "Shopify")
      .map((s) => s.order_reference),
  );

  let synced = 0;
  const errors: string[] = [];

  for (const order of result.data.orders.nodes) {
    for (const ful of order.fulfillments) {
      // Skip if we already have this order synced
      if (existingRefs.has(order.name)) continue;

      const tracking = ful.trackingInfo?.[0];
      const totalUnits = ful.fulfillmentLineItems.nodes.reduce(
        (sum, li) => sum + li.quantity,
        0,
      );

      try {
        await createShipment({
          order_reference: order.name,
          ship_date: ful.createdAt.slice(0, 10),
          carrier: mapShopifyCarrier(tracking?.company ?? null),
          tracking_number: tracking?.number || "",
          destination_name: "Shopify Customer",
          destination_type: "Customer DTC",
          channel: "DTC",
          units_shipped: totalUnits,
          shipping_cost: 0, // Shopify doesn't expose carrier cost in fulfillment
          status: mapShopifyStatus(ful.status),
          source_system: "Shopify",
          notes: `Shopify fulfillment ${ful.id}`,
        });
        synced++;
      } catch (err) {
        errors.push(
          `Failed to sync ${order.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return { synced, errors };
}

// ---------------------------------------------------------------------------
// Notion Sync (stub — will be wired via ARCHIVE)
// ---------------------------------------------------------------------------

export async function syncFreightToNotion(): Promise<{ ok: boolean; message: string }> {
  // Stub — will push shipment records to a Notion database
  return { ok: false, message: "Notion sync not yet implemented" };
}
