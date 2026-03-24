import { NextResponse } from "next/server";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";
import { isCronAuthorized } from "@/lib/ops/abra-auth";
import { createQBOAccount } from "@/lib/ops/qbo-client";

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
    "SELECT * FROM Account MAXRESULTS 500",
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

/**
 * POST /api/ops/qbo/accounts — Create a new account in QBO Chart of Accounts
 */
export async function POST(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      name: string;
      type: string;
      sub_type?: string;
      number?: string;
      description?: string;
    };

    if (!body.name || !body.type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 },
      );
    }

    const result = await createQBOAccount({
      Name: body.name,
      AccountType: body.type,
      ...(body.sub_type ? { AccountSubType: body.sub_type } : {}),
      ...(body.number ? { AcctNum: body.number } : {}),
      ...(body.description ? { Description: body.description } : {}),
    });

    if (!result) {
      return NextResponse.json(
        { error: "QBO account creation failed — check connection" },
        { status: 500 },
      );
    }

    const acctData =
      (result as Record<string, unknown>).Account || result;
    const acctId =
      (acctData as Record<string, unknown>).Id || "unknown";

    return NextResponse.json({
      ok: true,
      account_id: acctId,
      name: body.name,
      type: body.type,
      message: `Created account "${body.name}" (${body.type}) ID: ${acctId}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Account creation failed",
      },
      { status: 500 },
    );
  }
}
