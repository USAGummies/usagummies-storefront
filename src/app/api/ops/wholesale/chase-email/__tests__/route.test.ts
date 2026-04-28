/**
 * Phase 35.f.7 — GET /api/ops/wholesale/chase-email tests.
 *
 * Locked contracts:
 *   - 401 unauthorized
 *   - 400 missing flowId
 *   - 404 flow not found
 *   - 422 prospect missing (cannot draft an email without a recipient)
 *   - 200 + draft on happy path
 *   - resumeUrl built from flowId + DEFAULT_RESUME_BASE
 *   - resumeUrl override accepted via ?resumeBase=
 *   - hoursSinceLastTouch derived from state.timestamps
 *   - middleware allowlist defense
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();

vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const store = new Map<string, unknown>();

vi.mock("@vercel/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

import { saveOnboardingState } from "@/lib/wholesale/onboarding-store";
import type { OnboardingState } from "@/lib/wholesale/onboarding-flow";

beforeEach(() => {
  store.clear();
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildReq(qs = ""): Request {
  return new Request(
    `http://localhost/api/ops/wholesale/chase-email${qs}`,
    { method: "GET" },
  );
}

function buildState(
  overrides: Partial<OnboardingState> = {},
): OnboardingState {
  return {
    flowId: "wf_chase_001",
    currentStep: "store-type",
    stepsCompleted: ["info"],
    orderLines: [],
    timestamps: { info: new Date(Date.now() - 30 * 3600 * 1000).toISOString() },
    prospect: {
      companyName: "Acme Co",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
    },
    ...overrides,
  };
}

interface ChaseResp {
  ok: boolean;
  draft?: {
    subject: string;
    plainText: string;
    to: string;
    greetingName: string;
  };
  flow?: {
    flowId: string;
    currentStep: string;
    hoursSinceLastTouch: number;
  };
  error?: string;
}

describe("GET /api/ops/wholesale/chase-email — input gates", () => {
  it("401 when isAuthorized rejects", async () => {
    isAuthorizedMock.mockResolvedValue(false);
    const { GET } = await import("../route");
    const res = await GET(buildReq("?flowId=wf_x"));
    expect(res.status).toBe(401);
  });

  it("400 when flowId missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(400);
  });

  it("404 when flow not in KV", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq("?flowId=wf_does_not_exist"));
    expect(res.status).toBe(404);
  });

  it("422 when prospect missing", async () => {
    await saveOnboardingState(buildState({ prospect: undefined }));
    const { GET } = await import("../route");
    const res = await GET(buildReq("?flowId=wf_chase_001"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as ChaseResp;
    expect(body.error).toMatch(/prospect missing|contactEmail empty/);
  });
});

describe("GET /api/ops/wholesale/chase-email — happy path", () => {
  it("returns a draft with default resumeUrl pointing at production", async () => {
    await saveOnboardingState(buildState());
    const { GET } = await import("../route");
    const res = await GET(buildReq("?flowId=wf_chase_001"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChaseResp;
    expect(body.ok).toBe(true);
    expect(body.draft?.to).toBe("jane@acme.test");
    expect(body.draft?.greetingName).toBe("Jane");
    expect(body.draft?.subject).toContain("Acme Co");
    expect(body.draft?.plainText).toContain(
      "https://www.usagummies.com/wholesale/order?flowId=wf_chase_001",
    );
  });

  it("respects ?resumeBase= override", async () => {
    await saveOnboardingState(buildState());
    const { GET } = await import("../route");
    const res = await GET(
      buildReq(
        "?flowId=wf_chase_001&resumeBase=https%3A%2F%2Fstaging.example.com%2Forder",
      ),
    );
    const body = (await res.json()) as ChaseResp;
    expect(body.draft?.plainText).toContain(
      "https://staging.example.com/order?flowId=wf_chase_001",
    );
  });

  it("flow.hoursSinceLastTouch is derived from state.timestamps", async () => {
    await saveOnboardingState(buildState());
    const { GET } = await import("../route");
    const res = await GET(buildReq("?flowId=wf_chase_001"));
    const body = (await res.json()) as ChaseResp;
    // Set up was 30h ago — allow ±0.5h tolerance.
    expect(body.flow?.hoursSinceLastTouch).toBeGreaterThan(29);
    expect(body.flow?.hoursSinceLastTouch).toBeLessThan(31);
  });
});

describe("middleware allowlist defense", () => {
  it("the route's path prefix is registered in middleware.ts", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/middleware.ts"),
      "utf8",
    );
    expect(src).toContain("/api/ops/wholesale/chase-email");
  });
});
