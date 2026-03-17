/**
 * VIP Sender Registry — shared between email classifier and email drafter.
 *
 * Emails from VIP senders bypass keyword-based classification and get
 * priority routing + rich context for drafting replies.
 *
 * Add team members, key vendors, investors, and critical contacts here.
 */

export type VipSender = {
  /** Display name */
  name: string;
  /** Default email category override */
  category: "production" | "sales" | "finance" | "retail" | "marketplace" | "regulatory" | "customer" | "compliance" | "noise";
  /** Default priority override */
  priority: "critical" | "important" | "informational" | "noise";
  /** Short action hint for the classifier */
  suggestedAction: string;
  /** Relationship to the company — used by the drafter to write appropriate replies */
  relationship: "team" | "vendor" | "investor" | "partner" | "self";
  /**
   * Rich context paragraph injected into the drafting prompt.
   * Tell the drafter who this person is, what they do, and how to talk to them.
   */
  draftingContext: string;
};

/**
 * Domain-based VIP matching — catches all employees at a key vendor/partner domain.
 * Lower priority than exact-email matches. Checked when exact match fails.
 */
export type VipDomain = Omit<VipSender, "name"> & {
  /** Fallback display name when exact contact isn't known */
  orgName: string;
};

export const VIP_DOMAINS: Record<string, VipDomain> = {
  "inderbitzin.com": {
    orgName: "Inderbitzin Distributors",
    category: "sales",
    priority: "critical",
    suggestedAction: "Respond to Inderbitzin — key distributor prospect deciding inventory allocation",
    relationship: "partner",
    draftingContext:
      "Inderbitzin Distributors is a high-priority distribution partner prospect. " +
      "Brent Overman is the key contact. Their inventory allocation decision directly impacts " +
      "our production run planning (50K unit Powers run). Treat ALL emails from this domain as " +
      "critical — they are evaluating whether to carry our product line. Be professional, responsive, " +
      "and proactive. If they ask about inventory: 500 units available in 7 days, 100 in 24 hours.",
  },
  "powersconfections.com": {
    orgName: "Powers Confections (co-packer)",
    category: "production",
    priority: "critical",
    suggestedAction: "Review co-packer communication — active production partner",
    relationship: "vendor",
    draftingContext:
      "Powers Confections in Spokane, WA is our primary co-packer. Bill Turley is the main contact. " +
      "They handle our gummy production runs. Current rate: $0.35/bag tolling. " +
      "Active 50K unit production run in planning. Any communication from Powers affects production " +
      "scheduling and costs. Always confirm details and timelines. Treat as highest-priority vendor.",
  },
  "dutchvalley.com": {
    orgName: "Dutch Valley Food Distributors",
    category: "production",
    priority: "important",
    suggestedAction: "Review Dutch Valley communication — potential tolling/co-packing alternative",
    relationship: "vendor",
    draftingContext:
      "Dutch Valley is being evaluated as a potential co-packing/tolling partner. " +
      "Compare any pricing they offer against Powers Confections' $0.35/bag rate. " +
      "Professional tone. Ask for detailed quotes if they haven't provided one.",
  },
  "albanese.com": {
    orgName: "Albanese Confectionery",
    category: "finance",
    priority: "important",
    suggestedAction: "Review Albanese communication — candy ingredient supplier, check payment status",
    relationship: "vendor",
    draftingContext:
      "Albanese Confectionery is a candy/ingredient supplier (Shana Keefe is a key contact). " +
      "Payment timing matters — coordinate with freight acknowledgments before releasing payment. " +
      "If they're asking about payment, check if Bill (Powers) has confirmed freight receipt first.",
  },
  "pirateship.com": {
    orgName: "Pirate Ship (Shipping)",
    category: "finance",
    priority: "informational",
    suggestedAction: "File for bank reconciliation — shipping receipt",
    relationship: "vendor",
    draftingContext:
      "Pirate Ship is our shipping provider. Their receipts and transaction emails are important " +
      "for bank reconciliation and accounting. Do NOT dismiss as routine noise — flag for Rene/finance team.",
  },
  "seebiz.com": {
    orgName: "SeeBiz Marketplace",
    category: "marketplace",
    priority: "important",
    suggestedAction: "Audit SeeBiz as potential sales channel — evaluate terms and fit",
    relationship: "partner",
    draftingContext:
      "SeeBiz is a B2B wholesale marketplace being evaluated as a new sales channel. " +
      "Any communication should be analyzed for: platform fees, payment terms, audience fit, " +
      "and whether it's worth onboarding. Compare against existing channels (Faire, Amazon, Shopify DTC).",
  },
};

export const VIP_SENDERS: Record<string, VipSender> = {
  "gonz1rene@outlook.com": {
    name: "Rene Gonzalez",
    category: "finance",
    priority: "important",
    suggestedAction: "Respond to Rene — finance team member",
    relationship: "team",
    draftingContext:
      "Rene Gonzalez is USA Gummies' finance person — handles bookkeeping, financial reporting, " +
      "cash management, and accounting. He's an internal team member, not an external contact. " +
      "Write casually and directly, like you're messaging a coworker. No need for formal business tone. " +
      "IMPORTANT: When Rene asks for data (vendor lists, financial reports, transaction history, etc.), " +
      "DO NOT ask him clarifying questions. Use the query_notion_database tool to look up the actual data " +
      "and include it directly in the reply. He expects deliverables, not follow-up questions. " +
      "Key databases: cash_transactions (financials), b2b_prospects (wholesale leads), " +
      "distributor_prospects (distribution partners), repacker_list (co-packers/suppliers), " +
      "inventory (stock levels).",
  },
  "ben@usagummies.com": {
    name: "Ben Stutman",
    category: "noise",
    priority: "informational",
    suggestedAction: "Internal — no action needed",
    relationship: "self",
    draftingContext: "This is Ben's own email — do not draft replies to yourself.",
  },
  "benjamin.stutman@gmail.com": {
    name: "Ben Stutman (personal)",
    category: "noise",
    priority: "informational",
    suggestedAction: "Internal — no action needed",
    relationship: "self",
    draftingContext: "This is Ben's personal email — do not draft replies to yourself.",
  },
  // ---- Key Distributor Contacts ----
  "info@inderbitzin.com": {
    name: "Inderbitzin Distributors",
    category: "sales",
    priority: "critical",
    suggestedAction: "Respond to Inderbitzin — key distributor deciding inventory allocation",
    relationship: "partner",
    draftingContext:
      "Inderbitzin Distributors — general inbox. Brent Overman is the decision-maker. " +
      "Their inventory allocation directly impacts our 50K unit production run at Powers. " +
      "Treat as critical. Available inventory: 500 units in 7 days, 100 in 24 hours.",
  },
  "jennyi@inderbitzin.com": {
    name: "Jenny (Inderbitzin)",
    category: "sales",
    priority: "critical",
    suggestedAction: "Respond to Jenny at Inderbitzin — key distributor contact",
    relationship: "partner",
    draftingContext:
      "Jenny at Inderbitzin Distributors. Brent Overman is the main decision-maker. " +
      "Treat all Inderbitzin emails as high priority — they're evaluating our product line.",
  },
};

/**
 * Look up VIP sender by email address (case-insensitive).
 * Falls back to domain-based matching if no exact match.
 */
export function getVipSender(email: string): VipSender | undefined {
  const normalized = email.toLowerCase().trim();

  // Exact match first
  const exact = VIP_SENDERS[normalized];
  if (exact) return exact;

  // Domain-based fallback
  const domain = normalized.split("@")[1];
  if (domain) {
    const domainMatch = VIP_DOMAINS[domain];
    if (domainMatch) {
      const { orgName, ...rest } = domainMatch;
      return { name: orgName, ...rest };
    }
  }

  return undefined;
}
