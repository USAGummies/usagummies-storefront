/**
 * GET /api/ops/abra/download?id=<fileId>
 *
 * Serves generated files as direct downloads for web chat context
 * (where there's no Slack channel to upload to).
 *
 * Files are generated on-demand from data sources and streamed as
 * XLSX or CSV with proper Content-Disposition headers.
 */

import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/ops/abra-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reuse the data source fetcher from abra-actions
async function fetchDataForSource(source: string): Promise<{
  headers: string[];
  rows: (string | number | boolean | null)[][];
  sheetName?: string;
} | null> {
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:4000";
  const cronSecret = (process.env.CRON_SECRET || "").trim();

  // Use the chat endpoint to trigger a generate_file with inline data return
  // For known sources, fetch directly
  if (source === "qbo_vendors" || source === "qbo_accounts" || source === "qbo_pnl") {
    const { getValidAccessToken, getRealmId } = await import("@/lib/ops/qbo-auth");
    const token = await getValidAccessToken();
    const realmId = await getRealmId();
    if (!token || !realmId) return null;

    const qboBase = process.env.QBO_SANDBOX === "true"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";

    if (source === "qbo_vendors") {
      const res = await fetch(
        `${qboBase}/v3/company/${realmId}/query?query=${encodeURIComponent("SELECT * FROM Vendor MAXRESULTS 1000")}&minorversion=73`,
        { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { QueryResponse?: { Vendor?: Array<Record<string, unknown>> } };
      const vendors = data.QueryResponse?.Vendor || [];
      return {
        sheetName: "Vendors",
        headers: ["Vendor Name", "Balance", "Active", "Email", "Phone"],
        rows: vendors.map((v) => [
          String(v.DisplayName || v.CompanyName || ""),
          typeof v.Balance === "number" ? v.Balance : 0,
          v.Active !== false,
          v.PrimaryEmailAddr && typeof v.PrimaryEmailAddr === "object" ? String((v.PrimaryEmailAddr as Record<string, unknown>).Address || "") : "",
          v.PrimaryPhone && typeof v.PrimaryPhone === "object" ? String((v.PrimaryPhone as Record<string, unknown>).FreeFormNumber || "") : "",
        ]),
      };
    }

    if (source === "qbo_accounts") {
      const res = await fetch(
        `${qboBase}/v3/company/${realmId}/query?query=${encodeURIComponent("SELECT * FROM Account MAXRESULTS 1000")}&minorversion=73`,
        { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { QueryResponse?: { Account?: Array<Record<string, unknown>> } };
      const accounts = data.QueryResponse?.Account || [];
      return {
        sheetName: "Chart of Accounts",
        headers: ["ID", "Account Name", "Type", "Sub-Type", "Balance", "Active"],
        rows: accounts.map((a) => [
          String(a.Id ?? ""), String(a.Name ?? ""), String(a.AccountType ?? ""),
          String(a.AccountSubType ?? ""), typeof a.CurrentBalance === "number" ? a.CurrentBalance : 0, a.Active !== false,
        ]),
      };
    }
  }

  if (source === "kpi_daily_revenue") {
    const env = getSupabaseEnv();
    if (!env) return null;
    const monthStr = new Date().toISOString().slice(0, 7);
    const firstOfMonth = `${monthStr}-01`;
    const metrics = encodeURIComponent("(daily_revenue_shopify,daily_revenue_amazon,daily_orders_shopify,daily_orders_amazon)");
    const res = await fetch(
      `${env.baseUrl}/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.${metrics}&captured_for_date=gte.${firstOfMonth}&select=metric_name,value,captured_for_date&order=captured_for_date.asc&limit=500`,
      { headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ metric_name: string; value: number; captured_for_date: string }>;
    const byDate = new Map<string, { shopify_rev: number; amazon_rev: number; shopify_ord: number; amazon_ord: number }>();
    for (const r of Array.isArray(rows) ? rows : []) {
      const d = r.captured_for_date;
      if (!byDate.has(d)) byDate.set(d, { shopify_rev: 0, amazon_rev: 0, shopify_ord: 0, amazon_ord: 0 });
      const e = byDate.get(d)!;
      const v = Number(r.value) || 0;
      if (r.metric_name === "daily_revenue_shopify") e.shopify_rev += v;
      else if (r.metric_name === "daily_revenue_amazon") e.amazon_rev += v;
      else if (r.metric_name === "daily_orders_shopify") e.shopify_ord += v;
      else if (r.metric_name === "daily_orders_amazon") e.amazon_ord += v;
    }
    const dates = Array.from(byDate.keys()).sort();
    return {
      sheetName: "Daily Revenue",
      headers: ["Date", "Shopify ($)", "Amazon ($)", "Total ($)", "Shopify Orders", "Amazon Orders", "Total Orders"],
      rows: dates.map(date => {
        const e = byDate.get(date)!;
        return [date, Math.round(e.shopify_rev * 100) / 100, Math.round(e.amazon_rev * 100) / 100,
          Math.round((e.shopify_rev + e.amazon_rev) * 100) / 100, Math.round(e.shopify_ord), Math.round(e.amazon_ord),
          Math.round(e.shopify_ord + e.amazon_ord)];
      }),
    };
  }

  return null;
}

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

function generateCSV(headers: string[], rows: (string | number | boolean | null)[][]): string {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) {
    lines.push(row.map(escape).join(","));
  }
  return lines.join("\n");
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const source = url.searchParams.get("source") || "";
  const format = url.searchParams.get("format") || "csv";
  const filename = url.searchParams.get("filename") || `export.${format}`;

  if (!source) {
    return NextResponse.json(
      { error: "source parameter required (qbo_vendors, qbo_accounts, kpi_daily_revenue)" },
      { status: 400 },
    );
  }

  try {
    const data = await fetchDataForSource(source);
    if (!data) {
      return NextResponse.json({ error: `No data from source: ${source}` }, { status: 404 });
    }

    if (format === "xlsx") {
      // For XLSX, use exceljs if available, otherwise fall back to CSV
      try {
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(data.sheetName || "Sheet1");
        sheet.addRow(data.headers);
        for (const row of data.rows) {
          sheet.addRow(row);
        }
        // Style header row
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B365D" } };
        headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };

        const buffer = await workbook.xlsx.writeBuffer();
        return new NextResponse(buffer as ArrayBuffer, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      } catch {
        // Fall through to CSV if exceljs not available
      }
    }

    // CSV format
    const csv = generateCSV(data.headers, data.rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename.replace(/\.xlsx$/, ".csv")}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Download failed" },
      { status: 500 },
    );
  }
}
