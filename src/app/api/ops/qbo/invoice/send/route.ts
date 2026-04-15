/**
 * QBO Invoice Send — /api/ops/qbo/invoice/send
 *
 * POST — Send an existing QBO invoice to the customer via Intuit's hosted
 *        invoice email. Use this to push a previously-created DRAFT invoice
 *        to the customer without manually opening QBO.
 *
 * This closes the gap Rene flagged on Apr 14: Viktor can create/update
 * invoices via our middleware but cannot push them from Slack. Now he can.
 *
 * Body (JSON):
 *   id        — QBO invoice Id (required, either this or docNumber)
 *   docNumber — human-readable invoice number (e.g. "1207") as fallback
 *   sendTo    — override the email address the invoice is sent to
 *               (default: the Customer's primary email on file)
 *
 * Returns:
 *   { ok: true, id, docNumber, emailStatus: "EmailSent" }
 *   or 4xx on error
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBaseUrl(): string {
  return process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

type QBOInvoice = {
  Id: string;
  DocNumber?: string;
  EmailStatus?: string;
  BillEmail?: { Address?: string };
  SyncToken?: string;
};

async function findInvoiceByDocNumber(
  accessToken: string,
  realmId: string,
  docNumber: string,
): Promise<QBOInvoice | null> {
  const sql = `SELECT * FROM Invoice WHERE DocNumber = '${docNumber.replace(/'/g, "\\'")}'`;
  const url = `${getBaseUrl()}/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=75`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    QueryResponse?: { Invoice?: QBOInvoice[] };
  };
  return data.QueryResponse?.Invoice?.[0] ?? null;
}

async function getInvoiceById(
  accessToken: string,
  realmId: string,
  id: string,
): Promise<QBOInvoice | null> {
  const url = `${getBaseUrl()}/v3/company/${realmId}/invoice/${id}?minorversion=75`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { Invoice?: QBOInvoice };
  return data.Invoice ?? null;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO not connected" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const docNumber = typeof body.docNumber === "string" ? body.docNumber.trim() : "";
  const sendTo = typeof body.sendTo === "string" ? body.sendTo.trim() : "";

  if (!id && !docNumber) {
    return NextResponse.json(
      { error: "Either 'id' or 'docNumber' is required" },
      { status: 400 },
    );
  }

  // Look up the invoice to get the ID + confirm it exists
  let invoice: QBOInvoice | null = null;
  if (id) {
    invoice = await getInvoiceById(accessToken, realmId, id);
  } else {
    invoice = await findInvoiceByDocNumber(accessToken, realmId, docNumber);
  }
  if (!invoice) {
    return NextResponse.json(
      { error: id ? `Invoice id=${id} not found` : `Invoice docNumber=${docNumber} not found` },
      { status: 404 },
    );
  }

  // Resolve target email: explicit override → invoice BillEmail → error
  const targetEmail = sendTo || invoice.BillEmail?.Address || "";
  if (!targetEmail) {
    return NextResponse.json(
      { error: "No email address on the invoice and no sendTo override provided" },
      { status: 400 },
    );
  }

  // QBO SendInvoice endpoint — POST with sendTo query param and empty body
  const sendUrl = `${getBaseUrl()}/v3/company/${realmId}/invoice/${invoice.Id}/send?sendTo=${encodeURIComponent(targetEmail)}&minorversion=75`;
  const sendRes = await fetch(sendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      Accept: "application/json",
    },
  });
  if (!sendRes.ok) {
    const errText = await sendRes.text();
    return NextResponse.json(
      {
        error: "QBO send failed",
        status: sendRes.status,
        detail: errText.slice(0, 500),
      },
      { status: sendRes.status },
    );
  }
  const sentData = (await sendRes.json()) as { Invoice?: QBOInvoice };
  const sentInvoice = sentData.Invoice ?? invoice;

  return NextResponse.json({
    ok: true,
    id: sentInvoice.Id,
    docNumber: sentInvoice.DocNumber ?? invoice.DocNumber ?? "",
    emailStatus: sentInvoice.EmailStatus ?? "EmailSent",
    sentTo: targetEmail,
  });
}
