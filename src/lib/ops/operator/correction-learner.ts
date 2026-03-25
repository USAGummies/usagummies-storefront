import { getQBOAccounts } from "@/lib/ops/qbo-client";
import { createOperatorTasks, executeOperatorTasks } from "@/lib/ops/operator/task-executor";
import { type SlackMessageContext } from "@/lib/ops/abra-slack-responder";
import { upsertLearnedQboRule } from "@/lib/ops/operator/qbo-resolution";

type QboAccount = {
  Id?: string;
  Name?: string;
  AcctNum?: string;
};

type LearnedCorrection = {
  pattern: string;
  accountId: string;
  accountName: string;
};

function getInternalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    "https://www.usagummies.com"
  );
}

function getInternalHeaders(): HeadersInit {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPatternFromHistory(ctx: SlackMessageContext): string {
  const history = [...(ctx.history || [])].reverse();
  for (const item of history) {
    const text = String(item.content || "");
    const amountMatch = text.match(/\$[\d,.]+\s+([A-Za-z0-9 .&-]{3,40})/);
    if (amountMatch?.[1]) return amountMatch[1].trim();
    const vendorMatch = text.match(/\b(anthropic|pirate ship|shopify|amazon|google|youtube|facebook|meta|geico|t-mobile|tmobile|intuit|quickbooks|office depot|uline|slack|openai|stripe|arco|shell|chevron|albanese|belmark|powers|dutch valley)\b/i);
    if (vendorMatch?.[1]) return vendorMatch[1];
  }
  return "";
}

function categoryAliasToAccountHint(categoryHint: string): string {
  const hint = normalizeText(categoryHint);
  if (hint.includes("software")) return "126";
  if (hint.includes("shipping")) return "127";
  if (hint.includes("merchant")) return "122";
  if (hint.includes("advertising")) return "16";
  if (hint.includes("insurance")) return "42";
  if (hint.includes("utilit")) return "78";
  if (hint.includes("suppl")) return "83";
  if (hint.includes("fuel")) return "146";
  if (hint.includes("albanese")) return "176";
  if (hint.includes("belmark")) return "177";
  if (hint.includes("powers")) return "178";
  if (hint.includes("packag")) return "179";
  if (hint.includes("dutch")) return "175";
  if (hint.includes("investor") || hint.includes("loan")) return "167";
  if (hint.includes("personal")) return "2";
  return categoryHint.trim();
}

function extractKnownVendor(value: string): string {
  const match = value.match(/\b(anthropic|pirate ship|shopify|amazon|google|youtube|facebook|meta|geico|t-mobile|tmobile|intuit|quickbooks|office depot|staples|uline|slack|openai|stripe|arco|shell|chevron|albanese|belmark|powers|dutch valley|ninja|ninjaprinthaus|rene|gonzalez|stutman|ben)\b/i);
  return match?.[1]?.trim() || "";
}

function sanitizePattern(rawPattern: string, categoryHint = ""): string {
  const knownFromPattern = extractKnownVendor(rawPattern);
  if (knownFromPattern) return knownFromPattern;

  const knownFromCategory = extractKnownVendor(categoryHint);
  if (knownFromCategory) return knownFromCategory;

  return rawPattern
    .replace(/\$[\d,.]+/g, " ")
    .replace(/\b(anything from|categorize|all|the|this|that|these|those)\b/gi, " ")
    .replace(/\b(charges?|transactions?|purchases?|payments?|deposits?|expense|expenses)\b/gi, " ")
    .replace(/\bfor\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveAccount(categoryHint: string): Promise<LearnedCorrection | null> {
  const accounts = ((await getQBOAccounts())?.QueryResponse?.Account as QboAccount[]) || [];
  const hint = categoryAliasToAccountHint(categoryHint);
  const normalizedHint = normalizeText(hint);
  const exact =
    accounts.find((account) => String(account.Id || "") === hint) ||
    accounts.find((account) => String(account.AcctNum || "") === hint) ||
    accounts.find((account) => normalizeText(String(account.Name || "")) === normalizedHint);
  if (exact?.Id) {
    return {
      pattern: "",
      accountId: String(exact.Id),
      accountName: String(exact.Name || exact.AcctNum || hint),
    };
  }

  const partial = accounts.find((account) => normalizeText(String(account.Name || "")).includes(normalizedHint));
  if (!partial?.Id) {
    if (/^\d+$/.test(hint)) {
      return {
        pattern: "",
        accountId: hint,
        accountName: categoryHint.trim() || hint,
      };
    }
    return null;
  }
  return {
    pattern: "",
    accountId: String(partial.Id),
    accountName: String(partial.Name || partial.AcctNum || hint),
  };
}

function parseCorrection(text: string, ctx: SlackMessageContext): { pattern: string; categoryHint: string } | null {
  const cleaned = text.trim();
  let match = cleaned.match(/^categorize\s+(.+?)\s+to\s+(.+)$/i);
  if (match) {
    const categoryHint = match[2].trim();
    return { pattern: sanitizePattern(match[1].trim(), categoryHint), categoryHint };
  }

  match = cleaned.match(/^(?:anything from\s+)?(.+?)\s+(?:is|should be)\s+(.+)$/i);
  if (match) {
    const categoryHint = match[2].trim();
    return { pattern: sanitizePattern(match[1].trim(), categoryHint), categoryHint };
  }

  match = cleaned.match(/^(?:that should be|it should be)\s+(.+)$/i);
  if (match) {
    const pattern = extractPatternFromHistory(ctx);
    return pattern ? { pattern, categoryHint: match[1].trim() } : null;
  }

  match = cleaned.match(/^(?:wrong|that'?s wrong|that is wrong)\s*[—,:-]?\s*(?:it'?s\s+)?(.+)$/i);
  if (match) {
    const pattern = extractPatternFromHistory(ctx);
    return pattern ? { pattern, categoryHint: match[1].trim() } : null;
  }

  if (/\bpersonal expense\b|\bthat'?s personal\b/i.test(cleaned)) {
    const pattern = extractPatternFromHistory(ctx);
    return pattern ? { pattern, categoryHint: "personal expense" } : null;
  }

  return null;
}

async function fetchPurchases(): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${getInternalBaseUrl()}/api/ops/qbo/query?type=purchases&limit=200`, {
    headers: {
      ...getInternalHeaders(),
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { purchases?: Array<Record<string, unknown>> };
  return Array.isArray(data.purchases) ? data.purchases : [];
}

function isUncategorizedPurchase(purchase: Record<string, unknown>): boolean {
  const firstLine = Array.isArray(purchase.Lines) ? ((purchase.Lines[0] || {}) as Record<string, unknown>) : {};
  const account = normalizeText(String(firstLine.Account || ""));
  return !account || account.includes("uncategorized");
}

export async function maybeLearnFinancialCorrection(ctx: SlackMessageContext): Promise<string | null> {
  const parsed = parseCorrection(ctx.text, ctx);
  if (!parsed) return null;

  const account = await resolveAccount(parsed.categoryHint);
  if (!account?.accountId) return null;

  let ruleStorageFailed = false;
  let rule = {
    account_id: account.accountId,
    account_name: account.accountName,
  };
  try {
    rule = await upsertLearnedQboRule({
      pattern: parsed.pattern,
      accountId: account.accountId,
      accountName: account.accountName,
      createdBy: ctx.displayName || ctx.user,
      notes: `Learned from Slack correction: ${ctx.text}`,
    });
  } catch (error) {
    ruleStorageFailed = true;
    console.error("[correction-learner] failed to persist learned rule", error);
  }

  const purchases = await fetchPurchases();
  const similar = purchases.filter((purchase) => {
    if (!isUncategorizedPurchase(purchase)) return false;
    const joined = [
      purchase.Vendor,
      purchase.Note,
      ...(Array.isArray(purchase.Lines)
        ? purchase.Lines.flatMap((line) => [line && typeof line === "object" ? (line as Record<string, unknown>).Description : ""])
        : []),
    ].map((value) => String(value || "")).join(" ");
    return normalizeText(joined).includes(normalizeText(parsed.pattern));
  });

  const tasks = similar.map((purchase) => ({
    task_type: "qbo_categorize",
    title: `Categorize ${String(purchase.Vendor || purchase.Note || purchase.Id || "transaction")} to ${rule.account_name}`,
    description: `Retroactive categorization from Rene correction: ${parsed.pattern} -> ${rule.account_name}`,
    priority: "high" as const,
    source: "slack_correction",
    assigned_to: "abra",
    execution_params: {
      natural_key: `qbo_categorize|${String(purchase.Id || "")}|${rule.account_id}`,
      transactionId: String(purchase.Id || ""),
      entityType: "Purchase",
      description: String(purchase.Vendor || purchase.Note || purchase.Id || "transaction"),
      amount: Number(purchase.Amount || 0),
      date: String(purchase.Date || ""),
      currentAccountId: "",
      currentAccountName: "Uncategorized",
      suggestedAccountId: rule.account_id,
      suggestedAccountName: rule.account_name,
      confidence: 99,
      reasoning: `Learned from Rene correction: ${parsed.pattern} -> ${rule.account_name}`,
      matchedPattern: parsed.pattern,
    },
    tags: ["qbo", "finance", "learned-rule"],
  }));

  const created = await createOperatorTasks(tasks);
  const execution = created > 0 ? await executeOperatorTasks(Math.max(created, 1)) : { completed: 0 };

  const suffix = ruleStorageFailed ? " I applied the fix, but the learning rule could not be saved yet." : "";
  return `Got it — ${parsed.pattern} → ${rule.account_name}. Found ${similar.length} similar transaction${similar.length === 1 ? "" : "s"} and fixed ${Number(execution.completed || 0)}.${suffix}`;
}
