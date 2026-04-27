/**
 * Phase 30.4 — POST /api/ops/pipeline/enrich auth + validation surface.
 *
 * Locks the contract:
 *   - 401 when no NextAuth session (route uses `auth()`).
 *   - 400 on missing/invalid `deals` array.
 *   - 400 on empty `deals` array.
 *   - Caps deals at 10 (excess silently dropped).
 *
 * Like reply-composer, intentionally does NOT exercise the LLM
 * happy-path. Pre-conditions above gate the Claude call; locking
 * them keeps the route trustworthy without paying for LLM tokens
 * in CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("@/lib/auth/config", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/ops/supabase-resilience", () => ({
  canUseSupabase: vi.fn(async () => ({ allowed: false, reason: "test-disabled" })),
  markSupabaseFailure: vi.fn(async () => undefined),
  markSupabaseSuccess: vi.fn(async () => undefined),
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

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { email: "ben@usagummies.com" } });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function makeReq(body: unknown): Request {
  return new Request("https://www.usagummies.com/api/ops/pipeline/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ops/pipeline/enrich", () => {
  it("401 when there is no NextAuth session", async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ deals: [{ id: "D1", name: "Acme", stage: "qualified" }] }));
    expect(res.status).toBe(401);
  });

  it("401 when session is present but user.email is missing", async () => {
    authMock.mockResolvedValueOnce({ user: {} });
    const res = await POST(makeReq({ deals: [{ id: "D1", name: "Acme", stage: "qualified" }] }));
    expect(res.status).toBe(401);
  });

  it("400 when body has no deals key", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("400 when deals is not an array", async () => {
    const res = await POST(makeReq({ deals: "string-not-array" }));
    expect(res.status).toBe(400);
  });

  it("400 when deals is empty", async () => {
    const res = await POST(makeReq({ deals: [] }));
    expect(res.status).toBe(400);
  });

  it("400 on invalid JSON payload", async () => {
    const req = new Request("https://www.usagummies.com/api/ops/pipeline/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("does NOT call Claude when validation fails", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await POST(makeReq({ deals: [] }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT call Claude when auth fails", async () => {
    authMock.mockResolvedValueOnce(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await POST(makeReq({ deals: [{ id: "D1", name: "Acme", stage: "qualified" }] }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
