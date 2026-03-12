#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const ENV_PATH = path.resolve(process.cwd(), ".env.local");
const CURRICULUM_VERSION = "v3";

function parseEnvLocal(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const content = fs.readFileSync(filePath, "utf8");

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const idx = normalized.indexOf("=");
    if (idx <= 0) continue;

    const key = normalized.slice(0, idx).trim();
    let value = normalized.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function argHas(flag) {
  return process.argv.includes(flag);
}

function loadRuntimeEnv() {
  const env = parseEnvLocal(ENV_PATH);
  const merged = (key, fallback = "") =>
    (process.env[key] || env[key] || fallback || "").trim();

  return {
    supabaseUrl: merged("SUPABASE_URL", merged("NEXT_PUBLIC_SUPABASE_URL")),
    supabaseKey: merged("SUPABASE_SERVICE_ROLE_KEY"),
    openaiKey: merged("OPENAI_API_KEY"),
    slackWebhook:
      merged("SLACK_WEBHOOK_DAILY") ||
      merged("SLACK_WEBHOOK_ALERTS") ||
      merged("SLACK_SUPPORT_WEBHOOK_URL"),
  };
}

async function sbFetch(baseUrl, serviceRoleKey, route, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", serviceRoleKey);
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(20000),
  });

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Supabase ${init.method || "GET"} ${route} failed (${res.status}): ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }

  return json;
}

async function getEmbedding(openaiKey, text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
      dimensions: 1536,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const textOut = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${textOut.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.data?.[0]?.embedding || [];
}

async function sendSlack(webhook, text) {
  if (!webhook) return false;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const MODULES = [
  {
    department: "amazon",
    category: "market_intel",
    title: "Amazon Supplements Operating Model",
    content:
      "Amazon success for CPG supplements depends on rank velocity, review quality, and contribution margin discipline. Treat Amazon as a search marketplace first: listing relevance and conversion are more important than pure ad spend. Weekly control loop: monitor organic rank, ad ACOS/TACOS, coupon impact, and in-stock days. Never run aggressive PPC on inventory that cannot sustain 30 days of demand. Prioritize exact-match campaigns on proven terms, then expand broad only when listing conversion is stable. Keep review response time under 24 hours and classify negative reviews into quality, expectation mismatch, shipping damage, and counterfeit concern. Feed those classes into product, packaging, and customer experience actions.",
    questions: [
      "Which 10 Amazon keywords are non-negotiable for USA Gummies in Q2?",
      "What ACOS and TACOS guardrails should pause campaigns automatically?",
      "Which top 3 negative review themes should trigger immediate corrective action?",
    ],
  },
  {
    department: "amazon",
    category: "operational",
    title: "Amazon FBA Inventory and Replenishment Discipline",
    content:
      "FBA is a cash-conversion machine when inventory is balanced. Use a target band of 35-60 days of cover for fast movers and 21-35 days for long-tail SKUs. Replenishment decisions must combine current FC stock, inbound transfer lag, and expected ad-driven lift. Guardrails: if days-of-cover falls below 21, automatically reduce discount aggressiveness; below 14, pause non-brand campaigns. Maintain a weekly restock calendar and enforce carton-level quality checks before FBA inbound to avoid stranded units.",
    questions: [
      "What target days-of-cover should each top SKU maintain in FBA?",
      "At what threshold should Abra automatically reduce promotions due to stock risk?",
    ],
  },
  {
    department: "amazon",
    category: "financial",
    title: "Amazon Contribution Margin by SKU",
    content:
      "Calculate Amazon contribution margin per SKU as: net sales minus referral fees, FBA fees, storage, ad spend, landed COGS, and return reserve. Track margin weekly, not monthly, and classify SKUs into scale, stabilize, or fix. Scale SKUs that are margin-positive and ranking up. Stabilize SKUs near break-even with high strategic relevance. Fix SKUs with persistent negative contribution by changing packaging, price, ad targeting, or offer architecture.",
    questions: [
      "Which SKUs are scale versus stabilize versus fix today?",
      "What minimum contribution margin percent should block promotional spend?",
    ],
  },
  {
    department: "ecommerce",
    category: "sales",
    title: "Shopify Conversion System for Supplement DTC",
    content:
      "Shopify growth for supplements comes from offer clarity, trust architecture, and post-click speed. Primary conversion levers: above-the-fold offer comprehension in under 3 seconds, transparent total price, social proof tied to outcomes, and fast checkout confidence. Use one dominant CTA per purchase rail, one price anchor line, and one savings line. Keep high-friction content below conversion blocks. Weekly experiments should isolate one variable at a time: headline, pack architecture, incentive, or checkout reassurance.",
    questions: [
      "Which single conversion hypothesis should be tested first this week?",
      "What checkout reassurance copy best reduces abandonment for first-time buyers?",
    ],
  },
  {
    department: "ecommerce",
    category: "customer_insight",
    title: "Retention Loop for Gummy Supplement Customers",
    content:
      "Retention should be treated as a product experience loop, not just email cadence. Trigger retention by expected depletion windows and usage outcomes. Segment flows by first-order SKU and stated goal. Send support content before reorder asks. In supplements, trust decays if expected outcomes and dosing clarity are weak. Build post-purchase content around how to use, what to expect by week, and when to reorder.",
    questions: [
      "What is the expected depletion window per primary SKU?",
      "Which retention message should be tied to week-2 versus week-4 outcomes?",
    ],
  },
  {
    department: "sales_and_growth",
    category: "deal_data",
    title: "Faire Wholesale Growth Playbook",
    content:
      "Treat Faire as a distribution and discovery channel with strict margin controls. Optimize wholesale catalog for reorderability: clear MOQ, case-pack economics, predictable fill rate, and fast response SLA. Prioritize retailer cohorts by reorder probability and category fit. Build a weekly outbound loop to high-intent retailers who viewed or sampled but did not reorder. Do not optimize for gross order count; optimize for 60-day reorder rate and gross margin per retailer.",
    questions: [
      "Which retailer cohort has the highest 60-day reorder probability?",
      "What minimum first-order size protects margin after fees and promos?",
    ],
  },
  {
    department: "trade_marketing",
    category: "sales",
    title: "Trade Marketing for Retail and Distributor Readiness",
    content:
      "Trade readiness requires sell-sheet precision, promotional calendar discipline, and shelf-level proof. Build retailer assets that answer three questions instantly: why this product sells, why now, and why this margin works. Standardize launch kits: product story, pricing architecture, shelf dimensions, case pack, and promo support schedule. Track retailer enablement metrics: sample-to-order conversion, order-to-reorder interval, and store-level velocity.",
    questions: [
      "What launch kit elements are missing from current distributor outreach?",
      "Which promo calendar windows should be locked for the next 90 days?",
    ],
  },
  {
    department: "supply_chain",
    category: "supply_chain",
    title: "CPG Supply Chain Risk Controls",
    content:
      "Implement a rolling 12-week supply risk view by SKU: raw material risk, manufacturing slot risk, freight risk, and demand volatility risk. Every SKU should have a clear reorder trigger and contingency supplier path. Create response playbooks for delay scenarios: expedite, substitute packaging, adjust channel allocation, or throttle promotions. Tie supply risk severity to channel decisions in real time.",
    questions: [
      "Which SKUs have no viable contingency path if a run slips by two weeks?",
      "What promotion throttles should trigger automatically under supply risk?",
    ],
  },
  {
    department: "operations",
    category: "operational",
    title: "Operating Rhythm for Founder-Led CPG Execution",
    content:
      "A founder-led CPG system needs a fixed cadence: daily performance pulse, weekly operating review, and monthly capital allocation review. Daily pulse covers revenue, cash position, inventory risk, and critical incidents. Weekly review drives decisions on pricing, promotions, and channel allocation. Monthly review rebalances spend across growth, inventory, and risk reserves. Abra should summarize anomalies and present binary decision options with clear tradeoffs.",
    questions: [
      "What 5 decisions should always be escalated to founder review?",
      "What decisions can be auto-executed safely without approval?",
    ],
  },
  {
    department: "finance",
    category: "financial",
    title: "Capital Allocation Rules for $100K-Scale CPG Windows",
    content:
      "Capital allocation in early CPG should prioritize survivability and velocity: maintain cash reserve, protect inventory continuity, and fund profitable acquisition loops. Use envelope budgets with explicit stop-loss thresholds for paid media and experiments. Require weekly attribution of spend to measurable output: contribution margin, inventory turns, and reorder quality. Avoid channel expansion if core channels are not profitable at steady state.",
    questions: [
      "What reserve floor should never be breached in cash planning?",
      "Which spend category currently has weak attribution and should be constrained?",
    ],
  },
  {
    department: "finance",
    category: "financial",
    title: "Unit Economics Governance Across Channels",
    content:
      "Define one canonical unit economics model for Shopify, Amazon, Faire, and direct wholesale. Every action should be evaluated against contribution margin and cash cycle impact, not top-line growth alone. Build alert thresholds for margin compression by channel and SKU. When margin drops below threshold, Abra should automatically propose the smallest reversible corrective action first.",
    questions: [
      "What is the hard floor contribution margin by channel?",
      "Which corrective action should run first when margin breaches occur?",
    ],
  },
  {
    department: "quality",
    category: "operational",
    title: "Quality and Complaint Escalation for Gummies",
    content:
      "Quality incidents in gummies should be triaged by safety, usability, and expectation risk. Build a complaint taxonomy: texture/melt, flavor variance, packaging defect, dosage confusion, and adverse reaction signal. Safety-class complaints escalate immediately to legal and executive review. Non-safety trends should still trigger CAPA-style corrective actions with owner and deadline.",
    questions: [
      "What complaint volume threshold should trigger formal CAPA?",
      "Who is the named owner for each complaint class escalation path?",
    ],
  },
  {
    department: "legal",
    category: "regulatory",
    title: "Regulatory Hygiene for Supplement Claims",
    content:
      "Supplement marketing must preserve DSHEA compliance discipline: avoid disease-treatment claims, ensure structure-function claims are supportable, and keep required disclaimers where applicable. Build pre-publish checks for product pages, ad copy, and influencer scripts. Abra should block or escalate any language that implies diagnosis, treatment, cure, or prevention claims.",
    questions: [
      "Which current claims need legal review before broader campaign rollout?",
      "What wording library is approved for each primary product benefit?",
    ],
  },
  {
    department: "data_analytics",
    category: "research",
    title: "KPI Reliability and Signal Integrity",
    content:
      "Decision systems fail when KPI definitions drift. Maintain a KPI dictionary with owner, formula, source system, and freshness SLA. Attach every dashboard metric to a defined query or source event. If data freshness or completeness degrades, Abra should switch to degraded mode with explicit confidence warnings rather than silent assumptions.",
    questions: [
      "Which KPI definitions are still ambiguous today?",
      "What freshness SLA should each decision-critical KPI enforce?",
    ],
  },
  {
    department: "brand_studio",
    category: "competitive",
    title: "CPG Brand Narrative in a Commodity-Heavy Category",
    content:
      "In crowded supplement categories, narrative clarity is a structural advantage. Keep one core brand promise, repeated consistently across PDP, email, ads, and wholesale sell-in. Avoid claim fragmentation across channels. Build a message map that ties each claim to proof type: ingredient, process, quality control, or customer outcome.",
    questions: [
      "What is the exact one-line brand promise to enforce across channels?",
      "Which claims currently lack proof assets and should be deprioritized?",
    ],
  },
  {
    department: "customer_experience",
    category: "customer_insight",
    title: "CX Operating Standard for Early-Stage Trust",
    content:
      "Customer experience is a compounding trust loop for supplements. Define response SLAs, escalation levels, and make-good policies that preserve margin while preventing churn. Build templated resolutions by issue type and track recurrence. Abra should classify support interactions into product confusion, expectation mismatch, quality defect, or fulfillment issue and surface recurring root causes weekly.",
    questions: [
      "What response SLA should be non-negotiable for high-risk support tickets?",
      "Which recurring issue deserves product or copy intervention this month?",
    ],
  },
  {
    department: "product",
    category: "product_info",
    title: "SKU Architecture and Rationalization",
    content:
      "SKU complexity should grow only when operationally justified. Evaluate each SKU by margin quality, repeat potential, and operational burden. Use a quarterly SKU review to sunset low-value complexity. New SKU approvals should require clear hypothesis, launch metric, and kill criteria.",
    questions: [
      "Which SKU should be sunset first if complexity must be reduced?",
      "What launch metric should gate any new SKU in the next quarter?",
    ],
  },
  {
    department: "research_lab",
    category: "research",
    title: "Evidence Standards for New Formula Concepts",
    content:
      "Formula innovation should follow evidence hierarchy: safety baseline, mechanism plausibility, dosage feasibility, and market relevance. Define minimum evidence requirements before concept promotion. Separate hypothesis content from validated claims in all internal and external communications.",
    questions: [
      "Which planned formula concepts currently fail minimum evidence standards?",
      "What evidence threshold must be met before marketing language is drafted?",
    ],
  },
  {
    department: "marketing",
    category: "sales",
    title: "Paid Media Governance for Supplements",
    content:
      "Paid media should run under explicit guardrails: spend caps, CAC targets, and creative fatigue detection. Build an experiment ledger that logs hypothesis, expected effect size, and stop conditions. Abra should recommend budget reallocation only when performance deltas exceed noise thresholds across at least two periods.",
    questions: [
      "What CAC ceiling should automatically freeze campaign scale-up?",
      "Which creative fatigue indicator should trigger refresh workflow?",
    ],
  },
  {
    department: "it",
    category: "operational",
    title: "Operational Resilience for Founder AI Stack",
    content:
      "Resilience requires known failure modes and fallback paths. For every critical dependency (Supabase, Shopify, Amazon, Slack, Vercel), define degraded behavior and recovery checks. Keep health probes lightweight and frequent; keep deep checks scheduled and alerting. Use graceful degradation for non-critical features to preserve decision continuity.",
    questions: [
      "Which dependency currently has no tested fallback behavior?",
      "What is the maximum acceptable degraded-mode duration before escalation?",
    ],
  },
  {
    department: "corporate_affairs",
    category: "market_intel",
    title: "External Narrative and Stakeholder Readiness",
    content:
      "Stakeholder trust depends on consistent external narrative across investors, partners, and retail buyers. Maintain one canonical operating truth pack: current metrics, risks, mitigations, and milestones. Avoid mixing projections with actuals. Abra should generate stakeholder briefs using tagged data provenance and confidence levels.",
    questions: [
      "Which stakeholder narrative currently risks overstatement versus actuals?",
      "What risk disclosure should be standardized across investor updates?",
    ],
  },
  {
    department: "executive",
    category: "founder",
    title: "Founder Decision Escalation Matrix",
    content:
      "Autonomy should be staged by reversibility and downside. High-reversibility, low-risk tasks can auto-execute. Medium-risk tasks require proposal plus timeout-based approval. High-risk tasks always require explicit founder approval. Maintain an escalation matrix by action type and expected impact on cash, brand, legal exposure, or supply continuity.",
    questions: [
      "Which action classes should remain permanently human-approved?",
      "What timeout window is acceptable for medium-risk auto-approval?",
    ],
  },
  {
    department: "people",
    category: "culture",
    title: "Operating Culture for Human-AI Collaboration",
    content:
      "Human-AI systems perform best when roles are explicit: AI drafts and prioritizes, humans decide and own final accountability. Define communication standards for recommendations: decision statement, evidence, confidence, risk, and fallback. Encourage concise post-mortems on misses to improve prompts, thresholds, and playbooks.",
    questions: [
      "What review cadence should be used for AI recommendation quality?",
      "What confidence threshold should trigger automatic human review?",
    ],
  },
];

function questionsMarkdown(questions) {
  const byDept = new Map();
  for (const q of questions) {
    if (!byDept.has(q.department)) byDept.set(q.department, []);
    byDept.get(q.department).push(q.text);
  }

  const lines = [
    `# Abra Training Questions (${new Date().toISOString()})`,
    ``,
    `Use this as the founder interview pack to close knowledge gaps before higher autonomy.`,
    ``,
  ];

  for (const [department, entries] of [...byDept.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    lines.push(`## ${department}`);
    for (const q of entries) lines.push(`- [ ] ${q}`);
    lines.push("");
  }

  return lines.join("\n");
}

function buildAnswerTemplate(questions) {
  return {
    generated_at: new Date().toISOString(),
    curriculum_version: CURRICULUM_VERSION,
    instructions:
      "Fill each answer string. Keep answers concrete and operational. Leave unanswered items as empty strings.",
    questions: questions.map((q, idx) => ({
      id: `q${String(idx + 1).padStart(3, "0")}`,
      department: q.department,
      question: q.text,
      answer: "",
    })),
  };
}

async function main() {
  const questionsOnly = argHas("--questions-only");
  const sendSlackFlag = argHas("--send-slack");

  const env = loadRuntimeEnv();
  if (!env.supabaseUrl || !env.supabaseKey) {
    throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!questionsOnly && !env.openaiKey) {
    throw new Error("OPENAI_API_KEY is required for ingest mode");
  }

  const sourcePrefix = `training-${CURRICULUM_VERSION}:`;
  const existingRows = (await sbFetch(
    env.supabaseUrl,
    env.supabaseKey,
    `/rest/v1/open_brain_entries?select=source_ref,title&entry_type=eq.teaching&source_ref=ilike.${encodeURIComponent(`${sourcePrefix}*`)}&limit=5000`,
  )) || [];
  const existingRefs = new Set(
    Array.isArray(existingRows)
      ? existingRows.map((row) => String(row.source_ref || "")).filter(Boolean)
      : [],
  );

  let inserted = 0;
  let skipped = 0;

  if (!questionsOnly) {
    for (const module of MODULES) {
      const sourceRef = `${sourcePrefix}${slugify(module.title)}`;
      if (existingRefs.has(sourceRef)) {
        skipped += 1;
        continue;
      }

      const rawText = module.content;
      const embedding = await getEmbedding(
        env.openaiKey,
        `${module.title}\n${module.content}`,
      );
      await sbFetch(env.supabaseUrl, env.supabaseKey, "/rest/v1/open_brain_entries", {
        method: "POST",
        headers: {
          Prefer: "return=minimal",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_type: "manual",
          source_ref: sourceRef,
          entry_type: "teaching",
          title: module.title,
          raw_text: rawText,
          summary_text: rawText.slice(0, 500),
          category: module.category,
          department: module.department,
          confidence: "high",
          priority: "important",
          processed: true,
          embedding,
        }),
      });
      inserted += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const questions = MODULES.flatMap((module) =>
    module.questions.map((text) => ({
      department: module.department,
      text,
    })),
  );

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const questionPath = path.resolve(
    OUTPUT_DIR,
    `abra-training-questions-${stamp}.md`,
  );
  fs.writeFileSync(questionPath, `${questionsMarkdown(questions)}\n`, "utf8");
  const answerTemplatePath = path.resolve(
    OUTPUT_DIR,
    `abra-training-answers-template-${stamp}.json`,
  );
  fs.writeFileSync(
    answerTemplatePath,
    `${JSON.stringify(buildAnswerTemplate(questions), null, 2)}\n`,
    "utf8",
  );

  const summary =
    `[abra-training] curriculum=${CURRICULUM_VERSION} ` +
    `modules=${MODULES.length} inserted=${inserted} skipped=${skipped} ` +
    `questions=${questions.length}`;
  console.log(summary);
  console.log(`[abra-training] questions file: ${questionPath}`);
  console.log(`[abra-training] answer template: ${answerTemplatePath}`);

  if (sendSlackFlag) {
    const topQuestions = questions.slice(0, 10).map((q) => `• (${q.department}) ${q.text}`);
    const text =
      `🧠 Abra Training Pack ${CURRICULUM_VERSION}\n` +
      `${summary}\n\n` +
      `Top founder questions:\n${topQuestions.join("\n")}\n\n` +
      `Full pack saved in repo output directory.`;
    const sent = await sendSlack(env.slackWebhook, text);
    console.log(`[abra-training] slack_sent=${sent}`);
  }
}

main().catch((error) => {
  console.error("[abra-training] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
