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
 *
 * Version 1.2 — 2026-04-20. See contracts/approval-taxonomy.md §Version history.
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

  // ---- v1.2 additions (Class A) ----
  {
    slug: "booke.categorize.suggest",
    name: "Booke auto-commits categorization at >= 0.95 confidence",
    class: "A",
    irreversible: false,
    examples: ["Stripe payout categorized to 400015.10 DTC - Retail at 0.98", "T-Mobile bill to 610085"],
  },
  {
    slug: "qbo.invoice.partial-payment.apply",
    name: "Apply a partial payment to an existing QBO invoice",
    class: "A",
    irreversible: false,
    examples: ["retailer sent $300 on a $628 invoice; apply and leave $328 open"],
  },
  {
    slug: "invoice.dispute.flag",
    name: "Flag an invoice as disputed (notation only)",
    class: "A",
    irreversible: false,
    examples: ["retailer contests line item; freeze AR aging escalation for 30 days"],
  },
  {
    slug: "research.post.tagged",
    name: "Post tagged [R-1]..[R-7] research update to #research",
    class: "A",
    irreversible: false,
    examples: ["[R-3] Smart Sweets launched 6-pack at $9.99", "[R-5] FDA Red-3 state extension update"],
  },
  {
    slug: "brief.publish",
    name: "Publish daily or EOD executive brief to #ops-daily",
    class: "A",
    irreversible: false,
    examples: ["weekday 8am morning brief", "weekday 5pm EOD wrap"],
  },
  {
    slug: "audit.sample.score",
    name: "Drift-audit runner scores a sampled agent output",
    class: "A",
    irreversible: false,
    examples: ["Sunday 8pm PT drift audit scorecard entry"],
  },
  {
    slug: "coi.expiry-alert",
    name: "Post 30-day-pre-expiry alert for a supplier COI",
    class: "A",
    irreversible: false,
    examples: ["Albanese COI expires 2026-05-25; email renewal request"],
  },
  {
    slug: "connector.health.post",
    name: "Daily connector-health smoke-test post",
    class: "A",
    irreversible: false,
    examples: ["HubSpot 200, QBO 200, Plaid 200, Shopify 200, ShipStation 200 — all green"],
  },
  {
    slug: "shipment.tracking-push",
    name: "Push carrier tracking back to CRM / Shopify / customer channel",
    class: "A",
    irreversible: false,
    examples: ["USPS 9405... pushed to HubSpot deal + Shopify order"],
  },
  {
    slug: "lead.enrichment.write",
    name: "Fill HubSpot contact/company fields from Apollo with provenance",
    class: "A",
    irreversible: false,
    examples: ["enrich new contact with title, company size, industry from Apollo@0.82"],
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
    requiredApprovers: ["Ben"],
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
    // Class A variant for low-cost single-case sample shipments. When
    // the dispatch classifier resolves to packaging=case + cartons=1
    // (i.e. a 6-bag inner case in a 7×7×7 box, ~3.4 lb) AND there's no
    // high-value flag (HubSpot whale, large-deal warning), the proposal
    // is autonomous: no approval card, just an audit envelope + direct
    // ShipStation order creation. Caps the noise in #ops-approvals
    // (~70% of current volume is single-case sample dispatches).
    //
    // Predicate: see qualifiesForUnderCapAutoExecute() in
    // src/lib/ops/sample-order-dispatch.ts. Wiring into the dispatch
    // route is in a follow-up commit (this entry registers the slug
    // so the predicate + audit envelope can land in advance).
    slug: "shipment.create.under-cap",
    name: "Create shipment (samples, under-cap auto-execute)",
    class: "A",
    requiredApprovers: [],
    irreversible: true,
    examples: [
      "Single 6-bag case sample to a non-whale buyer",
      "Reunion-show follow-up sample case (Ashford → buyer)",
    ],
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

  // ---- v1.2 additions (Class B) — finance ----
  {
    slug: "booke.categorize.edit",
    name: "Edit a Booke categorization suggestion (< 0.95 confidence)",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["Booke proposes 610085 at 0.82; Rene confirms or reclass"],
  },
  {
    slug: "qbo.class.create",
    name: "Create a new QBO Class (secondary channel tag per CF-09)",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["Meta Ads Q2 campaign", "The Reunion April 2026 per-show Class"],
  },
  {
    slug: "qbo.class.modify",
    name: "Modify an existing QBO Class",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["rename a class", "merge two sub-classes"],
  },
  {
    slug: "qbo.location.create",
    name: "Create a new QBO Location",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["Ashford WA", "East Coast (Drew)"],
  },
  {
    slug: "qbo.location.modify",
    name: "Modify an existing QBO Location",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["rename East Coast to include city", "deactivate an obsolete location"],
  },
  {
    slug: "qbo.credit-memo.create",
    name: "Create a QBO credit memo against an existing invoice",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["retailer over-billed $50 on invoice 1517; credit memo for $50"],
  },
  {
    slug: "qbo.invoice.void",
    name: "Void a QBO invoice (pre-send correction)",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["wrong SKU on draft invoice 1534 → void, re-issue"],
  },
  {
    slug: "qbo.bill.create",
    name: "Create a QBO bill from vendor invoice intake",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["Powers invoice EM031626 → bill with class Production + location Ashford WA"],
  },
  {
    slug: "qbo.bill.approve-for-payment",
    name: "Mark a QBO bill approved for the next payment run",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["Approve Belmark bill for Thursday AP batch"],
  },
  {
    slug: "vendor.master.create",
    name: "Create a new vendor master record (QBO + Notion + Drive)",
    class: "B",
    requiredApprovers: ["Rene"], // Drew may originate supply-vendors; Rene approves
    irreversible: false,
    examples: ["Snow Leopard Ventures LLC onboarded as vendor"],
  },
  {
    slug: "invoice.write-off.draft",
    name: "Draft a bad-debt write-off on an overdue invoice (< threshold)",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["< $250 invoice 90d past due with 3 attempts; Rene-only write-off"],
  },
  {
    slug: "ar.hold.set",
    name: "Set AR-hold flag on a customer/company (blocks new orders)",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["Glacier 15d past due on invoice 1412; block Shopify B2B + Faire until paid"],
  },
  {
    slug: "ar.hold.clear",
    name: "Clear the AR-hold flag on a customer/company",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: ["payment received; unblock orders"],
  },
  {
    slug: "legal.doc.expiry-override",
    name: "Short-term override of an expired COI/W-9/etc.",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["Albanese COI expired 3 days; accept delivery while renewal in flight"],
  },
  {
    slug: "shipstation.rule.modify",
    name: "Change a ShipStation automation rule (carrier, origin, preset)",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["add new tag routing for 6-pack SKU", "swap default carrier on WA orders"],
  },
  {
    slug: "approved-claims.add",
    name: "Add a new claim to the Approved Claims list",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["add 'gluten-free (lab tested < 20 ppm)' after lab result received"],
  },
  {
    slug: "approved-claims.retire",
    name: "Retire a claim from the Approved Claims list",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["remove 'kosher' after certification lapses"],
  },
  {
    slug: "faire-direct.invite",
    name: "Send a Faire Direct invite email to an existing retailer/lead",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: true,
    examples: ["invite Moccasin Mountain Art to Faire Direct (0% commission)"],
  },
  {
    slug: "faire-direct.follow-up",
    name: "Send a follow-up email to a retailer who already received a Faire Direct invite",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: true,
    examples: [
      "Whole Foods PNW invite went out 8 days ago with no reply — send a manual follow-up",
    ],
  },
  {
    slug: "account.tier-upgrade.propose",
    name: "Propose a retailer tier upgrade (follow-up pricing.change C if material)",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["Inderbitzin Default → A-tier after 3 clean on-time payments"],
  },
  {
    slug: "retailer.onboard.company-create",
    name: "Create Shopify B2B company + HubSpot company + QBO customer in one pass",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: false,
    examples: ["First-order retailer onboarding: create in all 3 systems with correct tier"],
  },
  {
    slug: "claim.counsel-review.request",
    name: "Send a proposed claim to Wyoming Attorneys for counsel review",
    class: "B",
    requiredApprovers: ["Ben"],
    irreversible: true, // external comm to counsel
    examples: ["'supports immunity' claim review before publish"],
  },

  // ---- v1.3 additions (Class B) — Phase 9 receipt review ----
  {
    slug: "receipt.review.promote",
    name: "Acknowledge a captured receipt + OCR suggestion as Rene-reviewed",
    class: "B",
    requiredApprovers: ["Rene"],
    irreversible: false,
    examples: [
      "Belmark $250 receipt with OCR suggestion + canonical category 'supplies' → Rene reviews and approves the in-repo packet (no QBO write)",
      "Albanese receipt with eligible canonical fields → packet transitions draft → rene-approved (separate qbo.bill.create runs later)",
    ],
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
    requiredApprovers: ["Ben", "Rene"],
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

  // ---- v1.2 additions (Class C) ----
  {
    slug: "invoice.write-off.execute",
    name: "Execute a bad-debt write-off (above Rene-only threshold)",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: true,
    examples: [">= $250 invoice write-off after collections path exhausted"],
  },
  {
    slug: "payment.batch.release",
    name: "Release the weekly AP payment batch (multiple bills in one batch)",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: true,
    examples: ["Thursday AP run: 12 bills, $18.5K total"],
  },
  {
    slug: "credit-limit.expand",
    name: "Expand a retailer's credit limit above the tier default",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: false,
    examples: ["Inderbitzin $10K → $25K after 6 months of clean payment"],
  },
  {
    slug: "qbo.period.close.final",
    name: "Final monthly period close lock",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: true,
    examples: ["Close April 2026 books on May 10 by day-10 commitment"],
  },
  {
    slug: "ad.spend.launch",
    name: "Launch a paid-media campaign with budget > $500 per campaign",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: false,
    examples: ["Meta campaign $1500/month spring promotion"],
  },
  {
    slug: "run.plan.commit",
    name: "Commit a production run with Powers (cash impact + lot)",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: true,
    examples: ["50K-unit Q3 run committed with Powers + Albanese + Belmark"],
  },
  {
    slug: "inventory.adjustment.large",
    name: "Cycle-count adjustment > 50 units (materially affects inventory asset)",
    class: "C",
    requiredApprovers: ["Ben", "Rene"],
    irreversible: false,
    examples: ["SKU variance 65 units short after monthly count"],
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

  // ---- v1.2 additions (Class D) ----
  {
    slug: "qbo.chart-of-accounts.modify",
    name: "Modify the QBO Chart of Accounts (add/remove/rename accounts)",
    class: "D",
    irreversible: true,
    examples: ["CoA is Rene policy; no agent may touch; Rene edits manually in QBO UI"],
  },
  {
    slug: "qbo.investor-transfer.recategorize",
    name: "Recategorize a Rene-investor transfer to anything other than Loan from Owner",
    class: "D",
    irreversible: true,
    examples: ["CLAUDE.md: any transfer from Rene G. Gonzalez or Rene G. Gonzalez Trust = liability, never income"],
  },
  {
    slug: "qbo.journal-entry.autonomous",
    name: "Post an autonomous journal entry (JE) in QBO",
    class: "D",
    irreversible: true,
    examples: ["Agents never post JEs; Rene posts manually after review"],
  },
  {
    slug: "qbo.period.close.reopen",
    name: "Reopen a closed QBO accounting period",
    class: "D",
    irreversible: true,
    examples: ["Reopening April close after May books started; policy event requiring Rene + Ben + audit trail"],
  },
  {
    slug: "ad.claim.publish-unreviewed",
    name: "Publish an ad creative without claims review against the Approved Claims list",
    class: "D",
    irreversible: true,
    examples: ["Meta ad with new body copy bypassing marketing-QA specialist"],
  },
  {
    slug: "customer.data.export-external",
    name: "Export customer data to an external (non-canonical) system",
    class: "D",
    irreversible: true,
    examples: ["bulk export of HubSpot contacts to an unapproved third-party tool"],
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
