/**
 * Slack pipeline-drift card renderer coverage.
 *
 * Pins:
 *   - Empty drift → green clean copy
 *   - posture: red on 3+/no-evidence; yellow on any drift; green clean
 *   - drift rows render with verifiedStage → hubspotStage + steps
 *   - no-evidence rows show "no-evidence" badge
 *   - read-only context note + dashboard URL present
 *   - degraded list surfaces (capped at 3)
 *   - top rows sorted: no-evidence first, then by driftSteps desc
 */
import { describe, expect, it } from "vitest";

import {
  renderPipelineDriftCard,
  type PipelineDriftSummary,
} from "../slack-pipeline-drift-card";
import type { PipelineDrift } from "../pipeline-verifier";

function summary(
  overrides: Partial<PipelineDriftSummary> = {},
): PipelineDriftSummary {
  return {
    total: 0,
    clean: 0,
    driftCount: 0,
    bySeverity: {
      oneStep: 0,
      twoStep: 0,
      threePlusStep: 0,
      noEvidence: 0,
    },
    ...overrides,
  };
}

function drift(
  overrides: Partial<PipelineDrift & { dealName?: string }> = {},
): PipelineDrift & { dealName?: string } {
  return {
    dealId: "d-1",
    hubspotStage: "shipped",
    verifiedStage: "quote_sent",
    driftSteps: 4,
    missingEvidenceForStages: [
      "po_received",
      "invoice_sent",
      "paid",
      "shipped",
    ],
    reason: "x",
    verification: "needs_review",
    ...overrides,
  };
}

describe("renderPipelineDriftCard", () => {
  it("empty drift → green clean copy", () => {
    const card = renderPipelineDriftCard({
      summary: summary({ total: 5, clean: 5 }),
      drifted: [],
    });
    expect(card.text).toMatch(/clean/);
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/All HubSpot stages match/);
    expect(blob).toMatch(/🟢 clean/);
  });

  it("posture: red on 3+/no-evidence", () => {
    const card = renderPipelineDriftCard({
      summary: summary({
        total: 1,
        driftCount: 1,
        bySeverity: { oneStep: 0, twoStep: 0, threePlusStep: 1, noEvidence: 0 },
      }),
      drifted: [drift({ driftSteps: 4 })],
    });
    expect(JSON.stringify(card.blocks)).toMatch(/🔴 attention/);
  });

  it("posture: yellow on 1-2 step drift only", () => {
    const card = renderPipelineDriftCard({
      summary: summary({
        total: 1,
        driftCount: 1,
        bySeverity: { oneStep: 1, twoStep: 0, threePlusStep: 0, noEvidence: 0 },
      }),
      drifted: [drift({ driftSteps: 1 })],
    });
    expect(JSON.stringify(card.blocks)).toMatch(/🟡 work waiting/);
  });

  it("renders drifted rows with verifiedStage → hubspotStage + steps", () => {
    const card = renderPipelineDriftCard({
      summary: summary({
        total: 2,
        driftCount: 2,
        bySeverity: { oneStep: 1, twoStep: 0, threePlusStep: 1, noEvidence: 1 },
      }),
      drifted: [
        drift({
          dealId: "d-quote",
          hubspotStage: "shipped",
          verifiedStage: "quote_sent",
          driftSteps: 4,
        }),
        drift({
          dealId: "d-no-evidence",
          hubspotStage: "paid",
          verifiedStage: null,
          driftSteps: 8,
        }),
      ],
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/Quote Sent/);
    expect(blob).toMatch(/Shipped/);
    expect(blob).toMatch(/no-evidence/);
    expect(blob).toMatch(/Paid/);
  });

  it("top rows: no-evidence first, then driftSteps desc", () => {
    const card = renderPipelineDriftCard({
      summary: summary({
        total: 3,
        driftCount: 3,
        bySeverity: { oneStep: 1, twoStep: 0, threePlusStep: 1, noEvidence: 1 },
      }),
      drifted: [
        drift({
          dealId: "small",
          driftSteps: 1,
          hubspotStage: "invoice_sent",
        }),
        drift({
          dealId: "big",
          driftSteps: 5,
          hubspotStage: "reordered",
        }),
        drift({
          dealId: "no-ev",
          verifiedStage: null,
          driftSteps: 10,
          hubspotStage: "paid",
        }),
      ],
    });
    const blob = JSON.stringify(card.blocks);
    const noEvIndex = blob.indexOf("no-ev");
    const bigIndex = blob.indexOf("big");
    const smallIndex = blob.indexOf("small");
    expect(noEvIndex).toBeGreaterThan(-1);
    expect(noEvIndex).toBeLessThan(bigIndex);
    expect(bigIndex).toBeLessThan(smallIndex);
  });

  it("dashboard URL is /ops/sales/pipeline-drift + read-only note present", () => {
    const card = renderPipelineDriftCard({
      summary: summary(),
      drifted: [],
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("/ops/sales/pipeline-drift");
    expect(blob).toMatch(/no HubSpot stage is moved/i);
  });

  it("degraded list surfaces (capped at 3)", () => {
    const card = renderPipelineDriftCard({
      summary: summary(),
      drifted: [],
      degraded: ["a", "b", "c", "d"],
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("Degraded:");
    expect(blob).toContain("a · b · c");
    expect(blob).not.toContain("a · b · c · d");
  });
});
