/**
 * Tests for the wholesale inquiry token module.
 *
 * Locked contracts:
 *   - sign + verify roundtrip succeeds for current version
 *   - missing WHOLESALE_INQUIRY_SECRET fails CLOSED on both sign and verify
 *     (sign throws, verify returns secret_not_configured)
 *   - tampered payload → bad_signature
 *   - tampered signature → bad_signature
 *   - garbled token shape → malformed
 *   - expired token (older than 30 days) → expired
 *   - future-stamped token → malformed (clock skew defense)
 *   - unknown version → unknown_version
 *   - email is lowercased on mint
 *   - emailFromInquiryToken returns null for any failure code
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  emailFromInquiryToken,
  INQUIRY_TOKEN_TTL_SECONDS,
  isInquirySecretConfigured,
  signInquiryToken,
  verifyInquiryToken,
} from "../inquiry-token";

const SECRET = "test-secret-do-not-use-in-prod";

beforeEach(() => {
  process.env.WHOLESALE_INQUIRY_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.WHOLESALE_INQUIRY_SECRET;
});

describe("signInquiryToken / verifyInquiryToken — roundtrip", () => {
  it("mints + verifies a fresh token for a wholesale lead", () => {
    const now = new Date("2026-04-25T12:00:00Z");
    const token = signInquiryToken({
      email: "ap@retailer.com",
      source: "wholesale-page",
      now,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const r = verifyInquiryToken(token, { now });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.e).toBe("ap@retailer.com");
      expect(r.payload.i).toBe("wholesale-page");
      expect(r.payload.v).toBe(1);
      expect(r.ageSeconds).toBe(0);
    }
  });

  it("lowercases the email at mint time so verify is case-stable", () => {
    const token = signInquiryToken({
      email: "  AP@Retailer.COM  ",
      source: "wholesale-page",
    });
    const r = verifyInquiryToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.e).toBe("ap@retailer.com");
  });

  it("emailFromInquiryToken convenience returns the email or null", () => {
    const token = signInquiryToken({
      email: "x@y.com",
      source: "wholesale-page",
    });
    expect(emailFromInquiryToken(token)).toBe("x@y.com");
    expect(emailFromInquiryToken("garbage")).toBeNull();
  });
});

describe("fail-closed when WHOLESALE_INQUIRY_SECRET is missing", () => {
  it("sign throws when the secret is unset", () => {
    delete process.env.WHOLESALE_INQUIRY_SECRET;
    expect(() =>
      signInquiryToken({ email: "x@y.com", source: "wholesale-page" }),
    ).toThrow(/WHOLESALE_INQUIRY_SECRET/);
  });

  it("verify returns secret_not_configured when the secret is unset", () => {
    const token = signInquiryToken({ email: "x@y.com", source: "wholesale-page" });
    delete process.env.WHOLESALE_INQUIRY_SECRET;
    const r = verifyInquiryToken(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("secret_not_configured");
  });

  it("isInquirySecretConfigured tracks the env var", () => {
    expect(isInquirySecretConfigured()).toBe(true);
    delete process.env.WHOLESALE_INQUIRY_SECRET;
    expect(isInquirySecretConfigured()).toBe(false);
  });
});

describe("tampered tokens are rejected", () => {
  it("flipping a single character in the payload → bad_signature", () => {
    const token = signInquiryToken({ email: "a@b.com", source: "wholesale-page" });
    const [payload, sig] = token.split(".");
    const flipped = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    const tampered = `${flipped}.${sig}`;
    const r = verifyInquiryToken(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("bad_signature");
  });

  it("re-signing with a different secret → bad_signature against the real one", () => {
    process.env.WHOLESALE_INQUIRY_SECRET = "attacker-secret";
    const wrongToken = signInquiryToken({
      email: "a@b.com",
      source: "wholesale-page",
    });
    process.env.WHOLESALE_INQUIRY_SECRET = SECRET;
    const r = verifyInquiryToken(wrongToken);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("bad_signature");
  });

  it("garbage token → malformed", () => {
    const r = verifyInquiryToken("not-even-dotted");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("malformed");
  });

  it("empty token → malformed", () => {
    const r = verifyInquiryToken("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("malformed");
  });
});

describe("TTL boundaries", () => {
  it("token at exactly TTL boundary still verifies", () => {
    const minted = new Date("2026-01-01T00:00:00Z");
    const token = signInquiryToken({
      email: "x@y.com",
      source: "wholesale-page",
      now: minted,
    });
    const justWithin = new Date(
      minted.getTime() + INQUIRY_TOKEN_TTL_SECONDS * 1000,
    );
    const r = verifyInquiryToken(token, { now: justWithin });
    expect(r.ok).toBe(true);
  });

  it("token one second past TTL → expired", () => {
    const minted = new Date("2026-01-01T00:00:00Z");
    const token = signInquiryToken({
      email: "x@y.com",
      source: "wholesale-page",
      now: minted,
    });
    const justAfter = new Date(
      minted.getTime() + (INQUIRY_TOKEN_TTL_SECONDS + 1) * 1000,
    );
    const r = verifyInquiryToken(token, { now: justAfter });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("expired");
  });

  it("future-dated token (clock-skew attack) → malformed", () => {
    const minted = new Date("2030-01-01T00:00:00Z");
    const token = signInquiryToken({
      email: "x@y.com",
      source: "wholesale-page",
      now: minted,
    });
    const earlier = new Date("2026-04-25T00:00:00Z");
    const r = verifyInquiryToken(token, { now: earlier });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("malformed");
  });
});
