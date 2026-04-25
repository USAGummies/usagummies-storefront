/**
 * Wholesale inquiry token — HMAC-signed bearer the customer holds.
 *
 * The wholesale inquiry receipt page (/wholesale/inquiry/[token]) is
 * public, but each visit must prove the holder knows a valid token.
 * Tokens are short, base64url-encoded, and self-contained — no DB
 * lookup is required to verify them. The signature alone is the auth.
 *
 * Why a token (not a login):
 *   A first-touch wholesale prospect has not created an account. They
 *   submitted a form. We want them to be able to bookmark a page that
 *   shows their inquiry status + lets them upload docs we ask for,
 *   without forcing them to sign up. Email-only lookups (like the
 *   existing /wholesale/status) leak deal-state to anyone who knows
 *   the email; a signed token tied to a specific inquiry doesn't.
 *
 * Token shape (base64url-encoded):
 *   <payload>.<signature>
 *
 * Payload (compact JSON before base64url-encoding):
 *   {
 *     v: 1,                 // version, for forward compat
 *     e: "ap@retailer.com", // email (lowercased)
 *     c: 1714080000,        // createdAt — Unix seconds
 *     i: "wholesale-page"   // origin source label
 *   }
 *
 * Signature: HMAC-SHA256(WHOLESALE_INQUIRY_SECRET, payloadBase64) base64url-encoded.
 *
 * TTL: 30 days. Tokens older than that return `expired`.
 *
 * Hard rule: WHOLESALE_INQUIRY_SECRET must be set. signInquiryToken()
 * throws when it isn't (mint-time fail-loud), and verifyInquiryToken()
 * returns `code: "secret_not_configured"` so the route can 503
 * cleanly. Never a silent "treat anything as valid" fallback.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const INQUIRY_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
const TOKEN_VERSION = 1;

export interface InquiryTokenPayload {
  /** Token version. Bumped if the payload shape changes. */
  v: number;
  /** Email address — already lowercased + trimmed at mint time. */
  e: string;
  /** createdAt as Unix seconds (UTC). */
  c: number;
  /** Source label — e.g. "wholesale-page", "footer-cta". */
  i: string;
}

export type VerifyResult =
  | {
      ok: true;
      payload: InquiryTokenPayload;
      ageSeconds: number;
    }
  | {
      ok: false;
      code:
        | "secret_not_configured"
        | "malformed"
        | "bad_signature"
        | "unknown_version"
        | "expired";
      reason: string;
    };

function getSecret(): string | null {
  return process.env.WHOLESALE_INQUIRY_SECRET?.trim() || null;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(s: string): Buffer | null {
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    return Buffer.from(pad ? padded + "=".repeat(4 - pad) : padded, "base64");
  } catch {
    return null;
  }
}

function hmacBase64(payloadB64: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  return base64UrlEncode(sig);
}

/**
 * Mint a fresh inquiry token. Caller must already have a valid email
 * + source label. Throws when WHOLESALE_INQUIRY_SECRET is unset — this
 * is mint-time, so we want the caller to see a 5xx (or skip the
 * inquiryUrl in their response) rather than ship a token that will
 * never verify.
 */
export function signInquiryToken(input: {
  email: string;
  source: string;
  /** Override createdAt for tests. Production callers omit this. */
  now?: Date;
}): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error(
      "WHOLESALE_INQUIRY_SECRET is not set — cannot mint inquiry tokens.",
    );
  }
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("signInquiryToken: email is required");
  }
  const source = input.source.trim() || "unknown";
  const now = input.now ?? new Date();
  const payload: InquiryTokenPayload = {
    v: TOKEN_VERSION,
    e: email,
    c: Math.floor(now.getTime() / 1000),
    i: source,
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = hmacBase64(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a token. Constant-time signature comparison. Returns a
 * structured result so the caller can decide between 401 / 410 / 503.
 *
 * Pass `now` from the caller for testability — production verifiers
 * use `new Date()`.
 */
export function verifyInquiryToken(
  token: string,
  options: { now?: Date } = {},
): VerifyResult {
  const secret = getSecret();
  if (!secret) {
    return {
      ok: false,
      code: "secret_not_configured",
      reason: "WHOLESALE_INQUIRY_SECRET is not set on the server.",
    };
  }
  if (!token || typeof token !== "string") {
    return { ok: false, code: "malformed", reason: "token is empty" };
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return {
      ok: false,
      code: "malformed",
      reason: "token must be <payload>.<signature>",
    };
  }
  const [payloadB64, signatureB64] = parts;
  const payloadBuf = base64UrlDecode(payloadB64);
  if (!payloadBuf) {
    return {
      ok: false,
      code: "malformed",
      reason: "payload not base64url-decodable",
    };
  }

  // Constant-time signature compare BEFORE any payload parse so we
  // don't leak structural details about valid-vs-invalid tokens.
  const expectedSig = hmacBase64(payloadB64, secret);
  const expectedBuf = Buffer.from(expectedSig);
  const actualBuf = Buffer.from(signatureB64);
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return { ok: false, code: "bad_signature", reason: "HMAC mismatch" };
  }

  let payload: InquiryTokenPayload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf-8")) as InquiryTokenPayload;
  } catch {
    return { ok: false, code: "malformed", reason: "payload is not JSON" };
  }
  if (payload.v !== TOKEN_VERSION) {
    return {
      ok: false,
      code: "unknown_version",
      reason: `unsupported token version ${payload.v}`,
    };
  }
  if (
    typeof payload.e !== "string" ||
    typeof payload.c !== "number" ||
    typeof payload.i !== "string"
  ) {
    return {
      ok: false,
      code: "malformed",
      reason: "payload fields missing or wrong type",
    };
  }
  const now = options.now ?? new Date();
  const ageSeconds = Math.floor(now.getTime() / 1000) - payload.c;
  if (ageSeconds < 0) {
    return { ok: false, code: "malformed", reason: "createdAt is in the future" };
  }
  if (ageSeconds > INQUIRY_TOKEN_TTL_SECONDS) {
    return {
      ok: false,
      code: "expired",
      reason: `token is ${ageSeconds}s old, max ${INQUIRY_TOKEN_TTL_SECONDS}s`,
    };
  }
  return { ok: true, payload, ageSeconds };
}

/**
 * Convenience for callers that just want the email when valid, null
 * otherwise. The full structured verify is available via
 * verifyInquiryToken when the route needs to differentiate codes.
 */
export function emailFromInquiryToken(
  token: string,
  options: { now?: Date } = {},
): string | null {
  const r = verifyInquiryToken(token, options);
  return r.ok ? r.payload.e : null;
}

export function isInquirySecretConfigured(): boolean {
  return getSecret() !== null;
}
