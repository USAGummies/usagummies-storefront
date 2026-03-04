# Shopify Integration: Subscriptions & Loyalty — Research & Implementation

**Date:** March 4, 2026
**Status:** Implementation in progress

---

## Problem Statement

Both the subscription and loyalty systems are front-end complete but disconnected from Shopify:

- **Subscriptions** (`/subscribe`): Collects email, name, qty, frequency → stores in Vercel KV + sends email. No Shopify cart, no payment, no recurring billing.
- **Loyalty** (`/rewards`): Tracks points in KV, webhook handler exists but not registered. Redemptions send email with no actual Shopify discount code.

---

## Research Findings

### Shopify Selling Plans (Native Subscriptions)
- Admin API `sellingPlanGroupCreate` creates selling plan groups with billing/delivery/pricing policies
- Storefront API exposes selling plans via `sellingPlanGroups` on products
- Cart API `cartLinesAdd` accepts `sellingPlanId` in `CartLineInput`
- **BLOCKER: Custom apps from Shopify admin cannot use selling plans** — requires Partner Dashboard app with protected scopes
- Ideal long-term solution but requires app migration

### Shopify Discount Codes (Loyalty Rewards)
- Admin API `discountCodeBasicCreate` creates percentage-off or fixed-amount codes
- Requires `write_discounts` scope
- Storefront API `cartDiscountCodesUpdate` applies codes to carts
- **FEASIBLE with current custom app**

### Shopify Webhooks
- Admin API `webhookSubscriptionCreate` registers endpoints
- `ORDERS_PAID` topic for loyalty point awarding
- Handler already exists at `/api/loyalty/webhook`

---

## Implementation Plan

### Phase 1: Subscriptions → Real Shopify Checkout
**Strategy: Cart + Automatic Discount Code**

1. Customer fills out subscribe form (qty, frequency, email)
2. Backend creates unique Shopify discount code for subscription savings ($0.50/bag)
3. Backend creates Shopify cart via Storefront API with qty single-bag variants
4. Backend applies discount code to cart via `cartDiscountCodesUpdate`
5. Customer redirected to Shopify checkout
6. Subscription record saved to KV for recurring management
7. Recurring: scheduled job creates new cart + discount code, emails checkout link

### Phase 2: Loyalty → Real Shopify Discount Codes
1. Register `orders/paid` webhook via Admin API
2. On redemption: create unique discount code via `discountCodeBasicCreate`
3. Return code to customer + email it
4. Code usable at Shopify checkout

### Phase 3: Webhook Registration
1. Script to register `ORDERS_PAID` webhook
2. Set `SHOPIFY_WEBHOOK_SECRET` env var
3. Verify delivery in Shopify admin

### Phase 4: Selling Plans (Future — requires Partner app)
1. Create app in Partner Dashboard
2. Request protected scopes
3. Create selling plan groups
4. Associate with product
5. Update cart to use `sellingPlanId`

---

## Key Technical Details
- **Variant ID:** `gid://shopify/ProductVariant/62295921099123`
- **Base price:** $5.99/bag
- **Subscription discount:** $0.50/bag below bundle price
- **Subscription quantities:** 5, 8, 12 bags
- **Frequencies:** Monthly (30d), Every 6 Weeks (42d), Bi-Monthly (60d)
- **Loyalty tiers:** 100pts → 1 free bag ($5.99), 250pts → 3-pack ($17.97)
- **Referral bonus:** 50 points
- **Admin API version:** 2024-10
- **Storefront API version:** 2025-01
- **Webhook endpoint:** `https://www.usagummies.com/api/loyalty/webhook`
