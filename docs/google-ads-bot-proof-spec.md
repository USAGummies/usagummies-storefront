# Google Ads — bot-proof "no wasted spend" campaign spec

Paste-through reference for setting up the next test campaign in
`ads.google.com` (account 775-414-2374). Every default below is set
deliberately to keep impressions in front of humans, not link
scanners. The previous $1,678 of spend produced 0 retail orders
because targeting was too broad — Display + Search Partners + Performance
Max + broad-match keywords all draw bot traffic. This spec eliminates
all four.

**Hard rule: leave the campaign PAUSED at the end. Ben publishes
manually after reviewing.**

## Campaign creation walkthrough

Open: `https://ads.google.com/aw/campaigns/new?ocid=7719551641`

### Step 1 — Objective
Select: **Sales**

### Step 2 — Campaign type
Select: **Search**

### Step 3 — Conversion goals
- Use account-default goals: ✓ ON
- Confirm `www.usagummies.com (web) purchase` is in the list (it is — already imported from GA4 earlier today).
- Click **Continue**.

### Step 4 — Campaign name
`Test · Dye-Free Gummies · Standard Search · 2026-04-24`

### Step 5 — Networks
- **Search Network**: ✓ keep on
- **Search Partners**: ☐ **UNCHECK** (this is where most bot traffic comes from)
- **Display Network**: ☐ **UNCHECK** (this too)

### Step 6 — Locations
- **Targeted locations**: United States only
- **Excluded locations**: none for now
- **Location options** → "People in or regularly in your targeted locations" (NOT "interested in" — interested-in catches scrapers/translation bots)

### Step 7 — Languages
- English (only)

### Step 8 — Audience segments
- Skip / leave empty for first test (broad audience matters less than the keyword exact-match lockdown).

### Step 9 — Bidding
- **Focus**: Conversions
- **Set a target CPA**: ☐ leave OFF for first 2 weeks (let Smart Bidding learn before constraining it)
- **Target CPA after learning**: $20 (we'll set this on day 14 if data is sane)

### Step 10 — Budget
- **Daily budget**: **$10.00**
- **Delivery method**: Standard

### Step 11 — Ad group name
`Dye-Free Gummies · Exact Match`

### Step 12 — Default URL
`https://www.usagummies.com/lp/dye-free-gummies?utm_source=google&utm_medium=cpc&utm_campaign=dye-free-test-2026-04-24`

### Step 13 — Keywords (paste directly into the keyword box)

```
[dye free gummy bears]
[made in usa gummy bears]
[gummies no red 40]
[gummy bears no artificial dyes]
[american made gummy bears]
[natural color gummy bears]
[red 40 free candy]
[gummies without dyes]
```

Brackets matter — they enforce exact match. No `+` or `"` markers.

### Step 14 — Negative keywords (Tools → Shared library → Negative keyword lists → New list named "USAG-Master-Negatives" → paste, then attach to this campaign)

```
free
lyrics
song
recipe
near me
walmart
target
amazon
costco
kratom
cbd
thc
weed
melatonin
vitamin
diet
keto
vegan
halal
kosher
sugar free
sour
chewy
organic
calories
nutrition
side effects
review
dollar tree
trader joe
whole foods
buy bulk
distributor
jobs
dispensary
edibles
gummy worm
gummy ring
sour patch
haribo
trolli
bear hunter
candy crush
```

### Step 15 — Responsive Search Ads (build 3 RSAs)

For each, the headline and description columns below are **only** the bag claims — verified copy.

**RSA #1 — "Made in U.S.A."**

Headlines (paste each on its own line, max 30 chars per headline):
```
USA Gummies
All American Gummy Bears
Made in the U.S.A.
No Artificial Dyes
Five Natural Flavors
Dye-Free Gummy Bears
Sourced & Made in America
30-Day Money-Back Guarantee
Cherry · Lemon · Apple
Orange · Watermelon
7.5 oz Resealable Bag
Real Gummy Bears
```

Descriptions (paste each, max 90 chars per):
```
Real gummy bears, made in the U.S.A. Five natural flavors. No artificial dyes.
Sourced, made, and packed in America. 30-day satisfaction guarantee. Ships fast.
```

Final URL: same as the Default URL above.
Display path: `dye-free-gummies` / `made-in-usa`

**RSA #2 — "No Red 40"**

Headlines:
```
No Red 40, Ever.
Dye-Free Gummy Bears
Real Fruit & Veg Color
Made in America
Five Natural Flavors
USA Gummies
All-Natural Color
No Artificial Dyes
Cherry · Lemon · Apple
Orange · Watermelon
30-Day Guarantee
Free Shipping on 5+
```

Descriptions:
```
Five natural flavors. Colored by fruit, vegetables, spirulina, and curcumin.
Made in the U.S.A. 30-day satisfaction guarantee. Free shipping on 5 bags or more.
```

Display path: `dye-free` / `no-red-40`

**RSA #3 — Bag-claim restatement**

Headlines:
```
The American Gummy Bear
Made in the U.S.A.
Real Gummy Bear Flavor
No Artificial Dyes
Cherry · Lemon · Apple
Orange · Watermelon
7.5 oz Bag · $5.99
Five Natural Flavors
Sourced & Made in America
American Jobs · American Business
Land of the Free, Home of the Brave
30-Day Money Back
```

Descriptions:
```
USA Gummies. Sourced, made, and packed right here in the U.S.A. Five flavors.
Try a 7.5 oz bag for $5.99. 30-day satisfaction guarantee. Ships fast.
```

Display path: `usa-gummies` / `try-a-bag`

### Step 16 — Review + Save (do NOT publish)

- At the final review screen, click **"Save as draft"** if available.
  If not, click **Publish** but **immediately go back into Campaigns
  → toggle status to Paused** before any auctions run.
- Confirm the campaign status reads `Paused` and `Total today: $0.00`.

## Why each setting

| Setting | Why |
|---|---|
| Search only, partners off, display off | Search Partners + Display deliver the majority of bot/scanner impressions. Eliminating them is the single biggest "no wasted spend" lever. |
| Exact-match keywords only | Broad and phrase match attract translation services, content scrapers, and typosquatters. Exact match keeps queries to the literal commercial-intent strings. |
| 8 keywords (not 80) | Smaller keyword set = faster Smart Bidding learning + clearer signal of which terms convert. We add more after we have purchase data. |
| 40+ negatives, including big retailer names | Anyone searching "gummy bears walmart" wants Walmart, not us. Cuts off non-buyer queries early. |
| GA4 `purchase` as conversion goal | Wired today via the Google Ads tag activation. Smart Bidding finally has a real signal to optimize against. |
| `/lp/dye-free-gummies` as destination | Verified-copy LP we built and just shipped — different from `/` which has no conversion design. |
| $10/day cap | Hard ceiling. We can scale if it works; we lose at most $70/week if it doesn't. |
| Paused at end | Ben reviews, edits, manually publishes when ready. No accidental burn. |

## Day-7 review checkpoint

After the campaign has been live 7 days:
- If ≥1 ATC event in GA4 from `utm_source=google` paid sessions → keep running, raise to $20/day, add 4 more keywords.
- If 0 ATC at $70 spent → **pause the campaign, do not relaunch**. The problem is upstream of ads (offer / product-market-fit / LP) and more spend is wasted.

## What gets revisited at day 30

- Add Conversion Value rules to upweight high-AOV bundle purchases.
- Layer in a remarketing audience from the Clarity-recorded site visitors (the AW-7754142374 tag is now collecting them automatically).
- Test a 4th RSA variant only if RSA #1–3 are spending out within budget.
