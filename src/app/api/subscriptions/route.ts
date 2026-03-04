import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_MIN_QTY,
  subscriptionPricingForQty,
} from "@/lib/bundles/pricing";

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

// Validate frequency label
function isValidFrequency(label: string): boolean {
  return SUBSCRIPTION_FREQUENCIES.some((f) => f.label === label);
}

function getFrequencyDays(label: string): number {
  const freq = SUBSCRIPTION_FREQUENCIES.find((f) => f.label === label);
  return freq?.days ?? 30;
}

// ---------------------------------------------------------------------------
// POST — create subscription
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
  const frequencyDays = getFrequencyDays(frequency);
  const now = new Date();
  const nextDelivery = addDays(now, frequencyDays);
  const token = generateToken();

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
    createdAt: now.toISOString(),
    nextDeliveryDate: nextDelivery.toISOString(),
    pausedAt: null,
    cancelledAt: null,
  };

  // Store in KV (no expiry — subscriptions persist)
  await kv.set(kvKey(email), subscription);

  // Also add to a subscription index for admin queries
  const index = (await kv.get<string[]>("sub:index")) || [];
  if (!index.includes(email)) {
    index.push(email);
    await kv.set("sub:index", index);
  }

  // Send confirmation email (fire-and-forget)
  sendConfirmationEmail(subscription).catch((err) => {
    console.error("[subscriptions] Email send failed:", err);
  });

  // Log to leads webhook too
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

  console.info("[subscriptions] New subscription:", email, quantity, frequency);

  return json({
    ok: true,
    subscriptionId: kvKey(email),
    nextDeliveryDate: nextDelivery.toISOString(),
    total: pricing.total,
  });
}

// ---------------------------------------------------------------------------
// Confirmation email via SMTP
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
      subject: "Your USA Gummies Subscription is Active!",
      body: [
        `Hey ${sub.name},`,
        "",
        "Your subscription is confirmed! Here's what you've set up:",
        "",
        `  Quantity: ${sub.quantity} bags`,
        `  Price: $${sub.perBag.toFixed(2)}/bag ($${sub.total.toFixed(2)} total)`,
        `  Frequency: ${sub.frequency}`,
        `  Next Delivery: ${nextDate}`,
        `  You save: $${sub.savings.toFixed(2)} per delivery vs bundles`,
        "",
        "Before each delivery, we'll send you a checkout link to complete your order.",
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
