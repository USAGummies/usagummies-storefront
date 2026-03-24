# ABRA OPERATOR ARCHITECTURE — Transform Chatbot into Autonomous Operator

## Problem Statement
Abra is a reactive chatbot. It answers questions when asked but does not proactively operate the business. It does not categorize transactions, record known financial data, follow up on emails, fix data gaps, or execute tasks without being explicitly prompted by a human.

## Goal
Transform Abra from a chatbot into an autonomous operator that:
1. Maintains a persistent task queue of things that need to be done
2. Works through tasks autonomously during scheduled cycles
3. Detects gaps and creates new tasks for itself
4. Executes actions (QBO writes, email sends, Notion updates) without waiting for human prompts
5. Reports what it did and asks for approval only when human judgment is required
6. Operates like an employee: comes in Monday morning, looks at what needs doing, and does it

## Architecture

### 1. OPERATOR LOOP (runs every 30 minutes via QStash cron)

```
┌─────────────────────────────────────────┐
│           OPERATOR LOOP                  │
│                                          │
│  1. Check task queue for pending tasks   │
│  2. Check all data sources for gaps      │
│  3. Generate new tasks from gaps         │
│  4. Execute tasks (Tier 1 auto, Tier 2+  │
│     queue for approval)                  │
│  5. Report results to Slack              │
│  6. Update task status                   │
│  7. Schedule next cycle                  │
└─────────────────────────────────────────┘
```

### 2. TASK QUEUE (Supabase table: `abra_operator_tasks`)

```sql
CREATE TABLE abra_operator_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL,        -- 'qbo_categorize', 'qbo_record_loan', 'email_followup', etc.
  title TEXT NOT NULL,            -- Human-readable: "Categorize $21.69 Anthropic charge to Software"
  description TEXT,               -- Full context for execution
  priority TEXT DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
  status TEXT DEFAULT 'pending',  -- 'pending', 'in_progress', 'completed', 'failed', 'blocked', 'needs_approval'
  source TEXT,                    -- 'gap_detector', 'user_request', 'email_scan', 'scheduler'
  assigned_to TEXT,               -- 'abra', 'ben', 'rene'
  requires_approval BOOLEAN DEFAULT false,
  approval_id UUID,              -- Links to approvals table if needed
  execution_params JSONB,        -- Parameters for the action handler
  execution_result JSONB,        -- Result after execution
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  due_by TIMESTAMPTZ,            -- Optional deadline
  depends_on UUID[],             -- Task dependencies
  tags TEXT[]                    -- ['qbo', 'finance', 'email', 'vendor']
);
```

### 3. GAP DETECTORS (run every operator cycle)

Each detector scans a data source and creates tasks for anything that's missing or wrong.

#### 3.1 QBO Gap Detector
```
Checks:
- Uncategorized transactions → creates 'qbo_categorize' task for each
- Missing vendor assignments → creates 'qbo_assign_vendor' task
- Revenue accounts with $0 → creates 'qbo_record_revenue' task
- Known transactions not in QBO (brain entries about payments) → creates 'qbo_record_transaction' task
- Opening balance incorrect → creates 'qbo_fix_opening_balance' task (needs_approval)
- Investor capital not recorded → creates 'qbo_record_investor_loan' task (needs_approval)
- Bank feed transactions pending review → creates 'qbo_review_bank_feed' task
- COGS not booked → creates 'qbo_book_cogs' task
- Basis mismatch (accrual vs cash) → creates 'qbo_fix_basis' task (needs_approval)
```

#### 3.2 Email Gap Detector
```
Checks:
- Emails >24h old without response from tracked senders → creates 'email_draft_response' task
- Emails with action items not yet actioned → creates 'email_action_item' task
- Invoices/receipts in inbox not recorded in QBO → creates 'qbo_record_from_email' task
- Vendor communications requiring follow-up → creates 'vendor_followup' task
```

#### 3.3 Inventory Gap Detector
```
Checks:
- FBA inventory below 30-day threshold → creates 'inventory_reorder_alert' task
- Inventory counts not verified in >30 days → creates 'inventory_audit' task
- PO fulfillment deadlines approaching → creates 'po_fulfillment_check' task
```

#### 3.4 Pipeline Gap Detector
```
Checks:
- Distributor samples shipped >7 days with no follow-up → creates 'distributor_followup' task
- Broker relationship stale >14 days → creates 'broker_followup' task
- Wholesale leads with no response >5 days → creates 'wholesale_followup' task
```

#### 3.5 Compliance Gap Detector
```
Checks:
- Monthly close not started by 25th → creates 'monthly_close_start' task
- Tax filing deadlines approaching → creates 'tax_deadline_alert' task
- Insurance renewal dates → creates 'insurance_renewal_check' task
```

### 4. TASK EXECUTOR

Each task type has a handler that knows how to execute it autonomously.

```typescript
const TASK_HANDLERS: Record<string, TaskHandler> = {
  // QBO Operations
  'qbo_categorize': async (task) => {
    // Read transaction details from execution_params
    // Determine correct account based on vendor/description matching
    // Call QBO API to update the transaction category
    // Return success/failure
  },

  'qbo_record_transaction': async (task) => {
    // Create a Purchase or Deposit in QBO
    // Use execution_params for amount, vendor, account, date
  },

  'qbo_record_investor_loan': async (task) => {
    // Create journal entry: Debit Cash, Credit Investor Loan (2300)
    // Amount from execution_params
    // REQUIRES APPROVAL
  },

  'qbo_assign_vendor': async (task) => {
    // Match transaction description to known vendor patterns
    // Update the transaction's vendor field in QBO
  },

  'qbo_book_cogs': async (task) => {
    // Create journal entry for COGS based on production run data
    // Debit COGS accounts (5100-5400), Credit AP or Cash
  },

  // Email Operations
  'email_draft_response': async (task) => {
    // Read the original email
    // Generate a contextual response using brain + email history
    // Queue as draft for approval (ALWAYS requires approval)
  },

  'email_action_item': async (task) => {
    // Extract action items from email
    // Create corresponding tasks
  },

  // Vendor Operations
  'vendor_followup': async (task) => {
    // Draft follow-up email based on last communication
    // Queue for approval
  },

  'distributor_followup': async (task) => {
    // Check delivery status of samples
    // Draft follow-up email
    // Queue for approval
  },

  // Inventory Operations
  'inventory_reorder_alert': async (task) => {
    // Calculate reorder quantity
    // Post alert to Slack with recommendation
    // AUTO-EXECUTE (alert only, no purchase)
  },
};
```

### 5. APPROVAL INTEGRATION

Tasks are categorized by risk level:

| Risk | Auto-Execute | Examples |
|------|-------------|----------|
| None | Yes | Read data, generate reports, post Slack alerts, categorize obvious transactions |
| Low | Yes with audit | Assign known vendors, categorize transactions matching rules |
| Medium | Queue for approval | Record transactions >$500, create invoices, send emails |
| High | Queue + notify | Record investor capital, modify opening balances, change accounting basis |
| Critical | Queue + notify + block | Delete data, modify security, change bank connections |

### 6. REPORTING

After each operator cycle, post a summary to Slack:

```
🤖 Abra Operator Cycle — 10:30 AM PT

✅ Completed:
• Categorized 12 QBO transactions (Pirate Ship → Shipping, Anthropic → Software)
• Recorded $449 PirateShip invoice to Shipping & Delivery
• Drafted follow-up email to Patrick McDonald (awaiting approval)

⏳ Awaiting Approval:
• Record $100K investor loan from Rene → Account 2300
• Send follow-up to Reid Mitchell re: wholesale pricing

🔍 New Tasks Detected:
• 3 emails from vendors need responses (Powers, Albanese, EcoEnclose)
• Amazon revenue not in QBO for March — needs journal entry
• FBA inventory at 42-day supply — approaching 30-day threshold

📊 QBO Health: 67% categorized (was 45% yesterday)
```

### 7. PROACTIVE COMMUNICATION

Instead of waiting to be asked, Abra initiates:

```typescript
// In #financials for Rene:
"@Rene I categorized 12 transactions this morning.
3 need your review:
1. $2,000 Zelle to Katie — I don't know what this is for. Personal or business?
2. $134.70 Amazon Payments — Is this a refund or a fee?
3. $54 Ownerrez — This looks personal (vacation rental software). Confirm?

Reply with the numbers and I'll update QBO."

// In #abra-control for Ben:
"@Ben Morning update:
• Inderbitzin PO fulfillment: Andrew's shipment tracking shows delivery tomorrow
• 3 distributor samples confirmed delivered (KeHE, McLane TX, UNFI)
• Reid Mitchell hasn't responded in 5 days — draft follow-up ready for your approval
• Powers meeting prep doc ready for Wednesday — want me to post it?"
```

### 8. IMPLEMENTATION PLAN

#### Phase 1: Task Queue + QBO Operator (2-3 days)
- Create `abra_operator_tasks` table in Supabase
- Build QBO gap detector (uncategorized txns, missing vendors, $0 revenue)
- Build QBO task handlers (categorize, record transaction, assign vendor)
- Wire into scheduler as a new step
- Post cycle reports to Slack

#### Phase 2: Email Operator (1-2 days)
- Build email gap detector (unanswered emails, action items)
- Build email task handlers (draft response, extract action items)
- Proactive email summaries in morning brief

#### Phase 3: Pipeline Operator (1 day)
- Build pipeline gap detector (stale leads, overdue follow-ups)
- Build follow-up task handlers
- Distributor sample tracking automation

#### Phase 4: Full Autonomy (1-2 days)
- Cross-system gap detection (email mentions vendor → check QBO for invoice)
- Task dependency chains (categorize all → run P&L → post to Rene)
- Learning from corrections (Rene says "that's personal" → rule created)
- Self-improving categorization rules

### 9. KEY DESIGN PRINCIPLES

1. **Do, then report** — Don't ask permission for obvious actions. Categorize the Pirate Ship charge to Shipping. Report it was done. Rene can correct if wrong.

2. **Ask only when genuinely uncertain** — "Is $2,000 to Katie personal or business?" is a real question. "Should I categorize Anthropic as Software?" is not — just do it.

3. **Never go silent** — If a task fails, say so immediately. "I tried to categorize this transaction but QBO returned an error. Here's what happened."

4. **Build context continuously** — Every correction Rene makes becomes a new rule. Every email response pattern becomes a template. Abra gets smarter over time.

5. **Operate on ALL data sources simultaneously** — Don't just check QBO when asked about QBO. Cross-reference email, bank feed, brain entries, and KPI data to find gaps and inconsistencies proactively.

### 10. FILES TO CREATE/MODIFY

```
NEW:
  src/lib/ops/operator/operator-loop.ts         — Main operator loop
  src/lib/ops/operator/gap-detectors/qbo.ts     — QBO gap detection
  src/lib/ops/operator/gap-detectors/email.ts   — Email gap detection
  src/lib/ops/operator/gap-detectors/pipeline.ts — Pipeline gap detection
  src/lib/ops/operator/gap-detectors/inventory.ts — Inventory gap detection
  src/lib/ops/operator/task-executor.ts          — Task execution engine
  src/lib/ops/operator/task-reporter.ts          — Slack reporting
  src/app/api/ops/abra/operator/route.ts         — API endpoint for operator cycle

MODIFY:
  src/app/api/ops/abra/scheduler/route.ts        — Add operator step
  src/lib/ops/abra-morning-brief.ts              — Include operator task summary
  supabase/migrations/                            — Add abra_operator_tasks table

SUPABASE:
  Run migration to create abra_operator_tasks table
  Add indexes on status, priority, task_type, assigned_to
```

### 11. SUCCESS CRITERIA

Abra is an operator when:
- [ ] QBO transactions get categorized without anyone asking
- [ ] Known financial events (investor capital, production costs) get recorded automatically
- [ ] Vendor emails get follow-up drafts without prompting
- [ ] Rene gets proactive questions about ambiguous transactions, not silence
- [ ] The morning brief includes "here's what I did overnight" not just "here's your data"
- [ ] Ben can go dark for 3 days and Abra keeps operating
- [ ] Every operator cycle produces a Slack report of actions taken
- [ ] Categorization accuracy improves over time from corrections
