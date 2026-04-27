/**
 * Vendor portal token — Phase 31.2.
 *
 * The external vendor portal is the public-facing surface where
 * vendors (Powers Confections, Belmark, Albanese, etc.) can:
 *   - View their own PO history
 *   - Upload renewed COIs (Certificates of Insurance)
 *
 * **Auth model:** tokenized URL per vendor — no account creation.
 *   - Each vendor gets a URL of the form
 *     `https://www.usagummies.com/vendor/<token>` where `<token>`
 *     embeds the vendor id + an expiry + an HMAC-SHA256 signature.
 *   - The signature uses `VENDOR_PORTAL_SECRET` (server-only env).
 *   - The token rotates every 30 days by default; we email a fresh
 *     URL when the old one expires.
 *
 * **Why HMAC + tokenized URL (vs OAuth or JWT):**
 *   - Vendors don't want to create accounts. They're paid by us; we
 *     don't make them set up auth.
 *   - HMAC is a simple, well-understood primitive. We control both
 *     the signer and the verifier; no third-party identity provider
 *     to depend on.
 *   - JWTs would work but bring a serialization surface area (alg
 *     confusion attacks, etc.) we don't need. Plain HMAC over a
 *     compact token format is tighter.
 *
 * **Security invariants** (locked by tests):
 *   1. Tampered tokens fail verification. Flip ANY byte → reject.
 *   2. Expired tokens fail verification regardless of valid HMAC.
 *   3. Constant-time comparison on the HMAC. No timing side-channel.
 *   4. Empty/missing secret → never produces a token (we don't
 *      generate signed-with-empty-key tokens).
 *   5. Empty/missing vendorId → never produces a token.
 *   6. Token format is opaque to the consumer: do NOT decode + use
 *      vendorId without first verifying the signature.
 *
 * **What this module is NOT:**
 *   - It does NOT touch any vendor data, KV, Drive, or external
 *     systems. Pure crypto helpers. Routes + storage are separate.
 *   - It does NOT issue tokens autonomously — token issuance is a
 *     separate operator action (Class A `vendor.portal.issue`)
 *     surfaced via a future admin route.
 *
 * **Token format:** base64url(`<vendorId>:<expiresAt>:<hmacHex>`)
 *   - vendorId: kebab-case (validated to match `^[a-z0-9][a-z0-9-]*$`)
 *   - expiresAt: ISO-8601 (UTC, second-precision)
 *   - hmacHex: 64-char hex of HMAC-SHA256 over `<vendorId>:<expiresAt>`
 *
 * Pure — no I/O, no clock side-effects beyond the explicit `now` arg.
 */
import { createHmac, timingSafeEqual } from "crypto";

const VENDOR_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const HMAC_HEX_LENGTH = 64;

export const TOKEN_DEFAULT_TTL_DAYS = 30;

export interface VendorPortalTokenInput {
  /** Kebab-case stable vendor id (e.g. "powers-confections", "belmark"). */
  vendorId: string;
  /** ISO timestamp at which the token expires. */
  expiresAt: string;
  /** Server-only HMAC key, read from `VENDOR_PORTAL_SECRET` env. */
  secret: string;
}

export interface VendorPortalTokenVerifyResult {
  ok: boolean;
  /** Populated only when `ok=true`. Never trust without verifying. */
  vendorId: string | null;
  /** Populated only when the token PARSES. Always check `ok` first. */
  expiresAt: string | null;
  /** Reason for failure when ok=false; one of a closed enum. */
  reason:
    | null
    | "missing-token"
    | "missing-secret"
    | "malformed-token"
    | "invalid-vendor-id"
    | "invalid-expiry"
    | "expired"
    | "signature-mismatch";
}

/**
 * Generate a vendor-portal token. Throws on missing inputs — we
 * never produce tokens signed with an empty key or for a vendor
 * with no id (those would be silent-but-broken at verification time
 * later, which is worse than a loud throw at issuance time).
 */
export function generateVendorPortalToken(
  input: VendorPortalTokenInput,
): string {
  if (!input.secret || input.secret.length === 0) {
    throw new Error(
      "generateVendorPortalToken: secret is empty — set VENDOR_PORTAL_SECRET",
    );
  }
  if (!input.vendorId || !VENDOR_ID_RE.test(input.vendorId)) {
    throw new Error(
      `generateVendorPortalToken: invalid vendorId ${JSON.stringify(input.vendorId)} — must match ^[a-z0-9][a-z0-9-]*$`,
    );
  }
  // Validate expiresAt parses; we don't enforce future-vs-past here
  // (the caller controls the value), but a garbage timestamp would
  // mean every verification call rejects.
  const expiresMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresMs)) {
    throw new Error(
      `generateVendorPortalToken: invalid expiresAt ${JSON.stringify(input.expiresAt)} — must be ISO-8601`,
    );
  }
  const payload = `${input.vendorId}:${input.expiresAt}`;
  const hmacHex = createHmac("sha256", input.secret).update(payload).digest("hex");
  const raw = `${payload}:${hmacHex}`;
  // base64url so the token is URL-safe (no `+`, `/`, or `=` to
  // wrestle with on the path or in query params).
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * Verify a vendor-portal token. Returns a typed result; NEVER
 * throws on invalid input. Caller branches on `result.ok` and uses
 * `result.vendorId` only when true.
 *
 * Side-channel safety: the HMAC comparison uses
 * `crypto.timingSafeEqual` on equal-length buffers.
 */
export function verifyVendorPortalToken(
  token: string | undefined | null,
  secret: string | undefined | null,
  now: Date = new Date(),
): VendorPortalTokenVerifyResult {
  if (!token) {
    return {
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "missing-token",
    };
  }
  if (!secret) {
    return {
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "missing-secret",
    };
  }
  let raw: string;
  try {
    raw = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return {
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "malformed-token",
    };
  }
  // Format `vendorId:expiresAt:hmacHex`. The expiresAt is itself an
  // ISO timestamp containing colons + dashes, so split from the
  // right side: last segment is the HMAC, second-to-last + before
  // form the `vendorId:expiresAt` payload. Easier: split into 3 by
  // first two colons walking from the LEFT, since vendorId never
  // contains a colon.
  const firstColon = raw.indexOf(":");
  if (firstColon === -1) {
    return {
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "malformed-token",
    };
  }
  const vendorId = raw.slice(0, firstColon);
  const rest = raw.slice(firstColon + 1);
  // Walk from the right: HMAC is the last 64-char hex segment.
  const lastColon = rest.lastIndexOf(":");
  if (lastColon === -1) {
    return {
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "malformed-token",
    };
  }
  const expiresAt = rest.slice(0, lastColon);
  const hmacHex = rest.slice(lastColon + 1);

  if (!VENDOR_ID_RE.test(vendorId)) {
    return {
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "invalid-vendor-id",
    };
  }
  if (hmacHex.length !== HMAC_HEX_LENGTH || !/^[0-9a-f]+$/.test(hmacHex)) {
    return {
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "malformed-token",
    };
  }
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return {
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "invalid-expiry",
    };
  }

  // Constant-time HMAC comparison.
  const expectedHmac = createHmac("sha256", secret)
    .update(`${vendorId}:${expiresAt}`)
    .digest("hex");
  // timingSafeEqual requires equal-length buffers; we already
  // gated `hmacHex.length === 64`, so this is safe.
  let signatureOk = false;
  try {
    signatureOk = timingSafeEqual(
      Buffer.from(hmacHex, "hex"),
      Buffer.from(expectedHmac, "hex"),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return {
      ok: false,
      vendorId: null, // never leak the parsed vendorId on signature failure
      expiresAt: null,
      reason: "signature-mismatch",
    };
  }
  // Expiry is the LAST gate — only after HMAC passes. Intentional:
  // we don't want an attacker probing tokens with arbitrary
  // expiresAt to learn from the timing/error which signature was
  // closer.
  if (expiresMs < now.getTime()) {
    return {
      ok: false,
      vendorId: null,
      expiresAt: null,
      reason: "expired",
    };
  }
  return { ok: true, vendorId, expiresAt, reason: null };
}

/**
 * Build the public vendor-portal URL. Pure — does not write
 * anything. Use the result only after verifying you actually want
 * to share it with the vendor (typically via Gmail send +
 * `vendor.portal.issue` Class A audit envelope).
 */
export function buildVendorPortalUrl(input: {
  baseUrl: string; // e.g. "https://www.usagummies.com"
  vendorId: string;
  expiresAt: string;
  secret: string;
}): string {
  const token = generateVendorPortalToken({
    vendorId: input.vendorId,
    expiresAt: input.expiresAt,
    secret: input.secret,
  });
  // Strip trailing slash on baseUrl to keep the result canonical.
  const base = input.baseUrl.replace(/\/+$/, "");
  return `${base}/vendor/${token}`;
}

/**
 * Compute the canonical default expiry: `now + TOKEN_DEFAULT_TTL_DAYS`
 * at second-precision. Pure.
 */
export function computeDefaultExpiry(now: Date = new Date()): string {
  const next = new Date(
    now.getTime() + TOKEN_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  return next.toISOString().replace(/\.\d{3}Z$/, "Z");
}
