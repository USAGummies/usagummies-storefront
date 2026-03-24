# ABRA PHASES 10-12 — From Operator to Autonomous Executive Assistant

## PHASE 10: Proactive Intelligence + Batch Operations
**Goal: Abra surfaces work TO the user instead of waiting to be asked.**

### 10.1 Proactive Email Surfacing
Instead of creating silent tasks in a queue, Abra posts actionable email summaries directly to Slack:
- Every 2 hours, scan for unanswered emails from tracked senders
- For each one, post to #abra-control (for Ben) or #financials (if finance-related):
  "📧 Reid Mitchell emailed 3 days ago re: wholesale pricing for McLane DCs.
  [View Draft Reply] [Skip] [Remind Me Tomorrow]"
- The draft reply is pre-written using the 6-step framework
- Clicking View Draft shows the full text with Approve/Edit/Reject buttons
- NEVER auto-send

### 10.2 Batch Transaction Review for Rene
Instead of 50 individual tasks, present uncategorized transactions as ONE batch:
- Generate an Excel with all uncategorized transactions (date, amount, description, suggested category, confidence)
- Post to #financials: "@Rene — 50 transactions need categorization. I categorized the ones I recognized. The attached Excel has the rest. You can:
  1. Reply with corrections (e.g., 'row 5 is personal, row 12 is shipping')
  2. Download, annotate, and upload back
  3. Tell me patterns ('anything from ARCO is vehicle fuel')"
- When Rene replies with corrections, the correction learner processes them and applies retroactively

### 10.3 Knowledge-Triggered Actions
When Ben teaches Abra something, trigger downstream actions:
- "teach: shipped 828 units to Inderbitzin today" →
  1. Create QBO invoice (draft, needs approval)
  2. Update pipeline status in brain
  3. Calculate revenue impact ($828 × $2.10 = $1,738.80)
  4. Alert: "Invoice queued. At 1000 bags/week, next reorder in ~6 days."
- "teach: Powers confirmed production start April 15" →
  1. Create brain entry
  2. Calculate timeline: production → QC → ship → receive
  3. Create calendar tasks for each milestone
  4. Alert: "Powers run starts April 15. Estimated delivery: May 1. FBA restock needed by April 20."

### 10.4 Meeting Prep Auto-Generation
When a meeting is approaching (detected from brain entries or calendar):
- 24 hours before: generate a meeting prep doc
- Include: open questions, last 5 emails from the contact, decisions needed, talking points, negotiation boundaries
- Post to Slack: "Your Powers meeting is tomorrow. Here's your prep doc: [file]"
- For the Greg/Powers meeting specifically:
  - Open questions: co-packing rate, production timeline, shelf life confirmation, Belmark film status
  - Greg's recent emails summarized
  - Negotiation points: target $0.35/unit co-pack, 50K unit minimum, payment terms

---

## PHASE 11: Cross-Platform Intelligence
**Goal: One source of truth across all channels.**

### 11.1 Unified Revenue Dashboard
Combine all revenue sources into one daily truth:
- Amazon: from KPI timeseries (Reports API backfilled)
- Shopify: from KPI timeseries
- Wholesale: from QBO invoices (Inderbitzin)
- Faire: from QBO/brain entries
- Calculate: total revenue, channel mix %, trend vs last week
- Post daily to #abra-control: "Today: $47.92 total ($35.94 Amazon, $11.98 Shopify, $0 Wholesale). MTD: $3,305. Channel mix: 89% Amazon, 11% DTC."

### 11.2 Amazon-QBO Reconciliation
When Amazon settlement reports arrive (every 2 weeks):
- Compare settlement amount to sum of individual order revenues in KPI
- Compare settlement deposit to QBO bank feed entry
- Flag discrepancies: "Amazon settlement #4521: $847.23 — KPI shows $861.40 ($14.17 difference = processing fees not categorized)"

### 11.3 Shopify-QBO Reconciliation
When Shopify payouts arrive:
- Match payout amount to QBO bank deposit
- Categorize to Revenue: Shopify DTC (account 4200)
- Flag if payout doesn't match expected revenue

### 11.4 Unified Inventory Position
Combine inventory from all locations:
- Amazon FBA: from SP-API inventory feed
- Ben's location: from brain entries (taught manually)
- Andrew's shipment: from brain entries
- In production at Powers: from brain entries
- Calculate total available, total committed (Inderbitzin PO), total free
- Alert when total free < 30 days of sales velocity

---

## PHASE 12: Mobile-First + Conversational UX
**Goal: Abra works perfectly from a phone.**

### 12.1 Response Length Optimization
All Slack responses must be optimized for mobile:
- Simple questions: max 300 chars (2-3 lines on phone)
- Data queries: bullets, no tables, max 500 chars
- Reports: summary line + "Full report attached as Excel"
- Never send a wall of text — break into digestible chunks

### 12.2 Quick Actions via Short Commands
Support ultra-short commands in Slack:
- "rev" → today's revenue + MTD
- "cash" → Plaid bank balance
- "pnl" → P&L summary (3 lines)
- "vendors" → vendor list (bullets)
- "tasks" → what needs attention
- "approve" → show pending approvals
These bypass the LLM entirely — deterministic responses in <2 seconds.

### 12.3 Slack Interactive Workflow Cards
Instead of text responses, use Slack Block Kit for interactive cards:
- Transaction review: card with amount, description, suggested category, Approve/Change/Skip buttons
- Email drafts: card with preview text, Approve/Edit/Reject buttons
- Approvals: card with action summary, Approve/Reject buttons
- Each card is self-contained — Rene can act without typing

### 12.4 Daily Digest Format
Morning brief and daily updates should be ONE compact message:
```
🌅 Good morning @Rene

💰 Yesterday: $47.92 rev | MTD: $3,305
📊 QBO: 89% categorized | 22 need review
📧 3 vendor emails need response
✅ Operator: 5 categorized overnight
⚠️ 1 approval pending

Reply "review" to see transactions or "emails" to see drafts.
```

Not the current wall of text with tables and sections.

---

## CRITICAL RULES (same as always)
1. NEVER auto-send emails
2. Log every QBO write
3. Tell Rene what you did
4. When uncertain, ask
5. Verify data across 2+ sources
