/**
 * QBO Attachment — /api/ops/qbo/attachment
 *
 * Upload file attachments to QBO entities (vendors, invoices, bills, etc.)
 *
 * POST  — Upload attachment (JSON with base64 or multipart form-data)
 *   Body (JSON): {
 *     entity_type: "Vendor" | "Invoice" | "Bill" | "PurchaseOrder" | "SalesReceipt",
 *     entity_id: string,          // QBO entity ID to attach to
 *     file_name: string,          // e.g., "VND-001_Snow_Leopard.pdf"
 *     content_type: string,       // e.g., "application/pdf"
 *     file_base64: string,        // base64-encoded file content
 *     note?: string,              // optional note on the attachment
 *   }
 *
 * GET ?entity_type=Vendor&entity_id=123 — List attachments for an entity
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ENTITY_TYPES = new Set([
  "Vendor", "Invoice", "Bill", "PurchaseOrder", "SalesReceipt",
  "Purchase", "JournalEntry", "Customer", "Estimate", "Transfer",
  "BillPayment", "Payment", "Deposit",
]);

function getBaseUrl(): string {
  const host = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return host;
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

  try {
    const body = await req.json();
    const {
      entity_type,
      entity_id,
      file_name,
      content_type,
      file_base64,
      note,
    } = body;

    if (!entity_type || !VALID_ENTITY_TYPES.has(entity_type)) {
      return NextResponse.json(
        { error: `entity_type must be one of: ${[...VALID_ENTITY_TYPES].join(", ")}` },
        { status: 400 },
      );
    }
    if (!entity_id) {
      return NextResponse.json({ error: "entity_id is required" }, { status: 400 });
    }
    if (!file_name || !file_base64) {
      return NextResponse.json(
        { error: "file_name and file_base64 are required" },
        { status: 400 },
      );
    }

    const fileBuffer = Buffer.from(file_base64, "base64");
    const mimeType = content_type || "application/octet-stream";

    // QBO Attachments API uses multipart/form-data with metadata JSON + file
    const boundary = `----QBOAttachment${Date.now()}`;
    const metadata = JSON.stringify({
      AttachableRef: [
        {
          EntityRef: { type: entity_type, value: entity_id },
          IncludeOnSend: false,
        },
      ],
      FileName: file_name,
      ContentType: mimeType,
      ...(note ? { Note: note } : {}),
    });

    // Build multipart body manually
    const parts: Buffer[] = [];
    // Metadata part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file_metadata_0"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${metadata}\r\n`,
    ));
    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file_content_0"; filename="${file_name}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    ));
    parts.push(fileBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const multipartBody = Buffer.concat(parts);

    const baseUrl = getBaseUrl();
    const res = await fetch(
      `${baseUrl}/v3/company/${realmId}/upload?minorversion=73`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          Accept: "application/json",
        },
        body: multipartBody,
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("[qbo/attachment] Upload failed:", res.status, text.slice(0, 500));
      return NextResponse.json(
        { error: `Attachment upload failed: ${res.status}`, detail: text.slice(0, 300) },
        { status: res.status },
      );
    }

    const data = await res.json();
    const attachable = data?.AttachableResponse?.[0]?.Attachable || data;

    return NextResponse.json({
      ok: true,
      attachment_id: attachable?.Id,
      file_name: attachable?.FileName,
      entity_type,
      entity_id,
      message: `Attached "${file_name}" to ${entity_type} ${entity_id}`,
    });
  } catch (error) {
    console.error(
      "[qbo/attachment] POST failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Attachment upload failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO not connected" }, { status: 401 });
  }

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entity_type");
  const entityId = url.searchParams.get("entity_id");

  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: "entity_type and entity_id are required" },
      { status: 400 },
    );
  }

  try {
    const baseUrl = getBaseUrl();
    const query = encodeURIComponent(
      `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = '${entityType}' AND AttachableRef.EntityRef.value = '${entityId}'`,
    );
    const res = await fetch(
      `${baseUrl}/v3/company/${realmId}/query?query=${query}&minorversion=73`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Attachment query failed: ${res.status}`, detail: text.slice(0, 300) },
        { status: res.status },
      );
    }

    const data = await res.json();
    const attachables = data?.QueryResponse?.Attachable || [];

    return NextResponse.json({
      ok: true,
      entity_type: entityType,
      entity_id: entityId,
      count: attachables.length,
      attachments: attachables.map((a: Record<string, unknown>) => ({
        id: a.Id,
        file_name: a.FileName,
        content_type: a.ContentType,
        size: a.Size,
        note: a.Note,
      })),
    });
  } catch (error) {
    console.error(
      "[qbo/attachment] GET failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Attachment query failed" },
      { status: 500 },
    );
  }
}
