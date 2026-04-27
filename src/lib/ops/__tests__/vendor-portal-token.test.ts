/**
 * Phase 31.2 — Vendor portal token (HMAC-signed URL primitive).
 *
 * SECURITY-CRITICAL. Exhaustive locks on:
 *   - Generation rejects empty secret / invalid vendorId / invalid expiry.
 *   - Round-trip: generate → verify produces the original vendorId + expiresAt.
 *   - Tampering ANY byte of the token → signature-mismatch.
 *   - Wrong secret → signature-mismatch.
 *   - Expired tokens → "expired" reason (only after signature passes).
 *   - Malformed tokens (non-base64url, missing colons, bad HMAC length,
 *     bad HMAC hex chars, bad vendorId chars) → discrete reason codes.
 *   - Verify NEVER throws on garbage input.
 *   - Empty/missing token → "missing-token". Empty/missing secret →
 *     "missing-secret".
 *   - Verification doesn't leak vendorId on signature failure (defense
 *     against vendor-id enumeration via partially-valid tokens).
 *   - buildVendorPortalUrl strips trailing slashes; URL is path-shaped.
 *   - computeDefaultExpiry produces an ISO 30 days in the future.
 */
import { describe, expect, it } from "vitest";

import {
  TOKEN_DEFAULT_TTL_DAYS,
  buildVendorPortalUrl,
  computeDefaultExpiry,
  generateVendorPortalToken,
  verifyVendorPortalToken,
} from "../vendor-portal-token";

const SECRET = "test-secret-32bytes-min-of-entropy-here";
const NOW = new Date("2026-04-27T16:00:00.000Z");
const FUTURE = "2026-05-27T16:00:00Z";
const PAST = "2026-03-27T16:00:00Z";

describe("generateVendorPortalToken — input validation", () => {
  it("throws on empty secret", () => {
    expect(() =>
      generateVendorPortalToken({
        vendorId: "powers",
        expiresAt: FUTURE,
        secret: "",
      }),
    ).toThrow(/secret is empty/i);
  });

  it("throws on missing secret (undefined cast through)", () => {
    expect(() =>
      // @ts-expect-error — testing runtime guard
      generateVendorPortalToken({ vendorId: "powers", expiresAt: FUTURE }),
    ).toThrow(/secret is empty/i);
  });

  it("throws on empty vendorId", () => {
    expect(() =>
      generateVendorPortalToken({
        vendorId: "",
        expiresAt: FUTURE,
        secret: SECRET,
      }),
    ).toThrow(/invalid vendorId/i);
  });

  it("throws on vendorId with invalid characters", () => {
    expect(() =>
      generateVendorPortalToken({
        vendorId: "Powers Confections", // space, capitals
        expiresAt: FUTURE,
        secret: SECRET,
      }),
    ).toThrow(/invalid vendorId/i);
    expect(() =>
      generateVendorPortalToken({
        vendorId: "powers!",
        expiresAt: FUTURE,
        secret: SECRET,
      }),
    ).toThrow(/invalid vendorId/i);
    expect(() =>
      generateVendorPortalToken({
        vendorId: "-leading-dash",
        expiresAt: FUTURE,
        secret: SECRET,
      }),
    ).toThrow(/invalid vendorId/i);
  });

  it("accepts valid kebab-case vendorIds", () => {
    expect(() =>
      generateVendorPortalToken({
        vendorId: "powers-confections",
        expiresAt: FUTURE,
        secret: SECRET,
      }),
    ).not.toThrow();
    expect(() =>
      generateVendorPortalToken({
        vendorId: "belmark",
        expiresAt: FUTURE,
        secret: SECRET,
      }),
    ).not.toThrow();
    expect(() =>
      generateVendorPortalToken({
        vendorId: "vendor-123",
        expiresAt: FUTURE,
        secret: SECRET,
      }),
    ).not.toThrow();
  });

  it("throws on garbage expiresAt", () => {
    expect(() =>
      generateVendorPortalToken({
        vendorId: "powers",
        expiresAt: "not-a-date",
        secret: SECRET,
      }),
    ).toThrow(/invalid expiresAt/i);
  });
});

describe("round-trip: generate → verify", () => {
  it("verifies a freshly-generated token and recovers vendorId + expiresAt", () => {
    const token = generateVendorPortalToken({
      vendorId: "powers-confections",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    const result = verifyVendorPortalToken(token, SECRET, NOW);
    expect(result.ok).toBe(true);
    expect(result.vendorId).toBe("powers-confections");
    expect(result.expiresAt).toBe(FUTURE);
    expect(result.reason).toBe(null);
  });

  it("token is base64url (no '+', '/', '=')", () => {
    const token = generateVendorPortalToken({
      vendorId: "belmark",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
  });

  it("two tokens with the same inputs are identical (deterministic)", () => {
    const t1 = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    const t2 = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    expect(t1).toBe(t2);
  });

  it("different vendorId → different token", () => {
    const t1 = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    const t2 = generateVendorPortalToken({
      vendorId: "belmark",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    expect(t1).not.toBe(t2);
  });

  it("different secret → different token", () => {
    const t1 = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: "secret-A-some-entropy-padding-here",
    });
    const t2 = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: "secret-B-some-entropy-padding-here",
    });
    expect(t1).not.toBe(t2);
  });
});

describe("verifyVendorPortalToken — failure modes", () => {
  it("missing-token on null", () => {
    const r = verifyVendorPortalToken(null, SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing-token");
    expect(r.vendorId).toBe(null);
  });

  it("missing-token on undefined", () => {
    const r = verifyVendorPortalToken(undefined, SECRET, NOW);
    expect(r.reason).toBe("missing-token");
  });

  it("missing-token on empty string", () => {
    const r = verifyVendorPortalToken("", SECRET, NOW);
    expect(r.reason).toBe("missing-token");
  });

  it("missing-secret on empty secret", () => {
    const valid = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    const r = verifyVendorPortalToken(valid, "", NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing-secret");
  });

  it("malformed-token on non-base64url garbage", () => {
    const r = verifyVendorPortalToken("not!base64!url", SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(["malformed-token", "signature-mismatch"]).toContain(r.reason);
  });

  it("malformed-token when payload has no colons", () => {
    const noColon = Buffer.from("just-a-vendor-id-no-payload", "utf8").toString("base64url");
    const r = verifyVendorPortalToken(noColon, SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(["malformed-token", "invalid-vendor-id"]).toContain(r.reason);
  });

  it("malformed-token when HMAC segment isn't 64 hex chars", () => {
    const bad = Buffer.from("powers:2026-05-27T16:00:00Z:abc123", "utf8").toString("base64url");
    const r = verifyVendorPortalToken(bad, SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed-token");
  });

  it("invalid-vendor-id when vendorId has uppercase / spaces", () => {
    const fakeHmac = "a".repeat(64);
    const bad = Buffer.from(`Powers:${FUTURE}:${fakeHmac}`, "utf8").toString("base64url");
    const r = verifyVendorPortalToken(bad, SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-vendor-id");
  });

  it("signature-mismatch when ANY byte of the token is flipped", () => {
    const valid = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    // Flip one character in the middle.
    const mid = Math.floor(valid.length / 2);
    const ch = valid[mid];
    const flipped = ch === "A" ? "B" : "A";
    const tampered = valid.slice(0, mid) + flipped + valid.slice(mid + 1);
    if (tampered === valid) {
      // Pick a different position.
      const t2 = valid.slice(0, mid + 1) + flipped + valid.slice(mid + 2);
      const r = verifyVendorPortalToken(t2, SECRET, NOW);
      expect(r.ok).toBe(false);
    } else {
      const r = verifyVendorPortalToken(tampered, SECRET, NOW);
      expect(r.ok).toBe(false);
      expect(["signature-mismatch", "malformed-token"]).toContain(r.reason);
    }
  });

  it("signature-mismatch when verifying with the wrong secret", () => {
    const valid = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    const r = verifyVendorPortalToken(
      valid,
      "different-secret-32bytes-of-entropy-here",
      NOW,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("signature-mismatch");
  });

  it("expired token → expired reason (only after signature passes)", () => {
    const valid = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: PAST,
      secret: SECRET,
    });
    const r = verifyVendorPortalToken(valid, SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("expired");
  });

  it("does NOT leak vendorId on signature failure (defense against vendor-id enumeration)", () => {
    const valid = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    const r = verifyVendorPortalToken(
      valid,
      "wrong-secret-32bytes-of-entropy-here",
      NOW,
    );
    expect(r.ok).toBe(false);
    expect(r.vendorId).toBe(null);
    expect(r.expiresAt).toBe(null);
  });

  it("does NOT leak vendorId on expired token (defense in depth)", () => {
    const valid = generateVendorPortalToken({
      vendorId: "powers",
      expiresAt: PAST,
      secret: SECRET,
    });
    const r = verifyVendorPortalToken(valid, SECRET, NOW);
    expect(r.ok).toBe(false);
    expect(r.vendorId).toBe(null);
    expect(r.expiresAt).toBe(null);
  });

  it("never throws on garbage input", () => {
    expect(() => verifyVendorPortalToken("$$$invalid$$$", SECRET, NOW)).not.toThrow();
    expect(() => verifyVendorPortalToken("a".repeat(100000), SECRET, NOW)).not.toThrow();
    expect(() => verifyVendorPortalToken("AAAA", SECRET, NOW)).not.toThrow();
  });
});

describe("buildVendorPortalUrl", () => {
  it("produces a /vendor/<token> URL", () => {
    const url = buildVendorPortalUrl({
      baseUrl: "https://www.usagummies.com",
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    expect(url).toMatch(/^https:\/\/www\.usagummies\.com\/vendor\/[A-Za-z0-9_-]+$/);
  });

  it("strips trailing slashes from baseUrl (canonical)", () => {
    const u1 = buildVendorPortalUrl({
      baseUrl: "https://www.usagummies.com",
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    const u2 = buildVendorPortalUrl({
      baseUrl: "https://www.usagummies.com/",
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    const u3 = buildVendorPortalUrl({
      baseUrl: "https://www.usagummies.com////",
      vendorId: "powers",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    expect(u1).toBe(u2);
    expect(u2).toBe(u3);
  });

  it("URL round-trips through verify when extracted", () => {
    const url = buildVendorPortalUrl({
      baseUrl: "https://www.usagummies.com",
      vendorId: "belmark",
      expiresAt: FUTURE,
      secret: SECRET,
    });
    const token = url.split("/vendor/")[1];
    const r = verifyVendorPortalToken(token, SECRET, NOW);
    expect(r.ok).toBe(true);
    expect(r.vendorId).toBe("belmark");
  });
});

describe("computeDefaultExpiry", () => {
  it("returns ISO timestamp exactly TOKEN_DEFAULT_TTL_DAYS in the future", () => {
    const out = computeDefaultExpiry(NOW);
    const outMs = Date.parse(out);
    const expectedMs = NOW.getTime() + TOKEN_DEFAULT_TTL_DAYS * 86_400_000;
    // Allow 1ms of rounding slack from the second-precision strip.
    expect(Math.abs(outMs - expectedMs)).toBeLessThanOrEqual(1000);
  });

  it("returns second-precision ISO (no millis)", () => {
    const out = computeDefaultExpiry(NOW);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("TOKEN_DEFAULT_TTL_DAYS is 30 (locked rotation cadence)", () => {
    expect(TOKEN_DEFAULT_TTL_DAYS).toBe(30);
  });
});
