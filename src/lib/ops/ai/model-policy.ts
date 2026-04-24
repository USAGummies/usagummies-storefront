export type OpenAiTaskProfile = "opsChat" | "supportChat" | "marketingDraft";
export type AnthropicTaskProfile =
  | "inboxTriage"
  | "pipelineEnrich"
  | "replyComposer"
  | "researchReview"
  | "driftAudit";

const OPENAI_DEFAULTS: Record<OpenAiTaskProfile, string> = {
  opsChat: "gpt-4o-mini",
  supportChat: "gpt-4o-mini",
  marketingDraft: "gpt-4o-mini",
};

const ANTHROPIC_DEFAULTS: Record<AnthropicTaskProfile, string> = {
  inboxTriage: "claude-sonnet-4-6",
  pipelineEnrich: "claude-sonnet-4-6",
  replyComposer: "claude-sonnet-4-6",
  researchReview: "claude-opus-4-7",
  driftAudit: "claude-sonnet-4-6",
};

const OPENAI_ENV: Partial<Record<OpenAiTaskProfile, string>> = {
  opsChat: "OPENAI_OPS_CHAT_MODEL",
  supportChat: "OPENAI_CHAT_MODEL",
  marketingDraft: "OPENAI_MARKETING_MODEL",
};

const ANTHROPIC_ENV: Partial<Record<AnthropicTaskProfile, string>> = {
  inboxTriage: "ANTHROPIC_INBOX_MODEL",
  pipelineEnrich: "ANTHROPIC_PIPELINE_MODEL",
  replyComposer: "ANTHROPIC_REPLY_MODEL",
  researchReview: "ANTHROPIC_RESEARCH_MODEL",
  driftAudit: "ANTHROPIC_DRIFT_AUDIT_MODEL",
};

export const HARD_RULES_VERSION = "2026-04-24";
export const HARD_RULES_PROMPT = [
  "USA Gummies hard rules:",
  "- USA Gummies sells dye-free gummy candy, not vitamins, supplements, CBD, or medical products.",
  "- Ship-from truth is Ashford, WA. Nashville, WA is unrelated.",
  "- Ben is the owner/founding father; use company number (307) 209-4928 unless Ben explicitly approves personal cell sharing.",
  "- Rene owns finance doctrine. QBO is accounting truth. Never invent financial data, customer status, vendor status, shipment status, pricing, or prior engagement.",
  "- Source systems beat memory. Every money/quantity/status claim needs a source, timestamp, and confidence.",
  "- Customer-facing sends, payment releases, QBO sends/structure changes, and irreversible shipments require the control-plane approval flow.",
  "- Outreach claims must come from contracts/outreach-pitch-spec.md and product-claims.ts.",
].join("\n");

export function resolveOpenAiModel(profile: OpenAiTaskProfile): string {
  const envName = OPENAI_ENV[profile];
  const specific = envName ? process.env[envName] : undefined;
  return specific || process.env.OPENAI_MODEL || OPENAI_DEFAULTS[profile];
}

export function resolveAnthropicModel(profile: AnthropicTaskProfile): string {
  const envName = ANTHROPIC_ENV[profile];
  const specific = envName ? process.env[envName] : undefined;
  return specific || process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULTS[profile];
}

export function isClaudeOpus47(model: string): boolean {
  return /claude-opus-4-7/i.test(model);
}

export function anthropicSamplingParams(
  model: string,
  temperature: number,
): { temperature?: number } {
  // Opus 4.7 rejects non-default sampling params. Omit them entirely.
  if (isClaudeOpus47(model)) return {};
  return { temperature };
}
