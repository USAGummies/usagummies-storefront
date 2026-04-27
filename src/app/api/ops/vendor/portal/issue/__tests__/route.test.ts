/**
 * Phase 31.2.a — POST /api/ops/vendor/portal/issue.
 *
 * Locks the contract:
 *   - 401 on auth rejection.
 *   - 500 when VENDOR_PORTAL_SECRET is unset (never mints a
 *     token signed with empty key).
 *   - 400 on missing/invalid vendorId.
 *   - 400 when ttlDays is outside [1, 90].
 *   - 404 when vendorId is not in VENDOR_PORTAL_REGISTRY (the
 *     critical "never mint tokens for arbitrary kebab-case
 *     strings" defense).
 *   - 200 on registered vendor with valid inputs — returns
 *     {ok, vendorId, displayName, url, expiresAt, ttlDays}.
 *   - URL passes through verifyVendorPortalToken (round-trip).
 *   - Audit envelope is recorded but NEVER includes the URL/token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isAuthorizedMock = vi.fn();
vi.mock("@/lib/ops/abra-auth", () => ({
  isAuthorized: (req: Request) => isAuthorizedMock(req),
}));

const getEntryMock = vi.fn();
vi.mock("@/lib/ops/vendor-portal-registry", () => ({
  getVendorPortalEntry: (id: string) => getEntryMock(id),
}));

const auditAppendMock = vi.fn();
vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({ append: auditAppendMock }),
}));

vi.mock("@/lib/ops/control-plane/audit", () => ({
  buildAuditEntry: (_run: unknown, payload: Record<string, unknown>) => ({
    ...payload,
    id: "audit-fixture",
    runId: "run-fixture",
    division: "production-supply-chain",
    actorType: "human",
    actorId: "ben",
    sourceCitations: [],
    createdAt: new Date().toISOString(),
  }),
}));

vi.mock("@/lib/ops/control-plane/run-id", () => ({
  newRunContext: () => ({ runId: "run-fixture", agentId: "vendor-portal-issue" }),
}));

import { POST } from "../route";
import { verifyVendorPortalToken } from "@/lib/ops/vendor-portal-token";

const ORIGINAL_SECRET = process.env.VENDOR_PORTAL_SECRET;
const TEST_SECRET = "test-vendor-portal-secret-32-bytes!!";

beforeEach(() => {
  isAuthorizedMock.mockReset();
  isAuthorizedMock.mockResolvedValue(true);
  getEntryMock.mockReset();
  auditAppendMock.mockReset();
  auditAppendMock.mockResolvedValue(undefined);
  process.env.VENDOR_PORTAL_SECRET = TEST_SECRET;
});

afterEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL_SECRET === undefined) delete process.env.VENDOR_PORTAL_SECRET;
  else process.env.VENDOR_PORTAL_SECRET = ORIGINAL_SECRET;
});

function makeReq(body: unknown): Request {
  return new Request(
    "https://www.usagummies.com/api/ops/vendor/portal/issue",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/ops/vendor/portal/issue", () => {
  it("401 on auth rejection", async () => {
    isAuthorizedMock.mockResolvedValueOnce(false);
    const res = await POST(makeReq({ vendorId: "powers" }));
    expect(res.status).toBe(401);
  });

  it("500 when VENDOR_PORTAL_SECRET is unset (never mint with empty key)", async () => {
    delete process.env.VENDOR_PORTAL_SECRET;
    const res = await POST(makeReq({ vendorId: "powers" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("VENDOR_PORTAL_SECRET");
  });

  it("400 on invalid JSON body", async () => {
    const req = new Request(
      "https://www.usagummies.com/api/ops/vendor/portal/issue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400 on missing vendorId", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("400 on empty-string vendorId", async () => {
    const res = await POST(makeReq({ vendorId: "" }));
    expect(res.status).toBe(400);
  });

  it("404 when vendorId is not in the registry — never mint for arbitrary kebab-case", async () => {
    getEntryMock.mockReturnValueOnce(null);
    const res = await POST(makeReq({ vendorId: "anonymous-vendor" }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("not registered");
  });

  it("400 when ttlDays is below the minimum", async () => {
    getEntryMock.mockReturnValueOnce({
      vendorId: "powers",
      displayName: "Powers",
      coiDriveFolderId: null,
      defaultEmail: null,
    });
    const res = await POST(makeReq({ vendorId: "powers", ttlDays: 0 }));
    expect(res.status).toBe(400);
  });

  it("400 when ttlDays is above the maximum", async () => {
    getEntryMock.mockReturnValueOnce({
      vendorId: "powers",
      displayName: "Powers",
      coiDriveFolderId: null,
      defaultEmail: null,
    });
    const res = await POST(makeReq({ vendorId: "powers", ttlDays: 100 }));
    expect(res.status).toBe(400);
  });

  it("200 on registered vendor + valid inputs; URL round-trips through verify", async () => {
    getEntryMock.mockReturnValueOnce({
      vendorId: "powers-confections",
      displayName: "Powers Confections",
      coiDriveFolderId: "1abc",
      defaultEmail: "ap@powersconfections.com",
    });
    const res = await POST(
      makeReq({ vendorId: "powers-confections", ttlDays: 14 }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      vendorId: string;
      displayName: string;
      url: string;
      expiresAt: string;
      ttlDays: number;
    };
    expect(body.ok).toBe(true);
    expect(body.vendorId).toBe("powers-confections");
    expect(body.displayName).toBe("Powers Confections");
    expect(body.ttlDays).toBe(14);
    expect(body.url).toMatch(/\/vendor\/[A-Za-z0-9_-]+$/);

    // Round-trip through verify — proves the URL is well-formed.
    const token = body.url.split("/vendor/")[1];
    const result = verifyVendorPortalToken(token, TEST_SECRET, new Date());
    expect(result.ok).toBe(true);
    expect(result.vendorId).toBe("powers-confections");
  });

  it("defaults ttlDays to 30 when not specified", async () => {
    getEntryMock.mockReturnValueOnce({
      vendorId: "powers",
      displayName: "Powers",
      coiDriveFolderId: null,
      defaultEmail: null,
    });
    const res = await POST(makeReq({ vendorId: "powers" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ttlDays: number };
    expect(body.ttlDays).toBe(30);
  });

  it("audit envelope NEVER includes the URL or the token (bearer secrets)", async () => {
    getEntryMock.mockReturnValueOnce({
      vendorId: "powers",
      displayName: "Powers",
      coiDriveFolderId: null,
      defaultEmail: null,
    });
    await POST(makeReq({ vendorId: "powers" }));
    expect(auditAppendMock).toHaveBeenCalled();
    const allEntries = auditAppendMock.mock.calls.map((c) => c[0]);
    for (const entry of allEntries) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain("/vendor/");
      // No 200+ char base64url blob.
      expect(serialized).not.toMatch(/[A-Za-z0-9_-]{200,}/);
    }
  });

  it("audit envelope records vendorId + expiresAt + metadata flags", async () => {
    getEntryMock.mockReturnValueOnce({
      vendorId: "powers",
      displayName: "Powers Confections",
      coiDriveFolderId: "1abc",
      defaultEmail: "ap@powersconfections.com",
    });
    await POST(makeReq({ vendorId: "powers" }));
    expect(auditAppendMock).toHaveBeenCalled();
    const entry = auditAppendMock.mock.calls.at(-1)?.[0];
    expect(entry?.action).toBe("vendor.portal.issue");
    expect(entry?.entityId).toBe("powers");
    expect(entry?.result).toBe("ok");
    const after = entry?.after as Record<string, unknown>;
    expect(after.displayName).toBe("Powers Confections");
    expect(after.coiDriveFolderConfigured).toBe(true);
    expect(after.defaultEmailConfigured).toBe(true);
    expect(typeof after.expiresAt).toBe("string");
    expect(after.ttlDays).toBe(30);
  });
});
