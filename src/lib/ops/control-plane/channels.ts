/**
 * Slack channel registry — 9 active, 5 latent. §14.5 + §15.2 of the blueprint.
 *
 * Single source of truth for the channel map is contracts/channels.json.
 * This module re-expresses that data as a typed registry for the runtime.
 */

import type { Channel, ChannelId } from "./types";

const CHANNELS: readonly Channel[] = Object.freeze([
  // --- Active (day-one) ------------------------------------------------
  {
    id: "ops-daily",
    name: "#ops-daily",
    slackChannelId: "C0ATWJDKLTU",
    state: "active",
    owningDivision: "executive-control",
    divisions: ["executive-control"],
    purpose: "Daily control-tower brief and executive rollup",
    allowedContent: [
      "morning brief",
      "end-of-day summary",
      "major decisions",
      "company-wide priorities",
    ],
    notAllowed: ["raw firehose alerts", "long discussions", "duplicate status posts"],
  },
  {
    id: "ops-approvals",
    name: "#ops-approvals",
    slackChannelId: "C0ATWJDHS74",
    state: "active",
    owningDivision: "executive-control",
    divisions: ["executive-control"],
    purpose: "Human approval gate for all Class B and Class C actions",
    allowedContent: [
      "structured approve/reject requests",
      "rationale attached to requests",
      "final disposition line per request",
    ],
    notAllowed: ["open-ended brainstorming", "unactionable summaries"],
  },
  {
    id: "ops-audit",
    name: "#ops-audit",
    slackChannelId: "C0AUQSA66TS",
    state: "active",
    owningDivision: "executive-control",
    divisions: ["executive-control", "platform-data-automation"],
    purpose: "Permanent audit trail of agent writes and policy events",
    allowedContent: [
      "agent write logs",
      "drift audit results",
      "policy violations",
      "postmortems",
    ],
    notAllowed: ["general chat", "approvals", "duplicate alerts"],
  },
  {
    id: "ops-alerts",
    name: "#ops-alerts",
    slackChannelId: "C0ATUGGUZL6",
    state: "active",
    owningDivision: "platform-data-automation",
    divisions: ["executive-control", "platform-data-automation"],
    purpose: "System health and incident firehose",
    allowedContent: [
      "connector failures",
      "degraded mode declarations",
      "run failures",
      "threshold breaches",
    ],
    notAllowed: ["normal operating updates", "celebration posts"],
  },
  {
    id: "sales",
    name: "#sales",
    slackChannelId: "C0AQQRXUYF7",
    state: "active",
    owningDivision: "sales",
    divisions: ["sales"],
    purpose: "Revenue execution across B2B, DTC, and Amazon",
    allowedContent: [
      "deal threads",
      "outreach drafts awaiting approval",
      "retailer/distributor movement",
      "Amazon/DTC revenue issues",
    ],
    notAllowed: ["finance approvals", "ops chatter not tied to revenue"],
  },
  {
    id: "finance",
    name: "#finance",
    slackChannelId: "C0ATF50QQ1M",
    state: "active",
    owningDivision: "financials",
    divisions: ["financials"],
    purpose: "Cash, accounting, reconciliation",
    allowedContent: [
      "AP/AR",
      "invoices",
      "bills",
      "reconciliations",
      "exceptions",
      "finance approvals",
    ],
    notAllowed: ["sales chatter", "vendor chatter without financial consequence"],
  },
  {
    id: "operations",
    name: "#operations",
    slackChannelId: "C0AR75M63Q9",
    state: "active",
    owningDivision: "production-supply-chain",
    divisions: ["production-supply-chain"],
    purpose: "Production, supply, samples, shipping",
    allowedContent: [
      "POs",
      "vendors",
      "freight",
      "inventory",
      "samples",
      "production blockers",
    ],
    notAllowed: ["marketing work", "finance-only debate"],
  },
  {
    // Phase 27 — distinct from "operations" (a workflow registry
    // concept): `#shipping` is the live Slack channel where every
    // label PDF + packing slip lands per the v1.0 SHIPPING PROTOCOL
    // Ben pinned 2026-04-10. Single source of truth for buys /
    // tracking / reprints. The auto-ship pipeline targets THIS
    // channel; `slackChannelId` is the canonical Slack `Cxxx` ID
    // required by `files.completeUploadExternal`.
    id: "shipping",
    name: "#shipping",
    slackChannelId: "C0AS4635HFG",
    state: "active",
    owningDivision: "production-supply-chain",
    divisions: ["production-supply-chain"],
    purpose: "Shipping labels, tracking, packing slips — auto-ship output",
    allowedContent: [
      "label PDFs (4×6 thermal)",
      "packing slip PDFs (4×6 thermal)",
      "tracking numbers",
      "ship-from + carrier selection",
      "void / refund label coordination",
    ],
    notAllowed: [
      "marketing chatter",
      "finance debate",
      "DMs of labels (channel is single source of truth)",
    ],
  },
  {
    id: "research",
    name: "#research",
    slackChannelId: "C08HWA9SRP1",
    state: "active",
    owningDivision: "research-intelligence",
    divisions: ["research-intelligence"],
    purpose: "Research synthesis and intelligence routing",
    allowedContent: [
      "findings tagged [R-1] through [R-7]",
      "weekly Research Librarian synthesis",
      "action-worthy intelligence",
    ],
    notAllowed: ["unstructured link dumps without synthesis"],
  },
  {
    id: "receipts-capture",
    name: "#receipts-capture",
    slackChannelId: "C0APYNE9E73",
    state: "active",
    owningDivision: "financials",
    divisions: ["financials"],
    purpose: "Receipt intake",
    allowedContent: ["receipt images/files", "required metadata"],
    notAllowed: ["anything unrelated to receipt capture"],
  },
  // --- Latent (created on division activation) -------------------------
  {
    id: "marketing",
    name: "#marketing",
    slackChannelId: "C08J9EER9L5",
    state: "active",
    owningDivision: "marketing-brand",
    divisions: ["marketing-brand", "marketing-paid"],
    purpose: "Brand + paid marketing (activates when either Marketing division activates)",
    allowedContent: [
      "campaign reviews",
      "ad performance",
      "creative pipeline",
      "brand assets",
    ],
    notAllowed: ["finance approvals", "shipping labels", "general ops chatter"],
  },
  {
    id: "trade-shows",
    name: "#trade-shows",
    state: "latent",
    owningDivision: "trade-shows-field",
    divisions: ["trade-shows-field"],
    purpose: "Trade show pod coordination (activates when a show is booked)",
    allowedContent: [],
    notAllowed: [],
  },
  {
    id: "outreach-pr",
    name: "#outreach-pr",
    state: "latent",
    owningDivision: "outreach-partnerships-press",
    divisions: ["outreach-partnerships-press"],
    purpose: "Outreach / partnerships / press (activates at PR inbound volume)",
    allowedContent: [],
    notAllowed: [],
  },
  {
    id: "cx",
    name: "#cx",
    state: "latent",
    owningDivision: "customer-experience",
    divisions: ["customer-experience"],
    purpose: "Customer experience (activates at DTC ticket volume)",
    allowedContent: [],
    notAllowed: [],
  },
  {
    id: "product-rd",
    name: "#product-rd",
    state: "latent",
    owningDivision: "product-packaging-rd",
    divisions: ["product-packaging-rd"],
    purpose: "Product / packaging / R&D (activates at first new SKU decision)",
    allowedContent: [],
    notAllowed: [],
  },
]);

const BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));

export function listChannels(state?: Channel["state"]): readonly Channel[] {
  return state ? CHANNELS.filter((c) => c.state === state) : CHANNELS;
}

export function getChannel(id: ChannelId): Channel | undefined {
  return BY_ID.get(id);
}
