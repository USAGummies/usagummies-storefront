import { NextResponse, NextRequest } from "next/server";
import {
  DISCOUNT_CODES,
  PRIZE_TIERS,
  selectRandomPrize,
  type PrizeTier,
  type RedemptionRecord,
  type DiscountCode,
} from "@/data/review-reward-codes";

/**
 * /api/review-reward — Review reward spin wheel API.
 *
 * POST: Accepts { email, prize_tier? }
 *   - Checks rate limiting (1 reward per email per 30 days)
 *   - Selects a random prize if none specified
 *   - Returns an unused discount code for that prize tier
 *
 * GET: Returns stats about code inventory and redemptions
 */

// ── In-memory state (persists across requests in the same server instance) ──

interface RewardStore {
  redemptions: RedemptionRecord[];
  codes: DiscountCode[];
  initialized: boolean;
}

function getStore(): RewardStore {
  const g = globalThis as unknown as { __reviewRewardStore?: RewardStore };
  if (!g.__reviewRewardStore) {
    g.__reviewRewardStore = {
      redemptions: [],
      codes: JSON.parse(JSON.stringify(DISCOUNT_CODES)),
      initialized: true,
    };
  }
  return g.__reviewRewardStore;
}

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

const RATE_LIMIT_DAYS = 30;

function isRateLimited(email: string): boolean {
  const store = getStore();
  const normalizedEmail = email.toLowerCase().trim();
  const cutoff = Date.now() - RATE_LIMIT_DAYS * 24 * 60 * 60 * 1000;

  return store.redemptions.some(
    (r) =>
      r.email === normalizedEmail &&
      new Date(r.redeemed_at).getTime() > cutoff
  );
}

function getExistingRedemption(email: string): RedemptionRecord | undefined {
  const store = getStore();
  const normalizedEmail = email.toLowerCase().trim();
  const cutoff = Date.now() - RATE_LIMIT_DAYS * 24 * 60 * 60 * 1000;

  return store.redemptions.find(
    (r) =>
      r.email === normalizedEmail &&
      new Date(r.redeemed_at).getTime() > cutoff
  );
}

function claimCode(
  email: string,
  prizeTier: PrizeTier
): { code: DiscountCode; isExisting: boolean } | null {
  const store = getStore();
  const normalizedEmail = email.toLowerCase().trim();

  // Check if already redeemed
  const existing = getExistingRedemption(normalizedEmail);
  if (existing) {
    const existingCode = store.codes.find(
      (c) => c.code === existing.code
    );
    if (existingCode) {
      return { code: existingCode, isExisting: true };
    }
  }

  // Find an unused code for this tier
  const availableCode = store.codes.find(
    (c) => c.prize_tier === prizeTier && !c.used
  );

  if (!availableCode) {
    // Fallback: try any tier
    const fallbackCode = store.codes.find((c) => !c.used);
    if (!fallbackCode) return null;

    fallbackCode.used = true;
    fallbackCode.used_by = normalizedEmail;
    fallbackCode.used_at = new Date().toISOString();

    store.redemptions.push({
      email: normalizedEmail,
      prize_tier: fallbackCode.prize_tier,
      code: fallbackCode.code,
      redeemed_at: new Date().toISOString(),
    });

    return { code: fallbackCode, isExisting: false };
  }

  availableCode.used = true;
  availableCode.used_by = normalizedEmail;
  availableCode.used_at = new Date().toISOString();

  store.redemptions.push({
    email: normalizedEmail,
    prize_tier: prizeTier,
    code: availableCode.code,
    redeemed_at: new Date().toISOString(),
  });

  return { code: availableCode, isExisting: false };
}

// ── GET: Stats endpoint ──

export async function GET() {
  const store = getStore();

  const tiers = Object.keys(PRIZE_TIERS) as PrizeTier[];
  const inventory: Record<string, { total: number; used: number; remaining: number }> = {};

  for (const tier of tiers) {
    const tierCodes = store.codes.filter((c) => c.prize_tier === tier);
    inventory[tier] = {
      total: tierCodes.length,
      used: tierCodes.filter((c) => c.used).length,
      remaining: tierCodes.filter((c) => !c.used).length,
    };
  }

  return json({
    ok: true,
    total_codes: store.codes.length,
    total_used: store.codes.filter((c) => c.used).length,
    total_remaining: store.codes.filter((c) => !c.used).length,
    total_redemptions: store.redemptions.length,
    inventory,
    recent_redemptions: store.redemptions.slice(-20).reverse(),
  });
}

// ── POST: Claim a reward ──

export async function POST(req: NextRequest) {
  let body: { email?: string; prize_tier?: PrizeTier };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid request body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !email.includes("@")) {
    return json({ ok: false, error: "Valid email is required" }, 400);
  }

  // Rate limiting check
  if (isRateLimited(email)) {
    const existing = getExistingRedemption(email);
    if (existing) {
      const existingCode = getStore().codes.find(
        (c) => c.code === existing.code
      );
      if (existingCode) {
        return json({
          ok: true,
          already_claimed: true,
          code: existingCode.code,
          prize_tier: existingCode.prize_tier,
          prize_description: existingCode.prize_description,
          discount_type: existingCode.discount_type,
          discount_value: existingCode.discount_value,
          message: "You already claimed a reward recently! Here's your code.",
        });
      }
    }
    return json(
      { ok: false, error: "You've already claimed a reward recently. Check back in 30 days!" },
      429
    );
  }

  // Select prize
  const prizeTier = body.prize_tier || selectRandomPrize();

  // Validate prize tier
  if (!PRIZE_TIERS[prizeTier]) {
    return json({ ok: false, error: "Invalid prize tier" }, 400);
  }

  // Claim code
  const result = claimCode(email, prizeTier);

  if (!result) {
    return json(
      { ok: false, error: "No codes available. Please try again later." },
      503
    );
  }

  const { code, isExisting } = result;

  return json({
    ok: true,
    already_claimed: isExisting,
    code: code.code,
    prize_tier: code.prize_tier,
    prize_description: code.prize_description,
    discount_type: code.discount_type,
    discount_value: code.discount_value,
    message: isExisting
      ? "Here's your previously claimed code!"
      : "Congratulations! Here's your reward!",
  });
}
