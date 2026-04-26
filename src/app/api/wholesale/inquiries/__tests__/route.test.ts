/**
 * Tests for GET /api/wholesale/inquiries.
 *
 * Locked contracts:
 *   - 200 + scrubbed payload for a valid token
 *   - 400 if no token query param
 *   - 401 on bad signature
 *   - 410 on expired token
 *   - 503 when WHOLESALE_INQUIRY_SECRET is unset (fail closed)
 *   - response NEVER includes the raw token, signature, or HubSpot data
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  INQUIRY_TOKEN_TTL_SECONDS,
  signInquiryToken,
} from "@/lib/wholesale/inquiry-token";

const SECRET = "test-secret-do-not-use-in-prod";

beforeEach(() => {
  process.env.WHOLESALE_INQUIRY_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.WHOLESALE_INQUIRY_SECRET;
});

function buildReq(qs: string = ""): Request {
  return new Request(`http://localhost/api/wholesale/inquiries${qs}`, {
    method: "GET",
  });
}

describe("GET /api/wholesale/inquiries", () => {
  it("200 with scrubbed payload for a valid token", async () => {
    const token = signInquiryToken({
      email: "ap@retailer.com",
      source: "wholesale-page",
    });
    const { GET } = await import("../route");
    const res = await GET(buildReq(`?token=${encodeURIComponent(token)}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      inquiry: {
        email: string;
        source: string;
        createdAt: string;
        ageSeconds: number;
        ageDays: number;
        version: number;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.inquiry.email).toBe("ap@retailer.com");
    expect(body.inquiry.source).toBe("wholesale-page");
    expect(body.inquiry.version).toBe(1);
    expect(typeof body.inquiry.ageSeconds).toBe("number");
    // Defensive: response must NOT include the raw token or any HubSpot data.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain("dealstage");
    expect(raw).not.toContain("hubspot");
  });

  it("400 when token query param is missing", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq());
    expect(res.status).toBe(400);
  });

  it("401 on tampered signature", async () => {
    const token = signInquiryToken({
      email: "x@y.com",
      source: "wholesale-page",
    });
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    const { GET } = await import("../route");
    const res = await GET(buildReq(`?token=${encodeURIComponent(tampered)}`));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("bad_signature");
  });

  it("410 on expired token", async () => {
    const minted = new Date(
      Date.now() - (INQUIRY_TOKEN_TTL_SECONDS + 60) * 1000,
    );
    const token = signInquiryToken({
      email: "x@y.com",
      source: "wholesale-page",
      now: minted,
    });
    const { GET } = await import("../route");
    const res = await GET(buildReq(`?token=${encodeURIComponent(token)}`));
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("expired");
  });

  it("503 when WHOLESALE_INQUIRY_SECRET is unset (fail closed)", async () => {
    const token = signInquiryToken({
      email: "x@y.com",
      source: "wholesale-page",
    });
    delete process.env.WHOLESALE_INQUIRY_SECRET;
    const { GET } = await import("../route");
    const res = await GET(buildReq(`?token=${encodeURIComponent(token)}`));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("secret_not_configured");
  });

  it("400 on garbage token", async () => {
    const { GET } = await import("../route");
    const res = await GET(buildReq("?token=garbage"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("malformed");
  });
});
