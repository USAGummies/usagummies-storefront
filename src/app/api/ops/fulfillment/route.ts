/**
 * Fulfillment queue — unified "what do we need to ship" surface.
 *
 * Unions four sources so Ben has one screen before packing:
 *   1. Wholesale invoices from QBO (sent + draft + paid, balance > 0 or paid-but-unshipped)
 *   2. DTC orders from Shopify (paid + unfulfilled)
 *   3. Pending-but-not-yet-invoiced commitments (manual overrides; seeded with the
 *      Inderbitzin PO #009180 5-carton remainder Ben committed to Patrick on 2026-03-19)
 *   4. Sample-request queue parsed from Gmail (best-effort: "sample" + address signal)
 *
 * Treats QBO's `Balance == 0` as "paid but we don't know ship status" — so paid
 * invoices from the last 30 days are surfaced as "verify shipped." ShipStation
 * fulfillment cross-ref is a TODO; flagged inline until we wire it.
 */

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

import { isAuthorized } from "@/lib/ops/abra-auth";
import { getQBOInvoices } from "@/lib/ops/qbo-client";
import { queryRecentOrders } from "@/lib/ops/shopify-admin-actions";
import { searchEmails } from "@/lib/ops/gmail-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- "Marked shipped" persistence ---------------------------------------
//
// Fulfillment tracking isn't in QBO (QBO knows invoice+payment, not ship).
// Until we wire ShipStation cross-reference, we keep a KV-backed set of
// items Ben has manually marked shipped. Keys:
//   inv:<qbo-invoice-id>      — e.g. inv:1492 for Inderbitzin #1205
//   pending:<slug>            — e.g. pending:inderbitzin-po-009180-remainder
//   dtc:<shopify-order-id>    — e.g. dtc:gid://shopify/Order/16623047573875
const KV_SHIPPED = "fulfillment:shipped";

export interface ShippedEntry {
  shippedAt: string; // ISO
  tracking?: string;
  notes?: string;
  shippedBy?: string;
}
type ShippedMap = Record<string, ShippedEntry>;

async function getShippedMap(): Promise<ShippedMap> {
  return ((await kv.get<ShippedMap>(KV_SHIPPED)) ?? {}) as ShippedMap;
}

async function markShipped(
  key: string,
  entry: ShippedEntry,
): Promise<ShippedMap> {
  const current = await getShippedMap();
  current[key] = entry;
  await kv.set(KV_SHIPPED, current);
  return current;
}

async function unmarkShipped(key: string): Promise<ShippedMap> {
  const current = await getShippedMap();
  delete current[key];
  await kv.set(KV_SHIPPED, current);
  return current;
}

// ---- Types ---------------------------------------------------------------

export interface WholesaleInvoice {
  id: string;
  docNumber: string | null;
  customer: string;
  txnDate: string | null;
  dueDate: string | null;
  cases: number | null;
  bags: number | null;
  amount: number;
  balance: number;
  status: "outstanding" | "paid" | "draft";
  shipAddr: string | null;
  memo: string | null;
  shipVerifyTodo: boolean;
}

export interface DtcOrder {
  id: string;
  name: string;
  customer: string;
  email: string;
  total: number;
  financialStatus: string;
  fulfillmentStatus: string;
  createdAt: string;
}

export interface ManualPending {
  slug: string;
  customer: string;
  cases: number;
  bags: number;
  reason: string;
  source: string;
  targetShipBy: string | null;
}

export interface SampleLead {
  threadId: string;
  subject: string;
  counterparty: string;
  lastMessageDate: string;
  snippet: string;
  threadLink: string;
  confidence: "high" | "medium" | "low";
}

export interface FulfillmentPayload {
  ok: true;
  generatedAt: string;
  totals: {
    wholesaleCases: number;
    wholesaleBags: number;
    dtcOrders: number;
    manualPendingCases: number;
    manualPendingBags: number;
    samplesPending: number;
    shippableTodayBags: number; // wholesaleBags + manualPendingBags + (DTC count is just count, no bag aggregation at this layer)
  };
  wholesale: WholesaleInvoice[];
  dtc: DtcOrder[];
  manualPending: ManualPending[];
  samples: SampleLead[];
  degraded: string[];
}

// ---- Manual overrides (seed) --------------------------------------------
// Move to KV once Ben+Drew want a UI for this; hardcoded here so tomorrow's
// shipment doesn't miss the Inderbitzin remainder.

const MANUAL_PENDING: ManualPending[] = [
  {
    slug: "inderbitzin-po-009180-remainder",
    customer: "Inderbitzin Distributors, Inc.",
    cases: 5,
    bags: 180,
    reason:
      "PO #009180 remainder: SO was 28 cartons, Invoice #1205 billed first 23. Ben committed the final 5 to Patrick McDonald on 2026-03-19 'within two weeks' as production caught up.",
    source: "Gmail thread 19d0844a668c625f — ben@usagummies.com → patrickm@inderbitzin.com",
    targetShipBy: "2026-04-02",
  },
];

// ---- Handler: GET --------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const degraded: string[] = [];

  const [shipped, wholesaleRaw, dtcRaw, samples] = await Promise.all([
    getShippedMap().catch(() => ({}) as ShippedMap),
    loadWholesale().catch((err) => {
      degraded.push(`wholesale: ${err instanceof Error ? err.message : String(err)}`);
      return [] as WholesaleInvoice[];
    }),
    loadDtc().catch((err) => {
      degraded.push(`dtc: ${err instanceof Error ? err.message : String(err)}`);
      return [] as DtcOrder[];
    }),
    loadSampleQueue().catch((err) => {
      degraded.push(`samples: ${err instanceof Error ? err.message : String(err)}`);
      return [] as SampleLead[];
    }),
  ]);

  const wholesale = wholesaleRaw.filter((w) => !shipped[`inv:${w.id}`]);
  const dtc = dtcRaw.filter((o) => !shipped[`dtc:${o.id}`]);
  const manualPending = MANUAL_PENDING.filter((m) => !shipped[`pending:${m.slug}`]);

  const wholesaleCases = wholesale.reduce((a, w) => a + (w.cases ?? 0), 0);
  const wholesaleBags = wholesale.reduce((a, w) => a + (w.bags ?? 0), 0);
  const manualPendingCases = manualPending.reduce((a, m) => a + m.cases, 0);
  const manualPendingBags = manualPending.reduce((a, m) => a + m.bags, 0);

  const payload: FulfillmentPayload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    totals: {
      wholesaleCases,
      wholesaleBags,
      dtcOrders: dtc.length,
      manualPendingCases,
      manualPendingBags,
      samplesPending: samples.length,
      shippableTodayBags: wholesaleBags + manualPendingBags,
    },
    wholesale,
    dtc,
    manualPending,
    samples,
    degraded,
  };

  return NextResponse.json(payload);
}

// ---- Handler: POST (mark shipped) + DELETE (unmark) ---------------------

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { key?: string; tracking?: string; notes?: string; shippedBy?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const key = body.key?.trim();
  if (!key || !/^(inv|pending|dtc):.+/.test(key)) {
    return NextResponse.json(
      { error: "Missing or malformed 'key' (expected inv:<id> | pending:<slug> | dtc:<id>)" },
      { status: 400 },
    );
  }

  const entry: ShippedEntry = {
    shippedAt: new Date().toISOString(),
    tracking: body.tracking?.trim() || undefined,
    notes: body.notes?.trim() || undefined,
    shippedBy: body.shippedBy?.trim() || undefined,
  };
  const map = await markShipped(key, entry);
  return NextResponse.json({ ok: true, key, entry, shippedCount: Object.keys(map).length });
}

export async function DELETE(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const key = url.searchParams.get("key")?.trim();
  if (!key) {
    return NextResponse.json({ error: "Missing 'key' query param" }, { status: 400 });
  }
  const map = await unmarkShipped(key);
  return NextResponse.json({ ok: true, key, shippedCount: Object.keys(map).length });
}

// ---- Source: QBO invoices -----------------------------------------------

async function loadWholesale(): Promise<WholesaleInvoice[]> {
  // Pull last 90 days so we catch anything paid-but-maybe-not-shipped plus drafts.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const startDate = cutoff.toISOString().split("T")[0];
  const resp = await getQBOInvoices(startDate);
  const raw = (resp?.QueryResponse as { Invoice?: Record<string, unknown>[] } | undefined)?.Invoice ?? [];

  const today = Date.now();
  const paidShipVerifyWindowMs = 30 * 24 * 3600_000; // 30d

  return raw
    .map((inv) => mapInvoice(inv, today, paidShipVerifyWindowMs))
    .filter((inv): inv is WholesaleInvoice => inv !== null)
    .sort((a, b) => {
      // Draft first (block Rene), then unpaid-by-due-date, then paid-verify
      const order = { draft: 0, outstanding: 1, paid: 2 };
      return order[a.status] - order[b.status];
    });
}

function mapInvoice(
  inv: Record<string, unknown>,
  nowMs: number,
  paidVerifyWindowMs: number,
): WholesaleInvoice | null {
  const id = String(inv.Id ?? "");
  if (!id) return null;

  const balance = Number(inv.Balance ?? 0);
  const emailStatus = String(inv.EmailStatus ?? "");
  const printStatus = String(inv.PrintStatus ?? "");
  const deliveryType = (inv.DeliveryInfo as { DeliveryType?: string } | undefined)?.DeliveryType ?? "";
  const wasSent =
    emailStatus === "EmailSent" ||
    emailStatus === "Viewed" ||
    printStatus === "PrintComplete" ||
    deliveryType === "Email";

  let status: WholesaleInvoice["status"];
  if (balance <= 0) status = "paid";
  else if (wasSent) status = "outstanding";
  else status = "draft";

  // Only show paid invoices from the recent window (ship-verify candidates).
  const txnDate = inv.TxnDate ? String(inv.TxnDate) : null;
  if (status === "paid" && txnDate) {
    const ageMs = nowMs - new Date(txnDate).getTime();
    if (ageMs > paidVerifyWindowMs) return null;
  }

  const lines = (inv.Line as Array<Record<string, unknown>> | undefined) ?? [];
  let totalQty = 0;
  for (const l of lines) {
    if (l.DetailType !== "SalesItemLineDetail") continue;
    const detail = l.SalesItemLineDetail as { Qty?: number } | undefined;
    totalQty += Number(detail?.Qty ?? 0);
  }
  // QBO line qty is UNITS (bags); cases = units / 36 when product is the retail bag.
  // For the Trade Show SKU (also bags), same rule. If a line is already a case,
  // the SKU is unusual — we conservatively keep the division and round.
  const bags = totalQty > 0 ? totalQty : null;
  const cases = bags !== null ? Math.round((bags / 36) * 100) / 100 : null;

  const ship = inv.ShipAddr as Record<string, string> | undefined;
  const shipAddr = ship
    ? [ship.Line1, ship.Line2, ship.Line3, ship.Line4, ship.City, ship.PostalCode]
        .filter(Boolean)
        .join(", ")
    : null;

  return {
    id,
    docNumber: (inv.DocNumber as string | undefined) ?? null,
    customer: ((inv.CustomerRef as { name?: string } | undefined)?.name) ?? "(unknown)",
    txnDate,
    dueDate: (inv.DueDate as string | undefined) ?? null,
    cases,
    bags,
    amount: Number(inv.TotalAmt ?? 0),
    balance,
    status,
    shipAddr,
    memo: ((inv.CustomerMemo as { value?: string } | undefined)?.value) ?? null,
    shipVerifyTodo: status === "paid",
  };
}

// ---- Source: Shopify DTC -------------------------------------------------

async function loadDtc(): Promise<DtcOrder[]> {
  const orders = await queryRecentOrders({ status: "open", days: 30, limit: 50 });
  return orders
    .filter(
      (o) =>
        o.fulfillmentStatus.toUpperCase() === "UNFULFILLED" &&
        ["PAID", "PARTIALLY_PAID"].includes(o.financialStatus.toUpperCase()),
    )
    .map((o) => ({
      id: o.id,
      name: o.name,
      customer: o.customerName,
      email: o.customerEmail,
      total: o.totalAmount,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      createdAt: o.createdAt,
    }));
}

// ---- Source: Gmail sample queue -----------------------------------------
//
// Heuristic:
//   - Last 21 days
//   - Threads where counterparty (not us) is providing a shipping address OR asking
//     for samples AND we've acknowledged with an address.
//   - Exclude threads that say "already shipped" / "tracking" / "arrived".
// This is best-effort — confidence flag on each lead lets the UI call out
// uncertainty. Move to a proper Gmail-label-based queue once Drew or Ben
// tags a sample thread as `USA/Samples/ToShip`.

async function loadSampleQueue(): Promise<SampleLead[]> {
  const query =
    '(sample OR samples) AND (address OR "ship to" OR "send") newer_than:21d -is:sent -from:ben@usagummies.com';
  const msgs = await searchEmails(query, 15);

  const results: SampleLead[] = [];
  for (const msg of msgs) {
    const subj = msg.subject ?? "";
    const from = msg.from ?? "";
    // EmailMessage has `body` (plain text). Use the first ~300 chars as a snippet.
    const snippet = (msg.body ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const date = msg.date ? new Date(msg.date).toISOString() : new Date().toISOString();

    if (isAlreadyShippedSignal(subj + " " + snippet)) continue;

    const confidence = hasAddressSignal(snippet) ? "high" : hasSampleAskSignal(snippet) ? "medium" : "low";

    results.push({
      threadId: msg.threadId ?? msg.id ?? "",
      subject: subj.slice(0, 140),
      counterparty: from.slice(0, 120),
      lastMessageDate: date,
      snippet: snippet.slice(0, 200),
      threadLink: msg.threadId
        ? `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`
        : "",
      confidence,
    });
  }

  // Dedupe by threadId
  const seen = new Set<string>();
  return results.filter((r) => {
    if (!r.threadId) return true;
    if (seen.has(r.threadId)) return false;
    seen.add(r.threadId);
    return true;
  });
}

function isAlreadyShippedSignal(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("tracking number") ||
    t.includes("arrived") ||
    t.includes("received the samples") ||
    t.includes("got the samples")
  );
}

function hasAddressSignal(text: string): boolean {
  // Very loose US-address heuristic: "street|road|ave|blvd" + 5-digit zip
  return /\b(street|road|rd\.?|ave\.?|avenue|blvd|boulevard|dr\.?|drive|lane|ln\.?|way|parkway)\b/i.test(text) &&
    /\b\d{5}(?:-\d{4})?\b/.test(text);
}

function hasSampleAskSignal(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes("send samples") || t.includes("please send") || t.includes("sample request") || t.includes("able to send");
}
