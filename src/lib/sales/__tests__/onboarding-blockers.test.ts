import { describe, expect, it } from "vitest";

import {
  newOnboardingState,
  type OnboardingState,
  type OnboardingStep,
} from "@/lib/wholesale/onboarding-flow";
import {
  DEFAULT_STALL_HOURS,
  STEP_NEXT_ACTIONS,
  classifyOnboardingBlocker,
  isFlowStalled,
  summarizeOnboardingBlockers,
} from "@/lib/sales/onboarding-blockers";

const NOW = new Date("2026-04-30T15:00:00.000Z");

// Order from ONBOARDING_STEPS in onboarding-flow.ts. Used to populate
// `stepsCompleted` correctly so `nextStep(state)` returns the right
// signal — terminal flows have ALL steps in stepsCompleted; stalled
// flows have stepsCompleted up-to-but-not-including currentStep.
const ALL_STEPS_IN_ORDER: OnboardingStep[] = [
  "info",
  "store-type",
  "pricing-shown",
  "order-type",
  "payment-path",
  "ap-info",
  "order-captured",
  "shipping-info",
  "ap-email-sent",
  "qbo-customer-staged",
  "crm-updated",
];

function flow(opts: {
  flowId: string;
  currentStep: OnboardingStep;
  lastTimestamp?: string | null;
  companyName?: string | null;
  hubspotDealId?: string;
  withOrderLine?: boolean;
  /** Override the default stepsCompleted (defaults to all steps BEFORE currentStep). */
  stepsCompleted?: OnboardingStep[];
}): OnboardingState {
  const base = newOnboardingState(opts.flowId);
  const ts = opts.lastTimestamp === undefined ? "2026-04-25T15:00:00.000Z" : opts.lastTimestamp;
  const timestamps = ts ? { [opts.currentStep]: ts } : {};
  // Default stepsCompleted: all steps strictly before currentStep, so
  // `nextStep` correctly returns currentStep itself (= "this is where
  // the flow is parked"). For terminal-state tests, override with the
  // full list including the terminal step.
  const idx = ALL_STEPS_IN_ORDER.indexOf(opts.currentStep);
  const defaultCompleted = ALL_STEPS_IN_ORDER.slice(0, Math.max(0, idx));
  const stepsCompleted = opts.stepsCompleted ?? defaultCompleted;
  return {
    ...base,
    currentStep: opts.currentStep,
    stepsCompleted,
    timestamps,
    prospect: opts.companyName
      ? {
          companyName: opts.companyName,
          contactName: "Test Buyer",
          contactEmail: "buyer@test.com",
          contactPhone: "555-1212",
        }
      : undefined,
    hubspotDealId: opts.hubspotDealId,
    orderLines: opts.withOrderLine
      ? [
          {
            tier: "B2",
            unitCount: 2,
            unitLabel: "Master carton (landed)",
            bags: 72,
            bagPriceUsd: 3.49,
            subtotalUsd: 251.28,
            freightMode: "landed",
            invoiceLabel: "All American Gummy Bears",
            customFreightRequired: false,
          },
        ]
      : [],
  };
}

describe("isFlowStalled — pure stall predicate", () => {
  it("flags a flow with non-null nextStep + lastTimestamp older than threshold", () => {
    const f = flow({
      flowId: "f1",
      currentStep: "payment-path",
      lastTimestamp: "2026-04-25T15:00:00.000Z", // 5d ago
    });
    expect(isFlowStalled(f, NOW, DEFAULT_STALL_HOURS)).toBe(true);
  });

  it("does NOT flag a flow within the stall threshold", () => {
    const f = flow({
      flowId: "f1",
      currentStep: "payment-path",
      lastTimestamp: "2026-04-30T10:00:00.000Z", // 5h ago
    });
    expect(isFlowStalled(f, NOW, DEFAULT_STALL_HOURS)).toBe(false);
  });

  it("does NOT flag a flow at the terminal step (nextStep is null)", () => {
    // For nextStep to return null, ALL steps must be in stepsCompleted —
    // including the terminal step itself.
    const f = flow({
      flowId: "f1",
      currentStep: "crm-updated",
      lastTimestamp: "2026-04-01T15:00:00.000Z", // very old
      stepsCompleted: [
        "info",
        "store-type",
        "pricing-shown",
        "order-type",
        "payment-path",
        "ap-info",
        "order-captured",
        "shipping-info",
        "ap-email-sent",
        "qbo-customer-staged",
        "crm-updated",
      ],
    });
    expect(isFlowStalled(f, NOW, DEFAULT_STALL_HOURS)).toBe(false);
  });

  it("does NOT flag a flow with no timestamps yet", () => {
    const f = flow({
      flowId: "f1",
      currentStep: "info",
      lastTimestamp: null,
    });
    expect(isFlowStalled(f, NOW, DEFAULT_STALL_HOURS)).toBe(false);
  });

  it("respects custom stallHours override", () => {
    const f = flow({
      flowId: "f1",
      currentStep: "payment-path",
      lastTimestamp: "2026-04-30T05:00:00.000Z", // 10h ago
    });
    expect(isFlowStalled(f, NOW, 8)).toBe(true);
    expect(isFlowStalled(f, NOW, 24)).toBe(false);
  });

  it("treats invalid lastTimestamp as not-stalled (defensive)", () => {
    const base = newOnboardingState("f1");
    const f: OnboardingState = {
      ...base,
      currentStep: "payment-path",
      timestamps: { "payment-path": "not-a-date" },
    };
    expect(isFlowStalled(f, NOW, DEFAULT_STALL_HOURS)).toBe(false);
  });
});

describe("classifyOnboardingBlocker — single-flow projection", () => {
  it("returns OnboardingBlocker when flow is stalled", () => {
    const f = flow({
      flowId: "f1",
      currentStep: "payment-path",
      companyName: "Bryce Glamp & Camp",
      lastTimestamp: "2026-04-26T15:00:00.000Z", // 4d
    });
    const b = classifyOnboardingBlocker(f, NOW, DEFAULT_STALL_HOURS);
    expect(b).not.toBeNull();
    expect(b!.flowId).toBe("f1");
    expect(b!.displayName).toBe("Bryce Glamp & Camp");
    expect(b!.currentStep).toBe("payment-path");
    expect(b!.daysSinceLastTouch).toBe(4);
    expect(b!.nextAction).toBe(STEP_NEXT_ACTIONS["payment-path"]);
  });

  it("returns null for a non-stalled flow", () => {
    const f = flow({
      flowId: "f1",
      currentStep: "payment-path",
      lastTimestamp: "2026-04-30T10:00:00.000Z",
    });
    expect(classifyOnboardingBlocker(f, NOW, DEFAULT_STALL_HOURS)).toBeNull();
  });

  it("falls back to truncated flowId when companyName is missing", () => {
    const f = flow({
      flowId: "abc12345-xyz",
      currentStep: "payment-path",
      lastTimestamp: "2026-04-25T15:00:00.000Z",
    });
    const b = classifyOnboardingBlocker(f, NOW, DEFAULT_STALL_HOURS);
    expect(b!.displayName).toMatch(/^\(flow abc12345/);
  });

  it("includes totalSubtotalUsd when an order line exists", () => {
    const f = flow({
      flowId: "f1",
      currentStep: "shipping-info",
      lastTimestamp: "2026-04-25T15:00:00.000Z",
      withOrderLine: true,
    });
    const b = classifyOnboardingBlocker(f, NOW, DEFAULT_STALL_HOURS);
    expect(b!.totalSubtotalUsd).toBe(251.28);
  });

  it("omits totalSubtotalUsd when no order lines", () => {
    const f = flow({
      flowId: "f1",
      currentStep: "info",
      lastTimestamp: "2026-04-25T15:00:00.000Z",
    });
    const b = classifyOnboardingBlocker(f, NOW, DEFAULT_STALL_HOURS);
    expect(b!.totalSubtotalUsd).toBeUndefined();
  });
});

describe("summarizeOnboardingBlockers", () => {
  it("empty input → zero summary", () => {
    const r = summarizeOnboardingBlockers([], NOW, NOW.toISOString());
    expect(r.flowsScanned).toBe(0);
    expect(r.stalledTotal).toBe(0);
    expect(r.topBlockers).toEqual([]);
    expect(r.byStep).toEqual([]);
    expect(r.stallHours).toBe(DEFAULT_STALL_HOURS);
    expect(r.source).toEqual({
      system: "wholesale-onboarding-kv",
      retrievedAt: NOW.toISOString(),
    });
  });

  it("counts stalled flows in stalledTotal but all flows in flowsScanned", () => {
    const flows = [
      flow({ flowId: "f1", currentStep: "payment-path", lastTimestamp: "2026-04-25T15:00:00.000Z" }), // stalled
      flow({ flowId: "f2", currentStep: "payment-path", lastTimestamp: "2026-04-30T14:00:00.000Z" }), // fresh
      flow({ flowId: "f3", currentStep: "ap-info", lastTimestamp: "2026-04-20T15:00:00.000Z" }), // stalled
      flow({
        flowId: "f4",
        currentStep: "crm-updated",
        lastTimestamp: "2026-04-01T15:00:00.000Z",
        stepsCompleted: ALL_STEPS_IN_ORDER, // terminal — all steps done
      }),
    ];
    const r = summarizeOnboardingBlockers(flows, NOW, NOW.toISOString());
    expect(r.flowsScanned).toBe(4);
    expect(r.stalledTotal).toBe(2);
    expect(r.topBlockers.map((b) => b.flowId).sort()).toEqual(["f1", "f3"]);
    expect(r.byStep.map((b) => b.step).sort()).toEqual(["ap-info", "payment-path"]);
  });

  it("sorts topBlockers by daysSinceLastTouch desc", () => {
    const flows = [
      flow({ flowId: "5d", currentStep: "payment-path", lastTimestamp: "2026-04-25T15:00:00.000Z" }),
      flow({ flowId: "10d", currentStep: "payment-path", lastTimestamp: "2026-04-20T15:00:00.000Z" }),
      flow({ flowId: "2d", currentStep: "payment-path", lastTimestamp: "2026-04-28T15:00:00.000Z" }),
    ];
    const r = summarizeOnboardingBlockers(flows, NOW, NOW.toISOString());
    expect(r.topBlockers.map((b) => b.flowId)).toEqual(["10d", "5d", "2d"]);
  });

  it("respects topN limit", () => {
    const flows = Array.from({ length: 20 }, (_, i) =>
      flow({
        flowId: `f${i}`,
        currentStep: "payment-path",
        lastTimestamp: "2026-04-20T15:00:00.000Z",
      }),
    );
    const r = summarizeOnboardingBlockers(flows, NOW, NOW.toISOString(), { topN: 5 });
    expect(r.topBlockers).toHaveLength(5);
    expect(r.stalledTotal).toBe(20);
  });

  it("respects custom stallHours override", () => {
    const flows = [
      flow({ flowId: "f1", currentStep: "payment-path", lastTimestamp: "2026-04-30T05:00:00.000Z" }), // 10h
    ];
    const lenient = summarizeOnboardingBlockers(flows, NOW, NOW.toISOString(), { stallHours: 24 });
    expect(lenient.stalledTotal).toBe(0);
    const strict = summarizeOnboardingBlockers(flows, NOW, NOW.toISOString(), { stallHours: 8 });
    expect(strict.stalledTotal).toBe(1);
  });

  it("byStep counts only stalled flows; terminal flows are excluded", () => {
    const flows = [
      flow({ flowId: "f1", currentStep: "payment-path", lastTimestamp: "2026-04-25T15:00:00.000Z" }),
      flow({ flowId: "f2", currentStep: "payment-path", lastTimestamp: "2026-04-25T15:00:00.000Z" }),
      flow({
        flowId: "f3",
        currentStep: "crm-updated",
        lastTimestamp: "2026-04-01T15:00:00.000Z",
        stepsCompleted: ALL_STEPS_IN_ORDER, // terminal
      }),
    ];
    const r = summarizeOnboardingBlockers(flows, NOW, NOW.toISOString());
    expect(r.byStep).toEqual([{ step: "payment-path", count: 2 }]);
  });
});

describe("STEP_NEXT_ACTIONS — every step has a next-action", () => {
  it("every OnboardingStep has a non-empty next-action template", () => {
    const allSteps: OnboardingStep[] = [
      "info",
      "store-type",
      "pricing-shown",
      "order-type",
      "payment-path",
      "ap-info",
      "order-captured",
      "shipping-info",
      "ap-email-sent",
      "qbo-customer-staged",
      "crm-updated",
    ];
    for (const step of allSteps) {
      expect(STEP_NEXT_ACTIONS[step]).toBeTruthy();
      expect(STEP_NEXT_ACTIONS[step].length).toBeGreaterThan(10);
    }
  });
});
