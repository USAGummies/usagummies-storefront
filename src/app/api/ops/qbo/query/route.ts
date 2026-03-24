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
      // ── Accounts (Chart of Accounts) ──
      case "accounts": {
        const result = await qboQuery<{
          QueryResponse?: {
            Account?: Array<{
              Id: string;
              Name?: string;
              AccountType?: string;
              AccountSubType?: string;
              AcctNum?: string;
              CurrentBalance?: number;
              Active?: boolean;
            }>;
          };
        }>(realmId, accessToken, "SELECT * FROM Account MAXRESULTS 500");
        const accounts = result?.QueryResponse?.Account || [];
        return NextResponse.json({
          type: "accounts",
          count: accounts.length,
          accounts: accounts.map((a) => ({
            Id: a.Id,
            Name: a.Name || "",
            AccountType: a.AccountType || "",
            AccountSubType: a.AccountSubType || "",
            AcctNum: a.AcctNum || "",
            CurrentBalance: a.CurrentBalance || 0,
            Active: a.Active ?? true,
          })),
        });
      }
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

      // ── Cash Flow Statement ──
      case "cash_flow": {
        const startDate = req.nextUrl.searchParams.get("start") || getYTDStart();
        const endDate = req.nextUrl.searchParams.get("end") || todayISO();
        const res = await qboGet(
          realmId,
          accessToken,
          `/reports/CashFlow?start_date=${startDate}&end_date=${endDate}&minorversion=73`,
        );
        if (!res.ok) {
          return NextResponse.json(
            { error: "Cash flow report failed", detail: res.data },
            { status: res.status },
          );
        }
        const summary = extractReportSummary(res.data as Record<string, unknown>);
        return NextResponse.json({
          type: "cash_flow",
          period: { start: startDate, end: endDate },
          summary,
          raw: res.data,
        });
      }

      // ── Bills ──
      case "bills": {
        const startDate = req.nextUrl.searchParams.get("start");
        const endDate = req.nextUrl.searchParams.get("end");
        const conditions: string[] = [];
        if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
        if (endDate) conditions.push(`TxnDate <= '${endDate}'`);
        const whereClause = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
        const result = await qboQuery<{
          QueryResponse?: {
            Bill?: Array<{
              Id: string;
              TxnDate?: string;
              DueDate?: string;
              TotalAmt?: number;
              Balance?: number;
              VendorRef?: { name?: string };
            }>;
          };
        }>(realmId, accessToken, `SELECT * FROM Bill${whereClause} ORDERBY TxnDate DESC MAXRESULTS 100`);
        const bills = (result?.QueryResponse?.Bill || []).map((b) => ({
          Id: b.Id,
          Date: b.TxnDate,
          DueDate: b.DueDate || null,
          Amount: b.TotalAmt || 0,
          Balance: b.Balance || 0,
          Vendor: b.VendorRef?.name || null,
          Status: (b.Balance || 0) > 0 ? "unpaid" : "paid",
        }));
        return NextResponse.json({ type: "bills", count: bills.length, bills });
      }

      // ── Invoices ──
      case "invoices": {
        const startDate = req.nextUrl.searchParams.get("start");
        const endDate = req.nextUrl.searchParams.get("end");
        const conditions: string[] = [];
        if (startDate) conditions.push(`TxnDate >= '${startDate}'`);
        if (endDate) conditions.push(`TxnDate <= '${endDate}'`);
        const whereClause = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
        const result = await qboQuery<{
          QueryResponse?: {
            Invoice?: Array<{
              Id: string;
              TxnDate?: string;
              DueDate?: string;
              TotalAmt?: number;
              Balance?: number;
              CustomerRef?: { name?: string };
              DocNumber?: string;
            }>;
          };
        }>(realmId, accessToken, `SELECT * FROM Invoice${whereClause} ORDERBY TxnDate DESC MAXRESULTS 100`);
        const invoices = (result?.QueryResponse?.Invoice || []).map((inv) => ({
          Id: inv.Id,
          Date: inv.TxnDate,
          DueDate: inv.DueDate || null,
          Amount: inv.TotalAmt || 0,
          Balance: inv.Balance || 0,
          Customer: inv.CustomerRef?.name || null,
          DocNumber: inv.DocNumber || null,
          Status: (inv.Balance || 0) > 0 ? "outstanding" : "paid",
        }));
        return NextResponse.json({ type: "invoices", count: invoices.length, invoices });
      }

      // ── Customers ──
      case "customers": {
        const result = await qboQuery<{
          QueryResponse?: {
            Customer?: Array<{
              Id: string;
              DisplayName?: string;
              CompanyName?: string;
              Balance?: number;
              Active?: boolean;
              PrimaryEmailAddr?: { Address?: string };
              PrimaryPhone?: { FreeFormNumber?: string };
            }>;
          };
        }>(realmId, accessToken, "SELECT * FROM Customer ORDERBY DisplayName MAXRESULTS 200");
        const customers = (result?.QueryResponse?.Customer || []).map((c) => ({
          Id: c.Id,
          Name: c.DisplayName || c.CompanyName || "(unnamed)",
          Balance: c.Balance || 0,
          Active: c.Active !== false,
          Email: c.PrimaryEmailAddr?.Address || null,
          Phone: c.PrimaryPhone?.FreeFormNumber || null,
        }));
        return NextResponse.json({ type: "customers", count: customers.length, customers });
      }

      // ── Composite Metrics ──
      case "metrics": {
        const today = todayISO();
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
        const [pnlRes, bsRes] = await Promise.all([
          qboGet(realmId, accessToken, `/reports/ProfitAndLoss?start_date=${thirtyDaysAgo}&end_date=${today}&minorversion=73`),
          qboGet(realmId, accessToken, `/reports/BalanceSheet?date_macro=Today&minorversion=73`),
        ]);
        const pnlSummary = pnlRes.ok ? extractReportSummary(pnlRes.data as Record<string, unknown>) : {};
        const bsSummary = bsRes.ok ? extractReportSummary(bsRes.data as Record<string, unknown>) : {};
        const totalRevenue = (pnlSummary["Total Income"] as number) || 0;
        const totalExpenses = (pnlSummary["Total Expenses"] as number) || 0;
        const netIncome = (pnlSummary["Net Income"] as number) || (totalRevenue - totalExpenses);
        const cashPosition = (bsSummary["Bank Accounts"] as number) || (bsSummary["Bank"] as number) || 0;
        const accountsReceivable = (bsSummary["Accounts Receivable"] as number) || 0;
        const accountsPayable = (bsSummary["Accounts Payable"] as number) || 0;
        const burnRate = totalExpenses;
        const runway = burnRate > 0 ? Math.round((cashPosition / burnRate) * 10) / 10 : null;
        return NextResponse.json({
          type: "metrics",
          period: { start: thirtyDaysAgo, end: today },
          cashPosition,
          burnRate,
          runway,
          accountsReceivable,
          accountsPayable,
          netIncome,
          totalRevenue,
          totalExpenses,
          currency: "USD",
          asOfDate: today,
        });
      }

      default:
        return NextResponse.json(
          {
            error: `Unknown type: ${queryType}. Use: accounts, vendors, pnl, balance_sheet, purchases, cash_flow, bills, invoices, customers, metrics`,
          },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "QBO query failed",
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

    const addSummaryValue = (label: string | undefined, value: string | undefined, groupName?: string) => {
      if (!label || value == null || value === "") return;
      const normalized = isNaN(Number(value)) ? value : Number(value);
      summary[label] = normalized;
      if (groupName) {
        summary[`${groupName} > ${label}`] = normalized;
      }
    };

    const walkRows = (rowList: unknown[], parentGroup = "") => {
      for (const rawRow of rowList) {
        const row = rawRow as {
          group?: string;
          type?: string;
          Header?: { ColData?: Array<{ value?: string }> };
          Summary?: { ColData?: Array<{ value?: string }> };
          ColData?: Array<{ value?: string }>;
          Rows?: { Row?: unknown[] };
        };

        const headerLabel = row.Header?.ColData?.[0]?.value || "";
        const groupName = row.group || headerLabel || parentGroup;

        if (row.Summary?.ColData && row.Summary.ColData.length >= 2) {
          addSummaryValue(
            row.Summary.ColData[0]?.value || groupName,
            row.Summary.ColData[1]?.value,
            parentGroup || undefined,
          );
        }

        if (row.type === "Data" && row.ColData && row.ColData.length >= 2) {
          const label = row.ColData[0]?.value;
          const value = row.ColData[1]?.value;
          if (label && value && value !== "0.00") {
            const key = parentGroup ? `${parentGroup} > ${label}` : label;
            summary[key] = isNaN(Number(value)) ? value : Number(value);
          }
        }

        if (row.Rows?.Row && Array.isArray(row.Rows.Row)) {
          walkRows(row.Rows.Row, groupName);
        }
      }
    };

    walkRows(rows);
  } catch {
    // Best-effort parsing
  }

  return summary;
}
