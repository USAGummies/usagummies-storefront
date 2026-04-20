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

// ---- Stage machine persistence ------------------------------------------
//
// Fulfillment tracking isn't in QBO (QBO knows invoice+payment, not ship).
// We keep a KV-backed stage state per shippable item:
//   received → packed → ready → shipped
//
// Key format (stable across schema changes):
//   inv:<qbo-invoice-id>      — e.g. inv:1492 for Inderbitzin #1205
//   pending:<slug>            — e.g. pending:inderbitzin-po-009180-remainder
//   dtc:<shopify-order-id>    — e.g. dtc:gid://shopify/Order/16623047573875
//   sample:<slug>             — Phase 1d: manual sample-ship entries
//
// Backwards-compat note: `fulfillment:shipped` (binary map) is the
// pre-stage schema; we lazy-migrate on first read so the Inderbitzin
// #1205 entry that was written before the stage rollout still drops off
// the queue correctly.
const KV_STAGES = "fulfillment:stages";
const KV_SHIPPED_LEGACY = "fulfillment:shipped";

export type Stage = "received" | "packed" | "ready" | "shipped";

export interface StageEntry {
  stage: Stage;
  cartonsRequired: number;
  cartonsPacked: number;
  tracking?: string;
  labelUrl?: string;
  labelCost?: number;
  carrier?: string;
  service?: string;
  notes?: string;
  receivedAt: string;
  packedAt?: string;
  readyAt?: string;
  shippedAt?: string;
  updatedBy?: string;
  updatedAt: string;
}

export interface LegacyShippedEntry {
  shippedAt: string;
  tracking?: string;
  notes?: string;
  shippedBy?: string;
}

type StageMap = Record<string, StageEntry>;
type LegacyShippedMap = Record<string, LegacyShippedEntry>;

function legacyToStage(l: LegacyShippedEntry): StageEntry {
  return {
    stage: "shipped",
    cartonsRequired: 0,
    cartonsPacked: 0,
    tracking: l.tracking,
    notes: l.notes,
    receivedAt: l.shippedAt,
    shippedAt: l.shippedAt,
    updatedBy: l.shippedBy,
    updatedAt: l.shippedAt,
  };
}

async function getStageMap(): Promise<StageMap> {
  const [stagesRaw, legacyRaw] = await Promise.all([
    kv.get<StageMap>(KV_STAGES),
    kv.get<LegacyShippedMap>(KV_SHIPPED_LEGACY),
  ]);
  const stages: StageMap = { ...(stagesRaw ?? {}) };
  // Legacy entries fill in any keys not yet present in the new schema.
  for (const [k, v] of Object.entries(legacyRaw ?? {})) {
    if (!stages[k]) stages[k] = legacyToStage(v);
  }
  return stages;
}

async function writeStage(key: string, entry: StageEntry): Promise<StageMap> {
  const current = await getStageMap();
  current[key] = entry;
  await kv.set(KV_STAGES, current);
  return current;
}

async function removeStage(key: string): Promise<StageMap> {
  const [stagesRaw, legacyRaw] = await Promise.all([
    kv.get<StageMap>(KV_STAGES),
    kv.get<LegacyShippedMap>(KV_SHIPPED_LEGACY),
  ]);
  const stages: StageMap = { ...(stagesRaw ?? {}) };
  delete stages[key];
  const legacy: LegacyShippedMap = { ...(legacyRaw ?? {}) };
  if (legacy[key]) {
    delete legacy[key];
    await kv.set(KV_SHIPPED_LEGACY, legacy);
  }
  await kv.set(KV_STAGES, stages);
  // Re-merge legacy entries for anything we didn't just remove.
  return getStageMap();
}

// ---- Types ---------------------------------------------------------------

export interface WholesaleInvoice {
  key: string; // "inv:<id>"
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
  stage: StageEntry;
}

export interface DtcOrder {
  key: string; // "dtc:<shopify-gid>"
  id: string;
  name: string;
  customer: string;
  email: string;
  total: number;
  financialStatus: string;
  fulfillmentStatus: string;
  createdAt: string;
  stage: StageEntry;
}

export interface ManualPending {
  key: string; // "pending:<slug>"
  slug: string;
  customer: string;
  cases: number;
  bags: number;
  reason: string;
  source: string;
  targetShipBy: string | null;
  stage: StageEntry;
}

export interface SampleShip {
  key: string; // "sample:<slug>"
  slug: string;
  recipient: string;
  company: string | null;
  address: string;
  bags: number;
  purpose: string;
  sourceThreadLink: string | null;
  createdAt: string;
  stage: StageEntry;
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
    sampleShips: number;
    sampleBags: number;
    samplesPending: number; // Gmail leads (unqueued)
    shippableTodayBags: number;
    byStage: Record<Stage, number>;
  };
  wholesale: WholesaleInvoice[];
  dtc: DtcOrder[];
  manualPending: ManualPending[];
  sampleShips: SampleShip[];
  samples: SampleLead[];
  degraded: string[];
}

// ---- Default stage + carton-required inference --------------------------

function defaultStage(now: string, cartonsRequired = 0): StageEntry {
  return {
    stage: "received",
    cartonsRequired,
    cartonsPacked: 0,
    receivedAt: now,
    updatedAt: now,
  };
}

function resolveStage(
  key: string,
  cartonsRequired: number,
  map: StageMap,
  now: string,
): StageEntry {
  const existing = map[key];
  if (!existing) return defaultStage(now, cartonsRequired);
  // Back-fill cartonsRequired if the source changed after creation.
  if (!existing.cartonsRequired && cartonsRequired > 0) {
    return { ...existing, cartonsRequired };
  }
  return existing;
}

// ---- Manual overrides (seed) --------------------------------------------
// Move to KV once Ben+Drew want a UI for this; hardcoded here so tomorrow's
// shipment doesn't miss the Inderbitzin remainder.

type ManualPendingSeed = Omit<ManualPending, "key" | "stage">;

const MANUAL_PENDING: ManualPendingSeed[] = [
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

// ---- Sample ship entries (Phase 1d) -------------------------------------

const KV_SAMPLE_SHIPS = "fulfillment:samples";

export interface SampleShipSeed {
  slug: string;
  recipient: string;
  company: string | null;
  address: string;
  bags: number;
  purpose: string;
  sourceThreadLink: string | null;
  createdAt: string;
}
type SampleShipMap = Record<string, SampleShipSeed>;

async function getSampleShips(): Promise<SampleShipSeed[]> {
  const raw = (await kv.get<SampleShipMap>(KV_SAMPLE_SHIPS)) ?? {};
  return Object.values(raw).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function writeSampleShip(seed: SampleShipSeed): Promise<SampleShipSeed> {
  const current = ((await kv.get<SampleShipMap>(KV_SAMPLE_SHIPS)) ?? {}) as SampleShipMap;
  current[seed.slug] = seed;
  await kv.set(KV_SAMPLE_SHIPS, current);
  return seed;
}

async function removeSampleShip(slug: string): Promise<void> {
  const current = ((await kv.get<SampleShipMap>(KV_SAMPLE_SHIPS)) ?? {}) as SampleShipMap;
  if (!current[slug]) return;
  delete current[slug];
  await kv.set(KV_SAMPLE_SHIPS, current);
}

function slugifyRecipient(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ---- Handler: GET --------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const degraded: string[] = [];
  const now = new Date().toISOString();

  const [stages, wholesaleRaw, dtcRaw, samples, sampleShipSeeds] = await Promise.all([
    getStageMap().catch(() => ({}) as StageMap),
    loadWholesale().catch((err) => {
      degraded.push(`wholesale: ${err instanceof Error ? err.message : String(err)}`);
      return [] as WholesaleInvoiceRaw[];
    }),
    loadDtc().catch((err) => {
      degraded.push(`dtc: ${err instanceof Error ? err.message : String(err)}`);
      return [] as DtcOrderRaw[];
    }),
    loadSampleQueue().catch((err) => {
      degraded.push(`samples: ${err instanceof Error ? err.message : String(err)}`);
      return [] as SampleLead[];
    }),
    getSampleShips().catch((err) => {
      degraded.push(`sample-ships: ${err instanceof Error ? err.message : String(err)}`);
      return [] as SampleShipSeed[];
    }),
  ]);

  const wholesale: WholesaleInvoice[] = wholesaleRaw.map((w) => ({
    ...w,
    key: `inv:${w.id}`,
    stage: resolveStage(`inv:${w.id}`, w.cases ?? 0, stages, now),
  }));
  const dtc: DtcOrder[] = dtcRaw.map((o) => ({
    ...o,
    key: `dtc:${o.id}`,
    stage: resolveStage(`dtc:${o.id}`, 1, stages, now),
  }));
  const manualPending: ManualPending[] = MANUAL_PENDING.map((m) => ({
    ...m,
    key: `pending:${m.slug}`,
    stage: resolveStage(`pending:${m.slug}`, m.cases, stages, now),
  }));
  const sampleShips: SampleShip[] = sampleShipSeeds.map((s) => ({
    ...s,
    key: `sample:${s.slug}`,
    stage: resolveStage(`sample:${s.slug}`, 1, stages, now),
  }));

  // Active queue = everything not in the terminal shipped stage.
  const activeWholesale = wholesale.filter((w) => w.stage.stage !== "shipped");
  const activeDtc = dtc.filter((o) => o.stage.stage !== "shipped");
  const activeManualPending = manualPending.filter((m) => m.stage.stage !== "shipped");
  const activeSampleShips = sampleShips.filter((s) => s.stage.stage !== "shipped");

  const wholesaleCases = activeWholesale.reduce((a, w) => a + (w.cases ?? 0), 0);
  const wholesaleBags = activeWholesale.reduce((a, w) => a + (w.bags ?? 0), 0);
  const manualPendingCases = activeManualPending.reduce((a, m) => a + m.cases, 0);
  const manualPendingBags = activeManualPending.reduce((a, m) => a + m.bags, 0);
  const sampleBags = activeSampleShips.reduce((a, s) => a + s.bags, 0);

  const byStage: Record<Stage, number> = { received: 0, packed: 0, ready: 0, shipped: 0 };
  for (const item of [...activeWholesale, ...activeDtc, ...activeManualPending, ...activeSampleShips]) {
    byStage[item.stage.stage] += 1;
  }

  const payload: FulfillmentPayload = {
    ok: true,
    generatedAt: now,
    totals: {
      wholesaleCases,
      wholesaleBags,
      dtcOrders: activeDtc.length,
      manualPendingCases,
      manualPendingBags,
      sampleShips: activeSampleShips.length,
      sampleBags,
      samplesPending: samples.length,
      shippableTodayBags: wholesaleBags + manualPendingBags + sampleBags,
      byStage,
    },
    wholesale: activeWholesale,
    dtc: activeDtc,
    manualPending: activeManualPending,
    sampleShips: activeSampleShips,
    samples,
    degraded,
  };

  return NextResponse.json(payload);
}

// ---- Handler: POST (stage transition / sample-add) ----------------------

interface StagePostBody {
  key?: string;
  stage?: Stage;
  cartonsPacked?: number;
  cartonsRequired?: number;
  tracking?: string;
  labelUrl?: string;
  labelCost?: number;
  carrier?: string;
  service?: string;
  notes?: string;
  updatedBy?: string;
  // Phase 1d: inline sample-ship creation
  createSample?: {
    recipient: string;
    company?: string;
    address: string;
    bags: number;
    purpose?: string;
    sourceThreadLink?: string;
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: StagePostBody;
  try {
    body = (await req.json()) as StagePostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Branch 1: create a sample ship entry
  if (body.createSample) {
    const { recipient, address, bags, company, purpose, sourceThreadLink } = body.createSample;
    if (!recipient?.trim() || !address?.trim() || !Number.isFinite(bags) || bags <= 0) {
      return NextResponse.json(
        { error: "createSample requires recipient, address, bags > 0" },
        { status: 400 },
      );
    }
    const base = slugifyRecipient(recipient) || `ship-${Date.now().toString(36)}`;
    // Suffix a short timestamp so repeat recipients don't collide.
    const slug = `${base}-${Date.now().toString(36).slice(-4)}`;
    const seed = await writeSampleShip({
      slug,
      recipient: recipient.trim(),
      company: company?.trim() || null,
      address: address.trim(),
      bags: Math.round(bags),
      purpose: purpose?.trim() || "sample",
      sourceThreadLink: sourceThreadLink?.trim() || null,
      createdAt: now,
    });
    // Seed a default stage entry so the UI picks it up.
    const key = `sample:${slug}`;
    await writeStage(key, defaultStage(now, 1));
    return NextResponse.json({ ok: true, createdSample: seed, key });
  }

  // Branch 2: stage transition
  const key = body.key?.trim();
  if (!key || !/^(inv|pending|dtc|sample):.+/.test(key)) {
    return NextResponse.json(
      { error: "Missing or malformed 'key' (expected inv: | pending: | dtc: | sample: + id)" },
      { status: 400 },
    );
  }

  const current = await getStageMap();
  const existing: StageEntry =
    current[key] ?? defaultStage(now, body.cartonsRequired ?? 0);

  const next: StageEntry = { ...existing, updatedAt: now };
  if (body.cartonsRequired !== undefined) next.cartonsRequired = body.cartonsRequired;
  if (body.cartonsPacked !== undefined) {
    next.cartonsPacked = Math.max(0, Math.min(next.cartonsRequired || Number.MAX_SAFE_INTEGER, body.cartonsPacked));
  }
  if (body.tracking !== undefined) next.tracking = body.tracking.trim() || undefined;
  if (body.labelUrl !== undefined) next.labelUrl = body.labelUrl.trim() || undefined;
  if (body.labelCost !== undefined) next.labelCost = body.labelCost;
  if (body.carrier !== undefined) next.carrier = body.carrier.trim() || undefined;
  if (body.service !== undefined) next.service = body.service.trim() || undefined;
  if (body.notes !== undefined) next.notes = body.notes.trim() || undefined;
  if (body.updatedBy !== undefined) next.updatedBy = body.updatedBy.trim() || undefined;

  // Auto-advance / explicit stage
  if (body.stage) {
    next.stage = body.stage;
  } else if (
    next.cartonsRequired > 0 &&
    next.cartonsPacked >= next.cartonsRequired &&
    existing.stage === "received"
  ) {
    // Reached full pack count → promote to "packed" unless user went further.
    next.stage = "packed";
  }

  // Timestamp whichever stage we just entered for the first time.
  if (next.stage === "packed" && !next.packedAt) next.packedAt = now;
  if (next.stage === "ready" && !next.readyAt) next.readyAt = now;
  if (next.stage === "shipped" && !next.shippedAt) next.shippedAt = now;

  // Tracking # arrival auto-promotes ready → shipped (Phase 3 will do this from a webhook).
  if (next.tracking && next.stage !== "shipped" && existing.stage === "ready") {
    next.stage = "shipped";
    next.shippedAt = now;
  }

  const map = await writeStage(key, next);
  return NextResponse.json({
    ok: true,
    key,
    stage: next,
    openCount: Object.values(map).filter((e) => e.stage !== "shipped").length,
  });
}

// ---- Handler: DELETE ----------------------------------------------------

export async function DELETE(req: Request): Promise<Response> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const key = url.searchParams.get("key")?.trim();
  if (!key) {
    return NextResponse.json({ error: "Missing 'key' query param" }, { status: 400 });
  }
  await removeStage(key);
  if (key.startsWith("sample:")) {
    await removeSampleShip(key.slice("sample:".length));
  }
  return NextResponse.json({ ok: true, key });
}

// ---- Source: QBO invoices -----------------------------------------------

// Loader returns the pre-stage shape; the GET handler decorates each with
// `key` + resolved `stage` when merging KV state.
type WholesaleInvoiceRaw = Omit<WholesaleInvoice, "key" | "stage">;
type DtcOrderRaw = Omit<DtcOrder, "key" | "stage">;

async function loadWholesale(): Promise<WholesaleInvoiceRaw[]> {
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
    .filter((inv): inv is WholesaleInvoiceRaw => inv !== null)
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
): WholesaleInvoiceRaw | null {
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

async function loadDtc(): Promise<DtcOrderRaw[]> {
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
