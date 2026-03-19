/**
 * Abra Context Builder — gathers all contextual data for chat responses.
 *
 * Extracted from the monolithic chat route. Contains:
 * - Supabase helpers (sbFetch, getSupabaseEnv)
 * - Live business snapshot (Shopify orders, email inbox)
 * - Financial context (KPI timeseries, ledger, QBO)
 * - Competitor intel fetch/capture
 * - Corrections, departments, initiatives, cost summary
 * - Embedding generation
 */

import { kv } from "@vercel/kv";
import { createHash } from "node:crypto";
import {
  type AbraCorrection,
  type AbraDepartment,
  type AbraInitiativeContext,
  type AbraCostContext,
} from "@/lib/ops/abra-system-prompt";
import { getMonthlySpend } from "@/lib/ops/abra-cost-tracker";
import {
  getCalendarMonthRevenue,
  getRevenueSnapshot,
} from "@/lib/ops/abra-financial-intel";
import { queryLedgerSummary } from "@/lib/ops/abra-notion-write";
import type { PlaybookQuestion } from "@/lib/ops/department-playbooks";
import {
  extractCompetitorHint,
  shouldCaptureCompetitorIntel,
  inferCompetitorDataType,
} from "@/lib/ops/abra-intent";

// ─── Supabase Helpers ───

export function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return { baseUrl, serviceKey };
}

export async function sbFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)}`,
    );
  }

  return json;
}

export function isSupabaseRelatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /supabase|rest\/v1|service_role|SUPABASE/i.test(message);
}

// ─── Initiative Types & Helpers ───

export type AskingInitiative = {
  id: string;
  department: string;
  title: string | null;
  questions: PlaybookQuestion[];
  answers: Record<string, unknown>;
};

export function valueAsText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

// ─── Data Fetching Functions ───

export async function fetchActiveInitiatives(): Promise<AbraInitiativeContext[]> {
  try {
    const rows = (await sbFetch(
      "/rest/v1/abra_initiatives?status=not.in.(completed,paused)&select=id,department,title,goal,status,questions,answers&order=created_at.desc&limit=5",
    )) as Array<{
      id: string;
      department: string;
      title: string | null;
      goal: string;
      status: string;
      questions: Array<{ key: string }>;
      answers: Record<string, string>;
    }>;

    return rows.map((r) => ({
      id: r.id,
      department: r.department,
      title: r.title,
      goal: r.goal,
      status: r.status,
      open_question_count: (r.questions || []).filter(
        (q) => !r.answers?.[q.key],
      ).length,
    }));
  } catch {
    return [];
  }
}

export async function fetchAskingInitiative(
  department: string | null,
): Promise<AskingInitiative | null> {
  try {
    let path =
      "/rest/v1/abra_initiatives?status=eq.asking_questions&select=id,department,title,questions,answers&order=updated_at.desc&limit=5";
    if (department) {
      path += `&department=eq.${encodeURIComponent(department)}`;
    }

    const rows = (await sbFetch(path)) as Array<{
      id: string;
      department: string;
      title: string | null;
      questions: unknown;
      answers: unknown;
    }>;

    for (const row of rows) {
      const questions = Array.isArray(row.questions)
        ? (row.questions as PlaybookQuestion[])
        : [];
      if (!questions.length) continue;
      const answers =
        row.answers && typeof row.answers === "object"
          ? (row.answers as Record<string, unknown>)
          : {};
      const hasOpen = questions.some((q) => !valueAsText(answers[q.key], ""));
      if (hasOpen) {
        return {
          id: row.id,
          department: row.department,
          title: row.title,
          questions,
          answers,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function extractInitiativeAnswers(
  message: string,
  initiative: AskingInitiative,
): Record<string, string> | null {
  const openQuestions = initiative.questions.filter(
    (question) => !valueAsText(initiative.answers[question.key], ""),
  );
  if (!openQuestions.length) return null;

  const parsed: Record<string, string> = {};
  const numbered = Array.from(
    message.matchAll(/(?:^|\n)\s*(\d+)[).:-]\s*([^\n]+)/g),
  );
  if (numbered.length > 0) {
    for (const match of numbered) {
      const index = Number.parseInt(match[1], 10) - 1;
      if (index >= 0 && index < openQuestions.length) {
        const answer = match[2].trim();
        if (answer) {
          parsed[openQuestions[index].key] = answer;
        }
      }
    }
  }

  const lines = message
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const pair = line.match(/^([^:]{2,80}):\s*(.+)$/);
    if (!pair) continue;
    const keyText = pair[1].toLowerCase().trim().replace(/\s+/g, "_");
    const answer = pair[2].trim();
    if (!answer) continue;
    const question = openQuestions.find((q) => {
      const keyMatch = q.key.toLowerCase() === keyText;
      const fuzzyMatch = q.q.toLowerCase().includes(pair[1].toLowerCase().trim());
      return keyMatch || fuzzyMatch;
    });
    if (question) {
      parsed[question.key] = answer;
    }
  }

  if (Object.keys(parsed).length === 0 && openQuestions.length === 1) {
    const fallback = message.trim();
    if (fallback.length >= 2 && fallback.length <= 500) {
      parsed[openQuestions[0].key] = fallback;
    }
  }

  if (Object.keys(parsed).length === 0) {
    return null;
  }
  return parsed;
}

export async function fetchCostSummary(): Promise<AbraCostContext | null> {
  try {
    const spend = await getMonthlySpend();
    return {
      total: spend.total,
      budget: spend.budget,
      remaining: spend.remaining,
      pctUsed: spend.pctUsed,
      byProvider: spend.byProvider,
      byEndpoint: spend.byEndpoint,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a real-time snapshot of today's business activity.
 * Runs on EVERY chat to ensure Abra always has current data.
 * Lightweight — only fetches summary counts, not full payloads.
 */
export async function fetchLiveBusinessSnapshot(): Promise<string | null> {
  const lines: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  // 1. Shopify orders (last 24h) — lightweight REST call
  try {
    const shopifyDomain = process.env.SHOPIFY_STORE || process.env.SHOPIFY_STORE_DOMAIN;
    const shopifyToken = process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const shopifyVersion = process.env.SHOPIFY_API_VERSION || "2024-10";
    if (shopifyDomain && shopifyToken) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const url = `https://${shopifyDomain}/admin/api/${shopifyVersion}/orders.json?status=any&created_at_min=${since}&limit=250`;
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const orders = Array.isArray(data.orders) ? data.orders as Array<{ name?: string; total_price?: string; created_at?: string; financial_status?: string; fulfillment_status?: string | null; customer?: { first_name?: string; last_name?: string }; line_items?: Array<{ title?: string; quantity?: number }> }> : [];
        if (orders.length > 0) {
          const totalRev = orders.reduce((s, o) => s + parseFloat(o.total_price || "0"), 0);
          const unfulfilled = orders.filter(o => !o.fulfillment_status || o.fulfillment_status === "null").length;
          lines.push(`LIVE SHOPIFY (last 24h, as of ${today}): ${orders.length} orders, $${totalRev.toFixed(2)} revenue, ${unfulfilled} unfulfilled.`);
          // Show most recent 5 orders
          const recent = orders.slice(0, 5);
          for (const o of recent) {
            const items = (o.line_items || []).map(li => `${li.quantity}x ${li.title}`).join(", ");
            const custName = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || "Guest";
            lines.push(`  • ${o.name}: $${o.total_price} from ${custName} — ${items} (${o.financial_status || "pending"}, ${o.fulfillment_status || "unfulfilled"})`);
          }
          if (orders.length > 5) lines.push(`  ... and ${orders.length - 5} more orders.`);
        } else {
          lines.push(`LIVE SHOPIFY (last 24h): No orders.`);
        }
      }
    }
  } catch { /* non-fatal */ }

  // 2. Recent emails (last 5 inbox subjects) — lightweight metadata only
  try {
    const gmailUser = process.env.GMAIL_USER || process.env.GMAIL_SENDER || process.env.SMTP_USER;
    const gmailClientId = process.env.GMAIL_CLIENT_ID || process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GCP_GMAIL_OAUTH_CLIENT_ID;
    const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN || process.env.GMAIL_OAUTH_REFRESH_TOKEN || process.env.GCP_GMAIL_OAUTH_REFRESH_TOKEN;
    if ((gmailUser || gmailClientId) && gmailClientId && gmailRefreshToken) {
      // Dynamic import to avoid loading googleapis on every request
      const { listEmails } = await import("@/lib/ops/gmail-reader");
      const envelopes = await listEmails({ count: 5, folder: "INBOX" });
      if (envelopes.length > 0) {
        lines.push(`LIVE INBOX (${envelopes.length} recent — use read_email action for full content):`);
        for (const e of envelopes.slice(0, 5)) {
          const age = e.date ? `${Math.round((Date.now() - new Date(e.date).getTime()) / 3600000)}h ago` : "";
          const snippet = e.snippet ? ` — ${e.snippet.slice(0, 80)}` : "";
          lines.push(`  • [${e.id}] ${e.from}: "${e.subject}" (${age})${snippet}`);
        }
      }
    }
  } catch { /* non-fatal */ }

  return lines.length > 0 ? lines.join("\n") : null;
}

export async function fetchFinancialContext(): Promise<string | null> {
  try {
    const [calMonth, weekSnapshot] = await Promise.all([
      getCalendarMonthRevenue(),
      getRevenueSnapshot("week"),
    ]);

    // Guard: if both sources return zero data, treat as unavailable
    if (calMonth.days_with_data === 0 && weekSnapshot.order_count === 0) {
      console.log("[abra] Financial context: both KPI sources returned zero data");
      return null;
    }

    const lines = [
      `${calMonth.month} calendar month revenue (${calMonth.days_with_data} days of data): Shopify $${calMonth.shopify_revenue.toFixed(2)} (${calMonth.shopify_orders} orders), Amazon $${calMonth.amazon_revenue.toFixed(2)} (${calMonth.amazon_orders} orders), TOTAL $${calMonth.total_revenue.toFixed(2)} (${calMonth.total_orders} orders, AOV $${calMonth.avg_order_value.toFixed(2)}).`,
      `Last 7 days revenue: total $${weekSnapshot.total_revenue.toFixed(2)} (${weekSnapshot.order_count} orders, AOV $${weekSnapshot.avg_order_value.toFixed(2)}).`,
    ];

    return lines.join("\n");
  } catch (err) {
    console.error("[abra] Financial context fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fetch verified Notion ledger data for financial questions.
 * Returns P&L summary from the actual Cash & Transactions database — Layer 3 (bank deposits).
 * This is the authoritative financial source, NOT brain memory entries.
 */
export async function fetchLedgerContext(message: string): Promise<string | null> {
  // 3s timeout — Notion pagination is slow; KV cache handles repeat queries
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  return Promise.race([fetchLedgerContextInner(message), timeout]);
}

async function fetchLedgerContextInner(message: string): Promise<string | null> {
  try {
    // Detect which fiscal year the user is asking about
    const currentYear = new Date().getFullYear().toString();
    const yearMatch = message.match(/\b(20\d{2})\b/);
    const requestedYear = yearMatch ? yearMatch[1] : null;

    // Fetch both current year and requested year (if different)
    const yearsToFetch = new Set<string>([currentYear]);
    if (requestedYear) yearsToFetch.add(requestedYear);

    const results: string[] = [];
    results.push("VERIFIED NOTION LEDGER DATA (Layer 3: Bank Deposits — these are NET deposits, not gross revenue):");
    results.push("Source: Notion Cash & Transactions database (https://www.notion.so/6325d16870024b83876b9e591b3d2d9c)");

    for (const year of yearsToFetch) {
      // Check KV cache first (1-hour TTL) — Notion pagination over 400+ rows is slow
      const cacheKey = `abra:ledger:FY${year}`;
      type LedgerSummary = Awaited<ReturnType<typeof queryLedgerSummary>>;
      let ledger: LedgerSummary | null = null;
      try {
        ledger = await kv.get<LedgerSummary>(cacheKey);
      } catch { /* KV unavailable — fall through to Notion */ }
      if (!ledger) {
        ledger = await queryLedgerSummary({ fiscalYear: `FY${year}` });
        try { await kv.set(cacheKey, ledger, { ex: 3600 }); } catch { /* KV write failed — non-critical */ }
      }
      if (ledger.summary.transactionCount === 0) continue;

      const s = ledger.summary;
      results.push(`\nFY${year} (${s.transactionCount} transactions):`);
      results.push(`  Revenue (bank deposits): $${s.totalIncome.toFixed(2)}`);
      results.push(`  COGS: $${s.totalCOGS.toFixed(2)}`);
      results.push(`  Operating Expenses: $${s.totalExpenses.toFixed(2)}`);
      results.push(`  Total Spend (COGS + OpEx): $${s.totalAllSpend.toFixed(2)}`);
      results.push(`  Net Income: $${s.netIncome.toFixed(2)}`);
      if (s.totalOwnerInvestment > 0) {
        results.push(`  Owner Investment/Transfers: $${s.totalOwnerInvestment.toFixed(2)}`);
      }

      // Top categories
      const sortedCats = Object.entries(s.byCategory)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);
      if (sortedCats.length > 0) {
        results.push("  By Category:");
        for (const [cat, amt] of sortedCats) {
          results.push(`    ${cat}: $${amt.toFixed(2)}`);
        }
      }

      // Top vendors (from transaction detail)
      const vendorTotals: Record<string, number> = {};
      for (const tx of ledger.transactions) {
        if (tx.vendor && tx.fiscalYear === `FY${year}`) {
          vendorTotals[tx.vendor] = (vendorTotals[tx.vendor] || 0) + Math.abs(tx.amount);
        }
      }
      const sortedVendors = Object.entries(vendorTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8);
      if (sortedVendors.length > 0) {
        results.push("  Top Vendors:");
        for (const [vendor, amt] of sortedVendors) {
          results.push(`    ${vendor}: $${amt.toFixed(2)}`);
        }
      }
    }

    return results.length > 2 ? results.join("\n") : null;
  } catch (err) {
    console.error("[abra] Ledger context fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Competitor Intelligence ───

type CompetitorIntelRow = {
  competitor_name: string;
  data_type: string;
  title: string;
  detail: string | null;
  created_at: string;
};

function buildCompetitorDedupeKey(params: {
  competitorName: string;
  dataType: string;
  message: string;
}): string {
  const canonical = [
    params.competitorName.toLowerCase(),
    params.dataType.toLowerCase(),
    params.message.trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export async function captureCompetitorIntelFromChat(params: {
  message: string;
  userEmail: string;
  threadId: string;
}) {
  if (!shouldCaptureCompetitorIntel(params.message)) return;
  const competitorName = extractCompetitorHint(params.message);
  if (!competitorName) return;

  const title =
    params.message.length > 120
      ? `${params.message.slice(0, 117)}...`
      : params.message;
  const dataType = inferCompetitorDataType(params.message);
  const dedupeKey = buildCompetitorDedupeKey({
    competitorName,
    dataType,
    message: params.message,
  });

  try {
    await sbFetch("/rest/v1/abra_competitor_intel?on_conflict=dedupe_key", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        competitor_name: competitorName,
        data_type: dataType,
        title,
        detail: params.message,
        source: "manual",
        metadata: {
          captured_from_chat: true,
          thread_id: params.threadId,
        },
        dedupe_key: dedupeKey,
        department: "sales_and_growth",
        created_by: params.userEmail,
      }),
    });
  } catch {
    await sbFetch("/rest/v1/abra_competitor_intel", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        competitor_name: competitorName,
        data_type: dataType,
        title,
        detail: params.message,
        source: "manual",
        metadata: {
          captured_from_chat: true,
          thread_id: params.threadId,
        },
        department: "sales_and_growth",
        created_by: params.userEmail,
      }),
    });
  }
}

export async function fetchCompetitorContext(message: string): Promise<string | null> {
  try {
    const hint = extractCompetitorHint(message);
    const params = new URLSearchParams({
      select: "competitor_name,data_type,title,detail,created_at",
      order: "created_at.desc",
      limit: "8",
    });
    if (hint) {
      const cleaned = hint.replace(/[*%().,]/g, "").slice(0, 200);
      if (cleaned) {
        params.set("competitor_name", `ilike.*${encodeURIComponent(cleaned)}*`);
      }
    }

    const rows = (await sbFetch(
      `/rest/v1/abra_competitor_intel?${params.toString()}`,
    )) as CompetitorIntelRow[];
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const lines = rows.slice(0, 6).map((row, idx) => {
      const detail = row.detail ? ` — ${row.detail.slice(0, 160)}` : "";
      return `${idx + 1}. ${row.competitor_name} [${row.data_type}] ${row.title}${detail}`;
    });

    return `Recent competitor intelligence:\n${lines.join("\n")}\nUse this context in sales_and_growth recommendations and competitor comparisons.`;
  } catch {
    return null;
  }
}

// ─── Embeddings ───

export async function buildEmbedding(query: string): Promise<number[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY not configured for embeddings");
  }

  const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: query,
      dimensions: 1536,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!embeddingRes.ok) {
    const errorText = await embeddingRes.text().catch(() => "");
    throw new Error(
      `Embedding generation failed (${embeddingRes.status}): ${errorText.slice(0, 200)}`,
    );
  }

  const data = await embeddingRes.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Failed to parse embedding vector");
  }

  return embedding as number[];
}

// ─── Corrections & Departments ───

export async function fetchCorrections(): Promise<AbraCorrection[]> {
  try {
    return (await sbFetch(
      "/rest/v1/abra_corrections?active=eq.true&order=created_at.desc&limit=10&select=original_claim,correction,corrected_by,department",
    )) as AbraCorrection[];
  } catch {
    return [];
  }
}

export async function fetchDepartments(): Promise<AbraDepartment[]> {
  try {
    return (await sbFetch(
      "/rest/v1/abra_departments?select=name,owner_name,description,key_context,operating_pillar,executive_role,sub_departments,parent_department&order=name",
    )) as AbraDepartment[];
  } catch {
    return [];
  }
}
