/**
 * POST /api/ops/qbo/item — Create a QBO item (Inventory, Service, NonInventory, Bundle)
 * GET  /api/ops/qbo/item — List all items
 * PUT  /api/ops/qbo/item — Update an existing item
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
    `${getBaseUrl(realmId)}/query?query=${encodeURIComponent("SELECT * FROM Item MAXRESULTS 200")}&minorversion=73`,
    { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
  );
  const data = await res.json();
  const items = data?.QueryResponse?.Item || [];
  return NextResponse.json({ count: items.length, items });
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

  const body = await req.json();

  const res = await fetch(
    `${getBaseUrl(realmId)}/item?minorversion=73`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json();

  if (!data?.Item) {
    return NextResponse.json({ error: "Item creation failed", detail: data }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: data.Item });
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

  const body = await req.json();

  const res = await fetch(
    `${getBaseUrl(realmId)}/item?minorversion=73`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json();

  if (!data?.Item) {
    return NextResponse.json({ error: "Item update failed", detail: data }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: data.Item });
}
