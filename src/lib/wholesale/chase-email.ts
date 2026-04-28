/**
 * Chase email projection — Phase 35.f.7
 *
 * Pure helper that turns an `OnboardingState` into a draft outreach
 * email Rene can use to chase a stalled wholesale prospect. Built
 * to plug into:
 *
 *   1. The daily digest route (Phase 35.f.5.b) — include the
 *      suggested subject + first-line preview per stalled flow so
 *      Rene can copy-paste from Slack.
 *   2. A future `/api/ops/wholesale/onboarding/chase-email-draft`
 *      route — creates a Gmail draft (Class A — drafts only, never
 *      auto-sends; Rene reviews + sends from Gmail).
 *   3. The `/ops/wholesale/onboarding` page — show "preview chase
 *      email" hover/click per stalled row.
 *
 * **Pure** — no I/O. Deterministic given the same state +
 * stallContext input. Phrasing is conservative: warm, not
 * pressurey; reminds the customer where they left off + offers
 * concrete next-step links.
 *
 * **Step-aware copy** — the body adapts to which step the flow is
 * stalled at, so a "still picking pricing tier" prospect gets
 * different copy than a "AP packet pending" prospect.
 *
 * **No fabrication** — if `state.prospect` is missing, returns
 * null rather than synthesize a placeholder name.
 */
import { TIER_DISPLAY } from "./pricing-tiers";
import type {
  OnboardingState,
  OnboardingStep,
} from "./onboarding-flow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChaseContext {
  /** How long has the flow been stalled? Used to adjust the
   *  warmth/urgency of the copy (gentle nudge at 24h vs more
   *  direct at 72h+). */
  hoursSinceLastTouch: number;
  /** Where the customer can pick back up. Built from flowId. */
  resumeUrl: string;
}

export interface ChaseEmailDraft {
  /** Suggested subject line. */
  subject: string;
  /** Plain-text body. Newline-delimited paragraphs. */
  plainText: string;
  /** Recipient email — convenience (state.prospect.contactEmail). */
  to: string;
  /** Customer name for greeting. */
  greetingName: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a draft chase email for a stalled onboarding flow.
 * Returns null when state.prospect is missing — we never fabricate
 * a recipient.
 *
 * Subject + body adapt to the stalled step. Body always:
 *   1. Greets by first name
 *   2. Names the company on file (audit confidence)
 *   3. Restates where they left off
 *   4. Provides a concrete next-step link
 *   5. Offers a human contact (Rene) for questions
 *   6. Signs off as USA Gummies (no sender persona — Rene fills
 *      in his own signature in Gmail when he sends)
 */
export function buildChaseEmail(
  state: OnboardingState,
  ctx: ChaseContext,
): ChaseEmailDraft | null {
  if (!state.prospect) return null;
  const { contactName, companyName, contactEmail } = state.prospect;
  if (!contactEmail) return null;

  const greetingName = contactName.split(/\s+/)[0] || contactName;
  const stallHours = Math.max(0, Math.round(ctx.hoursSinceLastTouch));
  const subject = subjectForStep(state.currentStep, companyName, stallHours);
  const plainText = bodyForStep(state, ctx, greetingName);

  return {
    subject,
    plainText,
    to: contactEmail,
    greetingName,
  };
}

// ---------------------------------------------------------------------------
// Subject lines per step
// ---------------------------------------------------------------------------

function subjectForStep(
  step: OnboardingStep,
  companyName: string,
  stallHours: number,
): string {
  // 24-72h: gentle. 72h+: more direct, references the saved progress
  // so the customer knows we have their info on hand.
  const directional = stallHours >= 72 ? "Quick check-in" : "Following up";
  switch (step) {
    case "info":
    case "store-type":
    case "pricing-shown":
      return `${directional} — your USA Gummies wholesale inquiry (${companyName})`;
    case "order-type":
      return `${directional} — sizing your USA Gummies order (${companyName})`;
    case "payment-path":
    case "ap-info":
      return `${directional} — finishing your USA Gummies order setup (${companyName})`;
    case "shipping-info":
      return `${directional} — shipping address for your USA Gummies order (${companyName})`;
    case "order-captured":
    case "ap-email-sent":
    case "qbo-customer-staged":
    case "crm-updated":
      return `${directional} — your USA Gummies order (${companyName})`;
  }
}

// ---------------------------------------------------------------------------
// Body content per step
// ---------------------------------------------------------------------------

function bodyForStep(
  state: OnboardingState,
  ctx: ChaseContext,
  firstName: string,
): string {
  const restate = restateForStep(state);
  const nextAction = nextActionForStep(state, ctx.resumeUrl);
  const lines: string[] = [];

  lines.push(`Hi ${firstName},`);
  lines.push("");
  lines.push(
    `I wanted to circle back on your USA Gummies wholesale order — looks like you started the flow${state.prospect?.companyName ? ` for ${state.prospect.companyName}` : ""} but didn't finish.`,
  );

  if (restate) {
    lines.push("");
    lines.push(restate);
  }

  lines.push("");
  lines.push(nextAction);

  lines.push("");
  lines.push(
    "If anything's blocking you (terms, timing, a question on the master-carton vs pallet math), reply here and I'll loop in our finance lead Rene to sort it out same-day.",
  );

  lines.push("");
  lines.push("Thanks,");
  lines.push("USA Gummies wholesale team");

  return lines.join("\n");
}

function restateForStep(state: OnboardingState): string | null {
  switch (state.currentStep) {
    case "info":
      return null;
    case "store-type":
      return `We have your contact on file — just need to know what kind of store/business you're ordering for to send the right pricing.`;
    case "pricing-shown":
      return `We sent over our wholesale pricing (B2-B5 tiers). Take a look when you have a minute — happy to walk through the math if it'd help.`;
    case "order-type":
      return `You were picking which size order — our master carton is 36 bags ($3.49/bag landed) or a full pallet at 432 bags ($3.25/bag landed). Volume tiers + buyer-pays-freight options also available.`;
    case "payment-path": {
      const linesBlurb = orderLinesBlurb(state);
      return linesBlurb
        ? `We have your order saved (${linesBlurb}). The next step is choosing whether to pay by credit card (ships next business day) or set up Net terms with our AP team.`
        : `The next step is choosing whether to pay by credit card (ships next business day) or set up Net terms with our AP team.`;
    }
    case "ap-info":
      return `You picked AP/Net terms — we just need an email for your accounting team so we can send the W-9, payment instructions, and line-item breakdown.`;
    case "shipping-info":
      return `Almost done — we just need the shipping address so we can quote landed freight.`;
    case "order-captured":
    case "ap-email-sent":
      return `Your order is captured on our side. We're waiting on AP onboarding to finalize before Rene generates your invoice.`;
    case "qbo-customer-staged":
      return `Your order is captured. Rene's reviewing your customer record in our accounting system before generating the invoice.`;
    case "crm-updated":
      return null;
  }
}

function nextActionForStep(
  state: OnboardingState,
  resumeUrl: string,
): string {
  switch (state.currentStep) {
    case "info":
      return `Pick up where you left off here: ${resumeUrl}`;
    case "store-type":
    case "pricing-shown":
    case "order-type":
    case "payment-path":
    case "ap-info":
    case "shipping-info":
      return `Pick up where you left off here: ${resumeUrl}`;
    case "order-captured":
    case "ap-email-sent":
    case "qbo-customer-staged":
      return `If your AP team needs anything from us, just reply with their email and we'll send the packet over.`;
    case "crm-updated":
      return `Order is fully captured — let me know if anything needs adjusting before we ship.`;
  }
}

function orderLinesBlurb(state: OnboardingState): string {
  if (state.orderLines.length === 0) return "";
  if (state.orderLines.length === 1) {
    const l = state.orderLines[0];
    return `${l.unitCount} ${unitNoun(l.tier, l.unitCount)} of ${TIER_DISPLAY[l.tier]} — ${l.bags} bags`;
  }
  // Multi-line: total bags + dollar count
  const totalBags = state.orderLines.reduce((acc, l) => acc + l.bags, 0);
  const totalUsd = state.orderLines.reduce(
    (acc, l) => acc + l.subtotalUsd,
    0,
  );
  return `${totalBags} bags across ${state.orderLines.length} line items — $${totalUsd.toFixed(2)} subtotal`;
}

function unitNoun(
  tier: OnboardingState["orderLines"][number]["tier"],
  count: number,
): string {
  const plural = count !== 1;
  switch (tier) {
    case "B1":
      return plural ? "cases" : "case";
    case "B2":
    case "B3":
      return plural ? "master cartons" : "master carton";
    case "B4":
    case "B5":
      return plural ? "pallets" : "pallet";
  }
}

// ---------------------------------------------------------------------------
// Test helpers — NOT exported from a barrel
// ---------------------------------------------------------------------------

export const __INTERNAL = {
  subjectForStep,
  bodyForStep,
  restateForStep,
  nextActionForStep,
  orderLinesBlurb,
};
