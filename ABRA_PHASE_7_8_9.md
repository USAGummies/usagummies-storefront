# ABRA PHASES 7-9 — From Operator to Autonomous Employee

## PHASE 7: Self-Correcting Financial Intelligence
**Goal: Abra fixes its own data problems without being told.**

### 7.1 QBO Data Integrity Engine
The operator detects gaps. Now it needs to FIX them intelligently.

**Uncategorized Transaction Resolver:**
- When the operator finds an uncategorized transaction, instead of just logging it, Abra should:
  1. Read the transaction description from QBO
  2. Search brain entries for matching vendor names or patterns
  3. Search email for invoices/receipts matching the amount and date
  4. If confidence > 80%: auto-categorize and log the reasoning
  5. If confidence 50-80%: post to #financials asking Rene to confirm: "I think $21.69 ANTHROPIC is Software (account 126). Confirm or correct?"
  6. If confidence < 50%: leave uncategorized, add to Rene's review list

**P&L Sanity Checker:**
- After every QBO data change, run a sanity check:
  - Revenue should be positive
  - Expenses should be positive (not negative — that means double-counting)
  - Net Income = Revenue - COGS - Expenses (verify the math)
  - If any check fails, identify the bad entries and either fix them or flag for Rene
  - Post the correction to #financials: "Found a P&L calculation error — expenses were recorded as negative, causing net income to show $16K instead of -$10K. Fixed by [action taken]."

**Journal Entry Corrector:**
- When deposits are recorded that should be revenue, verify they're coded to the right income account
- When expenses are recorded as negative amounts, detect and fix the sign
- The $100K investor loan should show as: Debit Cash (asset up), Credit Investor Loan (liability up) — verify this is correct in QBO

### 7.2 Learning from Rene's Corrections
Every time Rene corrects a categorization or says "that's wrong":
1. Extract the correction: what was wrong, what's right
2. Create a new categorization rule: "Transactions containing [pattern] should be coded to [account]"
3. Store the rule in Supabase (new table or existing qbo rules)
4. Apply retroactively: find all similar uncategorized transactions and fix them
5. Confirm to Rene: "Got it — I'll categorize all future [pattern] transactions to [account]. I also found 3 historical ones and fixed them."

### 7.3 QBO Bank Feed Auto-Matching
When new transactions appear in the bank feed:
1. Match against known vendor patterns (Pirate Ship, Anthropic, etc.)
2. Match against recent invoices/bills in QBO
3. Match against email receipts/invoices
4. Auto-post matches with high confidence
5. Queue uncertain matches for Rene's review
6. Post summary: "5 new bank feed transactions: 3 auto-matched, 2 need your review"

---

## PHASE 8: Proactive Business Operations
**Goal: Abra does the work before anyone asks.**

### 8.1 Daily Financial Reconciliation
Every morning before the brief:
1. Pull Amazon settlement reports → compare to QBO deposits
2. Pull Shopify payouts → compare to QBO deposits
3. Pull Plaid bank balance → compare to QBO book balance
4. If discrepancies found: log them, attempt to fix, report what's off
5. Include in morning brief: "Reconciliation: Amazon $X matches bank ✅, Shopify $Y has $Z unmatched"

### 8.2 Invoice Generation for Wholesale
When a wholesale order ships (detected from email or taught by Ben):
1. Auto-generate a QBO invoice for the customer (Inderbitzin)
2. Use the wholesale price ($2.10/unit) and quantity from the order
3. Queue for Ben's approval before sending
4. Track payment status: if invoice > 30 days unpaid, alert

### 8.3 Vendor Payment Tracking
Track all vendor bills and payments:
1. When a bill is created in QBO, start tracking payment due date
2. Alert 5 days before due: "Powers invoice $X due in 5 days"
3. After payment, match the bank withdrawal to the bill
4. Post weekly AP aging to #financials for Rene

### 8.4 Inventory-Driven Alerts
When Amazon FBA inventory drops below thresholds:
1. 45-day supply: info alert
2. 30-day supply: warning with reorder recommendation
3. 14-day supply: critical alert with draft PO to Powers
4. Calculate reorder quantity based on velocity + lead time

### 8.5 Email-to-Action Pipeline (drafts only, NEVER auto-send)
When emails arrive from tracked senders:
1. Read the email and extract action items
2. For each action item, create an operator task
3. If a response is needed, draft it and queue for Ben's approval in Slack
4. NEVER send any email without explicit human approval
5. Show the draft in Slack with Approve/Edit/Reject buttons
6. Only after Ben clicks Approve does the email send

---

## PHASE 9: Financial Reporting Automation
**Goal: Reports generate themselves on schedule.**

### 9.1 Weekly AR/AP Report
Every Monday at 8am:
1. Pull all open invoices (AR) from QBO
2. Pull all unpaid bills (AP) from QBO
3. Generate Excel with: customer/vendor, amount, due date, age
4. Post to #financials for Rene
5. Highlight overdue items in red

### 9.2 Monthly P&L Report
On the 1st of each month:
1. Pull full P&L for the previous month from QBO
2. Compare to budget (from pro forma when Rene shares it)
3. Generate Excel with: actual vs budget, variance, % change
4. Post to #financials for Rene's review
5. Include: revenue by channel, COGS breakdown, expense categories

### 9.3 Monthly Balance Sheet
On the 1st of each month:
1. Pull balance sheet from QBO
2. Show: assets, liabilities, equity, loan balance remaining
3. Track month-over-month changes
4. Post to #financials

### 9.4 Cash Runway Projection
Weekly:
1. Pull current Plaid balance
2. Calculate average monthly burn from last 3 months of expenses
3. Project: "At current burn rate, cash runway is X months"
4. If runway < 3 months: critical alert
5. Include in the weekly report

### 9.5 Investor Update Package
Monthly:
1. Auto-generate: P&L, balance sheet, cash position, revenue by channel
2. Include: pipeline status, production run status, key decisions
3. Format as PDF or Excel
4. Queue for Ben's review before sharing with Rene
5. Track the $100K loan repayment progress

---

## CRITICAL RULES ACROSS ALL PHASES

1. **NEVER auto-send emails.** All outbound communication (email, Slack DM to external) must be drafted and queued for Ben's explicit approval via Slack button click.

2. **NEVER modify QBO data without logging.** Every QBO write (categorize, create, update) must be logged to abra_operator_tasks with full before/after state.

3. **Always tell Rene what you did.** After every autonomous action, post a summary to #financials. Never act silently.

4. **When uncertain, ask — don't guess.** If confidence < 50% on any financial action, ask Rene or Ben. Show your reasoning.

5. **Financial data must be verified.** Cross-reference at least 2 sources before presenting a number as fact. QBO vs KPI, QBO vs Plaid, QBO vs email receipts.

---

## IMPLEMENTATION ORDER

| Phase | Items | Codex Prompt # |
|-------|-------|---------------|
| 7.1 | Uncategorized resolver + P&L sanity checker | Prompt 1 |
| 7.2 | Learning from corrections | Prompt 1 |
| 7.3 | Bank feed auto-matching | Prompt 1 |
| 8.1 | Daily reconciliation | Prompt 2 |
| 8.2 | Invoice generation | Prompt 2 |
| 8.3 | Vendor payment tracking | Prompt 2 |
| 8.4 | Inventory alerts | Prompt 2 |
| 8.5 | Email-to-action (drafts only) | Prompt 2 |
| 9.1-9.5 | All reporting automation | Prompt 3 |
