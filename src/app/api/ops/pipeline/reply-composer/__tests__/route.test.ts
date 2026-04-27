/**
 * Phase 30.4 — POST /api/ops/pipeline/reply-composer auth + validation surface.
 *
 * Locks the contract:
 *   - 401 on `isAuthorized` rejection.
 *   - 500 when ANTHROPIC_API_KEY is unset (deliberate: never run a
 *     paid LLM call when the env wasn't set, and never silently
 *     return a fabricated email).
 *   - 400 on missing prospect_id.
 *   - 404 when the prospect lookup returns null.
 *
 * Does NOT exercise the LLM happy-path (that's an integration
 * test, not a unit test). The Claude call is gated behind every
 * pre-condition above, so locking the validation surface alone is
 * enough to keep the route trustworthy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const getProspectMock = vi.fn();
const getTouchesMock = vi.fn();
vi.mock("@/lib/ops/pipeline", () => ({
  getProspect: (...args: unknown[]) => getProspectMock(...args),
  getTouches: (...args: unknown[]) => getTouchesMock(...args),
}));

vi.mock("@/lib/ops/product-claims", () => ({
  validateOutreachClaims: vi.fn(async () => ({ safe: true, issues: [] })),
}));

vi.mock("@/lib/ops/ai/model-policy", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ops/ai/model-policy")
  >("@/lib/ops/ai/model-policy");
  return {
    ...actual,
    HARD_RULES_PROMPT: "TEST RULES",
    anthropicSamplingParams: () => ({ temperature: 0.2 }),
    resolveAnthropicModel: () => "claude-fake",
  };
});

import { POST } from "../route";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  getProspectMock.mockReset();
  getTouchesMock.mockReset();
  getTouchesMock.mockResolvedValue([]);
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  }
});

function makeReq(body: unknown): Request {
  return new Request(
    "https://www.usagummies.com/api/ops/pipeline/reply-composer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/ops/pipeline/reply-composer", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await POST(makeReq({ prospect_id: "P1" }));
    expect(res.status).toBe(401);
  });

  it("500 when ANTHROPIC_API_KEY is unset (no fabricated emails)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(makeReq({ prospect_id: "P1" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("ANTHROPIC_API_KEY");
  });

  it("400 on missing prospect_id", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("prospect_id");
  });

  it("404 when prospect lookup returns null", async () => {
    getProspectMock.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ prospect_id: "P-MISSING" }));
    expect(res.status).toBe(404);
  });

  it("does NOT call Claude when prospect is missing", async () => {
    getProspectMock.mockResolvedValueOnce(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await POST(makeReq({ prospect_id: "P-MISSING" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT call Claude when prospect_id is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await POST(makeReq({}));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
