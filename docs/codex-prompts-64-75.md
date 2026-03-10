# Codex Prompts 64–75: Hardening & Activation

> **Context**: Prompts 1–63 built the full Abra v2 platform (45 API routes, 30+ lib modules, 27 Supabase migrations). All code compiles (`npm run build` = 0 errors), all Supabase tables are deployed, and Vercel production is live. BUT — no end-to-end runtime validation has been done. These prompts harden what exists before adding features.

---

## Prompt 64: Production Auth Fix + Smoke Test Suite

**Goal**: Fix CRON_SECRET auth on production and create a runnable smoke test script.

**Context**: All 45 Abra API routes return 401 Unauthorized even with correct CRON_SECRET. The `isCronAuthorized()` pattern compares `Bearer <secret>` but the Vercel CRON_SECRET env var may have trailing whitespace (known issue — MEMORY.md documents this). Also, Vercel's built-in cron calls use the `Authorization` header automatically.

**Tasks**:

1. In every `isCronAuthorized()` function across all Abra route files, add `.trim()` to both the secret and the header comparison:
   ```typescript
   function isCronAuthorized(req: Request): boolean {
     const secret = process.env.CRON_SECRET?.trim();
     const authHeader = req.headers.get("authorization")?.trim();
     if (!secret) return false;
     return authHeader === `Bearer ${secret}`;
   }
   ```
   Better yet — extract this to a shared utility `src/lib/ops/abra-auth.ts` and import it everywhere instead of duplicating.

2. Create `scripts/production-smoke-test.mjs` that:
   - Reads CRON_SECRET from `.env.local`
   - Hits these endpoints against `https://www.usagummies.com` (or `$VERCEL_URL`):
     - `GET /api/ops/abra/health` — expect 200, JSON with `status` field
     - `GET /api/ops/abra/integration-test` — expect 200, JSON with test results
     - `POST /api/ops/abra/chat` with `{"message":"What company is this?"}` — expect 200, response mentioning "USA Gummies" or "candy"
     - `GET /api/ops/abra/initiative?department=finance` — expect 200, JSON array
     - `GET /api/ops/abra/cost` — expect 200, JSON with `total_cost` field
     - `GET /api/ops/abra/session` — expect 200
   - Prints pass/fail for each with response time
   - Exits with code 1 if any fail

3. Run the smoke test. Fix any 500s that appear (they'll be runtime errors — missing env vars, wrong Supabase table references, etc.).

**Verification**: `node scripts/production-smoke-test.mjs` — all green.

---

## Prompt 65: Chat Endpoint Runtime Validation

**Goal**: Verify the core chat flow works end-to-end — user sends message → brain search → Claude response → cost logged.

**Context**: `src/app/api/ops/abra/chat/route.ts` is the most critical endpoint. It uses `searchTiered()` from `abra-memory-tiers.ts`, builds a dynamic system prompt from `abra-system-prompt.ts`, calls Claude, and should log cost to `abra_cost_log`. None of this has been runtime-tested on production.

**Tasks**:

1. Send these test messages via the chat endpoint (using CRON_SECRET auth) and verify responses:
   - "What does USA Gummies sell?" → should mention candy/confectionery, NOT vitamins
   - "Who is the founder?" → should mention Ben Stutman
   - "What's our Amazon category?" → should mention Grocery & Gourmet Food
   - "Get finance under control" → should trigger initiative flow (intent detection)
   - "How much are we spending on AI?" → should return cost data

2. After each call, verify:
   - `abra_cost_log` has a new entry (query Supabase directly)
   - `abra_chat_history` has the message saved (if chat history is enabled)
   - Response sources include brain entries with `temporal_score` values

3. Fix any failures:
   - If brain search returns empty: check that `search_temporal_tiered` RPC works with actual embeddings
   - If Claude call fails: check ANTHROPIC_API_KEY in Vercel env vars
   - If cost logging fails: check `abra_cost_log` insert permissions
   - If intent detection doesn't trigger for "get finance under control": check the regex in chat route

**Verification**: All 5 test messages return correct responses. `abra_cost_log` has 5+ new entries.

---

## Prompt 66: Initiative Flow End-to-End

**Goal**: Verify the complete initiative lifecycle: create → research → questions → answer → plan.

**Context**: The initiative system (`/api/ops/abra/initiative/route.ts`) is the crown jewel of v2 — "Abra, get finance under control" should start a research-backed planning flow. Department playbooks exist in `src/lib/ops/department-playbooks.ts`. But this flow has never been tested.

**Tasks**:

1. Create a finance initiative via API:
   ```
   POST /api/ops/abra/initiative
   { "department": "finance", "goal": "Get finance under control" }
   ```

2. Verify the response includes:
   - Initiative record with status `researching` or `asking_questions`
   - Baseline requirements from the finance playbook
   - Clarifying questions (accounting basis, fiscal year, etc.)

3. Answer the questions:
   ```
   PATCH /api/ops/abra/initiative
   { "id": "<initiative_id>", "answers": {
     "accounting_basis": "accrual",
     "fiscal_year": "calendar",
     "tax_structure": "LLC",
     "revenue_streams": "DTC, Amazon, Wholesale, Faire"
   }}
   ```

4. Verify a plan is generated with:
   - Tasks array (QuickBooks setup, chart of accounts, etc.)
   - KPIs (monthly_close_time, cash_runway_days, etc.)
   - Status updated to `approved` or `planning`

5. Fix any failures. Common issues:
   - Department playbook not found → check department name casing
   - Research endpoint fails → check ANTHROPIC_API_KEY
   - Task generation fails → check Claude prompt in initiative route

**Verification**: Finance initiative created with full plan, visible in `abra_initiatives` table.

---

## Prompt 67: Session/Meeting Flow

**Goal**: Verify sessions work: start → agenda → notes → action items → end.

**Context**: `src/app/api/ops/abra/session/route.ts` manages meetings. Starting a session should auto-generate an agenda from open initiative questions, unanswered questions, and active tasks.

**Tasks**:

1. Start a finance meeting:
   ```
   POST /api/ops/abra/session
   { "department": "finance", "session_type": "meeting" }
   ```

2. Verify response includes auto-generated agenda

3. Add meeting notes:
   ```
   PATCH /api/ops/abra/session
   { "id": "<session_id>", "notes": ["Decided to use accrual accounting"], "decisions": ["Use QuickBooks Online"], "action_items": ["Set up QuickBooks by end of week"] }
   ```

4. End the session:
   ```
   POST /api/ops/abra/session/end (or PATCH with status: "completed")
   ```

5. Verify:
   - Session notes saved as brain entries (with embeddings) in `open_brain_entries`
   - Action items created as tasks
   - Session marked completed in `abra_sessions`

**Verification**: Session lifecycle complete, notes searchable in brain.

---

## Prompt 68: Slack Integration Validation

**Goal**: Verify Slack commands work with the new v2 features.

**Context**: Slack integration uses `/api/ops/slack/abra/route.ts` (Events API) and the original `/api/ops/slack/route.ts`. The Slack Events API handler needs to parse commands like `@Abra get finance under control` and route them to the initiative system.

**Tasks**:

1. Review the Slack route handler for v2 intent detection (initiative triggers, session triggers, cost triggers)
2. If intent detection is missing from the Slack handler, add it — mirror the same patterns from the chat route
3. Verify the Slack webhook is configured to point to the correct production URL
4. Test these Slack messages (or simulate them via curl with Slack's request format):
   - `@Abra what does USA Gummies sell?` → normal Q&A
   - `@Abra get finance under control` → should start initiative
   - `@Abra how much are we spending on AI?` → cost report
5. Verify Slack responses are properly formatted (blocks, not raw text)

**Verification**: Slack commands work for Q&A, initiatives, and cost queries.

---

## Prompt 69: Feed System Activation

**Goal**: Verify the data feed system works — Shopify, Amazon, GA4 feeds pull real data.

**Context**: Prompts 31-34 built live feeds for Shopify (products, orders, inventory), Amazon (orders, FBA inventory), GA4 (traffic), and Faire. These write to `abra_auto_teach_feeds` / `abra_knowledge_feeds` and ultimately to brain entries. The feed orchestrator is in `src/lib/ops/abra-feed-orchestrator.ts`.

**Tasks**:

1. Check each feed handler exists and compiles:
   - `src/app/api/ops/abra/feeds/shopify/route.ts`
   - `src/app/api/ops/abra/feeds/amazon/route.ts`
   - `src/app/api/ops/abra/feeds/ga4/route.ts`
   - `src/app/api/ops/abra/feeds/faire/route.ts`

2. Trigger each feed manually (via API or script):
   - Shopify feed: should pull products and recent orders from Shopify Admin API
   - GA4 feed: should pull traffic data from GA4 Data API
   - Amazon feed: may fail if SP-API token is expired (expected — log the error gracefully)
   - Faire feed: may fail if credentials aren't configured (expected — log gracefully)

3. For Shopify and GA4 (which have valid credentials):
   - Verify data is written to the appropriate Supabase tables
   - Verify no 500 errors in the response

4. For Amazon and Faire:
   - Verify graceful failure (4xx with helpful error message, not 500 crash)
   - Ensure `abra_feed_dead_letters` receives the failed item

**Verification**: Shopify and GA4 feeds pull real data. Amazon/Faire fail gracefully.

---

## Prompt 70: Morning Brief + Weekly Digest

**Goal**: Verify the morning brief and weekly digest produce real output.

**Context**:
- Morning brief (`src/lib/ops/abra-morning-brief.ts`) should compile metrics from feeds, KPIs, alerts, and active initiatives into a Slack message
- Weekly digest (`src/lib/ops/abra-weekly-digest.ts`) should produce a strategy-level summary

**Tasks**:

1. Trigger morning brief:
   ```
   GET /api/ops/abra/morning-brief (with auth)
   ```

2. Verify it returns structured data (not empty/null):
   - Revenue metrics (from Shopify/Amazon feeds or KPI timeseries)
   - Traffic metrics (from GA4 feed)
   - Active initiatives status
   - Open action items
   - Anomalies/signals (if any)

3. Trigger weekly digest:
   ```
   GET /api/ops/abra/digest?type=weekly (with auth)
   ```

4. Verify structured output with week-over-week comparisons

5. If either returns empty data: the feeds haven't run yet. That's OK — verify the structure is correct even if data is sparse. Add fallback messaging like "No feed data available yet — run feeds first."

**Verification**: Both endpoints return structured responses without 500 errors.

---

## Prompt 71: Forecasting & Attribution Validation

**Goal**: Verify revenue forecasting and attribution models work with real or seeded data.

**Context**:
- Forecasting: `src/lib/ops/abra-forecasting.ts` + `/api/ops/abra/forecast/route.ts`
- Attribution: `src/lib/ops/abra-attribution.ts` + `/api/ops/abra/attribution/route.ts`
- Inventory: `/api/ops/abra/inventory-forecast/route.ts`

These need KPI timeseries data to function. If `kpi_timeseries` is empty, they'll return errors.

**Tasks**:

1. Check if `kpi_timeseries` has any data:
   ```sql
   SELECT metric_name, COUNT(*) FROM kpi_timeseries GROUP BY metric_name;
   ```

2. If empty, seed 30 days of sample data for key metrics:
   - `shopify_revenue_daily` (values: $50-200/day, trending up)
   - `amazon_revenue_daily` (values: $20-100/day)
   - `ga4_sessions_daily` (values: 50-300/day)
   - `ga4_conversion_rate` (values: 0.5-2.5%)

   Create `scripts/seed-kpi-timeseries.mjs` to insert this data.

3. Test forecasting endpoint:
   ```
   GET /api/ops/abra/forecast?metric=shopify_revenue_daily&horizon=30
   ```

4. Test attribution endpoint:
   ```
   GET /api/ops/abra/attribution?period=30d
   ```

5. Test inventory forecast:
   ```
   GET /api/ops/abra/inventory-forecast
   ```

**Verification**: All three endpoints return meaningful data (even if seeded).

---

## Prompt 72: Anomaly Detection + Operational Signals

**Goal**: Verify anomaly detection triggers and stores signals correctly.

**Context**: `src/lib/ops/abra-anomaly-detection.ts` uses z-score analysis on KPI timeseries to detect anomalies. Signals get stored in `abra_operational_signals`.

**Tasks**:

1. With KPI data seeded (from Prompt 71), run anomaly detection:
   ```
   POST /api/ops/abra/signals/detect (or however the endpoint is structured)
   ```

2. Inject a deliberate anomaly: add a data point to `kpi_timeseries` with `shopify_revenue_daily = 1000` (5x normal) for today

3. Run detection again — verify it flags the spike as an anomaly

4. Check `abra_operational_signals` has the new signal with:
   - `signal_type`: anomaly
   - `severity`: high (because 5x is well beyond 2 z-scores)
   - `department`: finance or sales
   - `description` mentioning the revenue spike

**Verification**: Anomaly detection finds the injected spike and stores it as a signal.

---

## Prompt 73: Action Proposal + Approval Flow

**Goal**: Verify the action proposal system works — Abra proposes, human approves, action executes.

**Context**:
- Actions: `src/lib/ops/abra-actions.ts` (20.9KB — substantial)
- Approvals: `/api/ops/abra/approvals/route.ts`
- Auto-execution: `src/lib/ops/abra-auto-exec.ts`

**Tasks**:

1. Create a test action proposal:
   ```
   POST /api/ops/abra/actions/propose
   {
     "department": "finance",
     "action_type": "create_task",
     "title": "Set up QuickBooks Online",
     "description": "Create QuickBooks account and configure chart of accounts for CPG candy company",
     "auto_execute": false
   }
   ```

2. Verify it appears in the approvals queue:
   ```
   GET /api/ops/abra/approvals?status=pending
   ```

3. Approve it:
   ```
   POST /api/ops/abra/approvals/<id>/approve
   ```

4. Verify the action status changes and any downstream effects trigger

5. Test auto-execution (for low-risk actions):
   ```
   POST /api/ops/abra/actions/propose
   {
     "action_type": "log_insight",
     "title": "Revenue trending up 15% WoW",
     "auto_execute": true
   }
   ```
   This should auto-execute without approval.

**Verification**: Manual approval flow works. Auto-execution works for low-risk actions.

---

## Prompt 74: Pipeline Intelligence + B2B Deals

**Goal**: Verify the B2B pipeline tracking integrates with brain search.

**Context**: `src/lib/ops/abra-pipeline-intelligence.ts` (16.3KB) manages deal tracking, and `abra_deals` stores pipeline data. The chat should be able to answer "How's our pipeline looking?"

**Tasks**:

1. Check if `abra_deals` has any data. If empty, seed 3-5 sample deals:
   ```
   INSERT INTO abra_deals (company_name, contact_name, contact_email, stage, estimated_value, department, notes)
   VALUES
     ('ABC Grocery', 'John Smith', 'john@abcgrocery.com', 'prospecting', 5000, 'sales_and_growth', 'Regional grocery chain, 12 locations'),
     ('Sweet Stop Candy', 'Jane Doe', 'jane@sweetstop.com', 'negotiation', 2500, 'sales_and_growth', 'Candy shop chain, interested in patriotic gummies'),
     ('Faire Wholesale', NULL, NULL, 'active', 1500, 'sales_and_growth', 'Faire marketplace, auto-replenishment enabled');
   ```

2. Test pipeline endpoint:
   ```
   GET /api/ops/abra/pipeline
   ```

3. Test via chat: "How's our sales pipeline looking?"
   - Should reference the deals from brain/pipeline data

**Verification**: Pipeline data accessible via API and chat.

---

## Prompt 75: Dashboard Config + Department State API

**Goal**: Verify the department dashboard API returns real state.

**Context**:
- `src/app/api/ops/department/[dept]/route.ts` returns complete department state
- `src/app/api/ops/abra/dashboard-config/route.ts` manages widget configuration

**Tasks**:

1. Test each department:
   ```
   GET /api/ops/department/finance
   GET /api/ops/department/operations
   GET /api/ops/department/sales_and_growth
   GET /api/ops/department/supply_chain
   GET /api/ops/department/executive
   ```

2. Verify each returns:
   - Department metadata (from `abra_departments`)
   - Active initiatives (from `abra_initiatives`)
   - Open questions
   - KPIs
   - AI spend for that department

3. Test dashboard config update (via proposal system):
   ```
   POST /api/ops/abra/dashboard-config
   { "department": "finance", "changes": { "add_widget": "cash_position" } }
   ```

**Verification**: All 5 departments return structured state. Dashboard config updates work via proposal.

---

## Execution Strategy

**Order**: 64 → 65 → 66 → 67 → 68 → 69 → 70 → 71 → 72 → 73 → 74 → 75

**Dependencies**:
- 64 (auth fix) must come first — everything else needs working auth
- 65 (chat) validates the core before testing higher-level flows
- 69 (feeds) should come before 70 (morning brief) since brief needs feed data
- 71 (KPI seeding) should come before 72 (anomaly detection)

**After this batch**: Prompts 76+ shift to new features:
- Competitive intelligence dashboard
- Customer feedback analysis (Shopify reviews + Amazon reviews)
- Automated report generation (investor updates, board deck data)
- Multi-agent collaboration (agents delegating to each other)
- Natural language dashboard builder ("show me revenue by channel")
