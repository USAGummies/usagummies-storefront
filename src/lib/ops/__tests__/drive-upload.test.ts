/**
 * Drive upload module — validation gates + fail-closed paths.
 *
 * These tests cover the pure validation logic: env-missing, oversize,
 * disallowed MIME, empty file, invalid docType. They do NOT touch the
 * network — when Drive env is unset, `uploadDurableFile` returns the
 * fail-closed result before reaching `googleapis`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALLOWED_UPLOAD_MIME_TYPES,
  DOC_TYPES,
  MAX_UPLOAD_BYTES,
  isDurableUploadConfigured,
  uploadDurableFile,
  __resetDurableUploadCacheForTest,
} from "../drive-upload";

const ENV_KEYS = [
  "GOOGLE_DRIVE_UPLOAD_PARENT_ID",
  "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID",
  "DRIVE_VENDOR_ONBOARDING_PARENT_ID",
  "GMAIL_OAUTH_CLIENT_ID",
  "GMAIL_OAUTH_CLIENT_SECRET",
  "GMAIL_OAUTH_REFRESH_TOKEN",
  "GCP_GMAIL_OAUTH_CLIENT_ID",
  "GCP_GMAIL_OAUTH_CLIENT_SECRET",
  "GCP_GMAIL_OAUTH_REFRESH_TOKEN",
];

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  __resetDurableUploadCacheForTest();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = originalEnv[k];
    }
  }
});

describe("drive-upload module", () => {
  it("DOC_TYPES is the locked union of doc categories", () => {
    expect(DOC_TYPES).toEqual(["ncs", "w9", "coi", "receipt", "vendor-form", "other"]);
  });

  it("ALLOWED_UPLOAD_MIME_TYPES includes PDF + standard images + Word", () => {
    expect(ALLOWED_UPLOAD_MIME_TYPES).toContain("application/pdf");
    expect(ALLOWED_UPLOAD_MIME_TYPES).toContain("image/png");
    expect(ALLOWED_UPLOAD_MIME_TYPES).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("MAX_UPLOAD_BYTES is 10 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  it("isDurableUploadConfigured returns false when env is unset", () => {
    expect(isDurableUploadConfigured()).toBe(false);
  });

  it("isDurableUploadConfigured returns true when both parent + OAuth env are set", () => {
    process.env.GOOGLE_DRIVE_UPLOAD_PARENT_ID = "parent-1";
    process.env.GMAIL_OAUTH_CLIENT_ID = "id";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "secret";
    process.env.GMAIL_OAUTH_REFRESH_TOKEN = "token";
    expect(isDurableUploadConfigured()).toBe(true);
  });

  it("fails closed with drive_not_configured when no parent id is set", async () => {
    process.env.GMAIL_OAUTH_CLIENT_ID = "id";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "secret";
    process.env.GMAIL_OAUTH_REFRESH_TOKEN = "token";
    const result = await uploadDurableFile({
      fileName: "x.pdf",
      data: Buffer.from("hi"),
      mimeType: "application/pdf",
      docType: "ncs",
      submitter: "Anon",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("drive_not_configured");
    }
  });

  it("fails closed with drive_oauth_missing when refresh token is unset", async () => {
    process.env.GOOGLE_DRIVE_UPLOAD_PARENT_ID = "parent-1";
    const result = await uploadDurableFile({
      fileName: "x.pdf",
      data: Buffer.from("hi"),
      mimeType: "application/pdf",
      docType: "ncs",
      submitter: "Anon",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("drive_oauth_missing");
    }
  });

  it("rejects empty file before any Drive call", async () => {
    const result = await uploadDurableFile({
      fileName: "x.pdf",
      data: Buffer.alloc(0),
      mimeType: "application/pdf",
      docType: "ncs",
      submitter: "Anon",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation_failed");
      expect(result.error).toMatch(/Empty file/i);
    }
  });

  it("rejects oversize before any Drive call", async () => {
    const result = await uploadDurableFile({
      fileName: "x.pdf",
      data: Buffer.alloc(MAX_UPLOAD_BYTES + 1),
      mimeType: "application/pdf",
      docType: "ncs",
      submitter: "Anon",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation_failed");
      expect(result.error).toMatch(/exceeds/);
    }
  });

  it("rejects disallowed MIME before any Drive call", async () => {
    const result = await uploadDurableFile({
      fileName: "x.exe",
      data: Buffer.from("hi"),
      mimeType: "application/x-msdownload",
      docType: "other",
      submitter: "Anon",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation_failed");
      expect(result.error).toMatch(/MIME type not allowed/);
    }
  });

  it("rejects unknown docType (defensive — route normalizes upstream)", async () => {
    const result = await uploadDurableFile({
      fileName: "x.pdf",
      data: Buffer.from("hi"),
      mimeType: "application/pdf",
      // Forced cast to test the defensive guard inside the module.
      docType: "totally-made-up" as unknown as "ncs",
      submitter: "Anon",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation_failed");
      expect(result.error).toMatch(/docType not allowed/);
    }
  });
});
