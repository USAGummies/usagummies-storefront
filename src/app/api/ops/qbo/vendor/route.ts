import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOVendor, updateQBOVendor } from "@/lib/ops/qbo-client";
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
      company_name?: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
    };

    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const result = await createQBOVendor({
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
        { error: "QBO vendor creation failed — check QBO connection" },
        { status: 500 },
      );
    }

    const vendorData =
      (result as Record<string, unknown>).Vendor || result;
    const vendorId =
      (vendorData as Record<string, unknown>).Id || "unknown";

    return NextResponse.json({
      ok: true,
      vendor_id: vendorId,
      name: body.name,
      message: `Created vendor "${body.name}" (ID: ${vendorId})`,
    });
  } catch (error) {
    console.error("[qbo/vendor] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Vendor creation failed" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/ops/qbo/vendor — Update an existing vendor with full details
 *
 * Body: {
 *   id,                    // required — QBO vendor ID
 *   name?,                 // display name
 *   company_name?,         // company name
 *   email?,                // primary email
 *   phone?,                // primary phone (landline)
 *   mobile?,               // mobile phone
 *   fax?,                  // fax number
 *   website?,              // web URL
 *   notes?,                // internal notes
 *   given_name?,           // contact first name
 *   family_name?,          // contact last name
 *   middle_name?,          // contact middle name
 *   title?,                // contact title (e.g., "Trustee")
 *   suffix?,               // contact suffix
 *   print_on_check_name?,  // payee name on checks
 *   address?,              // billing address line 1
 *   city?, state?, zip?,   // billing address parts
 *   acct_num?,             // vendor's account number for us
 *   tax_id?,               // vendor tax ID
 *   terms_id?,             // QBO Terms ID (e.g., Net 30)
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
    const vendorId = String(body.id || "").trim();
    if (!vendorId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const baseUrl = process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

    // Fetch current record to get SyncToken
    const query = encodeURIComponent(`SELECT * FROM Vendor WHERE Id = '${vendorId}'`);
    const qRes = await fetch(
      `${baseUrl}/v3/company/${realmId}/query?query=${query}&minorversion=73`,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
    );
    const qData = await qRes.json();
    const existing = qData?.QueryResponse?.Vendor?.[0];
    if (!existing) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    // Merge updates onto existing record
    const updatePayload = {
      ...existing,
      ...(body.name ? { DisplayName: body.name } : {}),
      ...(body.company_name ? { CompanyName: body.company_name } : {}),
      ...(body.email ? { PrimaryEmailAddr: { Address: body.email } } : {}),
      ...(body.phone ? { PrimaryPhone: { FreeFormNumber: body.phone } } : {}),
      ...(body.mobile ? { Mobile: { FreeFormNumber: body.mobile } } : {}),
      ...(body.fax ? { Fax: { FreeFormNumber: body.fax } } : {}),
      ...(body.website ? { WebAddr: { URI: body.website } } : {}),
      ...(body.notes ? { Notes: body.notes } : {}),
      ...(body.given_name ? { GivenName: body.given_name } : {}),
      ...(body.family_name ? { FamilyName: body.family_name } : {}),
      ...(body.middle_name ? { MiddleName: body.middle_name } : {}),
      ...(body.title ? { Title: body.title } : {}),
      ...(body.suffix ? { Suffix: body.suffix } : {}),
      ...(body.print_on_check_name ? { PrintOnCheckName: body.print_on_check_name } : {}),
      ...(body.acct_num ? { AcctNum: body.acct_num } : {}),
      ...(body.tax_id ? { TaxIdentifier: body.tax_id } : {}),
      ...(body.terms_id ? { TermRef: { value: body.terms_id } } : {}),
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
      `${baseUrl}/v3/company/${realmId}/vendor?minorversion=73`,
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
    const updated = uData?.Vendor;
    if (!updated) {
      console.error("[qbo/vendor] PUT failed:", JSON.stringify(uData).slice(0, 500));
      return NextResponse.json({ error: "Vendor update failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      vendor_id: updated.Id,
      name: updated.DisplayName,
      company: updated.CompanyName,
      given_name: updated.GivenName,
      family_name: updated.FamilyName,
      title: updated.Title,
      print_on_check_name: updated.PrintOnCheckName,
      email: updated.PrimaryEmailAddr?.Address,
      phone: updated.PrimaryPhone?.FreeFormNumber,
      mobile: updated.Mobile?.FreeFormNumber,
      fax: updated.Fax?.FreeFormNumber,
      website: updated.WebAddr?.URI,
      billAddress: updated.BillAddr,
      notes: updated.Notes,
      acctNum: updated.AcctNum,
      terms: updated.TermRef,
      active: updated.Active,
      message: `Updated vendor "${updated.DisplayName}" (ID: ${updated.Id})`,
    });
  } catch (error) {
    console.error("[qbo/vendor] PUT failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Vendor update failed" }, { status: 500 });
  }
}
