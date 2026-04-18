/**
 * Division registry — 6 active, 6 latent. §14.2 + §14.3 of the blueprint.
 *
 * Single source of truth for the division map is contracts/divisions.json.
 * This module re-expresses that data as a typed registry for the runtime.
 * If the two disagree, contracts/divisions.json wins — this module must be
 * updated to match via the weekly drift audit.
 */

import type { Division, DivisionId } from "./types";

const DIVISIONS: readonly Division[] = Object.freeze([
  // --- Active ----------------------------------------------------------
  {
    id: "executive-control",
    name: "Executive Control & Governance",
    state: "active",
    humanOwner: "Ben",
    primaryAiLayer: "Control plane + audit layer",
    primarySystems: [
      "Notion canonical docs",
      "Open Brain",
      "approval queue",
      "audit log",
    ],
    visibleSlackChannels: [
      "ops-daily",
      "ops-approvals",
      "ops-audit",
      "ops-alerts",
    ],
    notes: "Division 1 by design. Governance is not buried.",
  },
  {
    id: "sales",
    name: "Sales",
    state: "active",
    humanOwner: "Ben",
    primaryAiLayer: "Viktor + revenue support agents",
    primarySystems: ["HubSpot", "Gmail", "Shopify", "Amazon Seller Central"],
    visibleSlackChannels: ["sales"],
    notes: "Includes B2B, DTC, and Amazon on day one.",
  },
  {
    id: "financials",
    name: "Financials",
    state: "active",
    humanOwner: "Rene",
    primaryAiLayer: "Booke + finance exception agent",
    primarySystems: ["QBO", "Plaid", "finance email"],
    visibleSlackChannels: ["finance"],
    notes: "QBO is the accounting system of record. Booke categorizes; Rene approves.",
  },
  {
    id: "production-supply-chain",
    name: "Production & Supply Chain",
    state: "active",
    humanOwner: "Drew",
    primaryAiLayer: "Ops / vendor / PO agent",
    primarySystems: ["QBO POs", "vendor email threads", "ShipStation", "inventory records"],
    visibleSlackChannels: ["operations"],
    notes: "Vendors, POs, samples, inventory, freight, production coordination.",
  },
  {
    id: "research-intelligence",
    name: "Research & Intelligence",
    state: "active",
    humanOwner: "Ben",
    primaryAiLayer: "Research Librarian + 7 research specialists",
    primarySystems: ["Open Brain", "Notion research library", "external research sources"],
    visibleSlackChannels: ["research"],
    notes: "One visible division surface; seven specialist streams behind it (R-1..R-7).",
  },
  {
    id: "platform-data-automation",
    name: "Platform / Data / Automation",
    state: "active",
    humanOwner: "Ben",
    primaryAiLayer: "Claude Code + orchestration stack",
    primarySystems: ["GitHub", "Vercel", "Make.com", "Supabase", "Slack admin", "system configs"],
    visibleSlackChannels: ["ops-alerts", "ops-audit"],
    notes: "Control plane, memory, routing, integrations, QA, drift prevention.",
  },
  // --- Latent ----------------------------------------------------------
  {
    id: "marketing-brand",
    name: "Marketing — Brand",
    state: "latent",
    humanOwner: "Ben",
    primaryAiLayer: "Content agent (draft-only)",
    primarySystems: ["Notion brand library", "blog MDX"],
    visibleSlackChannels: [],
    activationTrigger: "First scheduled brand campaign OR publishing cadence > 1 post/week sustained for 2 weeks.",
  },
  {
    id: "marketing-paid",
    name: "Marketing — Paid",
    state: "latent",
    humanOwner: "Ben",
    primaryAiLayer: "Madgicx + Google Ads + Triple Whale (deferred)",
    primarySystems: ["Meta Ads", "Google Ads", "Triple Whale"],
    visibleSlackChannels: [],
    activationTrigger: "Monthly ad spend > $1,000 OR Triple Whale pixel installed.",
  },
  {
    id: "trade-shows-field",
    name: "Trade Shows & Field",
    state: "latent",
    humanOwner: "Ben",
    primaryAiLayer: "Trade show agent + booth pod",
    primarySystems: ["Notion show tracker", "HubSpot deals tagged referring_trade_show"],
    visibleSlackChannels: [],
    activationTrigger: "Booth booked for a specific show (pod fires for that show only).",
  },
  {
    id: "outreach-partnerships-press",
    name: "Outreach / Partnerships / Press",
    state: "latent",
    humanOwner: "Ben",
    primaryAiLayer: "PR agent (draft-only)",
    primarySystems: ["Notion PR tracker", "Gmail"],
    visibleSlackChannels: [],
    activationTrigger: "Inbound press inquiries ≥ 5/month OR dedicated PR push launched.",
  },
  {
    id: "customer-experience",
    name: "Customer Experience",
    state: "latent",
    humanOwner: "Ben",
    primaryAiLayer: "Gorgias AI Tier 1 (deferred)",
    primarySystems: ["Gorgias", "Gmail AI/Customer Support"],
    visibleSlackChannels: [],
    activationTrigger: "DTC support tickets > 20/month sustained for 2 weeks.",
  },
  {
    id: "product-packaging-rd",
    name: "Product / Packaging / R&D",
    state: "latent",
    humanOwner: "Ben",
    primaryAiLayer: "Product agent + claims reviewer",
    primarySystems: ["Notion product library", "vendor test data"],
    visibleSlackChannels: [],
    activationTrigger: "First new SKU or formulation decision started.",
  },
]);

const BY_ID = new Map(DIVISIONS.map((d) => [d.id, d]));

export function listDivisions(state?: Division["state"]): readonly Division[] {
  return state ? DIVISIONS.filter((d) => d.state === state) : DIVISIONS;
}

export function getDivision(id: DivisionId): Division | undefined {
  return BY_ID.get(id);
}

export function isActive(id: DivisionId): boolean {
  return BY_ID.get(id)?.state === "active";
}
