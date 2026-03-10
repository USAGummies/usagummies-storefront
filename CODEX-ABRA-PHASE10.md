# CODEX-ABRA-PHASE10.md — Autonomous Operations (Prompts 56-63)

> **Purpose**: Elevate Abra from a reactive dashboard into an autonomous operating system
> that predicts, recommends, and executes — with human approval gates at every step.

---

## Global Rules (apply to every prompt)

### Code Style
- TypeScript strict, no `any` except where existing code uses `// eslint-disable`
- Imports: `@/lib/...` alias (not relative `../../`)
- Client components: `"use client"` at top, filename `*.client.tsx`
- Server page wrappers: `page.tsx` that imports client component
- Error pattern: try/catch → `console.error("[module-name] message:", err)` → return JSON `{ error }` with status code
- Critical failures also call `notify({ channel: "alerts", text })` from `@/lib/ops/notify`
- AI calls log cost via `logAICost()` from `@/lib/ops/abra-cost-tracker`
- Best-effort operations (KPI recording, signal emission) use `try { ... } catch { /* best-effort */ }` — never block the parent operation
- All new API routes: `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"`
- Cron-protected routes check: `Authorization: Bearer ${process.env.CRON_SECRET}`

### Existing Patterns to Follow
- Supabase client: `const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)`
- Slack notify: `import { notify } from "@/lib/ops/notify"` → `notify({ channel: "alerts"|"daily"|"pipeline", text: string })`
- Feed results: `type FeedResult = { feed_key: string; success: boolean; entriesCreated: number; error?: string }`
- Brain writes: `writeBrainEntry({ sourceRef, title, rawText, category, department })` from `@/lib/ops/abra-auto-teach`
- Signal emission: `emitSignal({ type, severity, title, details, department?, source? })` from `@/lib/ops/abra-operational-signals`
- KPI recording: `recordKPI({ metric_name, value, department, source_system, metric_group, entity_ref })` from `@/lib/ops/abra-kpi-recorder`
- Cost tracking: `logAICost({ model, provider, inputTokens, outputTokens, endpoint, department })` from `@/lib/ops/abra-cost-tracker`
- Model governance: `getPreferredClaudeModel()` from `@/lib/ops/abra-cost-tracker` — returns `claude-3-5-sonnet-latest` or `claude-3-5-haiku-latest` based on budget
- Proposal system: POST to `/api/ops/abra/propose` with `{ action_type, description, details, confidence, risk_level }`
- Action execution: `executeAction(action_id, action)` from `@/lib/ops/abra-actions` — 7 handlers: sendSlack, sendEmail, createTask, updateNotion, createBrainEntry, acknowledgeSignal, pauseInitiative

### UI Patterns (for any client components)
- **Charting**: Recharts 3.7.0 — `ResponsiveContainer, LineChart, Line, BarChart, Bar, ComposedChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend`
- **Design tokens** from `@/app/ops/tokens`: NAVY, RED, GOLD, CREAM, SIDEBAR_BG, SURFACE_CARD, SURFACE_BORDER, SURFACE_TEXT_DIM
- **Card pattern**: `background: SURFACE_CARD, border: 1px solid ${SURFACE_BORDER}, borderRadius: 12, padding: "20px 24px"`
- **No external UI libraries** — custom inline styles only
- **Mobile hook**: `useIsMobile()` from `@/app/ops/hooks` (created in Prompt 55)

### File Locations
- API routes: `src/app/api/ops/abra/<name>/route.ts`
- Lib modules: `src/lib/ops/abra-<name>.ts`
- Scripts: `scripts/<name>.mjs`
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql`

### Testing
No test suite. Validate with:
1. `npx tsc --noEmit` (type check)
2. `npm run build` (full build — must pass)

### Commits
One commit per prompt. Message format: `Abra v2 Prompt <N>: <short description>`
Do NOT push. Do NOT log to Notion.

---

## Prompt 56 — Predictive Revenue Forecasting

**Goal**: Use KPI timeseries data to generate 30-day forward revenue projections with confidence intervals.

### Context
- `kpi_timeseries` table has daily revenue data per channel: `daily_revenue_shopify`, `daily_revenue_amazon`
- Existing forecast page: `src/app/ops/forecast/ForecastView.client.tsx` shows 90-day cash projection
- `useForecastData()` hook fetches from `/api/ops/abra/finance`
- `recordKPI()` from `@/lib/ops/abra-kpi-recorder` writes to `kpi_timeseries`

### Create `src/lib/ops/abra-forecasting.ts`

**Exports**:
```typescript
type ForecastPoint = {
  date: string;          // ISO date string
  predicted: number;     // predicted revenue
  lower_bound: number;   // 80% confidence interval lower
  upper_bound: number;   // 80% confidence interval upper
  channel: string;       // "shopify" | "amazon" | "total"
};

type ForecastResult = {
  channel: string;
  points: ForecastPoint[];
  trend: "growing" | "flat" | "declining";
  growth_rate_pct: number;       // annualized
  confidence: "high" | "medium" | "low";
  data_points_used: number;
};

export async function generateRevenueForecast(opts?: {
  days_ahead?: number;    // default 30
  channel?: string;       // default "all" → runs shopify + amazon + total
}): Promise<ForecastResult[]>;

export async function getHistoricalMetric(
  metric_name: string,
  days_back: number
): Promise<Array<{ date: string; value: number }>>;
```

**Algorithm** (simple but effective for CPG — no ML library needed):

1. Fetch last 90 days of daily revenue from `kpi_timeseries`
2. Apply 7-day moving average to smooth weekday/weekend noise
3. Calculate linear regression slope on the smoothed data
4. For day-of-week seasonality: compute average revenue per weekday (Mon-Sun) over the 90 days
5. Forecast each future day:
   - `base = intercept + slope * day_index`
   - `seasonal_factor = weekday_avg[target_dow] / overall_avg`
   - `predicted = base * seasonal_factor`
   - `std_dev = RMSE of last 30 predicted vs actual`
   - `lower_bound = predicted - 1.28 * std_dev` (80% CI)
   - `upper_bound = predicted + 1.28 * std_dev`
6. Classify trend: if annualized growth > 10% → "growing", < -5% → "declining", else "flat"
7. Confidence: if >60 data points → "high", >30 → "medium", else "low"

### Create `src/app/api/ops/abra/forecast/route.ts`

**Endpoint**: `GET /api/ops/abra/forecast?days=30&channel=all`
**Auth**: session or CRON_SECRET

Returns:
```typescript
{
  forecasts: ForecastResult[];
  generated_at: string;
}
```

### Update `src/app/ops/forecast/ForecastView.client.tsx`

Add a new section at the TOP: **"Revenue Forecast"**

**Chart**: ComposedChart (30 days forward):
- Area: confidence interval band (GOLD with 0.15 opacity, between `lower_bound` and `upper_bound`)
- Line: predicted revenue (NAVY, dashed)
- Line: actual revenue for overlapping dates (NAVY, solid)
- Separate lines per channel using RED (Amazon) and NAVY (Shopify)
- X-axis: dates
- Y-axis: dollar amounts
- Tooltip: predicted + confidence interval + channel

Add summary cards below chart:
- "30-Day Projected Revenue" (total of all channels)
- "Annualized Growth Rate" with trend arrow
- "Confidence Level" badge

Keep ALL existing forecast content below this new section.

**Commit**: `Abra v2 Prompt 56: predictive revenue forecasting with confidence intervals`

---

## Prompt 57 — Auto-Reorder Alerts

**Goal**: Detect when inventory levels will hit zero based on current sell-through rate and proactively alert with reorder recommendations.

### Context
- `handleShopifyInventoryFeed()` and `handleAmazonInventoryFeed()` in `abra-auto-teach.ts` already record inventory data
- `handleInventoryAlertsFeed()` detects low stock — but only current levels, no velocity
- `emitSignal()` from `abra-operational-signals.ts` for alerts
- `proposeAction()` from `abra-actions.ts` for reorder proposals

### Create `src/lib/ops/abra-inventory-forecast.ts`

**Exports**:
```typescript
type InventoryForecast = {
  product_name: string;
  sku: string;
  channel: "shopify" | "amazon" | "total";
  current_stock: number;
  daily_sell_rate: number;     // units per day (7-day average)
  days_until_stockout: number; // Infinity if sell_rate is 0
  reorder_point: number;       // sell_rate * lead_time_days
  suggested_reorder_qty: number; // sell_rate * (lead_time_days + buffer_days)
  lead_time_days: number;      // from product_config or default 21
  urgency: "critical" | "warning" | "ok";
};

export async function analyzeInventory(): Promise<InventoryForecast[]>;
export async function checkAndAlertReorders(): Promise<{ alerts_sent: number; proposals_created: number }>;
```

**Logic for `analyzeInventory()`**:
1. Fetch current inventory levels from brain entries (category: "inventory") — the latest entries from `shopify_inventory` and `amazon_inventory` feeds
2. Fetch the last 14 days of order data from brain entries (category: "sales") to compute sell-through rate
3. For each product/SKU:
   - `daily_sell_rate = total_units_sold_14d / 14`
   - `days_until_stockout = current_stock / daily_sell_rate` (or Infinity if rate is 0)
   - `lead_time_days = product_config.lead_time || 21` (query Supabase `product_config` table, fallback to 21)
   - `reorder_point = daily_sell_rate * lead_time_days`
   - `suggested_reorder_qty = daily_sell_rate * (lead_time_days + 14)` (14-day buffer)
   - `urgency`: if `days_until_stockout < lead_time_days` → "critical", if `< lead_time_days * 1.5` → "warning", else "ok"

**Logic for `checkAndAlertReorders()`**:
1. Run `analyzeInventory()`
2. For each product with urgency "critical" or "warning":
   - Emit signal: `emitSignal({ type: "inventory_alert", severity: urgency === "critical" ? "critical" : "warning", title: "Low stock: ${product_name}", details: "Current: ${current_stock} units. Sell rate: ${daily_sell_rate}/day. Stockout in ${days_until_stockout} days. Suggested reorder: ${suggested_reorder_qty} units.", department: "supply_chain" })`
   - For critical items, propose reorder: `proposeAction({ action_type: "createTask", description: "Reorder ${product_name}: ${suggested_reorder_qty} units", details: { product_name, sku, quantity: suggested_reorder_qty, urgency, days_until_stockout }, confidence: 0.8, risk_level: "medium" })`
3. Record KPIs: `recordKPI({ metric_name: "inventory_days_remaining_${sku}", value: days_until_stockout, department: "supply_chain", source_system: "calculated", metric_group: "inventory" })`
4. Return counts

### Create `src/app/api/ops/abra/inventory-forecast/route.ts`

**GET**: Returns full `InventoryForecast[]` for the UI
**POST**: Runs `checkAndAlertReorders()` (cron use, returns `{ alerts_sent, proposals_created }`)
**Auth**: session (GET) or CRON_SECRET (POST)

### Register as auto-teach feed

In `abra-auto-teach.ts`, add a new feed handler:

```typescript
// In the handlers dict:
inventory_forecast: handleInventoryForecastFeed,
```

`handleInventoryForecastFeed()` calls `checkAndAlertReorders()` and returns a `FeedResult`.

Seed the feed in the migration:
```sql
INSERT INTO abra_auto_teach_feeds (feed_key, feed_name, source_type, schedule_cron, is_active)
VALUES ('inventory_forecast', 'Inventory Forecast & Reorder Alerts', 'calculated', '0 8 * * *', true)
ON CONFLICT (feed_key) DO NOTHING;
```

(Run daily at 8am UTC = 1am PT, after inventory feeds have run)

### Add migration `supabase/migrations/20260311000006_inventory_forecast_feed.sql`

Just the seed INSERT above (keep it minimal).

**Commit**: `Abra v2 Prompt 57: auto-reorder alerts with inventory velocity forecasting`

---

## Prompt 58 — Smart Morning Brief Upgrade

**Goal**: Upgrade the morning brief from a static metrics dump to an intelligent daily briefing with insights, anomalies, action items, and forecast highlights.

### Context
- `generateMorningBrief()` in `src/lib/ops/abra-morning-brief.ts` currently:
  - Fetches snapshots for 5 metrics (shopify/amazon revenue+orders, sessions)
  - Computes % change vs 7-day average
  - Formats as Slack markdown with emoji indicators
- `sendMorningBrief()` sends via `notify({ channel: "daily", text })`
- `getActiveSignals()` from `abra-operational-signals.ts`
- `getMonthlySpend()` from `abra-cost-tracker.ts`
- `analyzeInventory()` from `abra-inventory-forecast.ts` (Prompt 57)
- `generateRevenueForecast()` from `abra-forecasting.ts` (Prompt 56)

### Update `src/lib/ops/abra-morning-brief.ts`

Replace the `generateMorningBrief()` function body with an enriched version:

**Sections to include** (in order):

1. **Header**: "🌅 ABRA MORNING BRIEF — {date, weekday}"

2. **Yesterday's Scorecard** (existing metrics, keep same format):
   - Revenue: Shopify + Amazon + Total with vs-7d deltas
   - Orders: Shopify + Amazon + Total
   - Sessions + AOV

3. **Anomalies Detected** (NEW):
   - Import `detectAnomalies` from `@/lib/ops/abra-operational-signals` if it exists, OR
   - Query `kpi_timeseries` for yesterday's values and compare to 7d average — flag anything >1.5 standard deviations
   - Format: "🔴 Revenue spike: Amazon +145% vs avg" or "🟡 Traffic dip: Sessions -38%"
   - Max 3 anomalies shown

4. **Active Signals** (NEW):
   - Call `getActiveSignals({ limit: 5 })`
   - Show unacknowledged signals: severity icon + title
   - Format: "🔴 Low inventory: Berry Blast (12 units)"

5. **Forecast Preview** (NEW):
   - Call `generateRevenueForecast({ days_ahead: 7, channel: "total" })`
   - Show: "📈 Next 7 days projected: $X,XXX (±$XXX)"
   - Show trend: "Trend: Growing at +XX% annualized"

6. **Inventory Watch** (NEW):
   - Call `analyzeInventory()`
   - Show products with urgency "critical" or "warning":
   - "⚠️ Berry Blast: 12 units left, ~3 days to stockout"
   - Max 3 items

7. **Pending Actions** (NEW):
   - Query `approvals` table: `status = 'pending'`, count
   - Format: "⏳ 2 approvals pending your review"

8. **AI Budget** (NEW):
   - Call `getMonthlySpend()`
   - Format: "💰 AI spend: $XX.XX / $1,000 (X.X%)"

9. **Footer**: "Reply in Slack: `/abra <question>` | Dashboard: {NEXTAUTH_URL}/ops"

**Important implementation details**:
- Wrap each section fetch in try/catch — if a section fails, skip it (don't block the entire brief)
- Use `getPreferredClaudeModel()` — do NOT use Claude for generating the brief (it's all data aggregation)
- Total brief should be under 2000 chars for Slack readability
- Each section should be 1-3 lines max

### Update morning brief API route

Ensure `src/app/api/ops/abra/morning-brief/route.ts` calls the updated `generateMorningBrief()` and `sendMorningBrief()`.

**Commit**: `Abra v2 Prompt 58: smart morning brief with anomalies, forecast, inventory watch, and budget`

---

## Prompt 59 — Slack Channel Intelligence

**Goal**: Let Abra process and respond to Slack messages with full context — not just `/abra` commands but also monitoring for keywords in channels.

### Context
- `src/app/api/slack/abra/route.ts` EXISTS — handles Slack slash command `/abra`
- Supports subcommands: `correct:`, `teach:`, and general questions
- `notify()` sends TO Slack but can't READ from Slack
- No Slack Events API integration yet

### Create `src/app/api/slack/events/route.ts`

**Endpoint**: `POST /api/slack/events`
**Auth**: Slack request signature verification (HMAC-SHA256)

This endpoint handles Slack Events API callbacks.

**Implementation**:

1. **URL Verification** (Slack challenge):
```typescript
if (body.type === "url_verification") {
  return NextResponse.json({ challenge: body.challenge });
}
```

2. **Event Handling**:
```typescript
if (body.type === "event_callback" && body.event?.type === "message") {
  const { text, user, channel, ts, thread_ts } = body.event;

  // Ignore bot messages (prevent loops)
  if (body.event.bot_id || body.event.subtype === "bot_message") {
    return NextResponse.json({ ok: true });
  }

  // Process asynchronously — return 200 immediately (Slack requires <3s response)
  void processSlackMessage({ text, user, channel, ts, thread_ts });

  return NextResponse.json({ ok: true });
}
```

3. **Signature Verification** helper:
```typescript
import crypto from "crypto";

function verifySlackSignature(req: Request, body: string): boolean {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!timestamp || !signature || !signingSecret) return false;

  // Reject if timestamp is >5 min old (replay attack protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");
  const expected = `v0=${hmac}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

### Create `src/lib/ops/abra-slack-processor.ts`

**Exports**:
```typescript
type SlackMessageContext = {
  text: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
};

export async function processSlackMessage(msg: SlackMessageContext): Promise<void>;
export function shouldAbraRespond(text: string, channel: string): boolean;
```

**`shouldAbraRespond()` logic**:
- Returns true if:
  - Message mentions `@abra` or `abra,` or starts with `abra `
  - Message is in a thread where Abra previously responded
  - Channel is in the monitored list (env var `SLACK_MONITORED_CHANNELS`, comma-separated, default empty)
- Returns false otherwise (Abra doesn't eavesdrop on everything)

**`processSlackMessage()` logic**:
1. Check `shouldAbraRespond()` — if false, return early
2. Classify the message intent (same patterns as chat route):
   - `correct:` prefix → handle correction
   - `teach:` prefix → handle teaching
   - Question → run through Abra chat pipeline
3. Call the chat API logic (not HTTP — direct function call):
   - Import the core chat processing from a shared module
   - Build system prompt with department context
   - Run temporal search for RAG
   - Generate response via Claude
   - Log cost via `logAICost()`
4. Post response back to Slack via webhook:
   - Use Slack `chat.postMessage` API if `SLACK_BOT_TOKEN` is set
   - Fallback: use existing webhook with `[ABRA]` prefix
5. Log the interaction to `abra_chat_history` table (Supabase)

### Update env var documentation

Add to the env vars table:
| `SLACK_SIGNING_SECRET` | Slack Events API HMAC verification |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (for posting replies) |
| `SLACK_MONITORED_CHANNELS` | Comma-separated channel IDs to monitor (optional) |

**Fallback**: If `SLACK_SIGNING_SECRET` is not set, the events endpoint returns 501 Not Implemented. The slash command (`/abra`) continues to work independently.

**Commit**: `Abra v2 Prompt 59: Slack channel intelligence with events API and contextual responses`

---

## Prompt 60 — B2B Pipeline Automation

**Goal**: Automate the B2B sales pipeline — track lead status, auto-follow-up reminders, and surface deal intelligence in Abra.

### Context
- Notion CRM: `NOTION_B2B_PROSPECTS_DB` and `NOTION_DISTRIBUTOR_PROSPECTS_DB` env vars
- `scripts/b2b-outbound.mjs` EXISTS — handles outbound prospecting
- Pipeline page: `src/app/ops/pipeline/` exists
- `abra_deals` Supabase table exists with: id, company_name, contact_name, contact_email, status, value, stage, notes, department, created_at, updated_at
- `emitSignal()` for deal alerts
- `proposeAction()` for follow-up proposals

### Create `src/lib/ops/abra-pipeline-intelligence.ts`

**Exports**:
```typescript
type DealInsight = {
  deal_id: string;
  company_name: string;
  stage: string;
  value: number;
  days_in_stage: number;
  risk_level: "low" | "medium" | "high";
  recommended_action: string;
  last_activity: string;
};

type PipelineSummary = {
  total_pipeline_value: number;
  deals_by_stage: Record<string, { count: number; value: number }>;
  at_risk_deals: DealInsight[];
  stale_deals: DealInsight[];    // no activity >7 days
  hot_deals: DealInsight[];      // recently active, high value
  win_rate_30d: number;
  avg_deal_cycle_days: number;
};

export async function analyzePipeline(): Promise<PipelineSummary>;
export async function checkDealHealth(): Promise<{ signals_emitted: number; proposals_created: number }>;
export async function syncNotionDeals(): Promise<{ synced: number; new: number; updated: number }>;
```

**`analyzePipeline()` logic**:
1. Fetch all active deals from `abra_deals` (status not 'closed_won' or 'closed_lost')
2. For each deal, compute:
   - `days_in_stage = now - updated_at` (in days)
   - `risk_level`: if `days_in_stage > 14` → "high", `> 7` → "medium", else "low"
   - `recommended_action`: based on stage + days:
     - "prospecting" + >7d → "Send follow-up email"
     - "proposal_sent" + >5d → "Schedule check-in call"
     - "negotiation" + >10d → "Escalate — deal may be stalling"
     - "verbal_commitment" + >3d → "Send contract for signature"
3. Classify deals:
   - `stale_deals`: days_in_stage > 7 (any stage)
   - `at_risk_deals`: risk_level "high"
   - `hot_deals`: days_in_stage < 3 AND value > $500
4. Calculate pipeline metrics:
   - `win_rate_30d`: deals closed_won / (closed_won + closed_lost) in last 30 days
   - `avg_deal_cycle_days`: average of (closed_at - created_at) for closed_won deals

**`checkDealHealth()` logic**:
1. Run `analyzePipeline()`
2. For each at-risk deal:
   - `emitSignal({ type: "deal_stalled", severity: "warning", title: "Deal stalled: ${company_name}", details: "Stage: ${stage}, ${days_in_stage} days. Recommended: ${recommended_action}", department: "sales_and_growth" })`
3. For stale deals in "prospecting" or "proposal_sent" stage:
   - `proposeAction({ action_type: "sendEmail", description: "Follow up with ${contact_name} at ${company_name}", details: { deal_id, contact_email, template: "follow_up", stage }, confidence: 0.7, risk_level: "low" })`
4. Record KPIs:
   - `recordKPI({ metric_name: "pipeline_total_value", value: total_pipeline_value, department: "sales_and_growth", source_system: "calculated", metric_group: "sales" })`
   - `recordKPI({ metric_name: "pipeline_at_risk_count", value: at_risk_deals.length, ... })`

**`syncNotionDeals()` logic**:
1. Fetch prospects from Notion DB (`NOTION_B2B_PROSPECTS_DB`) using Notion API
2. For each prospect, check if exists in `abra_deals` by company_name
3. If new: insert into `abra_deals`
4. If existing: update fields that differ
5. Return sync counts
6. If Notion credentials aren't set, return `{ synced: 0, new: 0, updated: 0 }` gracefully

### Create `src/app/api/ops/abra/pipeline/route.ts`

**GET**: Returns `PipelineSummary` from `analyzePipeline()`
**POST**: Runs `checkDealHealth()` (cron use)
**Auth**: session (GET) or CRON_SECRET (POST)

### Register pipeline check as feed

In `abra-auto-teach.ts` add handler:
```typescript
pipeline_health: handlePipelineHealthFeed,
```

`handlePipelineHealthFeed()`:
1. Calls `syncNotionDeals()` (sync first)
2. Calls `checkDealHealth()` (then analyze)
3. Returns FeedResult with entriesCreated = signals emitted

Seed:
```sql
INSERT INTO abra_auto_teach_feeds (feed_key, feed_name, source_type, schedule_cron, is_active)
VALUES ('pipeline_health', 'Pipeline Health & Deal Follow-ups', 'calculated', '0 15 * * 1-5', true)
ON CONFLICT (feed_key) DO NOTHING;
```
(Weekdays at 3pm UTC = 8am PT)

Add to migration `supabase/migrations/20260311000006_inventory_forecast_feed.sql` if it hasn't been created yet, OR create `20260311000007_pipeline_feed.sql`.

**Commit**: `Abra v2 Prompt 60: B2B pipeline automation with deal health monitoring and Notion sync`

---

## Prompt 61 — Multi-Channel Attribution

**Goal**: Track customer acquisition cost and revenue attribution across DTC, Amazon, wholesale, and Faire channels.

### Context
- GA4 integration: `fetchGA4Report()` from `@/lib/ops/abra-ga4-client`
- Shopify orders have `source_name` and `referring_site` fields
- Amazon orders tracked via SP-API
- Faire orders via `faire_orders` feed
- `recordKPI()` for metric persistence

### Create `src/lib/ops/abra-attribution.ts`

**Exports**:
```typescript
type ChannelMetrics = {
  channel: string;         // "shopify_dtc" | "amazon_fba" | "faire" | "wholesale" | "other"
  revenue_30d: number;
  orders_30d: number;
  aov: number;
  customers_30d: number;
  repeat_rate_pct: number; // % of orders from repeat customers (if available)
  estimated_cac: number;   // estimated customer acquisition cost
  ltv_estimate: number;    // estimated lifetime value
  margin_pct: number;      // estimated margin (channel-specific)
  roas: number;            // return on ad spend (if ad spend data available)
};

type AttributionReport = {
  channels: ChannelMetrics[];
  total_revenue_30d: number;
  total_orders_30d: number;
  blended_cac: number;
  blended_aov: number;
  period: { start: string; end: string };
};

export async function generateAttributionReport(): Promise<AttributionReport>;
export async function recordChannelKPIs(): Promise<void>;
```

**`generateAttributionReport()` logic**:

1. **Shopify DTC**: Query `kpi_timeseries` for `daily_revenue_shopify` and `daily_orders_shopify` over 30 days. Sum them. AOV = revenue / orders.

2. **Amazon FBA**: Query `kpi_timeseries` for `daily_revenue_amazon` and `daily_orders_amazon` over 30 days.

3. **Faire**: Query brain entries with `category = "sales"` and `source_system = "faire"` from last 30 days. Extract revenue and order count from entry metadata.

4. **Wholesale** (manual/other): Query `abra_deals` for deals with `stage = "closed_won"` in last 30 days. Sum values.

5. For margin estimates, use channel-specific assumptions:
   - Shopify DTC: 65% margin (direct, no marketplace fees)
   - Amazon FBA: 40% margin (after referral fee + FBA fee)
   - Faire: 50% margin (after Faire commission)
   - Wholesale: 45% margin (after wholesale discount)

6. For CAC estimates:
   - If marketing spend KPIs exist (`monthly_ad_spend_shopify`, `monthly_ad_spend_amazon`), use them
   - Otherwise, use industry defaults: Shopify $25/customer, Amazon $15/customer (organic discovery), Faire $10/customer
   - These are rough estimates — flag as "estimated" in the output

7. LTV estimate: `aov * 2.5` (industry CPG average repurchase rate)

**`recordChannelKPIs()`**: Iterates through the report and calls `recordKPI()` for each channel's metrics.

### Create `src/app/api/ops/abra/attribution/route.ts`

**GET**: Returns `AttributionReport`
**Auth**: session or CRON_SECRET

### Update channels page

In `src/app/ops/channels/` — if a client component exists, add the attribution data. If it's a placeholder page, create a basic view:

**Create `src/app/ops/channels/ChannelsView.client.tsx`** (if not exists):

Shows:
1. **Channel Comparison Table**:
   | Channel | Revenue (30d) | Orders | AOV | Margin | Est. CAC | Est. ROAS |

2. **Revenue Pie Chart**: Channel split (same colors as finance page: NAVY=Shopify, RED=Amazon, GOLD=Faire/Wholesale)

3. **Trend Comparison**: ComposedChart showing 30-day revenue lines per channel

Fetch from `/api/ops/abra/attribution` and `/api/ops/abra/kpi-history?metrics=daily_revenue_shopify,daily_revenue_amazon&days=30`.

**Commit**: `Abra v2 Prompt 61: multi-channel attribution with CAC, LTV, and margin analysis`

---

## Prompt 62 — Action Auto-Execution

**Goal**: Enable Abra to automatically execute low-risk approved actions without human intervention, while maintaining full audit trail.

### Context
- `proposeAction()` creates approval records in `approvals` table
- `executeAction(action_id, action)` runs the action through 7 handlers
- Current flow: Abra proposes → human approves → manual execution
- Goal: for tier-1 (low risk) actions, auto-approve and execute

### Update `src/lib/ops/abra-actions.ts`

Add auto-execution capability:

```typescript
export type AutoExecPolicy = {
  action_type: string;
  max_risk_level: "low";          // only low risk can auto-exec
  min_confidence: number;          // minimum confidence score (0-1)
  daily_limit: number;             // max auto-executions per day
  enabled: boolean;
};

export const AUTO_EXEC_POLICIES: AutoExecPolicy[] = [
  { action_type: "createBrainEntry", max_risk_level: "low", min_confidence: 0.7, daily_limit: 50, enabled: true },
  { action_type: "acknowledgeSignal", max_risk_level: "low", min_confidence: 0.8, daily_limit: 20, enabled: true },
  { action_type: "sendSlack", max_risk_level: "low", min_confidence: 0.85, daily_limit: 10, enabled: true },
  { action_type: "createTask", max_risk_level: "low", min_confidence: 0.8, daily_limit: 10, enabled: true },
  // sendEmail and updateNotion require human approval regardless
  // pauseInitiative requires human approval regardless
];

export async function canAutoExecute(action: AbraAction): Promise<boolean>;
export async function proposeAndMaybeExecute(action: AbraAction): Promise<{
  approval_id: string;
  auto_executed: boolean;
  result?: ActionResult;
}>;
```

**`canAutoExecute()` logic**:
1. Find matching policy by `action_type`
2. If no policy or `enabled = false` → return false
3. Check `risk_level <= max_risk_level` (only "low" for now)
4. Check `confidence >= min_confidence`
5. Query today's auto-execution count from `approvals` table:
   ```sql
   SELECT COUNT(*) FROM approvals
   WHERE action_type = $1 AND auto_executed = true
   AND created_at >= CURRENT_DATE
   ```
6. If count >= `daily_limit` → return false
7. Return true

**`proposeAndMaybeExecute()` logic**:
1. Call `proposeAction(action)` — always create the proposal record
2. Check `canAutoExecute(action)`
3. If yes:
   - Update approval status to 'approved' with `auto_approved = true`
   - Call `executeAction(approval_id, action)`
   - Log to brain: `writeBrainEntry({ sourceRef: "auto-exec", title: "Auto-executed: ${action.description}", rawText: JSON.stringify({ action, result }), category: "system", department: action.details.department || "operations" })`
   - Return `{ approval_id, auto_executed: true, result }`
4. If no:
   - Return `{ approval_id, auto_executed: false }` (stays pending for human review)

### Migration `supabase/migrations/20260311000008_auto_exec.sql`

```sql
-- Add auto-execution tracking columns to approvals
ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS auto_executed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_approved BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_result JSONB;

-- Index for daily limit checks
CREATE INDEX IF NOT EXISTS idx_approvals_auto_exec_daily
  ON public.approvals(action_type, auto_executed, created_at)
  WHERE auto_executed = true;
```

### Update all callers

Replace `proposeAction()` calls with `proposeAndMaybeExecute()` in:
- `checkAndAlertReorders()` (Prompt 57) — reorder task proposals
- `checkDealHealth()` (Prompt 60) — follow-up email proposals
- `processSlackMessage()` (Prompt 59) — action directives from chat

Keep `proposeAction()` available for callers that explicitly want human review.

### Add auto-execution dashboard section

In the Command Center (Prompt 49), add a small section:
```
AUTO-EXECUTED TODAY: 3 actions
├ 2× createBrainEntry
├ 1× acknowledgeSignal
└ Daily limit: 3/50 brain, 1/20 signal
```

Fetch from: query `approvals` where `auto_executed = true AND created_at >= today`.

**Commit**: `Abra v2 Prompt 62: action auto-execution with policy gates and daily limits`

---

## Prompt 63 — Weekly Strategy Session

**Goal**: Every Monday, Abra generates a comprehensive strategy session document with performance review, competitive analysis, department updates, and recommended priorities — then posts it to Slack and the dashboard.

### Context
- `generateWeeklyDigest()` in `abra-weekly-digest.ts` — basic markdown digest
- `generateRevenueForecast()` from `abra-forecasting.ts` (Prompt 56)
- `analyzePipeline()` from `abra-pipeline-intelligence.ts` (Prompt 60)
- `generateAttributionReport()` from `abra-attribution.ts` (Prompt 61)
- `analyzeInventory()` from `abra-inventory-forecast.ts` (Prompt 57)
- `getMonthlySpend()` from `abra-cost-tracker.ts`
- `getActiveSignals()` from `abra-operational-signals.ts`
- `getSystemHealth()` from `abra-health-monitor.ts` (Prompt 47)

### Update `src/lib/ops/abra-weekly-digest.ts`

Replace the `generateWeeklyDigest()` body with a comprehensive strategy session:

**Sections**:

1. **Header**: "📊 WEEKLY STRATEGY SESSION — Week of {date}"

2. **Executive Summary** (AI-generated, 3-4 sentences):
   - Use Claude (via `getPreferredClaudeModel()`) with a focused prompt:
     ```
     Given the following weekly business data for USA Gummies (DTC gummy vitamin brand),
     write a 3-sentence executive summary highlighting the most important trends and risks:

     Revenue: ${JSON.stringify(revenueData)}
     Pipeline: ${JSON.stringify(pipelineSummary)}
     Signals: ${JSON.stringify(activeSignals)}
     Inventory: ${JSON.stringify(inventoryAlerts)}
     ```
   - Log cost via `logAICost()`
   - This is the ONLY Claude call in the digest — everything else is data aggregation

3. **Performance Scorecard** (data-driven, no AI):
   - Revenue: This week vs last week vs 4-week average (per channel)
   - Orders: Same comparison
   - AOV: trend
   - Sessions/traffic: trend
   - Format as a markdown table

4. **Channel Attribution** (from `generateAttributionReport()`):
   - Revenue split by channel
   - Top channel and fastest-growing channel

5. **Revenue Forecast**:
   - Next 7-day projection from `generateRevenueForecast({ days_ahead: 7 })`
   - Trend classification and growth rate

6. **Pipeline Update** (from `analyzePipeline()`):
   - Total pipeline value
   - Deals by stage
   - At-risk deals (list top 3)
   - Win rate

7. **Inventory Watch** (from `analyzeInventory()`):
   - Critical items approaching stockout
   - Reorder recommendations

8. **Unresolved Signals** (from `getActiveSignals()`):
   - Count by severity
   - Top 5 unacknowledged signals

9. **System Health** (from `getSystemHealth()`):
   - Integration status summary
   - Feed status (active, disabled, errors)

10. **AI Budget** (from `getMonthlySpend()`):
    - Month-to-date spend
    - Projected month-end spend (linear extrapolation)

11. **Recommended Priorities for This Week** (AI-generated):
    - Use Claude with all the above data to suggest 3-5 priorities
    - Format as numbered list with rationale
    - Log cost

12. **Footer**: "Generated by Abra | Reply `/abra <question>` for details"

### Update `sendWeeklyDigest()`

1. Call `generateWeeklyDigest()` to get the markdown
2. Send to Slack: `notify({ channel: "daily", text: digest })`
3. Also save to brain: `writeBrainEntry({ sourceRef: "weekly-digest", title: "Weekly Strategy Session — {date}", rawText: digest, category: "report", department: "executive" })`
4. Record completion KPI: `recordKPI({ metric_name: "weekly_digest_generated", value: 1, department: "executive", source_system: "calculated" })`

### Create `src/app/api/ops/abra/digest/route.ts`

**Endpoint**: `POST /api/ops/abra/digest?type=weekly`
**Auth**: CRON_SECRET

Logic:
```typescript
const type = new URL(req.url).searchParams.get("type") || "weekly";
if (type === "weekly") {
  await sendWeeklyDigest();
} else if (type === "monthly") {
  await sendMonthlyReport();
}
return NextResponse.json({ success: true, type });
```

This is the endpoint QStash calls on Monday 8am PT.

### Add digest view to ops dashboard

Create `src/app/ops/digest/page.tsx` and `src/app/ops/digest/DigestView.client.tsx`:

**DigestView** fetches the latest digest from brain entries (query: `category = "report" AND source_ref = "weekly-digest"` ordered by `created_at DESC LIMIT 1`) and renders the markdown as styled HTML.

Use a simple markdown-to-HTML rendering approach:
- Split by `\n` and detect headers (`#`, `##`), tables (`|`), lists (`-`, `1.`)
- Render with appropriate styles using design tokens
- Or if a lightweight markdown renderer is available in deps, use it

### Add to navigation

In `OpsShell.client.tsx`, add to COMMAND section:
```typescript
{ href: "/ops/digest", label: "Weekly Digest", icon: "📊", roles: ["admin", "employee", "investor", "partner", "banker"] },
```

**Commit**: `Abra v2 Prompt 63: weekly strategy session with AI-powered executive summary and priorities`

---

## Execution Order

Run prompts in order: **56 → 57 → 58 → 59 → 60 → 61 → 62 → 63**

After each prompt:
1. Run `npx tsc --noEmit` — fix any type errors
2. Run `npm run build` — must pass
3. Commit with message format: `Abra v2 Prompt <N>: <description>`

After ALL prompts complete:
1. Final `npm run build` — must pass
2. Do NOT push. Do NOT create branches.

---

## New Files Created in Phase 10

| Prompt | File | Purpose |
|--------|------|---------|
| 56 | `src/lib/ops/abra-forecasting.ts` | Revenue prediction engine |
| 56 | `src/app/api/ops/abra/forecast/route.ts` | Forecast API |
| 57 | `src/lib/ops/abra-inventory-forecast.ts` | Inventory velocity analysis |
| 57 | `src/app/api/ops/abra/inventory-forecast/route.ts` | Inventory forecast API |
| 57 | `supabase/migrations/20260311000006_inventory_forecast_feed.sql` | Feed seed |
| 59 | `src/app/api/slack/events/route.ts` | Slack Events API handler |
| 59 | `src/lib/ops/abra-slack-processor.ts` | Slack message intelligence |
| 60 | `src/lib/ops/abra-pipeline-intelligence.ts` | Deal health analysis |
| 60 | `src/app/api/ops/abra/pipeline/route.ts` | Pipeline API |
| 60 | `supabase/migrations/20260311000007_pipeline_feed.sql` | Feed seed |
| 61 | `src/lib/ops/abra-attribution.ts` | Channel attribution engine |
| 61 | `src/app/api/ops/abra/attribution/route.ts` | Attribution API |
| 61 | `src/app/ops/channels/ChannelsView.client.tsx` | Channel comparison UI |
| 62 | `supabase/migrations/20260311000008_auto_exec.sql` | Auto-execution columns |
| 63 | `src/app/api/ops/abra/digest/route.ts` | Digest generation endpoint |
| 63 | `src/app/ops/digest/page.tsx` | Digest page wrapper |
| 63 | `src/app/ops/digest/DigestView.client.tsx` | Digest viewer UI |

## Files Modified in Phase 10

| Prompt | File | Change |
|--------|------|--------|
| 56 | `src/app/ops/forecast/ForecastView.client.tsx` | Add forecast charts |
| 57 | `src/lib/ops/abra-auto-teach.ts` | Add inventory_forecast + pipeline_health feed handlers |
| 58 | `src/lib/ops/abra-morning-brief.ts` | Enriched morning brief |
| 60 | `src/lib/ops/abra-auto-teach.ts` | Add pipeline_health feed handler |
| 61 | `src/app/ops/channels/page.tsx` | Wire up ChannelsView |
| 62 | `src/lib/ops/abra-actions.ts` | Add auto-execution policies and logic |
| 63 | `src/lib/ops/abra-weekly-digest.ts` | Comprehensive strategy session |
| 63 | `src/app/ops/OpsShell.client.tsx` | Add digest nav item |

## Environment Variables Referenced

All existing vars plus:

| Variable | Purpose | Required |
|----------|---------|----------|
| `SLACK_SIGNING_SECRET` | Slack Events API signature verification | Only for Prompt 59 |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (reply in channels) | Only for Prompt 59 |
| `SLACK_MONITORED_CHANNELS` | Channel IDs for Abra monitoring | Optional |
| `NOTION_B2B_PROSPECTS_DB` | Notion CRM database ID | Only for Prompt 60 |
