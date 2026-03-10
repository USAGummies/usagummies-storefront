# Codex Build Prompt — Abra Phase 6 & 7 (Prompts 31–42)

## Mission

Continue building Abra. Phases 1–5 (Prompts 1–30) are complete. You're now building **Phase 6: Live Data Integration** and **Phase 7: Proactive Intelligence & Action**.

This is the phase where Abra goes from chatbot to autonomous operator — real data flowing in, anomaly detection, proactive briefings, and action execution.

**Work autonomously. Commit after each prompt. Keep going until done.**

---

## Project Setup

```
Repository: /Users/ben/usagummies-storefront
Branch: main (ONLY branch)
Build: npm run build
Framework: Next.js 15 App Router, React 18, TypeScript, Tailwind 4
```

### Supabase
- **URL**: `https://zdvfllvopocptwgummzb.supabase.co`
- Before ANY `supabase` CLI command: `mv .env.local .env.local.bak` then restore after.

---

## Execution Order

**31 → 32 → 33 → 34 → 35 → 36 → 37 → 38 → 39 → 40 → 41 → 42**

---

## What Already Exists — CRITICAL CONTEXT

### API Clients (USE THESE — do not recreate)

**Shopify Admin** — `src/lib/shopify/admin.ts`
- `adminRequest<T>(query, variables)` — GraphQL
- REST pattern also used: `fetch(\`https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders.json?...\`, { headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN } })`
- Env: `SHOPIFY_STORE`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_API_VERSION`

**Amazon SP-API** — `src/lib/amazon/sp-api.ts`
- `getAccessToken()` — LWA OAuth token exchange (50-min cache)
- `fetchOrders(createdAfter, createdBefore)` — orders with rate-limit retry
- `fetchOrderItems(orderId)` — line items
- `fetchFBAInventory()` — FBA inventory levels
- `fetchAmazonOrderStats(daysBack)` — revenue/count summary
- Env: `LWA_CLIENT_ID`, `LWA_CLIENT_SECRET`, `LWA_REFRESH_TOKEN`
- Rate limit: 1 req/5s for orders, automatic 429 retry with backoff

**GA4** — pattern from `scripts/daily-report.mjs`
- Uses `googleapis` package: `google.analyticsdata({ version: 'v1beta', auth })`
- Service account at `~/.config/usa-gummies-mcp/ga4-service-account.json`
- Also available as env var: `GA4_SERVICE_ACCOUNT_JSON`
- Property ID: `509104328` (env: `GA4_PROPERTY_ID`)
- `analyticsData.properties.runReport({ property, requestBody: { dateRanges, metrics, dimensions } })`

### Auto-Teach System — `src/lib/ops/abra-auto-teach.ts`

Current feed handlers (most are stubs reading from env JSON):
- `runShopifyOrdersFeed()` — **REAL** (Shopify REST API, last 24h)
- `handleAmazonOrdersFeed()` — **STUB** (reads `ABRA_AMAZON_ORDERS_SAMPLE_JSON`)
- `handleFaireOrdersFeed()` — **STUB** (reads env sample JSON)
- `handleShopifyProductsFeed()` — **STUB** (reads env sample JSON)
- `handleGA4TrafficFeed()` — **STUB** (reads env sample JSON)
- `handleInventoryAlertsFeed()` — **PARTIAL** (reads snapshot, emits signals)

Key functions:
```typescript
getDueFeeds(): Promise<AutoTeachFeed[]>  // queries abra_auto_teach_feeds
runFeed(feedKey: string): Promise<FeedResult>  // dispatches to handler
runAllDueFeeds(): Promise<FeedResult[]>  // runs all due feeds
writeBrainEntry(text, category, department, metadata): Promise<void>  // embeds + stores
```

### Operational Signals — `src/lib/ops/abra-operational-signals.ts`
```typescript
emitSignal(signal: { signal_type, source, title, detail, severity, department, metadata }): Promise<string | null>
getActiveSignals({ department?, limit?, severity? }): Promise<OperationalSignalRow[]>
buildSignalsContext(signals): string
extractEmailSignals({ subject, body, from, department? }): Signal[]
```

### Notification — `src/lib/ops/notify.ts`
```typescript
notify(channel: "alerts" | "pipeline" | "daily", message: string): Promise<void>
textBen(message: string): Promise<void>  // iMessage
```

### Email — `src/lib/ops/email.ts`
```typescript
sendOpsEmail({ to, subject, html }): Promise<void>
```

### Cost Tracking — `src/lib/ops/abra-cost-tracker.ts`
```typescript
logAICost(params): Promise<void>  // fire-and-forget
getMonthlySpend(): Promise<MonthlySpend>
isBudgetCritical(): Promise<boolean>
```

### Weekly Digest — `src/lib/ops/abra-weekly-digest.ts`
```typescript
generateWeeklyDigest(): Promise<string>
sendWeeklyDigest(): Promise<void>
generateMonthlyReport(): Promise<string>
sendMonthlyReport(): Promise<void>
```

---

## Prompt 31 — Live Shopify Feed

**Replace the Shopify product stub with real API calls. Enhance the existing orders feed.**

### 31A — Real Shopify Products Feed

Modify `src/lib/ops/abra-auto-teach.ts`:

Replace `handleShopifyProductsFeed()` with real implementation:

```typescript
async function handleShopifyProductsFeed(): Promise<FeedResult> {
  const store = process.env.SHOPIFY_STORE;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  if (!store || !token) return { feed_key: "shopify_products", success: false, error: "Missing Shopify creds", entries_created: 0 };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `https://${store}/admin/api/${version}/products.json?updated_at_min=${since}&limit=250`;

  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Shopify products ${res.status}: ${await res.text()}`);
  const { products } = await res.json();

  if (!products?.length) return { feed_key: "shopify_products", success: true, entries_created: 0, error: null };

  let created = 0;
  for (const p of products) {
    const totalInventory = (p.variants || []).reduce((s: number, v: { inventory_quantity?: number }) => s + (v.inventory_quantity || 0), 0);
    const text = `Product update: "${p.title}" (${p.product_type || "uncategorized"}). ${p.variants?.length || 0} variants. Total inventory: ${totalInventory}. Status: ${p.status}. Price range: $${p.variants?.[0]?.price || "?"}.`;

    await writeBrainEntry(text, "product_update", "operations", {
      source: "shopify_products_feed",
      product_id: p.id,
      title: p.title,
      inventory: totalInventory,
      status: p.status,
    });
    created++;

    // Emit signal for low inventory
    if (totalInventory < 100 && p.status === "active") {
      void emitSignal({
        signal_type: "inventory_alert",
        source: "shopify",
        title: `Low inventory: ${p.title}`,
        detail: `Only ${totalInventory} units remaining across ${p.variants?.length} variants`,
        severity: totalInventory < 25 ? "critical" : "warning",
        department: "supply_chain",
        metadata: { product_id: p.id, inventory: totalInventory },
      });
    }
  }

  return { feed_key: "shopify_products", success: true, entries_created: created, error: null };
}
```

### 31B — Enhanced Shopify Orders Feed

The existing `runShopifyOrdersFeed()` is already real. Enhance it to:
1. Extract revenue totals and create a daily summary brain entry
2. Detect large orders (>$100) and emit operational signals
3. Track new vs returning customers

### 31C — Shopify Inventory Monitor

Add a new handler `handleShopifyInventoryFeed()`:
- Uses Shopify Admin REST: `/inventory_levels.json` or `/products.json` with inventory data
- Compares current levels against thresholds
- Emits `inventory_alert` signals via `emitSignal()` for items below safety stock
- Creates brain entry with inventory summary

**Commit message**: `Abra v2 Prompt 31: live Shopify feeds — products, orders, inventory`

---

## Prompt 32 — Live Amazon Feed

**Replace the Amazon stub with real SP-API calls.**

### 32A — Real Amazon Orders Feed

Modify `handleAmazonOrdersFeed()` in `src/lib/ops/abra-auto-teach.ts`:

```typescript
async function handleAmazonOrdersFeed(): Promise<FeedResult> {
  // Import from existing SP-API client
  const { fetchOrders, fetchAmazonOrderStats } = await import("@/lib/amazon/sp-api");

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  let orders: unknown[];
  try {
    orders = await fetchOrders(yesterday, now);
  } catch (err) {
    // SP-API may 403 on some endpoints; fall back to stats
    const stats = await fetchAmazonOrderStats(1);
    const text = `Amazon (last 24h via stats): ${stats.totalOrders} orders, $${stats.totalRevenue.toFixed(2)} revenue.`;
    await writeBrainEntry(text, "amazon_orders", "sales_and_growth", { source: "amazon_orders_feed", ...stats });
    return { feed_key: "amazon_orders", success: true, entries_created: 1, error: null };
  }

  if (!orders?.length) return { feed_key: "amazon_orders", success: true, entries_created: 0, error: null };

  const revenue = orders.reduce((s: number, o: any) => s + parseFloat(o.OrderTotal?.Amount || "0"), 0);
  const text = `Amazon orders (last 24h): ${orders.length} orders, $${revenue.toFixed(2)} total revenue. Marketplace: US.`;

  await writeBrainEntry(text, "amazon_orders", "sales_and_growth", {
    source: "amazon_orders_feed",
    order_count: orders.length,
    revenue,
    period: "24h",
  });

  // Detect large orders
  for (const o of orders as any[]) {
    const amount = parseFloat(o.OrderTotal?.Amount || "0");
    if (amount > 50) {
      void emitSignal({
        signal_type: "large_order",
        source: "amazon",
        title: `Large Amazon order: $${amount.toFixed(2)}`,
        detail: `Order ${o.AmazonOrderId} — ${o.NumberOfItemsShipped || o.NumberOfItemsUnshipped || "?"} items`,
        severity: amount > 200 ? "warning" : "info",
        department: "sales_and_growth",
        metadata: { order_id: o.AmazonOrderId, amount },
      });
    }
  }

  return { feed_key: "amazon_orders", success: true, entries_created: 1, error: null };
}
```

### 32B — Amazon Inventory Feed

Add `handleAmazonInventoryFeed()`:

```typescript
async function handleAmazonInventoryFeed(): Promise<FeedResult> {
  const { fetchFBAInventory } = await import("@/lib/amazon/sp-api");

  try {
    const result = await fetchFBAInventory();
    if (!result.summaries?.length) return { feed_key: "amazon_inventory", success: true, entries_created: 0, error: null };

    let lowStockCount = 0;
    for (const item of result.summaries) {
      const qty = item.totalQuantity || 0;
      if (qty < 50) {
        lowStockCount++;
        void emitSignal({
          signal_type: "inventory_alert",
          source: "amazon",
          title: `Low FBA stock: ${item.fnSku || item.asin}`,
          detail: `${qty} units at FBA. ASIN: ${item.asin}`,
          severity: qty < 10 ? "critical" : "warning",
          department: "supply_chain",
          metadata: { asin: item.asin, fn_sku: item.fnSku, quantity: qty },
        });
      }
    }

    const text = `Amazon FBA inventory: ${result.summaries.length} SKUs tracked. ${lowStockCount} below safety stock.`;
    await writeBrainEntry(text, "inventory_snapshot", "supply_chain", {
      source: "amazon_inventory_feed",
      total_skus: result.summaries.length,
      low_stock_count: lowStockCount,
    });

    return { feed_key: "amazon_inventory", success: true, entries_created: 1, error: null };
  } catch (err) {
    // FBA inventory API may 403; degrade gracefully
    return { feed_key: "amazon_inventory", success: false, entries_created: 0, error: String(err) };
  }
}
```

### 32C — Register Amazon Feeds

Add new feed entries to the seed migration or add them programmatically:
- `amazon_orders` — daily
- `amazon_inventory` — daily

Update the `runFeed()` dispatcher to route to the new handlers.

**Commit message**: `Abra v2 Prompt 32: live Amazon feeds — orders and FBA inventory via SP-API`

---

## Prompt 33 — Live GA4 Feed

**Replace the GA4 stub with real Analytics Data API calls.**

### 33A — GA4 Data Fetcher Module

Create `src/lib/ops/abra-ga4-client.ts` (~120 lines):

```typescript
// Server-side GA4 reporting via service account
// Pattern from scripts/daily-report.mjs

type GA4Report = {
  sessions: number;
  pageViews: number;
  users: number;
  avgEngagementTime: number;
  topPages: Array<{ path: string; views: number }>;
  topSources: Array<{ source: string; medium: string; sessions: number }>;
  bounceRate: number;
};

export async function fetchGA4Report(params: {
  startDate: string;   // YYYY-MM-DD or "yesterday" or "NdaysAgo"
  endDate: string;
  propertyId?: string;
}): Promise<GA4Report>

export async function fetchGA4Realtime(propertyId?: string): Promise<{
  activeUsers: number;
  topPages: Array<{ path: string; activeUsers: number }>;
}>
```

**Implementation approach:**

The `googleapis` package is already a dependency (used in daily-report.mjs). Use the same pattern:

```typescript
import { google } from "googleapis";

function getAuth() {
  const credsJson = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (!credsJson) throw new Error("GA4_SERVICE_ACCOUNT_JSON not set");
  const credentials = JSON.parse(credsJson);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || "509104328";

export async function fetchGA4Report(params) {
  const auth = getAuth();
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });

  const [overview, pages, sources] = await Promise.all([
    analyticsData.properties.runReport({
      property: `properties/${PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "totalUsers" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
      },
    }),
    analyticsData.properties.runReport({
      property: `properties/${PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      },
    }),
    analyticsData.properties.runReport({
      property: `properties/${PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
        dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      },
    }),
  ]);

  // Parse and return GA4Report
}
```

### 33B — Real GA4 Traffic Feed

Replace `handleGA4TrafficFeed()` in `abra-auto-teach.ts`:

```typescript
async function handleGA4TrafficFeed(): Promise<FeedResult> {
  const { fetchGA4Report } = await import("@/lib/ops/abra-ga4-client");

  const report = await fetchGA4Report({ startDate: "yesterday", endDate: "yesterday" });

  const topPagesStr = report.topPages.slice(0, 5).map(p => `${p.path} (${p.views})`).join(", ");
  const topSourcesStr = report.topSources.slice(0, 3).map(s => `${s.source}/${s.medium} (${s.sessions})`).join(", ");

  const text = `GA4 traffic (yesterday): ${report.sessions} sessions, ${report.pageViews} pageviews, ${report.users} users. Avg engagement: ${report.avgEngagementTime.toFixed(0)}s. Bounce rate: ${(report.bounceRate * 100).toFixed(1)}%. Top pages: ${topPagesStr}. Top sources: ${topSourcesStr}.`;

  await writeBrainEntry(text, "traffic_report", "sales_and_growth", {
    source: "ga4_traffic_feed",
    ...report,
  });

  // Detect traffic anomalies (>50% drop or spike vs 7-day avg would need historical data)
  // For now, emit signal on very low traffic
  if (report.sessions < 10) {
    void emitSignal({
      signal_type: "traffic_anomaly",
      source: "ga4",
      title: "Unusually low traffic",
      detail: `Only ${report.sessions} sessions yesterday (expected 50+)`,
      severity: "warning",
      department: "sales_and_growth",
      metadata: { sessions: report.sessions },
    });
  }

  return { feed_key: "ga4_traffic", success: true, entries_created: 1, error: null };
}
```

### 33C — GA4 API Route (for dashboard)

Create `src/app/api/ops/abra/ga4/route.ts` (~50 lines):

- GET: `?period=yesterday` or `?period=7d` or `?period=30d`
- Returns GA4Report JSON
- Protected by auth session

**Commit message**: `Abra v2 Prompt 33: live GA4 feed via Analytics Data API + GA4 client module`

---

## Prompt 34 — Live Faire Feed

**Replace the Faire stub. Faire doesn't have a public API — use the credentials we have.**

### 34A — Faire Client Module

Create `src/lib/ops/abra-faire-client.ts` (~80 lines):

Faire's API is semi-private. Check if credentials exist at `~/.config/usa-gummies-mcp/.faire-credentials`. The feed should:

1. Check for `FAIRE_API_KEY` or `FAIRE_SESSION_TOKEN` env var
2. If available: make authenticated API calls to Faire's merchant API
3. If NOT available: gracefully return empty results with a note

```typescript
export async function fetchFaireOrders(params: {
  since?: string; // ISO date
}): Promise<FaireOrder[]>

export async function fetchFaireProducts(): Promise<FaireProduct[]>
```

Since Faire API access is uncertain, implement this as a **best-effort** module:
- Try the API if credentials exist
- Fall back to returning empty arrays
- Log to console what was attempted
- Never throw — always return gracefully

### 34B — Real Faire Feed Handler

Replace `handleFaireOrdersFeed()` in `abra-auto-teach.ts`:

- Import from `abra-faire-client.ts`
- If orders found: create brain entries with order details, revenue
- If no credentials: return `{ success: true, entries_created: 0, error: "Faire credentials not configured" }`

**Commit message**: `Abra v2 Prompt 34: Faire feed handler with graceful credential fallback`

---

## Prompt 35 — Anomaly Detection Engine

**Abra becomes proactive — watches KPIs and detects anomalies.**

### 35A — Anomaly Detection Module

Create `src/lib/ops/abra-anomaly-detection.ts` (~200 lines):

```typescript
export type Anomaly = {
  metric: string;
  department: string;
  current_value: number;
  expected_value: number;
  deviation_pct: number;   // percentage deviation from mean
  z_score: number;         // standard deviations from mean
  direction: "spike" | "drop";
  severity: "info" | "warning" | "critical";
  context: string;         // human-readable explanation
};

export async function detectAnomalies(): Promise<Anomaly[]>
export async function checkMetricAnomaly(metricName: string, currentValue: number, department: string): Promise<Anomaly | null>
```

**Detection logic:**

1. Query `kpi_timeseries` for each tracked metric (last 30 days of daily values)
2. Calculate rolling mean and standard deviation (7-day window)
3. Compare today's value against the rolling stats:
   - `|z_score| > 2.0` → warning
   - `|z_score| > 3.0` → critical
   - `|z_score| > 1.5` → info (notable but not alarming)
4. Direction: positive z = spike, negative z = drop
5. Generate human-readable context: "Revenue dropped 45% vs 7-day average ($X vs $Y expected)"

**Metrics to monitor:**
- `daily_revenue_shopify` — Shopify daily revenue
- `daily_revenue_amazon` — Amazon daily revenue
- `daily_sessions` — GA4 sessions
- `daily_orders` — total orders across channels
- `daily_aov` — average order value
- `conversion_rate` — if available

### 35B — Anomaly Scan API Route

Create `src/app/api/ops/abra/anomalies/route.ts` (~60 lines):

**GET** — Run anomaly detection, return results
**POST** (cron-protected) — Run detection + emit signals for each anomaly found

```typescript
// On POST, for each anomaly:
void emitSignal({
  signal_type: "metric_anomaly",
  source: "anomaly_detection",
  title: anomaly.context,
  detail: `${anomaly.metric}: ${anomaly.current_value} (expected ~${anomaly.expected_value.toFixed(0)}, z=${anomaly.z_score.toFixed(1)})`,
  severity: anomaly.severity,
  department: anomaly.department,
  metadata: anomaly,
});
```

### 35C — KPI Writer Helper

Create or enhance a helper to write daily KPI values to `kpi_timeseries`:

```typescript
export async function recordKPI(params: {
  metric_name: string;
  value: number;
  department?: string;
  date?: string; // defaults to today
}): Promise<void>
```

The live feeds (Prompts 31-33) should call this to record daily metrics so the anomaly detector has data to work with. Add `recordKPI()` calls to:
- Shopify orders feed → `daily_revenue_shopify`, `daily_orders_shopify`
- Amazon orders feed → `daily_revenue_amazon`, `daily_orders_amazon`
- GA4 feed → `daily_sessions`, `daily_pageviews`

**Commit message**: `Abra v2 Prompt 35: anomaly detection engine with z-score analysis and KPI recording`

---

## Prompt 36 — Daily Auto-Brief

**Every morning, Abra sends a Slack briefing summarizing overnight changes.**

### 36A — Morning Brief Module

Create `src/lib/ops/abra-morning-brief.ts` (~180 lines):

```typescript
export async function generateMorningBrief(): Promise<string>
export async function sendMorningBrief(): Promise<void>
```

`generateMorningBrief()` pulls together:

1. **Overnight signals** — `getActiveSignals({ limit: 20 })` from last 12 hours
2. **Anomalies** — run `detectAnomalies()` for any metric deviations
3. **Stale initiatives** — check for initiatives not updated in 7+ days
4. **Pending approvals** — count from `approvals` table where status = pending
5. **AI spend update** — `getMonthlySpend()` with budget percentage
6. **Yesterday's metrics** — GA4 sessions, Shopify revenue, Amazon revenue (from brain entries)
7. **Calendar** — if any sessions scheduled for today

Format as Slack message:
```
☀️ **Good morning, Ben. Here's your Abra brief for March 10, 2026.**

📊 **Yesterday's Numbers**
• Shopify: $X revenue (Y orders) — [▲/▼ vs 7-day avg]
• Amazon: $X revenue (Y orders) — [▲/▼ vs 7-day avg]
• Traffic: X sessions — [▲/▼ vs 7-day avg]

⚠️ **Signals (3 new overnight)**
• 🔴 Low FBA stock: USA Gummies 60ct (12 units)
• 🟡 Large Amazon order: $187.50
• 🟡 Payment mention in email from Powers Confections

📋 **Action Items**
• 2 pending approvals
• 1 stale initiative (Finance: "Chart of accounts" — 9 days)

💰 **AI Budget**: $45.20 / $1,000 (4.5%)

Reply here or in /ops/abra to take action.
```

`sendMorningBrief()`:
1. Calls `generateMorningBrief()`
2. Sends via `notify("daily", brief)`
3. Logs the cost

### 36B — Morning Brief Cron Route

Create `src/app/api/ops/abra/morning-brief/route.ts` (~40 lines):

- POST (cron-protected): triggers `sendMorningBrief()`
- Designed to be called at 8am PT via QStash

### 36C — Replace Legacy Daily Report

Add a note/comment in `scripts/daily-report.mjs` at the top:
```javascript
// LEGACY: This script is being replaced by Abra's morning brief system.
// See: src/lib/ops/abra-morning-brief.ts + /api/ops/abra/morning-brief
// The Abra version pulls from brain entries + anomaly detection for richer context.
```

**Commit message**: `Abra v2 Prompt 36: daily morning brief via Slack with metrics, signals, and actions`

---

## Prompt 37 — Action Execution Framework

**Abra can propose and execute actions with approval.**

### 37A — Action Registry

Create `src/lib/ops/abra-actions.ts` (~200 lines):

```typescript
export type AbraAction = {
  action_type: string;
  title: string;
  description: string;
  department: string;
  risk_level: "low" | "medium" | "high" | "critical";
  params: Record<string, unknown>;
  requires_approval: boolean;
};

export type ActionResult = {
  success: boolean;
  message: string;
  data?: unknown;
};

// Registry of available actions
const ACTION_HANDLERS: Record<string, (params: Record<string, unknown>) => Promise<ActionResult>> = {
  "send_slack": handleSendSlack,
  "send_email": handleSendEmail,
  "create_task": handleCreateTask,
  "update_notion": handleUpdateNotion,
  "create_brain_entry": handleCreateBrainEntry,
  "acknowledge_signal": handleAcknowledgeSignal,
  "pause_initiative": handlePauseInitiative,
};

export async function proposeAction(action: AbraAction): Promise<string>
// Creates an entry in `approvals` table with action details
// If requires_approval=false AND risk_level="low": execute immediately
// Otherwise: store and return approval ID

export async function executeAction(approvalId: string): Promise<ActionResult>
// Retrieves from approvals table, dispatches to handler

export function getAvailableActions(): string[]
```

### 37B — Action Handlers

Implement each handler:

```typescript
async function handleSendSlack(params: { channel: string; message: string }): Promise<ActionResult> {
  await notify(params.channel as "alerts" | "pipeline" | "daily", params.message);
  return { success: true, message: `Sent to Slack #${params.channel}` };
}

async function handleSendEmail(params: { to: string; subject: string; html: string }): Promise<ActionResult> {
  await sendOpsEmail({ to: params.to, subject: params.subject, html: params.html });
  return { success: true, message: `Email sent to ${params.to}` };
}

async function handleCreateTask(params: { title: string; department: string; priority?: string }): Promise<ActionResult> {
  // Insert into tasks table
}

async function handleAcknowledgeSignal(params: { signal_id: string }): Promise<ActionResult> {
  // Update abra_operational_signals set status='acknowledged'
}

async function handlePauseInitiative(params: { initiative_id: string }): Promise<ActionResult> {
  // Update abra_initiatives set status='paused'
}
```

### 37C — Chat Integration

Modify `src/app/api/ops/abra/chat/route.ts`:

When Abra determines an action should be taken (from the LLM response):
1. Parse action intents from the response (e.g., "I'll send a Slack alert" → `send_slack` action)
2. Call `proposeAction()` to either auto-execute (low risk) or queue for approval
3. Include the proposal status in the response: "I've queued a Slack alert for your approval" or "Done — sent to #alerts"

Add a tool/function-calling pattern:
- In the system prompt, list available actions
- Parse the LLM output for action blocks
- Execute via the action registry

### 37D — Action Execution Endpoint

Create `src/app/api/ops/abra/actions/route.ts` (~80 lines):

**POST** — Execute a proposed action:
```json
{ "approval_id": "...", "confirm": true }
```
- Validates the approval exists and is pending
- Calls `executeAction()`
- Returns result

**GET** — List available actions: returns `getAvailableActions()`

**Commit message**: `Abra v2 Prompt 37: action execution framework with approval flow`

---

## Prompt 38 — Scheduled Feed Orchestration

**Wire up QStash to trigger all feeds and checks on schedule.**

### 38A — Master Scheduler Route

Modify the existing scheduler or create `src/app/api/ops/abra/scheduler/route.ts` (~100 lines):

**POST** (cron-protected):

Runs the full daily automation cycle in sequence:
1. `runAllDueFeeds()` — pull data from all sources
2. `detectAnomalies()` → emit signals
3. `checkInitiativeHealth()` → auto-manage stale initiatives
4. `sendMorningBrief()` — if morning window (6am-10am PT)
5. `sendWeeklyDigest()` — if Monday
6. `sendMonthlyReport()` — if 1st of month

Returns summary of everything that ran.

### 38B — QStash Registration Script

Create `scripts/setup-qstash-schedules.mjs` (~60 lines):

Uses QStash API to register schedules:

```javascript
const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const BASE_URL = process.env.VERCEL_URL || "https://www.usagummies.com";

const schedules = [
  { url: `${BASE_URL}/api/ops/abra/scheduler`, cron: "0 15 * * *", name: "daily-automation" },
  // 3pm UTC = 8am PT
];

for (const s of schedules) {
  await fetch("https://qstash.upstash.io/v2/schedules", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      destination: s.url,
      cron: s.cron,
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    }),
  });
}
```

**Commit message**: `Abra v2 Prompt 38: scheduled feed orchestration with QStash setup`

---

## Prompt 39 — Conversation History

**Persistent chat threads and multi-session context.**

### 39A — Chat History Table Migration

Create `supabase/migrations/20260311000001_chat_history.sql`:

```sql
CREATE TABLE IF NOT EXISTS abra_chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL DEFAULT 'ben@usagummies.com',
  thread_id UUID NOT NULL DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  model_used TEXT,
  token_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_history_thread ON abra_chat_history(thread_id, created_at);
CREATE INDEX idx_chat_history_user ON abra_chat_history(user_email, created_at DESC);
```

### 39B — Chat History Module

Create `src/lib/ops/abra-chat-history.ts` (~100 lines):

```typescript
export async function saveMessage(params: {
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  model_used?: string;
  token_count?: number;
}): Promise<void>

export async function getThreadHistory(threadId: string, limit?: number): Promise<ChatMessage[]>

export async function getRecentThreads(userEmail: string, limit?: number): Promise<ThreadSummary[]>
// Returns last N threads with first message preview

export async function buildConversationContext(threadId: string, maxMessages?: number): Promise<Array<{ role: string; content: string }>>
// Formats history for LLM context window
```

### 39C — Integrate with Chat Route

Modify `src/app/api/ops/abra/chat/route.ts`:

1. Accept optional `thread_id` in request body
2. If `thread_id` provided: load history via `buildConversationContext()` and include as prior messages
3. If no `thread_id`: create a new one
4. After response: `void saveMessage(...)` for both user and assistant messages
5. Return `thread_id` in response for client to persist

### 39D — Chat UI Thread Support

Modify `src/app/ops/abra/AbraChat.client.tsx`:

1. Store `threadId` in component state
2. Pass to API calls
3. Add "New conversation" button that clears threadId
4. Optional: show recent threads sidebar

**Commit message**: `Abra v2 Prompt 39: persistent chat history with thread support`

---

## Prompt 40 — Financial Intelligence

**COGS tracking, margin analysis, revenue trends from real data.**

### 40A — Financial Analysis Module

Create `src/lib/ops/abra-financial-intel.ts` (~180 lines):

```typescript
export type RevenueSnapshot = {
  period: string;
  shopify_revenue: number;
  amazon_revenue: number;
  total_revenue: number;
  order_count: number;
  avg_order_value: number;
  vs_prior_period_pct: number;
};

export type MarginAnalysis = {
  estimated_cogs_per_unit: number;  // from product_config table
  estimated_gross_margin_pct: number;
  revenue: number;
  estimated_cogs: number;
  estimated_gross_profit: number;
};

export async function getRevenueSnapshot(period: "day" | "week" | "month"): Promise<RevenueSnapshot>
// Queries brain entries tagged with shopify/amazon revenue data
// Calculates totals and vs-prior-period comparison

export async function getMarginAnalysis(): Promise<MarginAnalysis>
// Pulls COGS from product_config table
// Estimates margins based on revenue and order mix

export async function getRevenueTimeline(days: number): Promise<Array<{ date: string; revenue: number; channel: string }>>
// Queries kpi_timeseries for revenue metrics
```

### 40B — Finance Dashboard API

Create `src/app/api/ops/abra/finance/route.ts` (~60 lines):

- GET: `?view=snapshot` | `?view=margins` | `?view=timeline&days=30`
- Returns financial analysis data

### 40C — Finance in Chat Context

Modify `src/lib/ops/abra-system-prompt.ts`:

Add financial context to the system prompt when questions are finance-related:
- Current month revenue (Shopify + Amazon)
- Estimated margins
- Budget utilization

**Commit message**: `Abra v2 Prompt 40: financial intelligence with revenue snapshots and margin analysis`

---

## Prompt 41 — Competitive Intelligence (Lightweight)

**Basic competitor monitoring — no scraping, just structured tracking.**

### 41A — Competitor Tracking Table

Create `supabase/migrations/20260311000002_competitive_intel.sql`:

```sql
CREATE TABLE IF NOT EXISTS abra_competitor_intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_name TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('pricing', 'product', 'promotion', 'review', 'market_position')),
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT,            -- "manual" | "web" | "marketplace"
  source_url TEXT,
  metadata JSONB DEFAULT '{}',
  department TEXT DEFAULT 'sales_and_growth',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT DEFAULT 'system'
);

CREATE INDEX idx_competitor_name ON abra_competitor_intel(competitor_name, created_at DESC);
```

### 41B — Competitor Intel API

Create `src/app/api/ops/abra/competitors/route.ts` (~80 lines):

**GET** — List competitor intelligence entries (filterable by competitor name, data_type)
**POST** — Add new intel entry (manual or from Abra chat)

### 41C — Chat Integration

Add competitor awareness to the chat:
- When user asks about competitors, query `abra_competitor_intel`
- Abra can create new intel entries when user shares competitive info in chat
- Include competitor context in department playbooks for sales_and_growth

**Commit message**: `Abra v2 Prompt 41: competitive intelligence tracking and chat integration`

---

## Prompt 42 — Phase 6-7 Integration Test Update

### 42A — Update Test Script

Modify `scripts/test-abra-v2.mjs`:

Add these test cases:

```javascript
// Phase 6 - Live feeds
{ name: "Shopify products feed", fn: testShopifyProductsFeed },
{ name: "Amazon orders feed", fn: testAmazonOrdersFeed },
{ name: "GA4 traffic feed", fn: testGA4Feed },
{ name: "Run all due feeds", fn: testRunAllDueFeeds },

// Phase 7 - Proactive intelligence
{ name: "Anomaly detection", fn: testAnomalyDetection },
{ name: "Morning brief generation", fn: testMorningBrief },
{ name: "Action proposal", fn: testActionProposal },
{ name: "Action execution", fn: testActionExecution },
{ name: "Chat history save/load", fn: testChatHistory },
{ name: "Revenue snapshot", fn: testRevenueSnapshot },
{ name: "Competitor intel CRUD", fn: testCompetitorIntel },
```

### 42B — Deploy New Migrations

Note in the test script header:
```javascript
// PREREQUISITE: Deploy migrations before testing:
// mv .env.local .env.local.bak && npx supabase db push && mv .env.local.bak .env.local
```

**Commit message**: `Abra v2 Prompt 42: integration test update for Phase 6-7 features`

---

## Per-Prompt Workflow

1. Read existing code before modifying
2. Implement
3. `npm run build` — fix errors, retry up to 3 times
4. `git add -A && git commit -m "Abra v2 Prompt [N]: [title]"`
5. Move to next prompt

---

## Code Style

- `@/` imports, `force-dynamic`, `runtime = "nodejs"`
- Fire-and-forget: `void asyncFn()` for non-critical ops
- Always try/catch in API routes
- Use existing `sbFetch`/Supabase patterns
- Use existing API clients — don't recreate
- Graceful degradation: if an external API fails, return empty results, don't crash

---

## Error Handling

- 3 build attempts per prompt, then skip
- If a package import fails, check if it's a real dependency before npm installing
- External API failures should degrade gracefully (return empty, log error)

---

## Final Checklist

1. `npm run build` — final verification
2. Do NOT `git push`
3. Do NOT `supabase db push`
4. Leave for review

---

## Go.

Start with Prompt 31. Work through to Prompt 42. Commit after each. Keep going.
