import { createBrainEntry } from "@/lib/ops/abra-brain-writer";
import { updateEntityFromEvent } from "@/lib/ops/operator/entities/entity-state";
import {
  ABRA_CONTROL_CHANNEL_ID,
  FINANCIALS_CHANNEL_ID,
  formatCurrency,
  postSlackMessage,
} from "@/lib/ops/operator/reports/shared";
import { writeState } from "@/lib/ops/state";
import {
  createQBOCustomer,
  createQBOInvoice,
  getQBOCustomers,
} from "@/lib/ops/qbo-client";
import { getRealmId, getValidAccessToken } from "@/lib/ops/qbo-auth";

export type POStatus =
  | "received"
  | "invoice_draft"
  | "invoice_sent"
  | "production"
  | "packing"
  | "shipped"
  | "delivered"
  | "payment_pending"
  | "paid"
  | "closed";

export interface PurchaseOrder {
  id?: string;
  po_number: string;
  customer_name: string;
  customer_email: string | null;
  customer_entity_id: string | null;
  units: number | null;
  unit_price: number | null;
  subtotal: number | null;
  shipping_cost: number | null;
  total: number | null;
  delivery_address: string | null;
  requested_delivery_date: string | null;
  payment_terms: string;
  status: POStatus;
  qbo_invoice_id: string | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  estimated_delivery: string | null;
  payment_date: string | null;
  payment_amount: number | null;
  source_email_id: string;
  notes: string[];
  created_at?: string;
  updated_at?: string;
}

export type PurchaseOrderSummary = {
  openCount: number;
  committedRevenue: number;
  overdue: Array<{
    poNumber: string;
    customer: string;
    daysOverdue: number;
  }>;
  byStatus: Record<string, number>;
};

export type ReceivePoInput = {
  poNumber: string;
  customerName: string;
  customerEmail?: string | null;
  customerEntityId?: string | null;
  units?: number | null;
  unitPrice?: number | null;
  deliveryAddress?: string | null;
  requestedDeliveryDate?: string | null;
  paymentTerms?: string | null;
  sourceEmailId: string;
  notes?: string[];
};

const OPEN_PO_TRACKER_STATE_KEY = "abra:open_po_summary" as never;
const DEFAULT_PAYMENT_TERMS = "Net 30";

type SupabasePoRow = PurchaseOrder & { id: string; created_at: string; updated_at: string };

type QboInvoiceEntity = {
  Id?: string;
  SyncToken?: string;
  CustomerRef?: { value?: string; name?: string };
  TxnDate?: string;
  DueDate?: string;
  DocNumber?: string;
  TotalAmt?: number;
  PrivateNote?: string;
  BillEmail?: { Address?: string };
  Line?: Array<Record<string, unknown>>;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status})`);
  }
  return json as T;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim();
}

function normalizeName(value: string | null | undefined): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|co|company|corp|corporation|distributors?|wholesalers?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ptToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function round2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

function parsePaymentTermsDays(terms: string | null | undefined): number {
  const text = normalizeText(terms);
  const net = text.match(/net\s*(\d{1,3})/i);
  if (net) return Number(net[1]);
  if (/cod|prepaid/i.test(text)) return 0;
  return 30;
}

function plusDays(isoDate: string, days: number): string {
  const at = new Date(`${isoDate}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function computePoTotals(input: {
  units?: number | null;
  unitPrice?: number | null;
  shippingCost?: number | null;
}) {
  const units = input.units == null ? null : Number(input.units);
  const unitPrice = input.unitPrice == null ? null : Number(input.unitPrice);
  const shippingCost = input.shippingCost == null ? null : Number(input.shippingCost);
  const subtotal = units != null && unitPrice != null ? round2(units * unitPrice) : null;
  const total = subtotal != null ? round2(subtotal + (shippingCost || 0)) : null;
  return { subtotal, total };
}

async function queryQbo<T>(query: string): Promise<T | null> {
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) return null;
  const host = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  const baseUrl = `${host}/v3/company/${realmId}`;
  const res = await fetch(`${baseUrl}/query?query=${encodeURIComponent(query)}&minorversion=73`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

async function qboPost<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) return null;
  const host = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  const baseUrl = `${host}/v3/company/${realmId}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

async function findOperatorTaskByNaturalKey(naturalKey: string): Promise<Record<string, unknown> | null> {
  const rows = await sbFetch<Array<Record<string, unknown>>>(
    `/rest/v1/abra_operator_tasks?select=id,status,execution_params&execution_params->>natural_key=eq.${encodeURIComponent(naturalKey)}&order=created_at.desc&limit=1`,
  ).catch(() => []);
  return rows[0] || null;
}

async function findOrCreateCustomer(params: {
  customerName: string;
  customerEmail?: string | null;
}): Promise<string | null> {
  if (/inderbitzin/i.test(params.customerName)) return "20";
  const all = (((await getQBOCustomers())?.QueryResponse?.Customer as Array<Record<string, unknown>>) || []);
  const target = normalizeName(params.customerName);
  const existing = all.find((row) => {
    const display = normalizeName(String(row.DisplayName || ""));
    const company = normalizeName(String(row.CompanyName || ""));
    const email = String((row.PrimaryEmailAddr as Record<string, unknown> | undefined)?.Address || "").trim().toLowerCase();
    return display === target || company === target ||
      (params.customerEmail && email === String(params.customerEmail).trim().toLowerCase());
  });
  if (existing?.Id) return String(existing.Id);
  const created = await createQBOCustomer({
    DisplayName: params.customerName,
    CompanyName: params.customerName,
    ...(params.customerEmail ? { PrimaryEmailAddr: { Address: params.customerEmail } } : {}),
  }).catch(() => null);
  const entity = ((created as Record<string, unknown>)?.Customer || created || null) as Record<string, unknown> | null;
  return entity?.Id ? String(entity.Id) : null;
}

async function fetchInvoiceById(invoiceId: string): Promise<QboInvoiceEntity | null> {
  const result = await queryQbo<{ QueryResponse?: { Invoice?: QboInvoiceEntity[] } }>(
    `SELECT * FROM Invoice WHERE Id = '${invoiceId.replace(/'/g, "\\'")}' MAXRESULTS 1`,
  );
  return result?.QueryResponse?.Invoice?.[0] || null;
}

async function updateInvoiceEntity(invoice: QboInvoiceEntity): Promise<QboInvoiceEntity | null> {
  const result = await qboPost<{ Invoice?: QboInvoiceEntity }>("/invoice?minorversion=73", invoice as Record<string, unknown>);
  return result?.Invoice || null;
}

async function createInvoicePayment(params: {
  invoiceId: string;
  customerId: string;
  amount: number;
  date: string;
}): Promise<boolean> {
  const result = await qboPost<Record<string, unknown>>("/payment?minorversion=73", {
    CustomerRef: { value: params.customerId },
    TotalAmt: round2(params.amount),
    TxnDate: params.date,
    Line: [{
      Amount: round2(params.amount),
      LinkedTxn: [{ TxnId: params.invoiceId, TxnType: "Invoice" }],
    }],
  }).catch(() => null);
  return Boolean(result);
}

function mergeNotes(existing: string[] | null | undefined, incoming: string[] | null | undefined): string[] {
  return Array.from(new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].filter(Boolean)));
}

export async function listPurchaseOrders(statuses?: POStatus[]): Promise<PurchaseOrder[]> {
  const statusFilter = Array.isArray(statuses) && statuses.length
    ? `&status=in.(${statuses.join(",")})`
    : "";
  const rows = await sbFetch<SupabasePoRow[]>(
    `/rest/v1/abra_purchase_orders?select=*&order=created_at.desc${statusFilter}`,
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export async function getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | null> {
  const rows = await sbFetch<SupabasePoRow[]>(
    `/rest/v1/abra_purchase_orders?po_number=eq.${encodeURIComponent(poNumber)}&select=*&limit=1`,
  ).catch(() => []);
  return rows[0] || null;
}

export async function upsertPurchaseOrder(po: PurchaseOrder): Promise<PurchaseOrder> {
  const existing = await getPurchaseOrderByNumber(po.po_number);
  const now = new Date().toISOString();
  const computedTotals = computePoTotals({
    units: po.units,
    unitPrice: po.unit_price,
    shippingCost: po.shipping_cost,
  });
  const payload: PurchaseOrder = {
    ...po,
    customer_name: normalizeText(po.customer_name),
    customer_email: normalizeText(po.customer_email) || null,
    customer_entity_id: normalizeText(po.customer_entity_id) || null,
    subtotal: computedTotals.subtotal,
    total: computedTotals.total,
    delivery_address: normalizeText(po.delivery_address) || null,
    requested_delivery_date: normalizeText(po.requested_delivery_date) || null,
    payment_terms: normalizeText(po.payment_terms) || DEFAULT_PAYMENT_TERMS,
    qbo_invoice_id: normalizeText(po.qbo_invoice_id) || null,
    tracking_number: normalizeText(po.tracking_number) || null,
    tracking_carrier: normalizeText(po.tracking_carrier) || null,
    estimated_delivery: normalizeText(po.estimated_delivery) || null,
    payment_date: normalizeText(po.payment_date) || null,
    source_email_id: normalizeText(po.source_email_id),
    notes: mergeNotes(existing?.notes, po.notes),
    updated_at: now,
  };

  if (existing?.id) {
    const rows = await sbFetch<SupabasePoRow[]>(`/rest/v1/abra_purchase_orders?id=eq.${existing.id}&select=*`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    await refreshPurchaseOrderSummaryState().catch(() => {});
    return rows[0] || { ...existing, ...payload };
  }

  const rows = await sbFetch<SupabasePoRow[]>("/rest/v1/abra_purchase_orders", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  await refreshPurchaseOrderSummaryState().catch(() => {});
  return rows[0] || payload;
}

export async function getPurchaseOrderSummary(): Promise<PurchaseOrderSummary> {
  const rows = await listPurchaseOrders();
  const open = rows.filter((row) => row.status !== "closed");
  const today = new Date(`${ptToday()}T00:00:00Z`).getTime();
  const byStatus: Record<string, number> = {};
  const overdue = open.flatMap((row) => {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    if (!row.requested_delivery_date) return [];
    const dueAt = new Date(`${row.requested_delivery_date}T00:00:00Z`).getTime();
    const daysOverdue = Math.floor((today - dueAt) / (24 * 60 * 60 * 1000));
    if (daysOverdue <= 0 || ["paid", "closed"].includes(row.status)) return [];
    return [{ poNumber: row.po_number, customer: row.customer_name, daysOverdue }];
  });
  return {
    openCount: open.length,
    committedRevenue: round2(open.reduce((sum, row) => sum + Number(row.total || row.subtotal || 0), 0)) || 0,
    overdue: overdue.sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 5),
    byStatus,
  };
}

export async function refreshPurchaseOrderSummaryState(): Promise<PurchaseOrderSummary> {
  const summary = await getPurchaseOrderSummary();
  await writeState(OPEN_PO_TRACKER_STATE_KEY, summary).catch(() => {});
  return summary;
}

export async function getOpenPurchaseOrders(): Promise<PurchaseOrder[]> {
  const rows = await listPurchaseOrders();
  return rows.filter((row) => row.status !== "closed");
}

async function ensureInvoiceDraft(po: PurchaseOrder): Promise<{ invoiceId: string | null; customerId: string | null }> {
  if (po.qbo_invoice_id) {
    const existing = await fetchInvoiceById(po.qbo_invoice_id).catch(() => null);
    if (existing?.Id) return { invoiceId: String(existing.Id), customerId: String(existing.CustomerRef?.value || "") || null };
  }
  if (!po.units || !po.unit_price) return { invoiceId: null, customerId: null };
  const customerId = await findOrCreateCustomer({ customerName: po.customer_name, customerEmail: po.customer_email });
  if (!customerId) return { invoiceId: null, customerId: null };
  const dueDate = po.requested_delivery_date || plusDays(ptToday(), parsePaymentTermsDays(po.payment_terms || DEFAULT_PAYMENT_TERMS));
  const isInderbitzin = /inderbitzin/i.test(po.customer_name);
  const subtotal = round2(Number(po.units) * Number(po.unit_price)) || 0;
  const invoice = await createQBOInvoice({
    CustomerRef: { value: customerId },
    Line: [
      {
        Amount: subtotal,
        DetailType: "SalesItemLineDetail",
        Description: "All American Gummy Bears 7.5oz",
        SalesItemLineDetail: {
          Qty: Number(po.units),
          UnitPrice: Number(po.unit_price),
        },
      },
      ...(!isInderbitzin
        ? [{
            Amount: round2(Number(po.shipping_cost || 0)) || 0,
            DetailType: "SalesItemLineDetail" as const,
            Description: `Shipping${po.delivery_address ? ` — ${po.delivery_address}` : ""}`,
            SalesItemLineDetail: {
              Qty: 1,
              UnitPrice: round2(Number(po.shipping_cost || 0)) || 0,
            },
          }]
        : []),
    ],
    DueDate: dueDate,
    DocNumber: po.po_number,
    ...(po.customer_email ? { BillEmail: { Address: po.customer_email } } : {}),
    CustomerMemo: { value: `PO ${po.po_number}. Terms: ${po.payment_terms || DEFAULT_PAYMENT_TERMS}.` },
  }).catch(() => null);
  const entity = ((invoice as Record<string, unknown>)?.Invoice || invoice || null) as Record<string, unknown> | null;
  return {
    invoiceId: entity?.Id ? String(entity.Id) : null,
    customerId,
  };
}

function buildOpenItem(po: PurchaseOrder): { description: string; due_date: string | null; priority: "high" | "medium" | "low" } {
  const amount = po.total || po.subtotal || 0;
  return {
    description: `PO #${po.po_number}${po.units ? ` — ${po.units} units` : " — qty pending review"}${amount ? ` — ${formatCurrency(amount)}` : ""}`,
    due_date: po.requested_delivery_date,
    priority: po.units ? "high" : "medium",
  };
}

export async function receivePO(input: ReceivePoInput): Promise<PurchaseOrder> {
  const base: PurchaseOrder = {
    po_number: normalizeText(input.poNumber),
    customer_name: normalizeText(input.customerName),
    customer_email: normalizeText(input.customerEmail) || null,
    customer_entity_id: normalizeText(input.customerEntityId) || null,
    units: input.units != null && Number.isFinite(Number(input.units)) && Number(input.units) > 0 ? Number(input.units) : null,
    unit_price: input.unitPrice != null && Number.isFinite(Number(input.unitPrice)) && Number(input.unitPrice) > 0 ? round2(Number(input.unitPrice)) : null,
    subtotal: null,
    shipping_cost: null,
    total: null,
    delivery_address: normalizeText(input.deliveryAddress) || null,
    requested_delivery_date: normalizeText(input.requestedDeliveryDate) || null,
    payment_terms: normalizeText(input.paymentTerms) || DEFAULT_PAYMENT_TERMS,
    status: "received",
    qbo_invoice_id: null,
    tracking_number: null,
    tracking_carrier: null,
    estimated_delivery: null,
    payment_date: null,
    payment_amount: null,
    source_email_id: input.sourceEmailId,
    notes: mergeNotes([], input.notes || []),
  };

  let po = await upsertPurchaseOrder(base);
  const invoiceReady = Boolean(po.units && po.unit_price);
  if (invoiceReady) {
    const { invoiceId } = await ensureInvoiceDraft(po);
    if (invoiceId) {
      po = await upsertPurchaseOrder({
        ...po,
        qbo_invoice_id: invoiceId,
        status: "invoice_draft",
      });
    }
  }

  await updateEntityFromEvent(po.customer_name, {
    type: "po_received",
    entity_type: "customer",
    summary: `PO ${po.po_number} received${po.units ? ` for ${po.units} units` : ""}${po.total ? ` totaling ${formatCurrency(po.total)}` : ""}`,
    date: ptToday(),
    channel: "email",
    open_item: buildOpenItem(po),
    next_action: po.qbo_invoice_id ? "Approve invoice timing and confirm ship plan" : "Review PO quantity and pricing",
    note: po.notes.join(" | ") || null,
  }).catch(() => null);

  if (!po.qbo_invoice_id && po.customer_email && po.source_email_id) {
    await sbFetch("/rest/v1/abra_operator_tasks", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        task_type: "email_draft_response",
        title: `Ask ${po.customer_name} to confirm PO ${po.po_number} quantity`,
        description: `PO ${po.po_number} is missing quantity or unit price details. Draft a clarification email for approval.`,
        priority: "high",
        source: "po_pipeline",
        assigned_to: "ben",
        requires_approval: true,
        execution_params: {
          natural_key: `po-quantity-followup:${po.po_number}`,
          message_id: po.source_email_id,
          sender: po.customer_name,
          sender_email: po.customer_email,
          subject: `Re: PO ${po.po_number}`,
          custom_draft_subject: `Re: PO ${po.po_number}`,
          custom_draft_body: `Hi ${po.customer_name.split("/")[0].trim().split(" ")[0] || po.customer_name},\n\nThanks for the PO. Could you confirm the quantity and unit price so I can get the invoice together?\n\nBest,\nBen`,
          po_number: po.po_number,
        },
        tags: ["po", "email", "approval"],
      }),
    }).catch(() => null);
  }

  if (po.qbo_invoice_id) {
    await postSlackMessage(
      ABRA_CONTROL_CHANNEL_ID,
      `📋 New PO received: ${po.customer_name} #${po.po_number} — ${po.units || "qty TBD"} units, ${po.total ? formatCurrency(po.total) : "value pending"}. Invoice draft created in QBO.`,
    ).catch(() => null);
  }

  return po;
}

export async function shipPO(params: {
  poNumber: string;
  trackingNumber?: string | null;
  carrier?: string | null;
  shippingCost?: number | null;
  estimatedDelivery?: string | null;
  note?: string | null;
}): Promise<PurchaseOrder | null> {
  const po = await getPurchaseOrderByNumber(params.poNumber);
  if (!po) return null;
  const explicitShippingAmount = params.shippingCost != null ? round2(params.shippingCost) || 0 : null;
  let updated = await upsertPurchaseOrder({
    ...po,
    status: "shipped",
    tracking_number: normalizeText(params.trackingNumber) || po.tracking_number,
    tracking_carrier: normalizeText(params.carrier) || po.tracking_carrier,
    shipping_cost: explicitShippingAmount ?? po.shipping_cost,
    estimated_delivery: normalizeText(params.estimatedDelivery) || po.estimated_delivery,
    notes: mergeNotes(po.notes, [normalizeText(params.note) || "Product shipped"]),
  });

  if (!/inderbitzin/i.test(updated.customer_name) && updated.qbo_invoice_id && params.shippingCost != null) {
    const invoice = await fetchInvoiceById(updated.qbo_invoice_id).catch(() => null);
    if (invoice?.Id && invoice.SyncToken) {
      const nextLine = Array.isArray(invoice.Line) ? [...invoice.Line] : [];
      const shippingAmount = explicitShippingAmount || 0;
      const shippingIndex = nextLine.findIndex((line) => /shipping/i.test(String(line.Description || "")));
      const shippingLine = {
        ...(shippingIndex >= 0 && nextLine[shippingIndex]?.Id ? { Id: nextLine[shippingIndex]?.Id } : {}),
        Amount: shippingAmount,
        DetailType: "SalesItemLineDetail",
        Description: `Shipping${updated.delivery_address ? ` — ${updated.delivery_address}` : ""}`,
        SalesItemLineDetail: {
          Qty: 1,
          UnitPrice: shippingAmount,
        },
      };
      if (shippingIndex >= 0) nextLine[shippingIndex] = shippingLine;
      else nextLine.push(shippingLine);
      await updateInvoiceEntity({
        sparse: false,
        Id: invoice.Id,
        SyncToken: invoice.SyncToken,
        CustomerRef: invoice.CustomerRef,
        TxnDate: invoice.TxnDate,
        DueDate: invoice.DueDate,
        DocNumber: invoice.DocNumber,
        PrivateNote: invoice.PrivateNote,
        BillEmail: invoice.BillEmail,
        Line: nextLine,
      } as unknown as QboInvoiceEntity).catch(() => null);
    }
    updated = await upsertPurchaseOrder({
      ...updated,
      shipping_cost: explicitShippingAmount,
      total: computePoTotals({ units: updated.units, unitPrice: updated.unit_price, shippingCost: explicitShippingAmount }).total,
      notes: mergeNotes(updated.notes, [`Shipping cost updated to ${formatCurrency(explicitShippingAmount || 0)}`]),
    });
  }

  await updateEntityFromEvent(updated.customer_name, {
    type: "shipment_sent",
    entity_type: "customer",
    summary: `PO ${updated.po_number} shipped${updated.tracking_number ? ` via ${updated.tracking_carrier || "carrier"} ${updated.tracking_number}` : ""}`,
    date: ptToday(),
    channel: "slack",
    open_item: buildOpenItem(updated),
    next_action: "Track delivery and payment timing",
    note: updated.estimated_delivery ? `ETA ${updated.estimated_delivery}` : null,
  }).catch(() => null);

  await postSlackMessage(
    ABRA_CONTROL_CHANNEL_ID,
    `📦 PO ${updated.po_number} shipped to ${updated.customer_name} — ${updated.tracking_carrier || "carrier"} ${updated.tracking_number || "tracking pending"}.${updated.estimated_delivery ? ` ETA ${updated.estimated_delivery}.` : ""}`,
  ).catch(() => null);

  return updated;
}

export async function markDelivered(poNumber: string): Promise<PurchaseOrder | null> {
  const po = await getPurchaseOrderByNumber(poNumber);
  if (!po) return null;
  const deliveredAt = ptToday();
  const dueDate = plusDays(deliveredAt, parsePaymentTermsDays(po.payment_terms));
  const updated = await upsertPurchaseOrder({
    ...po,
    status: "delivered",
    estimated_delivery: deliveredAt,
    notes: mergeNotes(po.notes, [`Delivered ${deliveredAt}`, `Payment due ${dueDate}`]),
  });

  const paymentDueNaturalKey = `po-payment-due:${updated.po_number}`;
  const existingFollowup = await findOperatorTaskByNaturalKey(paymentDueNaturalKey);
  if (!existingFollowup) {
    await sbFetch("/rest/v1/abra_operator_tasks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        task_type: "vendor_followup",
        title: `Payment due from ${updated.customer_name} for PO ${updated.po_number}`,
        description: `PO ${updated.po_number} delivered. ${updated.total ? `Payment of ${formatCurrency(updated.total)} ` : "Payment "}due ${dueDate}.`,
        priority: "high",
        source: "po_pipeline",
        assigned_to: "ben",
        requires_approval: true,
        execution_params: {
          natural_key: paymentDueNaturalKey,
          po_number: updated.po_number,
          customer_name: updated.customer_name,
          due_date: dueDate,
          amount: updated.total,
        },
        due_by: dueDate,
        tags: ["po", "payment_due"],
      }),
    }).catch(() => null);
  }

  return updated;
}

export async function matchPayment(params: {
  poNumber: string;
  depositAmount: number;
  depositDate: string;
}): Promise<PurchaseOrder | null> {
  const po = await getPurchaseOrderByNumber(params.poNumber);
  if (!po) return null;
  const updated = await upsertPurchaseOrder({
    ...po,
    status: "paid",
    payment_date: params.depositDate,
    payment_amount: round2(params.depositAmount),
    notes: mergeNotes(po.notes, [`Paid ${params.depositDate} ${formatCurrency(params.depositAmount)}`]),
  });

  if (updated.qbo_invoice_id) {
    const invoice = await fetchInvoiceById(updated.qbo_invoice_id).catch(() => null);
    const customerId = String(invoice?.CustomerRef?.value || "");
    if (invoice?.Id && customerId) {
      await createInvoicePayment({
        invoiceId: String(invoice.Id),
        customerId,
        amount: params.depositAmount,
        date: params.depositDate,
      }).catch(() => null);
    }
  }

  await postSlackMessage(
    FINANCIALS_CHANNEL_ID,
    `💰 PO ${updated.po_number} paid — ${formatCurrency(params.depositAmount)} received from ${updated.customer_name} on ${params.depositDate}`,
  ).catch(() => null);

  return updated;
}

export async function closePO(poNumber: string): Promise<PurchaseOrder | null> {
  const po = await getPurchaseOrderByNumber(poNumber);
  if (!po) return null;
  const updated = await upsertPurchaseOrder({
    ...po,
    status: "closed",
    notes: mergeNotes(po.notes, ["PO lifecycle complete"]),
  });
  await createBrainEntry({
    title: `PO ${updated.po_number} complete`,
    raw_text: `PO ${updated.po_number} from ${updated.customer_name}: ${updated.units ?? "qty TBD"} units, ${updated.total ? formatCurrency(updated.total) : "value pending"}, shipped ${updated.estimated_delivery || "unknown"}, paid ${updated.payment_date || "unknown"}. Complete.`,
    summary_text: `PO ${updated.po_number} from ${updated.customer_name} complete.`,
    category: "sales",
    tags: ["po", updated.po_number.toLowerCase(), updated.customer_name.toLowerCase()],
    source_type: "system",
    source_ref: `po:${updated.po_number}`,
    processed: true,
  }).catch(() => null);
  return updated;
}

export async function findPotentialPoPaymentMatches(amount: number, tolerance = 5): Promise<PurchaseOrder[]> {
  const rows = await getOpenPurchaseOrders();
  return rows.filter((row) => {
    if (!row.total) return false;
    if (["paid", "closed"].includes(row.status)) return false;
    return Math.abs(Number(row.total) - amount) <= tolerance;
  });
}

export async function seedKnownPurchaseOrders(): Promise<{ seeded: number; rows: PurchaseOrder[] }> {
  const rows: PurchaseOrder[] = [];

  rows.push(await upsertPurchaseOrder({
    po_number: "009180",
    customer_name: "Inderbitzin Distributors",
    customer_email: null,
    customer_entity_id: null,
    units: 828,
    unit_price: 2.1,
    subtotal: null,
    shipping_cost: null,
    total: null,
    delivery_address: null,
    requested_delivery_date: null,
    payment_terms: "Net 30",
    status: "invoice_draft",
    qbo_invoice_id: "1184",
    tracking_number: null,
    tracking_carrier: null,
    estimated_delivery: null,
    payment_date: null,
    payment_amount: null,
    source_email_id: "seed:009180",
    notes: ["Seeded from Phase 22", "Existing QBO invoice 1184 retained", "Current live state shows outstanding invoice, not shipped."],
  }));

  rows.push(await upsertPurchaseOrder({
    po_number: "140812",
    customer_name: "Mike Arlint / Glacier Wholesalers Inc",
    customer_email: "mikearlint@gmail.com",
    customer_entity_id: null,
    units: null,
    unit_price: null,
    subtotal: null,
    shipping_cost: null,
    total: null,
    delivery_address: "16 West Reserve Drive, Kalispell, MT",
    requested_delivery_date: null,
    payment_terms: "Net 30",
    status: "received",
    qbo_invoice_id: null,
    tracking_number: null,
    tracking_carrier: null,
    estimated_delivery: null,
    payment_date: null,
    payment_amount: null,
    source_email_id: "19d2ae4063ef9b59",
    notes: ["Seeded from Phase 22", "PDF attachment is scanned, quantity needs manual review"],
  }));

  await refreshPurchaseOrderSummaryState().catch(() => {});
  return { seeded: rows.length, rows };
}
