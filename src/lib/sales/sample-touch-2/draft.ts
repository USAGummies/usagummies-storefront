/**
 * Sample Touch-2 email draft composer.
 *
 * Pure function. Generates the {subject, body} for a "did the sample
 * arrive — what did the team think?" follow-up.
 *
 * When this fires:
 *   - HubSpot deal is at stage "Sample Shipped"
 *   - Days since stage entry > 7
 *   - No buyer reply detected on the deal timeline
 *
 * Tone is curious + low-pressure — not "are you going to buy yet?".
 * The 4/27 audit caught us pinging buyers with stale generic templates;
 * the touch-2 explicitly avoids that pattern. Buyer either confirms
 * receipt + reaction, or replies "we passed", which the email-intel
 * polite-decline detector then routes to nurture-park (no further
 * outbound from us).
 */

export interface SampleTouch2DraftInput {
  /** Buyer first name. Falls back to "there". */
  buyerFirstName?: string;
  /** Display name (company / prospect) for the subject + signature. */
  displayName: string;
  /** Days since the sample shipped. */
  daysSinceShipped: number;
  /**
   * Optional package size for context. Defaults to "case" (6-bag inner
   * case) since that's the canonical sample shape per shipstation.md §3.5.
   */
  sampleSize?: "case" | "mailer" | "master_carton";
}

export interface SampleTouch2Draft {
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

function sampleNoun(size: SampleTouch2DraftInput["sampleSize"]): string {
  switch (size) {
    case "mailer":
      return "sample mailer";
    case "master_carton":
      return "master carton sample";
    case "case":
    default:
      return "sample case";
  }
}

export function composeSampleTouch2Draft(
  input: SampleTouch2DraftInput,
): SampleTouch2Draft {
  const first = firstNameOrThere(input.buyerFirstName);
  const noun = sampleNoun(input.sampleSize);
  const days = input.daysSinceShipped;

  const company = input.displayName.split(/[—-]/)[0].trim() || input.displayName;

  const body = [
    `Hi ${first},`,
    "",
    `Following up — the ${noun} of All American Gummy Bears we sent should have landed at ${company} a couple weeks back (about ${days} days now). Just wanted to check in:`,
    "",
    "  • Did the box arrive intact?",
    "  • What did the team think?",
    "  • Anything you'd want to see (different SKU, custom case pack, sell-sheet, etc.)?",
    "",
    "If it isn't a fit right now, no worries — just let me know and I'll move you off the active list cleanly. If you want to keep talking, happy to send a quote, jump on a 10-minute call, or send a fresh sell-sheet.",
    SIGNATURE,
  ].join("\n");

  return {
    subject: `USA Gummies — checking in on the sample for ${company}`,
    body,
    template: "sample-touch-2",
  };
}
