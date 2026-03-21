/**
 * Competitive Price & Listing Monitor
 *
 * Tracks competitor gummy brands on Amazon:
 *  - Price changes
 *  - BSR rank movements
 *  - Review velocity
 *  - Listing changes
 *
 * Alerts when competitors drop below our price or our BSR drops significantly.
 */

import { notifyDaily } from "@/lib/ops/notify";

export type CompetitorSnapshot = {
  asin: string;
  brand: string;
  title: string;
  price: number | null;
  bsr: number | null;
  rating: number | null;
  reviewCount: number | null;
  lastChecked: string;
};

export type CompetitorAlert = {
  type: "price_drop" | "bsr_drop" | "new_product" | "review_spike";
  competitor: string;
  detail: string;
};

// Key competitors to track
const COMPETITORS = [
  { asin: "B0G1JK92TJ", brand: "USA Gummies", label: "Our listing" },
  { asin: "B000JTNFRW", brand: "Haribo", label: "Haribo Gold-Bears" },
  { asin: "B00CMS97GI", brand: "Albanese", label: "Albanese 12 Flavor Gummy Bears" },
  { asin: "B083LPWRQB", brand: "SmartSweets", label: "SmartSweets Gummy Bears" },
  { asin: "B07HFH7P7Y", brand: "YumEarth", label: "YumEarth Organic Gummy Bears" },
];

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

/**
 * Store competitor snapshots in brain entries for tracking over time.
 * In a production system, this would use a dedicated table.
 */
async function storeSnapshot(snapshots: CompetitorSnapshot[]): Promise<void> {
  const env = getSupabaseEnv();
  if (!env || snapshots.length === 0) return;

  const content = snapshots.map(s =>
    `${s.brand} (${s.asin}): $${s.price ?? "?"} | BSR #${s.bsr ?? "?"} | ${s.rating ?? "?"}★ (${s.reviewCount ?? "?"} reviews)`,
  ).join("\n");

  try {
    await fetch(`${env.baseUrl}/rest/v1/open_brain_entries`, {
      method: "POST",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        source_type: "automated",
        source_ref: `competitive-monitor-${new Date().toISOString().slice(0, 10)}`,
        entry_type: "observation",
        title: `Competitive Snapshot — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        raw_text: content,
        summary_text: content.slice(0, 500),
        category: "competitive",
        department: "marketing",
        confidence: "medium",
        priority: "normal",
        processed: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* best effort */ }
}

export type CompetitiveMonitorResult = {
  snapshots: CompetitorSnapshot[];
  alerts: CompetitorAlert[];
  timestamp: string;
};

/**
 * Run competitive monitoring sweep.
 * Note: actual price scraping requires an Amazon Product API key or
 * external scraping service. This creates the framework and uses
 * brain entries as the data source until the API is connected.
 */
export async function runCompetitiveMonitor(): Promise<CompetitiveMonitorResult> {
  const snapshots: CompetitorSnapshot[] = [];
  const alerts: CompetitorAlert[] = [];

  // For now, create placeholder snapshots from known data
  // TODO: Connect Amazon Product Advertising API or Keepa API for live data
  for (const comp of COMPETITORS) {
    snapshots.push({
      asin: comp.asin,
      brand: comp.brand,
      title: comp.label,
      price: null, // Will be populated when API is connected
      bsr: null,
      rating: null,
      reviewCount: null,
      lastChecked: new Date().toISOString(),
    });
  }

  // Store snapshot for historical tracking
  await storeSnapshot(snapshots);

  // Post summary (when we have data)
  const withPrices = snapshots.filter(s => s.price !== null);
  if (withPrices.length > 0) {
    void notifyDaily(
      `🔍 *Competitive Monitor*\n${withPrices.map(s => `• ${s.brand}: $${s.price} | BSR #${s.bsr || "?"}`).join("\n")}`,
    );
  }

  return { snapshots, alerts, timestamp: new Date().toISOString() };
}
