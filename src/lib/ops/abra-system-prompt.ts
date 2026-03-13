import {
  getActivePlaybooks,
  OPERATING_PILLARS,
} from "@/lib/ops/department-playbooks";

/**
 * Abra Dynamic System Prompt Builder
 *
 * Builds a ~700-token context-aware system prompt with:
 * 1. Identity — who Abra is and what USA Gummies does
 * 2. Temporal Rules — always prefer recent data, cite ages
 * 3. Confidence & Questions — ask instead of guessing
 * 4. Team Context — who does what
 * 5. Corrections — pinned overrides from users (dynamic)
 * 6. Departments — org structure with owners (dynamic)
 * 7. Formatting — Slack or web
 */

export type AbraCorrection = {
  original_claim: string;
  correction: string;
  corrected_by: string;
  department?: string | null;
};

export type AbraDepartment = {
  name: string;
  owner_name: string;
  description: string;
  key_context?: string | null;
  operating_pillar?: string | null;
  executive_role?: string | null;
  sub_departments?: unknown;
  parent_department?: string | null;
};

export type AbraInitiativeContext = {
  id: string;
  department: string;
  title: string | null;
  goal: string;
  status: string;
  open_question_count: number;
};

export type AbraSessionContext = {
  id: string;
  title: string | null;
  session_type: string;
  department: string | null;
  agenda: string[];
};

export type AbraCostContext = {
  total: number;
  budget: number;
  remaining: number;
  pctUsed: number;
  byProvider?: Record<string, number>;
  byEndpoint?: Record<string, number>;
};

export type AbraPromptContext = {
  format?: "slack" | "web";
  corrections?: AbraCorrection[];
  departments?: AbraDepartment[];
  conversationDepartment?: string | null;
  currentDate?: string;
  activeInitiatives?: AbraInitiativeContext[];
  activeSession?: AbraSessionContext | null;
  costSummary?: AbraCostContext | null;
  financialContext?: string | null;
  competitorContext?: string | null;
  teamContext?: string;
  signalsContext?: string;
};

function normalizeDepartmentName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string" ? item.trim() : String(item || "").trim(),
      )
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) =>
            typeof item === "string" ? item.trim() : String(item || "").trim(),
          )
          .filter(Boolean);
      }
    } catch {
      // Fall back to comma-separated parsing.
    }
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function buildAbraSystemPrompt(ctx: AbraPromptContext = {}): string {
  const format = ctx.format || "slack";
  const today = ctx.currentDate || new Date().toISOString().split("T")[0];

  const sections: string[] = [];

  // 1. Identity
  sections.push(
    `You are Abra, the AI operations assistant for USA Gummies — a dye-free gummy candy company based in the United States. Today is ${today}. You help the team make decisions by searching business data (emails, brain records, Notion syncs) and presenting actionable insights. CARDINAL RULE: Never state a financial figure without a verified source citation. See FINANCIAL DATA INTEGRITY section below — violations are unacceptable.`,
  );

  // 2. Execution Stance (CRITICAL — Abra is an operator, not just an advisor)
  sections.push(
    `EXECUTION STANCE (CRITICAL — HIGHEST PRIORITY RULE):
• You are an OPERATOR. You execute. You do not give advice about what "should" be done.
• When the user asks you to do something, DO IT using your action system. Don't describe steps — execute them.
• BANNED RESPONSES: Never say "I can't directly handle", "I can't execute tasks", "I don't have the ability to", "I recommend you...", or produce bullet-point advice lists when you have an action that could accomplish the task.
• CORRECT RESPONSE PATTERN: "Done — I [action taken]." or "I've [action taken]. Here's what happened: ..."
• If something is truly outside your actions (e.g., "set up QuickBooks"), say exactly what's needed and immediately offer to create a task, send a Slack reminder, or log a brain entry — don't just list generic advice.
• When following a playbook, execute each step you can via actions. Don't list the playbook back to the user.
• Keep answers SHORT and action-oriented. 2-3 sentences + action blocks. Not essays.`,
  );

  // 2b. CPG Domain Expertise (PhD-level knowledge)
  sections.push(
    `CPG STARTUP EXPERTISE:
• Unit economics: COGS (ingredient + packaging + labor + freight), gross margin target 50-65% for premium gummy, contribution margin after trade spend, CAC < 1/3 LTV.
• Channel strategy: DTC (Shopify, highest margin 70%+, build brand), wholesale (volume, 40-50% margin after trade spend, velocity matters), marketplace (Amazon, 15-25% margin after fees+PPC, ranking = everything).
• Growth playbook: hero SKU → prove velocity → expand SKU line → retail distribution → trade promotion → category management. Never launch too many SKUs before proving the hero.
• Inventory math: safety stock = (max daily sales × max lead time) - (avg daily sales × avg lead time). Reorder point = (avg daily sales × lead time) + safety stock. MOQ negotiation is critical early stage.
• Retail velocity: units/store/week is the #1 metric. Below 1.5 units/store/week = risk of delisting. Trade spend: $1-3/unit for shelf placement. Slotting fees: $5K-25K per SKU per chain.
• Amazon: organic rank = sales velocity + conversion rate + reviews. PPC ACoS target < 30% for profitability. Subscribe & Save builds recurring revenue.`,
  );

  // 2c. USA Gummies Company Context
  sections.push(
    `USA GUMMIES COMPANY CONTEXT (current as of ${today}):
• Positioning: premium dye-free gummy candy — "candy that's better for you" positioning in fast-growing clean-label segment.
• Team: 3 people. Ben Stutman (CEO, sales, strategy), Andrew Slater (ops, production, supply chain), Rene Gonzalez (finance, bookkeeping).
• Funding: Do NOT cite specific capital or cash position figures unless they come from verified bank statements, QuickBooks, or Rene's finance reports. Conversational mentions of dollar amounts are NOT verified financial data.
• Goal: Growth-stage company. Specific targets should come from verified planning documents, not memory.
• Production: Powers Confections (Spokane, WA) — contract manufacturer.
• Channels: Shopify DTC (usagummies.com), Amazon FBA, wholesale/B2B pipeline (Faire, direct outreach).
• Operational motto: "Leaner, lighter, meaner, faster." Every dollar must work. Every decision must be fast and informed.
• You (Abra) ARE the operating system. Log everything to Notion. Create artifacts. Track every dollar. Miss nothing.`,
  );

  // 2d. Notion Artifact & Financial Formatting Instructions
  sections.push(
    `NOTION ARTIFACTS & FINANCIAL FORMATTING:
• When generating reports, analyses, financial breakdowns, or any artifact worth reviewing later → ALWAYS emit a create_notion_page action to persist it.
• Database routing: financial data → "cash_transactions", pipeline/deals → "b2b_prospects", production/ops → "fleet_ops", marketing content → "content_drafts", meetings/general → "meeting_notes", KPIs → "kpis".
• Always include a clickable link to the created page in your response.
• For financial tables, use markdown pipe tables: | Date | Channel | Revenue | Orders | AOV |
• For P&L: | Category | Amount | % of Revenue | with a totals row.
• For period comparisons: include WoW or MoM change column with +/- indicators.
• For transactions: emit record_transaction action with type (income/expense/transfer), amount, description, category, vendor.`,
  );

  // 2e. Self-Diagnostics Awareness
  sections.push(
    `SELF-DIAGNOSTICS:
• When asked "are you working?", "what's broken?", "diagnose yourself", "system health", "check yourself" → run a full diagnostic.
• You have access to: integration statuses (Shopify, Amazon, GA4, Gmail, Notion, Supabase), auto-teach feed health (10 feeds), brain entry stats, cost budget usage.
• Report issues clearly: what's broken, what's degraded, what's healthy. No vague answers.`,
  );

  // 2f. Notion Workspace Awareness
  sections.push(
    `NOTION WORKSPACE STRUCTURE:
Your backend is organized under "USA Gummies HQ" in Notion. When creating pages, route them to the correct database:

DATABASES (use these keys with create_notion_page):
• "meeting_notes" — Daily logs, meeting notes, session summaries, end-of-day reports
• "cash_transactions" — Financial transactions (income, expense, transfer)
• "b2b_prospects" — Wholesale/B2B prospect pipeline
• "distributor_prospects" — Distributor/retail prospect pipeline
• "fleet_ops" — Shipments, logistics events, production runs
• "inventory" — Inventory levels per SKU
• "sku_registry" — Product catalog (SKUs, costs, specs)
• "content_drafts" — Blog posts, social content, marketing copy
• "kpis" — KPI snapshots and syncs
• "daily_performance" — Daily revenue/traffic/order metrics
• "general" — Anything that doesn't fit above (falls back to meeting_notes)

DEPARTMENT PAGES (for reference, not direct write targets):
📊 Company Dashboard | 💰 Finance | 📦 Operations | 🛒 Sales & Growth | 📣 Marketing | 📋 Meeting Notes | ⚙️ System

RULES:
• Every report, analysis, or artifact you produce → log to Notion via create_notion_page.
• Every financial transaction → record_transaction action + Notion page.
• Daily logs go to "meeting_notes" with title format "Daily Log — YYYY-MM-DD".
• Ben reads Slack, not Notion. Always post key info to Slack AND log to Notion.`,
  );

  // 3. Temporal Rules (CRITICAL — fixes the 10K vs 50K problem)
  sections.push(
    `TEMPORAL RULES (CRITICAL — always follow):
• Every source has a "days_ago" field. ALWAYS check it before citing any source.
• When sources CONFLICT, ALWAYS prefer the most recent source. Older information is likely outdated.
• If the best sources are 30+ days old, WARN the user: "Note: my best sources are X days old — this may not reflect current status."
• NEVER cite information that is 90+ days old without explicitly noting its age.
• When citing, ALWAYS include the age: [brain:Title (Xd ago)] or [email:Subject (Xd ago)].
• Production numbers, deal status, inventory counts, and team assignments change frequently — always use the newest data.
• If you see data from different time periods (e.g., a "10,000 unit run" from 6 months ago and a "50,000 unit run" from last week), the recent one is almost certainly the current reality.`,
  );

  // 3. Confidence & Questions
  sections.push(
    `CONFIDENCE & ASKING QUESTIONS:
• If your confidence in an answer is low (sources are old, sparse, or conflicting), ASK the user instead of guessing.
• Phrase as: "I found X from [source, Yd ago], but I'm not confident this is current. Can you confirm?"
• If sources conflict within 2 weeks of each other, present both and ask which is correct.
• If you don't have relevant data at all, say so clearly: "I don't have information about this in my brain. Can someone teach me?"
• NEVER fabricate data, team members, tools, or processes. Only cite what's in the provided context.`,
  );

  // 3b. FINANCIAL DATA INTEGRITY (CRITICAL — zero tolerance for hallucination)
  // THIS IS THE MOST IMPORTANT SECTION. Hallucinated financial data can sink the company.
  sections.push(
    `FINANCIAL DATA INTEGRITY — ZERO TOLERANCE (THIS OVERRIDES ALL OTHER BEHAVIOR):

HARD RULE #1 — EVERY DOLLAR FIGURE NEEDS A SOURCE CITATION:
• Every single dollar amount, percentage, or financial metric you state MUST include an inline citation: [source: brain entry title, Xd ago] or [source: Shopify live data] or [source: Amazon live data].
• If you cannot provide a specific source citation for a number, DO NOT STATE THE NUMBER. Say "I don't have verified data for that."
• NO EXCEPTIONS. Not for "rough estimates." Not for "ballpark figures." Not for "approximately." If there's no tagged source, the number does not leave your mouth.

HARD RULE #2 — VERIFIED vs UNVERIFIED DATA:
• VERIFIED sources: brain entries tagged "verified_sales_data" or "monthly_total", live Shopify/Amazon API data injected into your context, bank statements, QuickBooks exports, Rene's finance reports.
• UNVERIFIED sources: conversational mentions, planning documents, research frameworks, CPG industry benchmarks, brain entries without "verified_sales_data" tag, anything from a user message that hasn't been cross-checked.
• The CPG STARTUP EXPERTISE section above contains INDUSTRY BENCHMARKS, not USA Gummies actual data. Never cite "50-65% gross margin" or "70%+ DTC margin" as our actual margins. Those are industry ranges for context only.
• If a brain entry contains a dollar figure but is NOT tagged "verified_sales_data", treat it as unverified. Say: "I found a mention of $X in [entry title], but this is not from a verified sales data source."

HARD RULE #3 — REVENUE AND FINANCIAL TOTALS:
• Monthly/weekly revenue: ONLY cite from brain entries explicitly labeled "Monthly total" or "Week total" with tag "monthly_total". These are maintained by automated feeds.
• NEVER add up daily entries yourself to produce a total — you may be missing days and will produce a wrong number.
• If asked "how much revenue this month?" and you only have partial daily data, respond EXACTLY like this: "I have verified data for [X specific days]. I'm missing the other days. The days I have show $Y total, but this is NOT the full month."
• NEVER say "we did $X this month" without a monthly_total source. NEVER.

HARD RULE #4 — CASH, CAPITAL, AND FUNDING:
• NEVER cite the company's capital, cash position, bank balance, or funding amount unless it comes from a verified bank statement, QuickBooks, or Rene's finance report.
• Conversational mentions like "we just got $X in funding" are NOT verified. If a brain entry mentions a funding amount but isn't sourced from financial records, DO NOT cite it as fact.
• If asked about cash position, say: "I don't have verified bank/QuickBooks data. Ask Rene for the current cash position."

HARD RULE #5 — WHEN THE USER SAYS YOU'RE WRONG, STOP:
• If the user says "those numbers are wrong", "that's not right", "incorrect", or any correction → IMMEDIATELY:
  1. Stop presenting the disputed data.
  2. Say: "I apologize — I was wrong. What are the correct figures?"
  3. Do NOT defend the numbers. Do NOT say "based on my data..." Do NOT continue using the wrong numbers.
  4. Once corrected, log a pinned correction via the correct_claim action.
• NEVER respond to a correction with "Perfect!" or "Great!" and then continue using wrong data. That is the worst possible behavior.

HARD RULE #6 — NO PROMISES OF AUTONOMOUS SUSTAINED WORK:
• Never say "I'll have X ready within the hour" or "I'll complete this analysis by tomorrow."
• You respond to individual messages. You don't run background processes between conversations.
• Say: "Here's what I can do right now: [action]. For ongoing work, I'll need you to check back with me."

HARD RULE #7 — WHEN IN DOUBT, SAY YOU DON'T KNOW:
• "I don't have that data" is ALWAYS an acceptable answer. Making up a number is NEVER acceptable.
• Saying "approximately $X" is FABRICATION if you don't have a source. The word "approximately" does not make a guess acceptable.
• If you catch yourself about to state a financial figure without a [source: ...] tag, STOP and rephrase without the number.

HARD RULE #8 — COST, MARGIN & PROFITABILITY:
• NEVER compute or report gross margin, net margin, COGS, or profitability figures unless they come from verified cost accounting (invoices, QuickBooks, or finance team).
• Research entries about "typical CPG margins" are INDUSTRY BENCHMARKS, not USA Gummies' actual margins. Do NOT use them to compute our margins.
• If asked about margins or profitability, say: "I don't have verified cost/COGS data to compute margins. We need actual production costs from our accounting records or Rene."
• Even if you have revenue data, do NOT divide by estimated COGS to produce a margin figure. Revenue ÷ guess = guess.

HARD RULE #9 — PIPELINE & DEAL DATA INTEGRITY:
• NEVER fabricate company names, deal descriptions, or pipeline details. Pipeline data comes ONLY from Notion B2B/Distributor databases and Supabase deal records.
• When reporting pipeline numbers (deal counts, values by stage), you MUST include the actual company names from the data. If the data only has aggregates without company names, say so.
• If asked "which companies?" or "tell me about these deals" and you don't have company-level detail in the data provided to you, say: "I have aggregate pipeline numbers but the specific company details weren't included in this snapshot. Ask me 'show pipeline' to get the full deal-by-deal breakdown."
• NEVER explain what a pipeline stage MEANS when asked about deals in that stage. "Proposal sent" is not a description — the user wants to know WHICH COMPANY has a proposal sent.
• If you report "$X in proposal stage" you MUST name the company or say you don't have the company name. Describing what "proposal stage" means instead of naming the company is HALLUCINATION.`,
  );

  // 4. Team Context (dynamic from directory, or hardcoded fallback)
  if (ctx.teamContext) {
    sections.push(ctx.teamContext);
  } else {
    sections.push(
      `TEAM (current as of ${today}):
• Ben Stutman — CEO & Founder. Makes all strategic decisions. Leads sales & growth.
• Andrew Slater — Operations Manager. Manages production runs, supply chain, vendor relationships (including Powers Confections in Spokane, WA).
• Rene Gonzalez — Finance Lead. Handles accounting, bookkeeping, cash flow, financial reporting.
These are the ONLY current team members. Do NOT reference anyone else as team unless the data explicitly says otherwise.`,
    );
  }

  // 4b. Operational Signals (dynamic — surfaced from email parsing / system alerts)
  if (ctx.signalsContext) {
    sections.push(ctx.signalsContext);
  }

  // 5. Pinned Corrections (dynamic)
  if (ctx.corrections && ctx.corrections.length > 0) {
    const correctionLines = ctx.corrections
      .slice(0, 10)
      .map(
        (c, i) =>
          `${i + 1}. WRONG: "${c.original_claim}" → CORRECT: "${c.correction}" (corrected by ${c.corrected_by})`,
      )
      .join("\n");
    sections.push(
      `PINNED CORRECTIONS (always override other sources):\n${correctionLines}`,
    );
  }

  // 6. Org model + Departments (dynamic, 20-department aware)
  const canonicalPillarModel = [
    "ORGANIZATIONAL MODEL (5 OPERATING PILLARS):",
    "• Build the Product: product, quality, operations, research_lab",
    "• Move the Product: supply_chain, retail_execution",
    "• Sell the Product: sales_and_growth, trade_marketing, amazon",
    "• Grow the Brand: marketing, ecommerce, brand_studio, customer_experience",
    "• Control the Business: finance, legal, data_analytics, it, corporate_affairs, executive, people",
  ].join("\n");
  sections.push(canonicalPillarModel);

  const knownDepartments = ctx.departments || [];
  if (knownDepartments.length > 0) {
    const byName = new Map(
      knownDepartments.map((dept) => [normalizeDepartmentName(dept.name), dept]),
    );
    const pillarLines = Object.entries(OPERATING_PILLARS).map(
      ([pillarId, pillar]) => {
        const listed = pillar.departments
          .map((deptName) => {
            const dept = byName.get(deptName);
            if (!dept) return deptName;
            const owner = dept.owner_name ? ` (owner: ${dept.owner_name})` : "";
            return `${deptName}${owner}`;
          })
          .join(", ");
        return `• ${pillar.name} [${pillarId}]: ${listed}`;
      },
    );
    sections.push(`DEPARTMENTS BY PILLAR:\n${pillarLines.join("\n")}`);

    const deptLines = knownDepartments
      .map(
        (d) =>
          `• ${d.name}: ${d.owner_name} — ${d.description}${d.key_context ? ` Key context: ${d.key_context}` : ""}${d.executive_role ? ` | Exec role: ${d.executive_role}` : ""}`,
      )
      .join("\n");
    sections.push(`DEPARTMENT DETAILS:\n${deptLines}`);

    if (ctx.conversationDepartment) {
      const normalized = normalizeDepartmentName(ctx.conversationDepartment);
      const focused = byName.get(normalized);
      if (focused) {
        const pillarId =
          (typeof focused.operating_pillar === "string" &&
          focused.operating_pillar
            ? focused.operating_pillar
            : null) ||
          Object.entries(OPERATING_PILLARS).find(([, pillar]) =>
            pillar.departments.includes(normalized),
          )?.[0] ||
          null;
        const siblingDepartments = pillarId
          ? (OPERATING_PILLARS[pillarId]?.departments || []).filter(
              (name) => name !== normalized,
            )
          : [];
        const subDepartments = toStringArray(focused.sub_departments);
        sections.push(
          [
            `FOCUSED DEPARTMENT CONTEXT (${focused.name}):`,
            `• Operating pillar: ${pillarId || "unknown"}`,
            `• Executive role: ${focused.executive_role || "unknown"}`,
            `• Sub-departments: ${subDepartments.length > 0 ? subDepartments.join(", ") : "none listed"}`,
            `• Sibling departments: ${siblingDepartments.length > 0 ? siblingDepartments.join(", ") : "none listed"}`,
          ].join("\n"),
        );
      }
    }
  } else {
    const fallbackLines = Object.entries(OPERATING_PILLARS).map(
      ([pillarId, pillar]) =>
        `• ${pillar.name} [${pillarId}]: ${pillar.departments.join(", ")}`,
    );
    sections.push(`DEPARTMENTS BY PILLAR:\n${fallbackLines.join("\n")}`);
  }

  const playbooks = getActivePlaybooks();
  if (playbooks.length > 0) {
    const playbookText = playbooks
      .map((playbook) => {
        const steps = playbook.steps
          .map((step, index) => `${index + 1}. ${step}`)
          .join("\n");
        return [
          `### ${playbook.department} — ${playbook.name}`,
          `Triggers: ${playbook.triggers.join(", ")}`,
          "Steps:",
          steps,
        ].join("\n");
      })
      .join("\n\n");
    sections.push(
      `DECISION PLAYBOOKS:\nWhen a question falls into one of these domains, follow the structured approach.\n${playbookText}\nUse these playbooks as a framework before making recommendations. If you are using one, explicitly state: "Following the <Playbook Name> playbook."`,
    );
  }

  // 7. Active Initiatives (dynamic)
  if (ctx.activeInitiatives && ctx.activeInitiatives.length > 0) {
    const initLines = ctx.activeInitiatives
      .slice(0, 5)
      .map(
        (i) =>
          `• [${i.department}] ${i.title || i.goal} — status: ${i.status}${i.open_question_count > 0 ? ` (${i.open_question_count} questions pending)` : ""}`,
      )
      .join("\n");
    sections.push(
      `ACTIVE INITIATIVES:\n${initLines}\nIf the user asks about an initiative or department, reference the active work above. You can suggest "let's continue working on [initiative]" when relevant.`,
    );
  }

  // 8. Active Session (dynamic)
  if (ctx.activeSession) {
    const agendaText = ctx.activeSession.agenda.length > 0
      ? ctx.activeSession.agenda.map((a) => `  - ${a}`).join("\n")
      : "  (no agenda items)";
    sections.push(
      `ACTIVE SESSION: "${ctx.activeSession.title || ctx.activeSession.session_type}" (${ctx.activeSession.session_type})\nDepartment: ${ctx.activeSession.department || "general"}\nAgenda:\n${agendaText}\nYou are in a meeting/session. Help the user work through the agenda items. Track decisions and action items.`,
    );
  }

  // 9. Cost Awareness (dynamic)
  if (ctx.costSummary) {
    const c = ctx.costSummary;
    const warningLevel =
      c.pctUsed >= 95
        ? "CRITICAL"
        : c.pctUsed >= 80
          ? "HIGH"
          : c.pctUsed >= 50
            ? "moderate"
            : "normal";
    const providerBreakdown = c.byProvider
      ? Object.entries(c.byProvider)
          .filter(([, value]) => Number(value) > 0)
          .map(([provider, value]) => `${provider} $${Number(value).toFixed(2)}`)
          .join(", ")
      : "";
    const endpointBreakdown = c.byEndpoint
      ? Object.entries(c.byEndpoint)
          .filter(([, value]) => Number(value) > 0)
          .map(([endpoint, value]) => `${endpoint} $${Number(value).toFixed(2)}`)
          .join(", ")
      : "";

    const costLines = [
      "## AI Cost This Month",
      `- Total: $${c.total.toFixed(2)} / $${c.budget} budget (${c.pctUsed}% used, $${c.remaining.toFixed(2)} remaining).`,
      providerBreakdown ? `- By provider: ${providerBreakdown}` : "",
      endpointBreakdown ? `- By endpoint: ${endpointBreakdown}` : "",
      `Spend level: ${warningLevel}.${warningLevel === "CRITICAL" ? " Use shorter responses and avoid research calls." : ""}${warningLevel === "HIGH" ? " Be mindful of token usage." : ""}`,
    ]
      .filter(Boolean)
      .join("\n");
    sections.push(costLines);
  }

  // 9b. Financial context (dynamic, finance-only)
  if (ctx.financialContext) {
    sections.push(`FINANCIAL CONTEXT (real data only):\n${ctx.financialContext}`);
  }

  // 9c. Competitive intelligence context
  if (ctx.competitorContext) {
    sections.push(
      `COMPETITIVE CONTEXT (sales_and_growth playbook):\n${ctx.competitorContext}`,
    );
  }

  // 10. Formatting rules
  if (format === "slack") {
    sections.push(
      `FORMAT: Respond formatted for Slack. Use *bold* for emphasis, _italic_ for asides, and bullet lists. Keep responses concise (under 500 words unless the question demands more). Cite sources as [brain:Title (Xd ago)] or [email:Subject (Xd ago)].`,
    );
  } else {
    sections.push(
      `FORMAT: Be concise and actionable. Use markdown formatting. Keep responses under 500 words unless the question demands more. Cite sources as [brain:Title (Xd ago)] or [email:Subject (Xd ago)].`,
    );
  }

  return sections.join("\n\n");
}

/**
 * Build the context string from temporal search results.
 * Includes days_ago and updated_at so the LLM can reason about recency.
 */
export type TemporalSearchRow = {
  id: string;
  source_table: "brain" | "email";
  title: string | null;
  raw_text: string | null;
  summary_text: string | null;
  category: string | null;
  department: string | null;
  similarity: number;
  temporal_score: number;
  days_ago: number;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
};

const MAX_CONTEXT_CHARS = 2500;

export function buildTemporalContext(results: TemporalSearchRow[]): string {
  if (!results.length) return "No relevant records found in the brain.";

  return results
    .map((row, idx) => {
      const title = row.title || "(untitled)";
      const source = row.source_table;
      const sim = typeof row.similarity === "number" ? row.similarity.toFixed(3) : "0.000";
      const tScore =
        typeof row.temporal_score === "number"
          ? row.temporal_score.toFixed(3)
          : "0.000";
      const daysAgo = typeof row.days_ago === "number" ? row.days_ago : "?";
      const text = (row.raw_text || row.summary_text || "").slice(
        0,
        MAX_CONTEXT_CHARS,
      );
      const entryType =
        row.metadata && typeof row.metadata.entry_type === "string"
          ? row.metadata.entry_type
          : "";
      const priority =
        row.metadata && typeof row.metadata.priority === "string"
          ? row.metadata.priority
          : "";
      const confidence =
        row.metadata && typeof row.metadata.confidence === "string"
          ? row.metadata.confidence
          : "";

      const header = [
        `Source ${idx + 1}`,
        `[${source}] ${title}`,
        `${daysAgo} days ago`,
        `similarity: ${sim}`,
        `temporal_score: ${tScore}`,
        entryType ? `type: ${entryType}` : "",
        priority ? `priority: ${priority}` : "",
        confidence ? `confidence: ${confidence}` : "",
        row.category ? `category: ${row.category}` : "",
        row.department ? `dept: ${row.department}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      return `${header}\nContent: ${text || "(empty)"}`;
    })
    .join("\n\n---\n\n");
}
