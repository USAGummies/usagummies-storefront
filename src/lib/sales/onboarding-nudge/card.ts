/**
 * Onboarding Stall Nudge Class B approval card renderer.
 *
 * Same Class B email-reply pattern as reorder-offer + sample-touch-2.
 * Surfaces the flow context (current step, days parked, onboarding URL),
 * buyer email, draft subject + body preview, source citation
 * (the wholesale-onboarding KV flow id).
 */
import type { OnboardingStep } from "@/lib/wholesale/onboarding-flow";

export interface OnboardingNudgeCardInput {
  flowId: string;
  displayName: string;
  buyerEmail: string;
  currentStep: OnboardingStep;
  daysSinceLastTouch: number;
  onboardingUrl: string;
  /** HubSpot deal id when the flow has been linked (cross-link). */
  hubspotDealId?: string;
  subject: string;
  body: string;
  sources?: Array<{ system: string; id?: string; url?: string }>;
}

const PREVIEW_LIMIT = 280;

function escapeBackticks(s: string): string {
  return s.replace(/`/g, "ʹ");
}

function previewBody(body: string): string {
  const collapsed = body.replace(/\n{2,}/g, "\n").trim();
  if (collapsed.length <= PREVIEW_LIMIT) return collapsed;
  return collapsed.slice(0, PREVIEW_LIMIT - 1).trimEnd() + "…";
}

function stepLabel(step: OnboardingStep): string {
  return step.replace(/-/g, " ");
}

export function renderOnboardingNudgeCard(
  input: OnboardingNudgeCardInput,
): string {
  const lines = [
    `:construction: *Onboarding nudge — flow stalled*`,
    `*Buyer:* ${input.displayName} (\`${input.buyerEmail}\`)`,
    `*Flow:* \`${input.flowId}\``,
    `*Parked at step:* \`${stepLabel(input.currentStep)}\` for ${input.daysSinceLastTouch}d`,
    `*Resume URL:* <${input.onboardingUrl}|onboarding/${input.flowId}>`,
  ];
  if (input.hubspotDealId) {
    lines.push(`*HubSpot deal:* \`${input.hubspotDealId}\``);
  }
  lines.push(`*Subject:* ${escapeBackticks(input.subject)}`);
  lines.push("");
  lines.push("*Body preview:*");
  lines.push("```");
  lines.push(previewBody(input.body));
  lines.push("```");

  if (input.sources && input.sources.length > 0) {
    lines.push("");
    lines.push("*Source:*");
    for (const s of input.sources) {
      const ref = s.url
        ? `<${s.url}|${s.id ?? s.system}>`
        : `\`${s.system}${s.id ? `:${s.id}` : ""}\``;
      lines.push(`  • ${ref}`);
    }
  }

  lines.push("");
  lines.push(
    `_Class B \`gmail.send\`. Approve in <#C0ATWJDHS74|ops-approvals> → Gmail draft sends from ben@usagummies.com → HubSpot timeline log on the contact._`,
  );

  return lines.join("\n");
}
