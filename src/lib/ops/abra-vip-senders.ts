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
      "If he asks for financial data/reports, confirm you'll get it to him and ask about format/deadline " +
      "preferences. He has access to the ops dashboard and company financials.",
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
  // Add more VIPs as the team grows:
  // "vendor@copacker.com": {
  //   name: "Powers Confections",
  //   category: "production",
  //   priority: "important",
  //   suggestedAction: "Review co-packer communication",
  //   relationship: "vendor",
  //   draftingContext: "Powers Confections is our co-packer in Spokane, WA. ...",
  // },
};

/**
 * Look up VIP sender by email address (case-insensitive).
 */
export function getVipSender(email: string): VipSender | undefined {
  return VIP_SENDERS[email.toLowerCase().trim()];
}
