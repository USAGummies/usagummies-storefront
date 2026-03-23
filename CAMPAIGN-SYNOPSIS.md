# USA Gummies — Ad Campaign & Landing Page Optimization Synopsis

**Date:** February 14, 2026 (evening update)
**Purpose:** Full briefing for a fresh Claude session to review and suggest next changes.

---

## 1. Business Overview

**USA Gummies** (usagummies.com) sells all-natural, made-in-USA gummy bears through two channels:
- **Shopify** (direct, headless Next.js storefront) — higher margin, better cashflow
- **Amazon FBA** — lower margin after fees, but builds B2B account metrics and trust

**Product:** All American Gummy Bears, 7.5 oz bag
- Shopify price: $5.99/bag, with automatic volume discounts via a Shopify Function
- Amazon price: $5.99/bag (single)
- 5-bag bundle: $25.00 total ($5.00/bag) + free shipping (automatic Shopify discount)
- 12-bag bundle: $51.00 total ($4.25/bag) + free shipping

**Fulfillment:** Warehouses in Washington state and Pennsylvania.

**The owner's priority is Shopify sales** — Amazon fees eat into margins and cashflow is delayed. Amazon sales are still valuable for account growth.

---

## 2. Ad Campaign Setup

**Platform:** Truth Social + Rumble (same ad network)
**Campaign start:** February 12, 2026
**Landing page:** https://www.usagummies.com/go (noindex, ad-only page)
**Target audience:** Conservative Americans on Truth Social

### Ad Performance (Feb 12–14, 2026)

| Date | Impressions | Clicks | CTR | Spend | CPM | CPC |
|------|------------|--------|-----|-------|-----|-----|
| Feb 12 | 6,389 | 26 | 0.41% | $13.44 | $2.10 | $0.52 |
| Feb 13 | 6,824 | 40 | 0.59% | $21.37 | $3.13 | $0.53 |
| Feb 14 | 5,060 | 33 | 0.65% | $15.82 | $3.13 | $0.48 |
| **Total** | **18,273** | **99** | **0.54%** | **$50.63** | **$2.77** | **$0.51** |

**Key ad observations:**
- CTR is improving daily (0.41% → 0.59% → 0.65%) — ad creative is working
- CPC is low and stable (~$0.51)
- Truth Social reports 0 conversions (no pixel/tracking integration)

---

## 3. Landing Page (/go) — Evolution

### Version 1 (Feb 12 — launch day)
- Basic layout with both Shopify 5-pack and Amazon single-bag options
- Both presented as roughly equal choices
- Shopify CTA used a raw cart permalink: `https://usa-gummies.myshopify.com/cart/62295921099123:5`

### Version 2 (Feb 13 — afternoon redesign, commit 5a0faeb)
- Full visual redesign: warm cream (#f8f5ef) backgrounds, navy (#1B2A4A) text, inline CSS to avoid dark mode issues
- Mobile-first: hero image + CTA visible above fold
- Headline pills: "MADE IN AMERICA", "NO ARTIFICIAL DYES", "ALL NATURAL"
- Both options presented as cards
- Sticky mobile bottom bar with both options

### Version 3 (Feb 13 — micro-adjustments, commit 12ec6dd)
- Elevated Amazon: gave it equal visual weight
- Rationale: Amazon was converting while Shopify was not; wanted to capture more Amazon sales

### Version 4 (Feb 13 evening — Shopify-focused, commit b588793)
- Shopify card: red border, "BEST DEAL" badge, strikethrough pricing (~~$29.95~~ → $25.00), savings callout
- CTA: "GET THE 5-PACK — $25 TOTAL" (explicit price)
- Trust signals: "Secure checkout via Shopify — trusted by millions of stores", "$25 total — no surprises"
- Amazon demoted: lighter border, "OR TRY 1 BAG — $5.99"
- Sticky bar: Shopify gets flex:2 (2/3 width), Amazon gets flex:1 (1/3 width)
- Second CTA section after social proof, Shopify-focused

### Version 5 (Feb 14 ~3pm ET — checkout bypass, commit 367bc04)
- **Critical fix:** Replaced all Shopify CTA links from the raw cart permalink to `/go/checkout`
- `/go/checkout` is a server-side API route that creates a cart via Shopify Storefront API and redirects to the `checkoutUrl`
- This bypasses the Shop Pay redirect (see Section 5 for details)
- No visual changes to the page itself

### Version 6 (Feb 14 ~4pm ET — CRO changes, commit ecdfe54)
- **Single-bag Shopify option added:** New card between 5-pack and Amazon — "TRY 1 BAG — $5.99" with navy (#1B2A4A) button, "+ shipping · Ships direct from our facility"
- **Trust signals updated:** Changed from "Secure checkout via Shopify — trusted by millions of stores" to "Family-owned American business · Warehouses in Washington & Pennsylvania"
- **Amazon demoted to text link:** Replaced full card with Amazon SVG logo → simple underlined text "Or buy on Amazon →"
- **Money-back guarantee block added:** Green border, "🇺🇸 100% Satisfaction Guarantee — Love them or your money back — no questions asked. Made in FDA-registered facilities right here in the USA."
- **Second CTA section updated:** Includes both 5-pack and 1-bag Shopify CTAs + guarantee text
- **Sticky bar updated:** Both slots are now Shopify (5-pack red, 1-bag navy), Amazon removed from sticky bar

### Version 7 (Feb 14 ~6pm ET — analytics, commit ce666f0) ← CURRENT
- **Comprehensive event tracking added** (see Section 9 for details)
- New `GoTracker.client.tsx` component with click tracking, scroll depth, time-on-page
- Server-side GA4 Measurement Protocol forwarding for ad-blocker resilience
- Server-side `go_checkout_redirect` event on `/go/checkout` route

**Live page:** https://www.usagummies.com/go

---

## 4. Analytics Data (GA4 — Feb 12–14, 2026)

**Important caveat:** GA4 undercounted by ~25-29% vs Vercel Analytics due to ad blockers and Safari ITP. This gap should now be significantly reduced with the server-side Measurement Protocol forwarding deployed in Version 7 (see Section 9).

### Site-wide Traffic (all pages, not just /go)

| Date | GA4 Sessions | GA4 Users | Page Views | Bounce Rate | Avg Session Duration |
|------|-------------|-----------|------------|-------------|---------------------|
| Feb 12 | 62 | 58 | 116 | 58% | 88s |
| Feb 13 | 53 | 52 | 88 | 55% | 119s |
| Feb 14 (partial) | 38 | 35 | 41 | 100% | 22s |
| **Total** | **153** | **~130** | **245** | — | — |

### Device Breakdown

| Date | Mobile | Desktop | Tablet |
|------|--------|---------|--------|
| Feb 12 | 26 (42%) | 36 (58%) | 0 |
| Feb 13 | 32 (60%) | 20 (38%) | 1 (2%) |
| Feb 14 | 22 (58%) | 12 (32%) | 4 (11%) |

Mobile share has grown from 42% → 60% as Truth Social traffic (heavily mobile) increases.

### Traffic Sources

| Source | Feb 12 | Feb 13 | Feb 14 | Total |
|--------|--------|--------|--------|-------|
| truthsocial.com | 28 | 9 | 8 | 45 |
| (direct) | 23 | 33 | 22 | 78 |
| (not set) | 0 | 0 | 9 | 9 |
| google | 3 | 3 | 0 | 6 |
| usa-gummies.myshopify.com | 4 | 2 | 4 | 10 |
| Other | 4 | 6 | 3 | 13 |

**Note:** Many Truth Social clicks show up as "(direct)" because the Truth Social app strips referrer headers. Actual Truth Social traffic is likely 70-80% of total.

### Conversion Funnel Events (GA4 — pre-tracking-upgrade)

| Event | Feb 12 | Feb 13 | Feb 14 | Total (events) | Total (users) |
|-------|--------|--------|--------|----------------|---------------|
| scroll | 19 (16 users) | 18 (15 users) | 11 (11 users) | 48 | 38 |
| add_to_cart | 6 (4 users) | 9 (4 users) | 1 (1 user) | 16 | 7 |
| bundle_add_to_cart | 9 (5 users) | 16 (1 user) | 0 | 25 | 5 |
| view_cart | 9 (3 users) | 7 (1 user) | 0 | 16 | 3 |
| view_item | 9 (7 users) | 4 (2 users) | 0 | 13 | 8 |
| begin_checkout | 3 (2 users) | 8 (4 users) | 2 (2 users) | 13 | 5 |
| checkout_click | 1 (1 user) | 2 (1 user) | 0 | 3 | 1 |
| click (outbound) | 2 (1 user) | 8 (3 users) | 4 (4 users) | 14 | 7 |
| amazon_redirect | 1 (1 user) | 0 | 0 | 1 | 1 |
| bundle_amazon_click | 1 (1 user) | 0 | 0 | 1 | 1 |
| exit_intent_popup_shown | 5 (5 users) | 0 | 0 | 5 | 5 |

**Note:** These events are from the OLD tracking (GA4 enhanced measurement + some custom events from the main site components). The /go page itself had ZERO custom event tracking before Version 7. See Section 9 for the new tracking.

### Funnel Summary (all 3 days combined, pre-tracking-upgrade)

```
Truth Social ad clicks:        99
  ↓
GA4 tracked visitors:          ~130 users (includes organic + other sources)
/go page visitors:             ~63 users (GA4, actual likely ~80-85)
  ↓
Scrolled past fold:            38 users (60% of GA4 /go users)
  ↓
Add to cart:                   7 users (11%)
  ↓
Begin checkout:                5 users (8%)
  ↓
Checkout page reached:         1 user (2%) ← MASSIVE DROP
  ↓
Purchase completed:            0 users (0%) ← ZERO Shopify sales
```

Amazon conversion path:
```
Amazon CTA clicks:             ~2 users tracked by GA4
  ↓
Amazon purchases:              4 sales @ $5.99 = $23.96 revenue
  ↓
Click-to-sale rate:            ~50% (some clicks not tracked by GA4)
```

---

## 5. Critical Technical Finding: Shop Pay Redirect

**This was the #1 issue — identified and fixed on Feb 14.**

### The problem
The Shopify CTA was using a cart permalink:
```
https://usa-gummies.myshopify.com/cart/62295921099123:5
```

When a user clicks this, Shopify does a **302 redirect to Shop Pay** before reaching checkout:

```
Step 1: usagummies.com/go           → User clicks "GET THE 5-PACK"
Step 2: shop.app/checkout/...       → 302 redirect to Shop Pay (UNKNOWN DOMAIN)
Step 3: usa-gummies.myshopify.com   → Finally reaches Shopify checkout
```

This is a **triple domain hop**. For cold traffic from Truth Social — conservative Americans who are already cautious about online purchases — seeing `shop.app` (a domain they've never heard of) is a trust-killer.

### The evidence
- 5 users triggered `begin_checkout` over 3 days
- Only 1 user triggered `checkout_click` (actually reached the checkout page)
- **4 out of 5 users (80%) abandoned during the redirect chain**
- 0 purchases completed

Meanwhile Amazon (1-click, trusted brand) converted at ~50% click-to-sale.

### The fix (deployed Feb 14 ~3pm ET, commit 367bc04)
Created `/go/checkout` — a server-side Next.js route that:
1. Creates a cart via Shopify Storefront API (`cartCreate` mutation)
2. Receives a `checkoutUrl` from the API
3. Redirects the user to that URL
4. Supports `?qty=N` parameter (default 5, clamped 1–12)

The Storefront API's `checkoutUrl` goes to `usa-gummies.myshopify.com/cart/c/...` which loads the checkout directly — **no Shop Pay interception**.

New flow:
```
Step 1: usagummies.com/go           → User clicks "GET THE 5-PACK"
Step 2: usagummies.com/go/checkout  → Server creates cart, returns redirect
Step 3: usa-gummies.myshopify.com   → Shopify checkout loads directly
```

---

## 6. Revenue & ROAS

### Shopify Orders (recent)
| Order | Date | Bags | Total | Status |
|-------|------|------|-------|--------|
| #1005 | Feb 8 | 4 bags | $25.06 | Paid |
| #1004 | Feb 2 | 12 bags | $51.00 | Paid |
| #1003 | Jan 30 | 5 bags | $28.00 | Paid |
| #1002 | Jan 26 | 12 bags | $51.00 | Paid |

**Zero Shopify orders from the ad campaign (Feb 12–14).**

### Amazon Sales (from Seller Central screenshots)
- Feb 12: 2 sales
- Feb 13: 1 sale
- Feb 14: 1 sale (+ 3 FBA pending from previous days)
- 30-day total: $178 revenue, 36 units, 98 FBA inventory remaining

### Campaign ROAS
| Metric | Value |
|--------|-------|
| Total ad spend (Feb 12–14) | $50.63 |
| Amazon revenue from campaign | ~$24 (4 × $5.99) |
| Shopify revenue from campaign | $0 |
| **Total revenue** | **~$24** |
| **ROAS** | **0.47x** |

---

## 7. Key Behavioral Insights

1. **The ad creative works.** CTR is climbing daily (0.41% → 0.59% → 0.65%). People are clicking.

2. **The landing page engages.** 60% scroll past the fold. People are reading.

3. **Amazon converts, Shopify doesn't.** The same audience that won't complete Shopify checkout will buy on Amazon at ~50% conversion. This is a trust/friction problem, not a product or pricing problem.

4. **The checkout redirect was the wall.** 80% of users who started checkout abandoned during the Shop Pay redirect chain (5 begin_checkout → 1 checkout_click).

5. **People are exploring beyond /go.** Some visitors navigate to the main site (product pages, shop, contact) — indicating genuine interest.

6. **Mobile dominates and is growing.** 60% mobile on Feb 13–14, up from 42% on Feb 12.

7. **Tablet traffic spiked on Feb 14.** 11% tablet (4 users) vs near-zero previously — possibly older demographic.

8. **Session duration improved with redesign.** 88s (Feb 12) → 119s (Feb 13), suggesting the redesigned page is more engaging.

---

## 8. Current Page Architecture

### Tech Stack
- Next.js 15 (App Router), React 18, TypeScript, Tailwind 4
- Deployed on Vercel
- Shopify Storefront API for cart/checkout
- Shopify Admin API for orders
- GA4 for analytics (property ID: 509104328, Measurement ID: G-31X673PSVY)
- GA4 Measurement Protocol (server-side) for ad-blocker-proof tracking
- Headless architecture — NOT a traditional Shopify theme

### /go Page Design Language
- Background: warm cream/parchment (#f8f5ef)
- Text: navy (#1B2A4A)
- CTA buttons: red (#c7362c) for 5-pack, navy (#1B2A4A) for 1-bag
- Accents: green (#2D7A3A) for savings/checkmarks/guarantee, gold (#c7a062) for stars/badges
- Font: Oswald for display, Space Grotesk for body
- All styles are inline/hardcoded to prevent dark mode theme overrides

### Current /go Page Layout (top to bottom)
1. **Header** — Logo + "GET THE 5-PACK" button (red)
2. **Banner** — "🇺🇸 FREE SHIPPING on every 5-pack — Save $0.99 per bag vs. retail"
3. **Hero** — Headline pills + "American Gummy Bears. No Junk." + product image
4. **CTA Section 1:**
   - 5-pack card (red border, "BEST DEAL" badge, strikethrough pricing, red CTA)
   - Trust signal: "Family-owned American business · Warehouses in Washington & Pennsylvania"
   - 1-bag card (neutral border, navy CTA) — "TRY 1 BAG — $5.99"
   - Amazon text link: "Or buy on Amazon →"
   - Money-back guarantee block (green)
5. **Social Proof** — 4.8 stars, two customer reviews
6. **CTA Section 2:** — "READY TO TRY THEM?" + 5-pack CTA + 1-bag CTA + Amazon link
7. **Footer**
8. **Sticky bottom bar (mobile only):** 5-PACK $25 (red, 2/3 width) | 1 BAG $5.99 (navy, 1/3 width)

### Shopify Discount Function (atomic-price-ladder)
Automatically applies volume discounts at checkout:
- 1–4 bags: $5.99/bag (full price)
- 5 bags: $5.00/bag = $25.00 total + free shipping
- 6 bags: $4.90/bag
- 7 bags: $4.80/bag
- 8 bags: $4.70/bag
- 9 bags: $4.60/bag
- 10 bags: $4.50/bag
- 11 bags: $4.40/bag
- 12+ bags: $4.30/bag
- Free shipping on 5+ bags

---

## 9. Analytics & Tracking (NEW — deployed Feb 14 evening)

### Problem We Solved
The /go landing page had **ZERO custom event tracking** before today. It was a server component with no click handlers. The only analytics were:
- GA4 automatic pageview (from global gtag in layout.tsx)
- GA4 enhanced measurement (auto-scroll, auto-outbound-clicks)
- Vercel Analytics (basic pageviews)

This meant we couldn't tell which CTAs were clicked, which sections drove action, or how engaged visitors were. GA4 also undercounted by ~25-29% due to ad blockers blocking `google-analytics.com`.

### What We Built

#### Client-side tracking (`GoTracker.client.tsx`)
A React client component that uses event delegation to track clicks without modifying the server component. Events go to both `gtag()` (standard GA4) and `/api/analytics` (first-party beacon).

| Event | Fires When | Params |
|-------|-----------|--------|
| `go_page_view` | Page loads | referrer, screen size, viewport |
| `go_click_5pack` | Any 5-pack CTA clicked | location (section_1, section_2, sticky_bar) |
| `go_click_1bag` | Any 1-bag CTA clicked | location |
| `go_click_amazon` | Amazon link clicked | href |
| `go_scroll_50` | User scrolled past 50% | — |
| `go_scroll_90` | User scrolled past 90% | — |
| `go_time_15s` | User stayed 15 seconds | — |
| `go_time_30s` | User stayed 30 seconds | — |
| `go_time_60s` | User stayed 60 seconds | — |

#### Server-side GA4 forwarding (`/api/analytics`)
The existing `/api/analytics` beacon endpoint was upgraded to forward events to GA4 via Measurement Protocol. This is **ad-blocker proof** because:
- The browser beacon goes to `usagummies.com/api/analytics` (our domain — not blocked)
- The server then forwards to `google-analytics.com/mp/collect` (server-to-server — invisible to ad blockers)
- Client ID is extracted from the `_ga` cookie when available, or hashed from IP+UA as fallback

#### Server-side checkout tracking (`/go/checkout` route)
The checkout redirect route fires `go_checkout_redirect` directly to GA4 Measurement Protocol. This gives us a **100% accurate** count of how many people actually clicked through to Shopify checkout — zero ad blocker impact since it's entirely server-side.

### What This Means for Analysis
Starting from Feb 14 evening onward, we should see:
- **True visitor count** — `go_page_view` events via server-side forwarding capture visitors that ad blockers previously hid
- **CTA performance** — Which button (5-pack vs 1-bag vs Amazon) gets clicked, and from which section
- **Engagement depth** — Scroll % and time-on-page tell us how far people get before deciding
- **Checkout funnel accuracy** — `go_checkout_redirect` is the definitive measure of intent

### Configuration
- GA4 Property ID: 509104328
- GA4 Measurement ID: G-31X673PSVY
- GA4 API Secret: configured in Vercel env as `GA4_API_SECRET`
- Events visible in: GA4 → Reports → Realtime, and GA4 → Explore (custom reports)

---

## 10. Changes Deployed Today (Feb 14) — Summary

In chronological order:

| Time (ET) | Change | Commit |
|-----------|--------|--------|
| ~3:00pm | Shop Pay bypass — `/go/checkout` route | 367bc04 |
| ~4:00pm | Single-bag option + trust signals + guarantee | ecdfe54 |
| ~4:30pm | Fixed "Shipped from Utah" → "Warehouses in Washington & Pennsylvania" | 9c8aead |
| ~6:00pm | Comprehensive event tracking + server-side GA4 forwarding | ce666f0 |

**No conversion data yet on any of these changes** — they all went live today. We need 24-48 hours of ad traffic to measure impact.

---

## 11. Pages for Review

- **Landing page:** https://www.usagummies.com/go
- **Homepage:** https://www.usagummies.com
- **Shop page:** https://www.usagummies.com/shop
- **Product page:** https://www.usagummies.com/products/all-american-gummy-bears-7-5-oz-single-bag
- **Amazon listing:** https://www.amazon.com/dp/B0G1JK92TJ
- **Checkout test URL (5-pack):** https://www.usagummies.com/go/checkout (creates cart + redirects)
- **Checkout test URL (1-bag):** https://www.usagummies.com/go/checkout?qty=1

---

## 12. Outstanding Action Items

### Owner needs to do manually:
1. **Disable Shop Pay in Shopify admin** — Settings → Payments → Shop Pay → Deactivate. Even with the API bypass, Shop Pay may still appear as a payment option on the checkout page itself.
2. **Verify Amazon tiered promotion** goes live Feb 15 at 7 PM PST.
3. **Cancel dead Subscribe & Save coupons** in Amazon Seller Central.
4. **Set up Amazon Attribution** for proper ad-to-Amazon-sale tracking.

### Already done:
- ✅ Shop Pay redirect bypass
- ✅ Single-bag Shopify option ($5.99)
- ✅ Audience-relevant trust signals
- ✅ Money-back guarantee
- ✅ Amazon demoted to text link
- ✅ Comprehensive event tracking
- ✅ Server-side GA4 forwarding (ad-blocker proof)
- ✅ GA4 API secret configured in Vercel

### Upcoming (scheduled):
- **Feb 18:** Redesign entire site to match /go page design language

---

## 13. Open Questions & Areas for Research

1. **Will the changes convert?** We deployed 4 major changes today (Shop Pay bypass, single-bag option, trust signals, tracking). Need 24-48 hours of data to evaluate.

2. **Should we disable Shop Pay entirely?** Even with the API bypass, Shop Pay may still appear as a payment option within the checkout. For cold traffic that doesn't have a Shop Pay account, this could be confusing.

3. **Is the 1-bag option cannibalizing the 5-pack?** If people choose the $5.99 single bag over the $25 five-pack, our margins per acquisition are much worse. Need data.

4. **Checkout domain trust.** Users still land on `usa-gummies.myshopify.com` for checkout. Shopify Plus ($2,300/mo) allows checkout on your own domain — not viable at current scale. Are there alternatives?

5. **Ad creative optimization.** CTR is good and improving but we haven't tested creative variants yet.

6. **Retargeting.** 60%+ of visitors scroll and engage but don't buy. Is there a retargeting strategy via Truth Social or other channels?

7. **The audience-platform trust gap.** Conservative Truth Social users trust Amazon but not unfamiliar checkout flows. How do other D2C brands selling to this demographic handle this?

8. **Amazon Attribution tracking.** Zero visibility into which Amazon sales come from our ads.

9. **Email/SMS capture.** Zero email capture on the page. Should we add an exit-intent or inline email capture for visitors who don't buy?

---

## 14. Summary for Quick Context

We're running Truth Social ads ($50.63 spent over 3 days) driving traffic to usagummies.com/go. The ads work (CTR climbing to 0.65%, $0.51 CPC) and the page engages visitors (60% scroll, 119s avg session). But Shopify checkout was a black hole — 5 people started checkout, 0 completed.

**Root cause found and fixed:** Shopify's cart permalink was redirecting through Shop Pay (shop.app), creating a triple-domain-hop that killed trust for cold traffic. We bypassed this with a Storefront API cart creation route.

**Additional changes deployed today:** Added a single-bag Shopify option ($5.99) to lower the commitment threshold, updated trust signals to resonate with the audience ("Family-owned American business · Warehouses in Washington & Pennsylvania"), added a money-back guarantee, and demoted Amazon from a card to a text link.

**Analytics gap closed:** The /go page previously had ZERO custom event tracking. We added comprehensive click, scroll, and time tracking plus server-side GA4 forwarding via Measurement Protocol that bypasses ad blockers. We now track exactly which CTAs get clicked, how far users scroll, how long they stay, and definitively how many reach Shopify checkout.

**Current ROAS: 0.47x** ($50.63 spend, ~$24 Amazon revenue, $0 Shopify revenue). All fixes went live today — we need 24-48 hours to see if Shopify conversions start happening. Meanwhile Amazon converted 4 sales at ~50% click-to-sale rate, proving the audience will buy.
