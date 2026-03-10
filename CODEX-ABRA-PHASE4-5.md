# Codex Build Prompt — Abra Phase 4 & 5 (Prompts 22–30)

## Mission

Continue building Abra — the AI company operating system for USA Gummies. Phases 1–3 (Prompts 1–21) are complete. You're now building **Phase 4: Autonomous Operations** and **Phase 5: External Intelligence**.

**Work autonomously through all prompts. Commit after each. Keep going until done.**

---

## Project Setup

```
Repository: /Users/ben/usagummies-storefront
Branch: main (ONLY branch — never create feature branches)
Build: npm run build
Framework: Next.js 15 App Router, React 18, TypeScript, Tailwind 4
```

### Supabase

- **URL**: `https://zdvfllvopocptwgummzb.supabase.co`
- **CRITICAL**: Before ANY `supabase` CLI command:
  ```bash
  mv .env.local .env.local.bak
  # run supabase command
  mv .env.local.bak .env.local
  ```

### Notion Progress Logging

```bash
# After each prompt, log to Status Map:
curl -s -X POST "https://api.notion.com/v1/comments" \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": { "page_id": "31d4c0c42c2e8185a75edde66d4d2f64" },
    "rich_text": [{ "text": { "content": "Prompt [N]: ✅ COMPLETE — [timestamp]. [summary]" } }]
  }'
```

---

## Execution Order

**22 → 23 → 24 → 25 → 26 → 27 → 28 → 29 → 30**

---

## What Already Exists (from Prompts 1–21)

### Key Files You'll Import From

| File | Key Exports |
|------|------------|
| `src/lib/ops/notify.ts` | `notify(channel, message)`, `notifyAlert()`, `notifyPipeline()`, `notifyDaily()`, `textBen()` — Slack webhooks with channel prefixes |
| `src/lib/ops/email.ts` | `sendOpsEmail({ to, subject, html })` — Gmail SMTP with rate limiting |
| `src/lib/ops/abra-cost-tracker.ts` | `logAICost()`, `getMonthlySpend()`, `getSpendByDepartment()`, `getSpendByModel()`, `isBudgetCritical()` |
| `src/lib/ops/abra-truth-benchmark.ts` | `getAccuracyReport()`, `formatAccuracyReport()` |
| `src/lib/ops/abra-operational-signals.ts` | `emitSignal()`, `getActiveSignals()`, `buildSignalsContext()` |
| `src/lib/ops/abra-team-directory.ts` | `getTeamMembers()`, `getVendors()`, `buildTeamContext()` |
| `src/lib/ops/abra-auto-teach.ts` | `runAutoTeachCycle()`, `getDueFeeds()`, `runFeed()`, `runAllDueFeeds()` |
| `src/lib/ops/abra-source-provenance.ts` | `logAnswer()`, `recordFeedback()`, `extractProvenance()` |
| `src/lib/ops/abra-memory-tiers.ts` | `searchTiered()`, `buildTieredContext()` |
| `src/lib/ops/department-playbooks.ts` | `getPlaybook()`, `getPlaybookFromDB()`, `detectDepartment()` |
| `src/lib/ops/abra-system-prompt.ts` | `buildAbraSystemPrompt()` |
| `src/app/api/ops/department/[dept]/route.ts` | GET — full department state aggregation |
| `src/app/api/ops/abra/initiative/route.ts` | POST/GET/PATCH — initiative CRUD |
| `src/app/api/ops/abra/session/route.ts` | POST/GET/PATCH/end — session lifecycle |
| `src/app/api/ops/abra/cost/route.ts` | GET — cost breakdown endpoint |
| `src/app/api/ops/abra/accuracy/route.ts` | GET — accuracy report endpoint |
| `src/app/api/ops/abra/dashboard-config/route.ts` | POST — dashboard widget config |

### Supabase Tables (already exist)

Core: `open_brain_entries`, `email_events`, `tasks`, `approvals`, `decision_log`, `deals`, `kpi_timeseries`, `product_config`, `integration_health`

V2: `abra_initiatives`, `abra_sessions`, `abra_cost_log`, `abra_departments`, `abra_team`, `abra_vendors`, `abra_initiative_dependencies`, `abra_answer_log`, `abra_knowledge_feeds`, `abra_auto_teach_feeds`, `abra_operational_signals`, `abra_playbooks`

### Notification Channels

`notify.ts` supports three channels:
- `"alerts"` → `SLACK_WEBHOOK_ALERTS` (falls back to support webhook with `[ALERTS]` prefix)
- `"pipeline"` → `SLACK_WEBHOOK_PIPELINE`
- `"daily"` → `SLACK_WEBHOOK_DAILY`

Use `notify("alerts", "message")` for operational alerts and `notify("daily", "message")` for digests.

### Email

`sendOpsEmail({ to: "ben@usagummies.com", subject: "...", html: "..." })` — Gmail SMTP, has per-recipient daily cap of 1, so use sparingly.

---

## Prompt 22 — Automated Reporting (Weekly Digest + Monthly Report)

**Phase 4B from the roadmap. Quickest win.**

### 22A — Weekly Department Digest

Create `src/lib/ops/abra-weekly-digest.ts` (~150 lines):

```typescript
export async function generateWeeklyDigest(): Promise<string>
export async function sendWeeklyDigest(): Promise<void>
```

`generateWeeklyDigest()` aggregates across ALL departments:
1. Fetch department state for each of the 5 departments (call `/api/ops/department/[dept]` internally or use direct Supabase queries)
2. Collect: active initiatives count + status, open questions count, KPI highlights, AI spend this week
3. Pull accuracy report via `getAccuracyReport(7)` for 7-day window
4. Pull active operational signals via `getActiveSignals()`
5. Pull meeting count from `abra_sessions` (last 7 days)
6. Format as a clean Slack markdown message with sections:
   - Header: "📊 **Abra Weekly Digest** — Week of [date]"
   - Per-department summary (2-3 lines each)
   - AI Spend: "$X.XX this week / $Y.YY this month (budget: $1,000)"
   - Accuracy: "X answers, Y% correction rate"
   - Active Signals: count by severity
   - Open Questions: list (max 5)

`sendWeeklyDigest()`:
1. Calls `generateWeeklyDigest()`
2. Sends via `notify("daily", digest)`
3. Logs cost of the digest generation

### 22B — Monthly Ops Report Email

Add to `src/lib/ops/abra-weekly-digest.ts` (or create separate file):

```typescript
export async function generateMonthlyReport(): Promise<string>
export async function sendMonthlyReport(): Promise<void>
```

Similar to weekly but:
- 30-day lookback
- Includes initiative progress (started vs completed)
- Includes full cost breakdown by model and department
- Accuracy trends (improving/declining)
- Formatted as HTML email
- Sent via `sendOpsEmail({ to: "ben@usagummies.com", subject: "Abra Monthly Report — [Month]", html })`

### 22C — Cron API Route

Create `src/app/api/ops/abra/digest/route.ts` (~60 lines):

```typescript
// GET with ?type=weekly or ?type=monthly
// Protected by CRON_SECRET header check
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "weekly";

  if (type === "weekly") {
    await sendWeeklyDigest();
  } else if (type === "monthly") {
    await sendMonthlyReport();
  }

  return Response.json({ ok: true, type });
}
```

### 22D — Register Cron

Add to `vercel.json` (create if doesn't exist, or modify):
```json
{
  "crons": [{
    "path": "/api/ops/abra/digest?type=weekly",
    "schedule": "0 16 * * 1"
  }]
}
```
Note: Vercel Hobby only allows 1 cron. If `vercel.json` already has a cron, add a comment noting this needs QStash instead.

**Commit message**: `Abra v2 Prompt 22: automated weekly digest and monthly report`

---

## Prompt 23 — Approval Workflow UI

**Phase 4D. The `approvals` table exists but has no UI.**

### 23A — Approvals API Route

Create `src/app/api/ops/abra/approvals/route.ts` (~120 lines):

**GET** — List approvals:
- Query `approvals` table
- Filter by: `?status=pending` (default), `?status=approved`, `?status=rejected`, `?status=all`
- Order by `created_at DESC`
- Limit 50

**PATCH** — Approve/reject:
- Body: `{ id, decision: "approved" | "rejected", comment?: string }`
- Update `approvals` row: set `decision`, `decided_at`, `decided_by` (use "founder" or extract from auth)
- If approved and there's an `action_payload`, execute it (or flag for execution)
- Return updated row

### 23B — Approvals Page

Create `src/app/ops/approvals/page.tsx` (~250 lines):

Server component with client interaction:
- Tab bar: Pending | Approved | Rejected | All
- Each approval card shows:
  - Agent name, action description, risk level badge (low/medium/high/critical)
  - Permission tier
  - Created timestamp
  - Action payload preview (collapsed JSON)
  - Approve / Reject buttons (with optional comment textarea)
- Color-coded risk: low=green, medium=yellow, high=orange, critical=red
- Empty state: "No pending approvals 🎉"

### 23C — Add to Sidebar

Modify `src/app/ops/OpsShell.client.tsx` (or wherever the sidebar nav is):
- Add "Approvals" link to the sidebar navigation
- Show a badge count of pending approvals (fetch from API on mount)

**Commit message**: `Abra v2 Prompt 23: approval workflow UI with approve/reject actions`

---

## Prompt 24 — Scheduled Initiative Reviews

**Phase 4A. Abra nudges when initiatives go stale.**

### 24A — Initiative Health Check Module

Create `src/lib/ops/abra-initiative-health.ts` (~120 lines):

```typescript
export type InitiativeHealth = {
  id: string;
  title: string;
  department: string;
  status: string;
  days_since_update: number;
  unanswered_questions: number;
  health: "healthy" | "stale" | "abandoned";
};

export async function checkInitiativeHealth(): Promise<InitiativeHealth[]>
// Queries abra_initiatives
// "stale" = no update in 7+ days AND status not completed/paused
// "abandoned" = no update in 30+ days
// Returns sorted by staleness

export async function autoManageInitiatives(): Promise<{
  nudged: string[];
  paused: string[];
}>
// For stale: send Slack notification
// For abandoned (30+ days): auto-pause and notify
```

### 24B — Initiative Health API Route

Create `src/app/api/ops/abra/initiative-health/route.ts` (~50 lines):

**GET** — Returns health check results (for dashboard display)

**POST** — Triggers `autoManageInitiatives()`:
- Protected by CRON_SECRET
- Sends Slack notifications for stale initiatives
- Auto-pauses abandoned ones
- Returns summary of actions taken

### 24C — Slack Notifications

When a stale initiative is detected, send via `notify("alerts", ...)`:
```
⏰ **Stale Initiative Alert**
• [Finance] "Set up chart of accounts" — 12 days without update, 3 unanswered questions
• [Operations] "Inventory tracking" — 8 days without update
Reply in Abra chat or Slack to continue these initiatives.
```

When auto-pausing:
```
⏸️ **Initiative Auto-Paused** (30+ days inactive)
• [Supply Chain] "Landed cost tracking" — paused after 35 days
Use `/abra initiative:resume supply_chain` to restart.
```

**Commit message**: `Abra v2 Prompt 24: scheduled initiative health checks with Slack nudges`

---

## Prompt 25 — Cross-Department Dependencies

**Phase 4C. The `abra_initiative_dependencies` table exists. Add UI and notifications.**

### 25A — Dependencies API Enhancements

Modify `src/app/api/ops/abra/initiative/route.ts`:

Add a new query param to GET: `?include_dependencies=true`
- When set, join with `abra_initiative_dependencies` and include:
  - `blocks`: initiatives this one blocks
  - `blocked_by`: initiatives blocking this one
  - `informs` / `informed_by`: informational links

Add to PATCH: ability to add/remove dependencies:
```json
{
  "id": "...",
  "add_dependency": { "depends_on_id": "...", "relationship_type": "blocks" },
  "remove_dependency": { "dependency_id": "..." }
}
```

### 25B — Dependency Notifications

When an initiative moves to "completed" or "paused", check `abra_initiative_dependencies`:
- If it was blocking other initiatives, notify those departments:
```
🔓 **Blocker Resolved**
"COGS tracking" (Finance) is now complete.
This unblocks: "Landed cost calculations" (Supply Chain)
```

Add this logic to the initiative PATCH handler (when status changes to completed).

### 25C — Dependency View on Department Dashboard

Modify `src/app/ops/departments/[dept]/page.tsx`:

Add a "Dependencies" section that shows:
- Initiatives in this department that are blocked (with the blocking initiative and its status)
- Initiatives in other departments that this department blocks
- Visual: red for blocked, green for resolved, gray for informational

**Commit message**: `Abra v2 Prompt 25: cross-department initiative dependencies with notifications`

---

## Prompt 26 — Document Ingestion

**Phase 5B. Upload files → parse → embed → store in brain.**

### 26A — Document Upload API

Create `src/app/api/ops/abra/ingest/route.ts` (~150 lines):

**POST** — Multipart form upload:
- Accepts: PDF, CSV, XLSX, TXT, JSON
- Max file size: 10MB
- Parse the file:
  - **PDF**: Use `pdf-parse` package (add to dependencies). Extract text per page.
  - **CSV**: Parse with built-in logic or a lightweight parser. Each row becomes a chunk.
  - **XLSX**: Use `xlsx` package (already may be in deps). Extract sheet data.
  - **TXT/JSON**: Direct text extraction.
- Split extracted text into chunks (~1000 chars each with 200 char overlap)
- For each chunk:
  1. Generate embedding via OpenAI (`text-embedding-3-small`)
  2. Insert into `open_brain_entries` with:
     - `source_table: "document"`
     - `category: "uploaded_document"`
     - `title: filename`
     - `entry_type: "document_chunk"`
     - `metadata: { filename, page_number, chunk_index, uploaded_by, mime_type }`
- Return: `{ chunks_created: N, filename, document_id }`

**GET** — List uploaded documents:
- Query `open_brain_entries` where `category = 'uploaded_document'`
- Group by filename (from metadata)
- Return: list of documents with chunk counts and upload dates

### 26B — Embedding Helper

If not already available, create `src/lib/ops/abra-embeddings.ts` (~50 lines):

```typescript
export async function generateEmbedding(text: string): Promise<number[]>
// Calls OpenAI text-embedding-3-small (1536 dims)
// Uses OPENAI_API_KEY env var
// Returns float array

export async function generateEmbeddings(texts: string[]): Promise<number[][]>
// Batch version — OpenAI supports batch embedding
```

Check if this already exists in the codebase (there may be an edge function or helper). If the Supabase edge function `embed-and-store` exists, you can call that instead. But a local helper is faster for batch operations.

### 26C — Document Upload UI

Create `src/app/ops/documents/page.tsx` (~200 lines):

- File drop zone (drag & drop or click to select)
- Supported formats listed
- Upload progress indicator
- List of previously uploaded documents with:
  - Filename, upload date, chunk count, uploaded by
  - Delete button (marks entries as superseded)

Add "Documents" to the sidebar navigation.

**Commit message**: `Abra v2 Prompt 26: document ingestion pipeline with upload UI`

---

## Prompt 27 — Email Intelligence

**Phase 5C. Parse Gmail for business signals.**

### 27A — Email Signal Extraction Enhancement

The function `extractEmailSignals()` already exists in `abra-operational-signals.ts`. Enhance it:

Add detection for:
- **Payment/invoice mentions**: regex for "$X,XXX" amounts, "invoice", "payment due", "past due"
- **Supplier updates**: "price increase", "lead time", "out of stock", "discontinue", "new product"
- **Regulatory**: "FDA", "compliance", "recall", "warning letter", "inspection"
- **Partnership/opportunity**: "partnership", "collaboration", "distribute", "carry your product"

Each new signal type should have appropriate severity and department routing.

### 27B — Email Ingest Cron

Create `src/app/api/ops/abra/email-ingest/route.ts` (~100 lines):

**POST** (cron-protected):
1. Fetch recent unprocessed emails from `email_events` table (last 24 hours, not yet signal-processed)
2. For each email:
   - Run `extractEmailSignals({ subject, body, from, department })`
   - For each signal found: `emitSignal(signal)`
   - Mark email as processed (add `signal_processed: true` to metadata or a separate flag)
3. Return summary: `{ emails_processed, signals_emitted }`

### 27C — Email Signal Dashboard Widget

Modify the ops dashboard or create a simple widget:
- Show recent email-sourced signals on the main dashboard
- Filter: last 7 days, source = "email"
- Group by signal_type with counts

**Commit message**: `Abra v2 Prompt 27: email intelligence with enhanced signal extraction`

---

## Prompt 28 — Notion Bi-Directional Sync

**Phase 5D. Abra writes structured data back to Notion.**

### 28A — Notion Write Helper

Create `src/lib/ops/abra-notion-write.ts` (~150 lines):

```typescript
const NOTION_API_KEY = process.env.NOTION_API_KEY;

export async function createNotionPage(params: {
  parent_id: string;  // database or page ID
  title: string;
  content?: string;   // markdown content
  properties?: Record<string, unknown>;  // database properties
}): Promise<string | null>   // returns page ID

export async function updateNotionPage(params: {
  page_id: string;
  properties?: Record<string, unknown>;
  content?: string;
}): Promise<boolean>

export async function createMeetingNotesPage(session: {
  title: string;
  department: string;
  notes: unknown[];
  decisions: unknown[];
  action_items: unknown[];
  started_at: string;
  ended_at: string;
}): Promise<string | null>
// Creates a page under a "Meeting Notes" database in Notion
// Formats notes/decisions/action items as Notion blocks
```

Use Notion API v1 with blocks API for content creation. The API key is already in env vars (`NOTION_API_KEY`).

### 28B — Auto-Sync on Session End

Modify `src/app/api/ops/abra/session/route.ts`:

When a session ends (the end/delete handler):
- After saving to brain, also call `createMeetingNotesPage()` to create a Notion page
- Fire-and-forget: `void createMeetingNotesPage(...).catch(console.error)`
- Store the Notion page URL in the session record metadata

### 28C — Initiative → Notion Sync

Modify `src/app/api/ops/abra/initiative/route.ts`:

When an initiative is approved (status changes to 'approved'):
- Create a Notion page with the initiative plan, tasks, KPIs
- Store Notion page URL in initiative metadata
- Fire-and-forget

### 28D — KPI → Notion Sync (optional, best-effort)

Add to `abra-notion-write.ts`:

```typescript
export async function syncKPIsToNotion(department: string): Promise<void>
// Updates a Notion database with latest KPI values
// Only if NOTION_KPI_DB env var is set
```

**Commit message**: `Abra v2 Prompt 28: Notion bi-directional sync for meetings and initiatives`

---

## Prompt 29 — Enhanced Slack Interactions

**Phase 4E (simplified). Add interactive message features without requiring a full bot token migration.**

### 29A — Slack Reaction Feedback

Modify `src/app/api/ops/slack/abra/route.ts`:

Add handling for Slack interactive payloads (if not already present). When the Slack app receives interaction events:

Create `src/app/api/ops/slack/interactions/route.ts` (~100 lines):

**POST** — Slack sends interaction payloads here:
- Parse the `payload` form field (URL-encoded JSON)
- Handle `block_actions` type:
  - `approve_action` button → call approve endpoint
  - `reject_action` button → call reject endpoint
  - `feedback_positive` → call `recordFeedback(answerId, "positive")`
  - `feedback_negative` → call `recordFeedback(answerId, "negative")`
- Return 200 OK immediately (Slack requires <3s response)

### 29B — Add Feedback Buttons to Responses

Modify the Slack response builder in `src/app/api/ops/slack/abra/route.ts`:

After sending an answer, append Slack Block Kit buttons:
```json
{
  "type": "actions",
  "elements": [
    {
      "type": "button",
      "text": { "type": "plain_text", "text": "👍 Helpful" },
      "action_id": "feedback_positive",
      "value": "<answer_log_id>"
    },
    {
      "type": "button",
      "text": { "type": "plain_text", "text": "👎 Not helpful" },
      "action_id": "feedback_negative",
      "value": "<answer_log_id>"
    }
  ]
}
```

This requires the Slack response to use `response_type: "in_channel"` with blocks format instead of plain text. Modify the response builder to output Block Kit format.

### 29C — Approval Inline Actions

When Abra sends an approval request to Slack (via `notify("alerts", ...)`), include approve/reject buttons:
- On click → hits the interactions endpoint → updates `approvals` table
- Replaces the message with "✅ Approved by [user]" or "❌ Rejected by [user]"

**Commit message**: `Abra v2 Prompt 29: Slack interactive feedback and approval buttons`

---

## Prompt 30 — Phase 4-5 Integration Test Update

**Update the test script to cover all new functionality.**

### 30A — Update Test Script

Modify `scripts/test-abra-v2.mjs`:

Add these new test cases (append to existing tests):

```javascript
// Phase 4 tests
{ name: "Weekly digest generation", fn: testWeeklyDigest },
{ name: "Approval list", fn: testApprovalList },
{ name: "Approval create + approve", fn: testApprovalFlow },
{ name: "Initiative health check", fn: testInitiativeHealth },
{ name: "Initiative dependencies", fn: testDependencies },

// Phase 5 tests
{ name: "Document upload", fn: testDocumentUpload },
{ name: "Document list", fn: testDocumentList },
{ name: "Email signal extraction", fn: testEmailSignals },
{ name: "Notion write (if configured)", fn: testNotionWrite },
{ name: "Slack interactions endpoint", fn: testSlackInteractions },
```

Each test function:
- Makes fetch() calls to the API
- Checks response status codes and basic response shape
- Prints ✅ or ❌ with details
- Non-critical failures don't block other tests

### 30B — Smoke Test Summary

At the end of the script, print a summary:
```
========================================
ABRA v2 PHASE 4-5 TEST RESULTS
========================================
Total: 23 tests
Passed: 21 ✅
Failed: 2 ❌
Skipped: 0

Failed tests:
  - Notion write: NOTION_API_KEY not configured
  - Slack interactions: No interaction payload to test
========================================
```

**Commit message**: `Abra v2 Prompt 30: integration test update for Phase 4-5 features`

---

## Per-Prompt Workflow

For EACH prompt:

1. **Read existing code** before modifying
2. **Implement** — create/modify files
3. **Install deps if needed**: `npm install pdf-parse` (for Prompt 26) — use `--legacy-peer-deps`
4. **Build check**: `npm run build`
   - Fix TypeScript errors on failure, retry up to 3 times
5. **Commit**: `git add -A && git commit -m "Abra v2 Prompt [N]: [title]"`
6. **Log to Notion** (curl command above)
7. **Next prompt**

---

## Code Style Rules

1. Use `@/` path alias for imports
2. API routes: `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"`
3. Always try/catch, never throw unhandled
4. Fire-and-forget: `void asyncFn()` for non-critical ops
5. Supabase: use existing `sbFetch`/`sbRpc` patterns from `abra-*.ts` files
6. Slack: `notify("alerts" | "pipeline" | "daily", message)` from `@/lib/ops/notify`
7. Email: `sendOpsEmail({ to, subject, html })` from `@/lib/ops/email`
8. Verification: `npm run build` only (no test suite)

---

## Error Handling

- If a prompt fails after 3 build attempts: log failure to Notion, skip to next
- If a dependency package install fails: implement without it (use TODO comments)
- If an import doesn't resolve: check if the export exists, add it if missing

---

## Final Checklist

After all prompts:
1. `npm run build` — final verification
2. Log to Notion: "🎉 PHASE 4-5 COMPLETE — Prompts 22-30 done"
3. Do NOT `git push` — leave for review
4. Do NOT run `supabase db push` for new migrations

---

## Go.

Start with Prompt 22 (Automated Reporting). Work through to Prompt 30. Commit after each. Keep going.
