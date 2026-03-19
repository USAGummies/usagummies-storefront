import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, getRealmId } from "@/lib/ops/qbo-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBaseUrl(realmId: string): string {
  const host =
    process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  return `${host}/v3/company/${realmId}`;
}

async function qboGet(
  realmId: string,
  accessToken: string,
  path: string,
): Promise<{ ok: boolean; data: unknown; status: number }> {
  const res = await fetch(`${getBaseUrl(realmId)}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data, status: res.status };
}

async function qboQuery<T>(
  realmId: string,
  accessToken: string,
  query: string,
): Promise<T | null> {
  const res = await qboGet(
    realmId,
    accessToken,
    `/query?query=${encodeURIComponent(query)}&minorversion=73`,
  );
  return res.ok ? (res.data as T) : null;
}

/**
 * GET /api/ops/qbo/query?type=vendors|pnl|balance_sheet|purchases
 *
 * General-purpose QBO data endpoint for Abra.
 */
export async function GET(req: NextRequest) {
  const accessToken = await getValidAccessToken();
  const realmId = await getRealmId();
  if (!accessToken || !realmId) {
    return NextResponse.json({ error: "QBO not connected" }, { status: 401 });
  }

  const queryType = req.nextUrl.searchParams.get("type") || "vendors";

  try {
    switch (queryType) {
      // ── Vendor list ──
      case "vendors": {
        const result = await qboQuery<{
          QueryResponse?: {
            Vendor?: Array<{
              Id: string;
              DisplayName?: string;
              CompanyName?: string;
              Balance?: number;
              Active?: boolean;
              PrimaryEmailAddr?: { Address?: string };
              PrimaryPhone?: { FreeFormNumber?: string };
            }>;
          };
        }>(realmId, accessToken, "SELECT * FROM Vendor MAXRESULTS 200");

        const vendors = (result?.QueryResponse?.Vendor || []).map((v) => ({
          Id: v.Id,
          Name: v.DisplayName || v.CompanyName || "(unnamed)",
          Balance: v.Balance || 0,
          Active: v.Active !== false,
          Email: v.PrimaryEmailAddr?.Address || null,
          Phone: v.PrimaryPhone?.FreeFormNumber || null,
        }));

        return NextResponse.json({
          type: "vendors",
          count: vendors.length,
          vendors,
        });
      }

      // ── P&L Report ──
      case "pnl": {
        const startDate =
          req.nextUrl.searchParams.get("start") || getYTDStart();
        const endDate =
          req.nextUrl.searchParams.get("end") || todayISO();

        const res = await qboGet(
          realmId,
          accessToken,
          `/reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&minorversion=73`,
        );

        if (!res.ok) {
          return NextResponse.json(
            { error: "P&L report failed", detail: res.data },
            { status: res.status },
          );
        }

        const report = res.data as Record<string, unknown>;
        const summary = extractReportSummary(report);

        return NextResponse.json({
          type: "pnl",
          period: { start: startDate, end: endDate },
          summary,
          raw: report,
        });
      }

      // ── Balance Sheet ──
      case "balance_sheet": {
        const asOf =
          req.nextUrl.searchParams.get("date") || todayISO();

        const res = await qboGet(
          realmId,
          accessToken,
          `/reports/BalanceSheet?date_macro=Today&minorversion=73`,
        );

        if (!res.ok) {
          return NextResponse.json(
            { error: "Balance sheet failed", detail: res.data },
            { status: res.status },
          );
        }

        const report = res.data as Record<string, unknown>;
        const summary = extractReportSummary(report);

        return NextResponse.json({
          type: "balance_sheet",
          asOf,
          summary,
          raw: report,
        });
      }

      // ── Recent purchases/expenses ──
      case "purchases": {
        const limit = Math.min(
          Number(req.nextUrl.searchParams.get("limit") || "50"),
          200,
        );
        const result = await qboQuery<{
          QueryResponse?: {
            Purchase?: Array<{
              Id: string;
              TxnDate?: string;
              TotalAmt?: number;
              PaymentType?: string;
              AccountRef?: { value?: string; name?: string };
              EntityRef?: { name?: string };
              PrivateNote?: string;
              Line?: Array<{
                Description?: string;
                Amount?: number;
                AccountBasedExpenseLineDetail?: {
                  AccountRef?: { name?: string };
                };
              }>;
            }>;
          };
        }>(
          realmId,
          accessToken,
          `SELECT * FROM Purchase ORDERBY TxnDate DESC MAXRESULTS ${limit}`,
        );

        const purchases = (result?.QueryResponse?.Purchase || []).map((p) => ({
          Id: p.Id,
          Date: p.TxnDate,
          Amount: p.TotalAmt || 0,
          PaymentType: p.PaymentType,
          BankAccount: p.AccountRef?.name,
          Vendor: p.EntityRef?.name || null,
          Note: p.PrivateNote || null,
          Lines: (p.Line || [])
            .filter((l) => l.Amount)
            .map((l) => ({
              Description: l.Description,
              Amount: l.Amount,
              Account: l.AccountBasedExpenseLineDetail?.AccountRef?.name,
            })),
        }));

        return NextResponse.json({
          type: "purchases",
          count: purchases.length,
          purchases,
        });
      }

      default:
        return NextResponse.json(
          {
            error: `Unknown type: ${queryType}. Use: vendors, pnl, balance_sheet, purchases`,
          },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: `QBO query failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}

// ── Helpers ──

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function getYTDStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

/**
 * Walk QBO report rows and extract section totals into a flat summary.
 * QBO reports have a nested Row/ColData structure.
 */
function extractReportSummary(
  report: Record<string, unknown>,
): Record<string, string | number> {
  const summary: Record<string, string | number> = {};

  try {
    const rows = (report as { Rows?: { Row?: unknown[] } })?.Rows?.Row;
    if (!Array.isArray(rows)) return summary;

    for (const section of rows) {
      const sec = section as {
        group?: string;
        Summary?: { ColData?: Array<{ value?: string }> };
        Rows?: { Row?: unknown[] };
        Header?: { ColData?: Array<{ value?: string }> };
      };

      const groupName = sec.group || "";

      // Get section total from Summary row
      if (sec.Summary?.ColData) {
        const cols = sec.Summary.ColData;
        if (cols.length >= 2) {
          const label = cols[0]?.value || groupName;
          const value = cols[1]?.value;
          if (label && value) {
            summary[label] = isNaN(Number(value)) ? value : Number(value);
          }
        }
      }

      // Also walk nested rows for detail
      if (sec.Rows?.Row && Array.isArray(sec.Rows.Row)) {
        for (const row of sec.Rows.Row) {
          const r = row as {
            ColData?: Array<{ value?: string }>;
            Summary?: { ColData?: Array<{ value?: string }> };
            type?: string;
          };
          if (r.type === "Data" && r.ColData && r.ColData.length >= 2) {
            const label = r.ColData[0]?.value;
            const value = r.ColData[1]?.value;
            if (label && value && value !== "0.00") {
              const key = groupName
                ? `${groupName} > ${label}`
                : label;
              summary[key] = isNaN(Number(value)) ? value : Number(value);
            }
          }
        }
      }
    }
  } catch {
    // Best-effort parsing
  }

  return summary;
}
