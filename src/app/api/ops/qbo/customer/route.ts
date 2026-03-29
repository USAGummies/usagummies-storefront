import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOCustomer } from "@/lib/ops/qbo-client";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      name: string;
      company?: string;
      email?: string;
      phone?: string;
    };

    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const result = await createQBOCustomer({
      DisplayName: body.name,
      ...(body.company ? { CompanyName: body.company } : {}),
      ...(body.email
        ? { PrimaryEmailAddr: { Address: body.email } }
        : {}),
      ...(body.phone
        ? { PrimaryPhone: { FreeFormNumber: body.phone } }
        : {}),
    });

    if (!result) {
      return NextResponse.json(
        { error: "QBO customer creation failed" },
        { status: 500 },
      );
    }

    const custData =
      (result as Record<string, unknown>).Customer || result;
    const custId =
      (custData as Record<string, unknown>).Id || "unknown";

    return NextResponse.json({
      ok: true,
      customer_id: custId,
      name: body.name,
      message: `Created customer "${body.name}" (ID: ${custId})`,
    });
  } catch (error) {
    console.error("[qbo/customer] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Customer creation failed" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/ops/qbo/customer — Update an existing customer with full details
 */
export async function PUT(req: Request) {
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
    const customerId = String(body.id || "").trim();
    if (!customerId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const baseUrl = process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

    // Fetch current record to get SyncToken
    const query = encodeURIComponent(`SELECT * FROM Customer WHERE Id = '${customerId}'`);
    const qRes = await fetch(
      `${baseUrl}/v3/company/${realmId}/query?query=${query}&minorversion=73`,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
    );
    const qData = await qRes.json();
    const existing = qData?.QueryResponse?.Customer?.[0];
    if (!existing) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Merge updates
    const updatePayload = {
      ...existing,
      ...(body.name ? { DisplayName: body.name } : {}),
      ...(body.company ? { CompanyName: body.company } : {}),
      ...(body.email ? { PrimaryEmailAddr: { Address: body.email } } : {}),
      ...(body.phone ? { PrimaryPhone: { FreeFormNumber: body.phone } } : {}),
      ...(body.fax ? { Fax: { FreeFormNumber: body.fax } } : {}),
      ...(body.website ? { WebAddr: { URI: body.website } } : {}),
      ...(body.notes ? { Notes: body.notes } : {}),
      ...(body.billAddress ? {
        BillAddr: {
          Line1: body.billAddress.line1,
          City: body.billAddress.city,
          CountrySubDivisionCode: body.billAddress.state,
          PostalCode: body.billAddress.zip,
          Country: body.billAddress.country || "US",
        },
      } : {}),
      ...(body.shipAddress ? {
        ShipAddr: {
          Line1: body.shipAddress.line1,
          City: body.shipAddress.city,
          CountrySubDivisionCode: body.shipAddress.state,
          PostalCode: body.shipAddress.zip,
          Country: body.shipAddress.country || "US",
        },
      } : {}),
    };

    const uRes = await fetch(
      `${baseUrl}/v3/company/${realmId}/customer?minorversion=73`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(updatePayload),
      },
    );
    const uData = await uRes.json();
    const updated = uData?.Customer;
    if (!updated) {
      console.error("[qbo/customer] PUT failed:", JSON.stringify(uData).slice(0, 500));
      return NextResponse.json({ error: "Customer update failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      customer_id: updated.Id,
      name: updated.DisplayName,
      company: updated.CompanyName,
      email: updated.PrimaryEmailAddr?.Address,
      phone: updated.PrimaryPhone?.FreeFormNumber,
      fax: updated.Fax?.FreeFormNumber,
      website: updated.WebAddr?.URI,
      billAddress: updated.BillAddr,
      shipAddress: updated.ShipAddr,
      notes: updated.Notes,
    });
  } catch (error) {
    console.error("[qbo/customer] PUT failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Customer update failed" }, { status: 500 });
  }
}
