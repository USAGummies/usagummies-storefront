import { notify } from "@/lib/ops/notify";
import { readState, writeState } from "@/lib/ops/state";
import { currentPtDateParts, round2 } from "@/lib/ops/operator/reports/shared";

const STATE_KEY = "abra-operator-unified-inventory-last-run" as never;
const THRESHOLD_STATE_KEY = "abra-operator-unified-inventory-threshold" as never;
export const UNIFIED_INVENTORY_STATE_KEY = "abra-operator-unified-inventory-summary" as never;

type BrainRow = {
  title?: string | null;
  raw_text?: string | null;
  summary_text?: string | null;
  created_at?: string | null;
};

export type UnifiedInventorySummary = {
  date: string;
  fbaUnits: number;
  benUnits: number;
  andrewUnits: number;
  powersUnits: number;
  committedUnits: number;
  freeUnits: number;
  daysOfSupply: number;
  threshold: "healthy" | "warning" | "critical";
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
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status})`);
  }
  return json as T;
}

function thresholdForDays(days: number): "healthy" | "warning" | "critical" {
  if (!Number.isFinite(days) || days >= 30) return "healthy";
  if (days >= 14) return "warning";
  return "critical";
}

function extractLargestNumber(text: string, pattern: RegExp): number {
  const matches = [...text.matchAll(pattern)].map((match) => Number(String(match[1] || "").replace(/,/g, ""))).filter(Number.isFinite);
  return matches.length ? Math.max(...matches) : 0;
}

function parseInventory(rows: BrainRow[]): Omit<UnifiedInventorySummary, "date" | "daysOfSupply" | "threshold"> {
  let fbaUnits = 0;
  let benUnits = 0;
  let andrewUnits = 0;
  let powersUnits = 0;
  let committedUnits = 0;

  for (const row of rows) {
    const text = `${row.title || ""}\n${row.raw_text || row.summary_text || ""}`.toLowerCase();
    const units = extractLargestNumber(text, /(\d[\d,]*)\s+units?/gi);
    if (!units) continue;
    if (/fba|amazon inventory/.test(text)) fbaUnits = Math.max(fbaUnits, units);
    if (/andrew/.test(text)) andrewUnits = Math.max(andrewUnits, units);
    if (/\bpowers\b|production run|in production/.test(text)) powersUnits = Math.max(powersUnits, units);
    if (/\b(i have|ben|my location|office)\b/.test(text)) benUnits = Math.max(benUnits, units);
    if (/inderbitzin|po/.test(text)) committedUnits = Math.max(committedUnits, units);
  }

  if (!committedUnits) committedUnits = 828;
  return { fbaUnits, benUnits, andrewUnits, powersUnits, committedUnits, freeUnits: 0 };
}

async function fetchSalesVelocity(): Promise<number> {
  const rows = await sbFetch<Array<{ metric_name?: string | null; value?: number | null }>>(
    "/rest/v1/kpi_timeseries?window_type=eq.daily&metric_name=in.(daily_orders_amazon,daily_orders_shopify)&select=metric_name,value&order=captured_for_date.desc&limit=14",
  ).catch(() => []);
  const values = (Array.isArray(rows) ? rows : []).map((row) => Number(row.value || 0)).filter((value) => Number.isFinite(value));
  if (!values.length) return 1;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length) || 1;
}

export async function runUnifiedInventoryPosition(force = false): Promise<{ ran: boolean; summary: UnifiedInventorySummary | null }> {
  const { isoDate } = currentPtDateParts();
  const lastRun = await readState<{ date?: string } | null>(STATE_KEY, null);
  if (!force && lastRun?.date === isoDate) {
    const cached = await readState<UnifiedInventorySummary | null>(UNIFIED_INVENTORY_STATE_KEY, null);
    return { ran: false, summary: cached };
  }

  const rows = await sbFetch<BrainRow[]>(
    `/rest/v1/open_brain_entries?select=title,raw_text,summary_text,created_at&or=(title.ilike.*inventory*,raw_text.ilike.*inventory*,raw_text.ilike.*units*,raw_text.ilike.*andrew*,raw_text.ilike.*powers*,raw_text.ilike.*fba*)&order=created_at.desc&limit=80`,
  ).catch(() => []);
  const parsed = parseInventory(Array.isArray(rows) ? rows : []);
  const velocity = await fetchSalesVelocity();
  const freeUnits = Math.max(0, parsed.fbaUnits + parsed.benUnits + parsed.andrewUnits + parsed.powersUnits - parsed.committedUnits);
  const daysOfSupply = velocity > 0 ? round2(freeUnits / velocity) : 0;
  const threshold = thresholdForDays(daysOfSupply);
  const summary: UnifiedInventorySummary = {
    date: isoDate,
    ...parsed,
    freeUnits,
    daysOfSupply,
    threshold,
  };

  const previousThreshold = await readState<string | null>(THRESHOLD_STATE_KEY, null);
  if (previousThreshold !== threshold) {
    await notify({
      channel: "alerts",
      text:
        `📦 Unified inventory: FBA ${summary.fbaUnits}, Ben ${summary.benUnits}, Andrew ${summary.andrewUnits}, Powers ${summary.powersUnits}, committed ${summary.committedUnits}, free ${summary.freeUnits}. ` +
        `Runway ~${summary.daysOfSupply} days (${threshold}).`,
    }).catch(() => {});
  }

  await writeState(THRESHOLD_STATE_KEY, threshold);
  await writeState(UNIFIED_INVENTORY_STATE_KEY, summary);
  await writeState(STATE_KEY, { date: isoDate });
  return { ran: true, summary };
}
