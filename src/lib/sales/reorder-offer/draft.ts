/**
 * Reorder offer email draft composer.
 *
 * Pure function. Generates the {subject, body} for a Class B
 * reorder-offer card. Channel-aware so the copy matches what makes
 * sense for that buyer:
 *
 *   shopify-dtc  → "haven't seen you in 90 days, here's 15% off your
 *                   next order" with a discount code
 *   amazon-fbm   → No outbound email path (Amazon ToS — buyer contact
 *                   only via Amazon's buyer-seller messaging). Caller
 *                   should NOT route Amazon candidates through this
 *                   composer; surface in brief only.
 *   wholesale    → "checking in — last order was 90 days ago, want
 *                   to set up a reorder?" — soft re-engagement, no
 *                   discount code (wholesale doesn't use DTC codes)
 *
 * No medical / unverified claims (per outreach-pitch-spec.md). Tone
 * matches the rest of Ben's outreach voice.
 */
import type { ReorderChannel } from "../reorder-followup";

export interface ReorderOfferDraftInput {
  channel: ReorderChannel;
  /** Buyer first name for greeting. Falls back to "there" if absent. */
  buyerFirstName?: string;
  /** Display name for the brief / card label. */
  displayName: string;
  /** Days since last order. */
  daysSinceLastOrder: number;
  /**
   * Optional discount code (DTC only). Caller resolves the active code
   * via Shopify discounts API or a hardcoded promo. We don't generate
   * codes here.
   */
  discountCode?: string;
  /**
   * Optional discount percent (DTC only). Defaults to 15 when
   * discountCode is supplied without an explicit percent.
   */
  discountPct?: number;
}

export interface ReorderOfferDraft {
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

export function composeReorderOfferDraft(
  input: ReorderOfferDraftInput,
): ReorderOfferDraft {
  const first = firstNameOrThere(input.buyerFirstName);
  const days = input.daysSinceLastOrder;

  if (input.channel === "shopify-dtc") {
    const pct = input.discountPct ?? (input.discountCode ? 15 : 0);
    const codeBlock =
      input.discountCode && pct > 0
        ? [
            "",
            `Use code *${input.discountCode}* at checkout for ${pct}% off your next order. Good for 14 days.`,
            "Shop: https://www.usagummies.com/shop",
            "",
          ]
        : [
            "",
            "Shop: https://www.usagummies.com/shop",
            "",
          ];
    const body = [
      `Hi ${first},`,
      "",
      `It's been about ${days} days since your last order — we wanted to check in.`,
      "",
      "Our All American Gummy Bears are dye-free, made in the USA, and (a lot of customers tell us) better the second time around.",
      ...codeBlock,
      "Let us know if there's anything we can do — happy to put together a multi-bag bundle if that's easier.",
      SIGNATURE,
    ].join("\n");
    return {
      subject: "USA Gummies — quick check-in (and 15% off if you'd like a refill)",
      body,
      template: "reorder-offer:shopify-dtc",
    };
  }

  if (input.channel === "wholesale") {
    const body = [
      `Hi ${first},`,
      "",
      `It's been about ${days} days since your last USA Gummies order. Just checking in — wanted to make sure you're stocked up heading into ${seasonHint(new Date())}.`,
      "",
      "If you'd like to set up a reorder, the same wholesale pricing is in place. Happy to send a fresh sell-sheet, jump on a 10-minute call, or just turn around a quote if you tell me cases.",
      "",
      "If we're not the right fit anymore, no problem at all — just let me know and I'll move you off the active list.",
      SIGNATURE,
    ].join("\n");
    return {
      subject: `USA Gummies — checking in on a reorder for ${input.displayName.split("/")[0].trim()}`,
      body,
      template: "reorder-offer:wholesale",
    };
  }

  // amazon-fbm — defensive fallback. Composer doesn't route this
  // channel; surface in brief only.
  const body = [
    `Hi ${first},`,
    "",
    `It's been ${days} days since your last Amazon order. Reorder anytime: https://www.amazon.com/dp/B0FFD2D29G`,
    SIGNATURE,
  ].join("\n");
  return {
    subject: "USA Gummies — quick reorder reminder",
    body,
    template: "reorder-offer:amazon-fbm-defensive",
  };
}

function seasonHint(d: Date): string {
  const m = d.getMonth();
  if (m >= 2 && m <= 4) return "summer";
  if (m >= 5 && m <= 7) return "back-to-school";
  if (m >= 8 && m <= 10) return "holiday";
  return "Q1";
}
