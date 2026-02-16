# Email Drip Sequence: Dye-Free Movement Welcome Series

**Audience:** New leads captured via LeadCapture on /dye-free-movement, /dye-free-candy, /no-artificial-dyes-gummy-bears, homepage banner
**Trigger:** Email signup (any dye-free intent source)
**Cadence:** Day 0, Day 2, Day 5
**Goal:** Educate → Build trust → Convert to first purchase

---

## Email 1 — Day 0: Welcome + "Why We Started"
**Subject:** The candy aisle has a problem
**Preview text:** We started USA Gummies because we couldn't find gummy bears without artificial dyes.

**Body:**

Hey —

We started USA Gummies for a simple reason: we wanted classic gummy bears without the artificial dyes.

Not "natural flavors" with Red 40 hiding in the fine print. Not "made with real fruit" but still packed with Yellow 5. Actually dye-free. Colored with fruit and vegetable extracts — beet juice, turmeric, spirulina, carrot.

And made entirely in the USA, from sourcing to packaging.

That's it. Five classic flavors. No artificial dyes. Made here.

The FDA just banned Red No. 3 after decades of research. Mars and Kraft are scrambling to reformulate. We've been dye-free from day one.

If you want to see exactly what's in our gummies:
→ **[See our ingredients](https://www.usagummies.com/ingredients)**

Or skip straight to shopping:
→ **[Shop bags](https://www.usagummies.com/shop)**

— The USA Gummies Team

P.S. We have 4.8 stars from 2,000+ verified Amazon buyers. People keep coming back.

---

## Email 2 — Day 2: "What's Actually in Your Candy"
**Subject:** The label trick most candy brands use
**Preview text:** "No artificial flavors" doesn't mean no artificial colors. Here's how to check.

**Body:**

Quick label-reading trick most people miss:

"No artificial flavors" and "made with real fruit" say nothing about colors. A candy can have zero artificial flavors and still be loaded with Red 40, Yellow 5, and Blue 1.

Here's how to check in 10 seconds:

1. Flip the package over
2. Find the ingredients list
3. Look for anything with a number after a color (Red 40, Yellow 5, Blue 1, etc.)
4. Also check for: "artificial colors," "color added," or "FD&C" followed by a color

If you see any of those → it has synthetic dyes.

**Popular candy that still uses artificial dyes:**
- Haribo Goldbears
- Sour Patch Kids
- Swedish Fish
- Welch's Fruit Snacks
- Jolly Rancher

**Candy that's already dye-free:**
- USA Gummies (that's us)
- YumEarth
- Surf Sweets
- Unreal Candy

We wrote a full guide on this:
→ **[Dye-Free Candy Guide](https://www.usagummies.com/dye-free-candy)**

And if you want to see how the whole industry got here:
→ **[The Dye-Free Movement Timeline](https://www.usagummies.com/dye-free-movement)**

— USA Gummies

---

## Email 3 — Day 5: First Purchase Nudge
**Subject:** Your gummy bears are waiting
**Preview text:** Free shipping at 5+ bags. Most people start with 5.

**Body:**

By now you know the deal:

✓ Classic gummy bear flavor
✓ No artificial dyes — colored with fruit & vegetable extracts
✓ Made entirely in the USA
✓ 4.8 stars from 2,000+ Amazon buyers

Here's how pricing works:

| Bags | Per bag | Shipping |
|------|---------|----------|
| 1 | $5.99 | via Amazon |
| 3 | $5.49 | $5.99 flat |
| 5 | $4.99 | **FREE** |
| 8 | $4.49 | **FREE** |
| 12 | $3.99 | **FREE** |

Most people start with 5 bags to get free shipping. Bulk orders (8-12) are popular for offices, care packages, and stocking up.

→ **[Shop bags & pick your size](https://www.usagummies.com/shop)**

Not sure how many to get? Our bundle guide helps:
→ **[Bundle sizing guide](https://www.usagummies.com/bundle-guides)**

Want to try one bag first? You can grab a single bag on Amazon:
→ **[One bag on Amazon](https://www.amazon.com/dp/B0G1JK92TJ)**

— USA Gummies

P.S. Every bag ships from the USA within 24 hours. Satisfaction guaranteed.

---

## Implementation Notes

### ESP Setup (Klaviyo/Mailchimp/ConvertKit)
1. Create flow triggered by "Dye-Free Lead" tag or list segment
2. Set delays: Email 1 = immediate, Email 2 = +48 hours, Email 3 = +120 hours
3. Suppress anyone who purchases between emails (move to post-purchase flow)
4. UTM tags: `?utm_source=email&utm_medium=drip&utm_campaign=dyefree_welcome&utm_content=email_[1|2|3]`

### Tracking
- GA4 events: `email_drip_open`, `email_drip_click` (via ESP tracking pixels + UTM)
- Conversion goal: First purchase within 14 days of signup
- Secondary goal: Blog engagement (2+ pages visited from email clicks)

### Subject Line A/B Tests
**Email 1:**
- A: "The candy aisle has a problem"
- B: "We couldn't find dye-free gummy bears. So we made them."

**Email 2:**
- A: "The label trick most candy brands use"
- B: "Red 40 is in more candy than you think"

**Email 3:**
- A: "Your gummy bears are waiting"
- B: "5 bags, free shipping, no artificial dyes"

### Segments for Future Personalization
- **Source: /dye-free-movement** → Emphasize research/health angle
- **Source: /no-artificial-dyes-gummy-bears** → Ready to buy, skip education
- **Source: homepage banner** → General interest, full nurture sequence
- **Source: blog posts** → Content-engaged, emphasize more reading + social proof
