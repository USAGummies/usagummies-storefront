import { describe, expect, it } from "vitest";

import { buildAgentRunHistory } from "../run-history";
import type { AuditLogEntry } from "../../control-plane/types";

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: overrides.id ?? `entry-${Math.random()}`,
    runId: overrides.runId ?? "run-1",
    division: overrides.division ?? "financials",
    actorType: overrides.actorType ?? "agent",
    actorId: overrides.actorId ?? "finance-exception",
    action: overrides.action ?? "slack.post.audit",
    entityType: overrides.entityType ?? "finance-exception-digest",
    entityId: overrides.entityId,
    before: overrides.before,
    after: overrides.after,
    result: overrides.result ?? "ok",
    approvalId: overrides.approvalId,
    error: overrides.error,
    sourceCitations: overrides.sourceCitations ?? [],
    confidence: overrides.confidence,
    createdAt: overrides.createdAt ?? "2026-05-03T15:00:00.000Z",
  };
}

describe("buildAgentRunHistory — filtering", () => {
  it("returns only entries matching the agentId", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", actorId: "finance-exception" }),
      entry({ runId: "r2", actorId: "ops" }),
      entry({ runId: "r3", actorId: "finance-exception" }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.totalEntries).toBe(2);
    expect(result.totalRuns).toBe(2);
    expect(result.items.map((i) => i.runId).sort()).toEqual(["r1", "r3"]);
  });

  it("ignores human-actor entries even with matching id", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", actorId: "finance-exception", actorType: "agent" }),
      entry({ runId: "r2", actorId: "finance-exception", actorType: "human" }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.totalEntries).toBe(1);
    expect(result.items[0].runId).toBe("r1");
  });

  it("returns empty result when no matches", () => {
    const result = buildAgentRunHistory(
      [entry({ actorId: "ops" })],
      "finance-exception",
    );
    expect(result.totalRuns).toBe(0);
    expect(result.items).toEqual([]);
  });
});

describe("buildAgentRunHistory — run collapsing", () => {
  it("collapses multiple entries with the same runId into one item", () => {
    const entries: AuditLogEntry[] = [
      entry({
        runId: "r1",
        action: "slack.post.audit",
        createdAt: "2026-05-03T15:00:00.000Z",
      }),
      entry({
        runId: "r1",
        action: "open-brain.capture",
        createdAt: "2026-05-03T15:00:01.000Z",
      }),
      entry({
        runId: "r1",
        action: "draft.email",
        createdAt: "2026-05-03T15:00:05.000Z",
      }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.totalEntries).toBe(3);
    expect(result.totalRuns).toBe(1);
    const item = result.items[0];
    expect(item.entryCount).toBe(3);
    expect(item.actions).toEqual([
      "slack.post.audit",
      "open-brain.capture",
      "draft.email",
    ]);
    expect(item.primaryAction).toBe("slack.post.audit");
    expect(item.startedAt).toBe("2026-05-03T15:00:00.000Z");
    expect(item.endedAt).toBe("2026-05-03T15:00:05.000Z");
    expect(item.durationSeconds).toBe(5);
  });

  it("dedupes repeated actions within a run", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", action: "slack.post.audit" }),
      entry({ runId: "r1", action: "slack.post.audit" }),
      entry({ runId: "r1", action: "slack.post.audit" }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].actions).toEqual(["slack.post.audit"]);
    expect(result.items[0].entryCount).toBe(3);
  });
});

describe("buildAgentRunHistory — worstResult rollup", () => {
  it("rolls up to 'error' when any entry errored", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", result: "ok" }),
      entry({ runId: "r1", result: "ok" }),
      entry({
        runId: "r1",
        result: "error",
        error: { message: "boom" },
      }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].worstResult).toBe("error");
    expect(result.items[0].errorMessages).toEqual(["boom"]);
  });

  it("rolls up to 'stood-down' when no error but a stood-down entry exists", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", result: "ok" }),
      entry({ runId: "r1", result: "stood-down" }),
      entry({ runId: "r1", result: "skipped" }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].worstResult).toBe("stood-down");
  });

  it("rolls up to 'ok' when all entries are ok", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", result: "ok" }),
      entry({ runId: "r1", result: "ok" }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].worstResult).toBe("ok");
  });

  it("dedupes repeated error messages", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", result: "error", error: { message: "boom" } }),
      entry({ runId: "r1", result: "error", error: { message: "boom" } }),
      entry({ runId: "r1", result: "error", error: { message: "fizz" } }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].errorMessages).toEqual(["boom", "fizz"]);
  });
});

describe("buildAgentRunHistory — summary extraction", () => {
  it("lifts after.summary string when present", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", after: { summary: "3 stale buyers, 2 voids" } }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].summary).toBe("3 stale buyers, 2 voids");
  });

  it("lifts nested after.summary.summary when summary is an object", () => {
    const entries: AuditLogEntry[] = [
      entry({
        runId: "r1",
        after: { summary: { summary: "nested headline" } },
      }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].summary).toBe("nested headline");
  });

  it("falls back to nextHumanAction when no summary present", () => {
    const entries: AuditLogEntry[] = [
      entry({
        runId: "r1",
        after: { nextHumanAction: "Rene reviews freight queue" },
      }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].summary).toBe("Rene reviews freight queue");
  });

  it("returns null when neither summary nor nextHumanAction", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", after: { unrelated: "value" } }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].summary).toBeNull();
  });

  it("uses first non-null summary across run entries", () => {
    const entries: AuditLogEntry[] = [
      entry({
        runId: "r1",
        action: "open-brain.capture",
        createdAt: "2026-05-03T15:00:00.000Z",
        after: undefined,
      }),
      entry({
        runId: "r1",
        action: "slack.post.audit",
        createdAt: "2026-05-03T15:00:01.000Z",
        after: { summary: "actual summary" },
      }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].summary).toBe("actual summary");
  });
});

describe("buildAgentRunHistory — ordering + limit", () => {
  it("returns runs newest-first", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r-old", createdAt: "2026-05-01T00:00:00.000Z" }),
      entry({ runId: "r-new", createdAt: "2026-05-03T00:00:00.000Z" }),
      entry({ runId: "r-mid", createdAt: "2026-05-02T00:00:00.000Z" }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items.map((i) => i.runId)).toEqual([
      "r-new",
      "r-mid",
      "r-old",
    ]);
  });

  it("honors the limit option", () => {
    const entries: AuditLogEntry[] = Array.from({ length: 10 }, (_, i) =>
      entry({
        runId: `r${i}`,
        createdAt: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const result = buildAgentRunHistory(entries, "finance-exception", {
      limit: 3,
    });
    expect(result.totalRuns).toBe(10);
    expect(result.items.length).toBe(3);
    expect(result.items[0].runId).toBe("r9");
  });

  it("clamps limit to [1, 500]", () => {
    const entries: AuditLogEntry[] = [entry({ runId: "r1" })];
    expect(
      buildAgentRunHistory(entries, "finance-exception", { limit: 0 }).items
        .length,
    ).toBe(1);
    expect(
      buildAgentRunHistory(entries, "finance-exception", { limit: 99999 })
        .items.length,
    ).toBe(1);
  });

  it("threads windowDescription through to result", () => {
    const result = buildAgentRunHistory(
      [entry({ runId: "r1" })],
      "finance-exception",
      { windowDescription: "last 1000 audit entries" },
    );
    expect(result.windowDescription).toBe("last 1000 audit entries");
  });
});

describe("buildAgentRunHistory — primaryCitations", () => {
  it("uses the first entry's citations", () => {
    const entries: AuditLogEntry[] = [
      entry({
        runId: "r1",
        createdAt: "2026-05-03T15:00:00.000Z",
        sourceCitations: [{ system: "qbo", id: "inv-1" }],
      }),
      entry({
        runId: "r1",
        createdAt: "2026-05-03T15:00:01.000Z",
        sourceCitations: [{ system: "shopify", id: "ord-2" }],
      }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].primaryCitations).toEqual([
      { system: "qbo", id: "inv-1" },
    ]);
  });

  it("returns [] when source has no citations", () => {
    const entries: AuditLogEntry[] = [
      entry({ runId: "r1", sourceCitations: [] }),
    ];
    const result = buildAgentRunHistory(entries, "finance-exception");
    expect(result.items[0].primaryCitations).toEqual([]);
  });
});
