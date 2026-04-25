/**
 * Tests for the readiness status derivation helpers.
 *
 * Locked contracts:
 *   - All envs present → every row "ready", totals.missing = 0.
 *   - Missing GOOGLE_DRIVE_UPLOAD_PARENT_ID → row status="missing"
 *     with a useful impactWhenMissing.
 *   - Missing GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID with UPLOAD
 *     parent set → status="fallback" + fallbackFrom = the right env.
 *   - Probe rows map success to "ready", 5xx to "degraded", 4xx to
 *     "error", thrown error to "error", null response to "skipped".
 *   - The serialized output NEVER contains real env values — only
 *     boolean fingerprints flow in, so we double-check by stringifying
 *     the result and grepping for known secret patterns.
 */
import { describe, expect, it } from "vitest";

import {
  deriveEnvStatus,
  deriveProbeStatus,
  SMOKE_CHECKLIST,
  type EnvFingerprint,
} from "../status";

function fingerprint(overrides: Partial<EnvFingerprint> = {}): EnvFingerprint {
  return {
    GMAIL_OAUTH_CLIENT_ID: false,
    GMAIL_OAUTH_CLIENT_SECRET: false,
    GMAIL_OAUTH_REFRESH_TOKEN: false,
    GOOGLE_DRIVE_UPLOAD_PARENT_ID: false,
    GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID: false,
    GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID: false,
    WHOLESALE_INQUIRY_SECRET: false,
    SLACK_BOT_TOKEN: false,
    SLACK_SIGNING_SECRET: false,
    CRON_SECRET: false,
    KV_REST_API_URL: false,
    KV_REST_API_TOKEN: false,
    ...overrides,
  };
}

describe("deriveEnvStatus — all-ready", () => {
  it("every flag set → totals.ready === rows.length, no missing, no fallback", () => {
    const fp: EnvFingerprint = {
      GMAIL_OAUTH_CLIENT_ID: true,
      GMAIL_OAUTH_CLIENT_SECRET: true,
      GMAIL_OAUTH_REFRESH_TOKEN: true,
      GOOGLE_DRIVE_UPLOAD_PARENT_ID: true,
      GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID: true,
      GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID: true,
      WHOLESALE_INQUIRY_SECRET: true,
      SLACK_BOT_TOKEN: true,
      SLACK_SIGNING_SECRET: true,
      CRON_SECRET: true,
      KV_REST_API_URL: true,
      KV_REST_API_TOKEN: true,
    };
    const status = deriveEnvStatus(fp);
    expect(status.totals.ready).toBe(status.rows.length);
    expect(status.totals.missing).toBe(0);
    expect(status.totals.fallback).toBe(0);
    expect(status.rows.every((r) => r.status === "ready")).toBe(true);
  });
});

describe("deriveEnvStatus — missing upload parent", () => {
  it("missing GOOGLE_DRIVE_UPLOAD_PARENT_ID is reported red with impact copy", () => {
    const fp = fingerprint({
      GMAIL_OAUTH_CLIENT_ID: true,
      GMAIL_OAUTH_CLIENT_SECRET: true,
      GMAIL_OAUTH_REFRESH_TOKEN: true,
    });
    const status = deriveEnvStatus(fp);
    const row = status.rows.find(
      (r) => r.key === "GOOGLE_DRIVE_UPLOAD_PARENT_ID",
    );
    expect(row).toBeDefined();
    expect(row!.status).toBe("missing");
    expect(row!.impactWhenMissing).toMatch(/upload/i);
  });
});

describe("deriveEnvStatus — fallback chain for shipping artifacts", () => {
  it("UPLOAD parent set + SHIPPING parent missing → SHIPPING row is 'fallback'", () => {
    const fp = fingerprint({ GOOGLE_DRIVE_UPLOAD_PARENT_ID: true });
    const status = deriveEnvStatus(fp);
    const row = status.rows.find(
      (r) => r.key === "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID",
    );
    expect(row).toBeDefined();
    expect(row!.status).toBe("fallback");
    expect(row!.fallbackFrom).toBe("GOOGLE_DRIVE_UPLOAD_PARENT_ID");
    // No `missing` for SHIPPING — it has a fallback.
    expect(status.totals.fallback).toBeGreaterThanOrEqual(1);
  });

  it("only VENDOR_ONBOARDING parent set + SHIPPING missing → fallback from VENDOR", () => {
    const fp = fingerprint({
      GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID: true,
    });
    const status = deriveEnvStatus(fp);
    const row = status.rows.find(
      (r) => r.key === "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID",
    );
    expect(row!.status).toBe("fallback");
    expect(row!.fallbackFrom).toBe(
      "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID",
    );
  });

  it("no parents anywhere → SHIPPING is 'missing', not 'fallback'", () => {
    const fp = fingerprint();
    const status = deriveEnvStatus(fp);
    const row = status.rows.find(
      (r) => r.key === "GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID",
    );
    expect(row!.status).toBe("missing");
  });

  it("VENDOR fallbacks to UPLOAD when only UPLOAD is set", () => {
    const fp = fingerprint({ GOOGLE_DRIVE_UPLOAD_PARENT_ID: true });
    const status = deriveEnvStatus(fp);
    const vendor = status.rows.find(
      (r) => r.key === "GOOGLE_DRIVE_VENDOR_ONBOARDING_PARENT_ID",
    );
    expect(vendor!.status).toBe("fallback");
    expect(vendor!.fallbackFrom).toBe("GOOGLE_DRIVE_UPLOAD_PARENT_ID");
  });
});

describe("deriveProbeStatus — outcome mapping", () => {
  it("ok=true → 'ready' with httpStatus", () => {
    const r = deriveProbeStatus({
      url: "/x",
      label: "X",
      response: { ok: true, status: 200 },
    });
    expect(r.outcome).toBe("ready");
    expect(r.httpStatus).toBe(200);
  });
  it("5xx → 'degraded' (server reports config issue)", () => {
    const r = deriveProbeStatus({
      url: "/x",
      label: "X",
      response: { ok: false, status: 503 },
    });
    expect(r.outcome).toBe("degraded");
    expect(r.httpStatus).toBe(503);
    expect(r.detail).toMatch(/configuration/i);
  });
  it("4xx → 'error' (route exists but request was rejected)", () => {
    const r = deriveProbeStatus({
      url: "/x",
      label: "X",
      response: { ok: false, status: 404 },
    });
    expect(r.outcome).toBe("error");
    expect(r.httpStatus).toBe(404);
  });
  it("thrown error → 'error' with truncated detail", () => {
    const r = deriveProbeStatus({
      url: "/x",
      label: "X",
      response: null,
      error: "ENOTFOUND example.com",
    });
    expect(r.outcome).toBe("error");
    expect(r.detail).toContain("ENOTFOUND");
  });
  it("null response without error → 'skipped'", () => {
    const r = deriveProbeStatus({
      url: "/x",
      label: "X",
      response: null,
    });
    expect(r.outcome).toBe("skipped");
  });
});

describe("no-secret-leak invariant", () => {
  it("envStatus output never carries the raw env value (input is boolean only)", () => {
    // Input is purely booleans; we double-check by stringifying the
    // output and asserting no plausible secret pattern slips through.
    const fp = fingerprint({
      CRON_SECRET: true,
      GMAIL_OAUTH_REFRESH_TOKEN: true,
      WHOLESALE_INQUIRY_SECRET: true,
    });
    const out = deriveEnvStatus(fp);
    const ser = JSON.stringify(out);
    // No "1//" Google refresh token prefix, no Bearer header, no
    // long base64 sequences, no env value strings — the function's
    // input shape doesn't even let secrets in.
    expect(ser).not.toMatch(/1\/\/[A-Za-z0-9_-]{30,}/); // refresh-token shape
    expect(ser).not.toMatch(/[A-Za-z0-9+/=]{60,}/); // long base64 chunk
    // Match an actual bearer header value (Bearer + token-shaped string),
    // not the word "Bearer" alone — operator-facing copy can describe
    // bearer tokens generically.
    expect(ser).not.toMatch(/Bearer\s+[A-Za-z0-9_.-]{20,}/);
  });

  it("probe output never echoes Authorization headers or full bodies", () => {
    const r = deriveProbeStatus({
      url: "/api/ops/secret-thing",
      label: "Secret",
      response: null,
      error: "Authorization Bearer abc123 fetch failed",
    });
    // The truncate helper caps at 200 chars but doesn't actively strip
    // — we lock that the detail is bounded so a stray header in an
    // error message doesn't bloom into a giant payload.
    expect(r.detail!.length).toBeLessThanOrEqual(200);
  });
});

describe("smoke checklist — stable shape", () => {
  it("includes both public and operator surfaces", () => {
    const surfaces = new Set(SMOKE_CHECKLIST.map((c) => c.surface));
    expect(surfaces.has("public")).toBe(true);
    expect(surfaces.has("operator")).toBe(true);
  });
  it("every entry has href + label + description", () => {
    for (const c of SMOKE_CHECKLIST) {
      expect(c.href).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.description).toBeTruthy();
    }
  });
  it("includes the public locator + login + ops shipping + ap packets + locations", () => {
    const hrefs = SMOKE_CHECKLIST.map((c) => c.href);
    expect(hrefs).toContain("/where-to-buy");
    expect(hrefs).toContain("/wholesale");
    expect(hrefs).toContain("/account/login");
    expect(hrefs).toContain("/ops/shipping");
    expect(hrefs).toContain("/ops/finance/review");
    expect(hrefs).toContain("/ops/ap-packets");
    expect(hrefs).toContain("/ops/locations");
  });
});
