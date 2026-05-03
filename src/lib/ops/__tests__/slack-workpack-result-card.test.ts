/**
 * slack-workpack-result-card renderer coverage.
 *
 * Pins:
 *   - Returns null for non-terminal status (queued / running / etc.)
 *   - done → ✅ header + result summary in brief
 *   - failed → 🛑 header + failure reason in brief
 *   - Falls back to "no summary" / "no reason" copy when fields empty
 *   - Result links section appears when resultLinks non-empty
 *   - Source thread button appears when sourceUrl present
 *   - Read-only context note present (doctrine compliance)
 *   - Long summary / failure reason truncate to 600 chars
 */
import { describe, expect, it } from "vitest";

import { renderWorkpackResultCard } from "../slack-workpack-result-card";
import type { WorkpackRecord } from "../workpacks";

function record(
  overrides: Partial<WorkpackRecord> = {},
): WorkpackRecord {
  return {
    id: "wp_123abc",
    status: "queued",
    intent: "draft_reply",
    department: "email",
    title: "Draft reply for ACME inquiry",
    sourceText: "incoming inquiry text",
    sourceUrl: "https://usagummies.slack.com/archives/C0AKG9FSC2J/p1234",
    requestedBy: "ben",
    allowedActions: ["draft_only"],
    prohibitedActions: [],
    riskClass: "read_only",
    createdAt: "2026-05-02T18:00:00.000Z",
    updatedAt: "2026-05-02T18:00:00.000Z",
    ...overrides,
  };
}

describe("renderWorkpackResultCard", () => {
  it.each(["queued", "running", "needs_review", "approved"] as const)(
    "returns null for non-terminal status %s",
    (status) => {
      expect(renderWorkpackResultCard(record({ status }))).toBeNull();
    },
  );

  it("done → ✅ header + result summary in brief", () => {
    const card = renderWorkpackResultCard(
      record({
        status: "done",
        resultSummary: "Drafted 4 lines for Ben's review.",
      }),
    );
    expect(card).not.toBeNull();
    expect(card!.text).toMatch(/✅ Workpack done/);
    const blob = JSON.stringify(card!.blocks);
    expect(blob).toMatch(/Drafted 4 lines for Ben/);
  });

  it("failed → 🛑 header + failure reason in brief", () => {
    const card = renderWorkpackResultCard(
      record({
        status: "failed",
        failureReason: "Gmail unreachable for 3 retries.",
      }),
    );
    expect(card!.text).toMatch(/🛑 Workpack failed/);
    expect(JSON.stringify(card!.blocks)).toMatch(/Gmail unreachable/);
  });

  it("done with no result summary → fallback copy", () => {
    const card = renderWorkpackResultCard(
      record({ status: "done", resultSummary: undefined }),
    );
    expect(JSON.stringify(card!.blocks)).toMatch(/no result summary/);
  });

  it("failed with no failure reason → fallback copy", () => {
    const card = renderWorkpackResultCard(
      record({ status: "failed", failureReason: undefined }),
    );
    expect(JSON.stringify(card!.blocks)).toMatch(/no failure reason/);
  });

  it("result links section appears when resultLinks non-empty", () => {
    const card = renderWorkpackResultCard(
      record({
        status: "done",
        resultSummary: "x",
        resultLinks: ["https://example.com/a", "https://example.com/b"],
      }),
    );
    const blob = JSON.stringify(card!.blocks);
    expect(blob).toMatch(/Result links/);
    expect(blob).toContain("example.com/a");
    expect(blob).toContain("example.com/b");
  });

  it("Source thread button appears when sourceUrl present", () => {
    const card = renderWorkpackResultCard(
      record({ status: "done", resultSummary: "x" }),
    );
    const blob = JSON.stringify(card!.blocks);
    expect(blob).toContain("Source thread");
    expect(blob).toContain("/archives/C0AKG9FSC2J/p1234");
  });

  it("omits Source thread button when sourceUrl missing", () => {
    const card = renderWorkpackResultCard(
      record({ status: "done", resultSummary: "x", sourceUrl: undefined }),
    );
    expect(JSON.stringify(card!.blocks)).not.toMatch(/Source thread/);
  });

  it("read-only context note present", () => {
    const card = renderWorkpackResultCard(
      record({ status: "done", resultSummary: "x" }),
    );
    expect(JSON.stringify(card!.blocks)).toMatch(
      /workpack execution stayed external/i,
    );
  });

  it("long summary truncates to 600 chars + ellipsis", () => {
    const longSummary = "x".repeat(800);
    const card = renderWorkpackResultCard(
      record({ status: "done", resultSummary: longSummary }),
    );
    const blob = JSON.stringify(card!.blocks);
    expect(blob).not.toContain(longSummary);
    expect(blob).toContain("…");
  });

  it("Open workpack button URL deep-links to /ops/workpacks#<id>", () => {
    const card = renderWorkpackResultCard(
      record({ status: "done", resultSummary: "x" }),
    );
    expect(JSON.stringify(card!.blocks)).toContain(
      "/ops/workpacks#wp_123abc",
    );
  });
});
