/**
 * GET /api/ops/qbo/company — Read QBO company info
 * PUT /api/ops/qbo/company — Update QBO company info (name, address, phone, email, website, logo)
 */
import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBaseUrl(realmId: string): string {
  const host = process.env.QBO_SANDBOX === "true"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return `${host}/v3/company/${realmId}`;
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

  const res = await fetch(
    `${getBaseUrl(realmId)}/companyinfo/${realmId}?minorversion=73`,
    { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  return NextResponse.json(data?.CompanyInfo || data);
}

export async function PUT(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO not connected" }, { status: 401 });
  }

  // Get current company info for SyncToken
  const getRes = await fetch(
    `${getBaseUrl(realmId)}/companyinfo/${realmId}?minorversion=73`,
    { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
  );
  const getData = await getRes.json();
  const current = getData?.CompanyInfo;
  if (!current?.SyncToken) {
    return NextResponse.json({ error: "Could not read current company info" }, { status: 500 });
  }

  const body = await req.json();

  const updatePayload = {
    ...current,
    ...(body.companyName ? { CompanyName: body.companyName, LegalName: body.companyName } : {}),
    ...(body.phone ? { PrimaryPhone: { FreeFormNumber: body.phone } } : {}),
    ...(body.email ? { Email: { Address: body.email } } : {}),
    ...(body.website ? { WebAddr: { URI: body.website } } : {}),
    ...(body.address ? {
      CompanyAddr: {
        Line1: body.address.line1,
        City: body.address.city,
        CountrySubDivisionCode: body.address.state,
        PostalCode: body.address.zip,
        Country: body.address.country || "US",
      },
      LegalAddr: {
        Line1: body.address.line1,
        City: body.address.city,
        CountrySubDivisionCode: body.address.state,
        PostalCode: body.address.zip,
        Country: body.address.country || "US",
      },
    } : {}),
  };

  const updateRes = await fetch(
    `${getBaseUrl(realmId)}/companyinfo?minorversion=73`,
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
  const updateData = await updateRes.json();
  const updated = updateData?.CompanyInfo;

  if (!updated) {
    return NextResponse.json({ error: "Update failed", detail: updateData }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    companyName: updated.CompanyName,
    legalName: updated.LegalName,
    phone: updated.PrimaryPhone?.FreeFormNumber,
    email: updated.Email?.Address,
    website: updated.WebAddr?.URI,
    address: updated.CompanyAddr,
  });
}
