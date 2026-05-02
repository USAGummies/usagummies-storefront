/**
 * External proposals (Build 8) coverage.
 *
 * Pins:
 *   - Validator rejects bad source / department / risk class / missing fields.
 *   - Mutation verbs in proposedAction force riskClass → approval_required
 *     and add `claims_direct_mutation` flag.
 *   - URL-length / string-length caps clamp without throwing.
 *   - Append + list round-trips through KV-like store.
 *   - List is fail-soft on store errors (degraded list, no throw).
 *   - Status transitions: queued → reviewed/rejected; reviewed → promoted/rejected;
 *     terminals don't transition.
 *   - Summary roll-up by status / department / source / flag.
 */
import { describe, expect, it } from "vitest";

import {
  appendExternalProposal,
  isValidTransition,
  listExternalProposals,
  summarizeExternalProposals,
  updateExternalProposalStatus,
  validateExternalProposalInput,
  type ExternalProposalRecord,
  type KvLikeStore,
} from "../external-proposals";

function makeStore(): KvLikeStore & {
  data: Record<string, unknown>;
  list: string[];
} {
  const data: Record<string, unknown> = {};
  const list: string[] = [];
  return {
    data,
    list,
    get: async <T>(key: string) => (data[key] as T | undefined) ?? null,
    set: async (key, value) => {
      data[key] = value;
      return "OK";
    },
    lpush: async (_key, value) => {
      list.unshift(String(value));
      return list.length;
    },
    ltrim: async (_key, start, stop) => {
      const s = Math.max(0, start);
      const e = stop + 1;
      list.splice(0, list.length, ...list.slice(s, e));
      return "OK";
    },
    lrange: async (_key, start, stop) =>
      list.slice(Math.max(0, start), stop + 1),
  };
}

const VALID_INPUT = {
  source: "polsia",
  department: "sales",
  title: "Re-engage Reunion 2026 leads",
  proposedAction: "Draft a follow-up email for 4 booth leads from Reunion 2026",
  evidence: { claim: "4 leads went cold after first sample drop" },
  riskClass: "draft_only",
};

describe("validateExternalProposalInput", () => {
  it("accepts a minimal valid payload", () => {
    const r = validateExternalProposalInput(VALID_INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.source).toBe("polsia");
      expect(r.input.department).toBe("sales");
      expect(r.flags).toEqual([]);
      expect(r.effectiveRiskClass).toBe("draft_only");
    }
  });

  it("rejects unknown source", () => {
    const r = validateExternalProposalInput({
      ...VALID_INPUT,
      source: "evilcorp",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/source must be one of/);
  });

  it("rejects unknown department", () => {
    const r = validateExternalProposalInput({
      ...VALID_INPUT,
      department: "vibe-checking",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown riskClass", () => {
    const r = validateExternalProposalInput({
      ...VALID_INPUT,
      riskClass: "anything-goes",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects missing title / proposedAction / evidence.claim", () => {
    expect(
      validateExternalProposalInput({ ...VALID_INPUT, title: "" }).ok,
    ).toBe(false);
    expect(
      validateExternalProposalInput({ ...VALID_INPUT, proposedAction: "" }).ok,
    ).toBe(false);
    expect(
      validateExternalProposalInput({
        ...VALID_INPUT,
        evidence: { claim: "" },
      }).ok,
    ).toBe(false);
  });

  it.each([
    "Send an email to the buyer",
    "Send Gmail to ap@retailer.com",
    "Create deal in HubSpot",
    "Update stage to Closed Won",
    "Buy label for order 1042",
    "Launch campaign on Meta",
    "Change spend cap on Google Ads",
    "Charge card $499 for QBO bill",
    "Close won the Buc-ee's deal",
    "Delete the rejected packet",
  ])("flags '%s' as direct mutation + forces approval_required", (action) => {
    const r = validateExternalProposalInput({
      ...VALID_INPUT,
      proposedAction: action,
      riskClass: "read_only",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.flags).toContain("claims_direct_mutation");
      expect(r.effectiveRiskClass).toBe("approval_required");
    }
  });

  it("does NOT flag innocuous proposedAction strings", () => {
    const r = validateExternalProposalInput({
      ...VALID_INPUT,
      proposedAction:
        "Suggest reaching out to 4 booth leads — Ben can decide whether to draft.",
      riskClass: "read_only",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.flags).toEqual([]);
      expect(r.effectiveRiskClass).toBe("read_only");
    }
  });

  it("string fields are length-clamped, not rejected", () => {
    const longTitle = "x".repeat(500);
    const r = validateExternalProposalInput({
      ...VALID_INPUT,
      title: longTitle,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.title.length).toBeLessThanOrEqual(200);
  });

  it("entityRef requires type when present", () => {
    const r = validateExternalProposalInput({
      ...VALID_INPUT,
      entityRef: { id: "deal-1" },
    });
    expect(r.ok).toBe(false);
  });

  it("clamps confidence to [0..1]", () => {
    const high = validateExternalProposalInput({
      ...VALID_INPUT,
      evidence: { claim: "x", confidence: 9 },
    });
    const low = validateExternalProposalInput({
      ...VALID_INPUT,
      evidence: { claim: "x", confidence: -1 },
    });
    if (high.ok) expect(high.input.evidence.confidence).toBe(1);
    if (low.ok) expect(low.input.evidence.confidence).toBe(0);
  });
});

describe("appendExternalProposal + listExternalProposals", () => {
  it("round-trips a record through the store", async () => {
    const store = makeStore();
    const v = validateExternalProposalInput(VALID_INPUT);
    if (!v.ok) throw new Error("expected valid");
    const rec = await appendExternalProposal(v.input, v.flags, {
      store,
      now: new Date("2026-05-02T20:00:00Z"),
      id: "ext-test-1",
    });
    expect(rec.id).toBe("ext-test-1");
    expect(rec.status).toBe("queued");
    expect(rec.flags).toEqual([]);

    const r = await listExternalProposals({ store, limit: 10 });
    expect(r.records).toHaveLength(1);
    expect(r.records[0].id).toBe("ext-test-1");
    expect(r.degraded).toEqual([]);
  });

  it("preserves newest-first ordering via lpush", async () => {
    const store = makeStore();
    const v = validateExternalProposalInput(VALID_INPUT);
    if (!v.ok) throw new Error("expected valid");
    await appendExternalProposal(v.input, v.flags, {
      store,
      id: "first",
      now: new Date("2026-05-02T19:00:00Z"),
    });
    await appendExternalProposal(v.input, v.flags, {
      store,
      id: "second",
      now: new Date("2026-05-02T20:00:00Z"),
    });
    const r = await listExternalProposals({ store, limit: 10 });
    expect(r.records.map((rec) => rec.id)).toEqual(["second", "first"]);
  });

  it("list is fail-soft when index throws", async () => {
    const broken: KvLikeStore = {
      get: async () => null,
      set: async () => "OK",
      lpush: async () => 1,
      ltrim: async () => "OK",
      lrange: async () => {
        throw new Error("kv-down");
      },
    };
    const r = await listExternalProposals({ store: broken });
    expect(r.records).toEqual([]);
    expect(r.degraded[0]).toContain("index");
    expect(r.degraded[0]).toContain("kv-down");
  });

  it("list is fail-soft when individual get throws", async () => {
    const partial = makeStore();
    const v = validateExternalProposalInput(VALID_INPUT);
    if (!v.ok) throw new Error("expected valid");
    await appendExternalProposal(v.input, v.flags, {
      store: partial,
      id: "ok",
    });
    await appendExternalProposal(v.input, v.flags, {
      store: partial,
      id: "broken",
    });
    const breaking: KvLikeStore = {
      ...partial,
      get: async (key: string) => {
        if (key.endsWith("broken")) throw new Error("kv-get-down");
        return (partial.data[key] as never) ?? null;
      },
    };
    const r = await listExternalProposals({ store: breaking });
    // The "broken" id is the first entry pushed, so the get error
    // surfaces in degraded; the "ok" entry still loads.
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.degraded.some((d) => d.includes("kv-get-down"))).toBe(true);
  });
});

describe("isValidTransition + updateExternalProposalStatus", () => {
  it.each([
    ["queued", "reviewed", true],
    ["queued", "rejected", true],
    ["queued", "expired", true],
    ["queued", "promoted", false],
    ["reviewed", "promoted", true],
    ["reviewed", "rejected", true],
    ["reviewed", "queued", false],
    ["promoted", "rejected", false],
    ["rejected", "promoted", false],
    ["expired", "promoted", false],
    ["queued", "queued", true],
  ] as const)(
    "isValidTransition(%s → %s) = %s",
    (from, to, expected) => {
      expect(isValidTransition(from, to)).toBe(expected);
    },
  );

  it("updates an existing proposal on a valid transition", async () => {
    const store = makeStore();
    const v = validateExternalProposalInput(VALID_INPUT);
    if (!v.ok) throw new Error("expected valid");
    const rec = await appendExternalProposal(v.input, v.flags, {
      store,
      id: "to-review",
    });
    expect(rec.status).toBe("queued");
    const updated = await updateExternalProposalStatus({
      id: "to-review",
      next: "reviewed",
      reviewedBy: "ben",
      reviewerNote: "looks good",
      store,
    });
    expect(updated?.status).toBe("reviewed");
    expect(updated?.reviewedBy).toBe("ben");
    expect(updated?.reviewerNote).toBe("looks good");
  });

  it("returns null when the proposal doesn't exist", async () => {
    const store = makeStore();
    const r = await updateExternalProposalStatus({
      id: "nope",
      next: "reviewed",
      store,
    });
    expect(r).toBeNull();
  });

  it("returns null on invalid transition (terminal → anything)", async () => {
    const store = makeStore();
    const v = validateExternalProposalInput(VALID_INPUT);
    if (!v.ok) throw new Error("expected valid");
    await appendExternalProposal(v.input, v.flags, { store, id: "term" });
    const reviewed = await updateExternalProposalStatus({
      id: "term",
      next: "reviewed",
      store,
    });
    expect(reviewed?.status).toBe("reviewed");
    const promoted = await updateExternalProposalStatus({
      id: "term",
      next: "promoted",
      store,
    });
    expect(promoted?.status).toBe("promoted");
    // promoted is terminal → next attempt fails
    const stillPromoted = await updateExternalProposalStatus({
      id: "term",
      next: "rejected",
      store,
    });
    expect(stillPromoted).toBeNull();
  });
});

describe("summarizeExternalProposals", () => {
  function rec(
    overrides: Partial<ExternalProposalRecord> = {},
  ): ExternalProposalRecord {
    return {
      id: "ext-1",
      source: "polsia",
      department: "sales",
      title: "x",
      proposedAction: "x",
      evidence: { claim: "x" },
      riskClass: "draft_only",
      flags: [],
      status: "queued",
      createdAt: "2026-05-02T19:00:00.000Z",
      updatedAt: "2026-05-02T19:00:00.000Z",
      ...overrides,
    } as ExternalProposalRecord;
  }

  it("rolls up by status / department / source / flag", () => {
    const s = summarizeExternalProposals([
      rec({ id: "a", status: "queued", department: "sales", source: "polsia" }),
      rec({
        id: "b",
        status: "reviewed",
        department: "marketing",
        source: "reevo",
        flags: ["claims_direct_mutation"],
      }),
      rec({
        id: "c",
        status: "promoted",
        department: "sales",
        source: "claude-code",
      }),
      rec({
        id: "d",
        status: "rejected",
        department: "finance",
        source: "openai-workspace",
      }),
    ]);
    expect(s.total).toBe(4);
    expect(s.queued).toBe(1);
    expect(s.reviewed).toBe(1);
    expect(s.promoted).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.byDepartment.sales).toBe(2);
    expect(s.byDepartment.marketing).toBe(1);
    expect(s.bySource.polsia).toBe(1);
    expect(s.bySource.reevo).toBe(1);
    expect(s.flaggedDirectMutation).toBe(1);
  });

  it("topQueued is newest-first across queued only", () => {
    const s = summarizeExternalProposals([
      rec({
        id: "old-queued",
        status: "queued",
        createdAt: "2026-05-01T00:00:00.000Z",
      }),
      rec({
        id: "new-queued",
        status: "queued",
        createdAt: "2026-05-02T20:00:00.000Z",
      }),
      rec({
        id: "promoted",
        status: "promoted",
        createdAt: "2026-05-02T21:00:00.000Z",
      }),
    ]);
    expect(s.topQueued.map((r) => r.id)).toEqual([
      "new-queued",
      "old-queued",
    ]);
  });
});
