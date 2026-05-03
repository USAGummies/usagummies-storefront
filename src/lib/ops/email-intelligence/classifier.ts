/**
 * Email classifier — deterministic rules first, LLM fallback only when ambiguous.
 *
 * Categories (per the P0 spec):
 *   - customer_support      — DTC buyer asking about order/product/issue
 *   - b2b_sales             — wholesale buyer / retailer / distributor inquiry
 *   - ap_finance            — vendor/retailer AP setup, W-9, ACH, invoice questions
 *   - vendor_supply         — supplier (Powers, Belmark, Albanese, Inderbitzin) updates
 *   - sample_request        — explicit "send me a sample" intent
 *   - shipping_issue        — lost / late / damaged / wrong / refund-on-shipment
 *   - receipt_document      — invoice/receipt/PO PDF arriving from a service or supplier
 *   - marketing_pr          — press, podcast, listing, newsletter, partnership pitches
 *   - junk_fyi              — automated newsletters, marketing, fluff, internal cc
 *
 * Each classification carries a confidence (0.0–1.0). Rule hits are 0.85–0.95.
 * LLM fallback returns whatever the model says (capped at 0.75 to encode "less
 * certain than a rule"). The orchestrator decides whether to draft a reply or
 * surface for review based on confidence + category.
 */
import type { EmailEnvelope } from "@/lib/ops/gmail-reader";

export type EmailCategory =
  | "customer_support"
  | "b2b_sales"
  | "ap_finance"
  | "vendor_supply"
  | "sample_request"
  | "shipping_issue"
  | "receipt_document"
  | "marketing_pr"
  | "junk_fyi";

export type Classification = {
  category: EmailCategory;
  confidence: number;
  reason: string;
  /** Identifier for the rule that fired. `llm` if no rule hit. */
  ruleId: string;
};

// Domain-based rules (highest precedence — sender domain is the cleanest signal).
const VENDOR_DOMAINS = [
  "powersconfections.com",
  "powerscandy.com",
  "belmarkinc.com",
  "belmark.com",
  "albanese.com",
  "albaneseconfectionery.com",
  "inderbitzin.com",
];

const FINANCE_TOOL_DOMAINS = [
  "stamps.com",
  "shipstation.com",
  "intuit.com",
  "qbo.intuit.com",
  "quickbooks.com",
  "plaid.com",
  "bankofamerica.com",
];

const PR_PRESS_DOMAINS = [
  "buzzsprout.com",
  "anchor.fm",
  "spotify.com",
  "apple.com",
  "muckrack.com",
  "prnewswire.com",
];

// Subject-line keywords — cheap regex sweep.
const SAMPLE_REQUEST_REGEX = /\b(samples?|trial pack|product samples|send.*sample)\b/i;
const SHIPPING_ISSUE_REGEX =
  /\b(damaged|broken|melted|leak|lost|missing|never (?:arrived|received|delivered)|late|delayed|wrong (?:item|order|address)|tracking|stolen|porch pirate)\b/i;
const RECEIPT_DOC_REGEX =
  /\b(receipt|invoice|statement|po-?\d+|payment confirmation|order confirmation #?\d+|here is your invoice)\b/i;
const AP_FINANCE_REGEX =
  /\b(W-?9|ACH|wire instruction|new account setup|vendor (?:setup|onboarding|application)|payment terms|net ?\d+|tax form|EIN|remit ?to|accounts payable|AP department)\b/i;
const SAMPLE_DECLINE_REGEX = /\b(no thanks|not interested|unsubscribe|no longer)\b/i;
// 2026-05-03 incident set — AREA15 auto-responder + Kevin Albert "pass" +
// John Schirano "we will not be able to add them" all triggered draft
// replies that were embarrassing to send. These two regexes catch the
// pattern at classifier time and route to junk_fyi so no draft fires.
const AUTO_RESPONDER_SUBJECT_REGEX =
  /^(?:auto[\s-]*reply|automatic reply|out[\s-]*of[\s-]*office|away from (?:my |the )?(?:desk|office)|delivery (?:status|failure)|undeliverable)/i;
const AUTO_RESPONDER_BODY_REGEX =
  /\b(?:i('m| am) (?:out of (?:the )?office|away|on (?:vacation|holiday|leave|maternity|paternity|sabbatical|pto))|automatic(?:ally)? (?:reply|response|generated)|automated (?:reply|response)|currently (?:out of (?:the )?office|away)|will (?:return|be back) on|out of (?:the |my )?office until|this is an unmonitored|no(?:-|\s)?reply (?:inbox|address))\b/i;
const POLITE_DECLINE_REGEX =
  /\b(?:no current need|will pass(?: on this| at this time)?|going to pass|not (?:a fit|right for us)(?: right now| at this time)?|we'?ll reach out (?:if|when)|appreciate (?:the |your )?(?:offer|sample|outreach|note) but|won'?t be (?:moving forward|adding|carrying|moving (?:on|ahead)) (?:with|on) (?:this|it)?|(?:isn'?t|is not) the right (?:fit|time)|(?:not|no) (?:looking|interested) (?:right now|at this time|currently)|we (?:already )?(?:have|carry|stock) a (?:similar|comparable)|(?:we|i) (?:will|going to) pass|(?:no|not a) (?:fit|good fit) (?:for us|right now|at this time)|will not be able to add them)\b/i;
// Categories where a wrong reply is worse than no reply (we'd rather
// silence than spam a real buyer with an off-base draft). Used by the
// confidence-floor guard at the bottom of classifyEmail.
const ACTIONABLE_CATEGORIES: EmailCategory[] = [
  "b2b_sales",
  "shipping_issue",
  "sample_request",
  "customer_support",
];
// 2026-04-30 incident: Eric Miller's "samples arrived, actively reviewing" reply
// matched SAMPLE_REQUEST_REGEX on the bare word "samples" and triggered a stale
// outbound template. This regex is the AFTER-FACT exclusion: phrases that mean
// the buyer ALREADY HAS the samples (or is mid-review) so a "happy to send
// samples" reply is wrong and looks broken.
//
// Phrases tested against real-world replies:
//   "samples arrived" / "samples received" / "got the samples"
//   "package arrived" / "received the box" / "received your shipment"
//   "we received" / "we got" / "they got here"
//   "actively reviewing" / "in review" / "team is reviewing" / "currently reviewing"
//   "still tasting" / "trying them out" / "sharing with the team"
const SAMPLE_RECEIVED_REGEX =
  /\b(samples? (?:arrived|received|are here|came in|landed|delivered)|received the samples?|got the samples?|we received|we got|received your shipment|received the (?:package|box)|(?:actively|currently|still) (?:reviewing|tasting|trying)|(?:team|crew) (?:is|are) reviewing|in review|trying them out|sharing with the team)\b/i;
const JUNK_NEWSLETTER_REGEX =
  /\b(newsletter|digest|daily roundup|weekly update|industry news|promotional|advertisement|don'?t miss|deal of the (?:day|week))\b/i;
const B2B_SALES_REGEX =
  /\b(wholesale|distributor|retailer|stock(?:ing)?|carry your|interested in (?:carrying|stocking)|buyer|placement|category manager|line review|store)\b/i;
const SUPPORT_REGEX =
  /\b(question about|where is my|order #?\d+|refund|return|allergen|ingredient|dietary|customer service)\b/i;

function emailHasDomain(addrField: string, domains: string[]): string | null {
  const lower = (addrField || "").toLowerCase();
  for (const d of domains) {
    if (lower.includes(d)) return d;
  }
  return null;
}

/** Apply deterministic rules. Returns null if no rule fires. */
function applyRules(env: EmailEnvelope): Classification | null {
  const subject = (env.subject || "").trim();
  const from = (env.from || "").toLowerCase();
  const snippet = (env.snippet || "").trim();
  const text = `${subject}\n${snippet}`;

  // 0. Auto-responder / out-of-office / no-reply bounce. Catches AREA15-
  //    style "Automatic reply: ..." subjects, vacation responders, and
  //    "this is an unmonitored inbox" templates. These should never get
  //    an outbound draft — the recipient is a robot or a placeholder.
  if (
    AUTO_RESPONDER_SUBJECT_REGEX.test(subject) ||
    AUTO_RESPONDER_BODY_REGEX.test(text)
  ) {
    return {
      category: "junk_fyi",
      confidence: 0.95,
      reason:
        "Auto-responder / out-of-office / no-reply pattern — no draft fires",
      ruleId: "auto-responder",
    };
  }

  // 0b. Polite decline. Buyer is closing the door for now: "no current
  //     need", "we'll pass", "not a fit right now". Log to timeline as
  //     nurture-park; do NOT generate a re-pitch draft. This is the
  //     class that hit Kevin Albert (Ollie's), John Schirano (Yellowstone),
  //     and the "polite hi sample arrived but we're not buying" pattern.
  if (POLITE_DECLINE_REGEX.test(text)) {
    return {
      category: "junk_fyi",
      confidence: 0.92,
      reason:
        "Polite-decline phrase — buyer not pursuing; nurture-park (no auto-reply)",
      ruleId: "polite-decline",
    };
  }

  // 1. Sender-domain rules — cleanest signal.
  const vendorHit = emailHasDomain(from, VENDOR_DOMAINS);
  if (vendorHit) {
    return {
      category: "vendor_supply",
      confidence: 0.92,
      reason: `Sender domain matches known supplier (${vendorHit})`,
      ruleId: "vendor-domain",
    };
  }
  const financeHit = emailHasDomain(from, FINANCE_TOOL_DOMAINS);
  if (financeHit) {
    return {
      category: "receipt_document",
      confidence: 0.9,
      reason: `Sender is a finance/billing tool (${financeHit})`,
      ruleId: "finance-tool-domain",
    };
  }
  const prHit = emailHasDomain(from, PR_PRESS_DOMAINS);
  if (prHit) {
    return {
      category: "marketing_pr",
      confidence: 0.85,
      reason: `Sender is press/podcast/media (${prHit})`,
      ruleId: "press-domain",
    };
  }

  // 2. Newsletter / mass-marketing — usually has noreply / no-reply / marketing in from.
  if (/no-?reply@|notifications?@|marketing@|newsletter@/i.test(from)) {
    if (JUNK_NEWSLETTER_REGEX.test(text)) {
      return {
        category: "junk_fyi",
        confidence: 0.88,
        reason: "Automated mass-mail sender + newsletter content keywords",
        ruleId: "noreply-newsletter",
      };
    }
    return {
      category: "junk_fyi",
      confidence: 0.8,
      reason: "Automated/no-reply sender",
      ruleId: "noreply-sender",
    };
  }

  // 3. AP / finance setup keywords (subject + body).
  if (AP_FINANCE_REGEX.test(text)) {
    return {
      category: "ap_finance",
      confidence: 0.9,
      reason: "AP/finance keywords (W-9, ACH, vendor setup, payment terms)",
      ruleId: "ap-finance-keywords",
    };
  }

  // 4. Receipt / invoice doc.
  if (RECEIPT_DOC_REGEX.test(text)) {
    return {
      category: "receipt_document",
      confidence: 0.85,
      reason: "Receipt/invoice keywords in subject or body",
      ruleId: "receipt-keywords",
    };
  }

  // 5. Shipping issues.
  if (SHIPPING_ISSUE_REGEX.test(text)) {
    return {
      category: "shipping_issue",
      confidence: 0.88,
      reason: "Shipping-issue keywords (damaged, lost, late, tracking, etc.)",
      ruleId: "shipping-issue-keywords",
    };
  }

  // 6. Sample request — guarded by TWO exclusion regexes:
  //   • SAMPLE_DECLINE_REGEX  — buyer is declining ("no thanks", "unsubscribe")
  //   • SAMPLE_RECEIVED_REGEX — buyer ALREADY received samples and is reviewing.
  //                             Added 2026-04-30 after the Eric Miller incident:
  //                             "samples arrived, actively reviewing" was
  //                             classifying as `sample_request` and firing a
  //                             "happy to send samples" template. The classifier
  //                             must not generate a sample-offer draft when the
  //                             buyer's reply means the samples are already in
  //                             their hands.
  if (
    SAMPLE_REQUEST_REGEX.test(text) &&
    !SAMPLE_DECLINE_REGEX.test(text) &&
    !SAMPLE_RECEIVED_REGEX.test(text)
  ) {
    return {
      category: "sample_request",
      confidence: 0.88,
      reason: "Sample-request keywords without decline or 'already received' phrases",
      ruleId: "sample-request",
    };
  }

  // 7. B2B sales — retailer/distributor/buyer keywords.
  if (B2B_SALES_REGEX.test(text)) {
    return {
      category: "b2b_sales",
      confidence: 0.85,
      reason: "B2B/wholesale keywords (retailer, distributor, buyer, etc.)",
      ruleId: "b2b-keywords",
    };
  }

  // 8. Customer support — generic order/product question.
  if (SUPPORT_REGEX.test(text)) {
    return {
      category: "customer_support",
      confidence: 0.8,
      reason: "Customer-support keywords (order #, refund, allergen, etc.)",
      ruleId: "support-keywords",
    };
  }

  return null;
}

/**
 * Classify an email. Returns the rule-based result if any rule matched;
 * otherwise returns a low-confidence "junk_fyi" placeholder so the
 * orchestrator can decide whether to invoke the LLM fallback.
 *
 * Confidence floor: any rule hit with `confidence < 0.7` on an
 * actionable category (b2b_sales / shipping_issue / sample_request /
 * customer_support) is downgraded to junk_fyi with the original ruleId
 * preserved as `<ruleId>-low-conf`. Rationale: a wrong outbound reply
 * is worse than no reply — the existing rule set hits 0.85+, but this
 * guard kicks in for the LLM fallback path when added.
 */
export function classifyEmail(env: EmailEnvelope): Classification {
  const ruleHit = applyRules(env);
  if (ruleHit) {
    if (
      ruleHit.confidence < 0.7 &&
      ACTIONABLE_CATEGORIES.includes(ruleHit.category)
    ) {
      return {
        category: "junk_fyi",
        confidence: ruleHit.confidence,
        reason: `Low-confidence (${ruleHit.confidence.toFixed(2)}) on '${ruleHit.category}' — flagged for human review, no draft`,
        ruleId: `${ruleHit.ruleId}-low-conf`,
      };
    }
    return ruleHit;
  }
  return {
    category: "junk_fyi",
    confidence: 0.3,
    reason: "No rule matched — defaulting to FYI; consider LLM fallback if confidence-gated",
    ruleId: "default",
  };
}

/**
 * Should the LLM fallback be invoked for this classification?
 * Threshold: confidence < 0.7 AND category is not already known-junk.
 */
export function shouldUseLlmFallback(c: Classification): boolean {
  if (c.confidence >= 0.7) return false;
  // Don't burn an LLM call on a confident-junk default.
  if (c.ruleId === "noreply-newsletter") return false;
  return true;
}
