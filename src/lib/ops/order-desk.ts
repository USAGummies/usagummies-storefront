/**
 * ORDER DESK — Order & Fulfillment Tracking for USA Gummies
 *
 * Manages order-to-shipment mapping, channel tagging, PO parsing,
 * shipping cost allocation, and sample tracking. Feeds data to
 * LEDGER (cost routing) and INVENTORY (decrement on ship).
 *
 * Data persisted in Vercel KV under orders:* keys.
 * Syncs to Notion Shipments & Fulfillment DB.
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Channel =
  | "Amazon"
  | "DTC"
  | "Faire"
  | "Inderbitzin"
  | "Glacier"
  | "Wholesale"
  | "Sample"
  | "Other";

export type OrderStatus =
  | "received"
  | "processing"
  | "fulfilled"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned";

export type PackagingFormat =
  | "singles"
  | "3-pack"
  | "6-pack-clip-strip"
  | "36-case"
  | "pallet"
  | "custom";

export interface POLineItem {
  sku: string;
  description: string;
  quantity: number;
  unit_price: number;
  packaging_format: PackagingFormat;
  total: number;
}

export interface Order {
  id: string;
  channel: Channel;
  order_ref: string; // Shopify order #, PO #, etc.
  customer_name: string;
  ship_to?: string;
  date: string; // ISO date
  units: number;
  subtotal: number;
  shipping_charged?: number; // what customer paid for shipping
  tax?: number;
  total: number;
  terms?: string; // e.g. "Net 30", "Prepaid"
  po_details?: POLineItem[];
  packaging_format?: PackagingFormat;
  status: OrderStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Fulfillment {
  id: string;
  order_id: string; // links to Order.id
  shipment_id?: string; // links to FREIGHT shipment
  carrier: string;
  tracking_number?: string;
  shipping_cost: number; // our actual cost to ship
  fulfillment_source: string; // "Pirate Ship", "FBA", "Powers direct"
  pirate_ship_label_id?: string;
  fba_shipment_id?: string;
  units_shipped: number;
  date: string; // ISO date
  status: "pending" | "shipped" | "delivered" | "exception";
  notes?: string;
  created_at: string;
}

export interface SampleSend {
  id: string;
  recipient: string;
  company?: string;
  address: string;
  units: number;
  packaging_format: PackagingFormat;
  purpose: string; // "buyer sample", "trade show", "gift", etc.
  carrier?: string;
  tracking_number?: string;
  shipping_cost: number;
  date: string;
  notes?: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// KV Keys
// ---------------------------------------------------------------------------

const KV_ORDERS = "orders:log";
const KV_FULFILLMENTS = "orders:fulfillments";
const KV_SAMPLES = "orders:samples";

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function listOrders(
  filters?: { channel?: Channel; status?: OrderStatus; limit?: number }
): Promise<Order[]> {
  const all = (await kv.get<Order[]>(KV_ORDERS)) || [];
  let filtered = all;
  if (filters?.channel) {
    filtered = filtered.filter((o) => o.channel === filters.channel);
  }
  if (filters?.status) {
    filtered = filtered.filter((o) => o.status === filters.status);
  }
  const limit = filters?.limit || 200;
  return filtered.slice(-limit);
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const all = (await kv.get<Order[]>(KV_ORDERS)) || [];
  return all.find((o) => o.id === orderId) || null;
}

export async function upsertOrder(
  input: Omit<Order, "created_at" | "updated_at"> & { created_at?: string; updated_at?: string }
): Promise<Order> {
  const all = (await kv.get<Order[]>(KV_ORDERS)) || [];
  const now = new Date().toISOString();
  const idx = all.findIndex((o) => o.id === input.id);

  const order: Order = {
    ...input,
    created_at: idx >= 0 ? all[idx].created_at : (input.created_at || now),
    updated_at: now,
  };

  if (idx >= 0) {
    all[idx] = order;
  } else {
    all.push(order);
  }

  // Cap at 1000 orders
  if (all.length > 1000) all.splice(0, all.length - 1000);

  await kv.set(KV_ORDERS, all);
  return order;
}

export async function getOrdersByChannel(): Promise<Record<Channel, { count: number; total_revenue: number; total_units: number }>> {
  const all = (await kv.get<Order[]>(KV_ORDERS)) || [];
  const result: Record<string, { count: number; total_revenue: number; total_units: number }> = {};

  for (const order of all) {
    if (!result[order.channel]) {
      result[order.channel] = { count: 0, total_revenue: 0, total_units: 0 };
    }
    result[order.channel].count++;
    result[order.channel].total_revenue += order.total;
    result[order.channel].total_units += order.units;
  }

  return result as Record<Channel, { count: number; total_revenue: number; total_units: number }>;
}

// ---------------------------------------------------------------------------
// Fulfillments
// ---------------------------------------------------------------------------

export async function listFulfillments(
  filters?: { order_id?: string; limit?: number }
): Promise<Fulfillment[]> {
  const all = (await kv.get<Fulfillment[]>(KV_FULFILLMENTS)) || [];
  let filtered = all;
  if (filters?.order_id) {
    filtered = filtered.filter((f) => f.order_id === filters.order_id);
  }
  const limit = filters?.limit || 200;
  return filtered.slice(-limit);
}

export async function fulfillOrder(input: Omit<Fulfillment, "created_at"> & { created_at?: string }): Promise<Fulfillment> {
  const all = (await kv.get<Fulfillment[]>(KV_FULFILLMENTS)) || [];
  const now = new Date().toISOString();

  const fulfillment: Fulfillment = {
    ...input,
    created_at: input.created_at || now,
  };

  // Check if this fulfillment already exists (by id)
  const idx = all.findIndex((f) => f.id === input.id);
  if (idx >= 0) {
    all[idx] = fulfillment;
  } else {
    all.push(fulfillment);
  }

  // Cap at 1000
  if (all.length > 1000) all.splice(0, all.length - 1000);

  await kv.set(KV_FULFILLMENTS, all);

  // Update order status
  const orders = (await kv.get<Order[]>(KV_ORDERS)) || [];
  const orderIdx = orders.findIndex((o) => o.id === input.order_id);
  if (orderIdx >= 0) {
    orders[orderIdx].status = "shipped";
    orders[orderIdx].updated_at = now;
    await kv.set(KV_ORDERS, orders);
  }

  return fulfillment;
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

export async function listSamples(
  filters?: { limit?: number }
): Promise<SampleSend[]> {
  const all = (await kv.get<SampleSend[]>(KV_SAMPLES)) || [];
  const limit = filters?.limit || 100;
  return all.slice(-limit);
}

export async function addSample(
  input: Omit<SampleSend, "created_at"> & { created_at?: string }
): Promise<SampleSend> {
  const all = (await kv.get<SampleSend[]>(KV_SAMPLES)) || [];
  const now = new Date().toISOString();

  const sample: SampleSend = {
    ...input,
    created_at: input.created_at || now,
  };

  all.push(sample);

  // Cap at 500
  if (all.length > 500) all.splice(0, all.length - 500);

  await kv.set(KV_SAMPLES, all);
  return sample;
}

export async function getSampleSummary(): Promise<{
  total_samples: number;
  total_units: number;
  total_shipping_cost: number;
  by_purpose: Record<string, { count: number; units: number }>;
}> {
  const all = (await kv.get<SampleSend[]>(KV_SAMPLES)) || [];
  const byPurpose: Record<string, { count: number; units: number }> = {};

  let totalUnits = 0;
  let totalShippingCost = 0;

  for (const s of all) {
    totalUnits += s.units;
    totalShippingCost += s.shipping_cost;
    if (!byPurpose[s.purpose]) byPurpose[s.purpose] = { count: 0, units: 0 };
    byPurpose[s.purpose].count++;
    byPurpose[s.purpose].units += s.units;
  }

  return {
    total_samples: all.length,
    total_units: totalUnits,
    total_shipping_cost: totalShippingCost,
    by_purpose: byPurpose,
  };
}

// ---------------------------------------------------------------------------
// Notion Sync
// ---------------------------------------------------------------------------

export async function syncOrderDeskToNotion(): Promise<{ written: number; skipped: number; error?: string }> {
  const dbId = process.env.NOTION_DB_SHIPMENTS;
  if (!dbId) return { written: 0, skipped: 0, error: "NOTION_DB_SHIPMENTS not configured" };

  const token = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!token) return { written: 0, skipped: 0, error: "Notion token not configured" };

  const fulfillments = await listFulfillments();
  let written = 0;
  let skipped = 0;

  for (const f of fulfillments) {
    try {
      // Get the linked order for context
      const order = await getOrder(f.order_id);

      const checkRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          filter: { property: "Name", title: { equals: f.id } },
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
            Name: { title: [{ text: { content: f.id } }] },
            "Order Ref": { rich_text: [{ text: { content: order?.order_ref || f.order_id } }] },
            Channel: { select: { name: order?.channel || "Other" } },
            ...(order?.po_details
              ? { "PO Details": { rich_text: [{ text: { content: JSON.stringify(order.po_details).slice(0, 2000) } }] } }
              : {}),
            ...(order?.packaging_format
              ? { "Packaging Format": { select: { name: order.packaging_format } } }
              : {}),
            ...(order?.ship_to
              ? { "Ship To": { rich_text: [{ text: { content: order.ship_to } }] } }
              : {}),
            Carrier: { rich_text: [{ text: { content: f.carrier } }] },
            ...(f.tracking_number
              ? { "Tracking Number": { rich_text: [{ text: { content: f.tracking_number } }] } }
              : {}),
            "Shipping Cost": { number: f.shipping_cost },
            "Fulfillment Source": { rich_text: [{ text: { content: f.fulfillment_source } }] },
            Status: { select: { name: f.status } },
            Date: { date: { start: f.date } },
            ...(f.notes
              ? { Notes: { rich_text: [{ text: { content: f.notes.slice(0, 2000) } }] } }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      written++;
    } catch (err) {
      console.error(`[order-desk] Notion sync failed for fulfillment ${f.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return { written, skipped };
}
