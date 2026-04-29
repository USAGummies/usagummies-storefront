# USA Gummies — Email Capture & Recovery Launch Plan

**Status:** Content drafted (no-discount version). Ready for paste-and-launch.
**Tool:** Shopify Email (native, free up to 10K emails/mo)
**Owner:** Ben (Shopify Admin UI work)
**Estimated launch time:** 30-45 min tomorrow morning

> **2026-04-28 19:00 PT — strategy revised by Ben:** No discount codes in
> any flow. The hook is the product story (made in USA, no artificial dyes,
> real-fruit color, the candy your grandparents would have recognized) —
> NOT a 10% off coupon. If a discount is ever added later, it caps at 10%.
>
> See § DISCOUNT CODE CLEANUP at the bottom for the codes Claude created
> earlier today that Ben needs to delete in Shopify admin.

---

## 🎯 What This Solves

```
TODAY:    38 visitors landed, 0 captured, 0 followups → all lost forever
GOAL:     Capture emails on exit, recover carts, nurture buyers
EXPECTED: Recover 8-15% of would-be-lost visitors (industry std)
LEVER:    Brand story (USA, dye-free, real fruit) — NOT discounting
```

---

## 📧 EMAIL #1 — Welcome Series

**Trigger:** Email captured via popup OR newsletter signup
**Sends:** Email 1 immediately, Email 2 at +24h, Email 3 at +72h

### Email 1 (sent within 5 min of opt-in)

**Subject:** `🇺🇸 Welcome to USA Gummies — the candy your grandparents would have recognized`

**Preview text:** `Made in America. No artificial dyes. Five real flavors.`

**Body:**

> **Welcome to USA Gummies**
>
> We made USA Gummies because we couldn't find an honest gummy bear in this country. So we built one.
>
> ✅ Made in an SQF-certified American facility
> ✅ Colored with real fruit and vegetable extracts (no Red 3, no Red 40)
> ✅ 5 classic flavors — Cherry, Lemon, Green Apple, Orange, Watermelon
>
> [SHOP NOW →]({{shop_url}})
>
> — Ben Stutman, Founder

### Email 2 (+24h)

**Subject:** `Why we stopped using Red 40 (and why the FDA finally agrees)`

**Preview text:** `The FDA banned Red Dye No. 3 in January 2025. We never used it.`

**Body:**

> Here's the story we never tell on the bag:
>
> Most gummy bears in America use Red 40, Yellow 5, and Blue 1 — petroleum-based dyes linked to hyperactivity in kids. The FDA banned Red Dye No. 3 in January 2025. We never used it. We don't use any of them.
>
> What we use instead: beets, raspberries, carrots, paprika. Real fruits and vegetables, naturally colored.
>
> The result: gummies that taste like the ones your grandparents would have eaten. No mystery, no chemistry-degree label.
>
> [SHOP NOW →]({{shop_url}})

### Email 3 (+72h)

**Subject:** `What our customers say`

**Preview text:** `Real reviews from real customers.`

**Body:**

> Three real reviews from customers who bought USA Gummies:
>
> ⭐⭐⭐⭐⭐ **Rene G:** *"Gummies arrived in time for Christmas. Nice stocking stuffers for my kids. The gummies are fresh and very good."*
>
> ⭐⭐⭐⭐⭐ **Beau M:** *"Quick order fulfillment and shipping, with a great tasting, soft, and fresh gummy bears."*
>
> ⭐⭐⭐⭐⭐ **Niki L:** *"Just tried USA Gummies and they are amazing. The flavor and texture is next level and addicting."*
>
> [SHOP NOW →]({{shop_url}})

---

## 🛒 EMAIL #2 — Abandoned Cart Series

**Trigger:** Customer adds to cart + enters email at checkout but doesn't complete
**Sends:** Email 1 at +1h, Email 2 at +24h

### Email 1 (+1h after abandonment)

**Subject:** `Your USA Gummies are still in your cart`

**Preview text:** `Made in America, no artificial dyes — pick up where you left off.`

**Body:**

> Hi {{first_name}},
>
> You left these in your cart:
>
> {{cart_items}}
>
> They're still here. Made in America, naturally-colored, no Red 3, no Red 40. No reason to wait.
>
> [COMPLETE YOUR ORDER →]({{checkout_url}})
>
> P.S. — free shipping on 5+ bags.

### Email 2 (+24h after abandonment)

**Subject:** `Your cart is still here`

**Preview text:** `Real American gummy bears. No artificial anything.`

**Body:**

> Still thinking it over?
>
> No pressure — but your cart is still here:
>
> {{cart_items}}
>
> Five real fruit-and-veg-colored flavors. Made in an SQF-certified American facility. The candy you remember from when candy was simpler.
>
> [COMPLETE YOUR ORDER →]({{checkout_url}})
>
> If it's not the right fit, no hard feelings. We'll stop reminding you after this.

---

## 📬 EMAIL #3 — First Purchase Thank You

**Trigger:** First completed Shopify order (any amount)
**Sends:** Immediately after order

**Subject:** `Welcome to the squad, {{first_name}} 🇺🇸`

**Preview text:** `Your order is on the way — here's what to expect.`

**Body:**

> {{first_name}}, you just bought America's first dye-free gummy bear. Welcome.
>
> **What happens next:**
> - Your order ships from our Washington warehouse within 24 hours
> - You'll get a tracking number by email
> - Most orders arrive in 2-5 business days
>
> Reply to this email if anything goes wrong — Ben (the founder, not a robot) reads every reply.
>
> Thanks for backing American candy.
>
> 🇺🇸 The USA Gummies Team

---

## 🪟 POPUP CAPTURE FORM

**Trigger:** Exit intent on /shop OR 30s on page (whichever first), mobile + desktop
**Display:** Once per session, suppress after dismiss for 7 days

### Headline

```
🇺🇸 THE CANDY YOUR GRANDPARENTS
WOULD HAVE RECOGNIZED
```

### Subhead

```
Made in America. No artificial dyes.
Real fruit, real color, real flavor.
```

### CTA

```
[Email field placeholder: "your@email.com"]
[ Button: "JOIN THE LIST" ]
```

### Footer microcopy

```
We email weekly, never sell your data, unsubscribe anytime.
```

### Visual notes

- USA flag colors (cream, brick red, navy)
- Comic-style USA Gummies bag illustration on left
- Five real-fruit gummy bears across the bottom (Cherry, Lemon, Green Apple, Orange, Watermelon)
- Mobile: full-screen, single-column, thumb-zone CTA at bottom

---

## 🎟️ DISCOUNT CODE CLEANUP (Ben — 5 min in admin)

Per the 2026-04-28 strategy revision (no discount codes), the codes Claude
pre-created earlier today need to be deleted in Shopify admin:

```
https://admin.shopify.com/store/usa-gummies/discounts
```

Codes to **DELETE**:

| Code            | Origin              | Notes                              |
| --------------- | ------------------- | ---------------------------------- |
| `CART15`        | Claude MCP, today   | 15% off — over the 10% guard rail  |
| `REFER5`        | Claude MCP, today   | $5 fixed off, no min spend         |
| `WELCOMEUSA10`  | Claude MCP, today   | Redundant test code (10% off)      |
| `TESTNIGHT428`  | Claude MCP, today   | Test code created during MCP probe |

Codes to **REVIEW**:

| Code        | Notes                                                                |
| ----------- | -------------------------------------------------------------------- |
| `WELCOME10` | Already existed in store before today. Delete or leave disabled — no flow references it. |

---

## 📋 BEN'S TOMORROW WORKFLOW

```
1. https://admin.shopify.com/store/usa-gummies/discounts
   → Delete the 5 codes listed in § DISCOUNT CODE CLEANUP

2. https://admin.shopify.com/store/usa-gummies/email
   → Verify Shopify Email is enabled (free up to 10K/mo)

3. https://admin.shopify.com/store/usa-gummies/email/automations
   → Create 3 flows:
       a. Welcome Series      — trigger: customer subscribes
       b. Abandoned Checkout  — trigger: checkout abandoned
       c. First Order         — trigger: first paid order
   → Paste the email content from this doc into each
   → IMPORTANT: do NOT add any discount-code merge tags

4. https://admin.shopify.com/store/usa-gummies/online_store/themes
   → Edit current theme → add Sign-up form OR install Privy app (free tier)
   → Configure exit intent + 30s timer triggers
   → Use the popup copy from § POPUP CAPTURE FORM

5. Test:
   → Open /shop incognito → wait 30s OR move mouse to top → popup appears
   → Submit a test email
   → Check email arrives within 5 min — should be brand-story content,
     NO discount code anywhere in the body
   → Add a product to cart → close browser → wait 1h
   → Check abandoned cart email arrives — same, no discount

6. Push live → done.
```

---

## 🔔 What Claude will do tomorrow morning to support this

- Verify Shopify Email is provisioned on the account
- Walk through the Shopify Email flow builder if it's new to you
- Test the popup → email chain end-to-end
- Wire the audit script to track email-captured signups as a new metric
