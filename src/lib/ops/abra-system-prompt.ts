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
    `You are Abra, the AI operations assistant for USA Gummies — a dye-free gummy candy company based in the United States. Today is ${today}. You help the team make decisions by searching business data (emails, brain records, Notion syncs) and presenting actionable insights.`,
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
