# ABRA COMPLETE BUILD PLAN — Zero Failures, Full Operator

## Reality Check
Abra has failed Rene every single time he's used it. The pattern:
1. Rene messages → Abra doesn't respond (wrong endpoint, missing forceRespond)
2. Rene asks for data → Abra says "On it" and does nothing (no action emitted)
3. Rene asks for a file → File goes to wrong channel or doesn't generate
4. QBO isn't set up → Rene can't work

These are not edge cases. These are the core workflow. Every one must work 100% of the time.

## What Rene Needs (non-negotiable)

1. **Message Abra in #financials → get a response within 10 seconds.** Every time. No exceptions.
2. **Ask for QBO data → get accurate data.** P&L, balance sheet, transactions, vendors.
3. **Ask for a file → get the file in the same channel.** Not #abra-control. Not "generating...". The file.
4. **Ask Abra to do something in QBO → it gets done.** Categorize, create vendor, record transaction.
5. **Get proactive updates.** "3 transactions need your review" — not silence.

## What Ben Needs (non-negotiable)

1. **Morning brief that actually delivers.** DM when he says good morning. Revenue, emails, action items.
2. **Email management through Abra.** "Read my emails" → emails. "Draft a reply to Reid" → draft.
3. **Multi-step requests work.** 5 questions → 5 answers. Not 3 answers and 2 timeouts.
4. **Abra operates autonomously.** Categorizes QBO transactions. Drafts vendor follow-ups. Flags issues.
5. **Honest when it can't do something.** Never "On it" without action. Never silent failure.

---

## BUILD PHASES

### PHASE 0: UNFAILABLE FOUNDATION (today — before bed)
**Goal: The 5 things Rene does must work 100% tomorrow morning.**

| # | Task | Status | Owner |
|---|------|--------|-------|
| 0.1 | Abra responds to ALL messages in #financials without @mention | ✅ DONE | Claude — deployed commit 3b37e72 |
| 0.2 | QBO fully set up per Rene's instructions | ✅ DONE | Claude — cash basis, accounts, vendors, $100K loan, revenue, COGS |
| 0.3 | Rene added as QBO user | ✅ DONE | Ben — invite sent |
| 0.4 | File uploads go to requesting channel, not #abra-control | ✅ DONE | Claude — slack_channel_id passthrough |
| 0.5 | Slack app reinstalled with message.groups scope | ⬜ TODO | Ben — click "Reinstall to USA Gummies" at api.slack.com/apps |
| 0.6 | Test: Send 5 messages as Rene in #financials, verify all get responses | ⬜ TODO | Claude — after deploy |
| 0.7 | Test: Ask for P&L, balance sheet, transaction list — verify data accuracy | ⬜ TODO | Claude — after deploy |
| 0.8 | Test: Ask for Excel export — verify file appears in #financials | ⬜ TODO | Claude — after deploy |

### PHASE 1: OPERATOR SYSTEM (Codex — building now)
**Goal: Abra does work autonomously without being asked.**

| # | Task | Status | Owner |
|---|------|--------|-------|
| 1.1 | Task queue table (abra_operator_tasks) | ✅ DONE | Codex Phase 1 |
| 1.2 | QBO gap detector | ✅ DONE | Codex Phase 1 |
| 1.3 | Task executor | ✅ DONE | Codex Phase 1 |
| 1.4 | Slack cycle reporter | ✅ DONE | Codex Phase 1 |
| 1.5 | Operator loop wired to scheduler | ✅ DONE | Codex Phase 1 |
| 1.6 | Email gap detector | ⬜ BUILDING | Codex Phase 2 |
| 1.7 | Pipeline gap detector | ⬜ BUILDING | Codex Phase 2 |
| 1.8 | Integration test | ⬜ BUILDING | Codex Phase 2 |
| 1.9 | First live operator cycle — verify tasks created and executed | ⬜ TODO | Claude — after Codex Phase 2 |

### PHASE 2: RENE-PROOF RELIABILITY (tonight)
**Goal: Every interaction Rene has with Abra works. No exceptions.**

| # | Task | Description |
|---|------|-------------|
| 2.1 | **Response guarantee** | If Abra receives a message and doesn't respond within 30 seconds, post "I'm processing your request — one moment" as a fallback. NEVER go silent. |
| 2.2 | **QBO query fast-path** | "Show me transactions", "P&L", "balance sheet" → deterministic QBO query, no LLM decision needed. Return data within 5 seconds. |
| 2.3 | **File generation fast-path** | "Send me an Excel of X" → deterministic file generation, no LLM decision needed. Generate and upload within 10 seconds. |
| 2.4 | **Actor detection** | Detect Rene vs Ben from Slack user ID. Rene gets: shorter responses, finance-focused, QBO actions auto-triggered. Ben gets: full operational context. |
| 2.5 | **Thread context** | Every response includes full thread history. No "which document?" when Rene already said it 2 messages ago. |
| 2.6 | **Error recovery** | If QBO returns 401, auto-refresh token and retry. If action fails, tell the user immediately with the reason. Never swallow errors. |
| 2.7 | **Duplicate suppression** | No duplicate signal alerts (the -86% revenue drop 3x). No duplicate approval requests. No duplicate file uploads. |

### PHASE 3: PROACTIVE OPERATIONS (Wednesday)
**Goal: Abra initiates, not just responds.**

| # | Task | Description |
|---|------|-------------|
| 3.1 | **Morning financial brief for Rene** | Posted to #financials at 8am: uncategorized transaction count, new bank feed items, P&L snapshot, any items needing his review. |
| 3.2 | **Operator cycle reports** | Every 30 min: "Categorized 5 transactions. 2 need your review. QBO health: 89% categorized." |
| 3.3 | **Email response tracking** | "Reid Mitchell emailed 3 days ago — no reply sent. Draft ready for approval." |
| 3.4 | **Vendor follow-up automation** | "Powers hasn't responded in 5 days. Draft follow-up ready." |
| 3.5 | **Distributor sample tracking** | "3 of 34 samples confirmed delivered. 8 in transit. 23 unknown." |
| 3.6 | **Weekly AR/AP report** | Auto-generated Excel, posted to #financials every Monday. |
| 3.7 | **Monthly P&L report** | Auto-generated on the 1st, posted for Rene's review. |

### PHASE 4: SELF-HEALING (Thursday)
**Goal: When Abra breaks, it fixes itself or escalates immediately.**

| # | Task | Description |
|---|------|-------------|
| 4.1 | **Health monitor** | Every 30 min: check QBO connection, Slack webhook, Gmail auth, Supabase, all feeds. If any fail → fix or alert. |
| 4.2 | **Action verification** | After every action, verify it worked. "Created vendor" → query QBO to confirm vendor exists. If not → retry or alert. |
| 4.3 | **Claude Code escalation** | If Abra can't do something (missing handler, auth failure, code bug) → create a GitHub issue or post to #abra-control with full error context for Claude Code to pick up. |
| 4.4 | **Self-improving categorization** | When Rene corrects a categorization, create a new rule so the same pattern is auto-categorized next time. |
| 4.5 | **Stale data detection** | If KPI data is >24h old, if brain entries conflict, if QBO and bank balance disagree → flag and attempt to fix. |

### PHASE 5: FULL AUTONOMY (next week)
**Goal: Abra runs the business operations without daily intervention.**

| # | Task | Description |
|---|------|-------------|
| 5.1 | **Cross-system reconciliation** | Amazon settlements → match to QBO deposits. Shopify payouts → match to bank. Flag discrepancies. |
| 5.2 | **Invoice generation** | When Inderbitzin PO ships → auto-generate invoice in QBO → queue for approval → send. |
| 5.3 | **Inventory management** | Track FBA levels → alert at 30-day threshold → draft reorder recommendation. |
| 5.4 | **Financial scenario modeling** | "What if we land 3 more distributors at 500 units/week?" → model against real P&L data. |
| 5.5 | **Competitive intelligence** | Monitor competitor Amazon listings daily → alert on price changes, new products, BSR shifts. |
| 5.6 | **Board reporting** | Monthly board update auto-generated: financials, pipeline, operations, risks. |

---

## TESTING PROTOCOL

Every phase must pass these tests before deployment:

### Rene Test Suite (5 tests)
1. Rene sends "show me the P&L" in #financials → gets accurate P&L within 15 seconds
2. Rene sends "send me an Excel of all transactions" → gets XLSX file in #financials within 20 seconds
3. Rene sends "categorize the Anthropic charge to software" → Abra does it and confirms
4. Rene sends "what's the cash position?" → gets Plaid balance + QBO balance with explanation
5. Rene sends three messages in a row without @mentioning Abra → all three get responses

### Ben Test Suite (5 tests)
1. Ben says "good morning" → gets morning brief with emails, revenue, action items
2. Ben says "read my emails and tell me what needs responses" → gets email list with drafts
3. Ben sends a multi-part message with 4 questions → all 4 answered
4. Ben uploads a screenshot → Abra reads it and responds to the content
5. Ben asks about the company → gets sourced, accurate overview with real numbers

### Operator Test Suite (5 tests)
1. Operator cycle runs → detects uncategorized QBO transactions → creates tasks
2. Low-risk tasks auto-execute → transactions get categorized
3. High-risk tasks queue for approval → Slack button appears
4. Cycle report posts to Slack → shows what was done
5. No duplicate tasks created for the same item

### Stress Test (5 tests)
1. 10 messages sent in 60 seconds → all 10 get responses (no duplicates)
2. QBO token expires → auto-refreshes and retries
3. Slack webhook times out → after() processes the response
4. LLM says "On it" without action → honest failure detected and user notified
5. 3 people message simultaneously → all 3 get responses

---

## DAILY ACCOUNTABILITY

Starting tomorrow (Wednesday March 25):
- 7:00 AM: Operator cycle runs, reports to Slack
- 7:30 AM: Self-health check
- 8:00 AM: Morning brief prepared (held until Ben DMs)
- 8:00 AM: Rene financial brief posted to #financials
- Every 30 min: Operator cycle (detect → execute → report)
- Every 2 hours: Email scan for unanswered messages
- 6:00 PM: End-of-day summary

If ANY of these fail, Abra posts to #abra-control: "⚠️ [system] failed at [time] — [reason]. Attempting fix..."

---

## SUCCESS = RENE NEVER HAS A BAD EXPERIENCE AGAIN

That's the only metric that matters. Not commits, not test scores, not brain entries. Rene messages Abra → Abra delivers. Every. Single. Time.
