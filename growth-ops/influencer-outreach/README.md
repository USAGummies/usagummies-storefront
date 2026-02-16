# USA Gummies -- Micro-Influencer Outreach System

A guerrilla marketing toolkit for identifying, contacting, and managing relationships with micro-influencers (1K-50K followers) who can authentically promote USA Gummies in exchange for free product.

**The Strategy:** Send free product (~$6-30 per shipment) to 200+ micro-influencers across target niches. If even 20% post, that's 40+ pieces of organic content flooding social media simultaneously, which algorithms interpret as organic virality.

## Quick Start

```bash
# 1. Discover influencers
node discover.mjs --dry-run                    # preview what will be searched
node discover.mjs                              # run discovery (all platforms)
node discover.mjs --platform instagram         # single platform
node discover.mjs --niche americanMade         # single niche group

# 2. Generate outreach messages
node generate-outreach.mjs --preview           # preview messages
node generate-outreach.mjs --best-fit          # auto-pick best template per influencer
node generate-outreach.mjs --all-variations    # see all 4 template options

# 3. Manage the pipeline
node crm.mjs stats                             # pipeline overview
node crm.mjs list                              # list all influencers
node crm.mjs serve                             # launch web dashboard at localhost:3456

# 4. Check for due follow-ups
node followup.mjs                              # show what's overdue

# 5. Ship product
node shipping.mjs list-ready                   # who's ready to ship?
node shipping.mjs ship <id> --tracking "1Z..." # generate label + update CRM

# 6. Track results
node results.mjs                               # full ROI report
node results.mjs --export                      # save markdown report
```

## Target Niches

| Niche | Hashtags |
|-------|----------|
| American Made | #MadeInUSA, #AmericanMade, #BuyAmerican, #MadeInAmerica |
| Clean Eating | #CleanEating, #DyeFree, #NaturalFood, #NoArtificialDyes |
| Candy/Food Review | #GummyBears, #CandyReview, #SnackReview, #FoodReview |
| Mom Life | #MomLife, #CrunchyMom, #MomBlogger, #HealthyKids |
| Fitness | #FitLife, #HealthySnacks, #GymSnacks, #MacroFriendly |
| Patriotic/Military | #Patriotic, #MilitaryLife, #VeteranOwned, #AmericaFirst |
| Homesteading | #HomesteadLife, #Prepper, #SelfSufficient |

## Tools Reference

### discover.mjs -- Influencer Discovery

Searches Instagram, TikTok, and YouTube for micro-influencers posting with target hashtags.

```bash
node discover.mjs                              # all platforms, all hashtags
node discover.mjs --platform instagram         # Instagram only
node discover.mjs --platform tiktok            # TikTok only
node discover.mjs --platform youtube           # YouTube only (needs API key)
node discover.mjs --hashtag MadeInUSA          # single hashtag
node discover.mjs --niche americanMade         # all hashtags in a niche group
node discover.mjs --dry-run                    # show what would be searched
```

**YouTube API Key:** Set `YOUTUBE_API_KEY` environment variable or update `config.mjs`. Free tier allows 10K queries/day. Get a key at https://console.cloud.google.com/apis/credentials

**Filters** (configured in `config.mjs`):
- 1K-50K followers
- 2%+ engagement rate
- Posted within last 30 days
- English language, U.S. based (best effort)

### generate-outreach.mjs -- Message Generator

Generates personalized DM/email templates using four approaches:

| Template | Best For | Tone |
|----------|----------|------|
| `fan_first` | Mom bloggers, lifestyle | Personal, complimentary |
| `mission_alignment` | Patriotic, clean eating | Values-driven |
| `collaboration` | Fitness, food review | Casual, low-pressure |
| `exclusive_vip` | Higher follower counts, candy reviewers | Exclusive, flattering |

```bash
node generate-outreach.mjs --preview           # show messages, don't save
node generate-outreach.mjs --best-fit          # auto-select template per niche
node generate-outreach.mjs --template fan_first # use specific template
node generate-outreach.mjs --all-variations    # show all 4 for each influencer
node generate-outreach.mjs --id <uuid>         # single influencer
node generate-outreach.mjs --niche mom-life    # filter by niche
node generate-outreach.mjs --platform tiktok   # filter by platform
```

### crm.mjs -- Pipeline Manager

Full CLI for managing the influencer database.

```bash
# List & search
node crm.mjs list                              # list all
node crm.mjs list --stage contacted            # filter by stage
node crm.mjs list --platform instagram         # filter by platform
node crm.mjs list --niche fitness              # filter by niche
node crm.mjs list --search "keyword"           # search usernames, bios, notes

# Add manually
node crm.mjs add --username janedoe --platform instagram \
  --followers 5000 --email jane@email.com --niche mom-life

# Update fields
node crm.mjs update <id> --stage contacted
node crm.mjs update <id> --note "Sent DM on Instagram"
node crm.mjs update <id> --email jane@email.com
node crm.mjs update <id> --first-name "Jane"
node crm.mjs update <id> --address "123 Main St, City, ST 12345"
node crm.mjs update <id> --tracking "1Z999AA10123456784"
node crm.mjs update <id> --post-url "https://instagram.com/p/abc123"
node crm.mjs update <id> --ftc-disclosed true

# Log interactions
node crm.mjs log <id> --action "Sent DM" --details "Used fan_first template"

# Analytics & export
node crm.mjs stats                             # pipeline statistics
node crm.mjs export                            # markdown report

# Web dashboard
node crm.mjs serve                             # http://localhost:3456
node crm.mjs serve --port 8080                 # custom port
```

### CRM Dashboard (crm-dashboard.html)

A visual web dashboard served by `node crm.mjs serve`. Features:

- Pipeline view with clickable stage filters
- Influencer cards with profile info and action buttons
- Search and filter by niche, platform, stage
- "Generate Message" button with all 4 template variations
- One-click stage advancement (Mark Contacted -> Responded -> Sent -> Posted)
- Add/edit influencers through the UI
- Real-time stats: response rate, post rate, estimated reach

### followup.mjs -- Follow-Up Sequences

Scans the database and surfaces which follow-ups are overdue.

```bash
node followup.mjs                              # show all due follow-ups
node followup.mjs --stage contacted            # only contacted influencers
node followup.mjs --id <uuid>                  # specific influencer
node followup.mjs --type no_response_nudge     # specific follow-up type
node followup.mjs --execute                    # log follow-ups to database
```

**Follow-up timeline:**
| Trigger | Timing | Message |
|---------|--------|---------|
| No response | 3 days after contact | Gentle nudge |
| Still no response | 7 days after first nudge | Final check-in |
| Positive response | Immediately | Confirm shipping address |
| Product shipped | Immediately | Tracking notification |
| Product delivered | 7 days after shipment | "How'd you like them?" |
| They posted | Immediately | Thank you + ongoing offer |
| No post | 14 days after delivery | Soft follow-up |

### shipping.mjs -- Shipping Manager

Generate labels, packing slips, and track shipments.

```bash
node shipping.mjs list-ready                   # who has an address and is ready?
node shipping.mjs label <id>                   # generate shipping label
node shipping.mjs slip <id>                    # generate packing slip
node shipping.mjs ship <id> --tracking "1Z..." # label + slip + update CRM
node shipping.mjs batch                        # batch labels for all ready
```

### results.mjs -- ROI Tracker

Track campaign performance and return on investment.

```bash
node results.mjs                               # full text report
node results.mjs --format json                 # JSON output
node results.mjs --export                      # save markdown report
node results.mjs --posts                       # list all post URLs
node results.mjs --cost-analysis               # detailed cost breakdown
```

**Key metrics:**
- Response rate, post rate, contact rate
- Estimated impressions (platform-specific reach rates)
- Cost per impression, cost per post, CPM
- FTC compliance tracking
- Breakdown by platform and niche

## Pipeline Stages

```
Discovered -> Contacted -> Responded -> Product Sent -> Posted -> Relationship Active
                  |                                                        |
                  +-> Declined                                             |
                  +-> Unresponsive                                         |
                                                                           +-> (ongoing free product)
```

## Configuration

All settings live in `config.mjs`:

- **BRAND** -- Company info, founder name, social handles
- **PRODUCT_TIERS** -- Sample (1 bag, $6), Standard (2 bags, $12), VIP (5 bags, $30)
- **TARGET_HASHTAGS** -- Grouped by niche for targeted discovery
- **DISCOVERY** -- Follower range, engagement threshold, platforms
- **FOLLOWUP_TIMING** -- Days between each follow-up stage
- **REACH_ESTIMATES** -- Platform-specific reach rate assumptions
- **FTC** -- Required disclosure hashtags, packing slip language

## FTC Compliance

**This is not optional.** The FTC requires influencers to disclose gifted products.

### What you must do:
1. Every packing slip includes FTC disclosure instructions (automated)
2. Tell influencers they must use #gifted, #ad, or similar disclosure
3. Track which influencers properly disclosed (`--ftc-disclosed true/false`)
4. Follow up with influencers who post without disclosure

### Suggested disclosure language for influencers:
- "#gifted" or "#ad" in the caption
- "USA Gummies sent me this to try" (spoken in video)
- "Thanks to @usagummies for the free sample" (written)

### What NOT to do:
- Never tell influencers what to say (beyond disclosure)
- Never require a positive review
- Never make posting a condition of receiving product
- Never script their content

## Best Practices for DM Outreach

1. **Personalize every message.** Reference a specific post or aspect of their content
2. **Keep it under 150 words.** Shorter messages get higher response rates
3. **Send from a real account.** Use the brand Instagram, not a burner
4. **DM at the right time.** Tuesday-Thursday, 10am-2pm in their timezone
5. **Don't mass-DM.** Send 10-20 per day max to avoid platform flags
6. **Follow them first.** Like a few posts before DMing
7. **No follow-up within 3 days.** People are busy
8. **Accept "no" gracefully.** Never argue or guilt-trip
9. **Track everything.** Use the CRM to log every interaction
10. **Ship fast.** Once they say yes, ship within 24 hours

## File Structure

```
growth-ops/influencer-outreach/
├── config.mjs                    # all configuration
├── discover.mjs                  # influencer discovery script
├── generate-outreach.mjs         # outreach message generator
├── followup.mjs                  # follow-up sequence generator
├── shipping.mjs                  # shipping label/slip generator
├── results.mjs                   # ROI tracker
├── crm.mjs                      # CRM CLI + API server
├── crm-dashboard.html            # web dashboard UI
├── README.md                     # this file
├── data/
│   ├── .gitkeep
│   ├── influencers.json          # influencer database
│   └── interactions.json         # interaction logs
└── templates/
    ├── outreach-templates.mjs    # 4 outreach template variations
    └── followup-templates.mjs    # 8 follow-up message templates
```

## Setup Checklist

- [ ] Fill in `BRAND.shippingFrom` address in `config.mjs`
- [ ] Set `YOUTUBE_API_KEY` environment variable (optional, for YouTube discovery)
- [ ] Run `node discover.mjs --dry-run` to verify hashtag list
- [ ] Run `node discover.mjs` to populate initial database
- [ ] Open `node crm.mjs serve` and review discovered influencers
- [ ] Generate outreach with `node generate-outreach.mjs --best-fit --preview`
- [ ] Start sending DMs (10-20/day, personalize each one)
- [ ] Check `node followup.mjs` daily for overdue follow-ups
- [ ] Run `node results.mjs` weekly to track campaign ROI
