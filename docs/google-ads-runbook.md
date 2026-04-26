# Google Ads — operating runbook

The conversion playbook now that the storefront rebuild is live. Built
2026-04-25 to ship Tasks 1–4 from the post-rebuild Google Ads ladder:

  1. Wire conversion tracking (CRITICAL — currently broken in prod)
  2. RSA copy for 7 ad groups (8 headlines + 4 descriptions each)
  3. UTM-tagged final URLs for all 7 ad groups
  4. Offline-conversion backfill script (run once Task 1 lands)

The campaign creation walkthrough — networks off, keyword exact-match,
location lockdown, budget, bidding — lives in
[`docs/google-ads-bot-proof-spec.md`](google-ads-bot-proof-spec.md).
This runbook is the copy + URLs + tracking layer that goes inside it.

> **Hard rule for all ad copy + landing pages**: never name the warehouse
> city ("Ashford / Ashford WA / Pierce County"), never use the founder's
> name ("Ben / Stutman / Benjamin"). Public-facing copy uses "USA
> Gummies" / "we" / "ships from our U.S. warehouse" only. See
> CLAUDE.md → "Public-Facing Copy Rules (HARD)".

---

## Task 1 — Wire conversion tracking (CRITICAL)

**Current state:** the AW-7754142374 base remarketing tag fires on every
page (verified in prod HTML). The `PurchaseTracker` component on
`/thank-you` calls `gtag("event", "conversion", { send_to: ... })` —
but the `send_to` value resolves to an empty string because
`NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL` is not set in Vercel. **Result:
every purchase fires a conversion event with no destination, so Google
Ads has zero conversion data, so Smart Bidding has been flying blind for
months.** That's why the prior $1,678 test produced 0 attributable orders.

### 1A — Create the conversion action (Ben, ~5 minutes in Google Ads UI)

Open `https://ads.google.com/aw/conversions/new?ocid=7719551641`.

| Field | Value |
|---|---|
| Source | Website |
| Goal | Purchase (Primary) |
| Name | `USAG Web Purchase` |
| Category | Purchase |
| Value | "Use a different value for each conversion" |
| Default value (fallback) | 25.00 USD |
| Count | Every |
| Click-through window | 30 days |
| Engaged-view window | 3 days |
| View-through window | 1 day |
| Attribution model | Data-driven |
| Include in "Conversions" column | ✓ Yes |

After saving, Google shows you a `gtag` snippet that looks like:
```
gtag('event', 'conversion', {
  'send_to': 'AW-7754142374/AbC1def2GhI3jklm4N',
  ...
});
```

**Copy the part after the slash** (`AbC1def2GhI3jklm4N` in the example) —
that's the **conversion label**. Send it to me and I'll wire it up.

### 1B — Set the env var (I do this once you send me the label)

```bash
# In the project root, on Vercel:
printf '%s' '<CONVERSION_LABEL>' | vercel env add NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL production
printf '%s' '<CONVERSION_LABEL>' | vercel env add NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL preview
printf '%s' '<CONVERSION_LABEL>' | vercel env add NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL development
git commit --allow-empty -m "redeploy to pick up GOOGLE_ADS_CONVERSION_LABEL" && git push origin main
```

After redeploy, the page HTML will contain:
```
window.__usaGadsConversionId = 'AW-7754142374/<LABEL>';
```

### 1C — Validate the firing (Ben, ~10 minutes)

1. Open `https://www.usagummies.com/?utm_source=google&utm_medium=cpc&gclid=test123`
2. Open DevTools → Network → filter `googleadservices`
3. Add a bag to cart, complete a real test order
4. On `/thank-you`, you should see a request to
   `https://www.googleadservices.com/pagead/conversion/...` with the
   conversion label in the URL.
5. **Within 3 hours** (sometimes 24h), the test order shows up under
   Google Ads → Tools → Conversions → "All conversions" with status
   "Recording conversions".

If it doesn't show up after 24h, the wiring is broken — ping me, I'll debug.

---

## Task 2 — RSA copy (7 ad groups, 8 headlines + 4 descriptions each)

Google Ads RSA constraints:
- Headlines: 30 chars max each, **8–15** per ad
- Descriptions: 90 chars max each, **4** per ad
- Pinning: pin Headline 1 to position 1, Headline 2 to position 2; rest
  unpinned (lets Google Ads serve dynamic combos)

All copy below is verified — no Ashford reference, no founder name, no
"resealable" claim, no fabricated subscriber counts. Pulled from the
new LP copy + bag panel + ingredient list.

### Ad Group 1 — Dye-Free · Exact Match  →  `/lp/dye-free-gummies`

**Headlines (paste into the 8 headline slots):**
```
Dye-Free Gummy Bears
No Artificial Dyes, Ever
Real Fruit Gummy Bears
All Natural Flavors
Color from Real Fruit
Made in the U.S.A.
5 Natural Flavors, 1 Bag
Shop the 7.5 oz Bag
```

**Descriptions:**
```
Real gummy bears. Five natural flavors. No artificial dyes on the label.
Colored from raspberries, beets, spirulina, curcumin. Every shade from food.
Made in the U.S.A. Free shipping on 5+ bags. 30-day satisfaction guarantee.
Cherry, lemon, green apple, orange, watermelon — stack bags, save per bag.
```

### Ad Group 2 — Made-in-USA · Exact Match  →  `/made-in-usa-candy`

**Headlines:**
```
Made in U.S.A. Gummies
American Made Candy
Sourced + Packed in USA
Real American Gummies
U.S.-Made, Dye-Free
All-American Gummy Bears
Backing American Jobs
Shop American Candy
```

**Descriptions:**
```
Gummy bears sourced, made, and packed entirely in the United States.
Backing American jobs and American business with every 7.5 oz bag.
All natural flavors. No artificial dyes. Free shipping on 5+ bags.
Made in America. Made for sharing. 30-day satisfaction guarantee.
```

### Ad Group 3 — Red 40 Free · Exact Match  →  `/no-artificial-dyes-gummy-bears`

**Headlines:**
```
No Red 40 Gummy Bears
Red 40 Free Candy
Zero Petroleum Dyes
Dye-Free Gummies
Real Color, No Synthetics
Clean Gummy Bears
No Yellow 5, No Red 40
Dye-Free, U.S. Made
```

**Descriptions:**
```
Zero artificial dyes. Color from raspberries, beets, spirulina, curcumin.
Not one petroleum-derived dye on the ingredient panel. Read the label.
5 natural flavors. Cherry, lemon, green apple, orange, watermelon. U.S.-made.
Free shipping on 5+ bags. 30-day satisfaction guarantee.
```

### Ad Group 4 — Bulk · Exact Match  →  `/bulk-gummy-bears`

**Headlines:**
```
Bulk Gummy Bears
Buy in Bulk, Save More
Per-Bag Price Drops
Free Ship on 5+ Bags
Bulk Dye-Free Gummies
Office, Party, Pantry
American Bulk Candy
Stack Bags, Save
```

**Descriptions:**
```
Stack bags and watch the per-bag price drop. Free shipping unlocks at 5+.
Real American gummy bears in 7.5 oz bags. Five natural flavors, no dyes.
Perfect for office snacks, party trays, care packages, and pantry runs.
30-day satisfaction guarantee. Made in the U.S.A.
```

### Ad Group 5 — Gift Bundles · Exact Match  →  `/gummy-gift-bundles`

**Headlines:**
```
Gummy Gift Bundles
American Gift Candy
Made-in-USA Gift Bag
Thoughtful Candy Gift
Bundle + Save Gifting
Care Package Candy
Patriotic Gift Bags
Send a 7.5 oz Bag
```

**Descriptions:**
```
Send real American gummy bears. No artificial dyes. Five natural flavors.
Bundle bags for the lower per-bag price. Free shipping on 5+ bags.
Made in the U.S.A. Perfect for care packages, birthdays, or just because.
30-day satisfaction guarantee. Ships within 24 hours.
```

### Ad Group 6 — Patriotic · Exact Match  →  `/patriotic-candy`

**Headlines:**
```
Patriotic Gummy Bears
American Party Candy
4th of July Gummies
Stars + Stripes Snacks
Made-in-USA Candy
Patriotic Snack Bags
Red, White & Chewy
Independence Day Treat
```

**Descriptions:**
```
Made-in-USA gummy bears for every patriotic table. Five all-natural flavors.
No artificial dyes — color from real fruit, real vegetables, real ingredients.
Free shipping on 5+ bags. 30-day satisfaction guarantee.
From cookouts to care packages, the bag goes wherever America gathers.
```

### Ad Group 7 — Brand · Exact Match  →  `/`

**Headlines:**
```
USA Gummies — Official
USA Gummies (Official)
Shop USA Gummies
USA Gummies 7.5 oz Bag
Buy Direct from USAG
Official USA Gummies
USA Gummies Direct
USA Gummies — Order
```

**Descriptions:**
```
Official storefront. Real gummy bears, made in U.S.A. with 5 natural flavors.
No artificial dyes. Bundle savings on 5+ bags. Free shipping.
Order direct. 30-day satisfaction guarantee. Ships within 24 hours.
Cherry, lemon, green apple, orange, watermelon — all real fruit color.
```

---

## Task 3 — UTM-tagged final URLs (paste into Google Ads "Final URL" + "Tracking template")

### Final URLs per ad group

Paste these into the **Final URL** field on each ad. Pure URL, no params
— Google Ads adds tracking via the campaign-level template below.

| Ad group | Final URL |
|---|---|
| Dye-Free · Exact Match | `https://www.usagummies.com/lp/dye-free-gummies` |
| Made-in-USA · Exact Match | `https://www.usagummies.com/made-in-usa-candy` |
| Red 40 Free · Exact Match | `https://www.usagummies.com/no-artificial-dyes-gummy-bears` |
| Bulk · Exact Match | `https://www.usagummies.com/bulk-gummy-bears` |
| Gift Bundles · Exact Match | `https://www.usagummies.com/gummy-gift-bundles` |
| Patriotic · Exact Match | `https://www.usagummies.com/patriotic-candy` |
| Brand · Exact Match | `https://www.usagummies.com/` |

### Tracking template (set ONCE at the campaign level)

Google Ads → Campaign settings → Additional settings → Campaign URL options
→ Tracking template:

```
{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={_campaignname}&utm_content={_adgroupname}&utm_term={keyword}&utm_match={matchtype}&gclid={gclid}&campaignid={campaignid}&adgroupid={adgroupid}
```

Then add **custom parameters** at the campaign level (so the
`{_campaignname}` and `{_adgroupname}` interpolation works without
spaces breaking the URL):

| Param | Value |
|---|---|
| `_campaignname` | `dye-free-test-2026-04-25` (set per campaign) |
| `_adgroupname` | `dye-free-exact` (set per ad group, override at ad-group level for each one) |

Per-ad-group `_adgroupname` override values:
- `dye-free-exact`
- `made-in-usa-exact`
- `red-40-free-exact`
- `bulk-exact`
- `gift-bundles-exact`
- `patriotic-exact`
- `brand-exact`

This URL pattern lets the offline-conversion backfill script (Task 4)
match Shopify orders back to specific GCLIDs, ad groups, and keywords.

### Validate the URLs render correctly

After setting the template, click "Test" in Google Ads and copy the
generated URL — should look like:
```
https://www.usagummies.com/lp/dye-free-gummies?utm_source=google&utm_medium=cpc&utm_campaign=dye-free-test-2026-04-25&utm_content=dye-free-exact&utm_term=dye+free+gummy+bears&utm_match=e&gclid=Cj0KCQjw...&campaignid=12345&adgroupid=67890
```

Open that URL — page should load, you should see a gclid in your URL bar.
GA4 will record the campaign correctly within 5 minutes.

---

## Task 4 — Offline-conversion backfill (run once Task 1 lands)

The script `scripts/google-ads-backfill-conversions.mjs` already exists
in the repo. It pulls every paid Shopify order back to a configurable
date, extracts the GCLID from each order's UTM params, and uploads them
as offline conversions to Google Ads. **This gives Smart Bidding a
retroactive training set instead of starting from zero.**

### 4A — Required env vars (Ben sets these on the laptop)

The dev-token + OAuth creds aren't yet in `~/.config/usa-gummies-mcp/.env-daily-report`.
Get them in this order:

1. **`GOOGLE_ADS_DEVELOPER_TOKEN`** — apply at
   `https://ads.google.com/aw/apicenter` → "Apply for token". Comes
   back the same day in standard mode (good for ≤ 15k API calls/day,
   plenty for backfill).
2. **`GOOGLE_ADS_CLIENT_ID` + `GOOGLE_ADS_CLIENT_SECRET`** — Google
   Cloud Console → APIs & Services → Credentials → Create OAuth
   client ID → "Desktop app". Pick the project
   `usagummies-app` (already exists, was used for GA4 service
   account) or create a new one.
3. **`GOOGLE_ADS_REFRESH_TOKEN`** — generate via OAuth playground:
   `https://developers.google.com/oauthplayground/` →
   - Top-right gear icon → check "Use your own OAuth credentials"
   - Paste your client ID + secret
   - Step 1: scope = `https://www.googleapis.com/auth/adwords`
   - Authorize → exchange for tokens → copy `refresh_token`
4. **`GOOGLE_ADS_CUSTOMER_ID`** = `7754142374` (from the AW- ID, no dashes)
5. **`GOOGLE_ADS_PURCHASE_CONVERSION_ACTION`** — copy from Task 1
   conversion action page → "Resource name" tab. Format:
   `customers/7754142374/conversionActions/12345678`
6. **`SHOPIFY_ADMIN_TOKEN`** — already set ✓

Add the new ones to `~/.config/usa-gummies-mcp/.env-daily-report`:
```bash
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CLIENT_ID=...
GOOGLE_ADS_CLIENT_SECRET=...
GOOGLE_ADS_REFRESH_TOKEN=...
GOOGLE_ADS_CUSTOMER_ID=7754142374
GOOGLE_ADS_PURCHASE_CONVERSION_ACTION=customers/7754142374/conversionActions/<id>
```

### 4B — Dry run (no creds needed beyond Shopify)

Preview what orders would be backfilled, no upload:
```bash
cd /Users/ben/usagummies-storefront
node scripts/google-ads-backfill-conversions.mjs --since 2026-01-25 --dry
```

The `--since` flag controls the lookback window. Google Ads accepts
offline conversions up to **90 days old by default**, so use 90 days
back from today. If you need to go further back, raise the
click-through conversion window in the Google Ads UI first (Task 1
conversion-action settings → click-through window).

The dry run prints something like:
```
Found 47 paid Shopify orders since 2026-01-25.
  - 23 have GCLID in attribution
  - 24 have no GCLID (organic / direct / non-Google traffic)
Would upload 23 conversions totaling $1,247.23 to conversion action
  customers/7754142374/conversionActions/12345678
```

### 4C — Live upload

Once dry-run looks sane:
```bash
node scripts/google-ads-backfill-conversions.mjs --since 2026-01-25
```

Inside ~6 hours, Google Ads → Tools → Conversions → "Diagnostics" tab
shows the offline conversions ingested. Smart Bidding has training
data the moment they appear.

### 4D — Schedule it nightly (after first manual run)

Once the manual backfill works, add to the laptop's launchd schedule
(same pattern as `daily-report.mjs`) so any GCLID-tagged Shopify orders
that come in late get uploaded within 24 hours. That keeps offline
conversions flowing even after Task 1's real-time conversion tag is
firing — the redundancy catches edge cases (mobile App Store conversions,
late-arriving GCLID matches, etc.).

I can wire the launchd plist for this once the manual run validates.

---

## Sequence of operations

1. **Today** — Ben creates the conversion action in the Google Ads UI
   (Task 1A). Sends me the conversion label.
2. **+5 min** — I set the Vercel env var (Task 1B), redeploy.
3. **+1 hour** — Ben validates by completing a test order, watching for
   the conversion event in DevTools (Task 1C).
4. **+24 hours** — Ben confirms the test order shows in Google Ads "All
   conversions". Now the real-time tag is verified.
5. **+1 day** — Ben gets Google Ads developer token + OAuth creds
   (Task 4A).
6. **+1 day** — I help run the dry-run backfill (Task 4B). Once sane,
   live upload (Task 4C). 90 days of historical conversions land in
   Google Ads.
7. **+1 day** — Build the Phase 1 Search campaign per
   `docs/google-ads-bot-proof-spec.md`, paste in the RSA copy from
   Task 2 above for ad group 1 (Dye-Free · Exact Match), set the
   tracking template from Task 3. Set $10/day budget. Launch.
8. **+14 days** — Review. If conversions ≥ 5, expand to ad groups 2-4.
   If ≥ 30, layer in Demand Gen with the round-2 photo creative.
   Performance Max comes after that.

The only blocker right now is the conversion label. Everything else
chains off it.
