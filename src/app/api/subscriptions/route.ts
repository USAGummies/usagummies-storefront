import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_MIN_QTY,
  subscriptionPricingForQty,
  totalForQty,
} from "@/lib/bundles/pricing";
import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";
import {
  createDiscountCode,
  generateSubscriptionDiscountCode,
} from "@/lib/shopify/admin";

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function kvKey(email: string) {
  return `sub:${email.toLowerCase().trim()}`;
}

function generateToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isValidFrequency(label: string): boolean {
  return SUBSCRIPTION_FREQUENCIES.some((f) => f.label === label);
}

function getFrequencyDays(label: string): number {
  const freq = SUBSCRIPTION_FREQUENCIES.find((f) => f.label === label);
  return freq?.days ?? 30;
}

// ---------------------------------------------------------------------------
// Shopify Storefront API — create cart with discount
// ---------------------------------------------------------------------------

const STOREFRONT_API_VERSION = "2025-01";

function getStorefrontEndpoint() {
  return (
    process.env.SHOPIFY_STOREFRONT_API_ENDPOINT ||
    `https://usa-gummies.myshopify.com/api/${STOREFRONT_API_VERSION}/graphql.json`
  );
}

function getStorefrontToken() {
  return (
    process.env.SHOPIFY_STOREFRONT_API_TOKEN ||
    process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN ||
    ""
  );
}

const CART_CREATE_WITH_LINES = /* GraphQL */ `
  mutation CartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CART_DISCOUNT_APPLY = /* GraphQL */ `
  mutation CartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]!) {
    cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
      cart {
        id
        checkoutUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function storefrontRequest<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  const endpoint = getStorefrontEndpoint();
  const token = getStorefrontToken();
  if (!token) return null;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    const json = await res.json();
    return json?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a Shopify cart with the subscription items + discount code applied.
 * Returns the checkout URL that the customer will be redirected to.
 */
async function createSubscriptionCart(
  quantity: number,
  discountCode: string,
): Promise<{ checkoutUrl: string | null; error?: string }> {
  // Step 1: Create cart with line items
  const cartData = await storefrontRequest<{
    cartCreate: {
      cart: { id: string; checkoutUrl: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(CART_CREATE_WITH_LINES, {
    lines: [{ merchandiseId: SINGLE_BAG_VARIANT_ID, quantity }],
  });

  const cart = cartData?.cartCreate?.cart;
  if (!cart?.id) {
    const errs = cartData?.cartCreate?.userErrors?.map((e) => e.message).join("; ");
    return { checkoutUrl: null, error: errs || "Cart creation failed" };
  }

  // Step 2: Apply discount code to the cart
  const discountData = await storefrontRequest<{
    cartDiscountCodesUpdate: {
      cart: { id: string; checkoutUrl: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(CART_DISCOUNT_APPLY, {
    cartId: cart.id,
    discountCodes: [discountCode],
  });

  const updatedCart = discountData?.cartDiscountCodesUpdate?.cart;
  const checkoutUrl = updatedCart?.checkoutUrl || cart.checkoutUrl;

  return { checkoutUrl };
}

// ---------------------------------------------------------------------------
// POST — create subscription → Shopify checkout
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const quantity = Number(body.quantity) || 0;
  const frequency = String(body.frequency || "");

  // Validation
  if (!email || !email.includes("@")) {
    return json({ ok: false, error: "Valid email is required." }, 400);
  }
  if (!name) {
    return json({ ok: false, error: "Name is required." }, 400);
  }
  if (quantity < SUBSCRIPTION_MIN_QTY) {
    return json(
      { ok: false, error: `Minimum subscription quantity is ${SUBSCRIPTION_MIN_QTY} bags.` },
      400,
    );
  }
  if (!isValidFrequency(frequency)) {
    return json({ ok: false, error: "Invalid frequency." }, 400);
  }

  // Check for existing active subscription
  const existing = await kv.get<Record<string, unknown>>(kvKey(email));
  if (existing && (existing as any).status === "active") {
    return json({
      ok: false,
      error: "You already have an active subscription. Visit your subscription dashboard to make changes.",
    }, 409);
  }

  const pricing = subscriptionPricingForQty(quantity);
  const bundleTotal = totalForQty(quantity);
  const frequencyDays = getFrequencyDays(frequency);
  const now = new Date();
  const nextDelivery = addDays(now, frequencyDays);
  const token = generateToken();

  // --- Create Shopify discount code for subscription savings ---
  const discountCodeStr = generateSubscriptionDiscountCode(email);
  const savingsAmount = bundleTotal - pricing.total; // dollar amount to discount

  let shopifyDiscountCode = "";
  let checkoutUrl: string | null = null;

  if (savingsAmount > 0) {
    // Set expiry 24h from now — single-use, short-lived
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const discountResult = await createDiscountCode({
      title: `Subscription: ${quantity} bags ${frequency} — ${email}`,
      code: discountCodeStr,
      amountOff: savingsAmount,
      usageLimit: 1,
      appliesOncePerCustomer: true,
      endsAt: expiresAt,
    });

    if (discountResult.ok && discountResult.code) {
      shopifyDiscountCode = discountResult.code;
      console.info(`[subscriptions] Created discount code: ${shopifyDiscountCode} ($${savingsAmount.toFixed(2)} off)`);
    } else {
      console.warn("[subscriptions] Discount creation failed:", discountResult.error);
      // Continue without discount — customer still gets a real checkout
    }
  }

  // --- Create Shopify cart and apply discount ---
  const cartResult = await createSubscriptionCart(
    quantity,
    shopifyDiscountCode,
  );
  checkoutUrl = cartResult.checkoutUrl;

  if (!checkoutUrl) {
    // Fallback: create a cart permalink
    const numericVariantId = SINGLE_BAG_VARIANT_ID.split("/").pop();
    checkoutUrl = `https://usa-gummies.myshopify.com/cart/${numericVariantId}:${quantity}`;
    if (shopifyDiscountCode) {
      checkoutUrl += `?discount=${shopifyDiscountCode}`;
    }
    console.warn("[subscriptions] Cart creation failed, using permalink fallback");
  }

  // --- Save subscription to KV ---
  const subscription = {
    email,
    name,
    quantity,
    frequency,
    frequencyDays,
    perBag: pricing.perBag,
    total: pricing.total,
    savings: pricing.savings,
    status: "active" as const,
    token,
    discountCode: shopifyDiscountCode,
    createdAt: now.toISOString(),
    nextDeliveryDate: nextDelivery.toISOString(),
    pausedAt: null,
    cancelledAt: null,
  };

  await kv.set(kvKey(email), subscription);

  // Add to subscription index
  const index = (await kv.get<string[]>("sub:index")) || [];
  if (!index.includes(email)) {
    index.push(email);
    await kv.set("sub:index", index);
  }

  // Send confirmation email (fire-and-forget)
  sendConfirmationEmail({ ...subscription, checkoutUrl }).catch((err) => {
    console.error("[subscriptions] Email send failed:", err);
  });

  // Log to leads webhook
  const webhookUrl = process.env.LEADS_WEBHOOK_URL;
  if (webhookUrl) {
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        source: "subscription-signup",
        intent: "subscription",
        timestamp: now.toISOString(),
        metadata: { quantity, frequency, total: pricing.total },
      }),
    }).catch(() => {});
  }

  console.info("[subscriptions] New subscription:", email, quantity, frequency, "→ checkout");

  return json({
    ok: true,
    checkoutUrl,
    subscriptionId: kvKey(email),
    nextDeliveryDate: nextDelivery.toISOString(),
    total: pricing.total,
    discountCode: shopifyDiscountCode || undefined,
  });
}

// ---------------------------------------------------------------------------
// Confirmation email
// ---------------------------------------------------------------------------
async function sendConfirmationEmail(sub: {
  email: string;
  name: string;
  quantity: number;
  frequency: string;
  total: number;
  perBag: number;
  savings: number;
  nextDeliveryDate: string;
  token: string;
  checkoutUrl: string;
}) {
  try {
    const { sendOpsEmail } = await import("@/lib/ops/email");
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
    const manageUrl = `${siteUrl}/subscribe/manage?email=${encodeURIComponent(sub.email)}&token=${sub.token}`;
    const nextDate = new Date(sub.nextDeliveryDate).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    await sendOpsEmail({
      to: sub.email,
      subject: "Your USA Gummies Subscription — Complete Your First Order!",
      body: [
        `Hey ${sub.name},`,
        "",
        "Your subscription is set up! Complete your first order here:",
        "",
        `  → ${sub.checkoutUrl}`,
        "",
        "Your subscription details:",
        "",
        `  Quantity: ${sub.quantity} bags`,
        `  Price: $${sub.perBag.toFixed(2)}/bag ($${sub.total.toFixed(2)} total)`,
        `  Frequency: ${sub.frequency}`,
        `  Next Delivery: ${nextDate}`,
        `  You save: $${sub.savings.toFixed(2)} per delivery vs bundles`,
        "",
        "We'll email you a checkout link before each delivery.",
        "You're only charged when you check out.",
        "",
        `Manage your subscription: ${manageUrl}`,
        "",
        "Cancel or pause anytime. Free shipping on every delivery.",
        "",
        "— USA Gummies Team",
      ].join("\n"),
      allowRepeat: true,
    });
  } catch (err) {
    console.warn("[subscriptions] Could not send confirmation email:", err);
  }
}
