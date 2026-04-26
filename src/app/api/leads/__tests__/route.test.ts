/**
 * Tests for the inquiryUrl behavior added to /api/leads.
 *
 * Locked contracts:
 *   - Wholesale submissions with email + secret set → response includes
 *     `inquiryUrl` pointing at /wholesale/inquiry/<token>
 *   - Wholesale submissions when WHOLESALE_INQUIRY_SECRET is unset → response
 *     omits inquiryUrl. The form's existing success state still works.
 *   - Non-wholesale submissions never get an inquiryUrl, even if the secret
 *     is set (this token is for the wholesale receipt page only).
 *   - Submissions without an email never get an inquiryUrl.
 *   - The token in inquiryUrl verifies back to the submitted email.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyInquiryToken } from "@/lib/wholesale/inquiry-token";

const SECRET = "test-secret-do-not-use-in-prod";

beforeEach(() => {
  process.env.WHOLESALE_INQUIRY_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.usagummies.com";
});
afterEach(() => {
  delete process.env.WHOLESALE_INQUIRY_SECRET;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

function postJson(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/leads inquiryUrl behavior", () => {
  it("wholesale submission with email returns inquiryUrl whose token verifies", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postJson({
        email: "ap@retailer.com",
        intent: "wholesale",
        source: "wholesale-page",
        buyerName: "Test Buyer",
        storeName: "Test Store",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; inquiryUrl?: string };
    expect(body.ok).toBe(true);
    expect(typeof body.inquiryUrl).toBe("string");
    expect(body.inquiryUrl).toMatch(
      /^https:\/\/www\.usagummies\.com\/wholesale\/inquiry\/[A-Za-z0-9_%.-]+$/,
    );

    // Extract token from the URL and verify it.
    const path = body.inquiryUrl!.replace(
      /^https:\/\/www\.usagummies\.com\/wholesale\/inquiry\//,
      "",
    );
    const token = decodeURIComponent(path);
    const r = verifyInquiryToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.e).toBe("ap@retailer.com");
  });

  it("wholesale submission omits inquiryUrl when WHOLESALE_INQUIRY_SECRET is unset (fail-soft)", async () => {
    delete process.env.WHOLESALE_INQUIRY_SECRET;
    const { POST } = await import("../route");
    const res = await POST(
      postJson({
        email: "ap@retailer.com",
        intent: "wholesale",
        source: "wholesale-page",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; inquiryUrl?: string };
    expect(body.ok).toBe(true);
    expect(body.inquiryUrl).toBeUndefined();
  });

  it("non-wholesale submissions never get an inquiryUrl (newsletter/footer/etc.)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postJson({
        email: "shopper@gmail.com",
        intent: "newsletter",
        source: "footer",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; inquiryUrl?: string };
    expect(body.ok).toBe(true);
    expect(body.inquiryUrl).toBeUndefined();
  });

  it("wholesale submission without email is rejected before token mint", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postJson({ intent: "wholesale", source: "wholesale-page" }),
    );
    expect(res.status).toBe(400);
  });

  it("response uses path-only URL when NEXT_PUBLIC_SITE_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { POST } = await import("../route");
    const res = await POST(
      postJson({
        email: "ap@retailer.com",
        intent: "wholesale",
        source: "wholesale-page",
      }),
    );
    const body = (await res.json()) as { inquiryUrl?: string };
    expect(body.inquiryUrl).toMatch(/^\/wholesale\/inquiry\//);
  });
});
