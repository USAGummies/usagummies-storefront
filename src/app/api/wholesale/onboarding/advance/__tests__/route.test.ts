/**
 * Phase 35.f.1 — POST /api/wholesale/onboarding/advance route tests.
 *
 * Locked contracts:
 *   - 400 on non-JSON body
 *   - 400 on unknown step
 *   - 400 when flowId is missing on step !== "info"
 *   - 400 when payload validation fails (returns errors)
 *   - 400 on out-of-order step
 *   - 404 when flowId points to a missing/expired flow
 *   - 200 with sideEffectsPending on the happy path
 *   - flowId returned on step:"info" is durable (state actually
 *     persisted to KV; subsequent calls can resume)
 *   - end-to-end CC path: 5 advance calls bring the flow through
 *     payment-path with paymentPath="credit-card", then nextStep
 *     skips ap-info → returns "order-captured"
 *   - end-to-end AP path: same setup with paymentPath="accounts-
 *     payable" returns "ap-info" as nextStep
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildReq(body: unknown): Request {
  return new Request("http://localhost/api/wholesale/onboarding/advance", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

interface AdvanceResponse {
  ok: boolean;
  flowId?: string;
  currentStep?: string;
  nextStep?: string | null;
  stepsCompleted?: string[];
  sideEffectsPending?: { kind: string }[];
  errors?: string[];
}

describe("POST /api/wholesale/onboarding/advance — input validation", () => {
  it("400 on non-JSON body", async () => {
    const { POST } = await import("../route");
    const req = new Request(
      "http://localhost/api/wholesale/onboarding/advance",
      {
        method: "POST",
        body: "not json {",
        headers: { "Content-Type": "application/json" },
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400 on unknown step", async () => {
    const { POST } = await import("../route");
    const res = await POST(buildReq({ step: "BOGUS_STEP", payload: {} }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as AdvanceResponse;
    expect(body.ok).toBe(false);
  });

  it("400 when flowId missing on step !== 'info'", async () => {
    const { POST } = await import("../route");
    const res = await POST(buildReq({ step: "store-type", payload: {} }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as AdvanceResponse;
    expect(body.errors?.[0]).toMatch(/flowId required/);
  });

  it("400 with errors when payload validation fails", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      buildReq({
        step: "info",
        payload: { companyName: "Acme" /* missing contactName + email */ },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as AdvanceResponse;
    expect(body.errors).toBeDefined();
    expect(body.errors?.length).toBeGreaterThan(0);
  });
});

describe("POST /api/wholesale/onboarding/advance — happy path step 1", () => {
  it("mints a flowId and persists state on first info call", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      buildReq({
        step: "info",
        payload: {
          companyName: "Acme Co",
          contactName: "Jane Doe",
          contactEmail: "jane@acme.test",
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdvanceResponse;
    expect(body.ok).toBe(true);
    expect(body.flowId).toMatch(/^wf_/);
    expect(body.currentStep).toBe("store-type");
    expect(body.nextStep).toBe("store-type");
    expect(body.stepsCompleted).toEqual(["info"]);
    // Side effects emitted at info step (matches sideEffectsForStep).
    const kinds = body.sideEffectsPending?.map((s) => s.kind) ?? [];
    expect(kinds).toContain("hubspot.upsert-contact");
    expect(kinds).toContain("hubspot.create-deal");
  });

  it("flowId is durable — subsequent advance calls resume from KV", async () => {
    const { POST } = await import("../route");
    const r1 = await POST(
      buildReq({
        step: "info",
        payload: {
          companyName: "Acme",
          contactName: "Jane",
          contactEmail: "jane@acme.test",
        },
      }),
    );
    const b1 = (await r1.json()) as AdvanceResponse;
    expect(b1.flowId).toBeDefined();

    const r2 = await POST(
      buildReq({
        flowId: b1.flowId,
        step: "store-type",
        payload: { storeType: "specialty-retail" },
      }),
    );
    const b2 = (await r2.json()) as AdvanceResponse;
    expect(r2.status).toBe(200);
    expect(b2.currentStep).toBe("pricing-shown");
    expect(b2.stepsCompleted).toEqual(["info", "store-type"]);
  });
});

describe("POST /api/wholesale/onboarding/advance — flow not found", () => {
  it("404 when flowId points to a missing flow", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      buildReq({
        flowId: "wf_does_not_exist",
        step: "store-type",
        payload: { storeType: "specialty-retail" },
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as AdvanceResponse;
    expect(body.errors?.[0]).toMatch(/not found/);
  });
});

describe("POST /api/wholesale/onboarding/advance — out-of-order rejection", () => {
  it("400 when step skips ahead (e.g. shipping-info on a fresh info-only flow)", async () => {
    const { POST } = await import("../route");
    const r1 = await POST(
      buildReq({
        step: "info",
        payload: {
          companyName: "Acme",
          contactName: "Jane",
          contactEmail: "jane@acme.test",
        },
      }),
    );
    const b1 = (await r1.json()) as AdvanceResponse;

    const r2 = await POST(
      buildReq({
        flowId: b1.flowId,
        step: "shipping-info",
        payload: {
          shippingAddress: {
            street1: "123 Main",
            city: "Austin",
            state: "TX",
            postalCode: "78701",
            country: "US",
          },
        },
      }),
    );
    expect(r2.status).toBe(400);
    const b2 = (await r2.json()) as AdvanceResponse;
    expect(b2.errors?.[0]).toMatch(/expected step/);
  });
});

async function advanceThrough(
  POST: (req: Request) => Promise<Response>,
  flowId: string | undefined,
  steps: { step: string; payload?: unknown }[],
): Promise<{ flowId: string; bodies: AdvanceResponse[] }> {
  const bodies: AdvanceResponse[] = [];
  let id = flowId;
  for (const { step, payload } of steps) {
    const res = await POST(
      buildReq({ flowId: id, step, payload: payload ?? {} }),
    );
    const body = (await res.json()) as AdvanceResponse;
    if (res.status !== 200) {
      throw new Error(
        `step ${step} returned ${res.status}: ${JSON.stringify(body)}`,
      );
    }
    id = body.flowId ?? id;
    bodies.push(body);
  }
  return { flowId: id ?? "", bodies };
}

describe("POST /api/wholesale/onboarding/advance — credit-card path end-to-end", () => {
  it("nextStep skips ap-info on credit-card path", async () => {
    const { POST } = await import("../route");
    const { bodies } = await advanceThrough(POST, undefined, [
      {
        step: "info",
        payload: {
          companyName: "Acme",
          contactName: "Jane",
          contactEmail: "jane@acme.test",
        },
      },
      { step: "store-type", payload: { storeType: "specialty-retail" } },
      { step: "pricing-shown" },
      { step: "order-type", payload: { tier: "B2", unitCount: 3 } },
      { step: "payment-path", payload: { paymentPath: "credit-card" } },
    ]);
    const last = bodies[bodies.length - 1];
    // After payment-path on CC: ap-info skipped, next is order-captured.
    expect(last.nextStep).toBe("order-captured");
  });
});

describe("POST /api/wholesale/onboarding/advance — AP path end-to-end", () => {
  it("nextStep is ap-info on accounts-payable path", async () => {
    const { POST } = await import("../route");
    const { bodies } = await advanceThrough(POST, undefined, [
      {
        step: "info",
        payload: {
          companyName: "Acme",
          contactName: "Jane",
          contactEmail: "jane@acme.test",
        },
      },
      { step: "store-type", payload: { storeType: "grocery" } },
      { step: "pricing-shown" },
      { step: "order-type", payload: { tier: "B4", unitCount: 1 } },
      { step: "payment-path", payload: { paymentPath: "accounts-payable" } },
    ]);
    const last = bodies[bodies.length - 1];
    // After payment-path on AP: next is ap-info.
    expect(last.nextStep).toBe("ap-info");
  });

  it("emits ap-packet.send side effect at ap-email-sent step", async () => {
    const { POST } = await import("../route");
    const { bodies } = await advanceThrough(POST, undefined, [
      {
        step: "info",
        payload: {
          companyName: "Acme",
          contactName: "Jane",
          contactEmail: "jane@acme.test",
        },
      },
      { step: "store-type", payload: { storeType: "grocery" } },
      { step: "pricing-shown" },
      { step: "order-type", payload: { tier: "B4", unitCount: 1 } },
      { step: "payment-path", payload: { paymentPath: "accounts-payable" } },
      { step: "ap-info", payload: { apInfo: { apEmail: "ap@acme.test" } } },
      { step: "order-captured" },
      {
        step: "shipping-info",
        payload: {
          shippingAddress: {
            street1: "123 Main",
            city: "Austin",
            state: "TX",
            postalCode: "78701",
            country: "US",
          },
        },
      },
      { step: "ap-email-sent" },
    ]);
    const apEmailSentBody = bodies[bodies.length - 1];
    expect(
      apEmailSentBody.sideEffectsPending?.map((e) => e.kind),
    ).toContain("ap-packet.send");
  });

  it("full AP run completes — final crm-updated step has nextStep null + audit.flow-complete side effect", async () => {
    const { POST } = await import("../route");
    const { bodies } = await advanceThrough(POST, undefined, [
      {
        step: "info",
        payload: {
          companyName: "Acme",
          contactName: "Jane",
          contactEmail: "jane@acme.test",
        },
      },
      { step: "store-type", payload: { storeType: "grocery" } },
      { step: "pricing-shown" },
      { step: "order-type", payload: { tier: "B4", unitCount: 1 } },
      { step: "payment-path", payload: { paymentPath: "accounts-payable" } },
      { step: "ap-info", payload: { apInfo: { apEmail: "ap@acme.test" } } },
      { step: "order-captured" },
      {
        step: "shipping-info",
        payload: {
          shippingAddress: {
            street1: "123 Main",
            city: "Austin",
            state: "TX",
            postalCode: "78701",
            country: "US",
          },
        },
      },
      { step: "ap-email-sent" },
      { step: "qbo-customer-staged" },
      { step: "crm-updated" },
    ]);
    const last = bodies[bodies.length - 1];
    expect(last.nextStep).toBeNull();
    expect(last.stepsCompleted?.length).toBe(11);
    expect(
      last.sideEffectsPending?.map((e) => e.kind),
    ).toContain("audit.flow-complete");
  });
});

describe("POST /api/wholesale/onboarding/advance — B1 internal-only defense", () => {
  it("rejects B1 at the order-type step (defense alongside onlineTiers gate)", async () => {
    const { POST } = await import("../route");
    const r1 = await POST(
      buildReq({
        step: "info",
        payload: {
          companyName: "Acme",
          contactName: "Jane",
          contactEmail: "jane@acme.test",
        },
      }),
    );
    const b1 = (await r1.json()) as AdvanceResponse;
    await POST(
      buildReq({
        flowId: b1.flowId,
        step: "store-type",
        payload: { storeType: "specialty-retail" },
      }),
    );
    await POST(
      buildReq({ flowId: b1.flowId, step: "pricing-shown", payload: {} }),
    );
    const rB1 = await POST(
      buildReq({
        flowId: b1.flowId,
        step: "order-type",
        payload: { tier: "B1", unitCount: 5 },
      }),
    );
    expect(rB1.status).toBe(400);
    const bB1 = (await rB1.json()) as AdvanceResponse;
    expect(bB1.errors?.[0]).toMatch(/INTERNAL only/);
  });
});
