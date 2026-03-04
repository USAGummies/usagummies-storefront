import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  addPoints,
  pointsFromOrder,
  findByReferralCode,
  awardReferralBonus,
} from "@/lib/loyalty";
import { kv } from "@vercel/kv";

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Shopify HMAC verification
// ---------------------------------------------------------------------------
function verifyShopifyWebhook(body: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}

// ---------------------------------------------------------------------------
// POST — Shopify orders/paid webhook
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");

  // Verify webhook signature (skip in dev if no secret configured)
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (secret && !verifyShopifyWebhook(rawBody, hmac)) {
    console.warn("[loyalty webhook] Invalid HMAC signature");
    return json({ ok: false, error: "Invalid signature" }, 401);
  }

  let order: Record<string, any>;
  try {
    order = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const orderId = String(order.id || "");
  const email = String(order.email || order.contact_email || "").trim().toLowerCase();
  const totalPrice = parseFloat(order.total_price || "0");
  const customerName =
    [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") ||
    email.split("@")[0];

  if (!email || !email.includes("@")) {
    console.warn("[loyalty webhook] No email on order", orderId);
    return json({ ok: true, skipped: true, reason: "no-email" });
  }

  if (totalPrice <= 0) {
    return json({ ok: true, skipped: true, reason: "zero-total" });
  }

  // Idempotency check — don't process same order twice
  const processedKey = `loyalty:order:${orderId}`;
  const alreadyProcessed = await kv.get(processedKey);
  if (alreadyProcessed) {
    return json({ ok: true, skipped: true, reason: "already-processed" });
  }

  // Award points
  const points = pointsFromOrder(totalPrice);
  if (points > 0) {
    await addPoints(
      email,
      points,
      `order:${orderId}`,
      `Earned ${points} points from order #${order.order_number || orderId}`,
      customerName,
    );
    console.info(`[loyalty webhook] Awarded ${points} points to ${email} for order ${orderId}`);
  }

  // Check for referral code in order note or tags
  const noteAttributes = order.note_attributes || [];
  const referralAttr = noteAttributes.find(
    (a: any) => a.name?.toLowerCase() === "referral" || a.name?.toLowerCase() === "referral_code",
  );
  const referralCode = referralAttr?.value || "";

  if (referralCode) {
    const referrer = await findByReferralCode(referralCode);
    if (referrer && referrer.email !== email) {
      await awardReferralBonus(referrer.email, email);
      console.info(`[loyalty webhook] Referral bonus to ${referrer.email} from ${email}`);
    }
  }

  // Mark order as processed (expire after 90 days to save KV space)
  await kv.set(processedKey, { email, points, at: new Date().toISOString() }, { ex: 90 * 86400 });

  return json({ ok: true, email, pointsAwarded: points });
}
