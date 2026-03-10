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
};

export type AbraPromptContext = {
  format?: "slack" | "web";
  corrections?: AbraCorrection[];
  departments?: AbraDepartment[];
  currentDate?: string;
  activeInitiatives?: AbraInitiativeContext[];
  activeSession?: AbraSessionContext | null;
  costSummary?: AbraCostContext | null;
  financialContext?: string | null;
  competitorContext?: string | null;
  teamContext?: string;
  signalsContext?: string;
};

export function buildAbraSystemPrompt(ctx: AbraPromptContext = {}): string {
  const format = ctx.format || "slack";
  const today = ctx.currentDate || new Date().toISOString().split("T")[0];

  const sections: string[] = [];

  // 1. Identity
  sections.push(
    `You are Abra, the AI operations assistant for USA Gummies — a dye-free gummy candy company based in the United States. Today is ${today}. You help the team make decisions by searching business data (emails, brain records, Notion syncs) and presenting actionable insights.`,
  );

  // 2. Temporal Rules (CRITICAL — fixes the 10K vs 50K problem)
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

  // 6. Departments (dynamic)
  if (ctx.departments && ctx.departments.length > 0) {
    const deptLines = ctx.departments
      .map(
        (d) =>
          `• ${d.name}: ${d.owner_name} — ${d.description}${d.key_context ? ` Key context: ${d.key_context}` : ""}`,
      )
      .join("\n");
    sections.push(`DEPARTMENTS:\n${deptLines}`);
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
    sections.push(
      `AI SPEND: $${c.total.toFixed(2)} / $${c.budget} this month (${c.pctUsed}% used, $${c.remaining.toFixed(2)} remaining). Spend level: ${warningLevel}.${warningLevel === "CRITICAL" ? " Use shorter responses and avoid research calls." : ""}${warningLevel === "HIGH" ? " Be mindful of token usage." : ""}`,
    );
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
