/**
 * Draft generation for the email-intelligence pipeline.
 *
 * For each classified email, produce a plain-text reply body. Strategy
 * by category:
 *
 *   ap_finance + Jungle Jim's        → use the existing AP packet body verbatim
 *   ap_finance + other retailer      → AP packet template stub with [VENDOR_NAME]
 *   sample_request                   → "thanks; what's your shipping address" template
 *   shipping_issue                   → tracking-lookup acknowledgement template
 *   customer_support                 → polite acknowledgement, route to ben@
 *   b2b_sales                        → wholesale-tier intro template
 *   vendor_supply                    → "thanks, will follow up" placeholder
 *   marketing_pr / receipt_document  → no draft (FYI)
 *   junk_fyi                         → no draft
 *
 * Reply tone: matches contracts/outreach-pitch-spec.md — no medical /
 * unverified claims. Falls back to a hard-rule-aligned safe template
 * when category lookup misses.
 *
 * Future: swap deterministic templates for an LLM call (Sonnet) once
 * the OAuth + cost-budget gates are settled. Today is template-only so
 * we hit the P0 deliverable without invoking another LLM.
 */
import type { Classification } from "./classifier";
import { getApPacket } from "@/lib/ops/ap-packets";
import type { EmailEnvelope } from "@/lib/ops/gmail-reader";

export interface DraftReply {
  subject: string;
  body: string;
  /**
   * If `actionable` is false the orchestrator skips creating a draft (e.g.
   * receipts, FYI, junk). Even classified emails sometimes don't need a
   * reply.
   */
  actionable: boolean;
  /**
   * `auto` = the orchestrator can save this as a Gmail draft.
   * `manual` = surface for human composition; no draft created.
   */
  drafting: "auto" | "manual";
  /** Source of the draft body for audit. */
  template: string;
}

function safeReplySubject(env: EmailEnvelope): string {
  const s = (env.subject || "").trim();
  if (!s) return "Re: USA Gummies follow-up";
  if (/^re:/i.test(s)) return s;
  return `Re: ${s}`;
}

function senderFirstName(env: EmailEnvelope): string {
  const m = env.from?.match(/^([^<]+)</);
  if (m) {
    const full = m[1].trim();
    const first = full.split(/[\s,]+/)[0];
    return first || "there";
  }
  return "there";
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

/** Detect Jungle Jim's specifically — they have a prepared packet. */
function isJungleJims(env: EmailEnvelope): boolean {
  const from = (env.from || "").toLowerCase();
  const subject = (env.subject || "").toLowerCase();
  return (
    from.includes("junglejims.com") ||
    subject.includes("jungle jim")
  );
}

export function generateDraftReply(
  env: EmailEnvelope,
  c: Classification,
): DraftReply {
  const subject = safeReplySubject(env);
  const first = senderFirstName(env);

  switch (c.category) {
    case "ap_finance": {
      // Jungle Jim's has a prepared packet — use it verbatim.
      if (isJungleJims(env)) {
        const packet = getApPacket("jungle-jims");
        if (packet) {
          return {
            subject: packet.replyDraft.subject,
            body: `${packet.replyDraft.body}${SIGNATURE}`,
            actionable: true,
            drafting: "auto",
            template: "ap-packet:jungle-jims",
          };
        }
      }
      // Generic retailer AP — template the boilerplate.
      const body = [
        `Hi ${first},`,
        "",
        "Thank you for sending the new account setup forms.",
        "",
        "We're putting together our completed Vendor and Contractor Setup Form, signed W-9, customer information form, and item list for All American Gummy Bears. We'll send the full packet in a follow-up.",
        "",
        "If there's a specific portal you'd like us to upload to instead of email reply, let me know and we'll route it there.",
        SIGNATURE,
      ].join("\n");
      return {
        subject,
        body,
        actionable: true,
        drafting: "auto",
        template: "ap-packet:generic-retailer",
      };
    }

    case "sample_request": {
      // 2026-04-30 incident rewrite — the prior body referenced retired
      // "1-pack / 5-pack / master case" SKU language that doesn't exist
      // in our canonical pricing grid (contracts/outreach-pitch-spec.md
      // §6 + contracts/wholesale-pricing.md §2). Replaced with the
      // current SKU vocabulary: single 7.5 oz bag for a tasting sample,
      // or an inner case (6 bags) for a team review. Master carton +
      // pallet pricing is a separate B2B-sales conversation, not a
      // sample drop.
      const body = [
        `Hi ${first},`,
        "",
        "Thanks for reaching out — happy to send samples your way.",
        "",
        "Could you confirm:",
        "  • Shipping address (incl. attention/recipient name)",
        "  • Best phone number for the carrier",
        "  • How many bags works for your team — a single 7.5 oz bag for tasting, or an inner case (6 bags) for a wider team review",
        "",
        "I'll get those out the same day they're confirmed.",
        SIGNATURE,
      ].join("\n");
      return {
        subject,
        body,
        actionable: true,
        drafting: "auto",
        template: "sample-request",
      };
    }

    case "shipping_issue": {
      const body = [
        `Hi ${first},`,
        "",
        "I'm sorry you ran into an issue with your shipment. I'm pulling the tracking + carrier records now and will reply within the hour with a clear path — replacement, refund, or whatever resolves it cleanly on your end.",
        "",
        "If you can share a photo or the order number when you get a moment, that speeds things up.",
        SIGNATURE,
      ].join("\n");
      return {
        subject,
        body,
        actionable: true,
        drafting: "auto",
        template: "shipping-issue-acknowledgement",
      };
    }

    case "customer_support": {
      const body = [
        `Hi ${first},`,
        "",
        "Thanks for reaching out. I'm going to dig into this and get back to you with a real answer (not a canned one) within a few hours.",
        "",
        "If there's anything time-sensitive — order number, allergen question, anything else — tell me here and I'll prioritize.",
        SIGNATURE,
      ].join("\n");
      return {
        subject,
        body,
        actionable: true,
        drafting: "auto",
        template: "customer-support-acknowledgement",
      };
    }

    case "b2b_sales": {
      // 2026-04-30 incident-driven cleanup — the prior body said
      // "$3.49/bag, $20.94/case (6-pack), 36-bag master carton" which
      // was technically math-correct but used the ambiguous "6-pack"
      // wording that doesn't appear in canonical contracts. Replaced
      // with the canonical inner-case + master-carton vocabulary from
      // contracts/outreach-pitch-spec.md §5 + §6 so buyers don't get
      // confused about what "6-pack" means.
      const body = [
        `Hi ${first},`,
        "",
        "Appreciate the note. Quick context on us:",
        "",
        "  • All American Gummy Bears, 7.5 oz / 213 g, dye-free, made in the USA",
        "  • UPC 1-99284-62470-2",
        "  • Wholesale: $3.49/bag landed master carton (36 bags) · $3.25/bag pallet landed (25 master cartons / 900 bags) · $3.00/bag at 3+ pallet free-shipping tier",
        "  • Lead time: ~5 business days from PO; in-stock master cartons ship in 2–3 business days",
        "",
        "Happy to send a sample pack or jump on a 15-minute call. What's easiest on your end?",
        SIGNATURE,
      ].join("\n");
      return {
        subject,
        body,
        actionable: true,
        drafting: "auto",
        template: "b2b-sales-intro",
      };
    }

    case "vendor_supply": {
      const body = [
        `Hi ${first},`,
        "",
        "Got this — I'll review and reply with anything we need on our side.",
        SIGNATURE,
      ].join("\n");
      return {
        subject,
        body,
        actionable: true,
        drafting: "auto",
        template: "vendor-acknowledgement",
      };
    }

    case "marketing_pr":
    case "receipt_document":
    case "junk_fyi":
      return {
        subject,
        body: "",
        actionable: false,
        drafting: "manual",
        template: "no-reply-needed",
      };
  }
}
