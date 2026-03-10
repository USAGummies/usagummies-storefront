# CODEX-ABRA-PHASE8.md — Activation & Hardening (Prompts 43-48)

> **Purpose**: Turn dormant features into battle-tested production systems.
> Every feed, scheduler, and pipeline built in Prompts 1-42 gets verified end-to-end,
> fixed where broken, and wired into production scheduling.

---

## Global Rules (apply to every prompt)

### Code Style
- TypeScript strict, no `any` except where existing code uses `// eslint-disable`
- Imports: `@/lib/...` alias (not relative `../../`)
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

### File Locations
- API routes: `src/app/api/ops/abra/<name>/route.ts`
- Lib modules: `src/lib/ops/abra-<name>.ts`
- Scripts: `scripts/<name>.mjs`
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql`

### Testing
No test suite. Validate with:
1. `npx tsc --noEmit` (type check)
2. `npm run build` (full build — must pass)
3. `node --check scripts/<file>.mjs` (syntax check for scripts)

### Commits
One commit per prompt. Message format: `Abra v2 Prompt <N>: <short description>`
Do NOT push. Do NOT log to Notion (403 — no comment permissions).

---

## Prompt 43 — Production Smoke Test Suite

**Goal**: Create a comprehensive smoke test that hits every live Abra endpoint and reports what's working vs broken.

### Create `scripts/abra-smoke-test.mjs`

This script tests every Abra API endpoint from outside the application (HTTP requests to localhost or production).

**Configuration**:
```javascript
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXTAUTH_URL || "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;
```

**Test Categories** (run sequentially, collect results):

1. **Health Checks** — verify each endpoint responds without 500:
   - `GET /api/ops/abra/auto-teach` (should return feed list or 401)
   - `POST /api/ops/abra/chat` with body `{ "message": "What is USA Gummies?" }` and `Authorization: Bearer ${CRON_SECRET}`
   - `GET /api/ops/abra/cost` with auth header
   - `GET /api/ops/abra/accuracy` with auth header
   - `POST /api/ops/abra/morning-brief` with auth header
   - `GET /api/ops/abra/finance` with auth header
   - `GET /api/ops/abra/competitors` with auth header
   - `GET /api/ops/abra/operational-signals` with auth header
   - `GET /api/ops/scheduler/master` with auth header

2. **Feed Tests** — run each feed individually via `POST /api/ops/abra/auto-teach?feed=<key>` with auth:
   - `shopify_orders`
   - `shopify_products`
   - `shopify_inventory`
   - `ga4_traffic`
   - `amazon_orders`
   - `amazon_inventory`
   - `faire_orders`
   - `inventory_alerts`

3. **Supabase Connectivity** — verify tables exist:
   - Query `open_brain_entries` (count)
   - Query `abra_auto_teach_feeds` (list all, show last_run_at)
   - Query `kpi_timeseries` (count last 7 days)
   - Query `abra_operational_signals` (count active)
   - Query `abra_chat_history` (count)
   - Query `abra_competitor_intel` (count)
   - Query `integration_health` (list all with status)

4. **External API Connectivity**:
   - Test OpenAI embedding: call `generateEmbedding("test")` — just import and call, catch errors
   - Test Anthropic: try a 10-token completion, catch errors
   - Test Shopify Admin: `GET /admin/api/2024-10/shop.json` with admin token
   - Test Amazon SP-API: call `isAmazonConfigured()` then `getAccessToken()` if configured
   - Test GA4: try `fetchGA4Report()` for yesterday (import from `@/lib/ops/abra-ga4-client`)

**Output Format**:
```
═══════════════════════════════════════════
  ABRA V2 SMOKE TEST — <date>
═══════════════════════════════════════════

ENDPOINT HEALTH:
  ✅ /api/ops/abra/chat ............... 200 (1.2s)
  ❌ /api/ops/abra/morning-brief ...... 500 (0.8s) — "missing kpi data"
  ⚠️  /api/ops/abra/finance ........... 200 (3.1s) — slow

FEED TESTS:
  ✅ shopify_orders ................... 3 entries created
  ❌ amazon_orders .................... error: "LWA token exchange failed"
  ⏭️  faire_orders .................... skipped (not configured)

SUPABASE TABLES:
  ✅ open_brain_entries ............... 847 rows
  ✅ kpi_timeseries .................. 42 rows (7d)

EXTERNAL APIS:
  ✅ OpenAI embeddings ............... ok (0.3s)
  ✅ Anthropic Claude ................ ok (0.9s)
  ❌ Amazon SP-API ................... LWA_CLIENT_ID not set

SUMMARY: 18/24 passed, 4 failed, 2 skipped
═══════════════════════════════════════════
```

**Implementation notes**:
- Use `fetch()` for HTTP calls (Node 18+ built-in)
- For library imports, use dynamic `import()` since this is an .mjs file
- Wrap every test in try/catch — a single failure must not abort the suite
- Exit code 0 if >80% pass, exit code 1 otherwise
- Also send a summary to Slack via `fetch(process.env.SLACK_SUPPORT_WEBHOOK_URL, { method: "POST", body: JSON.stringify({ text: summaryText }) })`

### Also update `scripts/test-abra-v2.mjs`
Add a new test group `"Phase 8: Smoke Test Infrastructure"` that verifies `scripts/abra-smoke-test.mjs` passes syntax check.

**Commit**: `Abra v2 Prompt 43: production smoke test suite`

---

## Prompt 44 — Email Intelligence Pipeline

**Goal**: Wire Gmail → Supabase `email_events` → signal extraction → brain entries. Make the email feed run on schedule.

### Context
- `src/lib/ops/gmail-reader.ts` EXISTS with `listEmails()`, `readEmail()`, `searchEmails()`
- Auth: `GMAIL_SERVICE_ACCOUNT_JSON` (domain-wide delegation) or `GMAIL_OAUTH_*` tokens
- `src/app/api/ops/abra/email-ingest/route.ts` EXISTS — processes `email_events` rows → signals
- Missing: a route that FETCHES emails from Gmail and INSERTS them into `email_events`

### Create `src/app/api/ops/abra/email-fetch/route.ts`

**Endpoint**: `POST /api/ops/abra/email-fetch`
**Auth**: `Authorization: Bearer ${CRON_SECRET}`
**Runtime**: `nodejs`, `force-dynamic`, `maxDuration = 60`

**Logic**:
1. Import `listEmails`, `readEmail` from `@/lib/ops/gmail-reader`
2. Fetch last 50 emails from INBOX (unread + recent read): `listEmails({ count: 50 })`
3. For each envelope, check if `email_events` already has a row with matching `message_id` (the Gmail message ID):
   ```sql
   SELECT id FROM email_events WHERE message_id = $1
   ```
   If the `message_id` column doesn't exist, add it (see migration below).
4. For new emails only, call `readEmail(envelope.id)` to get full body
5. Classify email using a lightweight prompt to Claude (or pattern matching):
   - Categories: `finance`, `sales`, `production`, `regulatory`, `customer`, `marketing`, `spam`, `other`
   - Priority: `high`, `medium`, `low`
   - `action_required`: boolean
6. Insert into `email_events`:
   ```sql
   INSERT INTO email_events (message_id, sender_email, sender_name, subject, raw_text, category, priority, action_required, received_at)
   ```
7. After all inserts, call the existing email-ingest endpoint logic inline:
   - For each new email, run `extractEmailSignals()` and `emitSignal()` (same as email-ingest/route.ts)
8. Return: `{ fetched: number, new: number, signals: number }`

### Migration `supabase/migrations/20260311000004_email_message_id.sql`

```sql
-- Add message_id column for Gmail dedup
ALTER TABLE public.email_events
  ADD COLUMN IF NOT EXISTS message_id TEXT UNIQUE;

-- Index for fast dedup lookups
CREATE INDEX IF NOT EXISTS idx_email_events_message_id
  ON public.email_events(message_id) WHERE message_id IS NOT NULL;
```

### Register as auto-teach feed

Add `email_fetch` to the feed handler map in `src/lib/ops/abra-auto-teach.ts`:

```typescript
// In the handlers dict:
email_fetch: handleEmailFetchFeed,
```

Create `handleEmailFetchFeed()` function that calls `POST /api/ops/abra/email-fetch` internally (or directly runs the logic) and returns a `FeedResult`.

### Seed the feed in Supabase

Insert into `abra_auto_teach_feeds`:
```sql
INSERT INTO abra_auto_teach_feeds (feed_key, feed_name, source_type, schedule_cron, is_active)
VALUES ('email_fetch', 'Gmail Email Fetch', 'email', '0 */4 * * *', true)
ON CONFLICT (feed_key) DO NOTHING;
```
(Run every 4 hours)

### Fallback behavior
If Gmail credentials aren't configured (`listEmails` throws), the feed should return `{ feed_key: "email_fetch", success: true, entriesCreated: 0, error: "Gmail not configured — skipping" }` — do NOT fail the feed.

**Commit**: `Abra v2 Prompt 44: email intelligence pipeline with Gmail fetch and signal extraction`

---

## Prompt 45 — Amazon SP-API Activation & Hardening

**Goal**: End-to-end verify Amazon integration, add retry resilience, and ensure feeds produce real data.

### Context
- `src/lib/amazon/sp-api.ts` EXISTS with full implementation
- Required env vars: `LWA_CLIENT_ID`, `LWA_CLIENT_SECRET`, `LWA_REFRESH_TOKEN`, `MARKETPLACE_ID`, `SP_API_ENDPOINT`
- `isAmazonConfigured()` checks for these vars
- `getAccessToken()` does LWA token exchange with 50-min cache
- `fetchOrders()` and `fetchFBAInventory()` have retry logic (3 attempts, rate-limit aware)
- Feed handlers `handleAmazonOrdersFeed()` and `handleAmazonInventoryFeed()` exist in auto-teach

### Update `src/lib/amazon/sp-api.ts`

1. **Add connection test function**:
```typescript
export async function testAmazonConnection(): Promise<{
  configured: boolean;
  tokenOk: boolean;
  ordersOk: boolean;
  inventoryOk: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  if (!isAmazonConfigured()) return { configured: false, tokenOk: false, ordersOk: false, inventoryOk: false, errors: ["SP-API env vars not set"] };

  let tokenOk = false;
  try {
    await getAccessToken();
    tokenOk = true;
  } catch (e) { errors.push(`Token: ${e instanceof Error ? e.message : String(e)}`); }

  let ordersOk = false;
  try {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24*60*60*1000);
    await fetchOrders(dayAgo.toISOString(), now.toISOString());
    ordersOk = true;
  } catch (e) { errors.push(`Orders: ${e instanceof Error ? e.message : String(e)}`); }

  let inventoryOk = false;
  try {
    const inv = await fetchFBAInventory();
    inventoryOk = !inv.error;
    if (inv.error) errors.push(`Inventory: ${inv.error}`);
  } catch (e) { errors.push(`Inventory: ${e instanceof Error ? e.message : String(e)}`); }

  return { configured: true, tokenOk, ordersOk, inventoryOk, errors };
}
```

2. **Harden `fetchOrders` error messages**:
   - If 403 Forbidden on orders endpoint, log: `"SP-API Orders 403 — check IAM role or app registration"`
   - If token exchange fails, log specific LWA error response body

3. **Add `updateIntegrationHealth()` calls**:
   After successful/failed API calls in the feed handlers (`handleAmazonOrdersFeed`, `handleAmazonInventoryFeed`), update the `integration_health` table:
```typescript
// On success:
await supabase.from("integration_health")
  .upsert({ system_name: "amazon", connection_status: "connected", last_success_at: new Date().toISOString(), error_summary: null, retry_count: 0 }, { onConflict: "system_name" });

// On failure:
await supabase.from("integration_health")
  .upsert({ system_name: "amazon", connection_status: "error", last_error_at: new Date().toISOString(), error_summary: errMsg }, { onConflict: "system_name" });
```

### Create `src/app/api/ops/abra/integration-test/route.ts`

**Endpoint**: `GET /api/ops/abra/integration-test`
**Auth**: `Authorization: Bearer ${CRON_SECRET}`

Tests all external integrations and returns status:
```typescript
// Test each service in parallel:
const [amazon, shopify, ga4, openai, supabaseOk, slack] = await Promise.allSettled([
  testAmazonConnection(),
  testShopifyConnection(),
  testGA4Connection(),
  testOpenAIConnection(),
  testSupabaseConnection(),
  testSlackConnection(),
]);
```

For each test, update `integration_health` table. Return JSON summary.

Helper functions (create in `src/lib/ops/abra-integration-test.ts`):
- `testShopifyConnection()`: `GET /admin/api/2024-10/shop.json` with `SHOPIFY_ADMIN_TOKEN`
- `testGA4Connection()`: try `fetchGA4Report()` for yesterday from `abra-ga4-client`
- `testOpenAIConnection()`: generate one embedding for "test"
- `testSupabaseConnection()`: query `SELECT 1` from `open_brain_entries` limit 1
- `testSlackConnection()`: POST a test message to webhook (use `[TEST]` prefix, or skip if you don't want noise)

### Update feed handlers to report integration health

In `src/lib/ops/abra-auto-teach.ts`, after each feed runs, update `integration_health`:
- `shopify_orders` / `shopify_products` / `shopify_inventory` → update `system_name: "shopify"`
- `amazon_orders` / `amazon_inventory` → update `system_name: "amazon"`
- `ga4_traffic` → update `system_name: "ga4_analytics"` (note: the seeded row may be a different name — check and use whatever exists)
- `faire_orders` → update `system_name: "faire"`
- `email_fetch` → update `system_name: "gmail"`

Pattern (add as utility in auto-teach):
```typescript
async function updateIntHealth(systemName: string, success: boolean, error?: string): Promise<void> {
  try {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    await sb.from("integration_health").upsert({
      system_name: systemName,
      connection_status: success ? "connected" : "error",
      ...(success ? { last_success_at: new Date().toISOString(), error_summary: null } : { last_error_at: new Date().toISOString(), error_summary: error?.slice(0, 500) }),
      updated_at: new Date().toISOString(),
    }, { onConflict: "system_name" });
  } catch { /* best-effort */ }
}
```

**Commit**: `Abra v2 Prompt 45: Amazon SP-API activation and integration health tracking`

---

## Prompt 46 — Feed Completion & Dead Letter Queue

**Goal**: Ensure all 8+ feeds are fully functional with proper error recovery. Add a dead letter mechanism for persistently failing feeds.

### Create migration `supabase/migrations/20260311000005_feed_dead_letters.sql`

```sql
-- Dead letter queue for failed feed runs
CREATE TABLE IF NOT EXISTS public.abra_feed_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key TEXT NOT NULL,
  error_message TEXT,
  error_stack TEXT,
  feed_snapshot JSONB,
  retry_count INTEGER DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_dead_letters_unresolved
  ON public.abra_feed_dead_letters(feed_key, resolved) WHERE NOT resolved;

-- Add consecutive_failures column to auto_teach_feeds if not exists
ALTER TABLE public.abra_auto_teach_feeds
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0;

-- Auto-disable feeds after 5 consecutive failures
-- (enforced in code, not trigger — Supabase free tier)
```

### Update `src/lib/ops/abra-auto-teach.ts`

1. **Add dead letter writing**:
```typescript
async function writeDeadLetter(feedKey: string, error: string, stack?: string): Promise<void> {
  try {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    await sb.from("abra_feed_dead_letters").insert({
      feed_key: feedKey,
      error_message: error.slice(0, 1000),
      error_stack: stack?.slice(0, 2000),
    });
  } catch { /* best-effort */ }
}
```

2. **Update `runFeed()` to track consecutive failures**:
After a feed fails:
- Increment `consecutive_failures` on `abra_auto_teach_feeds`
- If `consecutive_failures >= 5`, set `is_active = false` and write dead letter
- Send Slack alert: `notify({ channel: "alerts", text: "🚨 Feed ${feedKey} disabled after 5 consecutive failures: ${error}" })`

After a feed succeeds:
- Reset `consecutive_failures = 0`

3. **Add dead letter resolution function**:
```typescript
export async function resolveDeadLetter(id: string): Promise<boolean>
export async function getUnresolvedDeadLetters(): Promise<DeadLetter[]>
```

### Create `src/app/api/ops/abra/feed-health/route.ts`

**Endpoint**: `GET /api/ops/abra/feed-health`
**Auth**: session or CRON_SECRET

Returns:
```typescript
{
  feeds: Array<{
    feed_key: string;
    is_active: boolean;
    last_run_at: string | null;
    last_status: string | null;
    consecutive_failures: number;
    schedule_cron: string;
  }>;
  dead_letters: Array<{
    id: string;
    feed_key: string;
    error_message: string;
    created_at: string;
    retry_count: number;
  }>;
  summary: {
    total_feeds: number;
    active: number;
    disabled: number;
    unresolved_dead_letters: number;
  };
}
```

### Verify all feed handlers handle missing credentials gracefully

Review each handler in `abra-auto-teach.ts`. Every handler must:
1. Check if the required service is configured (e.g., `isAmazonConfigured()`)
2. If not configured, return `{ feed_key, success: true, entriesCreated: 0, error: "<service> not configured" }` — NOT a failure
3. Only count as failure if credentials exist but the API call fails

**Commit**: `Abra v2 Prompt 46: feed dead letter queue and consecutive failure auto-disable`

---

## Prompt 47 — Integration Health Dashboard & Alerting

**Goal**: Surface integration health in the ops dashboard and set up automated alerting for failures.

### Create `src/lib/ops/abra-health-monitor.ts`

**Exports**:

```typescript
export type IntegrationStatus = {
  system_name: string;
  connection_status: "connected" | "expired" | "error" | "not_configured";
  last_success_at: string | null;
  last_error_at: string | null;
  error_summary: string | null;
  retry_count: number;
};

export type SystemHealth = {
  integrations: IntegrationStatus[];
  feeds: FeedHealthSummary;
  uptime: { healthy: number; degraded: number; down: number };
  last_checked: string;
};

export async function getSystemHealth(): Promise<SystemHealth>
export async function checkAndAlertHealth(): Promise<void>
```

**`checkAndAlertHealth()` logic**:
1. Fetch all rows from `integration_health`
2. For any integration where `connection_status = "error"` AND `last_error_at` is within the last hour:
   - Send Slack alert: `notify({ channel: "alerts", text: "⚠️ ${system_name} integration is DOWN: ${error_summary}" })`
3. Fetch feed health (active feeds with `consecutive_failures > 0`)
4. For disabled feeds, alert once (check if already alerted by looking at dead letters)

### Create `src/app/api/ops/abra/health/route.ts`

**Endpoint**: `GET /api/ops/abra/health`
**Auth**: session or CRON_SECRET

Returns full `SystemHealth` object from `getSystemHealth()`.

Also supports `POST` for triggering `checkAndAlertHealth()` (cron use).

### Update the master scheduler

In `src/app/api/ops/scheduler/master/route.ts`, add a health check step in the GET handler:

```typescript
// After dispatching agents, check integration health
try {
  const { checkAndAlertHealth } = await import("@/lib/ops/abra-health-monitor");
  await checkAndAlertHealth();
} catch (e) {
  console.error("[scheduler] Health check failed:", e);
}
```

This runs once daily at 6am UTC (the cron schedule).

### Add health widget to ops dashboard

In `src/app/ops/dashboard/page.tsx` (or the main ops landing page), add a health status section:
- Fetch from `/api/ops/abra/health`
- Show integration status grid: green dot = connected, yellow = expired, red = error, gray = not_configured
- Show feed status: active count, last run times, any disabled feeds
- Show dead letter count (if > 0, show warning badge)

Use the existing inline styling pattern from the ops dashboard (no external UI library — the codebase uses custom styled components with Tailwind/inline styles).

**Commit**: `Abra v2 Prompt 47: integration health monitor with dashboard widget and Slack alerting`

---

## Prompt 48 — QStash Schedule Activation & Orchestration

**Goal**: Activate all scheduled feeds and the morning brief via QStash. Verify the full daily automation cycle works end-to-end.

### Context
- `scripts/setup-qstash-schedules.mjs` EXISTS — currently registers ONE schedule (`abra-daily-automation`)
- `vercel.json` has ONE cron: `0 6 * * *` → `/api/ops/scheduler/master`
- QStash token: `QSTASH_TOKEN` env var
- Vercel Hobby plan: 1 cron job max

### Update `scripts/setup-qstash-schedules.mjs`

Replace the single schedule with a complete set:

```javascript
const SCHEDULES = [
  // Morning brief — 7:15am PT (14:15 UTC)
  { name: "abra-morning-brief", url: `${BASE_URL}/api/ops/abra/morning-brief`, cron: "15 14 * * *" },

  // Feed orchestration — staggered through the day
  // 6am PT (13:00 UTC) — Shopify orders
  { name: "abra-feed-shopify-orders", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=shopify_orders`, cron: "0 13 * * *" },
  // 6:10am PT — Amazon orders
  { name: "abra-feed-amazon-orders", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=amazon_orders`, cron: "10 13 * * *" },
  // 6:20am PT — Shopify products
  { name: "abra-feed-shopify-products", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=shopify_products`, cron: "20 13 * * *" },
  // 6:30am PT — Shopify inventory
  { name: "abra-feed-shopify-inventory", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=shopify_inventory`, cron: "30 13 * * *" },
  // 6:40am PT — Amazon inventory
  { name: "abra-feed-amazon-inventory", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=amazon_inventory`, cron: "40 13 * * *" },
  // 10pm PT (05:00 UTC) — GA4 traffic (after day ends)
  { name: "abra-feed-ga4-traffic", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=ga4_traffic`, cron: "0 5 * * *" },
  // Every 4 hours — Email fetch
  { name: "abra-feed-email-fetch", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=email_fetch`, cron: "0 */4 * * *" },
  // 7am PT (14:00 UTC) — Faire orders (if configured)
  { name: "abra-feed-faire-orders", url: `${BASE_URL}/api/ops/abra/auto-teach?feed=faire_orders`, cron: "0 14 * * *" },

  // Health check — noon PT (19:00 UTC)
  { name: "abra-health-check", url: `${BASE_URL}/api/ops/abra/health`, cron: "0 19 * * *", method: "POST" },

  // Weekly digest — Monday 8am PT (15:00 UTC)
  { name: "abra-weekly-digest", url: `${BASE_URL}/api/ops/abra/digest?type=weekly`, cron: "0 15 * * 1" },
];
```

**Implementation**:
1. First, list existing QStash schedules and delete stale ones
2. Create each schedule with proper headers (`Authorization: Bearer ${CRON_SECRET}`, `Content-Type: application/json`)
3. Print summary table showing all registered schedules
4. Verify each schedule was created successfully

**QStash API reference**:
- Create: `POST https://qstash.upstash.io/v2/schedules` with body `{ destination, cron, headers }`
- List: `GET https://qstash.upstash.io/v2/schedules`
- Delete: `DELETE https://qstash.upstash.io/v2/schedules/{scheduleId}`
- Auth: `Authorization: Bearer ${QSTASH_TOKEN}`

### Create `src/app/api/ops/abra/scheduler/route.ts`

This is the endpoint QStash calls (distinct from `/scheduler/master`).

**Endpoint**: `POST /api/ops/abra/scheduler`
**Auth**: Verify QStash signature OR `CRON_SECRET`

**Logic**:
1. Parse the request to determine what to run (the URL path already specifies via `?feed=` param on auto-teach, or the specific endpoint)
2. For the general scheduler endpoint (no specific feed): run `runAllDueFeeds()` from auto-teach
3. Log the run to Vercel KV state (run-ledger)
4. Return success/failure

### Update `scripts/test-abra-v2.mjs`

Add test group `"Phase 8: Schedule Activation"`:
- Verify `scripts/setup-qstash-schedules.mjs` syntax
- Verify `scripts/abra-smoke-test.mjs` syntax
- List expected schedule count (11 schedules)

### Create verification script `scripts/verify-schedules.mjs`

Quick script that:
1. Calls QStash API to list all schedules
2. Prints each schedule with name, cron, destination URL, and last execution time
3. Flags any missing schedules from the expected list

**Commit**: `Abra v2 Prompt 48: QStash schedule activation with full feed orchestration`

---

## Execution Order

Run prompts in order: **43 → 44 → 45 → 46 → 47 → 48**

After each prompt:
1. Run `npx tsc --noEmit` — fix any type errors
2. Run `npm run build` — must pass
3. Commit with message format: `Abra v2 Prompt <N>: <description>`

After ALL prompts complete:
1. Run `node --check scripts/abra-smoke-test.mjs`
2. Run `node --check scripts/setup-qstash-schedules.mjs`
3. Run `node --check scripts/verify-schedules.mjs`
4. Final `npm run build` — must pass
5. Do NOT push. Do NOT create branches.

---

## Environment Variables Referenced

These must exist in `.env.local` and Vercel production:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key |
| `OPENAI_API_KEY` | Embeddings + fallback LLM |
| `ANTHROPIC_API_KEY` | Claude primary LLM |
| `CRON_SECRET` | Route authentication |
| `QSTASH_TOKEN` | QStash schedule management |
| `SHOPIFY_ADMIN_TOKEN` | Shopify Admin API |
| `SHOPIFY_STORE` | Store domain |
| `LWA_CLIENT_ID` | Amazon SP-API OAuth |
| `LWA_CLIENT_SECRET` | Amazon SP-API OAuth |
| `LWA_REFRESH_TOKEN` | Amazon SP-API OAuth |
| `SLACK_SUPPORT_WEBHOOK_URL` | Slack notifications |
| `GMAIL_SERVICE_ACCOUNT_JSON` | Gmail API (optional) |
| `GMAIL_OAUTH_CLIENT_ID` | Gmail OAuth (optional) |
| `GMAIL_OAUTH_CLIENT_SECRET` | Gmail OAuth (optional) |
| `GMAIL_OAUTH_REFRESH_TOKEN` | Gmail OAuth (optional) |
| `GA4_SERVICE_ACCOUNT_JSON` | GA4 analytics (optional for feed) |
| `GA4_PROPERTY_ID` | GA4 property (optional for feed) |
| `NEXTAUTH_URL` or `VERCEL_URL` | Base URL for QStash callbacks |
