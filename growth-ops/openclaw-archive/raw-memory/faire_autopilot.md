# Faire Autopilot (W13)

## STRATEGY
Manage all Faire-related communication autonomously. Reply to buyer questions, follow up on inquiries, and keep our Faire presence active. Ben wants to be completely hands-off on Faire.

## 2026 OPPORTUNITIES
- **Faire Market 2026**: Apply to showcase USA Gummies at the Spring 2026 online wholesale event. [Learn more](https://www.faire.com/discover/faire-market-2026).
- **Faire Online Trade Shows**: Participate in twice-yearly Faire Markets to connect directly with retailers.
- **Shopify Integration**: Sync inventory and orders for streamlined management.
- **Seasonal Trends**: Optimize listing for summer/holiday seasons (e.g., Valentine’s Day, 4th of July).

## LISTING OPTIMIZATION (2026)
- **Faire SEO**: Optimize keywords, titles, and descriptions for search visibility.
- **Visual Upgrades**: Use high-quality images and visuals to improve conversion.
- **Promotions**: Set promotions before January 5, 2026, to be included in the Faire Market directory.
- **Sell-Through Rate (STR)**: Monitor and improve STR through relisting and optimization (Feb 20–March 20, 2026).
- **Resources**: [Faire Learning Hub](https://www.faire.com/blog/selling/release-notes/), [Sona Wholesale Consulting](https://www.sonawholesaleconsulting.com/blog/how-to-prepare-for-faire-winter-market-wholesale-strategy-checklist)

## FAIRE ACCOUNT
- Platform: faire.com
- Login: Marketing@usagummies.com (credentials stored in `~/.config/usa-gummies-mcp/.faire-credentials`)
- Product: All American Gummy Bears
- Shelf life: 12 months from date of manufacture
- Storage: Cool, dry place, no refrigeration needed
- MOQ: Flexible for first orders
- Wholesale pricing: Available (direct buyers to marketing@usagummies.com for custom quotes)

## AGENT CAPABILITIES
- **W13 (CLI agent)**: Email-only — monitors inbox for Faire notifications, replies to buyer questions via email, logs activity. CANNOT log into faire.com (no browser).
- **Claude Code (browser session)**: Full Faire access — can log into faire.com, manage listings, update promotions, check messages/orders, optimize SEO. Use credentials from `~/.config/usa-gummies-mcp/.faire-credentials`.
- **Division of labor**: W13 handles routine email monitoring hourly. Claude Code handles listing optimization, seasonal updates, and platform management when invoked by Ben.

## KNOWN ACTIVE CONVERSATIONS
- **Osborne Visitor Welcome Center (Ean)** — Replied to shelf life question (Feb 19).
- Check inbox regularly for new Faire notifications (from@faire.com or notifications@faire.com)

## REPLY TEMPLATES

### Shelf Life Question
```
Subject: Re: {ORIGINAL_SUBJECT}

Hi Ean,

Great question! Our All American Gummy Bears have a shelf life of 12 months from the date of manufacture. They're made with all-natural ingredients — no artificial preservatives, flavors, or dyes.

Storage: Keep in a cool, dry place. No refrigeration needed.

Since your busiest time is summer, ordering in early spring will ensure they stay fresh through the season. Let me know if you'd like a sample or have any other questions!

Best,
Ben
USA Gummies — Premium Gummy Bears, Made in the USA
https://www.usagummies.com
```

### General Buyer Inquiry
```
Subject: Re: {ORIGINAL_SUBJECT}

Hi {NAME},

Thank you for your interest in USA Gummies! We'd love to work with you.

Here's a quick overview:
- All American Gummy Bears — 7.5 oz bags, all-natural flavors and colors
- 100% Made in the USA (sourced, manufactured, packed domestically)
- No artificial dyes — colors from real fruits and vegetables
- 12-month shelf life, no refrigeration needed
- Flexible MOQ for first orders

Happy to answer any questions or send samples. What works best?

Best,
Ben
USA Gummies — Premium Gummy Bears, Made in the USA
https://www.usagummies.com
```

### Order Follow-Up
```
Subject: Thank you for your order! 🇺🇸

Hi {NAME},

Just wanted to say thank you for ordering from USA Gummies! We really appreciate your support.

Your order is being prepared and will ship shortly. If you have any questions about the product, merchandising, or reordering, don't hesitate to reach out.

We'd also love to hear how your customers like them!

Best,
Ben
USA Gummies — Premium Gummy Bears, Made in the USA
https://www.usagummies.com
```

## AGENT INSTRUCTIONS
1. Check inbox for Faire notifications: `bash scripts/check-email.sh --search "from:faire.com" --folder INBOX`
2. Also check: `bash scripts/check-email.sh --search "faire" --folder INBOX`
3. Read any new Faire messages
4. Reply using appropriate template via `bash scripts/send-email.sh`
5. For complex pricing/custom requests: draft reply and note "Needs Ben review" in log
6. Log all actions below

## RULES
- Reply to ALL Faire buyer messages within 1 cycle
- Be warm, professional, and helpful
- Never make up pricing — if unsure, say "let me get you a custom quote"
- Check memory/email_send_log.md to avoid duplicate replies
- Log every interaction below

## Activity Log
- **2026-02-19**: Replied to Ean (Osborne Visitor Welcome Center) regarding shelf life. Drafted reply for Ben to send via Faire.
- **2026-02-19**: No new Faire buyer messages in inbox. Researched 2026 Faire opportunities:
  - **Seasonal Optimization**: Update listing for Valentine’s Day, Easter, and 4th of July themes.
  - **Competitor Platforms**: Explore Bulletin and Creoate for cross-listing.
  - **Faire IPO Growth**: Monitor platform updates for new promotional features.
  - **Next Steps**: Optimize product images/descriptions for seasonal relevance and research competitor platforms.
- **2026-02-19**: Drafted seasonal product descriptions for Valentine’s Day, Easter, and 4th of July. Saved to `memory/faire_autopilot_seasonal_drafts.md` for review.
- **2026-02-19**: Researched Bulletin and Creoate for cross-listing opportunities:
  - **Bulletin**: Apply to join; curated community for premium brands. No specific MOQ mentioned.
  - **Creoate**: £75 minimum order; 25% commission on first-time orders, 10% on reorders. Focus on sustainability.
  - **Next Steps**: Prepare applications for both platforms, highlight USA-made and all-natural selling points.
- **2026-02-19**: Drafted application outlines for Bulletin and Creoate. Saved to `memory/faire_autopilot_crosslisting_drafts.md` for review. Next: Submit applications and prepare for order fulfillment.
- **2026-02-19 08:47 AM**: Checked inbox — no new Faire buyer messages. Awaiting Ben’s review/approval of drafts for next steps.
- **2026-02-19 09:47 AM**: Checked inbox — no new Faire buyer messages. Standing by for approval.
- **2026-02-19 10:47 AM**: Checked inbox — no new Faire buyer messages. Continuing to stand by for approval.
- **2026-02-19 12:47 PM**: Checked inbox — no new Faire buyer messages. No action taken; standing by for approval.
- **2026-02-19 03:47 PM**: Checked inbox — no new Faire buyer messages. No action taken; standing by for approval.
- **2026-02-19 06:47 PM**: Checked inbox — no new Faire buyer messages. No action taken; standing by for approval.
- **2026-02-19 09:47 PM**: Checked inbox — no new Faire buyer messages. No action taken; standing by for approval.
- **2026-02-20 12:47 AM**: Checked inbox — no new Faire buyer messages. No action taken; standing by for approval.
- **2026-02-20 03:47 AM**: Checked inbox — no new Faire buyer messages. No action taken; standing by for approval.
- **2026-02-20 06:47 AM**: Checked inbox — no new Faire buyer messages. No action taken; standing by for approval.
- **2026-02-20 09:47 AM**: Checked inbox — no new Faire buyer messages. No action taken; standing by for approval.
- **2026-02-12**: Received shelf life question from Ean (Osborne Visitor Welcome Center).
- **2026-02-12**: Received shelf life question from Ean (Osborne Visitor Welcome Center).