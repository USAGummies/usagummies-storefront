/**
 * Phase 28g — dispatch audit feed projector + sort.
 *
 * Locks the contract:
 *   - Project mark + clear entries to typed feed rows.
 *   - Defensive on malformed entries: missing entityId, missing
 *     entityType, malformed `after`, error result without message →
 *     return null (no fabrication).
 *   - Source + orderNumber parsed from `${source}:${orderNumber}` —
 *     supports orderNumbers with internal dashes (Amazon shape).
 *   - orderNumberShort: ≤12 chars unchanged; >12 chars → `…<last8>`.
 *   - Sort newest-first by timestampIso, id DESC tie-break.
 */
import { describe, expect, it } from "vitest";

import type { AuditLogEntry } from "@/lib/ops/control-plane/types";
import {
  DISPATCH_AUDIT_ACTIONS,
  projectDispatchAuditEntryToFeedRow,
  sortDispatchFeedRows,
} from "@/lib/ops/shipping-dispatch-audit-feed";

function makeEntry(
  over: Partial<AuditLogEntry> = {},
): AuditLogEntry {
  return {
    id: "audit-1",
    runId: "run-1",
    division: "production-supply-chain",
    actorType: "agent",
    actorId: "shipping-dispatch-reaction",
    action: DISPATCH_AUDIT_ACTIONS.mark,
    entityType: "shipping.shipment",
    entityId: "amazon:112-1111111-1111111",
    after: {
      dispatchedAt: "2026-04-26T18:00:00.000Z",
      dispatchedBy: "U_OPERATOR",
      surface: "slack-reaction",
      postedThreadReply: true,
    },
    result: "ok",
    sourceCitations: [
      { system: "amazon", id: "112-1111111-1111111" },
    ],
    confidence: 1,
    createdAt: "2026-04-26T18:00:00.000Z",
    ...over,
  };
}

describe("projectDispatchAuditEntryToFeedRow — happy paths", () => {
  it("projects a mark entry to action='mark' with surface + actor + postedThreadReply", () => {
    const row = projectDispatchAuditEntryToFeedRow(makeEntry());
    expect(row).not.toBeNull();
    expect(row?.action).toBe("mark");
    expect(row?.source).toBe("amazon");
    expect(row?.orderNumber).toBe("112-1111111-1111111");
    // Long order numbers (>12 chars) are truncated to "…<last8>".
    // Trailing 8 chars of "112-1111111-1111111" includes the second dash.
    expect(row?.orderNumberShort).toBe("…-1111111");
    expect(row?.surface).toBe("slack-reaction");
    expect(row?.actorRef).toBe("U_OPERATOR");
    expect(row?.postedThreadReply).toBe(true);
    expect(row?.result).toBe("ok");
  });

  it("projects a clear entry to action='clear'", () => {
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({
        action: DISPATCH_AUDIT_ACTIONS.clear,
        after: { dispatchedAt: null },
      }),
    );
    expect(row?.action).toBe("clear");
    // Surface defaults to "unknown" when after lacks it (clear payload doesn't carry it).
    expect(row?.surface).toBe("unknown");
    // postedThreadReply defaults false.
    expect(row?.postedThreadReply).toBe(false);
    // actorRef null when after.dispatchedBy is missing.
    expect(row?.actorRef).toBeNull();
  });

  it("orderNumberShort: short ids stay full", () => {
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({ entityId: "shopify:1077" }),
    );
    expect(row?.orderNumberShort).toBe("1077");
  });

  it("orderNumberShort: long ids are trimmed to ellipsis + last 8 chars", () => {
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({ entityId: "amazon:112-9876543-1234567" }),
    );
    expect(row?.orderNumberShort.startsWith("…")).toBe(true);
    expect(row?.orderNumberShort.length).toBe(9);
    // Last 8 chars of "112-9876543-1234567" includes the trailing dash.
    expect(row?.orderNumberShort.slice(1)).toBe(
      "112-9876543-1234567".slice(-8),
    );
  });

  it("entityId with multi-segment orderNumber preserves the FULL trailing portion", () => {
    // Amazon-style "XXX-XXXXXXX-XXXXXXX" lives entirely after the colon.
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({ entityId: "amazon:112-9876543-1234567" }),
    );
    expect(row?.orderNumber).toBe("112-9876543-1234567");
    expect(row?.source).toBe("amazon");
  });
});

describe("projectDispatchAuditEntryToFeedRow — defensive paths", () => {
  it("returns null on unknown action slug", () => {
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({ action: "shipping.label.buy" }),
    );
    expect(row).toBeNull();
  });

  it("returns null on wrong entityType", () => {
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({ entityType: "shipping.label" }),
    );
    expect(row).toBeNull();
  });

  it("returns null on missing entityId", () => {
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({ entityId: undefined }),
    );
    expect(row).toBeNull();
  });

  it("returns null on entityId without colon", () => {
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({ entityId: "no-colon-here" }),
    );
    expect(row).toBeNull();
  });

  it("returns null on entityId with empty source or orderNumber", () => {
    expect(
      projectDispatchAuditEntryToFeedRow(makeEntry({ entityId: ":order" })),
    ).toBeNull();
    expect(
      projectDispatchAuditEntryToFeedRow(makeEntry({ entityId: "source:" })),
    ).toBeNull();
  });

  it("returns null on result='error' without an error message", () => {
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({ result: "error", error: undefined }),
    );
    expect(row).toBeNull();
  });

  it("preserves error.message verbatim on result='error'", () => {
    const row = projectDispatchAuditEntryToFeedRow(
      makeEntry({
        result: "error",
        error: { message: "auditStore append failed: ECONNREFUSED" },
      }),
    );
    expect(row?.result).toBe("error");
    expect(row?.errorMessage).toBe(
      "auditStore append failed: ECONNREFUSED",
    );
  });
});

describe("sortDispatchFeedRows", () => {
  function makeRow(
    over: Partial<ReturnType<typeof projectDispatchAuditEntryToFeedRow>> = {},
  ) {
    return projectDispatchAuditEntryToFeedRow(
      makeEntry({ ...over, id: over?.id ?? "x", createdAt: over?.timestampIso }),
    )!;
  }

  it("sorts newest first by timestampIso", () => {
    const a = makeRow({ id: "a", timestampIso: "2026-04-26T15:00:00Z" });
    const b = makeRow({ id: "b", timestampIso: "2026-04-26T18:00:00Z" });
    const c = makeRow({ id: "c", timestampIso: "2026-04-26T12:00:00Z" });
    const sorted = sortDispatchFeedRows([a, b, c]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("uses id DESC as a stable tie-break on identical timestamps", () => {
    const a = makeRow({ id: "a", timestampIso: "2026-04-26T18:00:00Z" });
    const b = makeRow({ id: "b", timestampIso: "2026-04-26T18:00:00Z" });
    const sorted = sortDispatchFeedRows([a, b]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("returns a new array (does not mutate input)", () => {
    const rows = [makeRow({ id: "a" }), makeRow({ id: "b" })];
    const sorted = sortDispatchFeedRows(rows);
    expect(sorted).not.toBe(rows);
  });
});
