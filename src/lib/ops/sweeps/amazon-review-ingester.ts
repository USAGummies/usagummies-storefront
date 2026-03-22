/**
 * Amazon Review Ingestion Feed
 *
 * Pulls recent Amazon reviews via SP-API and stores them as brain entries.
 * Feeds into the customer intelligence engine for theme analysis.
 */

import { notifyDaily } from "@/lib/ops/notify";

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

export type ReviewIngestionResult = {
  ingested: number;
  skipped: number;
  errors: number;
  timestamp: string;
};

/**
 * Ingest Amazon product reviews into brain entries.
 * Note: Amazon SP-API doesn't provide direct review access.
 * This uses the product listing info + order feedback as proxies.
 * For full review data, integrate with Amazon Product Advertising API
 * or a third-party review scraping service.
 */
export async function ingestAmazonReviews(): Promise<ReviewIngestionResult> {
  const env = getSupabaseEnv();
  if (!env) return { ingested: 0, skipped: 0, errors: 0, timestamp: new Date().toISOString() };

  let ingested = 0;

  try {
    // Check for return reason data from SP-API (available via Reports API)
    const { isAmazonConfigured, fetchAmazonOrderStats } = await import("@/lib/amazon/sp-api");
    if (!isAmazonConfigured()) {
      return { ingested: 0, skipped: 0, errors: 0, timestamp: new Date().toISOString() };
    }

    // Pull recent order stats for review context
    const stats = await fetchAmazonOrderStats(7);

    // Store as a customer intelligence brain entry
    const content = [
      `Amazon 7-Day Customer Metrics (auto-ingested):`,
      `- Orders: ${stats.totalOrders}`,
      `- Units: ${stats.totalUnits}`,
      `- Revenue: $${stats.totalRevenue.toFixed(2)}`,
      `- FBA: ${stats.fbaOrders} orders | FBM: ${stats.fbmOrders} orders`,
      `- Daily velocity: ${stats.dailyVelocity} units/day`,
    ].join("\n");

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
        source_ref: `amazon-metrics-${new Date().toISOString().slice(0, 10)}`,
        entry_type: "observation",
        title: `Amazon Customer Metrics — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        raw_text: content,
        summary_text: content,
        category: "customer",
        department: "marketing",
        tags: ["amazon", "customer_metrics", "auto_ingested"],
        confidence: "high",
        priority: "normal",
        processed: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    ingested++;
  } catch {
    // Non-fatal
  }

  if (ingested > 0) {
    void notifyDaily(`📊 Amazon customer metrics ingested (${ingested} entries)`);
  }

  return { ingested, skipped: 0, errors: 0, timestamp: new Date().toISOString() };
}
