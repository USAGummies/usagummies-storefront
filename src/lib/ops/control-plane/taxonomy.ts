/**
 * Approval taxonomy — §15.3 of the canonical blueprint.
 *
 * Class A — Autonomous            — Observe / Prepare; no approval
 * Class B — Single approval       — Commit with 1 human approver
 * Class C — Dual approval         — high-impact Commit needs 2 approvers
 * Class D — Red-Line / prohibited — never autonomous, manual only
 *
 * Mapping examples are load-bearing: they drive classify() and belong in the
 * canonical contract doc (contracts/approval-taxonomy.md). Edit in lockstep.
 */

import type { ApprovalClass, HumanOwner } from "./types";

export interface ActionSpec {
  /** Action slug: "<system>.<verb>", e.g. "gmail.send", "hubspot.deal.update". */
  slug: string;
  /** Short human-readable name for approval queue display. */
  name: string;
  class: ApprovalClass;
  requiredApprovers?: HumanOwner[];
  /** If true, money/shipping/customer-facing — subject to §6.1 overrides. */
  irreversible: boolean;
  examples: string[];
}

// ---- Class A — Autonomous ----------------------------------------------

export const AUTONOMOUS_ACTIONS: ActionSpec[] = [
  {
    slug: "system.read",
    name: "Read from any system of record",
    class: "A",
    irreversible: false,
    examples: ["hubspot.search", "qbo.query", "shopify.orders.list", "plaid.balance.get"],
  },
  {
    slug: "open-brain.capture",
    name: "Capture observation to Open Brain",
    class: "A",
    irreversible: false,
    examples: ["summarize a Slack decision", "index a retailer research finding"],
  },
  {
    slug: "draft.email",
    name: "Draft an email (no send)",
    class: "A",
    irreversible: false,
    examples: ["Viktor drafts a reply to Jungle Jim's", "Research Librarian drafts weekly digest"],
  },
  {
    slug: "slack.post.audit",
    name: "Post to #ops-audit or division channel (informational)",
    class: "A",
    irreversible: false,
    examples: ["log an agent run result", "post a research finding"],
  },
  {
    slug: "internal.note",
    name: "Write an internal note / Notion comment",
    class: "A",
    irreversible: false,
    examples: ["append to weekly-learning doc", "annotate a HubSpot deal internally"],
  },
  {
    slug: "hubspot.task.create",
    name: "Create a HubSpot task (no stage change)",
    class: "A",
    irreversible: false,
    examples: ["assign follow-up to Ben", "queue Rene review"],
  },
];

// ---- Class B — Single approval -----------------------------------------

export const SINGLE_APPROVAL_ACTIONS: ActionSpec[] = [
  {
    slug: "gmail.send",
    name: "Send outreach email",
    class: "B",
    requiredApprovers: ["Ben"], // commercial sends
    irreversible: true,
    examples: ["Viktor sends to buyer contact", "PR agent sends journalist pitch"],
  },
  {
    slug: "hubspot.deal.stage.move",
    name: "Move a live deal stage",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["New → Qualified", "Sample Shipped → Reorder Cycle"],
  },
  {
    slug: "qbo.invoice.draft",
    name: "Create QBO invoice draft",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["booth order → draft invoice"],
  },
  {
    slug: "qbo.po.draft",
    name: "Create QBO PO draft",
    class: "B",
    requiredApprovers: ["Drew"],
    irreversible: false,
    examples: ["reorder from Powers", "Belmark label run"],
  },
  {
    slug: "shipment.create",
    name: "Create shipment (samples)",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: true,
    examples: ["Drew ships East Coast sample", "fulfillment partner shipment"],
  },
  {
    slug: "content.publish",
    name: "Publish blog / social content",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: true,
    examples: ["MDX blog post", "IG post"],
  },
  // ---- Activation / division lifecycle ----
  // These slugs are registered so the approval flow can accept them. The
  // downstream consequences — flipping `state` in contracts/divisions.json,
  // emitting a division.activate audit action, creating the channel,
  // writing the first-wave agent contract — are deliberately still manual
  // until the first real activation happens. See /contracts/activation-
  // triggers.md §"What this actually automates" for the split.
  {
    slug: "division.activate",
    name: "Activate a latent division",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: [
      "Marketing — Paid (trailing-30d ad spend > $1K)",
      "Customer Experience (tickets > 20/mo sustained)",
    ],
  },
  {
    slug: "division.deactivate",
    name: "Deactivate an active division back to latent",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["Marketing — Paid (spend < $500 for 30d)"],
  },
  {
    slug: "pod.trade-show.activate",
    name: "Activate a per-show Trade Shows pod",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["Sweets & Snacks Expo May 2026", "The Reunion April 2026"],
  },
  {
    slug: "pod.trade-show.deactivate",
    name: "Deactivate a Trade Shows pod after the show ends",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["14-day post-show wind-down"],
  },
];

// ---- Class C — Dual approval -------------------------------------------

export const DUAL_APPROVAL_ACTIONS: ActionSpec[] = [
  {
    slug: "qbo.invoice.send",
    name: "Send an invoice (money request)",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: true,
    examples: ["first whale invoice", "new terms invoice"],
  },
  {
    slug: "payment.release",
    name: "Approve vendor payment / ACH",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: true,
    examples: ["Powers milestone payment", "Belmark invoice payment"],
  },
  {
    slug: "inventory.commit",
    name: "Commit inventory buy",
    class: "C",
    requiredApprovers: ["Ben", "Drew"],
    irreversible: true,
    examples: ["50K-unit reorder", "packaging run"],
  },
  {
    slug: "vendor.financial.commit",
    name: "Major vendor financial commitment",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: true,
    examples: ["new copacker contract", "retainer with agency"],
  },
  {
    slug: "pricing.change",
    name: "Structural pricing change",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: false,
    examples: ["wholesale price tier change", "MSRP change"],
  },
];

// ---- Class D — Red-Line / prohibited -----------------------------------

export const RED_LINE_ACTIONS: ActionSpec[] = [
  {
    slug: "secret.share",
    name: "Share or emit a secret",
    class: "D",
    irreversible: true,
    examples: ["paste API key into Slack or Notion"],
  },
  {
    slug: "data.delete.prod",
    name: "Delete production data",
    class: "D",
    irreversible: true,
    examples: ["DROP TABLE", "delete HubSpot deal permanently"],
  },
  {
    slug: "permissions.modify",
    name: "Modify permissions or sharing",
    class: "D",
    irreversible: true,
    examples: ["change Notion page access", "grant Slack admin", "modify Vercel team"],
  },
  {
    slug: "contract.sign",
    name: "Sign a contract",
    class: "D",
    irreversible: true,
    examples: ["vendor MSA", "retailer terms"],
  },
  {
    slug: "system.destructive",
    name: "Destructive system change",
    class: "D",
    irreversible: true,
    examples: ["drop Supabase schema", "force-push main", "revoke prod API key"],
  },
  {
    slug: "pricing.discount.rule.change",
    name: "Change pricing/discount rules without project approval",
    class: "D",
    irreversible: false,
    examples: ["unapproved new discount code tier"],
  },
];

// ---- Registry + lookup -------------------------------------------------

export const ACTION_REGISTRY: readonly ActionSpec[] = Object.freeze([
  ...AUTONOMOUS_ACTIONS,
  ...SINGLE_APPROVAL_ACTIONS,
  ...DUAL_APPROVAL_ACTIONS,
  ...RED_LINE_ACTIONS,
]);

const BY_SLUG = new Map(ACTION_REGISTRY.map((a) => [a.slug, a]));

/**
 * Classify an action by slug. Returns undefined if the slug isn't registered —
 * callers must treat "unknown action" as a fail-closed condition (do not run).
 */
export function classify(slug: string): ActionSpec | undefined {
  return BY_SLUG.get(slug);
}

export function requiresApproval(spec: ActionSpec): boolean {
  return spec.class === "B" || spec.class === "C";
}

export function isProhibited(spec: ActionSpec): boolean {
  return spec.class === "D";
}
