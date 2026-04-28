/**
 * Phase 35.e — KV persistence layer tests for OnboardingState.
 *
 * Locks the doctrinal invariants from `onboarding-store.ts`:
 *   - Round-trip: save → load returns the persisted state.
 *   - Idempotent overwrite — save with same flowId replaces.
 *   - Index dedupes by id (no duplicate ids ever in the index).
 *   - `loadOnboardingState` returns null on missing / corrupt records.
 *     NEVER fabricates a fresh state.
 *   - `listRecentFlows` returns most-recent first, bounded by limit.
 *   - `mintFlowId` returns URL-safe, prefixed ids.
 *   - `saveOnboardingState` rejects empty flowId.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnboardingState } from "../onboarding-flow";

// In-memory KV mock — same pattern as inquiries.test.ts.
const store = new Map<string, unknown>();

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

import {
  __INTERNAL,
  listRecentAuditEnvelopes,
  listRecentFlows,
  loadOnboardingState,
  mintFlowId,
  readAuditEnvelope,
  readOrderCapturedSnapshot,
  saveOnboardingState,
  writeAuditEnvelope,
  writeOrderCapturedSnapshot,
  type AuditEnvelope,
} from "../onboarding-store";

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeState(flowId: string, overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    flowId,
    currentStep: "info",
    stepsCompleted: [],
    orderLines: [],
    timestamps: {},
    ...overrides,
  };
}

describe("mintFlowId", () => {
  it("returns a string with the wf_ prefix", () => {
    const id = mintFlowId();
    expect(id).toMatch(/^wf_/);
    expect(id.length).toBeGreaterThan(10);
  });

  it("generates unique ids on successive calls", () => {
    const a = mintFlowId();
    const b = mintFlowId();
    expect(a).not.toBe(b);
  });
});

describe("saveOnboardingState + loadOnboardingState round-trip", () => {
  it("persists and reads back the full state", async () => {
    const state = makeState("wf_test_001", {
      currentStep: "store-type",
      stepsCompleted: ["info"],
      prospect: {
        companyName: "Acme Co",
        contactName: "Jane Doe",
        contactEmail: "jane@acme.test",
      },
      timestamps: { info: "2026-04-27T20:00:00.000Z" },
    });
    await saveOnboardingState(state);
    const loaded = await loadOnboardingState("wf_test_001");
    expect(loaded).not.toBeNull();
    expect(loaded?.flowId).toBe("wf_test_001");
    expect(loaded?.currentStep).toBe("store-type");
    expect(loaded?.prospect?.companyName).toBe("Acme Co");
    expect(loaded?.timestamps.info).toBe("2026-04-27T20:00:00.000Z");
  });

  it("overwrites cleanly on second save (idempotent)", async () => {
    await saveOnboardingState(makeState("wf_001", { currentStep: "info" }));
    await saveOnboardingState(
      makeState("wf_001", { currentStep: "shipping-info" }),
    );
    const loaded = await loadOnboardingState("wf_001");
    expect(loaded?.currentStep).toBe("shipping-info");
  });
});

describe("loadOnboardingState — honest reads", () => {
  it("returns null for missing flow (NEVER a fabricated empty state)", async () => {
    const loaded = await loadOnboardingState("wf_does_not_exist");
    expect(loaded).toBeNull();
  });

  it("returns null for empty flowId", async () => {
    expect(await loadOnboardingState("")).toBeNull();
    expect(await loadOnboardingState("   ")).toBeNull();
  });

  it("returns null on JSON corruption (defensive)", async () => {
    store.set(__INTERNAL.recordKey("wf_corrupt"), "{not json");
    const loaded = await loadOnboardingState("wf_corrupt");
    expect(loaded).toBeNull();
  });
});

describe("saveOnboardingState — input validation", () => {
  it("throws on empty flowId", async () => {
    await expect(
      saveOnboardingState(makeState("")),
    ).rejects.toThrow(/flowId required/);
  });

  it("throws on whitespace-only flowId", async () => {
    await expect(
      saveOnboardingState(makeState("   ")),
    ).rejects.toThrow(/flowId required/);
  });
});

describe("index management", () => {
  it("dedupes the index when re-saving the same flowId", async () => {
    await saveOnboardingState(makeState("wf_a"));
    await saveOnboardingState(makeState("wf_b"));
    await saveOnboardingState(makeState("wf_a")); // re-save
    const idx = await __INTERNAL.readIndex();
    expect(idx.filter((id) => id === "wf_a").length).toBe(1);
  });

  it("puts the most-recently-saved id at the head of the index", async () => {
    await saveOnboardingState(makeState("wf_old"));
    await saveOnboardingState(makeState("wf_new"));
    const idx = await __INTERNAL.readIndex();
    expect(idx[0]).toBe("wf_new");
    expect(idx[1]).toBe("wf_old");
  });

  it("re-saving an existing id moves it back to the head", async () => {
    await saveOnboardingState(makeState("wf_a"));
    await saveOnboardingState(makeState("wf_b"));
    await saveOnboardingState(makeState("wf_c"));
    await saveOnboardingState(makeState("wf_a")); // refresh wf_a
    const idx = await __INTERNAL.readIndex();
    expect(idx[0]).toBe("wf_a");
  });
});

describe("listRecentFlows", () => {
  it("returns an empty list when no flows are persisted", async () => {
    expect(await listRecentFlows()).toEqual([]);
  });

  it("returns flows in most-recent-first order", async () => {
    await saveOnboardingState(makeState("wf_1", { currentStep: "info" }));
    await saveOnboardingState(makeState("wf_2", { currentStep: "store-type" }));
    await saveOnboardingState(
      makeState("wf_3", { currentStep: "pricing-shown" }),
    );
    const flows = await listRecentFlows();
    expect(flows.map((f) => f.flowId)).toEqual(["wf_3", "wf_2", "wf_1"]);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await saveOnboardingState(makeState(`wf_${i}`));
    }
    const flows = await listRecentFlows({ limit: 2 });
    expect(flows.length).toBe(2);
  });

  it("clamps limit to [1, 500]", async () => {
    await saveOnboardingState(makeState("wf_a"));
    await saveOnboardingState(makeState("wf_b"));
    // 0 / negative clamp up to 1 (always returns at least one).
    expect((await listRecentFlows({ limit: 0 })).length).toBe(1);
    expect((await listRecentFlows({ limit: -10 })).length).toBe(1);
    // Above-cap clamps to 500 (only 2 flows exist so we get 2).
    expect((await listRecentFlows({ limit: 999 })).length).toBe(2);
  });

  it("skips records that are missing from KV (best-effort index)", async () => {
    await saveOnboardingState(makeState("wf_a"));
    await saveOnboardingState(makeState("wf_b"));
    // Simulate TTL eviction of wf_a's record while leaving the
    // index intact (best-effort lag scenario).
    store.delete(__INTERNAL.recordKey("wf_a"));
    const flows = await listRecentFlows();
    expect(flows.map((f) => f.flowId)).toEqual(["wf_b"]);
  });
});

describe("writeOrderCapturedSnapshot + readOrderCapturedSnapshot", () => {
  it("persists a denormalized snapshot under its own key prefix", async () => {
    const state = makeState("wf_oc_001", {
      paymentPath: "accounts-payable",
      prospect: {
        companyName: "Acme",
        contactName: "Jane",
        contactEmail: "jane@acme.test",
      },
      orderLines: [
        {
          tier: "B2",
          unitCount: 3,
          unitLabel: "Master carton (landed)",
          bags: 108,
          bagPriceUsd: 3.49,
          subtotalUsd: 376.92,
          freightMode: "landed",
          invoiceLabel: "B2 — Master carton (36 bags), landed",
          customFreightRequired: false,
        },
      ],
    });
    const snap = await writeOrderCapturedSnapshot(
      state,
      new Date("2026-04-27T20:00:00.000Z"),
    );
    expect(snap.flowId).toBe("wf_oc_001");
    expect(snap.capturedAt).toBe("2026-04-27T20:00:00.000Z");
    expect(snap.paymentPath).toBe("accounts-payable");
    expect(snap.orderLines.length).toBe(1);
  });

  it("uses a key prefix distinct from the OnboardingState envelope", async () => {
    const state = makeState("wf_distinct");
    await saveOnboardingState(state);
    await writeOrderCapturedSnapshot(state);
    // Both keys should exist independently.
    expect(store.has(__INTERNAL.recordKey("wf_distinct"))).toBe(true);
    expect(store.has(__INTERNAL.orderCapturedKey("wf_distinct"))).toBe(true);
  });

  it("readOrderCapturedSnapshot round-trips the snapshot", async () => {
    const state = makeState("wf_rt");
    await writeOrderCapturedSnapshot(state);
    const got = await readOrderCapturedSnapshot("wf_rt");
    expect(got?.flowId).toBe("wf_rt");
  });

  it("readOrderCapturedSnapshot returns null on missing flow", async () => {
    expect(await readOrderCapturedSnapshot("wf_nope")).toBeNull();
    expect(await readOrderCapturedSnapshot("")).toBeNull();
  });

  it("readOrderCapturedSnapshot returns null on JSON corruption", async () => {
    store.set(__INTERNAL.orderCapturedKey("wf_corrupt"), "{not json");
    expect(await readOrderCapturedSnapshot("wf_corrupt")).toBeNull();
  });

  it("rejects writeOrderCapturedSnapshot on empty flowId", async () => {
    await expect(
      writeOrderCapturedSnapshot(makeState("")),
    ).rejects.toThrow(/flowId required/);
  });
});

describe("audit envelopes — write + read round-trip", () => {
  function makeEnv(
    flowId: string,
    overrides: Partial<AuditEnvelope> = {},
  ): AuditEnvelope {
    return {
      flowId,
      completedAt: new Date().toISOString(),
      stepsCompleted: ["info", "store-type", "crm-updated"],
      orderLineCount: 1,
      totalSubtotalUsd: 125.64,
      ...overrides,
    };
  }

  it("writes an envelope and reads it back", async () => {
    await writeAuditEnvelope(makeEnv("wf_audit_1"));
    const got = await readAuditEnvelope("wf_audit_1");
    expect(got?.flowId).toBe("wf_audit_1");
    expect(got?.totalSubtotalUsd).toBe(125.64);
  });

  it("readAuditEnvelope returns null for missing flow", async () => {
    expect(await readAuditEnvelope("wf_nope")).toBeNull();
    expect(await readAuditEnvelope("")).toBeNull();
  });

  it("readAuditEnvelope returns null on JSON corruption", async () => {
    store.set(__INTERNAL.auditKey("wf_corrupt"), "{not json");
    expect(await readAuditEnvelope("wf_corrupt")).toBeNull();
  });

  it("writeAuditEnvelope rejects empty flowId", async () => {
    await expect(
      writeAuditEnvelope(makeEnv("")),
    ).rejects.toThrow(/flowId required/);
  });

  it("writeAuditEnvelope rejects empty completedAt", async () => {
    await expect(
      writeAuditEnvelope({
        flowId: "wf_x",
        completedAt: "",
        stepsCompleted: [],
        orderLineCount: 0,
      }),
    ).rejects.toThrow(/completedAt required/);
  });

  it("re-writing same flowId dedupes the index", async () => {
    await writeAuditEnvelope(makeEnv("wf_a"));
    await writeAuditEnvelope(makeEnv("wf_b"));
    await writeAuditEnvelope(makeEnv("wf_a")); // re-save
    const idx = await __INTERNAL.readAuditIndex();
    expect(idx.filter((e) => e.flowId === "wf_a").length).toBe(1);
  });

  it("re-writing same flowId moves it to the head of the index", async () => {
    await writeAuditEnvelope(makeEnv("wf_old"));
    await writeAuditEnvelope(makeEnv("wf_new"));
    await writeAuditEnvelope(makeEnv("wf_old")); // refresh
    const idx = await __INTERNAL.readAuditIndex();
    expect(idx[0].flowId).toBe("wf_old");
  });
});

describe("listRecentAuditEnvelopes", () => {
  function makeEnv(
    flowId: string,
    completedAt: string,
    overrides: Partial<AuditEnvelope> = {},
  ): AuditEnvelope {
    return {
      flowId,
      completedAt,
      stepsCompleted: ["crm-updated"],
      orderLineCount: 1,
      ...overrides,
    };
  }

  it("returns empty list when no envelopes persisted", async () => {
    expect(await listRecentAuditEnvelopes()).toEqual([]);
  });

  it("returns envelopes in most-recent-first order", async () => {
    const t1 = new Date("2026-01-01").toISOString();
    const t2 = new Date("2026-02-01").toISOString();
    const t3 = new Date("2026-03-01").toISOString();
    await writeAuditEnvelope(makeEnv("wf_jan", t1));
    await writeAuditEnvelope(makeEnv("wf_feb", t2));
    await writeAuditEnvelope(makeEnv("wf_mar", t3));
    const got = await listRecentAuditEnvelopes();
    expect(got.map((e) => e.flowId)).toEqual(["wf_mar", "wf_feb", "wf_jan"]);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await writeAuditEnvelope(
        makeEnv(`wf_${i}`, new Date(Date.now() - i * 1000).toISOString()),
      );
    }
    const got = await listRecentAuditEnvelopes({ limit: 2 });
    expect(got.length).toBe(2);
  });

  it("withinDays filter excludes envelopes outside the window", async () => {
    const ancient = new Date(
      Date.now() - 90 * 24 * 3600 * 1000,
    ).toISOString();
    const recent = new Date(
      Date.now() - 5 * 24 * 3600 * 1000,
    ).toISOString();
    await writeAuditEnvelope(makeEnv("wf_ancient", ancient));
    await writeAuditEnvelope(makeEnv("wf_recent", recent));

    const got = await listRecentAuditEnvelopes({ withinDays: 30 });
    expect(got.map((e) => e.flowId)).toEqual(["wf_recent"]);
  });

  it("skips index entries whose envelope is missing (best-effort lag)", async () => {
    await writeAuditEnvelope(makeEnv("wf_a", new Date().toISOString()));
    await writeAuditEnvelope(makeEnv("wf_b", new Date().toISOString()));
    // Simulate TTL eviction of wf_a's envelope while leaving the
    // index intact.
    store.delete(__INTERNAL.auditKey("wf_a"));
    const got = await listRecentAuditEnvelopes();
    expect(got.map((e) => e.flowId)).toEqual(["wf_b"]);
  });
});

describe("constants", () => {
  it("uses the wholesale:flow: key prefix", () => {
    expect(__INTERNAL.KV_RECORD_PREFIX).toBe("wholesale:flow:");
  });

  it("indexes under wholesale:flow:index", () => {
    expect(__INTERNAL.KV_INDEX_KEY).toBe("wholesale:flow:index");
  });

  it("caps the index at 5,000", () => {
    expect(__INTERNAL.INDEX_CAP).toBe(5000);
  });

  it("expires per-record after 30 days", () => {
    expect(__INTERNAL.RECORD_TTL_SECONDS).toBe(30 * 24 * 3600);
  });

  it("uses wholesale:order-captured: prefix for snapshots", () => {
    expect(__INTERNAL.KV_ORDER_CAPTURED_PREFIX).toBe(
      "wholesale:order-captured:",
    );
  });

  it("expires order-captured snapshots after 90 days", () => {
    expect(__INTERNAL.ORDER_CAPTURED_TTL_SECONDS).toBe(90 * 24 * 3600);
  });

  it("uses wholesale:audit:flow-complete: prefix for audit envelopes", () => {
    expect(__INTERNAL.KV_AUDIT_PREFIX).toBe("wholesale:audit:flow-complete:");
  });

  it("indexes audit envelopes under wholesale:audit:flow-complete:index", () => {
    expect(__INTERNAL.KV_AUDIT_INDEX_KEY).toBe(
      "wholesale:audit:flow-complete:index",
    );
  });

  it("expires audit envelopes after 365 days (1 year)", () => {
    expect(__INTERNAL.AUDIT_TTL_SECONDS).toBe(365 * 24 * 3600);
  });
});
