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

  // 6. Sample request — but be careful about decline phrases.
  if (SAMPLE_REQUEST_REGEX.test(text) && !SAMPLE_DECLINE_REGEX.test(text)) {
    return {
      category: "sample_request",
      confidence: 0.88,
      reason: "Sample-request keywords without decline phrases",
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
 */
export function classifyEmail(env: EmailEnvelope): Classification {
  const ruleHit = applyRules(env);
  if (ruleHit) return ruleHit;
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
