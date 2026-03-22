import { getRevenueSnapshot, getMarginAnalysis } from "@/lib/ops/abra-financial-intel";
import {
  extractClaudeUsage,
  getMonthlySpend,
  logAICost,
} from "@/lib/ops/abra-cost-tracker";
import { createBrainEntry } from "@/lib/ops/abra-brain-writer";
import { detectDepartment } from "@/lib/ops/department-playbooks";

type ResearchResult = {
  findings: Array<{ topic: string; summary: string; relevance: string }>;
  baseline_requirements: string[];
  recommendations: string[];
};

type DepartmentPlan = {
  department: string;
  role: string;
  key_findings: string[];
  actions: string[];
};

type ExternalAction = {
  title: string;
  action_type: string;
  department: string;
  rationale: string;
  expected_impact: string;
  requires_approval: boolean;
};

export type CrossDepartmentStrategy = {
  depth: StrategyDepth;
  topic: string;
  objective: string;
  summary: string;
  departments: DepartmentPlan[];
  financial_controls: string[];
  kpi_guardrails: string[];
  spend_rules: string[];
  decision_gates: string[];
  risks: string[];
  external_actions: ExternalAction[];
  confidence: number;
  source_summary: Array<{
    department: string;
    findings: number;
    recommendations: number;
  }>;
};

type StrategyParams = {
  objective: string;
  topic?: string | null;
  depth?: StrategyDepth | null;
  host: string;
  cookieHeader?: string;
  actorEmail?: string | null;
};

type StrategyProfile = {
  key: string;
  label: string;
  departments: string[];
};

const DEFAULT_CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
export type StrategyDepth = "quick" | "deep";

type StrategyRuntimeBudget = {
  researchTimeoutMs: number;
  synthTimeoutMs: number;
  maxTokens: number;
  founderContextLimit: number;
};

const STRATEGY_BUDGETS: Record<StrategyDepth, StrategyRuntimeBudget> = {
  quick: {
    researchTimeoutMs: 12000,
    synthTimeoutMs: 20000,
    maxTokens: 1400,
    founderContextLimit: 8,
  },
  deep: {
    researchTimeoutMs: 28000,
    synthTimeoutMs: 90000,
    maxTokens: 2800,
    founderContextLimit: 20,
  },
};

const PROFILE_AMAZON_ADS: StrategyProfile = {
  key: "amazon_ad_strategy",
  label: "Amazon Ad Strategy",
  departments: [
    "research_lab",
    "amazon",
    "marketing",
    "ecommerce",
    "finance",
    "operations",
    "supply_chain",
    "data_analytics",
    "executive",
  ],
};

const PROFILE_GENERAL_GROWTH: StrategyProfile = {
  key: "growth_strategy",
  label: "Growth Strategy",
  departments: [
    "research_lab",
    "sales_and_growth",
    "marketing",
    "ecommerce",
    "finance",
    "operations",
    "supply_chain",
    "data_analytics",
    "executive",
  ],
};

function chooseProfile(objective: string, topic?: string | null): StrategyProfile {
  const combined = `${objective} ${topic || ""}`.toLowerCase();
  if (
    /\bamazon\b/.test(combined) &&
    /\b(ad|ads|advertis|ppc|sponsored|campaign)\b/.test(combined)
  ) {
    return PROFILE_AMAZON_ADS;
  }
  if (/\bamazon\b/.test(combined)) {
    return PROFILE_AMAZON_ADS;
  }
  return PROFILE_GENERAL_GROWTH;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return null;
  return { baseUrl, serviceKey };
}

async function sbFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const env = getSupabaseEnv();
  if (!env) throw new Error("Supabase not configured");

  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.serviceKey);
  headers.set("Authorization", `Bearer ${env.serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${env.baseUrl}${path}`, {
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
      `Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${
        ((typeof json === "string" ? json : JSON.stringify(json)) || "").slice(0, 500)
      }`,
    );
  }
  return json;
}

async function fetchFounderPolicyContext(limit = 8): Promise<string[]> {
  const rows = (await sbFetch(
    `/rest/v1/open_brain_entries?select=title,summary_text,raw_text,created_at,department,category&category=in.(founder,financial)&entry_type=eq.teaching&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 30))}`,
  )) as Array<{
    title?: string | null;
    summary_text?: string | null;
    raw_text?: string | null;
    created_at?: string | null;
    department?: string | null;
    category?: string | null;
  }>;

  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const summary = String(row.summary_text || row.raw_text || "").slice(0, 280);
    return `[${row.department || "executive"}|${row.category || "unknown"}] ${row.title || "(untitled)"}: ${summary}`;
  });
}

async function callDepartmentResearch(
  params: {
    host: string;
    cookieHeader?: string;
    objective: string;
    department: string;
    timeoutMs: number;
  },
): Promise<ResearchResult> {
  try {
    const headers = new Headers({
      "Content-Type": "application/json",
    });
    if (params.cookieHeader) headers.set("Cookie", params.cookieHeader);
    const cronSecret = (process.env.CRON_SECRET || "").trim();
    if (cronSecret) headers.set("Authorization", `Bearer ${cronSecret}`);

    const res = await fetch(`${params.host}/api/ops/abra/research`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `${params.objective}`,
        department: params.department,
        context:
          "Cross-department strategy orchestration: focus on practical execution, dependencies, KPIs, and strict spend controls.",
      }),
      signal: AbortSignal.timeout(params.timeoutMs),
    });

    if (!res.ok) {
      return { findings: [], baseline_requirements: [], recommendations: [] };
    }

    const data = (await res.json()) as Partial<ResearchResult>;
    return {
      findings: Array.isArray(data.findings) ? data.findings : [],
      baseline_requirements: Array.isArray(data.baseline_requirements)
        ? data.baseline_requirements
        : [],
      recommendations: Array.isArray(data.recommendations)
        ? data.recommendations
        : [],
    };
  } catch {
    return { findings: [], baseline_requirements: [], recommendations: [] };
  }
}

function extractTextContent(payload: Record<string, unknown>): string {
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

function normalizeExternalActions(actions: ExternalAction[]): ExternalAction[] {
  return actions.slice(0, 12).map((action) => ({
    title: String(action.title || "").trim() || "Untitled action",
    action_type: String(action.action_type || "").trim() || "external_action",
    department: String(action.department || "").trim() || "executive",
    rationale: String(action.rationale || "").trim() || "No rationale provided.",
    expected_impact:
      String(action.expected_impact || "").trim() || "Impact not specified.",
    requires_approval: true,
  }));
}

function fallbackStrategy(params: {
  depth: StrategyDepth;
  objective: string;
  profile: StrategyProfile;
  sourceSummary: Array<{ department: string; findings: number; recommendations: number }>;
}): CrossDepartmentStrategy {
  const departments: DepartmentPlan[] = params.profile.departments.map((department) => ({
    department,
    role: "Contribute strategy assumptions and execution constraints.",
    key_findings: ["Research synthesis unavailable; use latest departmental playbook baselines."],
    actions: ["Draft a department-specific plan and route to executive approval."],
  }));

  return {
    depth: params.depth,
    topic: params.profile.key,
    objective: params.objective,
    summary:
      "Draft strategy generated with fallback synthesis. Cross-department review required before execution.",
    departments,
    financial_controls: [
      "No campaign launch without explicit budget envelope and stop-loss thresholds.",
      "Any external spend change requires explicit founder approval.",
      "Pause spend on KPI breach against guardrails for two consecutive checkpoints.",
    ],
    kpi_guardrails: [
      "Track contribution margin, cash runway, and channel ROI before scaling.",
      "Require weekly KPI review for ad efficiency and inventory coverage.",
    ],
    spend_rules: [
      "Preserve growth-stage flexibility while enforcing strict downside controls.",
      "Prioritize cash-generating activities with measurable return windows.",
    ],
    decision_gates: [
      "Research complete",
      "Finance impact validated",
      "Operational readiness confirmed",
      "Founder approval recorded",
    ],
    risks: [
      "Incomplete market baseline data",
      "Inventory timing mismatch versus campaign velocity",
    ],
    external_actions: normalizeExternalActions([
      {
        title: "Launch external campaign",
        action_type: "external_campaign_launch",
        department: "marketing",
        rationale: "Requires explicit approval by policy.",
        expected_impact: "Potential demand lift with managed downside.",
        requires_approval: true,
      },
    ]),
    confidence: 0.45,
    source_summary: params.sourceSummary,
  };
}

async function synthesizeStrategy(input: {
  depth: StrategyDepth;
  budget: StrategyRuntimeBudget;
  objective: string;
  profile: StrategyProfile;
  topicHint: string | null;
  researchByDepartment: Record<string, ResearchResult>;
  founderContext: string[];
  revenueMonth: Awaited<ReturnType<typeof getRevenueSnapshot>>;
  revenueWeek: Awaited<ReturnType<typeof getRevenueSnapshot>>;
  margin: Awaited<ReturnType<typeof getMarginAnalysis>>;
  spend: Awaited<ReturnType<typeof getMonthlySpend>>;
}): Promise<CrossDepartmentStrategy> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const researchContext = input.profile.departments
    .map((department) => {
      const result = input.researchByDepartment[department];
      const findings = result?.findings || [];
      const recommendations = result?.recommendations || [];
      return [
        `Department: ${department}`,
        findings.length > 0
          ? `Findings: ${findings
              .slice(0, 6)
              .map((f) => `${f.topic}: ${f.summary}`)
              .join(" | ")}`
          : "Findings: none",
        recommendations.length > 0
          ? `Recommendations: ${recommendations.slice(0, 6).join(" | ")}`
          : "Recommendations: none",
      ].join("\n");
    })
    .join("\n\n");

  const founderContextText =
    input.founderContext.length > 0
      ? input.founderContext.join("\n")
      : "No founder policy notes found.";

  let systemPrompt = [
    "You are Abra Strategy Orchestrator for USA Gummies.",
    "Produce a cross-department strategy with strict financial controls and permission-first external actions.",
    "External actions MUST require approval.",
    "No optimistic assumptions without risk controls.",
    "Return valid JSON only with this shape:",
    "{",
    '  "topic": "string",',
    '  "objective": "string",',
    '  "summary": "string",',
    '  "departments": [{"department":"string","role":"string","key_findings":["string"],"actions":["string"]}],',
    '  "financial_controls": ["string"],',
    '  "kpi_guardrails": ["string"],',
    '  "spend_rules": ["string"],',
    '  "decision_gates": ["string"],',
    '  "risks": ["string"],',
    '  "external_actions": [{"title":"string","action_type":"string","department":"string","rationale":"string","expected_impact":"string","requires_approval":true}],',
    '  "confidence": 0.0',
    "}",
  ].join("\n");

  let userPrompt = [
    `Objective: ${input.objective}`,
    `Topic profile: ${input.profile.key} (${input.profile.label})`,
    `Detected department hint: ${input.topicHint || "none"}`,
    `Departments in scope: ${input.profile.departments.join(", ")}`,
    "",
    "Founder policy context:",
    founderContextText,
    "",
    "Financial context:",
    `Monthly revenue: ${JSON.stringify(input.revenueMonth)}`,
    `Weekly revenue: ${JSON.stringify(input.revenueWeek)}`,
    `Margin snapshot: ${JSON.stringify(input.margin)}`,
    `AI spend snapshot: ${JSON.stringify(input.spend)}`,
    "",
    "Department research:",
    researchContext,
    "",
    "Hard constraints:",
    "- Growth mode: reinvestment acceptable, but enforce spend controls and kill-switches.",
    "- Require cross-department dependencies and clear gating.",
    "- Every external action requires approval before execution.",
  ].join("\n");

  // --- Versioned prompt loading (auto-research) ---
  try {
    const { getActivePrompt } = await import("@/lib/ops/auto-research-runner");
    const versioned = await getActivePrompt("strategy_orchestrator");
    if (versioned?.prompt_text) {
      const replacePlaceholders = (template: string) =>
        template
          .replace(/\{\{?OBJECTIVE\}?\}/g, input.objective)
          .replace(/\{\{?PROFILE_KEY\}?\}/g, input.profile.key)
          .replace(/\{\{?PROFILE_LABEL\}?\}/g, input.profile.label)
          .replace(/\{\{?TOPIC_HINT\}?\}/g, input.topicHint || "none")
          .replace(/\{\{?DEPARTMENTS_IN_SCOPE\}?\}/g, input.profile.departments.join(", "))
          .replace(/\{\{?FOUNDER_CONTEXT\}?\}/g, founderContextText)
          .replace(/\{\{?REVENUE_MONTH\}?\}/g, JSON.stringify(input.revenueMonth))
          .replace(/\{\{?REVENUE_WEEK\}?\}/g, JSON.stringify(input.revenueWeek))
          .replace(/\{\{?MARGIN_SNAPSHOT\}?\}/g, JSON.stringify(input.margin))
          .replace(/\{\{?SPEND_SNAPSHOT\}?\}/g, JSON.stringify(input.spend))
          .replace(/\{\{?RESEARCH_CONTEXT\}?\}/g, researchContext);

      // The versioned prompt may contain system and user sections
      // separated by "---USER---"
      const parts = versioned.prompt_text.split(/---USER---/i);
      if (parts.length >= 2) {
        systemPrompt = replacePlaceholders(parts[0].trim());
        userPrompt = replacePlaceholders(parts[1].trim());
      } else {
        // Single block — treat as system prompt replacement
        systemPrompt = replacePlaceholders(versioned.prompt_text);
      }
    }
  } catch {
    // Fallback to hardcoded prompts above
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_CLAUDE_MODEL,
      max_tokens: input.budget.maxTokens,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(input.budget.synthTimeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Claude synthesis failed (${res.status}): ${text.slice(0, 250)}`);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Failed to parse Claude strategy response");
  }

  const usage = extractClaudeUsage(payload);
  if (usage) {
    void logAICost({
      model: DEFAULT_CLAUDE_MODEL,
      provider: "anthropic",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      endpoint: "strategy/orchestrator",
      department: input.topicHint || undefined,
    });
  }

  const modelText = extractTextContent(payload);
  const jsonText = modelText.match(/\{[\s\S]*\}/)?.[0] || modelText;
  const parsed = JSON.parse(jsonText) as Partial<CrossDepartmentStrategy>;

  const departments = Array.isArray(parsed.departments)
    ? parsed.departments
        .map((d) => {
          if (!d || typeof d !== "object") return null;
          const row = d as Partial<DepartmentPlan>;
          return {
            department: String(row.department || "").trim() || "executive",
            role: String(row.role || "").trim() || "Support execution",
            key_findings: Array.isArray(row.key_findings)
              ? row.key_findings.map((v) => String(v))
              : [],
            actions: Array.isArray(row.actions)
              ? row.actions.map((v) => String(v))
              : [],
          } satisfies DepartmentPlan;
        })
        .filter((v): v is DepartmentPlan => !!v)
    : [];

  return {
    depth: input.depth,
    topic: String(parsed.topic || input.profile.key),
    objective: String(parsed.objective || input.objective),
    summary:
      String(parsed.summary || "").trim() ||
      "Cross-department strategy synthesized from research and financial constraints.",
    departments:
      departments.length > 0
        ? departments
        : input.profile.departments.map((department) => ({
            department,
            role: "Contribute execution plan and constraints.",
            key_findings: [],
            actions: [],
          })),
    financial_controls: Array.isArray(parsed.financial_controls)
      ? parsed.financial_controls.map((v) => String(v))
      : [],
    kpi_guardrails: Array.isArray(parsed.kpi_guardrails)
      ? parsed.kpi_guardrails.map((v) => String(v))
      : [],
    spend_rules: Array.isArray(parsed.spend_rules)
      ? parsed.spend_rules.map((v) => String(v))
      : [],
    decision_gates: Array.isArray(parsed.decision_gates)
      ? parsed.decision_gates.map((v) => String(v))
      : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map((v) => String(v)) : [],
    external_actions: normalizeExternalActions(
      Array.isArray(parsed.external_actions)
        ? (parsed.external_actions as ExternalAction[])
        : [],
    ),
    confidence: Math.max(0, Math.min(1, toNumber(parsed.confidence, 0.65))),
    source_summary: input.profile.departments.map((department) => ({
      department,
      findings: input.researchByDepartment[department]?.findings?.length || 0,
      recommendations:
        input.researchByDepartment[department]?.recommendations?.length || 0,
    })),
  };
}

async function storeStrategyInBrain(strategy: CrossDepartmentStrategy): Promise<void> {
  const sourceRef = `strategy:${strategy.topic}:${Date.now()}`;
  const rawText = JSON.stringify(strategy, null, 2);
  await createBrainEntry({
    source_type: "agent",
    source_ref: sourceRef,
    entry_type: "summary",
    title: `Strategy Plan: ${strategy.objective.slice(0, 120)}`,
    raw_text: rawText,
    summary_text: strategy.summary.slice(0, 500),
    category: "research",
    department: detectDepartment(strategy.objective) || "executive",
    confidence: strategy.confidence >= 0.75 ? "high" : "medium",
    priority: "important",
    processed: true,
  });
}

export async function buildCrossDepartmentStrategy(
  params: StrategyParams,
): Promise<CrossDepartmentStrategy> {
  const objective = params.objective.trim();
  if (!objective) {
    throw new Error("objective is required");
  }

  const depth: StrategyDepth = params.depth === "quick" ? "quick" : "deep";
  const budget = STRATEGY_BUDGETS[depth];
  const topicHint = params.topic || detectDepartment(objective);
  const profile = chooseProfile(objective, topicHint);

  const researchPairs = await Promise.all(
    profile.departments.map(async (department) => {
      const result = await callDepartmentResearch({
        host: params.host.replace(/\/+$/, ""),
        cookieHeader: params.cookieHeader,
        objective,
        department,
        timeoutMs: budget.researchTimeoutMs,
      });
      return [department, result] as const;
    }),
  );
  const researchByDepartment = Object.fromEntries(researchPairs);
  const sourceSummary = profile.departments.map((department) => ({
    department,
    findings: researchByDepartment[department]?.findings?.length || 0,
    recommendations: researchByDepartment[department]?.recommendations?.length || 0,
  }));

  const [founderContext, revenueMonth, revenueWeek, margin, spend] =
    await Promise.all([
      fetchFounderPolicyContext(budget.founderContextLimit).catch(() => []),
      getRevenueSnapshot("month").catch(() => ({
        period: "unknown",
        shopify_revenue: 0,
        amazon_revenue: 0,
        total_revenue: 0,
        order_count: 0,
        avg_order_value: 0,
        vs_prior_period_pct: 0,
      })),
      getRevenueSnapshot("week").catch(() => ({
        period: "unknown",
        shopify_revenue: 0,
        amazon_revenue: 0,
        total_revenue: 0,
        order_count: 0,
        avg_order_value: 0,
        vs_prior_period_pct: 0,
      })),
      getMarginAnalysis().catch(() => ({
        estimated_cogs_per_unit: 0,
        estimated_gross_margin_pct: 0,
        revenue: 0,
        estimated_cogs: 0,
        estimated_gross_profit: 0,
      })),
      getMonthlySpend().catch(() => ({
        total: 0,
        budget: 1000,
        remaining: 1000,
        pctUsed: 0,
        callCount: 0,
        byProvider: {},
        byEndpoint: {},
      })),
    ]);

  let strategy: CrossDepartmentStrategy;
  try {
    strategy = await synthesizeStrategy({
      depth,
      budget,
      objective,
      profile,
      topicHint,
      researchByDepartment,
      founderContext,
      revenueMonth,
      revenueWeek,
      margin,
      spend,
    });
  } catch {
    strategy = fallbackStrategy({ depth, objective, profile, sourceSummary });
  }

  await storeStrategyInBrain(strategy).catch(() => {});
  return strategy;
}
