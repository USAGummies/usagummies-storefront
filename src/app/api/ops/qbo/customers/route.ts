/**
 * QBO Customers — /api/ops/qbo/customers
 *
 * GET   — List/search customers. ?search=name for display name search, or all if omitted.
 * POST  — Create a new customer (name required).
 * PUT   — Update an existing customer (id required).
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOCustomer } from "@/lib/ops/qbo-client";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBaseUrl(): string {
  return process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
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

  try {
    const url = new URL(req.url);
    const search = url.searchParams.get("search");

    const sql = search
      ? `SELECT * FROM Customer WHERE DisplayName LIKE '%${search.replace(/'/g, "\\'")}%'`
      : `SELECT * FROM Customer`;

    const baseUrl = getBaseUrl();
    const res = await fetch(
      `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=73`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("[qbo/customers] GET failed:", res.status, text.slice(0, 500));
      return NextResponse.json(
        { error: `Customer query failed: ${res.status}`, detail: text.slice(0, 300) },
        { status: res.status },
      );
    }

    const data = await res.json();
    const customers = data?.QueryResponse?.Customer || [];

    return NextResponse.json({
      ok: true,
      count: customers.length,
      customers: customers.map((c: Record<string, unknown>) => ({
        id: c.Id,
        display_name: c.DisplayName,
        company_name: c.CompanyName,
        given_name: c.GivenName,
        family_name: c.FamilyName,
        title: c.Title,
        email: (c.PrimaryEmailAddr as Record<string, unknown>)?.Address,
        phone: (c.PrimaryPhone as Record<string, unknown>)?.FreeFormNumber,
        balance: c.Balance,
        active: c.Active,
        notes: c.Notes,
        billAddr: c.BillAddr,
      })),
    });
  } catch (error) {
    console.error("[qbo/customers] GET failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Customer query failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      name: string;
      company_name?: string;
      email?: string;
      phone?: string;
      given_name?: string;
      family_name?: string;
      title?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      notes?: string;
    };

    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const result = await createQBOCustomer({
      DisplayName: body.name,
      CompanyName: body.company_name || body.name,
      ...(body.email
        ? { PrimaryEmailAddr: { Address: body.email } }
        : {}),
      ...(body.phone
        ? { PrimaryPhone: { FreeFormNumber: body.phone } }
        : {}),
      ...(body.address
        ? {
            BillAddr: {
              Line1: body.address,
              City: body.city || "",
              CountrySubDivisionCode: body.state || "",
              PostalCode: body.zip || "",
            },
          }
        : {}),
    });

    if (!result) {
      return NextResponse.json(
        { error: "QBO customer creation failed — check QBO connection" },
        { status: 500 },
      );
    }

    const customerData =
      (result as Record<string, unknown>).Customer || result;
    const customerId =
      (customerData as Record<string, unknown>).Id || "unknown";

    return NextResponse.json({
      ok: true,
      customer_id: customerId,
      name: body.name,
      message: `Created customer "${body.name}" (ID: ${customerId})`,
    });
  } catch (error) {
    console.error("[qbo/customers] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Customer creation failed" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/ops/qbo/customers — Update an existing customer
 *
 * Body: {
 *   id,                    // required — QBO customer ID
 *   name?,                 // display name
 *   company_name?,         // company name
 *   email?,                // primary email
 *   phone?,                // primary phone
 *   given_name?,           // first name
 *   family_name?,          // last name
 *   title?,                // contact title
 *   address?,              // billing address line 1
 *   city?, state?, zip?,   // billing address parts
 *   notes?,                // internal notes
 *   active?                // true/false to activate/deactivate
 * }
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

    const baseUrl = getBaseUrl();

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

    // Merge updates onto existing record
    const updatePayload = {
      ...existing,
      ...(body.name ? { DisplayName: body.name } : {}),
      ...(body.company_name ? { CompanyName: body.company_name } : {}),
      ...(body.email ? { PrimaryEmailAddr: { Address: body.email } } : {}),
      ...(body.phone ? { PrimaryPhone: { FreeFormNumber: body.phone } } : {}),
      ...(body.given_name ? { GivenName: body.given_name } : {}),
      ...(body.family_name ? { FamilyName: body.family_name } : {}),
      ...(body.title ? { Title: body.title } : {}),
      ...(body.notes ? { Notes: body.notes } : {}),
      ...(body.active !== undefined ? { Active: body.active } : {}),
      ...(body.address ? {
        BillAddr: {
          Line1: body.address,
          City: body.city || existing.BillAddr?.City || "",
          CountrySubDivisionCode: body.state || existing.BillAddr?.CountrySubDivisionCode || "",
          PostalCode: body.zip || existing.BillAddr?.PostalCode || "",
          Country: body.country || existing.BillAddr?.Country || "US",
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
      console.error("[qbo/customers] PUT failed:", JSON.stringify(uData).slice(0, 500));
      return NextResponse.json({ error: "Customer update failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      customer_id: updated.Id,
      name: updated.DisplayName,
      company: updated.CompanyName,
      given_name: updated.GivenName,
      family_name: updated.FamilyName,
      title: updated.Title,
      email: updated.PrimaryEmailAddr?.Address,
      phone: updated.PrimaryPhone?.FreeFormNumber,
      billAddress: updated.BillAddr,
      notes: updated.Notes,
      balance: updated.Balance,
      active: updated.Active,
      message: `Updated customer "${updated.DisplayName}" (ID: ${updated.Id})`,
    });
  } catch (error) {
    console.error("[qbo/customers] PUT failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Customer update failed" },
      { status: 500 },
    );
  }
}
