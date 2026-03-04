/**
 * Loyalty Points Engine — USA Gummies Rewards Program
 *
 * Points system:
 *   - 1 point per $1 spent (rounded down)
 *   - 50 bonus points for referrals (when friend places order)
 *
 * Redemption tiers:
 *   - 100 points → 1 free bag
 *   - 250 points → 3-pack (3 free bags)
 *
 * Storage: Vercel KV
 *   - loyalty:{email} → LoyaltyAccount
 *   - loyalty:index   → string[] (all enrolled emails)
 */

import { kv } from "@vercel/kv";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const POINTS_PER_DOLLAR = 1;
export const REFERRAL_BONUS = 50;

export const REDEMPTION_TIERS = [
  { points: 100, reward: "1 free bag", bags: 1 },
  { points: 250, reward: "3-pack", bags: 3 },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoyaltyTransaction {
  id: string;
  type: "earn" | "redeem" | "bonus";
  points: number; // positive for earn/bonus, negative for redeem
  source: string; // e.g. "order:12345", "referral:friend@email.com", "redeem:tier-100"
  description: string;
  createdAt: string;
}

export interface LoyaltyAccount {
  email: string;
  name: string;
  totalEarned: number;
  totalRedeemed: number;
  balance: number;
  referralCode: string;
  transactions: LoyaltyTransaction[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

function loyaltyKey(email: string) {
  return `loyalty:${email.toLowerCase().trim()}`;
}

function generateReferralCode(email: string): string {
  // Simple deterministic code from email prefix + random suffix
  const prefix = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map((b) => b.toString(36))
    .join("")
    .toUpperCase()
    .slice(0, 4);
  return `${prefix}${suffix}`;
}

function generateTxId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/** Get loyalty account for an email, or null if not enrolled */
export async function getAccount(email: string): Promise<LoyaltyAccount | null> {
  return kv.get<LoyaltyAccount>(loyaltyKey(email));
}

/** Enroll a new loyalty member */
export async function enrollMember(email: string, name: string): Promise<LoyaltyAccount> {
  const existing = await getAccount(email);
  if (existing) return existing;

  const now = new Date().toISOString();
  const account: LoyaltyAccount = {
    email: email.toLowerCase().trim(),
    name,
    totalEarned: 0,
    totalRedeemed: 0,
    balance: 0,
    referralCode: generateReferralCode(email),
    transactions: [],
    createdAt: now,
    updatedAt: now,
  };

  await kv.set(loyaltyKey(email), account);

  // Add to index
  const index = (await kv.get<string[]>("loyalty:index")) || [];
  const normalEmail = email.toLowerCase().trim();
  if (!index.includes(normalEmail)) {
    index.push(normalEmail);
    await kv.set("loyalty:index", index);
  }

  return account;
}

/** Award points to a member (auto-enrolls if needed) */
export async function addPoints(
  email: string,
  points: number,
  source: string,
  description: string,
  name?: string,
): Promise<LoyaltyAccount> {
  let account = await getAccount(email);
  if (!account) {
    account = await enrollMember(email, name || email.split("@")[0]);
  }

  const tx: LoyaltyTransaction = {
    id: generateTxId(),
    type: source.startsWith("referral") ? "bonus" : "earn",
    points,
    source,
    description,
    createdAt: new Date().toISOString(),
  };

  account.totalEarned += points;
  account.balance += points;
  account.transactions.push(tx);
  account.updatedAt = new Date().toISOString();

  // Keep last 100 transactions to prevent KV bloat
  if (account.transactions.length > 100) {
    account.transactions = account.transactions.slice(-100);
  }

  await kv.set(loyaltyKey(email), account);
  return account;
}

/** Calculate points from an order total */
export function pointsFromOrder(orderTotal: number): number {
  return Math.floor(orderTotal * POINTS_PER_DOLLAR);
}

/** Get available redemption tiers for a given balance */
export function availableRedemptions(balance: number) {
  return REDEMPTION_TIERS.filter((tier) => balance >= tier.points);
}

/** Get next tier progress */
export function nextTierProgress(balance: number) {
  const nextTier = REDEMPTION_TIERS.find((tier) => balance < tier.points);
  if (!nextTier) return null;
  return {
    tier: nextTier,
    pointsNeeded: nextTier.points - balance,
    progress: balance / nextTier.points,
  };
}

/** Redeem points for a reward */
export async function redeemPoints(
  email: string,
  tierPoints: number,
): Promise<{ ok: boolean; account?: LoyaltyAccount; error?: string }> {
  const account = await getAccount(email);
  if (!account) {
    return { ok: false, error: "Account not found." };
  }

  const tier = REDEMPTION_TIERS.find((t) => t.points === tierPoints);
  if (!tier) {
    return { ok: false, error: "Invalid redemption tier." };
  }

  if (account.balance < tier.points) {
    return {
      ok: false,
      error: `Not enough points. You need ${tier.points - account.balance} more points.`,
    };
  }

  const tx: LoyaltyTransaction = {
    id: generateTxId(),
    type: "redeem",
    points: -tier.points,
    source: `redeem:tier-${tier.points}`,
    description: `Redeemed ${tier.points} points for ${tier.reward}`,
    createdAt: new Date().toISOString(),
  };

  account.totalRedeemed += tier.points;
  account.balance -= tier.points;
  account.transactions.push(tx);
  account.updatedAt = new Date().toISOString();

  if (account.transactions.length > 100) {
    account.transactions = account.transactions.slice(-100);
  }

  await kv.set(loyaltyKey(email), account);
  return { ok: true, account };
}

/** Look up account by referral code */
export async function findByReferralCode(code: string): Promise<LoyaltyAccount | null> {
  const index = (await kv.get<string[]>("loyalty:index")) || [];
  for (const email of index) {
    const account = await kv.get<LoyaltyAccount>(loyaltyKey(email));
    if (account && account.referralCode === code) {
      return account;
    }
  }
  return null;
}

/** Award referral bonus to the referrer */
export async function awardReferralBonus(
  referrerEmail: string,
  friendEmail: string,
): Promise<LoyaltyAccount> {
  return addPoints(
    referrerEmail,
    REFERRAL_BONUS,
    `referral:${friendEmail}`,
    `Referral bonus — ${friendEmail} placed an order`,
  );
}
