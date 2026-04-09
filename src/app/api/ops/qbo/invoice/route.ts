import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getRealmId, getValidAccessToken } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LineItemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(100000),
  unitPrice: z.number().min(0).max(1000000),
  itemId: z.string().trim().optional(),   // per-line QBO Item ID
  itemName: z.string().trim().optional(),  // per-line QBO Item name
});

const RequestSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email().optional(),
  lineItems: z.array(LineItemSchema).min(1).max(50),
  dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  docNumber: z.string().trim().max(21).optional(), // QBO DocNumber (invoice #)
  txnDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // transaction date
  memo: z.string().trim().max(1000).optional(),
  sendEmail: z.boolean().optional().default(false),
  itemId: z.string().trim().optional(),   // fallback item ID for all lines
  itemName: z.string().trim().optional(), // fallback item name for all lines
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

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO is not connected" }, { status: 401 });
  }

  const customer = await resolveCustomer(
    realmId,
    accessToken,
    parsed.data.customerName,
    parsed.data.customerEmail,
  );
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
  const dueDate = parsed.data.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const total = parsed.data.lineItems.reduce((sum, itemRow) => sum + (itemRow.quantity * itemRow.unitPrice), 0);

  const invoice = await qboFetch<InvoiceResponse>(realmId, accessToken, "/invoice?minorversion=73", {
    method: "POST",
    body: JSON.stringify({
      CustomerRef: { value: customer.Id },
      TxnDate: txnDate,
      DueDate: dueDate,
      ...(parsed.data.docNumber ? { DocNumber: parsed.data.docNumber } : {}),
      ...(parsed.data.memo ? { PrivateNote: parsed.data.memo } : {}),
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
    }),
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
