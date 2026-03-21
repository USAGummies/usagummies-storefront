/**
 * Customer Intelligence Engine
 *
 * Ingests Amazon reviews, return reasons, and customer messages.
 * Clusters feedback into themes and generates weekly intelligence briefs.
 *
 * Sources:
 *  - Amazon SP-API reviews (when available)
 *  - Return reason data
 *  - Customer service messages
 *  - Brain entries tagged with customer feedback
 */

import { notifyDaily } from "@/lib/ops/notify";

export type FeedbackTheme = {
  theme: string;
  count: number;
  sentiment: "positive" | "negative" | "neutral";
  examples: string[];
};

export type CustomerIntelResult = {
  totalFeedback: number;
  themes: FeedbackTheme[];
  returnRate: number | null;
  avgRating: number | null;
  alerts: string[];
  timestamp: string;
};

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

// Keyword-based theme detection (lightweight alternative to NLP clustering)
const THEME_PATTERNS: Array<{ theme: string; patterns: RegExp[]; sentiment: "positive" | "negative" | "neutral" }> = [
  { theme: "Packaging", patterns: [/packag|bag|seal|torn|open|leak/i], sentiment: "negative" },
  { theme: "Flavor", patterns: [/flavor|taste|delicious|yummy|bland|artificial/i], sentiment: "neutral" },
  { theme: "Shipping/Delivery", patterns: [/ship|deliver|arrive|late|damaged|melt/i], sentiment: "negative" },
  { theme: "Value/Price", patterns: [/price|expensive|cheap|worth|value|small/i], sentiment: "neutral" },
  { theme: "Dye-Free/Natural", patterns: [/dye.free|natural|color|organic|healthy|clean/i], sentiment: "positive" },
  { theme: "Texture", patterns: [/texture|chewy|hard|soft|stale|fresh/i], sentiment: "neutral" },
  { theme: "Gift/Event", patterns: [/gift|party|kid|birthday|event|patriot|american/i], sentiment: "positive" },
  { theme: "Repeat Purchase", patterns: [/again|reorder|subscribe|love|favorite|regular/i], sentiment: "positive" },
];

async function getCustomerFeedback(): Promise<Array<{ text: string; source: string; date: string }>> {
  const env = getSupabaseEnv();
  if (!env) return [];

  try {
    // Search brain entries for customer-related content
    const res = await fetch(
      `${env.baseUrl}/rest/v1/open_brain_entries?or=(title.ilike.*review*,title.ilike.*customer*,title.ilike.*feedback*,title.ilike.*return*,category.eq.customer)&superseded_by=is.null&select=summary_text,created_at,source_type&order=created_at.desc&limit=50`,
      {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return [];

    const rows = (await res.json()) as Array<{ summary_text: string; created_at: string; source_type: string }>;
    return Array.isArray(rows) ? rows.map(r => ({
      text: r.summary_text || "",
      source: r.source_type || "brain",
      date: r.created_at,
    })) : [];
  } catch { return []; }
}

function classifyThemes(feedback: Array<{ text: string }>): FeedbackTheme[] {
  const themeCounts = new Map<string, { count: number; sentiment: "positive" | "negative" | "neutral"; examples: string[] }>();

  for (const { text } of feedback) {
    for (const tp of THEME_PATTERNS) {
      if (tp.patterns.some(p => p.test(text))) {
        const existing = themeCounts.get(tp.theme) || { count: 0, sentiment: tp.sentiment, examples: [] };
        existing.count++;
        if (existing.examples.length < 3) existing.examples.push(text.slice(0, 100));
        themeCounts.set(tp.theme, existing);
      }
    }
  }

  return Array.from(themeCounts.entries())
    .map(([theme, data]) => ({ theme, ...data }))
    .sort((a, b) => b.count - a.count);
}

export async function runCustomerIntelligence(): Promise<CustomerIntelResult> {
  const feedback = await getCustomerFeedback();
  const themes = classifyThemes(feedback);
  const alerts: string[] = [];

  // Check for negative trend spikes
  const negativeThemes = themes.filter(t => t.sentiment === "negative" && t.count >= 3);
  for (const theme of negativeThemes) {
    alerts.push(`⚠️ Negative trend: "${theme.theme}" mentioned ${theme.count} times`);
  }

  const result: CustomerIntelResult = {
    totalFeedback: feedback.length,
    themes,
    returnRate: null, // Will be populated when Amazon return data is connected
    avgRating: null,
    alerts,
    timestamp: new Date().toISOString(),
  };

  // Post weekly brief
  if (themes.length > 0) {
    const topThemes = themes.slice(0, 5);
    const msg = [
      `🎯 *Customer Intelligence Brief*`,
      `${feedback.length} feedback items analyzed`,
      "",
      ...topThemes.map(t => {
        const icon = t.sentiment === "positive" ? "🟢" : t.sentiment === "negative" ? "🔴" : "🟡";
        return `${icon} *${t.theme}*: ${t.count} mentions`;
      }),
      "",
      ...alerts,
    ].join("\n");
    void notifyDaily(msg);
  }

  return result;
}
