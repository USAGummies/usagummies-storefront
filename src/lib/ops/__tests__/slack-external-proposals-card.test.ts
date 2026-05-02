/**
 * Slack external-proposals card renderer coverage.
 *
 * Pins:
 *   - Empty queue → no-proposals copy.
 *   - Stats fields + flagged direct-mutation count surface.
 *   - Top queued rendered with source / risk class / 🚩 flag / title / confidence.
 *   - By-source + by-department chips appear when counts exist.
 *   - "no external tool executes directly" reminder in context block.
 *   - Dashboard URL points at the API endpoint.
 *   - Degraded list surfaces.
 */
import { describe, expect, it } from "vitest";

import { renderExternalProposalsCard } from "../slack-external-proposals-card";
import type {
  ExternalProposalRecord,
  ExternalProposalsSummary,
} from "../external-proposals";

function rec(
  overrides: Partial<ExternalProposalRecord> = {},
): ExternalProposalRecord {
  return {
    id: "ext-1",
    source: "polsia",
    department: "sales",
    title: "Re-engage Reunion 2026 leads",
    proposedAction: "Draft a follow-up email for 4 booth leads",
    evidence: { claim: "x", confidence: 0.85 },
    riskClass: "draft_only",
    status: "queued",
    flags: [],
    createdAt: "2026-05-02T19:00:00.000Z",
    updatedAt: "2026-05-02T19:00:00.000Z",
    ...overrides,
  } as ExternalProposalRecord;
}

function summary(
  overrides: Partial<ExternalProposalsSummary> = {},
): ExternalProposalsSummary {
  return {
    total: 0,
    queued: 0,
    reviewed: 0,
    promoted: 0,
    rejected: 0,
    byDepartment: {},
    bySource: {},
    flaggedDirectMutation: 0,
    topQueued: [],
    ...overrides,
  };
}

describe("renderExternalProposalsCard", () => {
  it("empty → no-proposals copy", () => {
    const card = renderExternalProposalsCard({ summary: summary() });
    expect(card.text).toMatch(/empty/i);
    expect(JSON.stringify(card.blocks)).toMatch(/No external proposals/);
  });

  it("stats fields surface every count", () => {
    const card = renderExternalProposalsCard({
      summary: summary({
        total: 5,
        queued: 2,
        reviewed: 1,
        promoted: 1,
        rejected: 1,
        flaggedDirectMutation: 1,
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("Total");
    expect(blob).toContain("\\n5");
    expect(blob).toContain("Queued");
    expect(blob).toContain("\\n2");
    expect(blob).toContain("Direct-mutation");
    expect(blob).toContain("\\n1");
  });

  it("top queued renders source + risk class + 🚩 flag + title + confidence", () => {
    const card = renderExternalProposalsCard({
      summary: summary({
        total: 2,
        queued: 2,
        topQueued: [
          rec({
            id: "a",
            source: "reevo",
            riskClass: "approval_required",
            flags: ["claims_direct_mutation"],
            title: "Send blast to 200 leads",
            evidence: { claim: "x", confidence: 0.7 },
          }),
          rec({
            id: "b",
            source: "polsia",
            riskClass: "draft_only",
            title: "Draft creative for Q3 push",
          }),
        ],
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("`reevo`");
    expect(blob).toContain("approval_required");
    expect(blob).toContain("🚩");
    expect(blob).toContain("Send blast to 200 leads");
    expect(blob).toContain("70% conf");
    expect(blob).toContain("`polsia`");
    expect(blob).toContain("draft_only");
  });

  it("flagged direct-mutation copy fires when count > 0", () => {
    const card = renderExternalProposalsCard({
      summary: summary({
        total: 1,
        queued: 1,
        flaggedDirectMutation: 1,
      }),
    });
    expect(JSON.stringify(card.blocks)).toMatch(/claim direct mutation/);
  });

  it("by-source + by-department chips appear when counts exist", () => {
    const card = renderExternalProposalsCard({
      summary: summary({
        total: 2,
        queued: 0,
        bySource: { polsia: 1, reevo: 1 },
        byDepartment: { sales: 1, marketing: 1 },
      }),
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("`polsia` · 1");
    expect(blob).toContain("`reevo` · 1");
    expect(blob).toContain("`sales` · 1");
  });

  it("read-only reminder + dashboard URL present", () => {
    const card = renderExternalProposalsCard({ summary: summary() });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/no external tool executes directly/i);
    expect(blob).toContain("/api/ops/external-proposals");
  });

  it("degraded list surfaces", () => {
    const card = renderExternalProposalsCard({
      summary: summary(),
      degraded: ["kv-down"],
    });
    expect(JSON.stringify(card.blocks)).toContain("kv-down");
  });
});
