import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  isCronAuthorized: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ops/abra-auth", () => ({
  isCronAuthorized: mocked.isCronAuthorized,
}));

import { hasApprovalsReadAccess } from "@/lib/ops/approvals-auth";

describe("approvals route auth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("allows access when a logged-in session email exists", () => {
    const req = new Request("https://example.com/api/ops/approvals");

    expect(hasApprovalsReadAccess(req, "ben@usagummies.com")).toBe(true);
    expect(mocked.isCronAuthorized).not.toHaveBeenCalled();
  });

  it("falls back to CRON_SECRET auth when no session email exists", () => {
    mocked.isCronAuthorized.mockReturnValue(true);
    const req = new Request("https://example.com/api/ops/approvals", {
      headers: { authorization: "Bearer test" },
    });

    expect(hasApprovalsReadAccess(req, null)).toBe(true);
    expect(mocked.isCronAuthorized).toHaveBeenCalledWith(req);
  });

  it("rejects requests with neither session nor cron auth", () => {
    mocked.isCronAuthorized.mockReturnValue(false);
    const req = new Request("https://example.com/api/ops/approvals");

    expect(hasApprovalsReadAccess(req, null)).toBe(false);
  });
});
