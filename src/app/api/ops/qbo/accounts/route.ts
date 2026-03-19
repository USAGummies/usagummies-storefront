import { NextResponse } from "next/server";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ops/qbo/accounts — List all QBO Chart of Accounts
 * Returns account IDs, names, types for categorization mapping.
 */
export async function GET() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Not connected to QBO" },
      { status: 401 },
    );
  }

  const realmId = await getRealmId();
  if (!realmId) {
    return NextResponse.json({ error: "No realm ID" }, { status: 500 });
  }

  const baseUrl =
    process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

  const query = encodeURIComponent(
    "SELECT * FROM Account WHERE Active = true ORDERBY Name",
  );

  const res = await fetch(
    `${baseUrl}/v3/company/${realmId}/query?query=${query}&minorversion=73`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(
      { error: "QBO query failed", detail: data },
      { status: res.status },
    );
  }

  const accounts = (
    data?.QueryResponse?.Account || []
  ).map(
    (a: Record<string, unknown>) => ({
      Id: a.Id,
      Name: a.Name,
      AccountType: a.AccountType,
      AccountSubType: a.AccountSubType,
      AcctNum: a.AcctNum,
      CurrentBalance: a.CurrentBalance,
    }),
  );

  return NextResponse.json({ count: accounts.length, accounts });
}
