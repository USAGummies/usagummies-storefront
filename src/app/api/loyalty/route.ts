// /api/loyalty — loyalty account lookup + enroll/redeem.
//
// STATUS (2026-04-29): The customer-facing /rewards page is currently
// 302-redirected to /shop in next.config.ts (line 100), so this endpoint
// has no in-app callers. It is RETAINED because (a) loyalty webhook
// (./webhook/route.ts) still awards points on Shopify orders/paid events
// and references the same KV-backed loyalty store, and (b) redemption
// emails sent from prior enrollments may still link back here. If/when
// loyalty is fully retired, delete the entire /api/loyalty/ tree along
// with src/lib/loyalty.ts and the Shopify webhook registration.
import { NextResponse } from "next/server";
import {
  getAccount,
  enrollMember,
  redeemPoints,
  availableRedemptions,
  nextTierProgress,
  REDEMPTION_TIERS,
} from "@/lib/loyalty";
import {
  createDiscountCode,
  generateLoyaltyDiscountCode,
} from "@/lib/shopify/admin";

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET — look up loyalty account
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email")?.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return json({ ok: false, error: "Valid email is required." }, 400);
  }

  const account = await getAccount(email);
  if (!account) {
    return json({ ok: false, error: "No loyalty account found for this email." }, 404);
  }

  return json({
    ok: true,
    email: account.email,
    name: account.name,
    balance: account.balance,
    totalEarned: account.totalEarned,
    totalRedeemed: account.totalRedeemed,
    referralCode: account.referralCode,
    availableRewards: availableRedemptions(account.balance),
    nextTier: nextTierProgress(account.balance),
    recentTransactions: account.transactions.slice(-10).reverse(),
    memberSince: account.createdAt,
  });
}

// ---------------------------------------------------------------------------
// POST — enroll or redeem
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid request body." }, 400);
  }

  const action = String(body.action || "");
  const email = String(body.email || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return json({ ok: false, error: "Valid email is required." }, 400);
  }

  // --- Enroll ---
  if (action === "enroll") {
    const name = String(body.name || "").trim();
    if (!name) {
      return json({ ok: false, error: "Name is required." }, 400);
    }

    const account = await enrollMember(email, name);
    return json({
      ok: true,
      enrolled: true,
      email: account.email,
      balance: account.balance,
      referralCode: account.referralCode,
      tiers: REDEMPTION_TIERS,
    });
  }

  // --- Redeem ---
  if (action === "redeem") {
    const tierPoints = Number(body.tier) || 0;
    if (!tierPoints) {
      return json({ ok: false, error: "Tier (points value) is required." }, 400);
    }

    const tier = REDEMPTION_TIERS.find((t) => t.points === tierPoints);
    if (!tier) {
      return json({ ok: false, error: "Invalid redemption tier." }, 400);
    }

    const result = await redeemPoints(email, tierPoints);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, 400);
    }

    // Create a REAL Shopify discount code for the reward
    const discountCodeStr = generateLoyaltyDiscountCode(email, tierPoints);
    // Reward value: tier.bags * $5.99 (base price per bag)
    const rewardDollarValue = tier.bags * 5.99;
    // Expires in 30 days
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    let shopifyCode = "";
    const discountResult = await createDiscountCode({
      title: `Loyalty Reward: ${tier.reward} — ${email}`,
      code: discountCodeStr,
      amountOff: rewardDollarValue,
      usageLimit: 1,
      appliesOncePerCustomer: true,
      endsAt: expiresAt,
    });

    if (discountResult.ok && discountResult.code) {
      shopifyCode = discountResult.code;
      console.info(`[loyalty] Created reward discount: ${shopifyCode} ($${rewardDollarValue.toFixed(2)} off) for ${email}`);
    } else {
      console.warn("[loyalty] Discount creation failed:", discountResult.error);
      // Points already deducted — we'll email them manually if this fails
    }

    // Send redemption email with the actual discount code
    sendRedemptionEmail({
      ...result.account!,
      discountCode: shopifyCode,
      reward: tier.reward,
      rewardValue: rewardDollarValue,
      expiresAt,
    }).catch((err) => {
      console.error("[loyalty] Redemption email failed:", err);
    });

    return json({
      ok: true,
      redeemed: true,
      pointsSpent: tierPoints,
      reward: tier.reward,
      discountCode: shopifyCode || undefined,
      newBalance: result.account!.balance,
    });
  }

  return json({ ok: false, error: "Invalid action. Use 'enroll' or 'redeem'." }, 400);
}

// ---------------------------------------------------------------------------
// Redemption email — now includes a real Shopify discount code
// ---------------------------------------------------------------------------
async function sendRedemptionEmail(account: {
  email: string;
  name: string;
  balance: number;
  discountCode: string;
  reward: string;
  rewardValue: number;
  expiresAt: string;
}) {
  try {
    const { sendOpsEmail } = await import("@/lib/ops/email");
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.usagummies.com";
    const shopUrl = `${siteUrl}/shop`;
    const expiryDate = new Date(account.expiresAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const bodyLines = [
      `Hey ${account.name},`,
      "",
      `Congrats! You've redeemed your reward: ${account.reward}!`,
      "",
    ];

    if (account.discountCode) {
      bodyLines.push(
        "Here's your discount code to use at checkout:",
        "",
        `  🎁  ${account.discountCode}`,
        "",
        `  Value: $${account.rewardValue.toFixed(2)} off your next order`,
        `  Expires: ${expiryDate}`,
        `  Single use — apply at checkout`,
        "",
        `Shop now: ${shopUrl}`,
      );
    } else {
      bodyLines.push(
        "We're processing your reward and will send your discount code shortly.",
        "If you don't receive it within 24 hours, reply to this email.",
      );
    }

    bodyLines.push(
      "",
      `Remaining balance: ${account.balance} points`,
      "",
      "Keep earning points with every purchase. 1 point per $1 spent.",
      "",
      "— USA Gummies Rewards Team",
    );

    await sendOpsEmail({
      to: account.email,
      subject: account.discountCode
        ? `Your USA Gummies Reward Code: ${account.discountCode}`
        : "Your USA Gummies Reward is Ready!",
      body: bodyLines.join("\n"),
      allowRepeat: true,
    });
  } catch (err) {
    console.warn("[loyalty] Could not send redemption email:", err);
  }
}
