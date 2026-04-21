import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { validateInvoiceAgainstPricingDoctrine } from "@/lib/ops/delivered-pricing-guard";
import { getRealmId, getValidAccessToken } from "@/lib/ops/qbo-auth";
import { validateQBOWrite, logQBOAudit } from "@/lib/ops/qbo-guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LineItemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(100000),
  unitPrice: z.number().min(0).max(1000000),
  itemId: z.string().trim().optional(),   // per-line QBO Item ID
  itemName: z.string().trim().optional(),  // per-line QBO Item name
});

const AddressSchema = z.object({
  line1: z.string().trim().max(500),
  line2: z.string().trim().max(500).optional(),
  city: z.string().trim().max(255).optional(),
  state: z.string().trim().max(255).optional(),
  zip: z.string().trim().max(30).optional(),
  country: z.string().trim().max(255).optional(),
}).optional();

const RequestSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email().optional(),
  lineItems: z.array(LineItemSchema).min(1).max(50),
  dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  docNumber: z.string().trim().max(21).optional(),
  txnDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  memo: z.string().trim().max(1000).optional(),
  sendEmail: z.boolean().optional().default(false),
  itemId: z.string().trim().optional(),
  itemName: z.string().trim().optional(),
  // ── New fields for complete invoices ──
  billEmail: z.string().trim().email().optional(),
  billAddr: AddressSchema,
  shipAddr: AddressSchema,
  terms: z.string().trim().max(50).optional(),       // e.g. "Net 10", "Due on receipt"
  customerMemo: z.string().trim().max(1000).optional(), // message visible on invoice
  shipMethod: z.string().trim().max(100).optional(),    // e.g. "FedEx Ground"
  shipDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  trackingNum: z.string().trim().max(100).optional(),
  customerId: z.string().trim().optional(),  // pass QBO customer ID directly (skips lookup)
  // BUILD #7 — delivered-pricing override. Set ONLY when Class C
  // approval has been granted in writing for adding a freight line
  // to a delivered-pricing customer. Default: no override → guard
  // refuses such invoices. See
  // /contracts/distributor-pricing-commitments.md §6 + src/lib/ops/delivered-pricing-guard.ts
  deliveredPricingOverride: z
    .object({
      approver: z.enum(["Ben", "Rene"]),
      reason: z.string().trim().min(8).max(500),
      documentedAt: z.string().trim().min(1), // ISO timestamp
    })
    .optional(),
});

type QBOCustomer = {
  Id: string;
  DisplayName?: string;
  PrimaryEmailAddr?: { Address?: string };
};

type QBOItem = {
  Id: string;
  Name?: string;
  Type?: string;
};

type InvoiceResponse = {
  Invoice?: {
    Id?: string;
    SyncToken?: string;
    DocNumber?: string;
    TotalAmt?: number;
    DueDate?: string;
  };
};

function getBaseUrl(realmId: string): string {
  const host = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return `${host}/v3/company/${realmId}`;
}

async function qboFetch<T>(
  realmId: string,
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const res = await fetch(`${getBaseUrl(realmId)}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function queryOne<T>(realmId: string, accessToken: string, query: string): Promise<T | null> {
  return qboFetch<T>(
    realmId,
    accessToken,
    `/query?query=${encodeURIComponent(query)}&minorversion=73`,
    { method: "GET", headers: { "Content-Type": "application/json" } },
  );
}

async function resolveCustomer(
  realmId: string,
  accessToken: string,
  customerName: string,
  customerEmail?: string,
): Promise<QBOCustomer | null> {
  const email = customerEmail?.replace(/'/g, "\\'");
  const name = customerName.replace(/'/g, "\\'");
  const customerQuery = email
    ? `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${email}' MAXRESULTS 1`
    : `SELECT * FROM Customer WHERE DisplayName = '${name}' MAXRESULTS 1`;
  const existing = await queryOne<{ QueryResponse?: { Customer?: QBOCustomer[] } }>(realmId, accessToken, customerQuery);
  if (existing?.QueryResponse?.Customer?.[0]) {
    return existing.QueryResponse.Customer[0];
  }

  const created = await qboFetch<{ Customer?: QBOCustomer }>(realmId, accessToken, "/customer?minorversion=73", {
    method: "POST",
    body: JSON.stringify({
      DisplayName: customerName,
      ...(customerEmail ? { PrimaryEmailAddr: { Address: customerEmail } } : {}),
    }),
  });
  return created?.Customer || null;
}

async function resolveInvoiceItem(realmId: string, accessToken: string): Promise<QBOItem | null> {
  const serviceItem = await queryOne<{ QueryResponse?: { Item?: QBOItem[] } }>(
    realmId,
    accessToken,
    "SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1",
  );
  if (serviceItem?.QueryResponse?.Item?.[0]) return serviceItem.QueryResponse.Item[0];

  const anyItem = await queryOne<{ QueryResponse?: { Item?: QBOItem[] } }>(
    realmId,
    accessToken,
    "SELECT * FROM Item MAXRESULTS 1",
  );
  return anyItem?.QueryResponse?.Item?.[0] || null;
}

async function sendInvoiceEmail(
  realmId: string,
  accessToken: string,
  invoiceId: string,
  customerEmail: string,
): Promise<boolean> {
  const res = await fetch(
    `${getBaseUrl(realmId)}/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(customerEmail)}&minorversion=73`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  return res.ok;
}

// ── GET: List / read invoices ──
export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO is not connected" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const status = searchParams.get("status"); // Draft, Unpaid, Paid, Overdue
  const customer = searchParams.get("customer");
  const limit = Math.min(Number(searchParams.get("limit") || 100), 1000);

  // Single invoice by ID
  if (id) {
    const result = await queryOne<{ QueryResponse?: { Invoice?: Record<string, unknown>[] } }>(
      realmId, accessToken,
      `SELECT * FROM Invoice WHERE Id = '${id.replace(/'/g, "\\'")}' MAXRESULTS 1`,
    );
    const inv = result?.QueryResponse?.Invoice?.[0];
    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    return NextResponse.json({ ok: true, invoice: inv });
  }

  // Build query with optional filters
  let query = "SELECT * FROM Invoice";
  const conditions: string[] = [];

  if (customer) {
    conditions.push(`CustomerRef = '${customer.replace(/'/g, "\\'")}'`);
  }
  if (status === "Unpaid" || status === "Draft") {
    conditions.push("Balance > '0'");
  } else if (status === "Paid") {
    conditions.push("Balance = '0'");
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS ${limit}`;

  const result = await queryOne<{ QueryResponse?: { Invoice?: Record<string, unknown>[]; totalCount?: number } }>(
    realmId, accessToken, query,
  );
  const invoices = result?.QueryResponse?.Invoice || [];

  return NextResponse.json({
    ok: true,
    count: invoices.length,
    invoices: invoices.map((inv) => ({
      id: inv.Id,
      docNumber: inv.DocNumber,
      txnDate: inv.TxnDate,
      dueDate: inv.DueDate,
      total: inv.TotalAmt,
      balance: inv.Balance,
      status: Number(inv.Balance) === 0 ? "Paid" : "Unpaid",
      customerRef: inv.CustomerRef,
      emailStatus: inv.EmailStatus,
      privateNote: inv.PrivateNote,
    })),
  });
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => ({}));
  const isDryRun = rawBody.dry_run === true;
  const caller = rawBody.caller || "viktor";

  const parsed = RequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
  }

  // BUILD #7 — delivered-pricing doctrine guard. Refuses to write an
  // invoice that includes a freight/shipping line for a customer on
  // delivered pricing (Inderbitzin, Glacier, Bryce, Reunion 2026,
  // sell-sheet v3 customers) unless the caller passes a Class C
  // override. See /contracts/distributor-pricing-commitments.md §6.
  const hasFreightLine = parsed.data.lineItems.some((li) =>
    /\b(freight|shipping|delivery|postage|label)\b/i.test(li.description),
  );
  const pricingGuard = validateInvoiceAgainstPricingDoctrine({
    customer: parsed.data.customerName,
    hasFreightLine,
    freightAmount: parsed.data.lineItems
      .filter((li) => /\b(freight|shipping|delivery|postage|label)\b/i.test(li.description))
      .reduce((sum, li) => sum + li.quantity * li.unitPrice, 0),
    overrideApprovedBy: parsed.data.deliveredPricingOverride,
  });
  if (!pricingGuard.ok) {
    await logQBOAudit({
      entity_type: "invoice",
      action: "create",
      endpoint: "/api/ops/qbo/invoice",
      amount: 0,
      vendor_or_customer: `customer:${parsed.data.customerName}`,
      ref_number: parsed.data.docNumber,
      dry_run: isDryRun,
      validation_passed: false,
      issues: [
        {
          severity: "error",
          code: "DELIVERED_PRICING_VIOLATION",
          message: pricingGuard.error,
        },
      ],
      caller,
    });
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        pricingDoctrineViolation: pricingGuard.error,
        pricingDoctrineMatch: pricingGuard.match,
        message: pricingGuard.error,
      },
      { status: 422 },
    );
  }

  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO is not connected" }, { status: 401 });
  }

  // If customerId is provided directly, use it; otherwise resolve by name/email
  let customer: QBOCustomer | null = null;
  if (parsed.data.customerId) {
    customer = { Id: parsed.data.customerId };
  } else {
    customer = await resolveCustomer(
      realmId,
      accessToken,
      parsed.data.customerName,
      parsed.data.customerEmail,
    );
  }
  if (!customer?.Id) {
    return NextResponse.json({ error: "Failed to resolve or create QBO customer" }, { status: 500 });
  }

  // Resolve fallback item if no per-line itemId is provided anywhere
  const hasPerLineItems = parsed.data.lineItems.some((l) => l.itemId);
  const fallbackItem = parsed.data.itemId
    ? { Id: parsed.data.itemId, Name: parsed.data.itemName || "Product" }
    : (!hasPerLineItems ? await resolveInvoiceItem(realmId, accessToken) : null);

  if (!hasPerLineItems && !fallbackItem?.Id) {
    return NextResponse.json({ error: "No QBO invoice item available for line items" }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const txnDate = parsed.data.txnDate || today;
  // If terms are "Due on receipt" (case-insensitive), dueDate defaults to txnDate.
  // Otherwise default to +30 days.
  const isDueOnReceipt = parsed.data.terms ? /receipt/i.test(parsed.data.terms) : false;
  const dueDate = parsed.data.dueDate
    || (isDueOnReceipt ? txnDate : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const total = parsed.data.lineItems.reduce((sum, itemRow) => sum + (itemRow.quantity * itemRow.unitPrice), 0);

  // Build QBO address object from our schema
  const toQBOAddr = (a?: { line1: string; line2?: string; city?: string; state?: string; zip?: string; country?: string }) => {
    if (!a) return undefined;
    return {
      Line1: a.line1,
      ...(a.line2 ? { Line2: a.line2 } : {}),
      City: a.city || "",
      CountrySubDivisionCode: a.state || "",
      PostalCode: a.zip || "",
      Country: a.country || "US",
    };
  };

  // Resolve QBO SalesTermRef from term name (e.g. "Net 10" → lookup ID)
  let salesTermRef: { value: string; name?: string } | undefined;
  if (parsed.data.terms) {
    const termName = parsed.data.terms.replace(/'/g, "\\'");
    const termResult = await queryOne<{ QueryResponse?: { Term?: { Id: string; Name: string }[] } }>(
      realmId, accessToken,
      `SELECT * FROM Term WHERE Name = '${termName}' MAXRESULTS 1`,
    );
    const term = termResult?.QueryResponse?.Term?.[0];
    if (term) {
      salesTermRef = { value: term.Id, name: term.Name };
    }
  }

  const invoicePayload = {
    CustomerRef: { value: customer.Id },
    TxnDate: txnDate,
    DueDate: dueDate,
    ...(parsed.data.docNumber ? { DocNumber: parsed.data.docNumber } : {}),
    ...(parsed.data.memo ? { PrivateNote: parsed.data.memo } : {}),
    ...(parsed.data.billEmail ? { BillEmail: { Address: parsed.data.billEmail } } : {}),
    ...(parsed.data.billAddr ? { BillAddr: toQBOAddr(parsed.data.billAddr) } : {}),
    ...(parsed.data.shipAddr ? { ShipAddr: toQBOAddr(parsed.data.shipAddr) } : {}),
    ...(salesTermRef ? { SalesTermRef: salesTermRef } : {}),
    ...(parsed.data.customerMemo ? { CustomerMemo: { value: parsed.data.customerMemo } } : {}),
    ...(parsed.data.shipMethod ? { ShipMethodRef: { value: parsed.data.shipMethod } } : {}),
    ...(parsed.data.shipDate ? { ShipDate: parsed.data.shipDate } : {}),
    ...(parsed.data.trackingNum ? { TrackingNum: parsed.data.trackingNum } : {}),
    Line: parsed.data.lineItems.map((itemRow) => {
      // Per-line itemId takes priority, then fallback
      const lineItemId = itemRow.itemId || fallbackItem?.Id || "";
      const lineItemName = itemRow.itemName || fallbackItem?.Name || "Product";

      return {
        Amount: Number((itemRow.quantity * itemRow.unitPrice).toFixed(2)),
        Description: itemRow.description,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          Qty: itemRow.quantity,
          UnitPrice: Number(itemRow.unitPrice.toFixed(2)),
          ItemRef: { value: lineItemId, name: lineItemName },
        },
      };
    }),
  };

  // ── GUARDRAIL: Validate before writing ──
  const validation = await validateQBOWrite(
    "invoice",
    invoicePayload as unknown as Record<string, unknown>,
    { dry_run: isDryRun, caller },
  );

  await logQBOAudit({
    entity_type: "invoice",
    action: "create",
    endpoint: "/api/ops/qbo/invoice",
    amount: validation.amount ?? total,
    vendor_or_customer: `customer:${customer.Id}`,
    ref_number: parsed.data.docNumber,
    dry_run: isDryRun,
    validation_passed: validation.valid,
    issues: validation.issues,
    caller,
  });

  if (!validation.valid) {
    return NextResponse.json({
      ok: false, blocked: true, validation,
      message: validation.summary,
    }, { status: 422 });
  }
  if (isDryRun) {
    return NextResponse.json({
      ok: true, dry_run: true, validation,
      message: validation.summary,
    });
  }

  const invoice = await qboFetch<InvoiceResponse>(realmId, accessToken, "/invoice?minorversion=73", {
    method: "POST",
    body: JSON.stringify(invoicePayload),
  });

  const invoiceId = invoice?.Invoice?.Id;
  if (!invoiceId) {
    return NextResponse.json({ error: "QBO invoice creation failed" }, { status: 502 });
  }

  // NEVER auto-send invoice emails unless explicitly requested with sendEmail: true
  const emailSent = parsed.data.sendEmail && parsed.data.customerEmail
    ? await sendInvoiceEmail(realmId, accessToken, invoiceId, parsed.data.customerEmail)
    : false;

  return NextResponse.json({
    invoiceId,
    docNumber: invoice.Invoice?.DocNumber || invoiceId,
    dueDate: invoice.Invoice?.DueDate || dueDate,
    total: invoice.Invoice?.TotalAmt || total,
    pdfUrl: `${getBaseUrl(realmId)}/invoice/${invoiceId}/pdf?minorversion=73`,
    emailSent,
    customerId: customer.Id,
    validation: { issues: validation.issues, summary: validation.summary },
  });
}

// ── PUT: Update existing invoice (sparse merge) ──
export async function PUT(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO is not connected" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const invoiceId = String(body.id || body.invoiceId || "").trim();
  if (!invoiceId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Fetch existing invoice for SyncToken
  const existing = await queryOne<{ QueryResponse?: { Invoice?: Record<string, unknown>[] } }>(
    realmId, accessToken,
    `SELECT * FROM Invoice WHERE Id = '${invoiceId.replace(/'/g, "\\'")}' MAXRESULTS 1`,
  );
  const invoice = existing?.QueryResponse?.Invoice?.[0];
  if (!invoice?.Id || !invoice.SyncToken) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Build QBO address from flat fields
  const toAddr = (a: Record<string, unknown>) => ({
    Line1: a.line1 || a.Line1 || "",
    ...(a.line2 || a.Line2 ? { Line2: a.line2 || a.Line2 } : {}),
    City: a.city || a.City || "",
    CountrySubDivisionCode: a.state || a.CountrySubDivisionCode || "",
    PostalCode: a.zip || a.PostalCode || "",
    Country: a.country || a.Country || "US",
  });

  // Sparse merge — only include fields that were sent
  const updatePayload: Record<string, unknown> = {
    ...invoice, // full existing record
  };

  if (body.docNumber) updatePayload.DocNumber = body.docNumber;
  if (body.txnDate) updatePayload.TxnDate = body.txnDate;
  if (body.dueDate) updatePayload.DueDate = body.dueDate;
  if (body.memo) updatePayload.PrivateNote = body.memo;
  if (body.billEmail) updatePayload.BillEmail = { Address: body.billEmail };
  if (body.billAddr && typeof body.billAddr === "object") updatePayload.BillAddr = toAddr(body.billAddr as Record<string, unknown>);
  if (body.shipAddr && typeof body.shipAddr === "object") updatePayload.ShipAddr = toAddr(body.shipAddr as Record<string, unknown>);
  if (body.customerMemo) updatePayload.CustomerMemo = { value: body.customerMemo };
  if (body.shipMethod) updatePayload.ShipMethodRef = { value: body.shipMethod };
  if (body.shipDate) updatePayload.ShipDate = body.shipDate;
  if (body.trackingNum) updatePayload.TrackingNum = body.trackingNum;

  // Resolve terms if provided
  if (body.terms && typeof body.terms === "string") {
    const termName = body.terms.replace(/'/g, "\\'");
    const termResult = await queryOne<{ QueryResponse?: { Term?: { Id: string; Name: string }[] } }>(
      realmId, accessToken,
      `SELECT * FROM Term WHERE Name = '${termName}' MAXRESULTS 1`,
    );
    const term = termResult?.QueryResponse?.Term?.[0];
    if (term) updatePayload.SalesTermRef = { value: term.Id, name: term.Name };
  }

  const updated = await qboFetch<{ Invoice?: Record<string, unknown> }>(
    realmId, accessToken, "/invoice?minorversion=73",
    { method: "POST", body: JSON.stringify(updatePayload) },
  );

  if (!updated?.Invoice) {
    return NextResponse.json({ error: "Invoice update failed" }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    invoiceId: updated.Invoice.Id,
    docNumber: updated.Invoice.DocNumber,
    total: updated.Invoice.TotalAmt,
    dueDate: updated.Invoice.DueDate,
    balance: updated.Invoice.Balance,
    message: `Updated invoice ${updated.Invoice.DocNumber || updated.Invoice.Id}`,
  });
}

export async function DELETE(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { invoiceId?: string };
  const invoiceId = String(body.invoiceId || "").trim();
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO is not connected" }, { status: 401 });
  }

  const existing = await queryOne<{ QueryResponse?: { Invoice?: InvoiceResponse["Invoice"][] } }>(
    realmId,
    accessToken,
    `SELECT * FROM Invoice WHERE Id = '${invoiceId.replace(/'/g, "\\'")}' MAXRESULTS 1`,
  );
  const invoice = existing?.QueryResponse?.Invoice?.[0];
  if (!invoice?.Id || !invoice.SyncToken) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const deleted = await qboFetch<Record<string, unknown>>(
    realmId,
    accessToken,
    "/invoice?operation=delete&minorversion=73",
    {
      method: "POST",
      body: JSON.stringify({
        Id: invoice.Id,
        SyncToken: invoice.SyncToken,
      }),
    },
  );
  if (!deleted) {
    return NextResponse.json({ error: "Failed to delete invoice" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, invoiceId: invoice.Id });
}
