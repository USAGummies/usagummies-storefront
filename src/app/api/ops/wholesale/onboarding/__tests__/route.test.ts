/**
 * Phase 35.f.5 — GET /api/ops/wholesale/onboarding tests.
 *
 * Locked contracts:
 *   - 401 when isAuthorized rejects (auth-gated).
 *   - 200 with { ok:true, total, flows } when KV reachable.
 *   - 200 with empty flows[] when no flows in KV.
 *   - 500 when KV throws (no fabricated zero).
 *   - limit clamped to [1, 500] server-side.
 *   - stallHours clamped to [1, 720] server-side.
 *   - stalled flag computed from lastTimestamp + stallMs.
 *   - stalledOnly=true filters to stalled flows only.
 *   - totalSubtotalUsd summed from orderLines.
 *   - hubspotDealId / qboCustomerApprovalId surfaced when present.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const store = new Map<string, unknown>();
let kvShouldThrow = false;

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => {
      if (kvShouldThrow) throw new Error("ECONNREFUSED");
      return store.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

import {
  saveOnboardingState,
  __INTERNAL,
} from "@/lib/wholesale/onboarding-store";
import type { OnboardingState } from "@/lib/wholesale/onboarding-flow";

beforeEach(() => {
  store.clear();
  kvShouldThrow = false;
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildReq(qs: string = ""): Request {
  return new Request(
    `http://localhost/api/ops/wholesale/onboarding${qs}`,
    { method: "GET" },
  );
}

function makeState(
  flowId: string,
  overrides: Partial<OnboardingState> = {},
): OnboardingState {
  return {
    flowId,
    currentStep: "store-type",
    stepsCompleted: ["info"],
    orderLines: [],
    timestamps: {},
    ...overrides,
  };
}

interface OnboardingResponse {
  ok: boolean;
  total?: number;
  stallHours?: number;
  flows?: {
    flowId: string;
    currentStep: string;
    completedCount: number;
    nextStep: string | null;
    stalled: boolean;
    totalSubtotalUsd: number;
    orderLineCount: number;
    prospect?: { companyName: string };
    hubspotDealId?: string;
    qboCustomerApprovalId?: string;
    paymentPath?: string;
    lastTimestamp?: string;
  }[];
  error?: string;
}

describe("GET /api/ops/wholesale/onboarding — auth", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValue(false);
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/ops/wholesale/onboarding — empty + happy paths", () => {
  it("returns ok:true with empty flows[] when KV has no flows", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as OnboardingResponse;
    expect(body.ok).toBe(true);
    expect(body.total).toBe(0);
    expect(body.flows).toEqual([]);
  });

  it("returns persisted flows in most-recent-first order", async () => {
    await saveOnboardingState(makeState("wf_oldest"));
    await saveOnboardingState(makeState("wf_middle"));
    await saveOnboardingState(makeState("wf_newest"));

    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as OnboardingResponse;
    expect(body.ok).toBe(true);
    expect(body.total).toBe(3);
    expect(body.flows?.map((f) => f.flowId)).toEqual([
      "wf_newest",
      "wf_middle",
      "wf_oldest",
    ]);
  });

  it("returns 500 (not fabricated zero) when KV throws", async () => {
    await saveOnboardingState(makeState("wf_x")); // populate index
    kvShouldThrow = true;
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as OnboardingResponse;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("kv_read_failed");
  });
});

describe("GET /api/ops/wholesale/onboarding — limit + stallHours clamp", () => {
  it("clamps limit to [1, 500]", async () => {
    const { GET } = await import("../route");
    // Populate 3 flows
    for (let i = 0; i < 3; i++) {
      await saveOnboardingState(makeState(`wf_${i}`));
    }
    const r1 = await GET(buildReq("?limit=2"));
    expect((await r1.json() as OnboardingResponse).total).toBe(2);

    const r2 = await GET(buildReq("?limit=99999"));
    // 500 cap; we have 3 so all 3 returned
    expect((await r2.json() as OnboardingResponse).total).toBe(3);

    const r3 = await GET(buildReq("?limit=0"));
    // 0 clamped to 1
    expect((await r3.json() as OnboardingResponse).total).toBe(1);
  });

  it("clamps stallHours to [1, 720]", async () => {
    const { GET } = await import("../route");
    const r1 = await GET(buildReq("?stallHours=12"));
    expect((await r1.json() as OnboardingResponse).stallHours).toBe(12);

    const r2 = await GET(buildReq("?stallHours=99999"));
    expect((await r2.json() as OnboardingResponse).stallHours).toBe(720);

    const r3 = await GET(buildReq("?stallHours=0"));
    expect((await r3.json() as OnboardingResponse).stallHours).toBe(1);
  });
});

describe("GET /api/ops/wholesale/onboarding — stalled detection", () => {
  it("flags a flow as stalled when lastTimestamp is older than stallMs", async () => {
    const stale = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    await saveOnboardingState(
      makeState("wf_stale", {
        timestamps: { info: stale },
      }),
    );
    const { GET } = await import("../route");
    const res = await GET(buildReq("?stallHours=24"));
    const body = (await res.json()) as OnboardingResponse;
    expect(body.flows?.[0].stalled).toBe(true);
  });

  it("does NOT flag a recently-touched flow as stalled", async () => {
    const fresh = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    await saveOnboardingState(
      makeState("wf_fresh", {
        timestamps: { info: fresh },
      }),
    );
    const { GET } = await import("../route");
    const res = await GET(buildReq("?stallHours=24"));
    const body = (await res.json()) as OnboardingResponse;
    expect(body.flows?.[0].stalled).toBe(false);
  });

  it("does NOT flag a completed flow as stalled (nextStep === null)", async () => {
    const long_ago = new Date(Date.now() - 1000 * 3600 * 1000).toISOString();
    await saveOnboardingState(
      makeState("wf_done", {
        currentStep: "crm-updated",
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
        paymentPath: "accounts-payable",
        timestamps: { "crm-updated": long_ago },
      }),
    );
    const { GET } = await import("../route");
    const res = await GET(buildReq("?stallHours=24"));
    const body = (await res.json()) as OnboardingResponse;
    expect(body.flows?.[0].stalled).toBe(false);
  });

  it("stalledOnly=true filters out non-stalled flows", async () => {
    const stale = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const fresh = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    await saveOnboardingState(
      makeState("wf_a", { timestamps: { info: stale } }),
    );
    await saveOnboardingState(
      makeState("wf_b", { timestamps: { info: fresh } }),
    );
    const { GET } = await import("../route");
    const res = await GET(buildReq("?stalledOnly=true"));
    const body = (await res.json()) as OnboardingResponse;
    expect(body.flows?.map((f) => f.flowId)).toEqual(["wf_a"]);
  });
});

describe("GET /api/ops/wholesale/onboarding — derived fields", () => {
  it("sums totalSubtotalUsd from orderLines", async () => {
    await saveOnboardingState(
      makeState("wf_sum", {
        orderLines: [
          {
            tier: "B2",
            unitCount: 3,
            unitLabel: "Master carton (landed)",
            bags: 108,
            bagPriceUsd: 3.49,
            subtotalUsd: 376.92,
            freightMode: "landed",
            invoiceLabel: "B2",
            customFreightRequired: false,
          },
          {
            tier: "B4",
            unitCount: 1,
            unitLabel: "Pallet (landed)",
            bags: 432,
            bagPriceUsd: 3.25,
            subtotalUsd: 1404.0,
            freightMode: "landed",
            invoiceLabel: "B4",
            customFreightRequired: false,
          },
        ],
      }),
    );
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as OnboardingResponse;
    expect(body.flows?.[0].orderLineCount).toBe(2);
    expect(body.flows?.[0].totalSubtotalUsd).toBeCloseTo(1780.92, 2);
  });

  it("surfaces hubspotDealId + qboCustomerApprovalId when present", async () => {
    await saveOnboardingState(
      makeState("wf_ids", {
        hubspotDealId: "D-99",
        qboCustomerApprovalId: "A-77",
      }),
    );
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as OnboardingResponse;
    expect(body.flows?.[0].hubspotDealId).toBe("D-99");
    expect(body.flows?.[0].qboCustomerApprovalId).toBe("A-77");
  });

  it("includes minimal prospect fields", async () => {
    await saveOnboardingState(
      makeState("wf_prospect", {
        prospect: {
          companyName: "Acme Co",
          contactName: "Jane",
          contactEmail: "jane@acme.test",
          contactPhone: "555",
        },
      }),
    );
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    const body = (await res.json()) as OnboardingResponse;
    expect(body.flows?.[0].prospect?.companyName).toBe("Acme Co");
  });
});

// Defensive: ensure the route file is wired into the middleware allowlist.
describe("middleware allowlist defense", () => {
  it("the route's path prefix is registered in middleware.ts", () => {
    // This is a soft check — read the source and grep. If it fails,
    // the bearer-token caller would 401 before even reaching the route.
    // Vitest runs against the same source tree so this is reliable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/middleware.ts"),
      "utf8",
    );
    expect(src).toContain("/api/ops/wholesale/onboarding");
  });

  it("__INTERNAL constants are correctly exported (sanity)", () => {
    expect(__INTERNAL.KV_INDEX_KEY).toBe("wholesale:flow:index");
  });
});
