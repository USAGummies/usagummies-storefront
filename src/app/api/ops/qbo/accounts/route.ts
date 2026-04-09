import { NextResponse } from "next/server";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";
import { isAuthorized } from "@/lib/ops/abra-auth";
import { createQBOAccount, updateQBOAccount } from "@/lib/ops/qbo-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ops/qbo/accounts — List all QBO Chart of Accounts
 *
 * Optional query params:
 *   ?full=true — returns full hierarchy with parent/sub-account relationships
 */
export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    console.error("[qbo/accounts] GET query failed:", res.status, JSON.stringify(data).slice(0, 300));
    return NextResponse.json(
      { error: "QBO query failed" },
      { status: res.status },
    );
  }

  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "true";

  const raw = data?.QueryResponse?.Account || [];

  if (full) {
    // Full COA with hierarchy, parent refs, active status
    const accounts = raw.map(
      (a: Record<string, unknown>) => ({
        Id: a.Id,
        Name: a.Name,
        FullyQualifiedName: a.FullyQualifiedName,
        AccountType: a.AccountType,
        AccountSubType: a.AccountSubType,
        AcctNum: a.AcctNum || null,
        CurrentBalance: a.CurrentBalance,
        Active: a.Active,
        SubAccount: a.SubAccount || false,
        ParentRef: a.ParentRef || null,
        Classification: a.Classification,
        Description: a.Description || null,
        SyncToken: a.SyncToken,
      }),
    );

    // Build hierarchy map
    const byId: Record<string, typeof accounts[0]> = {};
    for (const a of accounts) byId[a.Id as string] = a;

    const hierarchy = accounts.map((a: Record<string, unknown>) => ({
      ...a,
      parent_name: a.ParentRef
        ? byId[(a.ParentRef as { value: string }).value]?.Name || null
        : null,
    }));

    // Sort by account number, then name
    hierarchy.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const numA = String(a.AcctNum || "999999");
      const numB = String(b.AcctNum || "999999");
      if (numA !== numB) return numA.localeCompare(numB, undefined, { numeric: true });
      return String(a.Name || "").localeCompare(String(b.Name || ""));
    });

    return NextResponse.json({ count: hierarchy.length, accounts: hierarchy });
  }

  // Default: slim response
  const accounts = raw.map(
    (a: Record<string, unknown>) => ({
      Id: a.Id,
      Name: a.Name,
      AccountType: a.AccountType,
      AccountSubType: a.AccountSubType,
      AcctNum: a.AcctNum || null,
      CurrentBalance: a.CurrentBalance,
      Active: a.Active !== false,
    }),
  );

  return NextResponse.json({ count: accounts.length, accounts });
}

/**
 * POST /api/ops/qbo/accounts — Create a new account in QBO Chart of Accounts
 *
 * Body: { name, type, sub_type?, number?, description?, parent_id?, sub_account? }
 *
 * parent_id: QBO Account Id of the parent account (for sub-account nesting)
 * sub_account: boolean, set true when parent_id is provided
 */
export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      name: string;
      type: string;
      sub_type?: string;
      number?: string;
      description?: string;
      parent_id?: string;
      sub_account?: boolean;
    };

    if (!body.name || !body.type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 },
      );
    }

    const payload: Record<string, unknown> = {
      Name: body.name,
      AccountType: body.type,
    };

    if (body.sub_type) payload.AccountSubType = body.sub_type;
    if (body.number) payload.AcctNum = body.number;
    if (body.description) payload.Description = body.description;
    if (body.parent_id) {
      payload.ParentRef = { value: body.parent_id };
      payload.SubAccount = true;
    } else if (body.sub_account) {
      payload.SubAccount = body.sub_account;
    }

    const result = await createQBOAccount(
      payload as Parameters<typeof createQBOAccount>[0],
    );

    if (!result) {
      return NextResponse.json(
        { error: "QBO account creation failed — check connection and field values" },
        { status: 500 },
      );
    }

    const acct = (result as Record<string, unknown>).Account || result;
    const a = acct as Record<string, unknown>;

    return NextResponse.json({
      ok: true,
      account: {
        Id: a.Id,
        Name: a.Name,
        AccountType: a.AccountType,
        AccountSubType: a.AccountSubType,
        AcctNum: a.AcctNum || null,
        Active: a.Active,
        SubAccount: a.SubAccount || false,
        ParentRef: a.ParentRef || null,
        SyncToken: a.SyncToken,
      },
      message: `Created account "${body.name}" (${body.type}${body.number ? ` #${body.number}` : ""}) ID: ${a.Id}`,
    });
  } catch (error) {
    console.error("[qbo/accounts] POST failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Account creation failed" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/ops/qbo/accounts — Update an existing account
 *
 * Body: { id (required), sync_token (required), name?, number?, description?,
 *         parent_id?, sub_account?, active?, sub_type? }
 *
 * Uses QBO sparse update — only sends fields that are provided.
 * sync_token is required by QBO to prevent concurrent edits.
 * Get it from GET /api/ops/qbo/accounts?full=true
 */
export async function PATCH(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      id: string;
      sync_token: string;
      name?: string;
      number?: string;
      description?: string;
      parent_id?: string | null; // null to remove parent
      sub_account?: boolean;
      active?: boolean;
      sub_type?: string;
    };

    if (!body.id || body.sync_token === undefined) {
      return NextResponse.json(
        { error: "id and sync_token are required. Get sync_token from GET /api/ops/qbo/accounts?full=true" },
        { status: 400 },
      );
    }

    const payload: Record<string, unknown> = {
      Id: body.id,
      SyncToken: body.sync_token,
      sparse: true,
    };

    if (body.name !== undefined) payload.Name = body.name;
    if (body.number !== undefined) payload.AcctNum = body.number;
    if (body.description !== undefined) payload.Description = body.description;
    if (body.sub_type !== undefined) payload.AccountSubType = body.sub_type;
    if (body.active !== undefined) payload.Active = body.active;

    if (body.parent_id === null) {
      // Remove from parent
      payload.SubAccount = false;
    } else if (body.parent_id) {
      payload.ParentRef = { value: body.parent_id };
      payload.SubAccount = true;
    } else if (body.sub_account !== undefined) {
      payload.SubAccount = body.sub_account;
    }

    const result = await updateQBOAccount(payload);

    if (!result) {
      return NextResponse.json(
        { error: "QBO account update failed — check id and sync_token" },
        { status: 500 },
      );
    }

    const acct = (result as Record<string, unknown>).Account || result;
    const a = acct as Record<string, unknown>;

    return NextResponse.json({
      ok: true,
      account: {
        Id: a.Id,
        Name: a.Name,
        AccountType: a.AccountType,
        AccountSubType: a.AccountSubType,
        AcctNum: a.AcctNum || null,
        Active: a.Active,
        SubAccount: a.SubAccount || false,
        ParentRef: a.ParentRef || null,
        SyncToken: a.SyncToken,
      },
      message: `Updated account ID ${body.id}`,
    });
  } catch (error) {
    console.error("[qbo/accounts] PATCH failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Account update failed" },
      { status: 500 },
    );
  }
}
