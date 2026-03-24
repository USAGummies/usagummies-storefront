export type LearnedQboRule = {
  id?: string;
  pattern: string;
  normalized_pattern: string;
  account_id: string;
  account_name: string;
  confidence?: number | null;
  source?: string | null;
  created_by?: string | null;
  notes?: string | null;
  active?: boolean | null;
};

export type ResolvedQboCategory = {
  matched: boolean;
  confidence: number;
  accountId: string | null;
  accountName: string | null;
  reasoning: string;
  pattern: string | null;
  source: "learned_rule" | "builtin_exact" | "builtin_partial" | "builtin_recurring" | "unmatched";
};

type BuiltinRule = {
  pattern: string;
  accountId: string;
  accountName: string;
  regex: RegExp;
  exactNames: string[];
  recurringAmounts?: number[];
};

const BUILTIN_QBO_RULES: BuiltinRule[] = [
  { pattern: "PIRATE SHIP", accountId: "127", accountName: "Shipping", regex: /pirate\s*ship|pirateship/i, exactNames: ["pirate ship", "pirateship"] },
  { pattern: "ANTHROPIC", accountId: "126", accountName: "Software", regex: /anthropic|claude/i, exactNames: ["anthropic", "claude"], recurringAmounts: [21, 21.69, 22] },
  { pattern: "SHOPIFY", accountId: "126", accountName: "Software", regex: /shopify/i, exactNames: ["shopify"] },
  { pattern: "AMAZON", accountId: "122", accountName: "Merchant fees", regex: /amazon/i, exactNames: ["amazon"] },
  { pattern: "GOOGLE", accountId: "16", accountName: "Advertising", regex: /google|youtube/i, exactNames: ["google", "youtube"] },
  { pattern: "FACEBOOK", accountId: "16", accountName: "Advertising", regex: /facebook|meta/i, exactNames: ["facebook", "meta"] },
  { pattern: "GEICO", accountId: "42", accountName: "Insurance", regex: /geico/i, exactNames: ["geico"] },
  { pattern: "T-MOBILE", accountId: "91", accountName: "Utilities", regex: /t-mobile|tmobile/i, exactNames: ["t mobile", "tmobile"] },
  { pattern: "INTUIT", accountId: "126", accountName: "Software", regex: /intuit|quickbooks/i, exactNames: ["intuit", "quickbooks"] },
  { pattern: "OFFICE DEPOT", accountId: "83", accountName: "Supplies", regex: /office\s*depot|uline/i, exactNames: ["office depot", "uline"] },
  { pattern: "SLACK", accountId: "126", accountName: "Software", regex: /slack/i, exactNames: ["slack"] },
  { pattern: "OPENAI", accountId: "126", accountName: "Software", regex: /openai/i, exactNames: ["openai"] },
  { pattern: "STRIPE", accountId: "122", accountName: "Merchant fees", regex: /stripe/i, exactNames: ["stripe"] },
  { pattern: "ARCO", accountId: "146", accountName: "Vehicle fuel", regex: /arco|shell|chevron/i, exactNames: ["arco", "shell", "chevron"] },
  { pattern: "ALBANESE", accountId: "176", accountName: "COGS Albanese", regex: /albanese/i, exactNames: ["albanese"] },
  { pattern: "BELMARK", accountId: "177", accountName: "COGS Belmark", regex: /belmark/i, exactNames: ["belmark"] },
  { pattern: "POWERS", accountId: "178", accountName: "COGS Powers", regex: /powers/i, exactNames: ["powers"] },
  { pattern: "DUTCH VALLEY", accountId: "28", accountName: "COGS general", regex: /dutch\s*valley/i, exactNames: ["dutch valley"] },
];

function getSupabaseEnv() {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Missing Supabase credentials");
  }
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
  if (!res.ok) {
    throw new Error(`Supabase ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export function normalizeQboText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function amountClose(amount: number, expected: number): boolean {
  return Math.abs(Math.abs(amount) - expected) <= 1.5;
}

function matchesExactName(description: string, rule: BuiltinRule): boolean {
  const normalized = ` ${normalizeQboText(description)} `;
  return rule.exactNames.some((name) => normalized.includes(` ${normalizeQboText(name)} `));
}

export async function loadLearnedQboRules(): Promise<LearnedQboRule[]> {
  const rows = await sbFetch<LearnedQboRule[]>(
    "/rest/v1/abra_qbo_learning_rules?select=*&active=eq.true&order=created_at.desc&limit=200",
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export async function upsertLearnedQboRule(input: {
  pattern: string;
  accountId: string;
  accountName: string;
  confidence?: number;
  createdBy?: string;
  notes?: string;
}): Promise<LearnedQboRule> {
  const normalized = normalizeQboText(input.pattern);
  const existing = await sbFetch<LearnedQboRule[]>(
    `/rest/v1/abra_qbo_learning_rules?select=*&normalized_pattern=eq.${encodeURIComponent(normalized)}&account_id=eq.${encodeURIComponent(input.accountId)}&limit=1`,
  ).catch(() => []);

  if (Array.isArray(existing) && existing[0]?.id) {
    const rows = await sbFetch<LearnedQboRule[]>(
      `/rest/v1/abra_qbo_learning_rules?id=eq.${existing[0].id}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          pattern: input.pattern,
          normalized_pattern: normalized,
          account_id: input.accountId,
          account_name: input.accountName,
          confidence: input.confidence ?? 0.98,
          created_by: input.createdBy || null,
          notes: input.notes || null,
          active: true,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    return rows[0];
  }

  const rows = await sbFetch<LearnedQboRule[]>("/rest/v1/abra_qbo_learning_rules", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      pattern: input.pattern,
      normalized_pattern: normalized,
      account_id: input.accountId,
      account_name: input.accountName,
      confidence: input.confidence ?? 0.98,
      created_by: input.createdBy || null,
      notes: input.notes || null,
      active: true,
    }]),
  });
  return rows[0];
}

export function resolveQboCategory(
  description: string,
  amount: number,
  learnedRules: LearnedQboRule[] = [],
): ResolvedQboCategory {
  const normalized = normalizeQboText(description);
  if (!normalized) {
    return {
      matched: false,
      confidence: 0,
      accountId: null,
      accountName: null,
      reasoning: "No transaction description was available.",
      pattern: null,
      source: "unmatched",
    };
  }

  for (const rule of learnedRules) {
    const learnedPattern = normalizeQboText(rule.pattern);
    if (learnedPattern && normalized.includes(learnedPattern)) {
      return {
        matched: true,
        confidence: Number(rule.confidence || 0.98) * 100,
        accountId: rule.account_id,
        accountName: rule.account_name,
        reasoning: `Matched learned correction rule "${rule.pattern}".`,
        pattern: rule.pattern,
        source: "learned_rule",
      };
    }
  }

  for (const rule of BUILTIN_QBO_RULES) {
    if (matchesExactName(description, rule)) {
      return {
        matched: true,
        confidence: 95,
        accountId: rule.accountId,
        accountName: rule.accountName,
        reasoning: `Exact vendor match for ${rule.pattern}.`,
        pattern: rule.pattern,
        source: "builtin_exact",
      };
    }
  }

  for (const rule of BUILTIN_QBO_RULES) {
    if (rule.recurringAmounts?.some((value) => amountClose(amount, value))) {
      return {
        matched: true,
        confidence: 85,
        accountId: rule.accountId,
        accountName: rule.accountName,
        reasoning: `Recurring amount match for ${rule.pattern} around $${Math.abs(amount).toFixed(2)}.`,
        pattern: rule.pattern,
        source: "builtin_recurring",
      };
    }
    if (rule.regex.test(description)) {
      return {
        matched: true,
        confidence: 80,
        accountId: rule.accountId,
        accountName: rule.accountName,
        reasoning: `Partial description match for ${rule.pattern}.`,
        pattern: rule.pattern,
        source: "builtin_partial",
      };
    }
  }

  return {
    matched: false,
    confidence: 0,
    accountId: null,
    accountName: null,
    reasoning: "No built-in or learned categorization rule matched this transaction.",
    pattern: null,
    source: "unmatched",
  };
}

export function listBuiltinQboRules(): BuiltinRule[] {
  return BUILTIN_QBO_RULES;
}
