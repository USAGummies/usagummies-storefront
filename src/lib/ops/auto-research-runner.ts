/**
 * Auto Research: Eval Runner (Multi-Target)
 *
 * Implements the Karpathy Auto Research loop for ALL Abra LLM agents:
 *   1. Load active + candidate prompt versions for a target
 *   2. Fetch test cases via per-target config
 *   3. For each version: generate output via Sonnet, judge via Haiku
 *   4. Score = weighted sum(YES) / total_possible
 *   5. If candidate beats active by ≥2%: promote, retire old, Slack notify
 *
 * Supported targets:
 *   email_drafter, financial_processor, slack_processor,
 *   weekly_digest, strategy_orchestrator, blog_drafter,
 *   social_responder, social_post_generator,
 *   morning_brief, anomaly_detector, pipeline_intel,
 *   operational_signals, b2b_outreach, b2b_reply_classifier,
 *   b2b_forecaster, b2b_deal_tracker, b2b_win_loss,
 *   seo_keyword_analyzer, seo_content_gap, dtc_post_purchase,
 *   dtc_cart_recovery, supply_demand_forecast, finops_reconciler,
 *   finops_cashflow, finops_pnl, social_engagement,
 *   social_analysis, b2b_reengagement
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

type EvalCriterion = {
  criterion_key: string;
  judge_instruction: string;
  weight: number;
};

type PromptVersion = {
  version: number;
  prompt_text: string;
  status: string;
};

type JudgmentResult = {
  criterion_key: string;
  verdict: boolean;
  raw_response: string;
};

export type EvalRunResult = {
  target_key: string;
  runs: Array<{
    version: number;
    overall_score: number;
    criteria_scores: Record<string, number>;
    is_winner: boolean;
  }>;
  promoted: boolean;
  promoted_version?: number;
  total_cost_usd: number;
};

// ---------------------------------------------------------------------------
// Per-target configuration
// ---------------------------------------------------------------------------

/**
 * Each target defines how to:
 * - Load test cases from Supabase
 * - Convert test case rows into prompt template variables
 * - Format context for the binary judge
 */
type TargetConfig = {
  /** Supabase REST query to fetch test cases (appended after /rest/v1/) */
  testCaseQuery: (sampleSize: number) => string;
  /** Convert a raw DB row into {{PLACEHOLDER}} vars for prompt interpolation */
  testCaseToVars: (row: Record<string, unknown>) => Record<string, string>;
  /** Format judge context: the "input" section shown to the judge alongside the output */
  formatJudgeContext: (row: Record<string, unknown>) => string;
  /** Max tokens for generation */
  maxTokens: number;
  /** Temperature for generation */
  temperature: number;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TARGET_CONFIGS: Record<string, TargetConfig> = {
  // -------------------------------------------------------------------------
  // EMAIL DRAFTER — reply draft for inbound emails
  // -------------------------------------------------------------------------
  email_drafter: {
    testCaseQuery: (n) =>
      `email_events?action_required=eq.true&select=id,sender_name,sender_email,subject,summary,raw_text,category&order=received_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        SENDER_NAME: r.sender_name || (r.sender_email || "").split("@")[0] || "Unknown",
        SENDER_EMAIL: r.sender_email || "",
        SUBJECT: r.subject || "(no subject)",
        CATEGORY: r.category || "general",
        VIP_BLOCK: "",
        EMAIL_BODY: (r.raw_text || r.summary || r.subject || "").slice(0, 3000),
        BRAIN_CONTEXT: "(No brain context available for eval test case)",
        TONE_RULE: "- Write as Ben. Friendly, professional, concise.",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `ORIGINAL EMAIL (what was being replied to):
${(r.raw_text || r.summary || r.subject || "").slice(0, 1000)}

SENDER RELATIONSHIP TYPE: unknown`;
    },
    maxTokens: 800,
    temperature: 0.2,
  },

  // -------------------------------------------------------------------------
  // FINANCIAL PROCESSOR — extract transactions from documents
  // -------------------------------------------------------------------------
  financial_processor: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*transaction*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        DOCUMENT: r.question || r.context_used || "(empty document)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `SOURCE DOCUMENT:
${(r.question || r.context_used || "").slice(0, 1500)}

EXPECTED FORMAT: JSON array of transaction objects`;
    },
    maxTokens: 1000,
    temperature: 0.1,
  },

  // -------------------------------------------------------------------------
  // SLACK PROCESSOR — generate Slack responses to user questions
  // -------------------------------------------------------------------------
  slack_processor: {
    testCaseQuery: (n) =>
      `abra_answer_log?select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        USER_QUESTION: r.question || "(empty question)",
        BRAIN_CONTEXT: r.context_used || "(No context available)",
        CHANNEL: "general",
        USER_NAME: "team-member",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `USER'S QUESTION:
${(r.question || "").slice(0, 1000)}

AVAILABLE CONTEXT:
${(r.context_used || "").slice(0, 1000)}`;
    },
    maxTokens: 600,
    temperature: 0.2,
  },

  // -------------------------------------------------------------------------
  // WEEKLY DIGEST — executive summary of weekly performance
  // -------------------------------------------------------------------------
  weekly_digest: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*weekly*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        PERFORMANCE_DATA: r.context_used || r.question || "(No data available)",
        DATE_RANGE: "Last 7 days",
        COMPANY_NAME: "USA Gummies",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `INPUT PERFORMANCE DATA:
${(r.context_used || r.question || "").slice(0, 2000)}

EXPECTED: Executive summary with actionable priorities`;
    },
    maxTokens: 1200,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // STRATEGY ORCHESTRATOR — generate strategic documents
  // -------------------------------------------------------------------------
  strategy_orchestrator: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*strateg*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        OBJECTIVE: r.question || "(No objective specified)",
        CONTEXT: r.context_used || "(No context available)",
        CONSTRAINTS: "Budget-conscious, small team, CPG industry",
        COMPANY_NAME: "USA Gummies",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `STRATEGIC OBJECTIVE:
${(r.question || "").slice(0, 1000)}

BUSINESS CONTEXT:
${(r.context_used || "").slice(0, 1000)}

EXPECTED: JSON strategy document with actionable items`;
    },
    maxTokens: 1400,
    temperature: 0.2,
  },

  // -------------------------------------------------------------------------
  // BLOG DRAFTER (S3) — generate MDX blog posts
  // -------------------------------------------------------------------------
  blog_drafter: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*blog*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        TOPIC: r.question || "(No topic specified)",
        KEYWORDS: "gummies, supplements, health, USA made",
        TARGET_AUDIENCE: "Health-conscious consumers, 25-45",
        BRAND_VOICE: "Friendly, knowledgeable, American-made pride",
        WORD_COUNT: "800-1200",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `BLOG TOPIC/BRIEF:
${(r.question || "").slice(0, 1000)}

TARGET: MDX blog post for USA Gummies website`;
    },
    maxTokens: 2000,
    temperature: 0.5,
  },

  // -------------------------------------------------------------------------
  // SOCIAL RESPONDER (SOC4) — reply to social media mentions
  // -------------------------------------------------------------------------
  social_responder: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*social*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        MENTION_TEXT: r.question || "(No mention text)",
        PLATFORM: "twitter",
        AUTHOR_NAME: "social-user",
        BRAND_NAME: "USA Gummies",
        BRAND_VOICE: "Friendly, patriotic, health-focused",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `SOCIAL MEDIA MENTION:
${(r.question || "").slice(0, 500)}

PLATFORM: Twitter/X
EXPECTED: Brief, on-brand reply`;
    },
    maxTokens: 200,
    temperature: 0.5,
  },

  // -------------------------------------------------------------------------
  // SOCIAL POST GENERATOR (MKT1/MKT2) — create social media posts
  // -------------------------------------------------------------------------
  social_post_generator: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*post*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        TOPIC: r.question || "(No topic specified)",
        PLATFORM: "twitter",
        BRAND_NAME: "USA Gummies",
        BRAND_VOICE: "Patriotic, health-focused, fun",
        PRODUCT_INFO: "Premium gummy supplements, made in USA",
        CTA: "Shop now at usagummies.com",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `POST TOPIC/BRIEF:
${(r.question || "").slice(0, 500)}

PLATFORM: Twitter/X
EXPECTED: Engaging social media post with hashtags and CTA`;
    },
    maxTokens: 300,
    temperature: 0.7,
  },

  // -------------------------------------------------------------------------
  // MORNING BRIEF — daily metrics summary for founder
  // -------------------------------------------------------------------------
  morning_brief: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*morning*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        METRICS_DATA: r.context_used || r.question || "(No metrics data)",
        DATE: new Date().toISOString().slice(0, 10),
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `METRICS INPUT:
${(r.context_used || r.question || "").slice(0, 1500)}

EXPECTED: Concise morning brief with key metrics and action items`;
    },
    maxTokens: 800,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // ANOMALY DETECTOR — flag metric anomalies
  // -------------------------------------------------------------------------
  anomaly_detector: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*anomal*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        ANOMALY_DATA: r.context_used || r.question || "(No anomaly data)",
        METRIC_NAME: "revenue",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `ANOMALY INPUT DATA:
${(r.context_used || r.question || "").slice(0, 1500)}

EXPECTED: Clear anomaly identification with severity and recommendation`;
    },
    maxTokens: 600,
    temperature: 0.2,
  },

  // -------------------------------------------------------------------------
  // PIPELINE INTEL — deal pipeline intelligence
  // -------------------------------------------------------------------------
  pipeline_intel: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*deal*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        DEAL_DATA: r.context_used || r.question || "(No deal data)",
        CONTACT_HISTORY: r.answer || "(No contact history)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `DEAL/PIPELINE DATA:
${(r.context_used || r.question || "").slice(0, 1500)}

EXPECTED: Pipeline intelligence with deal insights and next steps`;
    },
    maxTokens: 800,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // OPERATIONAL SIGNALS — detect actionable signals from emails/data
  // -------------------------------------------------------------------------
  operational_signals: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*signal*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        EMAIL_TEXT: r.question || "(No email text)",
        SENDER_CONTEXT: r.context_used || "(No sender context)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `EMAIL/SIGNAL INPUT:
${(r.question || "").slice(0, 1000)}

SENDER CONTEXT:
${(r.context_used || "").slice(0, 500)}

EXPECTED: Actionable operational signal extraction`;
    },
    maxTokens: 600,
    temperature: 0.2,
  },

  // -------------------------------------------------------------------------
  // B2B OUTREACH — generate B2B outreach emails
  // -------------------------------------------------------------------------
  b2b_outreach: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*outreach*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        PROSPECT_DATA: r.question || "(No prospect data)",
        COMPANY_INFO: r.context_used || "(No company info)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `PROSPECT DATA:
${(r.question || "").slice(0, 1000)}

COMPANY INFO:
${(r.context_used || "").slice(0, 500)}

EXPECTED: Personalized B2B outreach email`;
    },
    maxTokens: 600,
    temperature: 0.4,
  },

  // -------------------------------------------------------------------------
  // B2B REPLY CLASSIFIER — classify inbound B2B replies
  // -------------------------------------------------------------------------
  b2b_reply_classifier: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*reply*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        REPLY_TEXT: r.question || "(No reply text)",
        ORIGINAL_EMAIL: r.context_used || "(No original email)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `REPLY TEXT:
${(r.question || "").slice(0, 1000)}

ORIGINAL EMAIL:
${(r.context_used || "").slice(0, 500)}

EXPECTED: Classification (interested, not interested, needs info, out of office, etc.)`;
    },
    maxTokens: 300,
    temperature: 0.1,
  },

  // -------------------------------------------------------------------------
  // B2B FORECASTER — revenue and pipeline forecasting
  // -------------------------------------------------------------------------
  b2b_forecaster: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*forecast*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        REVENUE_DATA: r.question || "(No revenue data)",
        PIPELINE_DATA: r.context_used || "(No pipeline data)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `REVENUE DATA:
${(r.question || "").slice(0, 1000)}

PIPELINE DATA:
${(r.context_used || "").slice(0, 1000)}

EXPECTED: Revenue forecast with confidence ranges and assumptions`;
    },
    maxTokens: 1000,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // B2B DEAL TRACKER — track deal stage changes
  // -------------------------------------------------------------------------
  b2b_deal_tracker: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*deal*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        DEAL_DATA: r.question || "(No deal data)",
        STAGE_HISTORY: r.context_used || "(No stage history)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `DEAL DATA:
${(r.question || "").slice(0, 1000)}

STAGE HISTORY:
${(r.context_used || "").slice(0, 500)}

EXPECTED: Deal status update with next actions`;
    },
    maxTokens: 400,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // B2B WIN/LOSS — analyze won and lost deals
  // -------------------------------------------------------------------------
  b2b_win_loss: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*win*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        WON_DEALS: r.question || "(No won deals data)",
        LOST_DEALS: r.context_used || "(No lost deals data)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `WON DEALS:
${(r.question || "").slice(0, 1000)}

LOST DEALS:
${(r.context_used || "").slice(0, 1000)}

EXPECTED: Win/loss analysis with patterns and recommendations`;
    },
    maxTokens: 800,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // SEO KEYWORD ANALYZER — analyze keyword opportunities
  // -------------------------------------------------------------------------
  seo_keyword_analyzer: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*keyword*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        KEYWORD_DATA: r.question || "(No keyword data)",
        COMPETITOR_DATA: r.context_used || "(No competitor data)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `KEYWORD DATA:
${(r.question || "").slice(0, 1000)}

COMPETITOR DATA:
${(r.context_used || "").slice(0, 1000)}

EXPECTED: Keyword analysis with opportunity ranking and difficulty`;
    },
    maxTokens: 800,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // SEO CONTENT GAP — identify content gaps vs competitors
  // -------------------------------------------------------------------------
  seo_content_gap: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*content*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        GAP_DATA: r.question || "(No gap data)",
        EXISTING_CONTENT: r.context_used || "(No existing content inventory)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `CONTENT GAP DATA:
${(r.question || "").slice(0, 1000)}

EXISTING CONTENT:
${(r.context_used || "").slice(0, 1000)}

EXPECTED: Content gap analysis with prioritized recommendations`;
    },
    maxTokens: 1000,
    temperature: 0.4,
  },

  // -------------------------------------------------------------------------
  // DTC POST PURCHASE — post-purchase engagement emails
  // -------------------------------------------------------------------------
  dtc_post_purchase: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*purchase*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        ORDER_DATA: r.question || "(No order data)",
        CUSTOMER_DATA: r.context_used || "(No customer data)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `ORDER DATA:
${(r.question || "").slice(0, 1000)}

CUSTOMER DATA:
${(r.context_used || "").slice(0, 500)}

EXPECTED: Post-purchase engagement email (thank you, review request, or upsell)`;
    },
    maxTokens: 400,
    temperature: 0.4,
  },

  // -------------------------------------------------------------------------
  // DTC CART RECOVERY — abandoned cart recovery emails
  // -------------------------------------------------------------------------
  dtc_cart_recovery: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*cart*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        CART_DATA: r.question || "(No cart data)",
        CUSTOMER_NAME: r.context_used || "Valued Customer",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `ABANDONED CART DATA:
${(r.question || "").slice(0, 1000)}

CUSTOMER INFO:
${(r.context_used || "").slice(0, 500)}

EXPECTED: Cart recovery email with urgency and incentive`;
    },
    maxTokens: 400,
    temperature: 0.4,
  },

  // -------------------------------------------------------------------------
  // SUPPLY DEMAND FORECAST — inventory demand forecasting
  // -------------------------------------------------------------------------
  supply_demand_forecast: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*demand*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        VELOCITY_DATA: r.question || "(No velocity data)",
        INVENTORY_DATA: r.context_used || "(No inventory data)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `VELOCITY DATA:
${(r.question || "").slice(0, 1000)}

INVENTORY DATA:
${(r.context_used || "").slice(0, 1000)}

EXPECTED: Demand forecast with reorder recommendations`;
    },
    maxTokens: 800,
    temperature: 0.2,
  },

  // -------------------------------------------------------------------------
  // FINOPS RECONCILER — reconcile transactions
  // -------------------------------------------------------------------------
  finops_reconciler: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*transaction*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        TRANSACTION_DATA: r.question || r.context_used || "(No transaction data)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `TRANSACTION DATA:
${(r.question || r.context_used || "").slice(0, 1500)}

EXPECTED: Reconciliation result with matched/unmatched items`;
    },
    maxTokens: 300,
    temperature: 0.1,
  },

  // -------------------------------------------------------------------------
  // FINOPS CASHFLOW — cashflow analysis and projection
  // -------------------------------------------------------------------------
  finops_cashflow: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*cash*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        CASHFLOW_DATA: r.context_used || r.question || "(No cashflow data)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `CASHFLOW INPUT:
${(r.context_used || r.question || "").slice(0, 1500)}

EXPECTED: Cashflow analysis with projections and alerts`;
    },
    maxTokens: 800,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // FINOPS P&L — profit and loss analysis
  // -------------------------------------------------------------------------
  finops_pnl: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*profit*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        PNL_DATA: r.context_used || r.question || "(No P&L data)",
        PERIOD: "current month",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `P&L INPUT DATA:
${(r.context_used || r.question || "").slice(0, 1500)}

EXPECTED: P&L summary with margin analysis and variance notes`;
    },
    maxTokens: 600,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // SOCIAL ENGAGEMENT — reply to social media engagement
  // -------------------------------------------------------------------------
  social_engagement: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*social*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        MENTION_TEXT: r.question || "(No mention text)",
        PLATFORM: "twitter",
        AUTHOR_CONTEXT: r.context_used || "(No author context)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `SOCIAL MENTION:
${(r.question || "").slice(0, 500)}

AUTHOR CONTEXT:
${(r.context_used || "").slice(0, 500)}

EXPECTED: Brief, on-brand engagement reply`;
    },
    maxTokens: 200,
    temperature: 0.5,
  },

  // -------------------------------------------------------------------------
  // SOCIAL ANALYSIS — analyze social media mentions
  // -------------------------------------------------------------------------
  social_analysis: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*mention*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        MENTIONS_DATA: r.context_used || r.question || "(No mentions data)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `MENTIONS DATA:
${(r.context_used || r.question || "").slice(0, 2000)}

EXPECTED: Sentiment analysis with themes and recommended actions`;
    },
    maxTokens: 600,
    temperature: 0.3,
  },

  // -------------------------------------------------------------------------
  // B2B REENGAGEMENT — reengage cold B2B prospects
  // -------------------------------------------------------------------------
  b2b_reengagement: {
    testCaseQuery: (n) =>
      `abra_answer_log?question=ilike.*reengage*&select=id,question,answer,context_used&order=created_at.desc&limit=${n}`,
    testCaseToVars: (row) => {
      const r = row as Record<string, string | null>;
      return {
        PROSPECT_DATA: r.question || "(No prospect data)",
        PAST_INTERACTION: r.context_used || "(No past interaction data)",
      };
    },
    formatJudgeContext: (row) => {
      const r = row as Record<string, string | null>;
      return `PROSPECT DATA:
${(r.question || "").slice(0, 1000)}

PAST INTERACTION:
${(r.context_used || "").slice(0, 500)}

EXPECTED: Reengagement email with personalized hook and value prop`;
    },
    maxTokens: 400,
    temperature: 0.4,
  },
};

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
// Anthropic API helpers
// ---------------------------------------------------------------------------

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  return key;
}

async function callClaude(params: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  endpoint: string;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getAnthropicKey(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      messages: params.messages,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Claude API failed (${res.status}): ${errText.slice(0, 200)}`,
    );
  }

  const payload = (await res.json()) as Record<string, unknown>;
  const usage = extractClaudeUsage(payload);
  const content = payload.content;
  const textBlock =
    Array.isArray(content) &&
    content[0] &&
    typeof content[0] === "object" &&
    "text" in (content[0] as Record<string, unknown>)
      ? String((content[0] as Record<string, unknown>).text)
      : "";

  return {
    text: textBlock,
    inputTokens: usage?.inputTokens || 0,
    outputTokens: usage?.outputTokens || 0,
  };
}

// ---------------------------------------------------------------------------
// Core eval functions
// ---------------------------------------------------------------------------

/**
 * Interpolate a prompt template with actual values.
 */
function interpolatePrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

/**
 * Generate output using a specific prompt version and target config.
 */
async function generateOutput(
  promptTemplate: string,
  testCase: Record<string, unknown>,
  config: TargetConfig,
  model: string,
): Promise<{
  rawOutput: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const vars = config.testCaseToVars(testCase);
  const interpolated = interpolatePrompt(promptTemplate, vars);

  const result = await callClaude({
    model,
    messages: [{ role: "user", content: interpolated }],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    endpoint: "auto_research_generate",
  });

  return {
    rawOutput: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

/**
 * Judge an output against a single binary criterion using Haiku.
 */
async function judgeOutput(params: {
  criterion: EvalCriterion;
  output: string;
  inputContext: string;
  judgeModel: string;
}): Promise<JudgmentResult> {
  const judgePrompt = `${params.criterion.judge_instruction}

${params.inputContext}

AGENT OUTPUT:
${params.output.slice(0, 2000)}

Answer with exactly YES or NO.`;

  const result = await callClaude({
    model: params.judgeModel,
    messages: [{ role: "user", content: judgePrompt }],
    maxTokens: 10,
    temperature: 0,
    endpoint: "auto_research_judge",
  });

  const answer = result.text.trim().toUpperCase();
  const verdict = answer.startsWith("YES");

  // Log cost for judge calls
  void logAICost({
    model: params.judgeModel,
    provider: "anthropic",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    endpoint: "auto_research_judge",
    department: "systems",
  });

  return {
    criterion_key: params.criterion.criterion_key,
    verdict,
    raw_response: result.text.trim(),
  };
}

// ---------------------------------------------------------------------------
// Main eval runner
// ---------------------------------------------------------------------------

export async function runAutoResearchEval(params: {
  target_key: string;
  sample_size?: number;
}): Promise<EvalRunResult> {
  const { target_key } = params;
  const sampleSize = params.sample_size || 10;
  let totalCostUsd = 0;

  // Get target config
  const config = TARGET_CONFIGS[target_key];
  if (!config) {
    throw new Error(
      `Unknown target '${target_key}'. Valid targets: ${Object.keys(TARGET_CONFIGS).join(", ")}`,
    );
  }

  // 1. Load active eval criteria
  const criteria = (await sbFetch(
    `/rest/v1/auto_research_evals?target_key=eq.${target_key}&is_active=eq.true&select=criterion_key,judge_instruction,weight`,
  )) as EvalCriterion[];

  if (!criteria.length) {
    throw new Error(`No active eval criteria for target '${target_key}'`);
  }

  // 2. Load prompt versions (active + up to 3 candidates)
  const versions = (await sbFetch(
    `/rest/v1/auto_research_prompt_versions?target_key=eq.${target_key}&status=in.(active,candidate)&select=version,prompt_text,status&order=version.asc`,
  )) as PromptVersion[];

  if (!versions.length) {
    throw new Error(`No active/candidate prompts for target '${target_key}'`);
  }

  // 3. Fetch test cases using per-target query
  const testCases = (await sbFetch(
    `/rest/v1/${config.testCaseQuery(sampleSize)}`,
  )) as Array<Record<string, unknown>>;

  if (!testCases.length) {
    throw new Error(`No test cases available for target '${target_key}'`);
  }

  // 4. Get model preferences
  const genModel = await getPreferredClaudeModel("claude-sonnet-4-6-20260315");
  const judgeModel = "claude-3-5-haiku-latest";

  const runResults: EvalRunResult["runs"] = [];

  // 5. Eval each prompt version
  for (const version of versions) {
    const criteriaScores: Record<string, number> = {};
    const rawJudgments: Record<
      string,
      Record<string, { verdict: boolean; raw: string }>
    > = {};

    // Initialize criterion accumulators
    for (const c of criteria) {
      criteriaScores[c.criterion_key] = 0;
    }

    // Generate and judge each test case
    for (const testCase of testCases) {
      const caseId = String(testCase.id || Math.random());
      try {
        // Generate output
        const output = await generateOutput(
          version.prompt_text,
          testCase,
          config,
          genModel,
        );

        // Estimate Sonnet cost (~$3/$15 per M tokens)
        totalCostUsd +=
          (output.inputTokens * 3 + output.outputTokens * 15) / 1_000_000;

        // Log generation cost
        void logAICost({
          model: genModel,
          provider: "anthropic",
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
          endpoint: "auto_research_generate",
          department: "systems",
        });

        // Judge against each criterion
        const caseJudgments: Record<
          string,
          { verdict: boolean; raw: string }
        > = {};

        const inputContext = config.formatJudgeContext(testCase);

        for (const criterion of criteria) {
          try {
            const judgment = await judgeOutput({
              criterion,
              output: output.rawOutput,
              inputContext,
              judgeModel,
            });

            caseJudgments[criterion.criterion_key] = {
              verdict: judgment.verdict,
              raw: judgment.raw_response,
            };

            if (judgment.verdict) {
              criteriaScores[criterion.criterion_key] += 1;
            }

            // Estimate Haiku cost
            totalCostUsd += 0.0002;
          } catch (judgeErr) {
            console.error(
              `[auto-research] Judge error for ${criterion.criterion_key}:`,
              judgeErr instanceof Error ? judgeErr.message : judgeErr,
            );
          }
        }

        rawJudgments[caseId] = caseJudgments;
      } catch (genErr) {
        console.error(
          `[auto-research] Generate error for test case ${caseId}:`,
          genErr instanceof Error ? genErr.message : genErr,
        );
      }
    }

    // Calculate overall score (weighted average)
    const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
    let weightedScore = 0;
    for (const c of criteria) {
      const rate = criteriaScores[c.criterion_key] / testCases.length;
      criteriaScores[c.criterion_key] = Math.round(rate * 10000) / 10000;
      weightedScore += rate * c.weight;
    }
    const overallScore =
      Math.round((weightedScore / totalWeight) * 10000) / 10000;

    // Log run to database
    await sbFetch("/rest/v1/auto_research_runs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        target_key,
        prompt_version: version.version,
        sample_size: testCases.length,
        criteria_scores: criteriaScores,
        overall_score: overallScore,
        is_winner: false,
        total_cost_usd: Math.round(totalCostUsd * 10000) / 10000,
        test_case_ids: testCases.map((t) => String(t.id || "")),
        raw_judgments: rawJudgments,
      }),
    });

    // Update cached score on prompt version
    await sbFetch(
      `/rest/v1/auto_research_prompt_versions?target_key=eq.${target_key}&version=eq.${version.version}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          overall_score: overallScore,
          updated_at: new Date().toISOString(),
        }),
      },
    );

    runResults.push({
      version: version.version,
      overall_score: overallScore,
      criteria_scores: criteriaScores,
      is_winner: false,
    });
  }

  // 6. Determine winner & promote if candidate beats active by ≥2%
  const activeRun = runResults.find(
    (r) => versions.find((v) => v.version === r.version)?.status === "active",
  );
  const candidateRuns = runResults.filter(
    (r) =>
      versions.find((v) => v.version === r.version)?.status === "candidate",
  );

  let promoted = false;
  let promotedVersion: number | undefined;

  if (activeRun && candidateRuns.length > 0) {
    const bestCandidate = candidateRuns.reduce((best, curr) =>
      curr.overall_score > best.overall_score ? curr : best,
    );

    const improvement = bestCandidate.overall_score - activeRun.overall_score;

    if (improvement >= 0.02) {
      // Promote: candidate → active, old active → retired
      await sbFetch(
        `/rest/v1/auto_research_prompt_versions?target_key=eq.${target_key}&status=eq.active`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "retired",
            updated_at: new Date().toISOString(),
          }),
        },
      );

      await sbFetch(
        `/rest/v1/auto_research_prompt_versions?target_key=eq.${target_key}&version=eq.${bestCandidate.version}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "active",
            updated_at: new Date().toISOString(),
          }),
        },
      );

      // Mark winner in runs
      await sbFetch(
        `/rest/v1/auto_research_runs?target_key=eq.${target_key}&prompt_version=eq.${bestCandidate.version}&order=created_at.desc&limit=1`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ is_winner: true }),
        },
      );

      bestCandidate.is_winner = true;
      promoted = true;
      promotedVersion = bestCandidate.version;

      void notify({
        channel: "alerts",
        text: `🧬 *Auto Research: Prompt Promoted!*\nTarget: ${target_key}\nVersion ${bestCandidate.version} promoted (score: ${(bestCandidate.overall_score * 100).toFixed(1)}% vs ${(activeRun.overall_score * 100).toFixed(1)}%)\nImprovement: +${(improvement * 100).toFixed(1)}%`,
      }).catch(() => {});
    }
  }

  return {
    target_key,
    runs: runResults,
    promoted,
    promoted_version: promotedVersion,
    total_cost_usd: Math.round(totalCostUsd * 10000) / 10000,
  };
}

/**
 * List all supported target keys.
 */
export function getSupportedTargets(): string[] {
  return Object.keys(TARGET_CONFIGS);
}

/**
 * Get the active prompt for a target, or null if none exists.
 */
export async function getActivePrompt(
  targetKey: string,
): Promise<{ version: number; prompt_text: string } | null> {
  try {
    const rows = (await sbFetch(
      `/rest/v1/auto_research_prompt_versions?target_key=eq.${targetKey}&status=eq.active&select=version,prompt_text&limit=1`,
    )) as Array<{ version: number; prompt_text: string }>;

    return rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

/**
 * Get recent eval runs for dashboard display.
 */
export async function getRecentRuns(
  targetKey: string,
  limit: number = 20,
): Promise<
  Array<{
    id: string;
    prompt_version: number;
    sample_size: number;
    criteria_scores: Record<string, number>;
    overall_score: number;
    is_winner: boolean;
    total_cost_usd: number;
    created_at: string;
  }>
> {
  const rows = (await sbFetch(
    `/rest/v1/auto_research_runs?target_key=eq.${targetKey}&select=id,prompt_version,sample_size,criteria_scores,overall_score,is_winner,total_cost_usd,created_at&order=created_at.desc&limit=${limit}`,
  )) as Array<{
    id: string;
    prompt_version: number;
    sample_size: number;
    criteria_scores: Record<string, number>;
    overall_score: number;
    is_winner: boolean;
    total_cost_usd: number;
    created_at: string;
  }>;

  return rows;
}

/**
 * Get all prompt versions for a target.
 */
export async function getPromptVersions(
  targetKey: string,
): Promise<
  Array<{
    version: number;
    status: string;
    overall_score: number | null;
    mutation_description: string | null;
    parent_version: number | null;
    created_at: string;
  }>
> {
  const rows = (await sbFetch(
    `/rest/v1/auto_research_prompt_versions?target_key=eq.${targetKey}&select=version,status,overall_score,mutation_description,parent_version,created_at&order=version.desc`,
  )) as Array<{
    version: number;
    status: string;
    overall_score: number | null;
    mutation_description: string | null;
    parent_version: number | null;
    created_at: string;
  }>;

  return rows;
}
