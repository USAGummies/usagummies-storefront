/**
 * Integration tests for the durable upload route.
 *
 * Locked contracts:
 *   - No local filesystem write happens (fs/promises is fully mocked
 *     and we assert it was never called).
 *   - Drive upload success returns stable metadata: fileId, name,
 *     mimeType, size, webViewLink.
 *   - Missing Drive config / OAuth fails closed with 503 + a stable
 *     `code` field — never falls back to local FS.
 *   - Invalid MIME type is rejected with 415 before any Drive call.
 *   - Oversize file is rejected with 413 before any Drive call.
 *   - The /upload/ncs form contract (form_type=ncs) still works.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs/promises FIRST, before any module that might import it.
// This is the safety lock: if the route ever regresses to writing
// locally, every test in this file blows up.
vi.mock("fs/promises", () => ({
  writeFile: vi.fn(async () => {
    throw new Error("LOCAL FS WRITE ATTEMPTED — route should never write locally");
  }),
  mkdir: vi.fn(async () => {
    throw new Error("LOCAL FS MKDIR ATTEMPTED — route should never write locally");
  }),
}));

// Mock the rate limiter so tests don't care about KV.
vi.mock("@/lib/ops/rate-limiter", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ops/rate-limiter")
  >("@/lib/ops/rate-limiter");
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({
      allowed: true,
      remaining: 5,
      resetAt: Date.now() + 60_000,
    })),
  };
});

// Mock the Drive upload module — every test sets the desired return.
vi.mock("@/lib/ops/drive-upload", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ops/drive-upload")>(
    "@/lib/ops/drive-upload",
  );
  return {
    ...actual,
    uploadDurableFile: vi.fn(),
  };
});

import * as fsPromises from "fs/promises";
import { uploadDurableFile } from "@/lib/ops/drive-upload";

const uploadMock = uploadDurableFile as unknown as ReturnType<typeof vi.fn>;
const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
const mkdirMock = fsPromises.mkdir as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildFormReq(opts: {
  file?: { name: string; type: string; bytes?: number };
  customerName?: string;
  formType?: string;
  docType?: string;
  notes?: string;
}): Request {
  const fd = new FormData();
  if (opts.file) {
    const bytes = new Uint8Array(opts.file.bytes ?? 1024);
    bytes.fill(7);
    fd.append("file", new File([bytes], opts.file.name, { type: opts.file.type }));
  }
  if (opts.customerName) fd.append("customer_name", opts.customerName);
  if (opts.formType) fd.append("form_type", opts.formType);
  if (opts.docType) fd.append("doc_type", opts.docType);
  if (opts.notes) fd.append("notes", opts.notes);
  return new Request("http://localhost/api/ops/upload", {
    method: "POST",
    body: fd,
  });
}

describe("POST /api/ops/upload (durable Drive)", () => {
  it("happy path: uploads to Drive and returns stable metadata; no local FS write", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: true,
      fileId: "drive-file-abc",
      name: "NCS_Sarah_2026-04-24.pdf",
      mimeType: "application/pdf",
      size: 1024,
      webViewLink: "https://drive.google.com/file/d/drive-file-abc/view",
      parentFolderId: "drive-folder-ncs",
    });

    const { POST } = await import("../route");
    const res = await POST(
      buildFormReq({
        file: { name: "ncs.pdf", type: "application/pdf" },
        customerName: "Sarah Smith",
        formType: "ncs",
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.fileId).toBe("drive-file-abc");
    expect(body.name).toBe("NCS_Sarah_2026-04-24.pdf");
    expect(body.mimeType).toBe("application/pdf");
    expect(body.size).toBe(1024);
    expect(body.webViewLink).toBe(
      "https://drive.google.com/file/d/drive-file-abc/view",
    );
    expect(body.docType).toBe("ncs");

    // Critical safety lock — local FS must NEVER be touched.
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();

    // The drive upload was called exactly once with the right shape.
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docType: "ncs",
        submitter: "Sarah Smith",
        mimeType: "application/pdf",
      }),
    );
  });

  it("fails CLOSED with 503 + stable code when Drive env is missing — no local fallback", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: false,
      code: "drive_not_configured",
      error:
        "GOOGLE_DRIVE_UPLOAD_PARENT_ID is not set. Configure the Drive parent folder.",
    });

    const { POST } = await import("../route");
    const res = await POST(
      buildFormReq({
        file: { name: "ncs.pdf", type: "application/pdf" },
        customerName: "Sarah",
        formType: "ncs",
      }),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.code).toBe("drive_not_configured");
    // Critical: no FS fallback.
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
  });

  it("fails CLOSED with 503 when OAuth refresh token is missing — no local fallback", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: false,
      code: "drive_oauth_missing",
      error: "GMAIL_OAUTH_* env vars missing",
    });
    const { POST } = await import("../route");
    const res = await POST(
      buildFormReq({
        file: { name: "ncs.pdf", type: "application/pdf" },
        customerName: "Sarah",
        formType: "ncs",
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("drive_oauth_missing");
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid MIME type with 415 — Drive is never called", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      buildFormReq({
        file: { name: "evil.exe", type: "application/x-msdownload" },
        customerName: "Anon",
        formType: "ncs",
      }),
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("rejects an oversize file with 413 — Drive is never called", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      buildFormReq({
        file: {
          name: "huge.pdf",
          type: "application/pdf",
          // 11 MB > 10 MB cap.
          bytes: 11 * 1024 * 1024,
        },
        customerName: "Anon",
        formType: "ncs",
      }),
    );
    expect(res.status).toBe(413);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("rejects an empty body with 400 — no Drive call, no FS write", async () => {
    const { POST } = await import("../route");
    const res = await POST(buildFormReq({ customerName: "Anon" }));
    expect(res.status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("/upload/ncs contract: form_type=ncs still routes correctly to docType=ncs", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: true,
      fileId: "drive-id-1",
      name: "NCS_Acme_2026-04-24.pdf",
      mimeType: "application/pdf",
      size: 512,
      webViewLink: null,
      parentFolderId: "ncs-parent",
    });
    const { POST } = await import("../route");
    const res = await POST(
      buildFormReq({
        file: { name: "ncs.pdf", type: "application/pdf" },
        customerName: "Acme",
        // The legacy field exactly as the NCS form sends it.
        formType: "ncs",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.docType).toBe("ncs");
    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ docType: "ncs" }),
    );
  });

  it("doc_type=w9 routes vendor docs into the w9 subfolder", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: true,
      fileId: "drive-w9-1",
      name: "W9_Powers_2026-04-24.pdf",
      mimeType: "application/pdf",
      size: 2048,
      webViewLink: null,
      parentFolderId: "w9-parent",
    });
    const { POST } = await import("../route");
    const res = await POST(
      buildFormReq({
        file: { name: "w9.pdf", type: "application/pdf" },
        customerName: "Powers Confections",
        docType: "w9",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.docType).toBe("w9");
    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ docType: "w9" }),
    );
  });

  it("unknown doc_type is normalized to 'other' (never rejects on category)", async () => {
    uploadMock.mockResolvedValueOnce({
      ok: true,
      fileId: "drive-other-1",
      name: "OTHER_Misc_2026-04-24.pdf",
      mimeType: "application/pdf",
      size: 100,
      webViewLink: null,
      parentFolderId: "other-parent",
    });
    const { POST } = await import("../route");
    const res = await POST(
      buildFormReq({
        file: { name: "x.pdf", type: "application/pdf" },
        customerName: "Misc",
        docType: "made-up-category",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.docType).toBe("other");
  });
});
