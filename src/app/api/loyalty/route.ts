import { NextResponse } from "next/server";
import {
  getAccount,
  enrollMember,
  redeemPoints,
  availableRedemptions,
  nextTierProgress,
  REDEMPTION_TIERS,
} from "@/lib/loyalty";

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

    const result = await redeemPoints(email, tierPoints);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, 400);
    }

    // Send redemption email (fire-and-forget)
    sendRedemptionEmail(result.account!).catch((err) => {
      console.error("[loyalty] Redemption email failed:", err);
    });

    return json({
      ok: true,
      redeemed: true,
      pointsSpent: tierPoints,
      reward: REDEMPTION_TIERS.find((t) => t.points === tierPoints)?.reward,
      newBalance: result.account!.balance,
    });
  }

  return json({ ok: false, error: "Invalid action. Use 'enroll' or 'redeem'." }, 400);
}

// ---------------------------------------------------------------------------
// Redemption email
// ---------------------------------------------------------------------------
async function sendRedemptionEmail(account: {
  email: string;
  name: string;
  balance: number;
}) {
  try {
    const { sendOpsEmail } = await import("@/lib/ops/email");
    await sendOpsEmail({
      to: account.email,
      subject: "Your USA Gummies Reward is Ready!",
      body: [
        `Hey ${account.name},`,
        "",
        "Your reward has been redeemed! We'll add the free bag(s) to your next order.",
        "",
        `Remaining balance: ${account.balance} points`,
        "",
        "Keep earning points with every purchase. 1 point per $1 spent.",
        "",
        "— USA Gummies Rewards Team",
      ].join("\n"),
      allowRepeat: true,
    });
  } catch (err) {
    console.warn("[loyalty] Could not send redemption email:", err);
  }
}
