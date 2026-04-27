/**
 * Phase 31.2.c — Vendor COI upload helper validation.
 *
 * Locks the contract:
 *   - Empty data → validation_failed.
 *   - Oversize data → validation_failed.
 *   - Disallowed MIME → validation_failed.
 *   - Missing parentFolderId → validation_failed (NEVER falls back
 *     to GOOGLE_DRIVE_UPLOAD_PARENT_ID).
 *   - Missing vendorId → validation_failed.
 *   - Missing OAuth env → drive_oauth_missing.
 *
 * Drive-write success paths are NOT exercised here (mocking Google
 * APIs adds noise; covered separately by integration). The point
 * of these locks is the validation gate BEFORE the Drive call.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { uploadVendorCoi } from "../vendor-coi-upload";

const ORIGINAL_ENV: Record<string, string | undefined> = {};

const ENV_VARS = [
  "GMAIL_OAUTH_CLIENT_ID",
  "GCP_GMAIL_OAUTH_CLIENT_ID",
  "GMAIL_OAUTH_CLIENT_SECRET",
  "GCP_GMAIL_OAUTH_CLIENT_SECRET",
  "GMAIL_OAUTH_REFRESH_TOKEN",
  "GCP_GMAIL_OAUTH_REFRESH_TOKEN",
];

beforeEach(() => {
  for (const k of ENV_VARS) {
    ORIGINAL_ENV[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_VARS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_ENV[k];
  }
});

const GOOD_INPUT = () => ({
  vendorId: "powers-confections",
  displayName: "Powers Confections",
  fileName: "coi-2026.pdf",
  data: Buffer.from("fake-pdf-bytes-here"),
  mimeType: "application/pdf",
  parentFolderId: "1abc",
});

describe("uploadVendorCoi — validation gates", () => {
  it("validation_failed on empty data", async () => {
    const r = await uploadVendorCoi({ ...GOOD_INPUT(), data: Buffer.alloc(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("validation_failed");
      expect(r.error).toMatch(/empty/i);
    }
  });

  it("validation_failed on oversize data (10MB+1)", async () => {
    const oversize = Buffer.alloc(10 * 1024 * 1024 + 1);
    const r = await uploadVendorCoi({ ...GOOD_INPUT(), data: oversize });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("validation_failed");
  });

  it("validation_failed on disallowed MIME", async () => {
    const r = await uploadVendorCoi({
      ...GOOD_INPUT(),
      mimeType: "application/x-msdownload",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("validation_failed");
      expect(r.error).toMatch(/MIME/i);
    }
  });

  it("validation_failed on missing parentFolderId — NEVER falls back to default folder", async () => {
    const r = await uploadVendorCoi({
      ...GOOD_INPUT(),
      parentFolderId: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("validation_failed");
      expect(r.error).toMatch(/parentFolderId/i);
    }
  });

  it("validation_failed on missing vendorId", async () => {
    const r = await uploadVendorCoi({ ...GOOD_INPUT(), vendorId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("validation_failed");
      expect(r.error).toMatch(/vendorId/i);
    }
  });

  it("drive_oauth_missing when env vars are unset (locked: validation passes first)", async () => {
    // Validation has to pass to reach the OAuth check — confirms
    // the "validate input first, then talk to Drive" ordering.
    const r = await uploadVendorCoi(GOOD_INPUT());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("drive_oauth_missing");
      expect(r.error).toMatch(/OAuth/i);
    }
  });

  it("accepts each MIME on the allow-list (validation only — OAuth still blocks)", async () => {
    const allowed = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/heic",
      "image/heif",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    for (const mime of allowed) {
      const r = await uploadVendorCoi({
        ...GOOD_INPUT(),
        mimeType: mime,
      });
      // Each one passes validation but then hits drive_oauth_missing
      // (we cleared the env). That's what we're asserting.
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("drive_oauth_missing");
    }
  });
});
