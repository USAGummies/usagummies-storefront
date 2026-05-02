/**
 * Slack `agents status` card renderer coverage.
 *
 * Pins:
 *   - Empty registry → no-packs copy.
 *   - Each pack renders with department label + role + tool counts + handoff.
 *   - Global prohibitions count surfaces in context block.
 *   - Read-only context note + registry URL present.
 *   - Long role strings are truncated.
 */
import { describe, expect, it } from "vitest";

import { renderAgentsStatusCard } from "../slack-agents-status-card";
import type { WorkpackPromptPack } from "../workpack-prompts";

function pack(
  overrides: Partial<WorkpackPromptPack> = {},
): WorkpackPromptPack {
  return {
    department: "sales",
    role: "Test sales scout",
    readTools: ["/api/ops/sales/today"],
    allowedOutputs: ["draft"],
    prohibitedActions: ["no stage moves"],
    approvalSlugs: ["hubspot.deal.stage.move"],
    dailyChecklist: "x".repeat(120),
    humanHandoff: { slug: "operator-review", fields: ["agentRole"] },
    ...overrides,
  };
}

describe("renderAgentsStatusCard", () => {
  it("empty registry → no-packs copy", () => {
    const card = renderAgentsStatusCard({
      packs: [],
      prohibitedGlobal: ["a", "b", "c"],
    });
    expect(card.text).toMatch(/0 packs|no workpack prompt packs registered/i);
  });

  it("renders one section per pack with label + role + tool counts + handoff", () => {
    const card = renderAgentsStatusCard({
      packs: [
        pack({ department: "sales" }),
        pack({ department: "finance", humanHandoff: { slug: "rene-review", fields: [] } }),
      ],
      prohibitedGlobal: ["a", "b", "c"],
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/💼 Sales/);
    expect(blob).toMatch(/💵 Finance/);
    expect(blob).toMatch(/operator-review/);
    expect(blob).toMatch(/rene-review/);
    expect(blob).toMatch(/Read tools/);
    expect(blob).toMatch(/Prohibited actions/);
    expect(blob).toMatch(/Approval slugs/);
  });

  it("global prohibitions count surfaces in context", () => {
    const card = renderAgentsStatusCard({
      packs: [pack()],
      prohibitedGlobal: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(JSON.stringify(card.blocks)).toMatch(/7 rules locked/);
  });

  it("read-only context note + registry URL present", () => {
    const card = renderAgentsStatusCard({
      packs: [pack()],
      prohibitedGlobal: [],
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/no execution fires from this card/i);
    expect(blob).toContain(
      "/api/ops/openai-workspace-tools/workpack-prompts",
    );
  });

  it("long role string is truncated", () => {
    const longRole = "x".repeat(500);
    const card = renderAgentsStatusCard({
      packs: [pack({ role: longRole })],
      prohibitedGlobal: [],
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).not.toContain(longRole);
    expect(blob).toContain("…");
  });
});
