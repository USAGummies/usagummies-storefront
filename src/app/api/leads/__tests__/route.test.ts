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

/**
 * Phase 1.b — HubSpot deal-create wired directly into /api/leads.
 *
 * Locks the contract:
 *   - When `isHubSpotConfigured()` returns false, the route skips the
 *     HubSpot branch silently (no error, response stays 200, response
 *     omits `hubspotDealId` / `hubspotContactId`). This is the
 *     dev / preview / test default and was the established behavior
 *     before this phase shipped.
 *   - When configured, a wholesale submission upserts the contact +
 *     creates a deal in one round trip (per `createDeal` association),
 *     stamps `payment_method=invoice_me` + `dealstage=STAGE_LEAD` +
 *     `onboarding_complete=false` + `payment_received=false`, and
 *     drops a structured note on the deal.
 *   - Non-wholesale (intent=newsletter / footer / etc.) NEVER touches
 *     HubSpot, regardless of configuration.
 *   - Submissions without email NEVER touch HubSpot — the deal needs
 *     a contact, and the contact needs an email key.
 */
describe("POST /api/leads — HubSpot deal-create", () => {
  it("does NOT call HubSpot when HUBSPOT_PRIVATE_APP_TOKEN is unset (dev / preview default)", async () => {
    // Note: we don't mock fetch here — `isHubSpotConfigured()` reads
    // the env var directly and returns false when unset, which short-
    // circuits before any fetch call. This locks the silent-skip path.
    delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const { POST } = await import("../route");
    const res = await POST(
      postJson({
        email: "shop@retailer.com",
        intent: "wholesale",
        source: "wholesale-page",
        storeName: "Snow Leopard Ventures LLC (TEST)",
        buyerName: "Test Operator",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      hubspotDealId?: string;
      hubspotContactId?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.hubspotDealId).toBeUndefined();
    expect(body.hubspotContactId).toBeUndefined();
  });

  it("non-wholesale intents NEVER call HubSpot, even when configured", async () => {
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "stub-token";
    let hubspotCalled = false;
    const originalFetch = global.fetch;
    global.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.hubapi.com")) hubspotCalled = true;
      // Pretend webhook + Notion + HubSpot all succeed harmlessly.
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }) as typeof global.fetch;
    try {
      const { POST } = await import("../route");
      await POST(
        postJson({
          email: "subscriber@example.com",
          intent: "newsletter",
          source: "footer",
        }),
      );
      expect(hubspotCalled).toBe(false);
    } finally {
      global.fetch = originalFetch;
      delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    }
  });

  it("wholesale submission without email skips HubSpot (no contact key)", async () => {
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = "stub-token";
    let hubspotCalled = false;
    const originalFetch = global.fetch;
    global.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.hubapi.com")) hubspotCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof global.fetch;
    try {
      const { POST } = await import("../route");
      const res = await POST(
        postJson({
          phone: "555-0100", // phone-only inquiry
          intent: "wholesale",
          source: "wholesale-page",
        }),
      );
      expect(res.status).toBe(200);
      expect(hubspotCalled).toBe(false);
    } finally {
      global.fetch = originalFetch;
      delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    }
  });
});
