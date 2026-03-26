import { readState, writeState } from "@/lib/ops/state";

export type OpenPoSummary = {
  openCount: number;
  committedRevenue: number;
  overdue: Array<{
    poNumber: string;
    customer: string;
    daysOverdue: number;
  }>;
};

export const OPEN_PO_TRACKER_STATE_KEY = "abra:open_po_summary" as never;

type BrainPoRow = {
  title?: string | null;
  raw_text?: string | null;
  created_at?: string | null;
  source_ref?: string | null;
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
    signal: init.signal ?? AbortSignal.timeout(12000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Supabase ${path} failed (${res.status})`);
  return json as T;
}

function parseAmount(text: string): number {
  const match = text.match(/\$([\d,]+(?:\.\d{2})?)/);
  return match ? Number(match[1].replace(/,/g, "")) || 0 : 0;
}

function parseDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return iso?.[1] || null;
}

function parsePoNumber(text: string): string {
  return text.match(/PO #([A-Z0-9-]+)/i)?.[1] || "unknown";
}

function parseCustomer(text: string): string {
  return text.match(/Open PO:\s*([^–-]+?)(?:\s+PO #|$)/i)?.[1]?.trim() || "Customer";
}

export async function runOpenPoTracker(): Promise<OpenPoSummary> {
  const rows = await sbFetch<BrainPoRow[]>(
    `/rest/v1/open_brain_entries?select=title,raw_text,created_at,source_ref&or=(title.ilike.*Open%20PO:*,source_ref.like.open-po:*)&order=created_at.desc&limit=100`,
  ).catch(() => []);

  const summary: OpenPoSummary = {
    openCount: 0,
    committedRevenue: 0,
    overdue: [],
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const text = `${row.title || ""}\n${row.raw_text || ""}`;
    if (!/Open PO:/i.test(text)) continue;
    summary.openCount += 1;
    summary.committedRevenue += parseAmount(text);
    const deliveryDate = parseDate(text);
    if (!deliveryDate) continue;
    const dueAt = new Date(`${deliveryDate}T00:00:00Z`).getTime();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daysOverdue = Math.floor((today.getTime() - dueAt) / (24 * 60 * 60 * 1000));
    if (daysOverdue > 0) {
      summary.overdue.push({
        poNumber: parsePoNumber(text),
        customer: parseCustomer(text),
        daysOverdue,
      });
    }
  }

  summary.committedRevenue = Math.round(summary.committedRevenue * 100) / 100;
  summary.overdue = summary.overdue.sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 5);
  await writeState(OPEN_PO_TRACKER_STATE_KEY, summary).catch(() => {});
  return summary;
}

export async function getOpenPoSummary(): Promise<OpenPoSummary | null> {
  return readState<OpenPoSummary | null>(OPEN_PO_TRACKER_STATE_KEY, null);
}
