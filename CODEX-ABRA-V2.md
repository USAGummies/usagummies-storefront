# Codex Build Prompt — Abra v2 Intelligence Layers (Prompts 12–21)

## Mission

You are building **Abra v2** — an AI company operating system for USA Gummies. The v1 foundation (Prompts 1–11) is complete and deployed. Your job is to execute Prompts 12–21 sequentially, committing after each, and logging progress to Notion.

**Work autonomously until all 10 prompts are complete or you hit a blocking error.**

---

## Project Setup

```
Repository: /Users/ben/usagummies-storefront
Branch: main (ONLY branch — never create feature branches)
Build command: npm run build
Package manager: npm (with legacy-peer-deps=true in .npmrc)
Framework: Next.js 15 App Router, React 18, TypeScript, Tailwind 4
Deployment: Vercel auto-deploys every push to main
```

### Supabase

- **Project ref**: `zdvfllvopocptwgummzb`
- **URL**: `https://zdvfllvopocptwgummzb.supabase.co`
- **Migration dir**: `supabase/migrations/`
- **CRITICAL**: Before running ANY `supabase` CLI command, you MUST rename `.env.local`:
  ```bash
  mv .env.local .env.local.bak
  ```
  Then restore after:
  ```bash
  mv .env.local.bak .env.local
  ```
  Reason: `GA4_SERVICE_ACCOUNT_JSON` in `.env.local` is multiline JSON that breaks the Supabase CLI parser.

### Prerequisite — Deploy Existing Migration

Before any runtime testing, push the v2 schema migration that already exists:

```bash
cd /Users/ben/usagummies-storefront
mv .env.local .env.local.bak
npx supabase db push
mv .env.local.bak .env.local
```

This deploys `supabase/migrations/20260310000003_abra_v2_layers.sql` which creates all v2 tables.

---

## Notion Progress Logging

After completing each prompt, log progress by making an API call to Notion. Use the Notion API to update the **Prompt Status Map** page.

### Notion API Key
```
$NOTION_API_KEY (set as environment variable)
```

### How to Log Progress

After each prompt completes (passes `npm run build`), create a comment on the prompt's Notion page:

```bash
curl -s -X POST "https://api.notion.com/v1/comments" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": { "page_id": "PAGE_ID_HERE" },
    "rich_text": [{ "text": { "content": "✅ CODEX COMPLETE — [timestamp]. Build passed. Files: [list]. Commit: [hash]" } }]
  }'
```

Also update the **Prompt Status Map** page with a progress comment:

```bash
# Status Map page ID: 31d4c0c42c2e8185a75edde66d4d2f64
curl -s -X POST "https://api.notion.com/v1/comments" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": { "page_id": "31d4c0c42c2e8185a75edde66d4d2f64" },
    "rich_text": [{ "text": { "content": "Prompt [N]: ✅ COMPLETE — [timestamp]. [brief summary]" } }]
  }'
```

If a prompt FAILS, log the failure:

```bash
curl -s -X POST "https://api.notion.com/v1/comments" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": { "page_id": "31d4c0c42c2e8185a75edde66d4d2f64" },
    "rich_text": [{ "text": { "content": "Prompt [N]: ❌ FAILED — [timestamp]. Error: [message]. Skipping to next." } }]
  }'
```

### Notion Page IDs for Each Prompt

| Prompt | Notion Page ID | Title |
|--------|---------------|-------|
| 12 | `31f4c0c42c2e8178ac85d6ed7277be0e` | Department Aggregation + Cost Endpoint + AbraChat Polish |
| 13 | `31f4c0c42c2e812b95c9c7923e9259a9` | Schema Reconciliation + Accuracy Dashboard |
| 14 | `31f4c0c42c2e817db6daf3108e627c9b` | Slack v2 Parity |
| 15 | `31f4c0c42c2e8100a516ed94155d209a` | Department State Route + Dashboard Config |
| 16 | `31f4c0c42c2e817f98d9ee1f39a2347a` | Auto-Teach Feed Handlers |
| 17 | `31f4c0c42c2e810ba7f3feb440477569` | Initiative Answer Flow |
| 18 | `31f4c0c42c2e81c78812c6e5d2a46f01` | Session/Meeting System |
| 19 | `31f4c0c42c2e817e833cd748fac648b4` | Department Dashboard Page |
| 20 | `31f4c0c42c2e81a9ba19e17561a9f75b` | Governance Layer |
| 21 | `31f4c0c42c2e81169405dbd42d9d4e72` | Integration Test Script |

Other key pages:
- Build Spec: `31f4c0c42c2e812e9ea8fcb9e82d4270`
- Parent (Claude Build Prompts): `31d4c0c42c2e811b80fbc80a0d2499f4`

---

## Execution Order

Execute in this order: **13 → 12 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21**

Prompt 13 goes first because it creates schema prerequisites, then 12 for core endpoints, then 14–21 sequentially.

---

## ⚠️ CRITICAL: Hardening Audit Already Applied

A hardening audit was run on 2026-03-09 that **directly fixed** the migration file `supabase/migrations/20260310000003_abra_v2_layers.sql`. The column names in the migration NOW MATCH the TypeScript types exactly:

**Already fixed in `20260310000003`:**
- `abra_auto_teach_feeds`: uses `is_active` (not `active`), `last_run_at` (not `last_ran_at`), `error_count` (not `errors`)
- `abra_answer_log`: uses `was_corrected` (not `corrected_later`), `user_feedback` (not `feedback`)
- `abra_team`: uses `email` (not `contact_email`), `name` (not `display_name`)
- `abra_vendors`: uses `name` (not `company`)
- `abra_initiatives`: uses `approved_by` (not `approved_by_user`), correct status enum values
- `abra_sessions`: correct column names throughout
- `abra_cost_log`: uses `estimated_cost_usd` (not `cost_usd`)

**What this means for Prompt 13:**
- **SKIP slice 13A entirely** (the reconciliation migration `20260310000004_schema_reconciliation.sql`). The schema is already correct. Creating ADD COLUMN IF NOT EXISTS or GENERATED ALWAYS AS STORED columns will either be redundant or cause errors.
- **DO execute slices 13B and 13C** (accuracy API route + accuracy dashboard page).

---

## Prompt Specifications

### Prompt 13 — Schema Reconciliation + Accuracy Dashboard

**SKIP 13A** (reconciliation migration) — already handled by hardening audit.

**13B — Accuracy API Route**

Create `src/app/api/ops/abra/accuracy/route.ts` (~50 lines):

```typescript
import { NextResponse } from "next/server";
import { getAccuracyReport, formatAccuracyReport } from "@/lib/ops/abra-truth-benchmark";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") || "30", 10);
    const format = url.searchParams.get("format") || "json";

    const report = await getAccuracyReport(days);

    if (format === "text") {
      return new NextResponse(formatAccuracyReport(report), {
        headers: { "Content-Type": "text/plain" },
      });
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error("[accuracy] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate accuracy report" },
      { status: 500 },
    );
  }
}
```

**13C — Accuracy Dashboard Page**

Create `src/app/ops/accuracy/page.tsx` (~250 lines):

- Server component that fetches from `/api/ops/abra/accuracy`
- Shows overall stats: total answers, correction rate, feedback score
- Department breakdown table
- Trend indicators (✅/⚠️)
- Simple, clean Tailwind styling consistent with other ops pages
- Import auth gate: check session like other ops pages (look at `src/app/ops/dashboard/page.tsx` for the pattern)

---

### Prompt 12 — Department Aggregation + Cost Endpoint + AbraChat Polish

**12A — Cost Endpoint**

Create `src/app/api/ops/abra/cost/route.ts` (~80 lines):

```typescript
import { NextResponse } from "next/server";
import { getMonthlySpend, getSpendByDepartment, getSpendByModel } from "@/lib/ops/abra-cost-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const breakdown = url.searchParams.get("breakdown") || "summary";

    const monthly = await getMonthlySpend();

    if (breakdown === "department") {
      const byDept = await getSpendByDepartment();
      return NextResponse.json({ ...monthly, byDepartment: byDept });
    }

    if (breakdown === "model") {
      const byModel = await getSpendByModel();
      return NextResponse.json({ ...monthly, byModel });
    }

    return NextResponse.json(monthly);
  } catch (error) {
    console.error("[cost] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch cost data" },
      { status: 500 },
    );
  }
}
```

Note: `getSpendByDepartment` and `getSpendByModel` may not exist in `abra-cost-tracker.ts` yet. If missing, add them — they query `abra_cost_log` grouped by department or model respectively.

**12B — Department Aggregation Route**

Create `src/app/api/ops/department/[dept]/route.ts` (~120 lines):

- GET handler that takes `dept` from params
- Parallel-fetches: department row from `abra_departments`, active initiatives, open questions, recent corrections, KPIs, AI spend for dept, team members, dashboard config
- Returns comprehensive department state JSON
- Use `Promise.allSettled` for resilience

**12C — AbraChat Cost Display**

Modify `src/app/ops/abra/AbraChat.client.tsx`:

- Add a `useEffect` that fetches from `/api/ops/abra/cost` on mount
- Display monthly spend in the chat footer: "March: $X.XX / $1,000"
- Replace any existing hacky cost parsing with the clean endpoint call

---

### Prompt 14 — Slack v2 Parity

Modify `src/app/api/ops/slack/abra/route.ts` (~975 lines):

This is the most complex prompt. The existing Slack handler must be upgraded with ALL v2 intelligence layers while **preserving all existing functionality**.

**Key changes:**
1. Replace `search_temporal` call with `searchTiered` from `@/lib/ops/abra-memory-tiers`
2. Add `logAICost()` call after every Claude API call (fire-and-forget: `void logAICost(...)`)
3. Add `logAnswer()` call from `@/lib/ops/abra-source-provenance` to track answers
4. Add `extractProvenance()` to extract source IDs/tables/tiers from search results
5. Add intent detection for `initiative:` and `cost` subcommands
6. Use `buildTieredContext()` instead of raw context building
7. Inject operational signals via `getActiveSignals()` + `buildSignalsContext()`

**MUST PRESERVE (do not break):**
- `fetchWithRetry` helper function
- Dual LLM provider support (Anthropic + OpenAI fallback)
- `after()` pattern for deferred operations
- Block splitting for long Slack responses (>2900 chars)
- All existing subcommands: `correct:`, `teach:`, `answer:`, `search:`, `status`, `help`
- Error handling and graceful degradation

**New subcommands to add:**
- `initiative: <department> <goal>` — creates a new initiative
- `cost` — shows current month AI spend summary

---

### Prompt 15 — Department State Route + Dashboard Config

If `src/app/api/ops/department/[dept]/route.ts` was already created in Prompt 12B, enhance it. Otherwise create it.

Create `src/app/api/ops/abra/dashboard-config/route.ts` (~80 lines):

- POST handler: `{ department, changes: { add_widget?, remove_widget?, reorder? } }`
- Validates department exists
- Updates `abra_departments.dashboard_config` JSONB column
- Returns updated config

---

### Prompt 16 — Auto-Teach Feed Handlers

Modify `src/lib/ops/abra-auto-teach.ts`:

Add 5 feed handler functions:

1. **`handleAmazonOrdersFeed`** — fetches recent Amazon orders, creates brain entries for order trends
2. **`handleFaireOrdersFeed`** — fetches Faire wholesale orders
3. **`handleShopifyProductsFeed`** — syncs product catalog changes
4. **`handleGA4TrafficFeed`** — pulls GA4 metrics, creates brain entries for traffic patterns
5. **`handleInventoryAlertsFeed`** — checks inventory levels, emits operational signals via `emitSignal()` from `abra-operational-signals.ts` when stock is low

Also create `supabase/migrations/20260310000005_seed_feeds.sql`:
- Seeds `abra_auto_teach_feeds` with 5 rows (one per handler)
- Each row: `feed_key`, `feed_name`, `source`, `handler_endpoint`, `schedule_cron`, `is_active`

**Important**: These handlers don't need to make actual external API calls in this prompt. They should have the structure and type signatures ready. Actual API integration will be filled in later. Use placeholder logic with clear TODO comments for the actual data fetching.

---

### Prompt 17 — Initiative Answer Flow

Modify `src/app/api/ops/abra/initiative/route.ts`:

Enhance the PATCH handler:
- When `answers` are provided in the request body:
  1. Load the department playbook from `department-playbooks.ts`
  2. Merge answers with playbook questions
  3. Generate a task list by filling `{variable}` placeholders in `taskTemplate`
  4. Generate KPI targets based on playbook KPIs
  5. Update initiative: status → 'approved', set tasks + kpis fields
  6. Return the complete plan

Modify `src/lib/ops/department-playbooks.ts`:

Add `taskTemplate` arrays to each department playbook. Example for finance:
```typescript
taskTemplate: [
  { title: "Set up chart of accounts in QuickBooks", department: "finance", priority: "high" },
  { title: "Configure {accounting_basis} accounting basis", department: "finance", priority: "high" },
  { title: "Set up {revenue_streams} revenue tracking", department: "finance", priority: "medium" },
  // ... more tasks with {variable} placeholders from question answers
]
```

Modify `src/app/api/ops/abra/chat/route.ts`:

Add initiative answer detection:
- If there's an active initiative with status 'asking_questions' for the department
- And the user's message looks like answers to those questions
- Auto-route to the initiative PATCH handler

---

### Prompt 18 — Session/Meeting System

Modify `src/app/api/ops/abra/session/route.ts`:

Full meeting lifecycle:

**POST** — Start session:
1. Auto-generate agenda from: open initiative questions, unanswered questions, active tasks/priorities
2. Create session record (status: 'active')
3. Return session with agenda

**PATCH** — Update session: `{ id, notes?, action_items?, decisions? }`

**POST `/end`** — End session (add a query param or separate handling):
1. Save notes/decisions as brain entries (use embedding endpoint)
2. Create tasks from action items in `abra_tasks`
3. Log session summary to brain
4. Update status to 'completed', set `ended_at`

Modify `src/app/ops/abra/AbraChat.client.tsx`:
- Add session mode indicator when a meeting is active
- Show agenda items
- Quick action buttons: "Start meeting", "End meeting"

---

### Prompt 19 — Department Dashboard Page

Create `src/app/ops/departments/[dept]/page.tsx` (~250 lines):

Server component that:
- Fetches from `/api/ops/department/[dept]`
- Renders: department header, active initiatives (with status badges), priorities list, open questions, KPI cards, team members, recent corrections, AI spend for the department
- Clean Tailwind styling consistent with ops dashboard
- Handles loading/error states

Modify ops layout/sidebar to add department navigation:
- Find the sidebar component (likely in `src/app/ops/layout.tsx` or a sidebar component)
- Add links for each department: executive, operations, finance, sales_and_growth, supply_chain

---

### Prompt 20 — Governance Layer

**20A — Cost Alerting**

Modify `src/lib/ops/abra-cost-tracker.ts`:

Add `checkBudgetAndAlert()` function:
- Thresholds: 50% → info log, 80% → Slack warning, 95% → Slack critical + auto-downgrade
- Auto-downgrade: set a flag (env var or KV) that tells the chat endpoint to use `claude-3-5-haiku` instead of `claude-sonnet-4`
- Call this function inside `logAICost()` when monthly total crosses thresholds

**20B — Weekly Accuracy Digest**

Create `src/lib/ops/abra-accuracy-digest.ts` (~80 lines):

```typescript
export async function generateWeeklyDigest(): Promise<string>
// Calls getAccuracyReport(7), formats for Slack, sends via notify()
```

Add an API route or integrate with existing cron to trigger weekly.

**20C — Playbook Versioning**

Create `src/app/api/ops/abra/playbooks/route.ts` (~100 lines):

- GET: returns current playbook for a department (from `department-playbooks.ts`)
- POST: accepts playbook overrides, stores in `abra_departments.dashboard_config` or a new JSONB field
- Versioning: store previous versions in a JSONB array

---

### Prompt 21 — Integration Test Script

Create `scripts/test-abra-v2.mjs` (~200 lines):

Standalone Node.js script that runs 13 sequential tests against the local or production API:

```javascript
#!/usr/bin/env node
// Usage: node scripts/test-abra-v2.mjs [base_url]
// Default base_url: http://localhost:3000

const BASE = process.argv[2] || "http://localhost:3000";

const tests = [
  { name: "Health check", fn: testHealth },
  { name: "Chat basic", fn: testChatBasic },
  { name: "Chat with tiered memory", fn: testChatTiered },
  { name: "Cost endpoint", fn: testCostEndpoint },
  { name: "Accuracy report", fn: testAccuracyReport },
  { name: "Department state", fn: testDepartmentState },
  { name: "Initiative create", fn: testInitiativeCreate },
  { name: "Initiative answer", fn: testInitiativeAnswer },
  { name: "Session create", fn: testSessionCreate },
  { name: "Session end", fn: testSessionEnd },
  { name: "Dashboard config", fn: testDashboardConfig },
  { name: "Operational signals", fn: testSignals },
  { name: "Playbook fetch", fn: testPlaybookFetch },
];

// Each test function makes fetch() calls and asserts responses
// Print ✅ or ❌ for each, with error details
// Exit with code 1 if any test fails
```

---

## Per-Prompt Workflow

For EACH prompt (13, 12, 14, 15, 16, 17, 18, 19, 20, 21):

1. **Read the existing code** — understand what's already there before modifying
2. **Implement** — create/modify files as specified
3. **Build check**: `npm run build`
   - If build fails: fix TypeScript errors, retry
   - If build passes: continue
4. **Commit**:
   ```bash
   git add -A
   git commit -m "Abra v2 Prompt [N]: [title]"
   ```
5. **Log to Notion** — use the curl commands above to post progress
6. **Move to next prompt**

---

## Error Handling

- If a prompt fails after 3 build attempts, **log the failure to Notion** and **skip to the next prompt**
- Never get stuck — always log and move on
- If an import doesn't exist, check if it should be created as part of the current prompt or if it's from a previous prompt that may have been skipped
- If a Supabase table doesn't exist at runtime, the existing code handles this gracefully (try/catch with empty returns)

---

## Code Style Rules

1. **Imports**: Use `@/` path alias (e.g., `import { foo } from "@/lib/ops/bar"`)
2. **API routes**: Always export `dynamic = "force-dynamic"` and `runtime = "nodejs"`
3. **Error handling**: Always try/catch, never let API routes throw unhandled
4. **Fire-and-forget**: Use `void asyncFn()` for non-critical async ops (cost logging, signal emission)
5. **Types**: Export types from their source module, import where needed
6. **Supabase calls**: Use the existing `sbFetch`/`sbRpc` patterns (see any file in `src/lib/ops/abra-*.ts`)
7. **No tests**: This project has no test suite. Verification is `npm run build`.
8. **Tailwind 4**: Uses `@import "tailwindcss"` syntax, not `@tailwind` directives

---

## Files Reference — What Already Exists

These files are ALREADY WRITTEN and working. Import from them, don't recreate:

| File | Key Exports |
|------|------------|
| `src/lib/ops/abra-memory-tiers.ts` | `searchTiered()`, `buildTieredContext()`, `TieredSearchResult` |
| `src/lib/ops/abra-source-provenance.ts` | `logAnswer()`, `recordFeedback()`, `markAnswerCorrected()`, `extractProvenance()` |
| `src/lib/ops/abra-truth-benchmark.ts` | `getAccuracyReport()`, `formatAccuracyReport()`, `TruthBenchmarkSummary` |
| `src/lib/ops/abra-operational-signals.ts` | `emitSignal()`, `getActiveSignals()`, `buildSignalsContext()`, `extractEmailSignals()` |
| `src/lib/ops/abra-team-directory.ts` | `getTeamMembers()`, `getVendors()`, `buildTeamContext()` |
| `src/lib/ops/abra-cost-tracker.ts` | `logAICost()`, `estimateCost()`, `getMonthlySpend()` |
| `src/lib/ops/abra-auto-teach.ts` | `runAutoTeachCycle()`, `AutoTeachFeed` |
| `src/lib/ops/abra-system-prompt.ts` | `buildAbraSystemPrompt()` |
| `src/lib/ops/department-playbooks.ts` | `DEPARTMENT_PLAYBOOKS`, `getPlaybook()` |
| `src/app/api/ops/abra/chat/route.ts` | Main chat endpoint |
| `src/app/api/ops/abra/initiative/route.ts` | Initiative CRUD |
| `src/app/api/ops/abra/session/route.ts` | Session/meeting CRUD |
| `src/app/api/ops/abra/research/route.ts` | Research endpoint |
| `src/app/api/ops/slack/abra/route.ts` | Slack bot handler (~975 lines) |
| `src/app/ops/abra/AbraChat.client.tsx` | Chat UI component |

---

## Final Checklist

After all prompts are complete:

1. Run `npm run build` one final time
2. Log final status to Notion:
   ```
   "🎉 ALL PROMPTS COMPLETE — [timestamp]. Prompts completed: [list]. Prompts skipped: [list]. Ready for git push + Vercel deploy."
   ```
3. Do NOT `git push` — leave that for Ben to review and push manually
4. Do NOT run `supabase db push` for any NEW migrations — leave for Ben to review

---

## Go.

Start with Prompt 13 (skip 13A, do 13B + 13C). Then Prompt 12. Then 14 through 21 in order. Log everything to Notion. Build after each. Commit after each. Keep going until done.
