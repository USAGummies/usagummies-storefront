import { readState, writeState } from "@/lib/ops/state";
import {
  ABRA_CONTROL_CHANNEL_ID,
  currentPtDateParts,
  formatCurrency,
  postSlackMessage,
  qboQueryJson,
  round2,
} from "@/lib/ops/operator/reports/shared";

const STATE_KEY = "abra-operator-unified-revenue-last-run" as never;
export const UNIFIED_REVENUE_STATE_KEY = "abra-operator-unified-revenue-summary" as never;

type QboInvoicesResponse = {
  invoices?: Array<Record<string, unknown>>;
};

type QboPurchasesResponse = {
  purchases?: Array<Record<string, unknown>>;
};

export type UnifiedRevenueSummary = {
  date: string;
  amazon: number;
  shopify: number;
  wholesale: number;
  faire: number;
  total: number;
  mtd: number;
  mix: {
    amazonPct: number;
    shopifyPct: number;
    wholesalePct: number;
    fairePct: number;
  };
  trendVsLastWeek: number;
  trendVs7DayAvg: number;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${env.baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status})`);
  }
  return json as T;
}

function yesterdayIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function monthStartIso(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

async function fetchMetricSeries(metricNames: string[], startDate: string, endDate?: string) {
  const names = `(${metricNames.map((name) => encodeURIComponent(name)).join(",")})`;
  const filters = [
    `window_type=eq.daily`,
    `metric_name=in.${names}`,
    `captured_for_date=gte.${startDate}`,
    endDate ? `captured_for_date=lte.${endDate}` : "",
    `select=metric_name,captured_for_date,value`,
    `order=captured_for_date.asc`,
    `limit=5000`,
  ].filter(Boolean);
  return sbFetch<Array<{ metric_name?: string | null; captured_for_date?: string | null; value?: number | null }>>(
    `/rest/v1/kpi_timeseries?${filters.join("&")}`,
  ).catch(() => []);
}

function sumMetricForDay(rows: Array<{ metric_name?: string | null; captured_for_date?: string | null; value?: number | null }>, day: string, names: string[]) {
  return round2(
    rows
      .filter((row) => row.captured_for_date === day && names.includes(String(row.metric_name || "")))
      .reduce((sum, row) => sum + Number(row.value || 0), 0),
  );
}

function sumMetricRange(rows: Array<{ metric_name?: string | null; captured_for_date?: string | null; value?: number | null }>, names: string[]) {
  return round2(
    rows
      .filter((row) => names.includes(String(row.metric_name || "")))
      .reduce((sum, row) => sum + Number(row.value || 0), 0),
  );
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function amountForInvoice(row: Record<string, unknown>): number {
  return Number(row.Amount || row.TotalAmt || row.Balance || 0);
}

function isPaidYesterdayInvoice(row: Record<string, unknown>, day: string): boolean {
  const customer = String(row.Customer || row.CustomerRef || "");
  const date = String(row.Date || row.TxnDate || row.PaidDate || "");
  const status = String(row.Status || "");
  const balance = Number(row.Balance || 0);
  return /inderbitzin/i.test(customer) && date.slice(0, 10) === day && (balance <= 0 || /paid/i.test(status));
}

function isFaireDeposit(row: Record<string, unknown>): boolean {
  const haystack = [
    row.Vendor,
    row.Note,
    row.BankAccount,
    row.Description,
    ...(Array.isArray(row.Lines)
      ? row.Lines.flatMap((line) =>
          line && typeof line === "object"
            ? [String((line as Record<string, unknown>).Description || ""), String((line as Record<string, unknown>).Account || "")]
            : [],
        )
      : []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes("faire");
}

async function upsertUnifiedRevenueMetric(day: string, total: number, summary: UnifiedRevenueSummary): Promise<void> {
  const existing = await sbFetch<Array<{ id: string }>>(
    `/rest/v1/kpi_timeseries?metric_name=eq.daily_revenue_total_unified&window_type=eq.daily&captured_for_date=eq.${day}&select=id&limit=1`,
  ).catch(() => []);

  const payload = {
    metric_name: "daily_revenue_total_unified",
    window_type: "daily",
    captured_for_date: day,
    value: total,
    metadata: {
      amazon: summary.amazon,
      shopify: summary.shopify,
      wholesale: summary.wholesale,
      faire: summary.faire,
      mix: summary.mix,
      trendVsLastWeek: summary.trendVsLastWeek,
      trendVs7DayAvg: summary.trendVs7DayAvg,
    },
  };

  if (existing[0]?.id) {
    await sbFetch(`/rest/v1/kpi_timeseries?id=eq.${existing[0].id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }).catch(() => {});
    return;
  }

  await sbFetch("/rest/v1/kpi_timeseries", {
    method: "POST",
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export async function runUnifiedRevenueDashboard(force = false): Promise<{ ran: boolean; summary: UnifiedRevenueSummary | null }> {
  const { isoDate } = currentPtDateParts();
  const lastRun = await readState<{ date?: string } | null>(STATE_KEY, null);
  if (!force && lastRun?.date === isoDate) {
    const cached = await readState<UnifiedRevenueSummary | null>(UNIFIED_REVENUE_STATE_KEY, null);
    return { ran: false, summary: cached };
  }

  const day = yesterdayIso();
  const monthStart = monthStartIso(day);
  const amazonNames = ["daily_revenue_amazon"];
  const shopifyNames = ["daily_revenue_shopify"];
  const metricRows = await fetchMetricSeries([...amazonNames, ...shopifyNames], monthStart, day);
  const invoices = await qboQueryJson<QboInvoicesResponse>("invoices").catch(() => ({ invoices: [] }));
  const purchases = await qboQueryJson<QboPurchasesResponse>("purchases", { limit: "300" }).catch(() => ({ purchases: [] }));

  const invoiceRows = Array.isArray(invoices.invoices) ? invoices.invoices : [];
  const purchaseRows = Array.isArray(purchases.purchases) ? purchases.purchases : [];
  const amazon = sumMetricForDay(metricRows, day, amazonNames);
  const shopify = sumMetricForDay(metricRows, day, shopifyNames);
  const wholesale = round2(
    invoiceRows
      .filter((row) => isPaidYesterdayInvoice(row, day))
      .reduce((sum, row) => sum + amountForInvoice(row), 0),
  );
  const faire = round2(
    purchaseRows
      .filter((row) => Number(row.Amount || 0) > 0 && String(row.Date || "").slice(0, 10) === day && isFaireDeposit(row))
      .reduce((sum, row) => sum + Number(row.Amount || 0), 0),
  );
  const total = round2(amazon + shopify + wholesale + faire);

  const mtdWholesale = round2(
    invoiceRows
      .filter((row) => {
        const date = String(row.Date || row.TxnDate || row.PaidDate || "");
        return /inderbitzin/i.test(String(row.Customer || "")) && date.slice(0, 10) >= monthStart && date.slice(0, 10) <= day && (Number(row.Balance || 0) <= 0 || /paid/i.test(String(row.Status || "")));
      })
      .reduce((sum, row) => sum + amountForInvoice(row), 0),
  );
  const mtdFaire = round2(
    purchaseRows
      .filter((row) => Number(row.Amount || 0) > 0 && String(row.Date || "").slice(0, 10) >= monthStart && String(row.Date || "").slice(0, 10) <= day && isFaireDeposit(row))
      .reduce((sum, row) => sum + Number(row.Amount || 0), 0),
  );
  const mtd = round2(sumMetricRange(metricRows, amazonNames) + sumMetricRange(metricRows, shopifyNames) + mtdWholesale + mtdFaire);

  const lastWeek = new Date(`${day}T00:00:00Z`);
  lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
  const lastWeekDay = lastWeek.toISOString().slice(0, 10);
  const lastWeekTotal = round2(
    sumMetricForDay(metricRows, lastWeekDay, amazonNames) + sumMetricForDay(metricRows, lastWeekDay, shopifyNames),
  );
  const dayMap = new Map<string, number>();
  for (const row of metricRows) {
    const date = String(row.captured_for_date || "");
    const current = dayMap.get(date) || 0;
    dayMap.set(date, round2(current + Number(row.value || 0)));
  }
  const dailyTotals = [...dayMap.values()].slice(-7);
  const avg7 = dailyTotals.length ? round2(dailyTotals.reduce((sum, value) => sum + value, 0) / dailyTotals.length) : total;

  const summary: UnifiedRevenueSummary = {
    date: day,
    amazon,
    shopify,
    wholesale,
    faire,
    total,
    mtd,
    mix: {
      amazonPct: pct(amazon, total),
      shopifyPct: pct(shopify, total),
      wholesalePct: pct(wholesale, total),
      fairePct: pct(faire, total),
    },
    trendVsLastWeek: lastWeekTotal ? round2(((total - lastWeekTotal) / Math.abs(lastWeekTotal)) * 100) : 0,
    trendVs7DayAvg: avg7 ? round2(((total - avg7) / Math.abs(avg7)) * 100) : 0,
  };

  await upsertUnifiedRevenueMetric(day, total, summary);
  await writeState(UNIFIED_REVENUE_STATE_KEY, summary);
  await writeState(STATE_KEY, { date: isoDate });

  await postSlackMessage(
    ABRA_CONTROL_CHANNEL_ID,
    `📊 Yesterday: ${formatCurrency(total)} total (Amazon ${formatCurrency(amazon)} / Shopify ${formatCurrency(shopify)} / Wholesale ${formatCurrency(wholesale)} / Faire ${formatCurrency(faire)}). ` +
      `MTD: ${formatCurrency(mtd)}. Mix: ${summary.mix.amazonPct}% Amazon, ${summary.mix.shopifyPct}% DTC, ${summary.mix.wholesalePct}% Wholesale, ${summary.mix.fairePct}% Faire.`,
  ).catch(() => {});

  return { ran: true, summary };
}
