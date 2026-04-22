/**
 * Shopify orders/paid webhook route tests — HMAC + triggered-at
 * replay protection + event-parsing edge cases.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";

import { POST } from "@/app/api/ops/webhooks/shopify/orders-paid/route";

function sign(rawBody: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
}

function mockShopifyRequest(params: {
  rawBody: string;
  secret?: string;
  triggeredAt?: string | null;
  overrideSignature?: string;
}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (params.secret) {
    const sig = params.overrideSignature ?? sign(params.rawBody, params.secret);
    headers.set("x-shopify-hmac-sha256", sig);
  } else if (params.overrideSignature) {
    headers.set("x-shopify-hmac-sha256", params.overrideSignature);
  }
  if (params.triggeredAt !== null) {
    headers.set(
      "x-shopify-triggered-at",
      params.triggeredAt ?? new Date().toISOString(),
    );
  }
  return new Request(
    "https://example.test/api/ops/webhooks/shopify/orders-paid",
    {
      method: "POST",
      headers,
      body: params.rawBody,
    },
  );
}

const MINIMAL_PAYLOAD = JSON.stringify({
  id: 99999,
  name: "#9999",
  created_at: new Date().toISOString(),
  financial_status: "paid",
  total_price: "10.00",
  currency: "USD",
  shipping_address: {
    name: "Test Buyer",
    address1: "1 Main St",
    city: "Austin",
    province_code: "TX",
    zip: "78701",
    country_code: "US",
  },
  line_items: [{ title: "Test", quantity: 1 }],
  tags: "",
});

const origEnv = { ...process.env };

beforeEach(() => {
  // Ensure SLACK_BOT_TOKEN isn't set — prevents the route from
  // actually posting to Slack during tests.
  delete process.env.SLACK_BOT_TOKEN;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in origEnv)) delete process.env[k];
  }
  Object.assign(process.env, origEnv);
});

describe("Shopify orders/paid webhook — HMAC", () => {
  it("accepts when SHOPIFY_WEBHOOK_SECRET is unset (dev path)", async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    const req = mockShopifyRequest({ rawBody: MINIMAL_PAYLOAD });
    const res = await POST(req);
    expect(res.status).not.toBe(401);
  });

  it("accepts a correct HMAC signature", async () => {
    process.env.SHOPIFY_WEBHOOK_SECRET = "test-secret";
    const req = mockShopifyRequest({
      rawBody: MINIMAL_PAYLOAD,
      secret: "test-secret",
    });
    const res = await POST(req);
    expect(res.status).not.toBe(401);
  });

  it("rejects a missing HMAC signature when secret is configured", async () => {
    process.env.SHOPIFY_WEBHOOK_SECRET = "test-secret";
    const req = mockShopifyRequest({ rawBody: MINIMAL_PAYLOAD });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/hmac/i);
  });

  it("rejects a wrong HMAC signature", async () => {
    process.env.SHOPIFY_WEBHOOK_SECRET = "test-secret";
    const req = mockShopifyRequest({
      rawBody: MINIMAL_PAYLOAD,
      overrideSignature: sign(MINIMAL_PAYLOAD, "different-secret"),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects when the body was tampered after signing", async () => {
    process.env.SHOPIFY_WEBHOOK_SECRET = "test-secret";
    const signature = sign(MINIMAL_PAYLOAD, "test-secret");
    const tamperedBody = MINIMAL_PAYLOAD.replace(
      '"quantity":1',
      '"quantity":999',
    );
    expect(tamperedBody).not.toBe(MINIMAL_PAYLOAD); // sanity check
    const headers = new Headers({
      "content-type": "application/json",
      "x-shopify-hmac-sha256": signature,
      "x-shopify-triggered-at": new Date().toISOString(),
    });
    const req = new Request(
      "https://example.test/api/ops/webhooks/shopify/orders-paid",
      { method: "POST", headers, body: tamperedBody },
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("Shopify orders/paid webhook — replay protection (triggered-at)", () => {
  it("accepts absent triggered-at header (local test path)", async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    const req = mockShopifyRequest({
      rawBody: MINIMAL_PAYLOAD,
      triggeredAt: null,
    });
    const res = await POST(req);
    expect(res.status).not.toBe(401);
  });

  it("accepts fresh triggered-at (within 5 min)", async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    const req = mockShopifyRequest({
      rawBody: MINIMAL_PAYLOAD,
      triggeredAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await POST(req);
    expect(res.status).not.toBe(401);
  });

  it("rejects stale triggered-at (older than 5 min)", async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    const req = mockShopifyRequest({
      rawBody: MINIMAL_PAYLOAD,
      triggeredAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/triggered-at/i);
  });

  it("rejects future-dated triggered-at (outside tolerance)", async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    const req = mockShopifyRequest({
      rawBody: MINIMAL_PAYLOAD,
      triggeredAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("accepts unparseable triggered-at gracefully (don't block)", async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    const req = mockShopifyRequest({
      rawBody: MINIMAL_PAYLOAD,
      triggeredAt: "not-a-date",
    });
    const res = await POST(req);
    // Unparseable → absent-header semantics → 200, not 401.
    expect(res.status).not.toBe(401);
  });
});

describe("Shopify orders/paid webhook — payload handling", () => {
  it("returns 400 on invalid JSON body", async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    const req = new Request(
      "https://example.test/api/ops/webhooks/shopify/orders-paid",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not valid json",
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
