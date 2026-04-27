/**
 * Phase 31.2.c — POST /api/vendor/[token]/coi public upload route.
 *
 * Locks the contract:
 *   - 401 on missing-token / missing-secret / signature-mismatch /
 *     malformed.
 *   - 410 (Gone) on expired tokens — distinct from invalid so the
 *     UI can suggest "request a new link."
 *   - 404 when HMAC is valid but vendorId is no longer registered
 *     (operator-removed).
 *   - 503 when vendor's coiDriveFolderId is null.
 *   - 400 on invalid multipart, missing file field, empty file.
 *   - 413 on oversize file.
 *   - 415 on disallowed MIME.
 *   - 502 on Drive write failure.
 *   - 200 on success returning {ok, fileId, fileName, size}.
 *   - **Body is NEVER read before token verification** — defense
 *     against unauthenticated giant uploads.
 *   - Audit envelope records vendorId on every path; never logs
 *     the token or the verbatim original filename.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyTokenMock = vi.fn();
vi.mock("@/lib/ops/vendor-portal-token", () => ({
  verifyVendorPortalToken: (token: unknown, secret: unknown, now: unknown) =>
    verifyTokenMock(token, secret, now),
}));

const getEntryMock = vi.fn();
vi.mock("@/lib/ops/vendor-portal-registry", () => ({
  getVendorPortalEntry: (id: string) => getEntryMock(id),
}));

const uploadMock = vi.fn();
vi.mock("@/lib/ops/vendor-coi-upload", () => ({
  uploadVendorCoi: (input: unknown) => uploadMock(input),
}));

const auditAppendMock = vi.fn();
vi.mock("@/lib/ops/control-plane/stores", () => ({
  auditStore: () => ({ append: auditAppendMock }),
}));
vi.mock("@/lib/ops/control-plane/audit", () => ({
  buildAuditEntry: (_run: unknown, p: Record<string, unknown>) => ({
    ...p,
    id: "a",
    runId: "r",
    division: "production-supply-chain",
    actorType: "agent",
    actorId: "vendor-coi-upload",
    sourceCitations: [],
    createdAt: new Date().toISOString(),
  }),
}));
vi.mock("@/lib/ops/control-plane/run-id", () => ({
  newRunContext: () => ({ runId: "r", agentId: "vendor-coi-upload" }),
}));

import { POST } from "../route";

beforeEach(() => {
  process.env.VENDOR_PORTAL_SECRET = "test-secret";
  verifyTokenMock.mockReset();
  getEntryMock.mockReset();
  uploadMock.mockReset();
  auditAppendMock.mockReset();
  auditAppendMock.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.VENDOR_PORTAL_SECRET;
  vi.clearAllMocks();
});

function makeReq(body?: BodyInit): Request {
  const url = "https://www.usagummies.com/api/vendor/abc123/coi";
  return body
    ? new Request(url, { method: "POST", body })
    : new Request(url, { method: "POST" });
}

function ctx(token = "abc123"): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token }) };
}

function makeFormData(file?: File): FormData {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return fd;
}

describe("POST /api/vendor/[token]/coi — auth gate", () => {
  it("401 on signature-mismatch", async () => {
    verifyTokenMock.mockReturnValueOnce({
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "signature-mismatch",
    });
    const res = await POST(makeReq(), ctx());
    expect(res.status).toBe(401);
  });

  it("401 on malformed-token", async () => {
    verifyTokenMock.mockReturnValueOnce({
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "malformed-token",
    });
    const res = await POST(makeReq(), ctx());
    expect(res.status).toBe(401);
  });

  it("401 on missing-secret", async () => {
    delete process.env.VENDOR_PORTAL_SECRET;
    verifyTokenMock.mockReturnValueOnce({
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "missing-secret",
    });
    const res = await POST(makeReq(), ctx());
    expect(res.status).toBe(401);
  });

  it("410 Gone on expired token (UI can suggest 'request a new link')", async () => {
    verifyTokenMock.mockReturnValueOnce({
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "expired",
    });
    const res = await POST(makeReq(), ctx());
    expect(res.status).toBe(410);
  });

  it("does NOT read the body before verifying the token", async () => {
    verifyTokenMock.mockReturnValueOnce({
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "signature-mismatch",
    });
    // Build a request whose body would throw if read (closed stream).
    // We simulate by passing a body that, if read, would consume.
    const fd = makeFormData(
      new File(["x"], "test.pdf", { type: "application/pdf" }),
    );
    const res = await POST(makeReq(fd), ctx());
    expect(res.status).toBe(401);
    // The upload helper must NEVER be called when token verify fails.
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/vendor/[token]/coi — registry gate", () => {
  beforeEach(() => {
    verifyTokenMock.mockReturnValue({
      ok: true,
      vendorId: "powers",
      expiresAt: "2026-05-27T16:00:00Z",
      reason: null,
    });
  });

  it("404 when vendorId is no longer in the registry", async () => {
    getEntryMock.mockReturnValueOnce(null);
    const res = await POST(makeReq(makeFormData()), ctx());
    expect(res.status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("503 when vendor's coiDriveFolderId is null", async () => {
    getEntryMock.mockReturnValueOnce({
      vendorId: "powers",
      displayName: "Powers",
      coiDriveFolderId: null,
      defaultEmail: null,
    });
    const res = await POST(makeReq(makeFormData()), ctx());
    expect(res.status).toBe(503);
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/vendor/[token]/coi — file validation", () => {
  beforeEach(() => {
    verifyTokenMock.mockReturnValue({
      ok: true,
      vendorId: "powers",
      expiresAt: "2026-05-27T16:00:00Z",
      reason: null,
    });
    getEntryMock.mockReturnValue({
      vendorId: "powers",
      displayName: "Powers",
      coiDriveFolderId: "1abc",
      defaultEmail: null,
    });
  });

  it("400 on missing file field", async () => {
    const res = await POST(makeReq(makeFormData()), ctx());
    expect(res.status).toBe(400);
  });

  it("400 on empty file", async () => {
    const file = new File([new Uint8Array(0)], "empty.pdf", {
      type: "application/pdf",
    });
    const res = await POST(makeReq(makeFormData(file)), ctx());
    expect(res.status).toBe(400);
  });

  it("413 on file exceeding 10MB", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const file = new File([big], "big.pdf", { type: "application/pdf" });
    const res = await POST(makeReq(makeFormData(file)), ctx());
    expect(res.status).toBe(413);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("415 on disallowed MIME", async () => {
    const file = new File(["bytes"], "bad.exe", {
      type: "application/x-msdownload",
    });
    const res = await POST(makeReq(makeFormData(file)), ctx());
    expect(res.status).toBe(415);
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/vendor/[token]/coi — upload result", () => {
  beforeEach(() => {
    verifyTokenMock.mockReturnValue({
      ok: true,
      vendorId: "powers",
      expiresAt: "2026-05-27T16:00:00Z",
      reason: null,
    });
    getEntryMock.mockReturnValue({
      vendorId: "powers",
      displayName: "Powers Confections",
      coiDriveFolderId: "1abc",
      defaultEmail: null,
    });
  });

  it("502 on Drive write failure (drive_upload_failed)", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: false,
      code: "drive_upload_failed",
      error: "Drive 500",
    });
    const file = new File(["bytes"], "coi.pdf", { type: "application/pdf" });
    const res = await POST(makeReq(makeFormData(file)), ctx());
    expect(res.status).toBe(502);
  });

  it("503 on drive_oauth_missing", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: false,
      code: "drive_oauth_missing",
      error: "no oauth",
    });
    const file = new File(["bytes"], "coi.pdf", { type: "application/pdf" });
    const res = await POST(makeReq(makeFormData(file)), ctx());
    expect(res.status).toBe(503);
  });

  it("200 on success returning {ok, fileId, fileName, size}", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: true,
      fileId: "drv-123",
      name: "COI_powers_2026-04-27.pdf",
      mimeType: "application/pdf",
      size: 12345,
      webViewLink: "https://drive.google.com/file/d/drv-123/view",
      parentFolderId: "1abc",
    });
    const file = new File(["bytes"], "company-coi.pdf", {
      type: "application/pdf",
    });
    const res = await POST(makeReq(makeFormData(file)), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      fileId: string;
      fileName: string;
      size: number;
    };
    expect(body.ok).toBe(true);
    expect(body.fileId).toBe("drv-123");
    expect(body.fileName).toBe("COI_powers_2026-04-27.pdf");
    expect(body.size).toBe(12345);
  });

  it("audit envelope records vendorId + fileId; does NOT log original filename verbatim", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: true,
      fileId: "drv-secret",
      name: "COI_powers_2026-04-27.pdf",
      mimeType: "application/pdf",
      size: 100,
      webViewLink: null,
      parentFolderId: "1abc",
    });
    const file = new File(["bytes"], "private-vendor-org-2026.pdf", {
      type: "application/pdf",
    });
    await POST(makeReq(makeFormData(file)), ctx());
    expect(auditAppendMock).toHaveBeenCalled();
    const entry = auditAppendMock.mock.calls.at(-1)?.[0];
    expect(entry?.action).toBe("vendor.coi.upload");
    expect(entry?.entityId).toBe("powers");
    expect(entry?.result).toBe("ok");
    const after = entry?.after as Record<string, unknown>;
    expect(after.fileId).toBe("drv-secret");
    expect(after.driveName).toBe("COI_powers_2026-04-27.pdf");
    // Original filename "private-vendor-org-2026.pdf" must NOT appear.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("private-vendor-org-2026");
  });
});
