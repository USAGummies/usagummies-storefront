# USA Gummies — Nuclear Build Outlines

> 6 systems. Each one a standalone engine. Together they make USA Gummies run like a $10M company on autopilot.
> All systems share the same architecture pattern as the existing B2B Sales Engine (`usa-gummies-agentic.mjs`).

---

## SYSTEM ARCHITECTURE PATTERN (shared by all 5)

Every system follows the same proven pattern from the existing B2B engine:

```
┌─────────────────────────────────────────────────────┐
│  Single ESM file (Node.js)                          │
│  ├── Constants & Policies (send limits, thresholds) │
│  ├── Notion DB IDs & Schemas                        │
│  ├── Agent Functions (async, self-contained)        │
│  ├── Shared Utilities (logging, Notion API, etc.)   │
│  ├── Self-Heal Monitor                              │
│  └── CLI entrypoint (run-agent, status, etc.)       │
├─────────────────────────────────────────────────────┤
│  Cron installer (.sh)                               │
│  ├── CRON_TZ=America/New_York                       │
│  ├── Marker-based install (>>> MARKER >>>)          │
│  └── Agent schedule entries                         │
├─────────────────────────────────────────────────────┤
│  Dashboard API route (Next.js /api/...)             │
│  ├── GET → status, KPIs, agent health               │
│  └── POST → operator actions                        │
├─────────────────────────────────────────────────────┤
│  Dashboard UI (React client component)              │
│  ├── Auto-refresh (5s interval)                     │
│  ├── KPI panels, agent status, event log            │
│  └── Operator controls (approve/deny/override)      │
├─────────────────────────────────────────────────────┤
│  State files (~/.config/usa-gummies-mcp/)           │
│  ├── {system}-status.json                           │
│  ├── {system}-run-ledger.json                       │
│  └── {system}-*.json (system-specific state)        │
└─────────────────────────────────────────────────────┘
```

**Shared infrastructure** (reused across all systems):
- Notion API wrapper (`notionFetch`, `createPageInDb`, `queryDatabaseAll`, etc.)
- himalaya email CLI (`send-email.sh`, `check-email.sh`)
- GA4 service account (`~/.config/usa-gummies-mcp/ga4-service-account.json`)
- Shopify Admin API token (from `.env.local`)
- Amazon SP-API credentials (from `.env-daily-report`)
- iMessage notification via `osascript`
- Logging pattern (`log()` with ET timestamps to consolidated log file)
- Self-heal monitor pattern (lock files, grace periods, auto-restart)
- Human-in-the-loop pattern (attention queues with dashboard approve/deny)

---

## BUILD 1: SELF-HEALING B2B SALES ENGINE V2

### What it does now (22 agents, 5,924 lines)
The existing `usa-gummies-agentic.mjs` handles B2B + distributor prospecting, email outreach, follow-ups, inbox monitoring, deliverability management, and daily reporting. It's the most mature system.

### What V2 adds

**Problem**: The engine researches and sends cold emails, but it doesn't do deal progression, pricing negotiation, order tracking, or re-engagement. Conversations that go past "Replied - Interested" currently need Ben to manually handle everything.

**V2 Upgrades** (8 new agent functions added to existing file):

#### New Agents

| # | Agent | What it does | Schedule |
|---|-------|-------------|----------|
| A23 | **Deal Progression Tracker** | Scans Notion B2B + Distributor DBs for "Replied - Interested" rows older than 48h with no follow-up. Drafts contextual nudge emails. Pushes to reply-attention-queue for Ben's approval. | Daily 10:00 AM |
| A24 | **Pricing & Quote Generator** | When Ben marks a prospect as "Quote Requested" in Notion, auto-generates a price sheet PDF (from template) with quantity-based pricing. Attaches to draft email. | Daily 10:30 AM |
| A25 | **Order Fulfillment Bridge** | Monitors Shopify Admin API for new B2B orders. Cross-references with Notion prospect DB. Updates prospect status to "Order Placed", logs order value, sends Ben an iMessage alert. | Daily 11:30 AM |
| A26 | **Win/Loss Analyzer** | Weekly: aggregates all prospects that moved to "Not Interested" or "Bounced" in the past 7 days. Identifies patterns (industry, state, email domain). Writes analysis to Notion Daily Reports. | Weekly Mon 6:00 PM |
| A27 | **Re-engagement Campaigner** | Queries Notion for prospects in "Not Interested" older than 60 days. Drafts a softer re-engagement email (new template). Max 5/day. Pushes to attention queue. | Daily 2:00 PM |
| A28 | **Faire Order Monitor** | Polls Faire API (or scrapes Faire dashboard via saved session) for new wholesale orders. Creates Notion entries. Alerts Ben via iMessage. | Daily 9:30 AM |
| A29 | **Template A/B Rotator** | Tracks open rates per template variant (via bounce/reply ratios). Automatically rotates to higher-performing template. Logs rotation events. | Weekly Sun 7:00 PM |
| A30 | **Contact Enrichment Agent** | For prospects with email but no phone, attempts to find phone numbers via web search. Updates Notion records. Max 20/run. | Daily 12:00 PM |

#### New Notion DB Fields
- **B2B Prospects**: `Quote Sent` (checkbox), `Quote Amount` (number), `Order Value` (number), `Order Date` (date), `Shopify Order ID` (text), `Re-engagement Count` (number), `Template Variant` (select), `Last Template Used` (text)
- **Distributor Prospects**: `Quote Sent` (checkbox), `Contract Value` (number), `Faire Order ID` (text)

#### New Email Templates
- `b2bNudge` — soft follow-up for interested prospects going quiet
- `b2bReengagement` — "checking back in" for cold prospects after 60 days
- `b2bQuoteAttached` — formal quote delivery
- `distributorNudge` — distributor-specific nudge

#### New State Files
- `~/.config/usa-gummies-mcp/agentic-quotes-pending.json`
- `~/.config/usa-gummies-mcp/agentic-reengagement-log.json`
- `~/.config/usa-gummies-mcp/agentic-template-performance.json`
- `~/.config/usa-gummies-mcp/agentic-faire-orders.json`

#### New Cron Entries (added to existing installer)
```
0 10 * * *  ... run-agent agent23
30 10 * * * ... run-agent agent24
30 11 * * * ... run-agent agent25
0 12 * * *  ... run-agent agent30 --limit 20
0 14 * * *  ... run-agent agent27 --limit 5
30 9 * * *  ... run-agent agent28
0 18 * * 1  ... run-agent agent26
0 19 * * 0  ... run-agent agent29
```

#### Dashboard Updates
- Add "Deal Pipeline" section to command center showing: prospects by stage, days-in-stage, conversion rate
- Add "Quotes Pending" panel with approve/send controls
- Add "Faire Orders" live feed
- Add template performance chart (which variant wins)

#### File Changes
- **Modify**: `scripts/usa-gummies-agentic.mjs` — add 8 new agent functions (~400-600 lines each = ~3,500-4,000 new lines)
- **Modify**: `scripts/install-usa-gummies-agentic-cron.sh` — add 8 new cron entries
- **Modify**: `src/app/api/agentic/command-center/route.ts` — add deal pipeline KPIs, quote tracking
- **Modify**: `src/components/ops/AgenticCommandCenter.client.tsx` — add deal pipeline UI, quote panel, Faire feed

---

## BUILD 2: UNIFIED REVENUE INTELLIGENCE DASHBOARD

### What it does
A new standalone engine that pulls ALL revenue data (Shopify DTC, Shopify B2B, Amazon, Faire), all traffic data (GA4), all cost data, and produces a single source of truth for the business. Auto-generates investor-ready metrics. Replaces the current `daily-report.mjs` with something 10x more powerful.

### Architecture

**New file**: `scripts/usa-gummies-revenue-intel.mjs`
**New cron installer**: `scripts/install-revenue-intel-cron.sh`
**New dashboard route**: `src/app/api/revenue-intel/route.ts`
**New dashboard UI**: `src/components/ops/RevenueIntelDashboard.client.tsx`
**New dashboard page**: `src/app/revenue-intel/page.tsx`

#### Agents (12 total)

| # | Agent | What it does | Schedule |
|---|-------|-------------|----------|
| R1 | **Shopify DTC Collector** | Pulls today's Shopify orders (DTC only, excludes B2B tags). Computes: revenue, AOV, units sold, discount usage, top products, new vs returning. Writes to Notion Revenue DB. | Daily 9:00 PM |
| R2 | **Shopify B2B Collector** | Pulls B2B-tagged Shopify orders. Computes: wholesale revenue, avg order size, top B2B accounts. Writes to Notion. | Daily 9:05 PM |
| R3 | **Amazon Collector** | SP-API call for today's Amazon orders. Revenue, units, fees, net margin. Writes to Notion. | Daily 9:10 PM |
| R4 | **Faire Collector** | Pulls Faire wholesale orders. Revenue, commission, net. Writes to Notion. | Daily 9:15 PM |
| R5 | **GA4 Traffic Collector** | Pulls GA4 data: sessions, users, sources, top pages, conversions, bounce rate by page. Writes to Notion. | Daily 9:20 PM |
| R6 | **COGS Calculator** | Reads current COGS from Notion config page (cost per bag by variant). Computes gross margin per channel. | Daily 9:25 PM |
| R7 | **Daily Digest Compiler** | Combines R1-R6 into a single daily snapshot. Computes: total revenue (all channels), blended margin, MoM growth, runway estimate. Writes master daily report to Notion. Texts iMessage summary to both phone numbers. | Daily 9:30 PM |
| R8 | **Weekly Trend Analyzer** | Every Sunday: 7-day rolling averages, WoW changes, channel mix shift, cohort analysis (DTC). Writes weekly report to Notion. | Weekly Sun 10:00 PM |
| R9 | **Monthly Investor Snapshot** | 1st of each month: compiles MoM metrics, LTV estimates, CAC by channel, burn rate, months of runway. Formats as investor-ready one-pager. Writes to Notion. | Monthly 1st 10:00 PM |
| R10 | **Anomaly Detector** | Compares today's metrics to 7-day rolling average. Alerts Ben via iMessage if anything is >2 standard deviations off (revenue spike/drop, bounce rate explosion, etc.). | Daily 9:35 PM |
| R11 | **Forecast Engine** | Linear regression on last 30 days of revenue. Projects next 7/30/90 day revenue. Writes forecast to Notion. | Weekly Sun 10:30 PM |
| R12 | **Self-Heal Monitor** | Same pattern as B2B: checks agent freshness, restarts stale agents. | Every 30 min |

#### New Notion Databases
1. **Revenue Daily Snapshots** — one row per day with all channel revenue, margins, traffic
   - Fields: Date, Shopify DTC Revenue, Shopify B2B Revenue, Amazon Revenue, Faire Revenue, Total Revenue, COGS, Gross Margin, Gross Margin %, GA4 Sessions, GA4 Users, Conversion Rate, AOV, New Customers, Returning Customers
2. **Revenue Weekly Reports** — one row per week with trends
3. **Revenue Monthly Reports** — investor-ready monthly snapshots
4. **Revenue Config** — COGS per variant, target margins, runway assumptions

#### New State Files
- `~/.config/usa-gummies-mcp/revenue-intel-status.json`
- `~/.config/usa-gummies-mcp/revenue-intel-run-ledger.json`
- `~/.config/usa-gummies-mcp/revenue-intel-daily-cache.json`

#### Dashboard UI Sections
- **Today's Numbers**: Total revenue (all channels), margin, sessions, conversion rate — big hero numbers
- **Channel Breakdown**: Shopify DTC / B2B / Amazon / Faire — bar chart comparison
- **7-Day Trend**: Sparkline chart of daily revenue
- **Anomaly Alerts**: Red flags for unusual metrics
- **Forecast**: Projected revenue for next 7/30/90 days
- **Agent Status Board**: Same pattern as B2B command center
- **Investor View**: Toggle to show investor-friendly metrics (MRR, growth rate, LTV, CAC)

#### Integration with Existing Systems
- **Replaces**: `scripts/daily-report.mjs` (the old 9pm iMessage summary)
- **Feeds from**: Shopify Admin API, Amazon SP-API, GA4 Data API, Faire API
- **Feeds into**: B2B Sales Engine (revenue targets influence send quotas via KPI Governor)

---

## BUILD 3: DTC RETENTION & LIFETIME VALUE ENGINE

### What it does
Turns one-time DTC buyers into repeat customers. Manages post-purchase email sequences, review solicitation, referral program automation, churn prediction, and reorder reminders. This is the system that makes DTC revenue compound instead of being one-shot.

### Architecture

**New file**: `scripts/usa-gummies-dtc-engine.mjs`
**New cron installer**: `scripts/install-dtc-engine-cron.sh`
**New dashboard route**: `src/app/api/dtc-engine/route.ts`
**New dashboard UI**: `src/components/ops/DtcEngineDashboard.client.tsx`
**New dashboard page**: `src/app/dtc-engine/page.tsx`

#### Agents (10 total)

| # | Agent | What it does | Schedule |
|---|-------|-------------|----------|
| D1 | **New Customer Ingestor** | Polls Shopify Admin for orders in last 24h. For each new customer (first order), creates entry in DTC Customers DB with: name, email, order date, products, total, source. | Daily 8:00 AM |
| D2 | **Post-Purchase Sequence Manager** | For each customer in the DB, manages a drip sequence: Day 3 (delivery check-in), Day 7 (review request), Day 14 (referral offer), Day 30 (reorder reminder). Drafts emails and pushes to attention queue. Max 20 sends/day. | Daily 9:00 AM |
| D3 | **Review Solicitor** | Day 7 after delivery: sends review request email with direct link to review form. Tracks which customers have been asked, which submitted reviews. Links to existing `/api/review-reward/route.ts`. | Part of D2 sequence |
| D4 | **Referral Program Manager** | Day 14: sends referral link (unique per customer using Shopify discount code). Tracks referral codes created, referrals redeemed, revenue from referrals. | Part of D2 sequence |
| D5 | **Reorder Predictor** | Based on product type and purchase history, predicts when a customer is likely to reorder (gummy consumption rate ~30 days for a 5-pack). Sends reorder reminder 3 days before predicted reorder date. | Daily 10:00 AM |
| D6 | **Churn Risk Scorer** | For customers past their predicted reorder window (>45 days since last order, no reorder), flags as "at risk". Drafts win-back email with small discount. Max 10/day. | Daily 11:00 AM |
| D7 | **Loyalty Tier Calculator** | Computes customer LTV and assigns tiers: Bronze (1 order), Silver (2-3 orders, $50+), Gold (4+ orders, $150+). Updates Notion. Gold customers get birthday emails and early access to new products. | Weekly Mon 7:00 AM |
| D8 | **Email Deliverability Guard** | Same pattern as B2B: tracks bounces per domain, auto-blocks problematic domains. Shared with B2B engine's deliverability guard. | Daily 6:00 PM |
| D9 | **DTC Daily Report** | Compiles: emails sent today, open/bounce rates, reviews collected, referrals created, reorders triggered, churn saves. Writes to Notion. | Daily 7:00 PM |
| D10 | **Self-Heal Monitor** | Standard self-heal pattern. | Every 30 min |

#### New Notion Databases
1. **DTC Customers** — one row per customer
   - Fields: Name, Email, First Order Date, Last Order Date, Total Orders, Total Revenue (LTV), Products Purchased (multi-select), Loyalty Tier (select: Bronze/Silver/Gold), Referral Code, Referrals Made, Sequence Stage (select: Day 3/Day 7/Day 14/Day 30/Complete), Last Email Sent, Churn Risk (select: Low/Medium/High), Predicted Reorder Date, Source (how they found us)
2. **DTC Email Log** — one row per email sent
   - Fields: Customer, Email Type (select: delivery-checkin/review-request/referral/reorder/winback), Sent Date, Bounced, Status
3. **DTC Reviews** — one row per review (links to existing review system)
4. **DTC Referrals** — tracks referral codes and redemptions

#### New Email Templates
- `dtcDeliveryCheckin` — "Your gummies should have arrived! How are they?"
- `dtcReviewRequest` — "Love your gummies? Leave a review and get 10% off next order"
- `dtcReferralOffer` — "Share with a friend, you both get $5 off"
- `dtcReorderReminder` — "Running low? Reorder your favorites"
- `dtcWinback` — "We miss you! Here's 15% off to come back"
- `dtcBirthdayGold` — Gold tier birthday email

#### New State Files
- `~/.config/usa-gummies-mcp/dtc-engine-status.json`
- `~/.config/usa-gummies-mcp/dtc-engine-run-ledger.json`
- `~/.config/usa-gummies-mcp/dtc-customer-sequences.json` (tracks where each customer is in drip sequence)
- `~/.config/usa-gummies-mcp/dtc-referral-codes.json`

#### Integration with Existing Systems
- **Reads from**: Shopify Admin API (orders, customers)
- **Writes to**: Shopify Admin API (create discount codes for referrals/win-back)
- **Links to**: Revenue Intel engine (DTC retention metrics feed into daily/weekly reports)
- **Links to**: existing `/api/review-reward/route.ts` (review reward processing)

---

## BUILD 4: SEO CONTENT DOMINATION SYSTEM

### What it does
Automates the entire content pipeline: keyword research, content gap analysis, blog post drafting, internal link optimization, and performance tracking. The goal is to turn the organic search channel (which doubled last week) into the #1 traffic source within 90 days.

### Architecture

**New file**: `scripts/usa-gummies-seo-engine.mjs`
**New cron installer**: `scripts/install-seo-engine-cron.sh`
**New dashboard route**: `src/app/api/seo-engine/route.ts`
**New dashboard UI**: `src/components/ops/SeoEngineDashboard.client.tsx`
**New dashboard page**: `src/app/seo-engine/page.tsx`

#### Agents (9 total)

| # | Agent | What it does | Schedule |
|---|-------|-------------|----------|
| S1 | **Keyword Opportunity Scanner** | Queries GA4 for search queries driving traffic. Cross-references with existing blog posts. Identifies gaps: queries with impressions but no dedicated content. Writes opportunities to Notion. | Weekly Mon 7:00 AM |
| S2 | **Content Gap Analyzer** | Scrapes Google SERP (via web search) for target keywords. Analyzes what's ranking. Identifies content angles we're missing. Writes competitor content analysis to Notion. | Weekly Tue 7:00 AM |
| S3 | **Blog Post Drafter** | For the top keyword opportunity, generates a full MDX blog post draft. Uses the existing blog format (frontmatter, MDX, etc.). Writes draft to Notion for Ben's review. Does NOT auto-publish. | Weekly Wed 7:00 AM |
| S4 | **Internal Link Optimizer** | Scans all existing blog posts. Identifies opportunities to add internal links between related posts. Writes link suggestions to Notion. Can auto-apply links to MDX files with Ben's approval (via attention queue). | Weekly Thu 7:00 AM |
| S5 | **Blog Performance Tracker** | Pulls GA4 data for each blog post: sessions, bounce rate, avg time, conversions to /shop. Ranks posts by performance. Identifies underperformers for optimization. Writes to Notion. | Daily 8:00 PM |
| S6 | **Featured Snippet Optimizer** | For posts ranking in positions 2-10, analyzes what's needed to capture featured snippets (FAQ schema, direct answer format, etc.). Writes optimization suggestions to Notion. | Weekly Fri 7:00 AM |
| S7 | **Sitemap & Schema Validator** | Crawls the live sitemap.xml. Verifies all blog posts are indexed. Checks JSON-LD schema on key pages. Reports issues to Notion. | Weekly Sat 7:00 AM |
| S8 | **Content Calendar Manager** | Maintains a 30-day content calendar in Notion. Auto-schedules posts based on: seasonal relevance (Easter, Halloween, etc.), keyword opportunity scores, content gaps. | Weekly Sun 7:00 AM |
| S9 | **Self-Heal Monitor** | Standard pattern. | Every 30 min |

#### New Notion Databases
1. **SEO Keywords** — one row per target keyword
   - Fields: Keyword, Monthly Search Volume (est), Current Rank, Has Blog Post (checkbox), Blog Post URL, Content Gap Score, Priority (select), Last Checked
2. **SEO Content Calendar** — editorial calendar
   - Fields: Title, Target Keyword, Publish Date, Status (select: Idea/Drafted/Reviewed/Published), MDX Slug, Author, Word Count
3. **SEO Blog Performance** — daily metrics per post
   - Fields: Blog Post, Date, Sessions, Bounce Rate, Avg Time, Shop Conversions, Organic Sessions
4. **SEO Link Suggestions** — internal linking opportunities
   - Fields: Source Post, Target Post, Anchor Text, Applied (checkbox), Approved By

#### New State Files
- `~/.config/usa-gummies-mcp/seo-engine-status.json`
- `~/.config/usa-gummies-mcp/seo-engine-run-ledger.json`
- `~/.config/usa-gummies-mcp/seo-keyword-cache.json`
- `~/.config/usa-gummies-mcp/seo-serp-cache.json`

#### Integration with Existing Systems
- **Reads from**: GA4 Data API (search queries, page performance)
- **Reads from**: Existing blog MDX files in `content/blog/`
- **Writes to**: Notion (all content planning)
- **Writes to**: `content/blog/` (only with Ben's approval via attention queue, using `add-blog-post.sh`)
- **Links to**: Revenue Intel (organic traffic → conversion attribution)

#### Attention Queue Items (human-in-the-loop)
- Blog post drafts → Ben reviews in Notion, approves for publish
- Internal link changes → Ben sees diff, approves/rejects
- Content calendar changes → Ben reviews upcoming schedule

---

## BUILD 5: SUPPLY CHAIN & PRODUCTION ORCHESTRATOR

### What it does
Manages inventory levels, production scheduling, supplier relationships, and fulfillment logistics. Predicts when to reorder raw materials, when to schedule production runs, and when inventory will run out based on sales velocity.

### Architecture

**New file**: `scripts/usa-gummies-supply-chain.mjs`
**New cron installer**: `scripts/install-supply-chain-cron.sh`
**New dashboard route**: `src/app/api/supply-chain/route.ts`
**New dashboard UI**: `src/components/ops/SupplyChainDashboard.client.tsx`
**New dashboard page**: `src/app/supply-chain/page.tsx`

#### Agents (8 total)

| # | Agent | What it does | Schedule |
|---|-------|-------------|----------|
| SC1 | **Inventory Level Monitor** | Reads Shopify inventory levels via Admin API. For each variant (5-pack, party pack, etc.), computes: current stock, daily burn rate (7-day rolling avg), days of inventory remaining. Writes to Notion. Alerts Ben via iMessage if any SKU <14 days remaining. | Daily 7:00 AM |
| SC2 | **Sales Velocity Calculator** | Computes per-SKU sales velocity: units/day (7d, 30d, 90d averages). Detects acceleration/deceleration trends. Factors in seasonality (holiday bumps). Writes to Notion. | Daily 7:15 AM |
| SC3 | **Reorder Point Calculator** | For each raw material/packaging item (tracked in Notion), computes: reorder point based on lead time + safety stock. Fires alert when current stock crosses reorder point. | Daily 7:30 AM |
| SC4 | **Production Scheduler** | Based on inventory levels and sales velocity, recommends next production run date and quantity. Factors in: production lead time (currently ~3 weeks via co-packer), minimum order quantity, shelf life. Writes schedule to Notion. | Weekly Mon 7:00 AM |
| SC5 | **Supplier Price Tracker** | Maintains a database of supplier quotes for key inputs (gelatin, citric acid, natural colors, packaging). Alerts when it's time to re-quote (every 90 days). | Monthly 1st 8:00 AM |
| SC6 | **Fulfillment Monitor** | Tracks Shopify fulfillment status. Identifies orders unfulfilled >48h. Alerts Ben. Computes: avg fulfillment time, shipping cost per order. | Daily 12:00 PM |
| SC7 | **Amazon FBA Inventory Sync** | Checks Amazon FBA inventory levels via SP-API. Cross-references with Shopify. Alerts if FBA stock needs replenishment. | Daily 1:00 PM |
| SC8 | **Self-Heal Monitor** | Standard pattern. | Every 30 min |

#### New Notion Databases
1. **Inventory Tracker** — one row per SKU
   - Fields: SKU, Product Name, Variant, Current Stock, Daily Burn Rate (7d), Days Remaining, Reorder Point, Last Updated, Channel (Shopify/Amazon/Faire)
2. **Raw Materials** — one row per ingredient/packaging item
   - Fields: Material Name, Current Stock (units), Unit Cost, Supplier, Lead Time (days), Reorder Point, Reorder Quantity, Last Ordered Date
3. **Production Runs** — one row per production batch
   - Fields: Run Date, Products (multi-select), Quantity, Co-Packer, Status (select: Planned/In-Production/Complete/Shipped), Cost, Notes
4. **Supplier Directory** — one row per supplier
   - Fields: Supplier Name, Contact, Materials Supplied, Last Quote Date, Quote Amount, Payment Terms, Lead Time

#### New State Files
- `~/.config/usa-gummies-mcp/supply-chain-status.json`
- `~/.config/usa-gummies-mcp/supply-chain-run-ledger.json`
- `~/.config/usa-gummies-mcp/inventory-snapshot.json`
- `~/.config/usa-gummies-mcp/sales-velocity-cache.json`

#### Dashboard UI Sections
- **Inventory Health**: Traffic-light view — Green (>30 days), Yellow (14-30 days), Red (<14 days)
- **Sales Velocity**: Per-SKU burn rate with trend arrows
- **Production Calendar**: Upcoming and past production runs
- **Reorder Alerts**: Active alerts for materials crossing reorder point
- **Fulfillment Status**: Orders pending, avg ship time
- **Amazon FBA**: FBA inventory levels and replenishment status
- **Agent Status Board**: Standard pattern

#### Integration with Existing Systems
- **Reads from**: Shopify Admin API (inventory, orders, fulfillments)
- **Reads from**: Amazon SP-API (FBA inventory levels)
- **Links to**: Revenue Intel (sales velocity feeds into revenue forecasts)
- **Links to**: B2B Sales Engine (wholesale order volumes affect inventory predictions)

---

## BUILD 6: FINANCIAL OPERATIONS ENGINE (Found.com + Invoice Reconciliation)

### What it does
The money brain. Pulls actual banking data from Found.com, matches every dollar in and out to a sales order or expense, reconciles invoices from Gmail, allocates costs to production runs, and keeps the books balanced. Without this, you have revenue dashboards but no idea if you're actually profitable or where the cash is going.

### The Found.com Challenge

Found.com is a fintech banking platform (banking by Lead Bank, FDIC). They do **NOT** have a public developer API. Here are the 3 data ingestion paths, in order of recommendation:

**Path A — CSV Pipeline (Day 1, free)**
- Found lets you export all transactions as CSV from the Activity tab on desktop
- Export goes to your email (marketing@usagummies.com)
- Our agent monitors Gmail for Found CSV exports → auto-parses → imports to Notion
- Ben triggers export weekly (or daily) from Found's web dashboard — takes 10 seconds
- CSV contains: date, description, amount, category

**Path B — Plaid API (Phase 2, $$$)**
- Found uses Plaid under the hood for bank linking
- We register for Plaid developer account → connect Found account via Plaid Link
- Plaid Transactions API pulls transactions programmatically (Node.js SDK)
- Cost: Plaid charges per connection (~$2.50/month per linked account in production)
- Benefit: fully automated, real-time, no manual CSV exports

**Path C — Browser Automation (fallback)**
- Playwright/Puppeteer script logs into Found web dashboard
- Navigates to Activity → triggers CSV export → downloads → parses
- Fragile (breaks when Found changes UI) but free and automatic

**Recommendation**: Start with Path A (CSV pipeline). It's zero cost, works today, and the agent handles all the parsing. Graduate to Path B (Plaid) when the volume of transactions justifies the Plaid subscription.

### Architecture

**New file**: `scripts/usa-gummies-finops.mjs`
**New cron installer**: `scripts/install-finops-cron.sh`
**New dashboard route**: `src/app/api/finops/route.ts`
**New dashboard UI**: `src/components/ops/FinOpsDashboard.client.tsx`
**New dashboard page**: `src/app/finops/page.tsx`
**New helper**: `scripts/lib/found-csv-parser.mjs` (parses Found.com CSV format)
**New helper**: `scripts/lib/invoice-extractor.mjs` (extracts invoice data from emails)

#### Agents (11 total)

| # | Agent | What it does | Schedule |
|---|-------|-------------|----------|
| F1 | **Found Transaction Ingestor** | Scans Gmail for Found CSV exports (subject line pattern: "Your Found export is ready" or similar). Downloads CSV attachment, parses transactions, deduplicates against existing records, writes to Notion Transactions DB. Falls back to manual CSV upload if no email found. | Daily 7:00 AM |
| F2 | **Invoice Scanner** | Scans Gmail for invoice/receipt emails. Pattern-matches known senders: Lowe Graham Jones (legal), co-packer invoices (Account# 65107 from Jenna Werner/Bill Yoder/Ira VanOrder), Joe Gagliardi (packaging/film), Shopify (balance statements), CompanySage (compliance), Fillings & Emulsions (Square), shipping labels (USPS/FedEx/UPS). Extracts: amount, vendor, date, invoice #. Writes to Notion Invoices DB. | Daily 7:15 AM |
| F3 | **Revenue Reconciler** | Matches bank deposits to sales channel payouts: Shopify payouts → Found deposits, Amazon disbursements → Found deposits, Faire payouts → Found deposits. Flags unmatched deposits for Ben's review. Computes: reconciliation rate (% of deposits matched). | Daily 7:30 AM |
| F4 | **Expense Categorizer** | For each Found withdrawal/debit not yet categorized: auto-categorizes based on vendor name matching (known vendors from Supplier Directory). Categories: Production/Ingredients, Packaging, Shipping, Legal, Marketing, Software/SaaS, Tax, Other. Writes category to Notion. Pushes unknowns to attention queue for Ben. | Daily 7:45 AM |
| F5 | **Production Cost Allocator** | Links expenses to specific production runs (from Build 5 Supply Chain). When a co-packer invoice or ingredient purchase is detected, allocates cost to the production run it belongs to (by date/PO#). Computes: cost per unit, cost per bag, margin per SKU. | Daily 8:00 AM (after F4) |
| F6 | **Accounts Payable Tracker** | Maintains list of outstanding invoices (unpaid). Matches invoice amounts to Found withdrawals. When a payment matches an invoice, marks as paid. Alerts Ben for invoices overdue >30 days. | Daily 10:00 AM |
| F7 | **Accounts Receivable Tracker** | Tracks expected incoming payments: Shopify payout schedule (every 2-3 business days), Amazon disbursements (bi-weekly), Faire payouts, B2B invoice payments. Matches to Found deposits when they arrive. Alerts on late payments. | Daily 10:15 AM |
| F8 | **Cash Flow Calculator** | Computes: current bank balance (from latest Found data), expected inflows (AR), expected outflows (AP + upcoming production costs), projected balance 7/14/30 days out. Alerts if projected balance drops below safety threshold ($5,000). | Daily 11:00 AM |
| F9 | **P&L Generator** | Weekly: compiles Profit & Loss statement from all categorized transactions. Revenue (by channel) - COGS - Operating Expenses = Net Income. Writes to Notion. Compares to previous week. | Weekly Sun 8:00 PM |
| F10 | **Tax Reserve Calculator** | Based on revenue and expense data, estimates quarterly tax liability. Auto-reserves suggested amount. Tracks actual vs estimated. Alerts 30 days before quarterly tax deadlines. | Monthly 1st 9:00 AM |
| F11 | **Self-Heal Monitor** | Standard pattern. | Every 30 min |

#### New Notion Databases
1. **Bank Transactions** — one row per Found.com transaction
   - Fields: Date, Description, Amount, Type (select: Deposit/Withdrawal/Transfer), Category (select: Revenue-Shopify/Revenue-Amazon/Revenue-Faire/Revenue-B2B/Production/Packaging/Shipping/Legal/Marketing/SaaS/Tax/Other), Matched To (relation → Invoices or Revenue source), Reconciled (checkbox), Found Export Date, Notes
2. **Invoices** — one row per invoice received
   - Fields: Vendor, Invoice Number, Amount, Date Received, Due Date, Status (select: Received/Approved/Paid/Overdue/Disputed), Paid Date, Payment Amount, Bank Transaction (relation → Bank Transactions), Category, Source Email ID, Production Run (relation → Production Runs from Build 5), Notes
3. **Accounts Payable** — outstanding bills
   - Fields: Vendor, Amount, Due Date, Days Outstanding, Status (select: Pending/Paid/Overdue), Invoice (relation → Invoices), Priority
4. **Accounts Receivable** — expected incoming payments
   - Fields: Source (select: Shopify/Amazon/Faire/B2B-Invoice), Expected Amount, Expected Date, Received (checkbox), Actual Amount, Actual Date, Bank Transaction (relation), Days Late
5. **P&L Reports** — weekly/monthly P&L snapshots
   - Fields: Period, Period Type (select: Weekly/Monthly/Quarterly), Total Revenue, COGS, Gross Profit, Gross Margin %, Operating Expenses (broken down), Net Income, Net Margin %, vs Previous Period %, Notes
6. **Cash Flow Projections** — daily cash position
   - Fields: Date, Opening Balance, Inflows, Outflows, Closing Balance, Projected 7d, Projected 30d, Below Safety Threshold (checkbox)

#### Known Vendor Patterns (for auto-matching)
From your actual inbox, we'll pre-seed these vendor patterns:

| Vendor Pattern | Category | Notes |
|---------------|----------|-------|
| Lowe Graham Jones | Legal | Invoice # pattern: USAG.XXXXXX |
| Jenna Werner / Bill Yoder / Ira VanOrder | Production | Account# 65107 — co-packer |
| Joe Gagliardi / Greg Kroetch | Packaging | Film orders |
| *(reserved for future suppliers)* | Production/Ingredients | *(add as identified)* |
| CompanySage | Compliance | Business registration fees |
| Shopify | Revenue/SaaS | Balance statements + subscription |
| Amazon | Revenue | Disbursement deposits |
| RushOrderTees | Marketing | Merch/promotional |
| USPS / FedEx / UPS | Shipping | Shipping labels |

#### New Email Templates
- `invoiceReminder` — gentle nudge for overdue AR (B2B customers who haven't paid)
- `paymentConfirmation` — auto-reply when a payment is matched to an invoice

#### New State Files
- `~/.config/usa-gummies-mcp/finops-status.json`
- `~/.config/usa-gummies-mcp/finops-run-ledger.json`
- `~/.config/usa-gummies-mcp/finops-transaction-cache.json`
- `~/.config/usa-gummies-mcp/finops-invoice-cache.json`
- `~/.config/usa-gummies-mcp/finops-reconciliation-state.json`

#### Human-in-the-Loop Attention Queue Items
- **Unmatched bank deposits** > $50 → "What is this deposit from?"
- **Uncategorized expenses** > $25 → "How should this be categorized?"
- **Invoices needing approval** → Ben sees vendor, amount, due date → approves payment priority
- **Cash flow warnings** → "Balance projected to drop below $5,000 in 14 days"
- **Overdue invoices** → "Invoice from [vendor] is 30+ days overdue"

#### Dashboard UI Sections
- **Bank Balance**: Live balance from most recent Found data, trend sparkline
- **Cash Flow Forecast**: 30-day projection chart showing inflows vs outflows
- **Reconciliation Status**: % of deposits matched, % of expenses categorized, unmatched items count
- **Accounts Payable**: Outstanding bills sorted by due date, total owed
- **Accounts Receivable**: Expected payments, late payments flagged red
- **P&L Summary**: This week vs last week, this month vs last month
- **Production Cost Breakdown**: Cost per bag by SKU, margin by channel
- **Tax Reserve**: Quarterly estimate, amount reserved, next deadline
- **Attention Queue**: Unmatched transactions, uncategorized expenses, overdue items
- **Agent Status Board**: Standard pattern

#### Integration with Existing Systems
- **Reads from**: Found.com (via CSV exports in Gmail)
- **Reads from**: Gmail (invoice emails, payment confirmations)
- **Reads from**: Revenue Intel engine (Build 2 — sales data for reconciliation)
- **Reads from**: Supply Chain engine (Build 5 — production runs for cost allocation)
- **Writes to**: Revenue Intel (actual margin data, not just estimated COGS)
- **Links to**: B2B Sales Engine (B2B invoices → payment tracking)
- **Feeds into**: Monthly Investor Snapshot (Build 2 R9) with actual financials, not estimates

#### Plaid Upgrade Path (Phase 2)
When ready to upgrade from CSV to Plaid:
1. Sign up for Plaid developer account at plaid.com
2. Get `PLAID_CLIENT_ID` and `PLAID_SECRET`
3. Build a one-time Plaid Link flow (small Next.js page) to connect Found account
4. Store `access_token` in `~/.config/usa-gummies-mcp/.plaid-credentials`
5. Replace F1 (CSV Ingestor) with F1-plaid (API Ingestor) using `/transactions/sync`
6. Add webhook receiver at `/api/finops/plaid-webhook` for real-time transaction updates
7. Cost: ~$2.50/month per connected account (Plaid Production pricing)

---

## MASTER FILE MAP

### New Files to Create

| File | System | Lines (est) | Purpose |
|------|--------|------------|---------|
| `scripts/usa-gummies-revenue-intel.mjs` | Build 2 | ~3,000 | Revenue Intelligence engine (12 agents) |
| `scripts/install-revenue-intel-cron.sh` | Build 2 | ~50 | Cron installer |
| `src/app/api/revenue-intel/route.ts` | Build 2 | ~600 | Dashboard API |
| `src/components/ops/RevenueIntelDashboard.client.tsx` | Build 2 | ~800 | Dashboard UI |
| `src/app/revenue-intel/page.tsx` | Build 2 | ~20 | Page route |
| `scripts/usa-gummies-dtc-engine.mjs` | Build 3 | ~2,500 | DTC Retention engine (10 agents) |
| `scripts/install-dtc-engine-cron.sh` | Build 3 | ~40 | Cron installer |
| `src/app/api/dtc-engine/route.ts` | Build 3 | ~500 | Dashboard API |
| `src/components/ops/DtcEngineDashboard.client.tsx` | Build 3 | ~700 | Dashboard UI |
| `src/app/dtc-engine/page.tsx` | Build 3 | ~20 | Page route |
| `scripts/usa-gummies-seo-engine.mjs` | Build 4 | ~2,200 | SEO Content engine (9 agents) |
| `scripts/install-seo-engine-cron.sh` | Build 4 | ~40 | Cron installer |
| `src/app/api/seo-engine/route.ts` | Build 4 | ~400 | Dashboard API |
| `src/components/ops/SeoEngineDashboard.client.tsx` | Build 4 | ~600 | Dashboard UI |
| `src/app/seo-engine/page.tsx` | Build 4 | ~20 | Page route |
| `scripts/usa-gummies-supply-chain.mjs` | Build 5 | ~2,000 | Supply Chain engine (8 agents) |
| `scripts/install-supply-chain-cron.sh` | Build 5 | ~35 | Cron installer |
| `src/app/api/supply-chain/route.ts` | Build 5 | ~500 | Dashboard API |
| `src/components/ops/SupplyChainDashboard.client.tsx` | Build 5 | ~600 | Dashboard UI |
| `src/app/supply-chain/page.tsx` | Build 5 | ~20 | Page route |
| `scripts/usa-gummies-finops.mjs` | Build 6 | ~3,200 | Financial Operations engine (11 agents) |
| `scripts/install-finops-cron.sh` | Build 6 | ~45 | Cron installer |
| `scripts/lib/found-csv-parser.mjs` | Build 6 | ~150 | Found.com CSV parser |
| `scripts/lib/invoice-extractor.mjs` | Build 6 | ~200 | Gmail invoice extraction |
| `src/app/api/finops/route.ts` | Build 6 | ~700 | Dashboard API |
| `src/components/ops/FinOpsDashboard.client.tsx` | Build 6 | ~900 | Dashboard UI |
| `src/app/finops/page.tsx` | Build 6 | ~20 | Page route |

### Files to Modify

| File | System | Changes |
|------|--------|---------|
| `scripts/usa-gummies-agentic.mjs` | Build 1 | +8 agents (~3,500 lines), +4 templates, +new DB fields |
| `scripts/install-usa-gummies-agentic-cron.sh` | Build 1 | +8 cron entries |
| `src/app/api/agentic/command-center/route.ts` | Build 1 | +deal pipeline KPIs, +quote tracking |
| `src/components/ops/AgenticCommandCenter.client.tsx` | Build 1 | +deal pipeline UI, +quote panel, +Faire feed |

### New Notion Databases (22 total)

| Database | System |
|----------|--------|
| Revenue Daily Snapshots | Build 2 |
| Revenue Weekly Reports | Build 2 |
| Revenue Monthly Reports | Build 2 |
| Revenue Config | Build 2 |
| DTC Customers | Build 3 |
| DTC Email Log | Build 3 |
| DTC Reviews | Build 3 |
| DTC Referrals | Build 3 |
| SEO Keywords | Build 4 |
| SEO Content Calendar | Build 4 |
| SEO Blog Performance | Build 4 |
| SEO Link Suggestions | Build 4 |
| Inventory Tracker | Build 5 |
| Raw Materials | Build 5 |
| Production Runs | Build 5 |
| Supplier Directory | Build 5 |
| Bank Transactions | Build 6 |
| Invoices | Build 6 |
| Accounts Payable | Build 6 |
| Accounts Receivable | Build 6 |
| P&L Reports | Build 6 |
| Cash Flow Projections | Build 6 |

### New State Files (21 total)
All in `~/.config/usa-gummies-mcp/`:
- Build 1: `agentic-quotes-pending.json`, `agentic-reengagement-log.json`, `agentic-template-performance.json`, `agentic-faire-orders.json`
- Build 2: `revenue-intel-status.json`, `revenue-intel-run-ledger.json`, `revenue-intel-daily-cache.json`
- Build 3: `dtc-engine-status.json`, `dtc-engine-run-ledger.json`, `dtc-customer-sequences.json`, `dtc-referral-codes.json`
- Build 4: `seo-engine-status.json`, `seo-engine-run-ledger.json`, `seo-keyword-cache.json`, `seo-serp-cache.json`
- Build 5: `supply-chain-status.json`, `supply-chain-run-ledger.json`, `inventory-snapshot.json`, `sales-velocity-cache.json`
- Build 6: `finops-status.json`, `finops-run-ledger.json`, `finops-transaction-cache.json`, `finops-invoice-cache.json`, `finops-reconciliation-state.json`

### Total New Cron Entries
- Build 1: 8 new entries (added to existing installer)
- Build 2: 12 entries (new installer)
- Build 3: 10 entries (new installer)
- Build 4: 9 entries (new installer)
- Build 5: 8 entries (new installer)
- Build 6: 11 entries (new installer)
- **Total**: 58 new cron entries across all systems

---

## SHARED UTILITY EXTRACTION

Before building 4 new standalone engines, we should extract shared utilities into a common module that all engines import. This prevents duplicating ~800 lines of Notion API wrappers, logging, email helpers, etc.

**New file**: `scripts/lib/usa-gummies-shared.mjs`

Extracts from existing `usa-gummies-agentic.mjs`:
- `notionFetch()` — Notion API wrapper
- `queryDatabaseAll()` — paginated DB query
- `createPageInDb()` — create Notion page
- `updateNotionPage()` — update Notion page
- `buildProperties()` — property encoding
- `blockParagraph()` — block helper
- `log()` — timestamped logging
- `todayET()`, `nowET()` — timezone helpers
- `loadJsonFile()`, `saveJsonFile()` — state file management
- `sendEmail()` — himalaya wrapper
- `checkEmail()` — himalaya wrapper
- `textBen()` — iMessage notification
- `webSearch()` — Google search via fetch
- `dnsCheck()` — DNS verification
- Self-heal lock/unlock pattern
- Run ledger management pattern
- Attention queue management pattern

All 6 engines import from this shared module:
```js
import { notionFetch, log, sendEmail, textBen, ... } from "./lib/usa-gummies-shared.mjs";
```

---

## PARALLEL BUILD STRATEGY

### How Many Claude Code Agents

Building all 6 systems simultaneously requires **6 parallel Claude Code agents**, each assigned one complete system. Here's the assignment:

| Agent # | System | Estimated Work | Priority |
|---------|--------|---------------|----------|
| **Agent A** | Shared Utility Extraction + Build 1 (B2B V2) | Extract shared lib first (blocks others), then add 8 new agents to existing engine | P0 — starts first, unblocks all others |
| **Agent B** | Build 2 (Revenue Intelligence) | Full new engine, 12 agents, dashboard, Notion DBs | P0 — highest business value |
| **Agent C** | Build 3 (DTC Retention) | Full new engine, 10 agents, email sequences, dashboard | P1 — compounds DTC revenue |
| **Agent D** | Build 4 (SEO Content) | Full new engine, 9 agents, GA4 integration, dashboard | P1 — compounds organic traffic |
| **Agent E** | Build 5 (Supply Chain) | Full new engine, 8 agents, inventory tracking, dashboard | P1 — operational excellence |
| **Agent F** | Build 6 (Financial Operations) | Full new engine, 11 agents, Found.com banking, invoice reconciliation, P&L | P0 — the money brain, keeps everything balanced |

### Build Sequence

```
Phase 0 (Agent A only — 1 session):
  └── Extract shared utilities into scripts/lib/usa-gummies-shared.mjs
  └── Refactor existing usa-gummies-agentic.mjs to import from shared lib
  └── Verify existing system still works after refactor

Phase 1 (All 6 agents in parallel):
  Agent A: Build 1 — Add 8 new agents to B2B engine
  Agent B: Build 2 — Create revenue-intel engine from scratch
  Agent C: Build 3 — Create DTC engine from scratch
  Agent D: Build 4 — Create SEO engine from scratch
  Agent E: Build 5 — Create supply-chain engine from scratch
  Agent F: Build 6 — Create finops engine + CSV parser + invoice extractor

Phase 2 (All 6 agents in parallel):
  Agent A: Build 1 — Dashboard updates (command center additions)
  Agent B: Build 2 — Dashboard + cron installer
  Agent C: Build 3 — Dashboard + cron installer
  Agent D: Build 4 — Dashboard + cron installer
  Agent E: Build 5 — Dashboard + cron installer
  Agent F: Build 6 — Dashboard + cron installer

Phase 3 (All 6 agents in parallel):
  Agent A: Build 1 — Create Notion databases + schema updates
  Agent B: Build 2 — Create Notion databases
  Agent C: Build 3 — Create Notion databases
  Agent D: Build 4 — Create Notion databases
  Agent E: Build 5 — Create Notion databases
  Agent F: Build 6 — Create Notion databases (Bank Transactions, Invoices, AP, AR, P&L, Cash Flow)

Phase 4 (3 agents):
  Agent A: Integration testing — verify all engines work together
  Agent B: Master command center — unified dashboard that links all 6 system dashboards
  Agent F: Wire cross-system financial flows (FinOps ↔ Revenue Intel ↔ Supply Chain)
```

### Estimated Total Output
- **New code**: ~20,000-24,000 lines across all engines
- **Modified code**: ~5,000 lines in existing files
- **New Notion databases**: 22
- **New cron entries**: 58
- **New dashboard pages**: 5 (+ 1 unified hub)
- **New state files**: 21
- **Total agent functions across all systems**: 22 (existing) + 8 + 12 + 10 + 9 + 8 + 11 = **80 autonomous agents**

### Git Strategy
All work goes to `main` branch (per established convention). Each engine is committed separately:
1. `feat: extract shared utilities from agentic engine`
2. `feat: B2B Sales Engine V2 — deal progression, quotes, re-engagement`
3. `feat: Revenue Intelligence engine — unified multi-channel analytics`
4. `feat: DTC Retention engine — post-purchase sequences, referrals, loyalty`
5. `feat: SEO Content engine — keyword research, content pipeline, performance tracking`
6. `feat: Supply Chain engine — inventory, production scheduling, fulfillment`
7. `feat: Financial Operations engine — Found.com banking, invoice reconciliation, P&L`
8. `feat: unified command hub linking all 6 system dashboards`

---

## DEPENDENCY GRAPH

```
                         ┌─────────────┐
                         │ Shared Lib  │ ◄── Must be extracted first
                         │ (Phase 0)   │
                         └──────┬──────┘
                                │
     ┌──────────────┬───────────┼───────────┬──────────────┬──────────────┐
     ▼              ▼           ▼           ▼              ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Build 1  │ │ Build 2  │ │ Build 3  │ │ Build 4  │ │ Build 5  │ │ Build 6  │
│ B2B V2   │ │ Revenue  │ │ DTC      │ │ SEO      │ │ Supply   │ │ FinOps   │
│          │ │ Intel    │ │ Retention│ │ Content  │ │ Chain    │ │ (Found)  │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
     │             │            │            │            │            │
     │             │            │            │            │            │
     │      ┌──────┴──────┐    │            │     ┌──────┴──────┐     │
     │      │             │    │            │     │             │     │
     │      ▼             ▼    │            │     ▼             ▼     │
     │  Revenue ◄─── Actual margin data ────────── FinOps ────────────┘
     │  Intel          from FinOps                  │
     │      │                                       │
     │      └── Sales velocity ──► Supply Chain ◄───┘
     │                              (cost allocation)
     │
     ▼                    ▼                    ▼                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        UNIFIED COMMAND HUB                               │
│  /ops — links to all 6 dashboards with master health overview            │
│  Shows: total revenue, total expenses, net income, cash position         │
└──────────────────────────────────────────────────────────────────────────┘
```

**Cross-system data flows**:
- **FinOps ↔ Revenue Intel**: FinOps provides actual bank-verified revenue and real margins (not estimates). Revenue Intel provides expected payouts for reconciliation.
- **FinOps ↔ Supply Chain**: FinOps tracks production invoices and allocates costs to production runs. Supply Chain provides production run records for cost allocation.
- **FinOps ↔ B2B Engine**: FinOps tracks B2B invoice payments via AR. B2B Engine provides wholesale order data.
- Revenue Intel ← reads from → B2B Engine (wholesale revenue), DTC Engine (DTC revenue), Supply Chain (COGS)
- DTC Engine → feeds metrics to → Revenue Intel (retention rates, LTV)
- SEO Engine → feeds organic traffic metrics to → Revenue Intel
- Supply Chain ← reads from → Revenue Intel (sales velocity forecasts)
- B2B Engine ← reads from → Revenue Intel (revenue targets influence send quotas)

**The FinOps engine is the ground truth.** Revenue Intel shows what you sold. FinOps shows what actually hit the bank. When those numbers match, your books are clean. When they don't, FinOps flags the discrepancy for investigation.
