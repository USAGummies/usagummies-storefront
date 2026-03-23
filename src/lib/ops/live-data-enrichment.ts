/**
 * Real-Time Data Enrichment
 *
 * When the intent router classifies a message as sales/finance,
 * fetches fresh data from live APIs before responding.
 * Prevents stale brain entries from overriding current reality.
 */

import type { AgentDomain } from "@/lib/ops/agents/intent-router";

export type LiveEnrichment = {
  domain: AgentDomain;
  data: string;
  source: string;
  fetchedAt: string;
};

/**
 * Fetch real-time data for a domain to inject into Claude's context.
 * Returns a formatted context string or empty string if unavailable.
 */
export async function fetchLiveEnrichment(
  domain: AgentDomain,
  host: string,
  cronSecret: string,
): Promise<LiveEnrichment | null> {
  const fetchWithTimeout = async (url: string, timeoutMs = 8000) => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return res.json();
  };

  try {
    switch (domain) {
      case "sales": {
        // Fetch live Shopify orders from last 24h
        const data = (await fetchWithTimeout(`${host}/api/ops/abra/chat?mode=health`)) as Record<string, unknown> | null;
        if (!data) return null;

        // Also check KPI timeseries for today
        const env = getSupabaseEnv();
        if (!env) return null;
        const today = new Date().toISOString().slice(0, 10);
        const kpiRes = await fetch(
          `${env.baseUrl}/rest/v1/kpi_timeseries?window_type=eq.daily&captured_for_date=eq.${today}&select=metric_name,value&limit=10`,
          { headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000) },
        );
        if (!kpiRes.ok) return null;
        const kpiRows = (await kpiRes.json()) as Array<{ metric_name: string; value: number }>;
        const todayRev = (Array.isArray(kpiRows) ? kpiRows : [])
          .filter(r => r.metric_name.includes("revenue"))
          .reduce((s, r) => s + (Number(r.value) || 0), 0);
        const todayOrd = (Array.isArray(kpiRows) ? kpiRows : [])
          .filter(r => r.metric_name.includes("orders"))
          .reduce((s, r) => s + (Number(r.value) || 0), 0);

        return {
          domain: "sales",
          data: `LIVE TODAY (${today}): $${todayRev.toFixed(2)} revenue, ${Math.round(todayOrd)} orders`,
          source: "kpi_timeseries",
          fetchedAt: new Date().toISOString(),
        };
      }

      case "finance": {
        // Fetch Plaid balance
        const plaidData = (await fetchWithTimeout(`${host}/api/ops/plaid/balance`)) as {
          connected?: boolean;
          accounts?: Array<{ name: string; type: string; subtype?: string; balances?: { current?: number; available?: number; currency?: string } }>;
        } | null;

        if (!plaidData?.connected || !plaidData.accounts?.length) return null;
        const checking = plaidData.accounts.find(a => a.type === "depository") || plaidData.accounts[0];
        const balance = checking.balances?.current ?? 0;
        const available = checking.balances?.available ?? balance;
        return {
          domain: "finance",
          data: `LIVE BANK BALANCE (Plaid — authoritative): $${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} current, $${available.toLocaleString("en-US", { minimumFractionDigits: 2 })} available (${checking.name}, Bank of America). IGNORE QBO book balance — this is the real number.`,
          source: "plaid",
          fetchedAt: new Date().toISOString(),
        };
      }

      case "supply_chain": {
        // Check inventory from Shopify
        try {
          const { adminRequest } = await import("@/lib/shopify/admin");
          const inv = await adminRequest("/products/count.json");
          if (inv) {
            return {
              domain: "supply_chain",
              data: `LIVE SHOPIFY: ${(inv as { count?: number }).count || "?"} products in catalog`,
              source: "shopify_admin",
              fetchedAt: new Date().toISOString(),
            };
          }
        } catch { /* */ }
        return null;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}
