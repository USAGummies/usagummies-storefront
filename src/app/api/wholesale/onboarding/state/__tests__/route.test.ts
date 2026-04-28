/**
 * Phase 35.f.2 — GET /api/wholesale/onboarding/state route tests.
 *
 * Locked contracts:
 *   - 400 when flowId query param missing or empty
 *   - 404 when flowId points to a missing/expired flow
 *   - 200 + state + computed nextStep on success
 *   - Round-trip with the advance route: state shape matches what
 *     the advance route persisted
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

function buildReq(qs: string = ""): Request {
  return new Request(
    `http://localhost/api/wholesale/onboarding/state${qs}`,
    { method: "GET" },
  );
}

interface StateResponse {
  ok: boolean;
  state?: {
    flowId: string;
    currentStep: string;
    stepsCompleted: string[];
    prospect?: { companyName: string };
  };
  nextStep?: string | null;
  errors?: string[];
}

describe("GET /api/wholesale/onboarding/state — input validation", () => {
  it("400 when flowId query param missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(400);
    const body = (await res.json()) as StateResponse;
    expect(body.errors?.[0]).toMatch(/flowId/);
  });

  it("400 when flowId is empty string", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq("?flowId="));
    expect(res.status).toBe(400);
  });

  it("400 when flowId is whitespace-only", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq("?flowId=%20%20%20"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/wholesale/onboarding/state — not found", () => {
  it("404 when flow missing from KV", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq("?flowId=wf_does_not_exist"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as StateResponse;
    expect(body.errors?.[0]).toMatch(/not found/);
  });
});

describe("GET /api/wholesale/onboarding/state — happy path round-trip", () => {
  it("200 + state matches what advance route persisted", async () => {
    // Use the advance route to start a flow, then fetch via state route.
    const { POST } = await import("../../advance/route");
    const advanceReq = new Request(
      "http://localhost/api/wholesale/onboarding/advance",
      {
        method: "POST",
        body: JSON.stringify({
          step: "info",
          payload: {
            companyName: "Acme Co",
            contactName: "Jane Doe",
            contactEmail: "jane@acme.test",
          },
        }),
        headers: { "Content-Type": "application/json" },
      },
    );
    const advanceRes = await POST(advanceReq);
    const advanceBody = (await advanceRes.json()) as {
      flowId: string;
      currentStep: string;
    };
    expect(advanceBody.flowId).toMatch(/^wf_/);

    const { GET } = await import("../route");
    const stateRes = await GET(
      buildReq(`?flowId=${encodeURIComponent(advanceBody.flowId)}`),
    );
    expect(stateRes.status).toBe(200);
    const body = (await stateRes.json()) as StateResponse;
    expect(body.ok).toBe(true);
    expect(body.state?.flowId).toBe(advanceBody.flowId);
    expect(body.state?.currentStep).toBe("store-type");
    expect(body.state?.stepsCompleted).toEqual(["info"]);
    expect(body.state?.prospect?.companyName).toBe("Acme Co");
    expect(body.nextStep).toBe("store-type");
  });
});
