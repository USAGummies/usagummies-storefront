/**
 * Phase 35.f.3 — onboarding side-effect dispatcher tests.
 *
 * Locked contracts:
 *   - Dispatcher routes each SideEffect.kind to the correct dep.
 *   - Failures don't abort the batch — every effect runs, failures
 *     collected into result.failures[].
 *   - hubspot.upsert-contact: missing state.prospect → ok:false
 *     (does NOT throw).
 *   - hubspot.create-deal / advance-stage / set-onboarding-complete
 *     surface the upstream stage / dealId correctly.
 *   - hubspot.advance-stage / set-onboarding-complete: missing
 *     state.hubspotDealId → ok:false (defense-in-depth).
 *   - Outputs (contactId, dealId, approvalId) are relayed via
 *     DispatchOutcome.output for the caller to persist.
 *   - dispatchSideEffects([]) returns successCount=0, failureCount=0.
 *   - Thrown exceptions in a handler convert to ok:false outcomes,
 *     don't crash the batch.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  OnboardingState,
  SideEffect,
} from "../onboarding-flow";
import {
  dispatchSideEffects,
  type DispatchDeps,
} from "../onboarding-dispatch";

function buildDeps(overrides: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    hubspotUpsertContact: vi.fn(async () => ({
      ok: true as const,
      contactId: "C-100",
    })),
    hubspotCreateDeal: vi.fn(async () => ({
      ok: true as const,
      dealId: "D-200",
    })),
    hubspotAdvanceStage: vi.fn(async () => ({ ok: true as const })),
    hubspotSetOnboardingComplete: vi.fn(async () => ({ ok: true as const })),
    kvArchiveInquiry: vi.fn(async () => ({ ok: true as const })),
    kvWriteOrderCaptured: vi.fn(async () => ({ ok: true as const })),
    slackPostFinancialsNotif: vi.fn(async () => ({
      ok: true as const,
      ts: "1234.5678",
    })),
    apPacketSend: vi.fn(async () => ({ ok: true as const })),
    qboStageVendorMasterApproval: vi.fn(async () => ({
      ok: true as const,
      approvalId: "A-300",
    })),
    auditFlowComplete: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

function buildState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    flowId: "wf_test_001",
    currentStep: "store-type",
    stepsCompleted: ["info"],
    orderLines: [],
    timestamps: {},
    prospect: {
      companyName: "Acme Co",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
      contactPhone: "555-1212",
    },
    ...overrides,
  };
}

describe("dispatchSideEffects — empty input", () => {
  it("returns zero counts for an empty effect list", async () => {
    const r = await dispatchSideEffects(buildState(), [], buildDeps());
    expect(r.successCount).toBe(0);
    expect(r.failureCount).toBe(0);
    expect(r.outcomes).toEqual([]);
    expect(r.failures).toEqual([]);
  });
});

describe("dispatchSideEffects — hubspot.upsert-contact", () => {
  it("calls deps.hubspotUpsertContact with split firstname/lastname", async () => {
    const deps = buildDeps();
    await dispatchSideEffects(
      buildState(),
      [{ kind: "hubspot.upsert-contact" }],
      deps,
    );
    expect(deps.hubspotUpsertContact).toHaveBeenCalledWith({
      email: "jane@acme.test",
      firstname: "Jane",
      lastname: "Doe",
      company: "Acme Co",
      phone: "555-1212",
    });
  });

  it("relays contactId in DispatchOutcome.output", async () => {
    const r = await dispatchSideEffects(
      buildState(),
      [{ kind: "hubspot.upsert-contact" }],
      buildDeps(),
    );
    expect(r.outcomes[0].output?.contactId).toBe("C-100");
  });

  it("ok:false when state.prospect is missing (does NOT throw)", async () => {
    const r = await dispatchSideEffects(
      buildState({ prospect: undefined }),
      [{ kind: "hubspot.upsert-contact" }],
      buildDeps(),
    );
    expect(r.failureCount).toBe(1);
    expect(r.outcomes[0].error).toMatch(/prospect missing/);
  });

  it("propagates dep failure as ok:false outcome", async () => {
    const r = await dispatchSideEffects(
      buildState(),
      [{ kind: "hubspot.upsert-contact" }],
      buildDeps({
        hubspotUpsertContact: vi.fn(async () => ({
          ok: false as const,
          error: "rate limit",
        })),
      }),
    );
    expect(r.outcomes[0].ok).toBe(false);
    expect(r.outcomes[0].error).toBe("rate limit");
  });
});

describe("dispatchSideEffects — hubspot.create-deal", () => {
  it("relays dealId in output + builds dealName from prospect", async () => {
    const deps = buildDeps();
    const r = await dispatchSideEffects(
      buildState(),
      [{ kind: "hubspot.create-deal", stage: "STAGE_LEAD" }],
      deps,
    );
    expect(r.outcomes[0].output?.dealId).toBe("D-200");
    const call = (
      deps.hubspotCreateDeal as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(call.dealName).toMatch(/Acme Co/);
    expect(call.stage).toBe("STAGE_LEAD");
    expect(call.properties.wholesale_flow_id).toBe("wf_test_001");
  });

  it("ok:false when prospect missing", async () => {
    const r = await dispatchSideEffects(
      buildState({ prospect: undefined }),
      [{ kind: "hubspot.create-deal", stage: "X" }],
      buildDeps(),
    );
    expect(r.outcomes[0].ok).toBe(false);
  });
});

describe("dispatchSideEffects — hubspot.advance-stage", () => {
  it("calls deps with state.hubspotDealId + effect.stage", async () => {
    const deps = buildDeps();
    await dispatchSideEffects(
      buildState({ hubspotDealId: "D-555" }),
      [{ kind: "hubspot.advance-stage", stage: "pending_ap_approval" }],
      deps,
    );
    expect(deps.hubspotAdvanceStage).toHaveBeenCalledWith({
      dealId: "D-555",
      stage: "pending_ap_approval",
    });
  });

  it("ok:false when hubspotDealId missing", async () => {
    const r = await dispatchSideEffects(
      buildState(),
      [{ kind: "hubspot.advance-stage", stage: "X" }],
      buildDeps(),
    );
    expect(r.outcomes[0].ok).toBe(false);
    expect(r.outcomes[0].error).toMatch(/hubspotDealId missing/);
  });
});

describe("dispatchSideEffects — hubspot.set-onboarding-complete", () => {
  it("calls deps with state.hubspotDealId + effect.value", async () => {
    const deps = buildDeps();
    await dispatchSideEffects(
      buildState({ hubspotDealId: "D-777" }),
      [{ kind: "hubspot.set-onboarding-complete", value: true }],
      deps,
    );
    expect(deps.hubspotSetOnboardingComplete).toHaveBeenCalledWith({
      dealId: "D-777",
      value: true,
    });
  });

  it("ok:false when hubspotDealId missing", async () => {
    const r = await dispatchSideEffects(
      buildState(),
      [{ kind: "hubspot.set-onboarding-complete", value: true }],
      buildDeps(),
    );
    expect(r.outcomes[0].ok).toBe(false);
  });
});

describe("dispatchSideEffects — kv handlers", () => {
  it("calls kvArchiveInquiry with state", async () => {
    const deps = buildDeps();
    await dispatchSideEffects(
      buildState(),
      [{ kind: "kv.archive-inquiry" }],
      deps,
    );
    expect(deps.kvArchiveInquiry).toHaveBeenCalledTimes(1);
  });

  it("calls kvWriteOrderCaptured with state", async () => {
    const deps = buildDeps();
    await dispatchSideEffects(
      buildState(),
      [{ kind: "kv.write-order-captured" }],
      deps,
    );
    expect(deps.kvWriteOrderCaptured).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchSideEffects — slack", () => {
  it("relays Slack ts in output", async () => {
    const r = await dispatchSideEffects(
      buildState(),
      [{ kind: "slack.post-financials-notif" }],
      buildDeps(),
    );
    expect(r.outcomes[0].output?.ts).toBe("1234.5678");
  });
});

describe("dispatchSideEffects — ap-packet.send", () => {
  it("forwards effect.template to deps.apPacketSend", async () => {
    const deps = buildDeps();
    await dispatchSideEffects(
      buildState(),
      [{ kind: "ap-packet.send", template: "wholesale-ap" }],
      deps,
    );
    const call = (deps.apPacketSend as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.template).toBe("wholesale-ap");
  });
});

describe("dispatchSideEffects — qbo approval staging", () => {
  it("relays approvalId in output", async () => {
    const r = await dispatchSideEffects(
      buildState(),
      [{ kind: "qbo.vendor-master-create.stage-approval" }],
      buildDeps(),
    );
    expect(r.outcomes[0].output?.approvalId).toBe("A-300");
  });
});

describe("dispatchSideEffects — audit.flow-complete", () => {
  it("calls deps.auditFlowComplete", async () => {
    const deps = buildDeps();
    await dispatchSideEffects(
      buildState(),
      [{ kind: "audit.flow-complete" }],
      deps,
    );
    expect(deps.auditFlowComplete).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchSideEffects — failure isolation", () => {
  it("a failed effect does NOT abort the batch", async () => {
    const deps = buildDeps({
      kvArchiveInquiry: vi.fn(async () => ({
        ok: false as const,
        error: "kv down",
      })),
    });
    const effects: SideEffect[] = [
      { kind: "kv.archive-inquiry" },
      { kind: "hubspot.upsert-contact" }, // this should still run
    ];
    const r = await dispatchSideEffects(buildState(), effects, deps);
    expect(r.successCount).toBe(1);
    expect(r.failureCount).toBe(1);
    expect(deps.hubspotUpsertContact).toHaveBeenCalledTimes(1);
  });

  it("collects every failure into result.failures[]", async () => {
    const deps = buildDeps({
      kvArchiveInquiry: vi.fn(async () => ({
        ok: false as const,
        error: "a",
      })),
      slackPostFinancialsNotif: vi.fn(async () => ({
        ok: false as const,
        error: "b",
      })),
    });
    const r = await dispatchSideEffects(
      buildState(),
      [
        { kind: "kv.archive-inquiry" },
        { kind: "slack.post-financials-notif" },
      ],
      deps,
    );
    expect(r.failures.map((f) => f.error)).toEqual(["a", "b"]);
  });

  it("a thrown exception in a handler converts to ok:false (does not crash batch)", async () => {
    const deps = buildDeps({
      kvArchiveInquiry: vi.fn(async () => {
        throw new Error("network reset");
      }),
    });
    const r = await dispatchSideEffects(
      buildState(),
      [
        { kind: "kv.archive-inquiry" },
        { kind: "hubspot.upsert-contact" },
      ],
      deps,
    );
    expect(r.successCount).toBe(1);
    expect(r.failures[0].error).toBe("network reset");
  });
});

describe("dispatchSideEffects — preserves input order", () => {
  it("outcomes appear in the same order as input effects", async () => {
    const r = await dispatchSideEffects(
      buildState(),
      [
        { kind: "audit.flow-complete" },
        { kind: "hubspot.upsert-contact" },
        { kind: "slack.post-financials-notif" },
      ],
      buildDeps(),
    );
    expect(r.outcomes.map((o) => o.kind)).toEqual([
      "audit.flow-complete",
      "hubspot.upsert-contact",
      "slack.post-financials-notif",
    ]);
  });
});
