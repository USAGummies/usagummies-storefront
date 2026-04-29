/**
 * Agent-packs registry locks — P0-2 acceptance criteria.
 *
 * These tests assert the static registry's invariants:
 *   - Drew is never a humanOwner.
 *   - Every approval slug resolves to a registered taxonomy slug.
 *   - No new divisions introduced (every division is in the canonical
 *     DivisionId set).
 *   - No new approval slugs introduced.
 *   - Pack member ids resolve to AgentEntry ids (no orphans).
 *   - The ChatGPT-pack proposals from `/contracts/agent-architecture-audit.md`
 *     §11 are NOT treated as agents (i.e. their proposed names do not
 *     appear in AGENT_REGISTRY).
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_REGISTRY,
  PACK_REGISTRY,
  getAgentById,
  getPackById,
} from "../registry";
import {
  ACTION_REGISTRY,
  classify,
} from "@/lib/ops/control-plane/taxonomy";

const REGISTERED_SLUGS = new Set(ACTION_REGISTRY.map((a) => a.slug));

const REGISTERED_DIVISIONS = new Set([
  "executive-control",
  "sales",
  "financials",
  "production-supply-chain",
  "research-intelligence",
  "platform-data-automation",
  "marketing-brand",
  "marketing-paid",
  "trade-shows-field",
  "outreach-partnerships-press",
  "customer-experience",
  "product-packaging-rd",
]);

// =========================================================================
// Drew owns nothing
// =========================================================================

describe("Agent registry — Drew owns nothing (CLAUDE.md doctrine 2026-04-27)", () => {
  it("no agent has humanOwner = 'Drew'", () => {
    const offenders = AGENT_REGISTRY.filter((a) => a.humanOwner === "Drew");
    expect(offenders).toEqual([]);
  });

  it("Sample/Order Dispatch has Ben as primary owner (Drew is a fulfillment node, not owner)", () => {
    const sod = getAgentById("sample-order-dispatch");
    expect(sod).toBeDefined();
    expect(sod?.humanOwner).toBe("Ben");
  });
});

// =========================================================================
// All approval slugs resolve to taxonomy
// =========================================================================

describe("Agent registry — every approval slug is in taxonomy.ts", () => {
  for (const agent of AGENT_REGISTRY) {
    if (agent.approvalSlugs.length === 0) continue;
    it(`${agent.id} — every slug resolves`, () => {
      for (const slug of agent.approvalSlugs) {
        const spec = classify(slug);
        expect(spec, `slug "${slug}" missing from taxonomy.ts`).toBeDefined();
        expect(REGISTERED_SLUGS.has(slug)).toBe(true);
      }
    });
  }

  it("the registry introduces NO new approval slugs", () => {
    const allSlugs = new Set<string>();
    for (const a of AGENT_REGISTRY) for (const s of a.approvalSlugs) allSlugs.add(s);
    const novel = [...allSlugs].filter((s) => !REGISTERED_SLUGS.has(s));
    expect(novel).toEqual([]);
  });
});

// =========================================================================
// No new divisions
// =========================================================================

describe("Agent registry — no new divisions", () => {
  it("every agent.division is in the canonical DivisionId set", () => {
    for (const a of AGENT_REGISTRY) {
      expect(REGISTERED_DIVISIONS.has(a.division)).toBe(true);
    }
  });
});

// =========================================================================
// Pack member ids are real
// =========================================================================

describe("Pack registry — member ids resolve", () => {
  for (const pack of PACK_REGISTRY) {
    it(`${pack.id} — every memberId points to a real AgentEntry`, () => {
      for (const id of pack.memberIds) {
        expect(getAgentById(id), `pack ${pack.id} references unknown agent ${id}`).toBeDefined();
      }
    });
  }

  it("six packs registered (B2B Revenue, Exec Control, Finance/Cash, Ops/Fulfillment, System Build, Research/Growth)", () => {
    expect(PACK_REGISTRY.map((p) => p.id).sort()).toEqual([
      "b2b-revenue",
      "executive-control",
      "finance-cash",
      "ops-fulfillment",
      "research-growth",
      "system-build",
    ]);
  });

  it("every active agent is in at least one pack (no orphans)", () => {
    const inPack = new Set<string>();
    for (const p of PACK_REGISTRY) for (const id of p.memberIds) inPack.add(id);
    const orphans = AGENT_REGISTRY.filter((a) => !inPack.has(a.id));
    expect(orphans.map((a) => a.id)).toEqual([]);
  });
});

// =========================================================================
// ChatGPT-pack proposals are NOT treated as agents (§11 of audit doc)
// =========================================================================

describe("Agent registry — ChatGPT-pack proposals are NOT agents", () => {
  /**
   * The §11 rejected list from contracts/agent-architecture-audit.md.
   * These are paraphrased agent NAMES from the ChatGPT proposal that
   * we explicitly chose NOT to build because the existing registry
   * already covers them. They MUST NOT appear in AGENT_REGISTRY.
   */
  const REJECTED_NAMES = [
    "Lead Generation Agent",
    "Inbound Triage Agent",
    "Cold Email Specialist",
    "Pipeline Manager",
    "Deal Stage Manager",
    "Faire Direct Outreach Agent",
    "Faire Marketplace Order Agent",
    "Booking / Trade-Show Agent",
    "Customer Support Agent (Tier 1)",
    "Bookkeeper / Categorizer",
    "AP Manager",
    "AR Manager",
    "Reconciler",
    "Receipt Capture Agent",
    "Tax Filing Agent",
    "Vendor Manager",
    "PO Manager",
    "Sample Coordinator",
    "Order Coordinator",
    "Inventory Manager",
    "Production Run Planner",
    "Shipping Coordinator",
    "Tracking Notifier",
    "FBM Order Watcher",
    "FBA Restock Watcher",
    "Compliance Calendar Agent",
    "Approved Claims Reviewer",
    "FDA Filing Agent",
    "USPTO Maintenance Agent",
    "Insurance Renewal Agent",
    "COI Tracker",
    "Press Outreach Agent",
    "Press Monitor",
    "Consumer Insight Agent",
    "Market Research Agent",
    "Competitor Watch Agent",
    "Channel Research Agent",
    "Regulatory Watch Agent",
    "Supply Watch Agent",
    "Research Synthesizer",
    "Daily Brief Composer",
    "Drift Auditor",
    "Connector Health Monitor",
    "Secret Rotation Manager",
    "Audit Logger",
    "Approval Queue Manager",
    "Memory Embedder",
    "Memory Searcher",
    "Spec Disambiguator",
    "Brand Content Agent",
    "Paid Media Agent",
    "Product R&D Agent",
  ];

  it("no rejected proposal name appears verbatim as an agent name in AGENT_REGISTRY", () => {
    const registryNames = new Set(AGENT_REGISTRY.map((a) => a.name));
    const violations = REJECTED_NAMES.filter((n) => registryNames.has(n));
    expect(violations).toEqual([]);
  });

  it("no rejected proposal id (kebab-case) appears as an agent id", () => {
    // Translate proposal names to plausible kebab-case ids (best-effort)
    // and check none are in the registry. This guards against someone
    // adding "lead-generation-agent" later.
    const REJECTED_IDS = REJECTED_NAMES.map((n) =>
      n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    );
    const registryIds = new Set(AGENT_REGISTRY.map((a) => a.id));
    const violations = REJECTED_IDS.filter((id) => registryIds.has(id));
    expect(violations).toEqual([]);
  });
});

// =========================================================================
// Lookup helpers
// =========================================================================

describe("getAgentById / getPackById", () => {
  it("getAgentById returns existing agent", () => {
    expect(getAgentById("viktor")).toBeDefined();
    expect(getAgentById("transcript-saver")).toBeDefined();
  });

  it("getAgentById returns undefined for unknown id", () => {
    expect(getAgentById("ghost-agent")).toBeUndefined();
  });

  it("getPackById returns existing pack", () => {
    expect(getPackById("b2b-revenue")).toBeDefined();
    expect(getPackById("executive-control")).toBeDefined();
  });
});
