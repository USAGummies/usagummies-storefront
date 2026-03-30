# ABRA PRODUCTION CONTRACT

## Purpose
This document defines the hard production contract for Abra.
Every critical workflow has an explicit input, routing, output, idempotency, and failure contract.
Nothing ships to live use until it passes the acceptance gate at the bottom of this document.

This is not aspirational. This is the minimum required behavior.

---

## Principle: Two Paths, No More

### Path 1 — Human Interactive (Slack DM / @Abra mention)
```
Slack event → deterministic-router.ts → action-executor.ts → single reply publisher → done
```
- ONE ingress: Slack Events API route
- ONE router: `deterministic-router.ts` classifies intent
- ONE executor: `action-executor.ts` runs the action
- ONE publisher: `abra-slack-responder.ts` sends exactly one reply
- ONE dedup: KV lock keyed on `{channel}:{ts}:{intent}` before any publish
- NO second conversational path. No legacy responder. No parallel LLM classification.

### Path 2 — Autonomous (Scheduled / Paperclip)
```
Cron/QStash trigger → Paperclip routine → backend adapters → single output publisher → done
```
- ONE scheduler: Paperclip cron dispatch only
- ONE routine definition: `AGENTS.md` entries with explicit instructions
- ONE adapter layer: same backend functions as Path 1
- ONE publisher: same publish rules as Path 1
- NO old engine-runner autonomous behavior. NO stale-context agent wakeups.

If a path is not one of these two, it must be disabled.

---

## Critical Workflow Contracts

### WF-1: Direct Slack Q&A
**What**: Human asks Abra a question in Slack (DM or @mention)
**Owner file**: `src/lib/ops/operator/deterministic-router.ts`

| Contract | Requirement |
|----------|-------------|
| **Input** | Slack message event with `@Abra` mention or DM |
| **Routing** | Router classifies into: finance, email, calendar, QBO, general knowledge, file-processing, or unknown |
| **Output** | Single threaded reply in the same channel/thread. No duplicate. No cross-channel leak. |
| **Idempotency** | KV lock `slack:reply:{channel}:{message_ts}` — claimed before any work begins. If lock exists, drop silently. |
| **Failure** | Reply with: "I hit an error on this one — [1-line reason]. Let me know if you want me to retry." No silent failures. No partial outputs. |
| **Boundary** | Must never route a question about meetings/dates to the finance pipeline. Must never route a file upload to the Q&A path. |

**Pass criteria**: 10 consecutive varied questions answered correctly with zero duplicates, zero misroutes.

---

### WF-2: Morning Brief
**What**: Daily automated summary posted to designated channel
**Owner file**: `AGENTS.md` routine definition + Paperclip executor

| Contract | Requirement |
|----------|-------------|
| **Input** | Cron trigger (once daily, AM) |
| **Routing** | Paperclip dispatch only. Not triggered by Slack messages. |
| **Output** | Single message in `#all-usa-gummies` (or designated brief channel). Contains: yesterday's revenue, open tasks, key alerts. |
| **Idempotency** | KV lock `brief:morning:{YYYY-MM-DD}` — one per calendar day. If already posted, skip entirely. |
| **Failure** | If any data source fails, post partial brief with explicit "[X data unavailable]" markers. Never post stale yesterday's brief as today's. |
| **Boundary** | Must not duplicate content already posted by finance digest. Must not post to wrong channel. |

**Pass criteria**: 3 consecutive days with correct, non-duplicate, materially accurate briefs.

---

### WF-3: Finance Digest
**What**: Daily financial summary (revenue, expenses, bank balances)
**Owner file**: `scripts/daily-report.mjs` + Paperclip routine

| Contract | Requirement |
|----------|-------------|
| **Input** | Cron trigger or manual `/digest` command |
| **Routing** | Paperclip for scheduled. Router for manual request. Same backend function either way. |
| **Output** | Single message in `#financials`. MTD totals must match QBO/bank truth within $1. |
| **Idempotency** | KV lock `digest:finance:{YYYY-MM-DD}` — one per day. Manual re-request replaces (edit), does not duplicate. |
| **Failure** | If QBO unreachable, say so. If bank data stale, say so with timestamp. Never fabricate or carry forward old numbers. |
| **Boundary** | Found Banking is NOT the primary bank. Bank of America is. All balance references must be BoA unless explicitly about Found. |

**Pass criteria**: 3 consecutive days with correct MTD totals verified against QBO.

---

### WF-4: PO Review & Invoice Pipeline
**What**: Process incoming POs, generate/review invoices in QBO
**Owner file**: `src/lib/ops/operator/po-pipeline.ts`

| Contract | Requirement |
|----------|-------------|
| **Input** | Email with PO attachment, or Slack file upload tagged as PO |
| **Routing** | Email intelligence detects PO → PO pipeline. Slack upload with "PO" keyword → PO pipeline. |
| **Output** | Draft invoice created in QBO (NEVER auto-sent). Confirmation posted to `#financials` with: customer, amount, line items, QBO invoice link. |
| **Idempotency** | KV lock `po:{customer}:{po_number}` — one invoice per PO. If duplicate PO detected, reply "This PO was already processed on [date], invoice #[X]." |
| **Failure** | If QBO auth fails, retry once with force-refresh. If still fails, notify `#financials` with error. Never create duplicate invoices. |
| **Boundary** | Invoices are DRAFT only. sendEmail must be explicitly false. Product must be the correct inventory item, not "Hours." |

**Pass criteria**: 3 POs processed correctly with zero duplicates, zero wrong products, zero auto-sends.

---

### WF-5: Email Intelligence
**What**: Monitor inbox, extract actionable items, route to correct workflows
**Owner file**: `src/lib/ops/operator/email-intelligence.ts`

| Contract | Requirement |
|----------|-------------|
| **Input** | Gmail inbox scan (scheduled) or "check my email" Slack command |
| **Routing** | Email intelligence is the ONLY email intake path. No duplicate sweep behavior elsewhere. |
| **Output** | Actionable items routed to correct workflow (PO → WF-4, approval request → WF-6, general → summary). Non-actionable emails ignored. |
| **Idempotency** | Track `email:processed:{message_id}` — never process same email twice. |
| **Failure** | If Gmail auth fails, report it. Never report "no new emails" when the scan actually failed. |
| **Boundary** | PII (customer emails, phone numbers) must not leak into public channels. Summaries only. |

**Pass criteria**: 10 emails correctly classified with zero duplicates, zero PII leaks, zero misroutes.

---

### WF-6: Approvals
**What**: Human-in-the-loop approval for sensitive actions (send invoice, large expense, etc.)
**Owner file**: `src/lib/ops/operator/action-executor.ts` (approval gate)

| Contract | Requirement |
|----------|-------------|
| **Input** | Action executor determines approval needed based on action type + threshold |
| **Routing** | Approval request posted to Slack with interactive buttons (Approve / Reject) |
| **Output** | On approve: execute action, confirm result. On reject: cancel, confirm cancellation. On timeout (24h): expire, notify. |
| **Idempotency** | KV lock `approval:{action_type}:{entity_id}` — one pending approval per action. No duplicate approval requests. |
| **Failure** | If the approved action fails, report failure. Never silently swallow a failed execution after approval. |
| **Boundary** | Approval is required for: sending invoices, expenses > $500, customer communications. Approval is NOT required for: QBO reads, internal summaries, Slack replies. |

**Pass criteria**: 3 approval flows complete (approve, reject, timeout) with correct execution.

---

### WF-7: File Processing (Spreadsheets, Images, PDFs)
**What**: Parse uploaded files and take appropriate action
**Owner file**: `deterministic-router.ts` → file-specific handler

| Contract | Requirement |
|----------|-------------|
| **Input** | File uploaded to Slack channel or DM with @Abra |
| **Routing** | Router detects file attachment → classifies file type → routes to handler: xlsx→spreadsheet parser, image→receipt/label extractor, pdf→document parser |
| **Output** | Parsed content + appropriate action. For COA spreadsheet: create accounts in QBO. For receipt image: extract amount/vendor/date. For PO PDF: route to WF-4. |
| **Idempotency** | KV lock `file:{file_id}` — process each file exactly once. |
| **Failure** | If file unreadable, say so with file type and size. If downstream action fails (e.g., QBO 401), retry once, then report. Never say "I can't read files" if the capability exists. |
| **Boundary** | Bot must have `files:read` Slack scope. If scope missing, fail with actionable error ("Abra needs files:read permission — ask admin to add it"). |

**Pass criteria**: 3 file types (xlsx, image, pdf) processed correctly with zero false-negative capability claims.

---

### WF-8: Bank & Transaction State
**What**: Answer questions about bank balances, recent transactions, cash position
**Owner file**: `deterministic-router.ts` → QBO/Plaid adapter

| Contract | Requirement |
|----------|-------------|
| **Input** | Slack question about money, balance, transactions, or cash |
| **Routing** | Router classifies as finance → QBO query or Plaid balance check |
| **Output** | Current balance from authoritative source (QBO or Plaid). Transaction list if requested. Always state the data source and freshness. |
| **Idempotency** | Read-only queries don't need dedup. But bank-feed posting does: `bankfeed:{YYYY-MM-DD}` — one post per day. |
| **Failure** | If QBO/Plaid unreachable, say "I can't reach [source] right now" with last-known timestamp. Never fabricate balances. |
| **Boundary** | Primary bank is Bank of America, not Found Banking. If someone asks "what's our balance," default to BoA. Found is secondary and must be explicitly named. |

**Pass criteria**: 5 balance/transaction queries answered correctly with accurate amounts verified against QBO.

---

## System-Wide Rules

### Publish Rules (ALL workflows)
1. **Lock first**: Acquire KV lock before any work begins
2. **Reserve state**: Write intent to state store before producing output
3. **Publish second**: Send Slack message / create QBO entity only after lock + state
4. **Never publish before state reservation**
5. **One message per event**: No workflow may produce more than one top-level Slack message per trigger event

### Capability Truth Rules
- If Abra can do it → do it. Never say "I can't" when the code path exists.
- If Abra cannot do it → say exactly why and what's needed to fix it.
- Never hallucinate a capability. Never claim a false limitation.
- Runtime capabilities are: Gmail read, QBO read/write, Slack read/write, Plaid balance, file parsing (xlsx/csv/pdf/image), Notion read/write.

### Session Hygiene Rules
- Scheduled agents start with fresh context (no resume from stale state)
- Agent instructions live in `AGENTS.md`, not in hidden prompt layers
- No agent may depend on a specific developer machine being online
- No agent may depend on a previous session's conversation context

### Output Hygiene Rules
- No PII in public channels (email addresses, phone numbers, SSNs)
- No raw error dumps in user-facing messages
- Every output must state its source when reporting numbers
- Every output must be posted to the correct channel (never leak across channels)

---

## What Gets Disabled If Not Trustworthy

| Component | Condition to Disable | How to Disable |
|-----------|---------------------|----------------|
| Old Abra autonomous agents | If any duplicate posting detected | Set `ABRA_LEGACY_AGENTS=false` in env |
| Old Abra Slack responder path | If Path 1 router is active | Remove legacy event handler registration |
| Bank feed auto-posting | If duplicates detected in any 24h window | KV flag `bankfeed:paused=true` |
| Morning brief | If 2 consecutive days have materially wrong data | KV flag `brief:paused=true` |
| Email intelligence auto-actions | If any PII leak detected | KV flag `email:autoact:paused=true` |
| Invoice auto-creation | If any duplicate invoice created | KV flag `invoice:autocreate:paused=true` |

Disabled components stay disabled until a human (Ben or Rene) explicitly re-enables after the root cause is fixed.

---

## Ship Gate Checklist

Before Abra is declared "production ready" for any workflow, ALL of these must be true:

- [ ] **WF-1**: Direct Slack Q&A — 10/10 pass
- [ ] **WF-2**: Morning Brief — 3/3 days pass
- [ ] **WF-3**: Finance Digest — 3/3 days pass
- [ ] **WF-4**: PO Review — 3/3 POs pass
- [ ] **WF-5**: Email Intelligence — 10/10 emails pass
- [ ] **WF-6**: Approvals — 3/3 flows pass (approve, reject, timeout)
- [ ] **WF-7**: File Processing — 3/3 file types pass
- [ ] **WF-8**: Bank State — 5/5 queries pass

- [ ] **Zero duplicate messages** in any channel for 72 consecutive hours
- [ ] **Zero misrouted messages** for 72 consecutive hours
- [ ] **Zero PII leaks** for 72 consecutive hours
- [ ] **Zero false capability claims** for 72 consecutive hours

- [ ] All legacy/overlapping paths confirmed disabled
- [ ] Slack bot has all required scopes (`files:read` included)
- [ ] All KV dedup keys tested and verified
- [ ] All failure modes tested (QBO 401, Gmail timeout, Slack rate limit)

No workflow is "ready" until its checklist row is checked by a human who verified it in production.

---

## Version
- Created: 2026-03-29
- Author: Claude Code + Ben Stutman
- Status: ACTIVE — this is the governing contract
