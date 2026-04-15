/**
 * Shopify Webhook — orders/paid
 *
 * Registered topic: `orders/paid` (or `draft_orders/completed` — whichever
 * Shopify fires first after the customer completes the hosted Shop Pay
 * checkout for a booth draft order).
 *
 * Flow:
 *   1. Validate HMAC signature from Shopify against SHOPIFY_WEBHOOK_SECRET.
 *   2. Parse order payload; match by customer email or draft order reference.
 *   3. Find the corresponding HubSpot deal (by contact email on the B2B
 *      Wholesale pipeline, most recent at "PO Received" stage).
 *   4. Flip `wholesale_payment_received` = true on the deal.
 *   5. If `wholesale_onboarding_complete` is also true, advance the deal
 *      stage to "Shipped" (3017718460) and ping Drew for pack prep.
 *   6. Slack ping #financials with the revenue + deal link.
 *
 * Non-blocking: any failure path returns 200 to Shopify (so it doesn't
 * retry storm us) but logs to console + Slack for manual follow-up.
 *
 * Security: HMAC signature is mandatory. A request without a valid
 * signature returns 401 without touching state.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { HUBSPOT, isHubSpotConfigured, createNote } from "@/lib/ops/hubspot-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HUBSPOT_API = "https://api.hubapi.com";

function hsToken(): string | null {
  return process.env.HUBSPOT_PRIVATE_APP_TOKEN?.trim() || null;
}

async function hsRequest<T = Record<string, unknown>>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T | null> {
  const token = hsToken();
  if (!token) return null;
  try {
    const res = await fetch(`${HUBSPOT_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type ShopifyLine = { title?: string; quantity?: number; price?: string };
type ShopifyOrder = {
  id?: number;
  name?: string;
  email?: string;
  total_price?: string;
  financial_status?: string;
  order_status_url?: string;
  line_items?: ShopifyLine[];
  tags?: string;
  customer?: { email?: string };
};

function verifyHmac(body: string, headerHmac: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !headerHmac) return false;
  const digest = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
  // Timing-safe comparison
  const a = Buffer.from(digest);
  const b = Buffer.from(headerHmac);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function findDealByContactEmail(email: string): Promise<string | null> {
  if (!isHubSpotConfigured()) return null;
  // 1. Find the contact
  const contactSearch = await hsRequest<{ results: { id: string }[] }>(
    "POST",
    "/crm/v3/objects/contacts/search",
    {
      limit: 1,
      filterGroups: [
        {
          filters: [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }],
        },
      ],
      properties: ["email"],
    },
  );
  const contactId = contactSearch?.results?.[0]?.id;
  if (!contactId) return null;

  // 2. Find the associated deal on the B2B Wholesale pipeline with
  //    payment_method=pay_now, most recently created. In practice there
  //    should only be one open deal per contact, but we filter defensively.
  const assoc = await hsRequest<{ results?: { toObjectId: string }[] }>(
    "GET",
    `/crm/v4/objects/contacts/${contactId}/associations/deals`,
  );
  const dealIds = assoc?.results?.map((r) => r.toObjectId) ?? [];
  if (!dealIds.length) return null;

  // 3. Pull deal properties to find the one that matches
  for (const dealId of dealIds) {
    const deal = await hsRequest<{
      id: string;
      properties?: Record<string, string>;
    }>(
      "GET",
      `/crm/v3/objects/deals/${dealId}?properties=pipeline,dealstage,wholesale_payment_method,wholesale_payment_received`,
    );
    if (!deal?.properties) continue;
    if (
      deal.properties.pipeline === HUBSPOT.PIPELINE_B2B_WHOLESALE &&
      deal.properties.wholesale_payment_method === "pay_now" &&
      deal.properties.wholesale_payment_received !== "true"
    ) {
      return deal.id;
    }
  }
  return null;
}

async function flipPaymentGate(dealId: string): Promise<boolean> {
  const res = await hsRequest("PATCH", `/crm/v3/objects/deals/${dealId}`, {
    properties: {
      wholesale_payment_received: "true",
    },
  });
  return !!res;
}

async function maybeAdvanceToShipped(dealId: string): Promise<boolean> {
  const deal = await hsRequest<{
    properties?: Record<string, string>;
  }>(
    "GET",
    `/crm/v3/objects/deals/${dealId}?properties=wholesale_onboarding_complete,wholesale_payment_received,dealstage`,
  );
  const onboardingGreen = deal?.properties?.wholesale_onboarding_complete === "true";
  const paymentGreen = deal?.properties?.wholesale_payment_received === "true";
  if (!onboardingGreen || !paymentGreen) return false;
  const res = await hsRequest("PATCH", `/crm/v3/objects/deals/${dealId}`, {
    properties: {
      dealstage: HUBSPOT.STAGE_SHIPPED,
    },
  });
  return !!res;
}

async function slackPing(text: string): Promise<void> {
  const url = process.env.SLACK_SUPPORT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // non-fatal
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyHmac(rawBody, hmacHeader)) {
    console.error("[shopify-webhook] HMAC verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = order.email || order.customer?.email || "";
  const total = order.total_price || "0";
  const orderName = order.name || "(unnamed order)";
  if (!email) {
    console.warn(`[shopify-webhook] orders/paid with no email: ${orderName}`);
    return NextResponse.json({ ok: true, noted: "no_email" });
  }

  // Only handle orders tagged with "wholesale" + "booth" + "pay_now".
  // Retail Shopify orders are handled by a different pipeline.
  const tagsRaw = order.tags || "";
  const tags = tagsRaw.split(",").map((t) => t.trim().toLowerCase());
  if (!tags.includes("booth") || !tags.includes("pay_now")) {
    return NextResponse.json({ ok: true, noted: "not_booth_pay_now" });
  }

  const dealId = await findDealByContactEmail(email);
  if (!dealId) {
    await slackPing(
      `⚠️ *Shopify orders/paid*: ${orderName} for ${email} ($${total}) — could not find matching HubSpot deal. Manual reconciliation needed.`,
    );
    return NextResponse.json({ ok: true, noted: "no_matching_deal" });
  }

  const paid = await flipPaymentGate(dealId);
  if (!paid) {
    await slackPing(
      `⚠️ *Shopify orders/paid*: ${orderName} for ${email} — failed to flip payment gate on HubSpot deal ${dealId}`,
    );
    return NextResponse.json({ ok: true, noted: "flip_failed" });
  }

  await createNote({
    body: `<p><b>💳 Payment received via Shop Pay</b></p><p>Order: <b>${orderName}</b><br/>Amount: <b>$${total}</b><br/>Customer: ${email}</p><p style="color:#2e7d32"><b>Payment gate: GREEN ✅</b></p>`,
    dealId,
  });

  const advanced = await maybeAdvanceToShipped(dealId);

  await slackPing(
    [
      `💰 *BOOTH ORDER PAID — $${total}*`,
      `Shopify order: ${orderName}`,
      `Customer: ${email}`,
      `HubSpot deal: ${dealId}`,
      advanced
        ? `*Both gates GREEN ✅* — deal advanced to Shipped. Drew pack prep next.`
        : `*Payment gate GREEN.* Waiting on onboarding gate before advancing to Shipped.`,
    ].join("\n"),
  );

  return NextResponse.json({
    ok: true,
    dealId,
    paymentGate: "green",
    advancedToShipped: advanced,
  });
}
