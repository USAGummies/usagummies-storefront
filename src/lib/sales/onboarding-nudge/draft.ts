/**
 * Onboarding Stall Nudge email draft composer.
 *
 * Pure function. Generates the {subject, body} for a "saw you got
 * partway through the onboarding form — happy to help" nudge.
 *
 * When this fires:
 *   - Wholesale onboarding flow has a `currentStep` with a `nextStep`
 *   - `daysSinceLastTouch` >= the stall threshold (default 1d, per
 *     OnboardingBlockersSummary.stallHours)
 *   - The flow has a buyer email (caller resolves from prospect data)
 *
 * Tone is "I noticed and I'm here to unblock" — not "fill this out
 * already." Each step gets a tailored hook so the buyer doesn't get
 * a generic "are you still there?" email — the brief saw exactly
 * which step parked, and the nudge addresses that step specifically.
 */
import type { OnboardingStep } from "@/lib/wholesale/onboarding-flow";

export interface OnboardingNudgeDraftInput {
  buyerFirstName?: string;
  /** Display name for subject + signature. */
  displayName: string;
  /** Step the buyer parked on (drives the per-step copy). */
  currentStep: OnboardingStep;
  /** Days since the most-recent step transition. */
  daysSinceLastTouch: number;
  /**
   * Direct link back into the buyer's onboarding flow. Caller MUST
   * supply (`https://www.usagummies.com/onboarding/<dealId>` is the
   * canonical shape).
   */
  onboardingUrl: string;
}

export interface OnboardingNudgeDraft {
  subject: string;
  body: string;
  template: string;
}

const SIGNATURE = [
  "",
  "Best,",
  "",
  "Ben Stutman",
  "USA Gummies",
  "ben@usagummies.com",
  "(307) 209-4928",
].join("\n");

function firstNameOrThere(s?: string): string {
  if (!s) return "there";
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : "there";
}

/**
 * Per-step hook copy. The nudge body composes:
 *   "I saw you got to the {hook}. {unblockOffer} — link to pick up:"
 *
 * Steps map to recognizable buyer-facing language. We never use the
 * internal flow-state names ("ap-info", "qbo-customer-staged") in
 * outbound copy.
 */
function stepHook(step: OnboardingStep): {
  hook: string;
  unblockOffer: string;
} {
  switch (step) {
    case "info":
      return {
        hook: "first basic-info screen",
        unblockOffer:
          "If something on that page is unclear, or you'd just rather give me the details by reply, I can finish setup on my end.",
      };
    case "store-type":
      return {
        hook: "store-type selector",
        unblockOffer:
          "If your store doesn't fit the canned options, just reply with what you carry and I'll set the right tier from my side.",
      };
    case "pricing-shown":
      return {
        hook: "pricing tier review",
        unblockOffer:
          "Happy to walk through the tiers (master carton vs pallet, freight options) on a 5-minute call if that's faster than the form.",
      };
    case "order-type":
      return {
        hook: "case-vs-pallet step",
        unblockOffer:
          "If you're between sizes, just tell me how many bags total and I'll size it cleanly.",
      };
    case "payment-path":
      return {
        hook: "credit card vs invoice (Net 10) choice",
        unblockOffer:
          "Both paths are fine — credit card is fastest for the first order, invoice via AP works the same with a one-time setup form.",
      };
    case "ap-info":
      return {
        hook: "AP info step",
        unblockOffer:
          "If your AP team prefers we send the W-9 and ACH form to a specific email, just reply with that address and I'll forward it directly.",
      };
    case "order-captured":
    case "shipping-info":
      return {
        hook: "shipping address step",
        unblockOffer:
          "Ship-to is the last piece — if there's a different receiving address from the billing one, just reply with it and I'll finish the order from here.",
      };
    case "ap-email-sent":
    case "qbo-customer-staged":
    case "crm-updated":
      return {
        hook: "final review",
        unblockOffer:
          "Looks like you got most of the way through — let me know if you saw anything you'd want to adjust before we finalize.",
      };
  }
}

export function composeOnboardingNudgeDraft(
  input: OnboardingNudgeDraftInput,
): OnboardingNudgeDraft {
  const first = firstNameOrThere(input.buyerFirstName);
  const days = input.daysSinceLastTouch;
  const company =
    input.displayName.split(/[—-]/)[0].trim() || input.displayName;
  const { hook, unblockOffer } = stepHook(input.currentStep);

  const sinceLine =
    days <= 1
      ? "I noticed earlier today"
      : `It's been ${days} days since you started`;

  const body = [
    `Hi ${first},`,
    "",
    `${sinceLine} on the USA Gummies wholesale onboarding form for ${company} — looked like you stopped at the ${hook}. Want to make sure that's a "circle back later" pause and not a "the form was confusing" pause.`,
    "",
    `${unblockOffer}`,
    "",
    `Pick up where you left off:  ${input.onboardingUrl}`,
    "",
    "Or just reply to this email and I'll move it along from my side. No pressure either way.",
    SIGNATURE,
  ].join("\n");

  return {
    subject: `USA Gummies — picking up your onboarding for ${company}`,
    body,
    template: `onboarding-nudge:${input.currentStep}`,
  };
}
