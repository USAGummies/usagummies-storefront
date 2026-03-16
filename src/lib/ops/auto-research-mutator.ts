/**
 * Auto Research: Prompt Mutator (Multi-Target)
 *
 * After an eval run, generates ONE candidate prompt mutation:
 *   1. Meta-prompt to Sonnet (temp 0.7): improve the lowest-scoring criterion
 *   2. Validate: safety-critical lines still present via per-target regex
 *   3. Insert as new candidate version
 *   4. Max 3 candidates at any time (retire oldest if exceeded)
 *
 * SAFETY: Validates that critical rules survive mutation per target type.
 * Rejects any mutation that removes safety guardrails.
 */

import {
  logAICost,
  extractClaudeUsage,
  getPreferredClaudeModel,
} from "@/lib/ops/abra-cost-tracker";
import { notify } from "@/lib/ops/notify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MutationResult = {
  success: boolean;
  new_version?: number;
  mutation_description?: string;
  error?: string;
  safety_violation?: boolean;
};

type PromptVersionRow = {
  version: number;
  prompt_text: string;
  status: string;
  overall_score: number | null;
};

// ---------------------------------------------------------------------------
// Per-target safety validation + mutation context
// ---------------------------------------------------------------------------

type TargetMutationConfig = {
  /** Patterns that MUST survive any mutation */
  safetyPatterns: RegExp[];
  /** Description of the agent's purpose (used in meta-prompt) */
  agentDescription: string;
  /** Known placeholders that must be preserved */
  placeholders: string[];
  /** Safety rules to enumerate in the meta-prompt */
  safetyRuleDescriptions: string[];
};

const TARGET_MUTATION_CONFIGS: Record<string, TargetMutationConfig> = {
  email_drafter: {
    safetyPatterns: [
      /NEVER commit/i,
      /note.?for.?ben/i,
      /sign-off|signature.*added automatically/i,
      /JSON object/i,
      /subject.*body.*confidence.*note_for_ben/i,
    ],
    agentDescription: "generates email draft replies for inbound business emails",
    placeholders: [
      "SENDER_NAME", "SENDER_EMAIL", "SUBJECT", "CATEGORY",
      "VIP_BLOCK", "EMAIL_BODY", "BRAIN_CONTEXT", "TONE_RULE",
    ],
    safetyRuleDescriptions: [
      '"NEVER commit to specific pricing, delivery dates, contract terms, or payment amounts"',
      'The "[NOTE FOR BEN]" instruction',
      'The "Do NOT include a sign-off or signature" instruction',
      "The JSON output format specification (subject, body, confidence, note_for_ben)",
    ],
  },

  financial_processor: {
    safetyPatterns: [
      /JSON/i,
      /amount/i,
      /vendor|merchant/i,
      /date/i,
      /category/i,
    ],
    agentDescription: "extracts financial transactions from documents and emails",
    placeholders: ["DOCUMENT"],
    safetyRuleDescriptions: [
      "JSON array output format with transaction objects",
      "Required fields: amount, vendor, date, category, type, description",
      "Numerical accuracy — amounts must be extracted exactly as stated",
    ],
  },

  slack_processor: {
    safetyPatterns: [
      /context|brain/i,
      /action|directive/i,
      /concise|brief/i,
    ],
    agentDescription: "generates Slack responses to team questions using brain context",
    placeholders: ["USER_QUESTION", "BRAIN_CONTEXT", "CHANNEL", "USER_NAME"],
    safetyRuleDescriptions: [
      "Must reference brain context when available",
      "Must be execution-oriented with clear next steps",
      "Must not hallucinate data not present in context",
    ],
  },

  weekly_digest: {
    safetyPatterns: [
      /summary|overview/i,
      /priorit/i,
      /metric|data|number/i,
    ],
    agentDescription: "generates weekly executive performance digests with prioritized action items",
    placeholders: ["PERFORMANCE_DATA", "DATE_RANGE", "COMPANY_NAME"],
    safetyRuleDescriptions: [
      "Must include executive summary section",
      "Must include prioritized action items",
      "Must reference actual data/metrics from the input",
    ],
  },

  strategy_orchestrator: {
    safetyPatterns: [
      /JSON/i,
      /approv|gate/i,
      /risk/i,
      /budget|financ/i,
    ],
    agentDescription: "generates strategic planning documents with approval gates and financial controls",
    placeholders: ["OBJECTIVE", "CONTEXT", "CONSTRAINTS", "COMPANY_NAME"],
    safetyRuleDescriptions: [
      "JSON output format with structured strategy document",
      "Must include approval gates for significant spending",
      "Must identify risks and mitigation strategies",
      "Must respect financial constraints",
    ],
  },

  blog_drafter: {
    safetyPatterns: [
      /USA Gummies|brand/i,
      /CTA|call.?to.?action/i,
      /MDX|markdown/i,
    ],
    agentDescription: "generates MDX blog posts for the USA Gummies website",
    placeholders: ["TOPIC", "KEYWORDS", "TARGET_AUDIENCE", "BRAND_VOICE", "WORD_COUNT"],
    safetyRuleDescriptions: [
      "Must maintain on-brand voice (friendly, knowledgeable, American-made pride)",
      "Must include a call-to-action",
      "Must output valid MDX format",
      "Must not make unverified health claims",
    ],
  },

  social_responder: {
    safetyPatterns: [
      /brand|USA Gummies/i,
      /friendly|positive/i,
      /politic/i,
    ],
    agentDescription: "generates replies to social media mentions of USA Gummies",
    placeholders: ["MENTION_TEXT", "PLATFORM", "AUTHOR_NAME", "BRAND_NAME", "BRAND_VOICE"],
    safetyRuleDescriptions: [
      "Must maintain friendly, on-brand tone",
      "Must NEVER engage in political topics",
      "Must NEVER attack competitors",
      "Must keep replies brief and appropriate for social media",
    ],
  },

  social_post_generator: {
    safetyPatterns: [
      /brand|USA Gummies/i,
      /hashtag/i,
      /CTA|call.?to.?action|shop/i,
    ],
    agentDescription: "generates social media posts for USA Gummies marketing",
    placeholders: ["TOPIC", "PLATFORM", "BRAND_NAME", "BRAND_VOICE", "PRODUCT_INFO", "CTA"],
    safetyRuleDescriptions: [
      "Must include relevant hashtags",
      "Must include a call-to-action",
      "Must maintain on-brand voice",
      "Must NEVER make unverified claims",
      "Must NEVER engage in political topics",
    ],
  },

  morning_brief: {
    safetyPatterns: [/metric|number/i, /action|priority/i, /concise|brief/i],
    agentDescription: "generates executive morning briefing narratives from daily metrics",
    placeholders: ["METRICS_DATA", "DATE"],
    safetyRuleDescriptions: [
      "Must reference actual metrics/numbers",
      "Must include actionable priorities",
      "Must be concise",
    ],
  },

  anomaly_detector: {
    safetyPatterns: [/JSON/i, /root.?cause|hypothesis/i, /confidence/i],
    agentDescription: "generates root cause analyses for detected metric anomalies",
    placeholders: ["ANOMALY_DATA", "METRIC_NAME"],
    safetyRuleDescriptions: [
      "Must output valid JSON",
      "Must include plausible root cause",
      "Must state confidence level",
    ],
  },

  pipeline_intel: {
    safetyPatterns: [/deal|prospect/i, /follow.?up|next.?step/i, /never.*fabricat|never.*halluc/i],
    agentDescription: "generates personalized B2B deal insights and follow-up strategies",
    placeholders: ["DEAL_DATA", "CONTACT_HISTORY"],
    safetyRuleDescriptions: [
      "Must reference specific deal/prospect data",
      "Must include actionable next steps",
      "Must not fabricate prospect details",
    ],
  },

  operational_signals: {
    safetyPatterns: [/JSON/i, /severity|critical|high/i, /signal|extract/i],
    agentDescription: "extracts and classifies operational signals from emails",
    placeholders: ["EMAIL_TEXT", "SENDER_CONTEXT"],
    safetyRuleDescriptions: [
      "Must output valid JSON",
      "Must classify severity correctly",
      "Must identify all signals present",
    ],
  },

  b2b_outreach: {
    safetyPatterns: [/personal|specific/i, /value|benefit/i, /CTA|call.?to.?action/i],
    agentDescription: "generates personalized B2B outreach emails",
    placeholders: ["PROSPECT_DATA", "COMPANY_INFO"],
    safetyRuleDescriptions: [
      "Must be personalized to the prospect",
      "Must include clear value proposition",
      "Must include a call to action",
    ],
  },

  b2b_reply_classifier: {
    safetyPatterns: [/JSON/i, /intent|classify/i, /sentiment/i],
    agentDescription: "classifies B2B email reply intent and sentiment",
    placeholders: ["REPLY_TEXT", "ORIGINAL_EMAIL"],
    safetyRuleDescriptions: [
      "Must output valid JSON",
      "Must classify intent correctly",
      "Must assess sentiment",
    ],
  },

  b2b_forecaster: {
    safetyPatterns: [/data|actual/i, /confidence|range/i, /caveat|assumption/i],
    agentDescription: "generates revenue forecast narratives with confidence ranges",
    placeholders: ["REVENUE_DATA", "PIPELINE_DATA"],
    safetyRuleDescriptions: [
      "Must use actual data provided",
      "Must include confidence ranges",
      "Must state assumptions and caveats",
    ],
  },

  b2b_deal_tracker: {
    safetyPatterns: [/deal|stage/i, /action|next/i, /specific|context/i],
    agentDescription: "generates internal nudge messages for stuck deals",
    placeholders: ["DEAL_DATA", "STAGE_HISTORY"],
    safetyRuleDescriptions: [
      "Must reference deal stage and context",
      "Must suggest specific next action",
      "Must explain why attention is needed",
    ],
  },

  b2b_win_loss: {
    safetyPatterns: [/pattern|trend/i, /data|actual/i, /recommend|action/i],
    agentDescription: "analyzes win/loss patterns across B2B deals",
    placeholders: ["WON_DEALS", "LOST_DEALS"],
    safetyRuleDescriptions: [
      "Must identify real patterns from data",
      "Must reference actual deal data",
      "Must include actionable recommendations",
    ],
  },

  seo_keyword_analyzer: {
    safetyPatterns: [/JSON/i, /keyword|opportunity/i, /priority|score/i],
    agentDescription: "scores SEO keyword opportunities and suggests content angles",
    placeholders: ["KEYWORD_DATA", "COMPETITOR_DATA"],
    safetyRuleDescriptions: [
      "Must output valid JSON",
      "Must score keywords with reasoning",
      "Must prioritize opportunities",
    ],
  },

  seo_content_gap: {
    safetyPatterns: [/outline|section/i, /keyword|seo/i, /brief|content/i],
    agentDescription: "generates detailed SEO content briefs from gap analysis",
    placeholders: ["GAP_DATA", "EXISTING_CONTENT"],
    safetyRuleDescriptions: [
      "Must include section-by-section outline",
      "Must be SEO-focused with target keywords",
      "Must specify target word count",
    ],
  },

  dtc_post_purchase: {
    safetyPatterns: [/order|purchase/i, /brand|USA Gummies/i, /review|feedback/i],
    agentDescription: "generates personalized post-purchase follow-up emails",
    placeholders: ["ORDER_DATA", "CUSTOMER_DATA"],
    safetyRuleDescriptions: [
      "Must reference the specific order",
      "Must maintain brand voice",
      "Must include value-add content",
    ],
  },

  dtc_cart_recovery: {
    safetyPatterns: [/cart|item/i, /CTA|complete|purchase/i, /brand|USA Gummies/i],
    agentDescription: "generates abandoned cart recovery emails",
    placeholders: ["CART_DATA", "CUSTOMER_NAME"],
    safetyRuleDescriptions: [
      "Must reference specific cart items",
      "Must include clear CTA to complete purchase",
      "Must maintain brand voice",
    ],
  },

  supply_demand_forecast: {
    safetyPatterns: [/JSON/i, /forecast|demand/i, /confidence/i],
    agentDescription: "synthesizes demand signals into SKU-level forecasts",
    placeholders: ["VELOCITY_DATA", "INVENTORY_DATA"],
    safetyRuleDescriptions: [
      "Must output valid JSON",
      "Must provide SKU-level forecasts",
      "Must include confidence levels",
    ],
  },

  finops_reconciler: {
    safetyPatterns: [/JSON/i, /category|classif/i, /confidence|reason/i],
    agentDescription: "classifies financial transactions into accounting categories",
    placeholders: ["TRANSACTION_DATA"],
    safetyRuleDescriptions: [
      "Must output valid JSON",
      "Must classify into valid accounting categories",
      "Must include confidence and reasoning",
    ],
  },

  finops_cashflow: {
    safetyPatterns: [/cash|flow/i, /risk|factor/i, /dollar|amount|\$/i],
    agentDescription: "generates cash flow narrative analysis with risk assessment",
    placeholders: ["CASHFLOW_DATA"],
    safetyRuleDescriptions: [
      "Must reference specific cash flow data",
      "Must identify risk factors",
      "Must use specific dollar amounts",
    ],
  },

  finops_pnl: {
    safetyPatterns: [/revenue|expense/i, /variance|margin/i, /number|amount|\$/i],
    agentDescription: "generates P&L commentary highlighting variances and trends",
    placeholders: ["PNL_DATA", "PERIOD"],
    safetyRuleDescriptions: [
      "Must reference specific P&L line items",
      "Must highlight variances",
      "Must use specific numbers",
    ],
  },

  social_engagement: {
    safetyPatterns: [/brand|USA Gummies/i, /politic/i, /competitor/i],
    agentDescription: "generates contextual social media replies with brand voice",
    placeholders: ["MENTION_TEXT", "PLATFORM", "AUTHOR_CONTEXT"],
    safetyRuleDescriptions: [
      "Must maintain brand voice",
      "Must NEVER be political",
      "Must NEVER attack competitors",
    ],
  },

  social_analysis: {
    safetyPatterns: [/JSON/i, /sentiment/i, /trend|pattern/i],
    agentDescription: "analyzes social media mentions for sentiment and trends",
    placeholders: ["MENTIONS_DATA"],
    safetyRuleDescriptions: [
      "Must output valid JSON",
      "Must include sentiment breakdown",
      "Must identify trends",
    ],
  },

  b2b_reengagement: {
    safetyPatterns: [/past|previous/i, /value|angle/i, /CTA|call.?to.?action/i],
    agentDescription: "generates re-engagement emails for cold B2B prospects",
    placeholders: ["PROSPECT_DATA", "PAST_INTERACTION"],
    safetyRuleDescriptions: [
      "Must reference past interaction",
      "Must provide new value angle",
      "Must include a low-pressure CTA",
    ],
  },
};

// ---------------------------------------------------------------------------
// Safety validation
// ---------------------------------------------------------------------------

function validateSafetyRules(
  targetKey: string,
  promptText: string,
): { valid: boolean; missing: string[] } {
  const config = TARGET_MUTATION_CONFIGS[targetKey];
  if (!config) {
    // Unknown target — no safety rules to validate, allow mutation
    return { valid: true, missing: [] };
  }

  const missing: string[] = [];
  for (const pattern of config.safetyPatterns) {
    if (!pattern.test(promptText)) {
      missing.push(pattern.source);
    }
  }

  return { valid: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function getSupabaseEnv() {
  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error("Supabase not configured");
  return { baseUrl, serviceKey };
}

async function sbFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const { baseUrl, serviceKey } = getSupabaseEnv();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(30000),
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
        (typeof json === "string" ? json : JSON.stringify(json) || "").slice(
          0,
          500,
        )
      }`,
    );
  }

  return json;
}

// ---------------------------------------------------------------------------
// Meta-prompt for mutation (now per-target)
// ---------------------------------------------------------------------------

function buildMutationPrompt(params: {
  targetKey: string;
  currentPrompt: string;
  criteriaScores: Record<string, number>;
  lowestCriterion: string;
  lowestScore: number;
}): string {
  const config = TARGET_MUTATION_CONFIGS[params.targetKey];

  const scoreList = Object.entries(params.criteriaScores)
    .sort(([, a], [, b]) => a - b)
    .map(([key, score]) => `  ${key}: ${(score * 100).toFixed(1)}%`)
    .join("\n");

  const agentDesc = config?.agentDescription || "generates AI outputs";
  const placeholderList = config?.placeholders
    ? config.placeholders.map((p) => `{{${p}}}`).join(", ")
    : "any {{PLACEHOLDER}} variables";
  const safetyList = config?.safetyRuleDescriptions
    ? config.safetyRuleDescriptions.map((r, i) => `   ${i + 1}. ${r}`).join("\n")
    : "   - Keep all safety rules intact";

  return `You are an expert prompt engineer. Your task is to improve a prompt template that ${agentDesc}.

CURRENT PROMPT TEMPLATE:
---
${params.currentPrompt}
---

EVAL SCORES (from binary yes/no judging across test cases):
${scoreList}

LOWEST SCORING CRITERION: "${params.lowestCriterion}" at ${(params.lowestScore * 100).toFixed(1)}%

YOUR TASK:
Make exactly ONE focused improvement to the prompt template to improve the "${params.lowestCriterion}" criterion score. The improvement should be a small, targeted change — not a rewrite.

CRITICAL CONSTRAINTS:
1. Keep all placeholder variables exactly as they are: ${placeholderList}
2. NEVER remove these safety rules — they MUST remain in the output:
${safetyList}
3. Keep the overall structure and intent of the prompt intact
4. Only add, modify, or rephrase — never delete safety rules

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "mutated_prompt": "The full mutated prompt template",
  "mutation_description": "1-2 sentence description of what you changed and why"
}`;
}

// ---------------------------------------------------------------------------
// Main mutator
// ---------------------------------------------------------------------------

export async function generateMutation(params: {
  target_key: string;
  criteria_scores?: Record<string, number>;
}): Promise<MutationResult> {
  const { target_key } = params;

  // 1. Load the current active prompt
  const activeVersions = (await sbFetch(
    `/rest/v1/auto_research_prompt_versions?target_key=eq.${target_key}&status=eq.active&select=version,prompt_text,status,overall_score&limit=1`,
  )) as PromptVersionRow[];

  if (!activeVersions.length) {
    return { success: false, error: "No active prompt version found" };
  }

  const activeVersion = activeVersions[0];

  // 2. Get latest eval scores (from provided params or most recent run)
  let criteriaScores = params.criteria_scores;

  if (!criteriaScores) {
    const recentRuns = (await sbFetch(
      `/rest/v1/auto_research_runs?target_key=eq.${target_key}&prompt_version=eq.${activeVersion.version}&select=criteria_scores&order=created_at.desc&limit=1`,
    )) as Array<{ criteria_scores: Record<string, number> }>;

    if (recentRuns.length > 0) {
      criteriaScores = recentRuns[0].criteria_scores;
    }
  }

  if (!criteriaScores || Object.keys(criteriaScores).length === 0) {
    return {
      success: false,
      error: "No eval scores available — run eval first",
    };
  }

  // 3. Find lowest-scoring criterion
  const sorted = Object.entries(criteriaScores).sort(([, a], [, b]) => a - b);
  const [lowestCriterion, lowestScore] = sorted[0];

  // If everything is above 95%, no mutation needed
  if (lowestScore >= 0.95) {
    return {
      success: false,
      error: `All criteria scoring ≥95% — no mutation needed (lowest: ${lowestCriterion} at ${(lowestScore * 100).toFixed(1)}%)`,
    };
  }

  // 4. Generate mutation via Claude
  const model = await getPreferredClaudeModel("claude-sonnet-4-6");
  const mutationPrompt = buildMutationPrompt({
    targetKey: target_key,
    currentPrompt: activeVersion.prompt_text,
    criteriaScores,
    lowestCriterion,
    lowestScore,
  });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { success: false, error: "ANTHROPIC_API_KEY not configured" };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      temperature: 0.7,
      messages: [{ role: "user", content: mutationPrompt }],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      success: false,
      error: `Claude API failed (${res.status}): ${errText.slice(0, 200)}`,
    };
  }

  const payload = (await res.json()) as Record<string, unknown>;

  // Log cost
  const usage = extractClaudeUsage(payload);
  if (usage) {
    void logAICost({
      model,
      provider: "anthropic",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      endpoint: "auto_research_mutator",
      department: "systems",
    });
  }

  // 5. Parse response
  const content = payload.content;
  const textBlock =
    Array.isArray(content) &&
    content[0] &&
    typeof content[0] === "object" &&
    "text" in (content[0] as Record<string, unknown>)
      ? String((content[0] as Record<string, unknown>).text)
      : "";

  let parsed: {
    mutated_prompt?: string;
    mutation_description?: string;
  };
  try {
    parsed = JSON.parse(textBlock) as typeof parsed;
  } catch {
    const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]) as typeof parsed;
    } else {
      return { success: false, error: "Could not parse mutation response" };
    }
  }

  if (!parsed.mutated_prompt || parsed.mutated_prompt.length < 100) {
    return { success: false, error: "Mutated prompt too short or missing" };
  }

  // 6. SAFETY VALIDATION — reject if critical rules were removed
  const safety = validateSafetyRules(target_key, parsed.mutated_prompt);
  if (!safety.valid) {
    console.error(
      `[auto-research] Mutation rejected — safety rules removed: ${safety.missing.join(", ")}`,
    );

    void notify({
      channel: "alerts",
      text: `🚨 *Auto Research: Mutation REJECTED*\nTarget: ${target_key}\nMissing safety rules: ${safety.missing.join(", ")}\nThe mutation was discarded.`,
    }).catch(() => {});

    return {
      success: false,
      error: `Safety validation failed — missing: ${safety.missing.join(", ")}`,
      safety_violation: true,
    };
  }

  // 7. Check candidate count — max 3
  const existingCandidates = (await sbFetch(
    `/rest/v1/auto_research_prompt_versions?target_key=eq.${target_key}&status=eq.candidate&select=version,created_at&order=created_at.asc`,
  )) as Array<{ version: number; created_at: string }>;

  if (existingCandidates.length >= 3) {
    const oldest = existingCandidates[0];
    await sbFetch(
      `/rest/v1/auto_research_prompt_versions?target_key=eq.${target_key}&version=eq.${oldest.version}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "retired",
          updated_at: new Date().toISOString(),
        }),
      },
    );
  }

  // 8. Determine next version number
  const allVersions = (await sbFetch(
    `/rest/v1/auto_research_prompt_versions?target_key=eq.${target_key}&select=version&order=version.desc&limit=1`,
  )) as Array<{ version: number }>;

  const nextVersion = (allVersions[0]?.version || 0) + 1;

  // 9. Insert new candidate
  await sbFetch("/rest/v1/auto_research_prompt_versions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      target_key,
      version: nextVersion,
      prompt_text: parsed.mutated_prompt,
      parent_version: activeVersion.version,
      mutation_description:
        parsed.mutation_description || `Improve ${lowestCriterion}`,
      status: "candidate",
    }),
  });

  // Notify
  void notify({
    channel: "alerts",
    text: `🧬 *Auto Research: New Candidate*\nTarget: ${target_key}\nVersion ${nextVersion} (parent: v${activeVersion.version})\nFocus: ${lowestCriterion} (${(lowestScore * 100).toFixed(1)}%)\n${parsed.mutation_description || ""}`,
  }).catch(() => {});

  return {
    success: true,
    new_version: nextVersion,
    mutation_description: parsed.mutation_description,
  };
}
