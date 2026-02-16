/**
 * Review Reward Discount Code Pool
 *
 * Pre-generated pool of discount codes for the review-reward spin wheel.
 * Each tier corresponds to a prize segment on the wheel.
 *
 * TO GENERATE MORE CODES:
 * 1. Create codes in Shopify Admin (Discounts > Create discount code)
 * 2. Add them to the appropriate tier array below
 * 3. Or connect to the Shopify Admin API to generate programmatically:
 *    POST /admin/api/2024-01/price_rules/{id}/discount_codes.json
 *
 * TO CONNECT TO SHOPIFY API (future enhancement):
 * - Use the Shopify Admin API to create discount codes on the fly
 * - Each prize tier maps to a Shopify Price Rule
 * - See: https://shopify.dev/docs/api/admin-rest/2024-01/resources/discount-code
 */

export type PrizeTier =
  | "free_shipping"
  | "2_off"
  | "3_off"
  | "free_bag"
  | "1_off"
  | "10_pct_off";

export interface DiscountCode {
  code: string;
  prize_tier: PrizeTier;
  prize_description: string;
  discount_type: "percentage" | "fixed_amount" | "free_shipping";
  discount_value: number; // percentage as whole number (10 = 10%), fixed as dollars
  used: boolean;
  used_by: string | null;
  used_at: string | null;
}

export interface RedemptionRecord {
  email: string;
  prize_tier: PrizeTier;
  code: string;
  redeemed_at: string;
}

/** Prize wheel segments with their weights (higher = more likely) */
export const PRIZE_TIERS: Record<
  PrizeTier,
  { label: string; description: string; weight: number; color: string }
> = {
  "1_off": {
    label: "$1 OFF",
    description: "$1 Off Next Order",
    weight: 30,
    color: "#1B2A4A",
  },
  "2_off": {
    label: "$2 OFF",
    description: "$2 Off Next Order",
    weight: 25,
    color: "#c7362c",
  },
  "10_pct_off": {
    label: "10% OFF",
    description: "10% Off Next Order",
    weight: 20,
    color: "#2D7A3A",
  },
  free_shipping: {
    label: "FREE SHIP",
    description: "Free Shipping on Next Order",
    weight: 12,
    color: "#c7a062",
  },
  "3_off": {
    label: "$3 OFF",
    description: "$3 Off Next Order",
    weight: 10,
    color: "#5f5b56",
  },
  free_bag: {
    label: "FREE BAG",
    description: "Free Bag on 5-Pack Purchase",
    weight: 3,
    color: "#8B0000",
  },
};

/**
 * Select a random prize tier based on weighted probabilities.
 */
export function selectRandomPrize(): PrizeTier {
  const entries = Object.entries(PRIZE_TIERS) as [
    PrizeTier,
    (typeof PRIZE_TIERS)[PrizeTier],
  ][];
  const totalWeight = entries.reduce((sum, [, tier]) => sum + tier.weight, 0);
  let random = Math.random() * totalWeight;

  for (const [key, tier] of entries) {
    random -= tier.weight;
    if (random <= 0) return key;
  }

  return "1_off"; // fallback
}

// Pre-generated discount codes organized by tier.
// In production, these should be real Shopify discount codes.
// For MVP, these are placeholder codes that need to be created in Shopify Admin.

function generateCodes(
  tier: PrizeTier,
  description: string,
  discountType: "percentage" | "fixed_amount" | "free_shipping",
  discountValue: number,
  count: number
): DiscountCode[] {
  const prefix = tier.toUpperCase().replace(/_/g, "");
  return Array.from({ length: count }, (_, i) => ({
    code: `USA${prefix}${String(i + 1).padStart(3, "0")}`,
    prize_tier: tier,
    prize_description: description,
    discount_type: discountType,
    discount_value: discountValue,
    used: false,
    used_by: null,
    used_at: null,
  }));
}

export const DISCOUNT_CODES: DiscountCode[] = [
  ...generateCodes("free_shipping", "Free Shipping on Next Order", "free_shipping", 0, 50),
  ...generateCodes("2_off", "$2 Off Next Order", "fixed_amount", 2, 50),
  ...generateCodes("3_off", "$3 Off Next Order", "fixed_amount", 3, 50),
  ...generateCodes("free_bag", "Free Bag on 5-Pack Purchase", "fixed_amount", 5, 50),
  ...generateCodes("1_off", "$1 Off Next Order", "fixed_amount", 1, 50),
  ...generateCodes("10_pct_off", "10% Off Next Order", "percentage", 10, 50),
];
