# USA Gummies — Email Capture & Recovery Launch Plan

**Status:** Content drafted, ready for paste-and-launch
**Tool:** Shopify Email (native, free up to 10K emails/mo)
**Owner:** Ben (Shopify Admin UI work)
**Estimated launch time:** 60-90 min tomorrow morning

---

## 🎯 What This Solves

```
TODAY:    38 visitors landed, 0 captured, 0 followups → all lost forever
GOAL:     Capture emails on exit, recover carts, nurture buyers
EXPECTED: Recover 8-15% of would-be-lost visitors (industry std)
```

---

## 📧 EMAIL #1 — Welcome Series

**Trigger:** Email captured via popup OR newsletter signup OR first purchase
**Sends:** Email 1 immediately, Email 2 at +24h, Email 3 at +72h

### Email 1 (sent within 5 min of opt-in)

**Subject:** `🇺🇸 Welcome to USA Gummies — your 10% off is inside`

**Preview text:** `Made in America. No artificial dyes. The candy your grandparents would have recognized.`

**Body:**

> **Welcome to USA Gummies**
>
> We made USA Gummies because we couldn't find an honest gummy bear in this country. So we built one.
>
> ✅ Made in an SQF-certified American facility
> ✅ Colored with real fruit and vegetable extracts (no Red 3, no Red 40)
> ✅ 5 classic flavors — Cherry, Lemon, Green Apple, Orange, Watermelon
>
> **Your 10% off code:** `WELCOME10`
>
> [SHOP NOW →]({{shop_url}})
>
> — Ben Stutman, Founder

### Email 2 (+24h)

**Subject:** `Why we stopped using Red 40 (and why the FDA finally agrees)`

**Preview text:** `Real story. The FDA banned Red Dye No. 3 in January 2025. We never used it.`

**Body:**

> Here's the story we never tell on the bag:
>
> Most gummy bears in America use Red 40, Yellow 5, and Blue 1 — petroleum-based dyes linked to hyperactivity in kids. The FDA banned Red Dye No. 3 in January 2025. We never used it. We don't use any of them.
>
> What we use instead: beets, raspberries, carrots, paprika. Real fruits and vegetables, naturally colored.
>
> The result: gummies that taste like the ones your grandparents would have eaten. No mystery, no chemistry-degree label.
>
> **Reminder: your 10% off `WELCOME10` is valid for the next 5 days.**
>
> [SHOP NOW →]({{shop_url}})

### Email 3 (+72h)

**Subject:** `What our customers say (and a final reminder)`

**Preview text:** `Real reviews from real customers — your code expires in 48 hours.`

**Body:**

> Three real reviews from customers who bought USA Gummies:
>
> ⭐⭐⭐⭐⭐ **Rene G:** *"Gummies arrived in time for Christmas. Nice stocking stuffers for my kids. The gummies are fresh and very good."*
>
> ⭐⭐⭐⭐⭐ **Beau M:** *"Quick order fulfillment and shipping, with a great tasting, soft, and fresh gummy bears."*
>
> ⭐⭐⭐⭐⭐ **Niki L:** *"Just tried USA Gummies and they are amazing. The flavor and texture is next level and addicting."*
>
> Your 10% off `WELCOME10` expires in 48 hours.
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

**Subject:** `Last call: 10% off your cart, just for you`

**Preview text:** `WELCOME10 still works — but only for the next 24 hours.`

**Body:**

> Still thinking it over?
>
> Here's a one-time **10% off** code, just for you: `WELCOME10`
>
> Your cart is waiting:
>
> {{cart_items}}
>
> [COMPLETE YOUR ORDER →]({{checkout_url}})
>
> If it's not the right fit, no hard feelings. We'll stop reminding you after this.

---

## 📬 EMAIL #3 — First Purchase Thank You

**Trigger:** First completed Shopify order (any amount)
**Sends:** Immediately after order

**Subject:** `Welcome to the squad, {{first_name}} 🇺🇸`

**Preview text:** `Your order is on the way — here's what to expect, and how to get a friend hooked.`

**Body:**

> {{first_name}}, you just bought America's first dye-free gummy bear. Welcome.
>
> **What happens next:**
> - Your order ships from our Washington warehouse within 24 hours
> - You'll get a tracking number by email
> - Most orders arrive in 2-5 business days
>
> **One favor to ask:**
>
> If you love them, share with a friend. We'll give you both **$5 off** your next bag with code `REFER5`.
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
🇺🇸 GET 10% OFF YOUR FIRST BAG
```

### Subhead

```
Made in America. No artificial dyes.
The candy your grandparents would have recognized.
```

### CTA

```
[Email field placeholder: "your@email.com"]
[ Button: "GIVE ME 10% OFF" ]
```

### Footer microcopy

```
We email weekly, never sell your data, unsubscribe anytime.
```

### Visual notes

- USA flag colors (cream, brick red, navy)
- Comic-style USA Gummies bag illustration on left
- "10% OFF" in big bold red
- Mobile: full-screen, single-column, thumb-zone CTA at bottom

---

## 🎟️ DISCOUNT CODES TO CREATE

```
WELCOME10
  Type:        % off
  Value:       10%
  Min spend:   none
  Usage:       1 per customer
  Expires:     7 days from issue (per email)
  Note:        Issued by welcome series + popup

REFER5
  Type:        $ off
  Value:       $5
  Min spend:   $20
  Usage:       1 per customer (auto-issued post-purchase)
  Expires:     90 days
  Note:        Drive referral loops

CART15
  Type:        % off
  Value:       15%
  Min spend:   none
  Usage:       1 per customer
  Expires:     48 hours
  Note:        Optional escalation in abandoned-cart email 2 if WELCOME10 is unused
```

---

## 📋 BEN'S TOMORROW WORKFLOW

```
1. Open: https://admin.shopify.com/store/usa-gummies/email
   → Verify Shopify Email is enabled (free up to 10K/mo)

2. Open: https://admin.shopify.com/store/usa-gummies/discounts
   → Create the 3 discount codes from § "DISCOUNT CODES" above
   (Or I can create them via API tomorrow)

3. Open: https://admin.shopify.com/store/usa-gummies/email/automations
   → Create 3 flows:
       a. Welcome Series      — trigger: customer subscribes
       b. Abandoned Checkout  — trigger: checkout abandoned
       c. First Order         — trigger: first paid order
   → Paste the email content from this doc into each

4. Open: https://admin.shopify.com/store/usa-gummies/online_store/themes
   → Edit current theme → add Sign-up form OR install Privy app (free tier)
   → Configure exit intent + 30s timer triggers
   → Use the popup copy from § "POPUP CAPTURE FORM"

5. Test:
   → Open /shop incognito → wait 30s OR move mouse to top → popup appears
   → Submit a test email
   → Check email arrives within 5 min with WELCOME10 code
   → Add a product to cart → close browser → wait 1h
   → Check abandoned cart email arrives

6. Push live → done.
```

---

## 🔔 What I'll do tomorrow morning to support this

- Create the 3 discount codes via Shopify Admin API at 09:00 MT (saves you a step)
- Verify Shopify Email is provisioned on the account (might need confirmation)
- Walk you through the Shopify Email flow builder if it's new
- Test the popup → email → discount chain end-to-end
- Wire the audit script to track email-captured signups as a new metric
