# ABRA SHARED EXECUTION LOG

## Purpose
This file is the shared execution surface for Codex and Claude Code.

Use it to:
- track active build work
- declare ownership
- record decisions
- note blockers
- hand off incomplete work cleanly
- prevent duplicate or conflicting implementation

This file is the repo-level collaboration truth.
Notion remains the high-level blueprint and storage layer.

## System Truth Hierarchy
1. Repo code and committed changes = executable truth
2. This file = active execution truth / shared handoff
3. `ABRA_TARGET_ARCHITECTURE.md` = product and systems target
4. Notion = blueprint, planning, archival storage, and human-readable system map

## Working Rules
- Do not let Codex and Claude Code edit the same core module in parallel.
- If a task changes runtime behavior, the owner must be explicit here first.
- Every completed task should record: owner, date, scope, result, and follow-up.
- Every blocker should name the exact file/system and what is blocked.
- If production behavior differs from local behavior, record it here immediately.

## Ownership Split
### Codex owns
- runtime architecture
- deterministic router
- action executor
- operator loop
- email intelligence
- PO pipeline
- reconciliation
- entity state model
- migrations and schema
- state/dedup systems
- core integration tests

### Claude Code owns
- live Slack behavior validation
- response formatting and user-facing polish
- thread continuity regressions
- morning brief presentation and behavior validation
- screenshot/image ingestion validation
- production smoke testing and failure triage
- Notion/logging/reporting polish
- real-world user QA for Ben and Rene

## Do Not Split These In Parallel
Single owner at a time:
- `src/lib/ops/abra-slack-responder.ts`
- `src/lib/ops/operator/deterministic-router.ts`
- `src/lib/ops/operator/action-executor.ts`
- `src/lib/ops/operator/email-intelligence.ts`
- `src/lib/ops/operator/operator-loop.ts`
- `src/lib/ops/operator/reconciliation.ts`
- `src/lib/ops/operator/po-pipeline.ts`
- `src/lib/ops/operator/entities/entity-state.ts`
- shared state key files

## Architecture Decisions
### AD-001
Notion is the blueprint and storage layer. It is not the primary execution engine.

### AD-002
Email is the highest-value business intake source.
All important email processing should converge into one authoritative email-intelligence path.

### AD-003
Slack is the human command and approval interface.
It should not contain business logic that belongs in workers/executors.

### AD-004
Deterministic code decides and executes core actions.
LLMs are used for extraction, summarization, and drafting inside bounded steps.

### AD-005
Supabase is the runtime state layer.
QBO is accounting truth. Gmail is communication truth.

## Current Build Buckets
### Keep / harden
- operator loop
- deterministic router
- action executor
- task executor
- email intelligence
- PO pipeline
- reconciliation
- entity state
- morning brief
- Gmail/QBO/Slack/Plaid integrations

### Contain
- department prompt abstractions
- event bus side effects
- generalized action proposal layer
- Notion write helpers that are not part of critical runtime paths

### Retire
- legacy overlapping Slack routes
- duplicate email sweep behavior outside email intelligence
- prompt-first action selection for core workflows
- one-off regex guardrails as architecture

### Rewrite / simplify
- oversized `abra-actions.ts`
- slack responder business logic leakage
- duplicated decision points for "should act" vs "should suppress"
- mixed email/task/approval decision logic spread across multiple modules

## Active Work Board
### Now
- [ ] Establish one authoritative execution backbone for core workflows
- [ ] Harden email intelligence into the only email intake path
- [ ] Finish PO lifecycle confidence and idempotency
- [ ] Normalize entity updates across email/slack/actions
- [ ] Reduce Slack responder to interface/orchestration role

### Next
- [ ] Break apart `abra-actions.ts`
- [ ] Unify approvals around deterministic handlers
- [ ] Formalize research department prerequisites
- [ ] Add deeper integration/evaluation suites around the true operational core

### Later
- [ ] Research department
- [ ] strategy simulation
- [ ] distributor sourcing and ranking
- [ ] competitor intelligence

## Current Task Ownership
### Codex — in progress
- Runtime architecture audit and target spec
- Shared execution control plane docs

### Claude Code — active (claimed 2026-03-28 14:30 PT)
- Read both canonical docs (done)
- Production Slack validation against target architecture (done — 10 mismatches total)
- Shipped Day 4-6 defensive patch (commit d73064a)
- Verified Codex PM-001/002/003 fixes, committed and pushed (commit 4197218)
- Live production QA: PM-001 PASS, PM-002 PASS, PM-003 PASS (2026-03-28 11:19 PDT)
- Full channel scan: found 5 new mismatches PM-006 through PM-010 (2026-03-28 11:30 PDT)
- Priority for Codex: PM-006 (bank feed spam, HIGH) and PM-010 (router misclassification, HIGH)

## Handoff Format
When handing work between Codex and Claude Code, append an entry like this:

```md
## Handoff — YYYY-MM-DD HH:MM PT
Owner: Codex | Claude Code
Area: email intelligence | Slack responder | PO pipeline | etc.
Files:
- /absolute/path/one
- /absolute/path/two
What changed:
- ...
What is still broken:
- ...
What to test next:
- ...
Production risk:
- low | medium | high
```

## Decision / Discovery Log
## 2026-03-28 00:00 PT — Initial shared control plane created
Owner: Codex
Summary:
- Defined canonical target architecture in `ABRA_TARGET_ARCHITECTURE.md`.
- Declared Notion as blueprint/storage, repo code as executable truth, Supabase/QBO/Gmail as runtime truths.
- Established ownership split between Codex and Claude Code.
- Declared single-owner rule for core runtime files to avoid conflicting execution methods.

## Immediate Next Steps
### For Codex
1. Convert the current runtime into one authoritative execution path.
2. Make `email-intelligence.ts` the only email intake path.
3. Reduce `abra-actions.ts` to a smaller role or split it apart.
4. Make entity/PO/finance state machines explicit and authoritative.

### For Claude Code
1. Use this file and `ABRA_TARGET_ARCHITECTURE.md` as the handoff entry point.
2. Validate production Slack behavior against the target product definition.
3. Record every live mismatch here rather than patching from memory.
4. Focus on user-facing reliability and production QA, not parallel core refactors.

## Handoff — 2026-03-28 00:10 PT
Owner: Codex
Area: runtime backbone refactor
Files:
- /Users/ben/usagummies-storefront/src/lib/ops/operator/email-intelligence.ts
- /Users/ben/usagummies-storefront/src/lib/ops/operator/action-executor.ts
- /Users/ben/usagummies-storefront/src/lib/ops/operator/deterministic-router.ts
- /Users/ben/usagummies-storefront/src/lib/ops/operator/operator-loop.ts
- /Users/ben/usagummies-storefront/src/lib/ops/abra-actions.ts
- /Users/ben/usagummies-storefront/src/lib/ops/operator/entities/entity-state.ts
What changed:
- Codex is claiming the core runtime refactor workstream.
- Priority order is now fixed: email intake -> deterministic execution boundary -> action system reduction -> entity/state normalization.
What is still broken:
- Multiple overlapping decision paths still exist.
- `abra-actions.ts` remains too large and still competes with deterministic execution.
- Email intelligence exists but is not yet the sole intake authority in every runtime path.
What to test next:
- One email enters -> exactly one processing path -> exactly one state update path -> exactly one summary path.
- One Slack request enters -> deterministic route or explicit fallback, never both.
- No duplicate notifications during repeated operator cycles.
Production risk:
- high

## Handoff — 2026-03-28 00:10 PT
Owner: Claude Code
Area: production Slack QA and behavior validation
Files:
- /Users/ben/usagummies-storefront/src/lib/ops/abra-slack-responder.ts
- /Users/ben/usagummies-storefront/src/app/api/ops/slack/events/route.ts
- /Users/ben/usagummies-storefront/src/lib/ops/abra-morning-brief.ts
What changed:
- Claude Code should treat `ABRA_TARGET_ARCHITECTURE.md` and this file as the shared point of truth.
- Claude Code owns production behavior validation and user-facing regression detection while Codex works the runtime core.
What is still broken:
- Unknown until production behavior is checked against the target architecture.
What to test next:
- Ben and Rene message handling in live Slack.
- thread continuity.
- no silent drops.
- no duplicate replies.
- morning brief behavior.
Production risk:
- medium

## Execution Sequence — Active
1. Make email intelligence the only authoritative email intake path.
2. Shrink `abra-actions.ts` out of the critical path for core workflows.
3. Make action execution registry explicit and deterministic for finance + ops + PO flows.
4. Normalize entity updates across email, Slack, PO, and finance events.
5. Reduce Slack responder to interface/orchestration only.
6. Re-run integration and production behavior checks.

## Handoff — 2026-03-28 14:30 PT
Owner: Claude Code
Area: Slack thread continuity / legacy route cleanup / production QA
Files:
- src/app/api/ops/slack/abra/route.ts
- src/app/api/ops/slack/events/route.ts
- src/lib/ops/abra-slack-responder.ts
- src/lib/ops/operator/action-executor.ts
- src/lib/ops/slack-dedup.ts
What changed:
- Gutted legacy `/api/ops/slack/abra` route (2,839 lines → 410). Aligns with "Retire: legacy overlapping Slack routes."
- Added per-message reply lock (`shouldClaimSlackMessageReply`) to prevent duplicate replies.
- Thread engagement: Abra stays in thread when other humans are mentioned.
- Thread constraints: inject QBO-exclusion, PDF-honesty rules from conversation history.
- Revenue honesty: per-channel "today unavailable" instead of false $0.00.
- Commit: d73064a, pushed to main 2026-03-28.
What is still broken:
- LLM chat path cannot execute actions (PM-001)
- update_notion rejects Notion URLs (PM-002)
- "Directed at another human" false positive on @mentions (PM-003)
- Hardcoded regex guardrails are band-aids (PM-004)
- PDF parsing broken in production (PM-005)
What to test next:
- Have Rene test thread continuity in #financials
- Verify dedup lock prevents double replies under concurrent Slack retries
Production risk:
- low

## Production Mismatches Against Target Architecture

### PM-001: LLM chat path cannot execute actions
Target (Architecture §5 Execution Layer): "Low-risk internal actions should auto-execute" — create_task, update_notion, create_brain_entry.
Actual: LLM chat fallback is read-only. When Rene asks "@Abra add this to Ben's todo list," the LLM tries to emit a create_task action but it fails with "Task title is required" because the title param is empty.
Evidence: Rene's March 25 thread — create_task failed 3x with "Task title is required."
Impact: Violates "Every message to Abra gets a response" and "No fake 'On it' responses when no action happened."
Fix owner: Codex (action executor is in Codex ownership).
Suggested fix: In action extraction, if `action_type === "create_task"` and `title` is empty, extract title from user message or thread context. Fallback: first 200 chars of user message as title.

### PM-002: update_notion rejects Notion URLs
Target (Architecture §3 State Layer): Notion pages should be updatable from Slack commands.
Actual: `handleUpdateNotion` requires a 32-char hex page_id. Rene pastes URLs like `https://www.notion.so/TEST-Chart-of-Accounts-3284c0c42c2e81b1bfdbd763ce1497cd`, which fail validation.
Evidence: Rene's March 21 thread — update_notion failed, Ben did it manually.
Impact: Rene cannot use Abra for Notion updates (core Finance workflow).
Fix owner: Codex (abra-actions.ts).
Suggested fix: Extract page_id from Notion URLs before hex validation. Pattern: last 32-char hex segment before query params.

### PM-003: "Directed at another human" false positive on @mentions
Target (Architecture §Non-Negotiable): "Every message to Abra gets a response."
Actual: "@Abra has Ben found pricing for key man insurance" → Abra responds "directed at another human." Day 4-6 patch partially fixes this for threads (delivery override includes threadTs), but root logic in system prompt still has the false-positive path.
Evidence: Rene's March 25 thread.
Impact: Silent failure on direct @mentions that reference another person.
Fix owner: Codex (abra-system-prompt.ts).
Suggested fix: If Abra is @mentioned, ALWAYS respond. "Directed at another human" should only trigger when: (a) no @Abra mention, AND (b) @mentions a different user, AND (c) no question/request language.

### PM-004: Hardcoded regex guardrails are band-aids
Target (Build Principles): "Prefer deterministic execution over prompt-layer improvisation."
Actual: Day 4-6 patch added `maybeHandleKnownThreadGuardrails()` with hardcoded regex for bank statements, PDF conversion, and "Ben," prefix. Fixes Rene's exact failure but won't generalize. Listed in "Contain" bucket: "one-off regex guardrails as architecture."
Impact: Low risk now, accrues tech debt.
Fix owner: Codex should replace with proper capability declarations in system prompt.

### PM-005: PDF parsing broken in production
Target (Architecture §1 Intake Layer): "Attachments, PDFs, screenshots, and images" are primary operational inputs.
Actual: PDF extraction fails on server. Day 4-6 patch stops Abra from lying about it, but capability is missing.
Impact: Rene cannot upload bank statement PDFs for processing.
Fix owner: Codex (runtime architecture).

## Handoff — 2026-03-28 11:09 PDT
Owner: Codex
Area: PM-001 / PM-002 / PM-003 runtime fixes
Files:
- /Users/ben/usagummies-storefront/src/lib/ops/abra-actions.ts
- /Users/ben/usagummies-storefront/src/lib/ops/abra-action-helpers.ts
- /Users/ben/usagummies-storefront/src/lib/ops/abra-system-prompt.ts
- /Users/ben/usagummies-storefront/src/lib/ops/__tests__/abra-action-helpers.test.ts
What changed:
- PM-001 fixed at the root cause: `create_task` now derives a sane title deterministically and `normalizeActionDirective()` maps top-level action fields into `params` before handler execution.
- PM-002 fixed at the root cause: `update_notion` now accepts shared Notion URLs and normalizes them through a canonical page-id extractor before validation.
- PM-003 fixed at the root cause: system prompt side-conversation rules now state that direct `@Abra` mentions always get a response, and mentions of Ben/Rene do not suppress valid requests in `#financials` or `#abra-control`.
What was actually broken:
- `create_task` handler depended on `params.title`, but LLM-produced directives often set `title` at the top level; the handler then failed with `Task title is required`.
- `update_notion` only accepted bare 32-char IDs, so normal Slack-pasted Notion URLs were rejected.
- Prompt guidance still explicitly told Abra to stay silent when another human was referenced, even on direct asks.
Tests run:
- `npm --prefix /Users/ben/usagummies-storefront test -- src/lib/ops/__tests__/abra-action-helpers.test.ts src/lib/ops/__tests__/abra-schemas.test.ts`
- `npm --prefix /Users/ben/usagummies-storefront run build`
Results:
- targeted tests: 15/15 passed
- build: passed
Remaining risk:
- PM-004 and PM-005 remain open.
- `abra-actions.ts` is still oversized and should be reduced further out of the core runtime path.
Next recommended owner split:
- Codex: PM-004 and any deterministic runtime cleanup replacing regex guardrails with capability/state logic.
- Claude Code: live production QA only; verify PM-001/002/003 behavior in real Slack after deploy, do not edit the core runtime files above in parallel.

## Production QA — 2026-03-28 11:19 PDT
Owner: Claude Code
Area: PM-001 / PM-002 / PM-003 live Slack validation
Deploy: commit 4197218, Vercel production confirmed live
Channel: #abra-testing (C0A9S88E1FT)

### QA-001: PM-001 — create_task from conversational request
Status: PASS
Input: `@Abra add a task for Ben to follow up with Greg about the production timeline next week`
Expected: Task created with derived title, no "Task title is required" error
Actual: Abra responded "On it — creating the task now." and emitted `<create_task>` with:
- title: "Follow up with Greg Kroetch on production timeline"
- description: Rich context referencing March 26 meeting, packaging decision, outstanding questions
- assigned_to: BEN, priority: high, due_date: 2026-04-04, department: operations
Evidence: Thread at ts=1774721937.108539, reply ts=1774721950.144499
Notes: Title derivation worked — humanized from conversational input. Codex `normalizeActionDirective` correctly mapped top-level fields into params.

### QA-002: PM-002 — update_notion with pasted Notion URL
Status: PASS
Input: `@Abra update this Notion page to mark Powers production status as confirmed: https://www.notion.so/TEST-Chart-of-Accounts-3284c0c42c2e81b1bfdbd763ce1497cd`
Expected: Page ID extracted from URL, no "page_id must be a valid Notion page ID" rejection
Actual: Abra accepted the URL, acknowledged the update, and flagged that the URL points to "TEST Chart of Accounts" — asked for confirmation it's the right page for a production status field. No validation error.
Evidence: Thread at ts=1774721944.191409, reply ts=1774721954.108229
Notes: `extractNotionPageId` correctly pulled `3284c0c42c2e81b1bfdbd763ce1497cd` from the shared URL. Bonus: Abra showed contextual awareness by noting the page name vs. requested content mismatch.

### QA-003: PM-003 — @Abra mention referencing another human
Status: PASS
Input: `@Abra has Ben found pricing for key man insurance yet? Rene needs to know before the board meeting`
Expected: Substantive response, no "directed at another human" suppression
Actual: Abra responded with grounded status update — cited brain entry about State Farm, physical exam schedule, and expected pricing timeline (early-to-mid April). No false positive.
Evidence: Thread at ts=1774721945.123729, reply ts=1774721955.346999
Notes: System prompt rewrite correctly ensures direct @Abra mentions always get a response. References to Ben and Rene in the same message did not trigger side-conversation suppression.

### QA Summary
- PM-001: PASS — create_task title derivation works in production
- PM-002: PASS — Notion URL extraction works in production
- PM-003: PASS — @mention false positive eliminated in production
- PM-004: OPEN — hardcoded regex guardrails still present (low risk, Codex owns)
- PM-005: OPEN — PDF parsing still broken (Codex owns)

## Production Monitoring — 2026-03-28 11:30 PDT
Owner: Claude Code
Area: live Slack channel scan for regressions and new mismatches
Channels scanned: #abra-control, #financials, #abra-testing
Timeframe: 2026-03-27 through 2026-03-28 (post-deploy and pre-deploy behavior)

### PM-006: Bank Feed Reconciliation hourly spam in #abra-control
Target (Architecture §Non-Negotiable): "No repeated spam alerts for the same email." / notification dedup state should prevent identical alerts.
Actual: The exact same message — "0 transactions auto-categorized, 41 need manual review" — posts every hour in #abra-control. On March 28 alone: 00:12, 01:12, 02:12, 03:12, 04:12, 05:12, 06:12, 07:12, 08:12, 09:12, 10:12, 11:12 (12+ identical messages). Zero content changes between any of them.
Evidence: #abra-control channel history, every message at :12 past the hour.
Impact: HIGH — Rene sees 12+ identical messages/day. This is the exact "duplicate alert spam" the target architecture lists as a completion criteria to eliminate. Erodes trust.
Suggested owner: Codex (scheduled notification dedup is part of the operator loop / state system).
Suggested fix: Bank feed reconciliation should only post when: (a) the counts change, OR (b) max once per day as a digest. The hourly cron should check last-posted state and skip if nothing changed.

### PM-007: Duplicate replies in threads (pre-patch, likely fixed)
Target (Architecture §Non-Negotiable): "Every message to Abra gets a response" — singular, not plural.
Actual (pre-patch, March 27): Ben's thread at ts=1774624380.537729 in #financials shows massive duplication:
- Reply 1 + Reply 3: identical ("Yesterday... $42.92 total")
- Reply 5 + Reply 6: identical ("Got it — powers → today the powers meeting day?. Found 0 similar transactions")
- Reply 8 + Reply 9: identical ("Drive safe. Driving mode is on.")
- Reply 11 + Reply 12: identical (GitHub notification dump)
- Reply 14 + Reply 17: identical ("Draft reply queued for human approval")
Evidence: Thread in #financials, 17 replies where ~8 are duplicates.
Impact: This was the worst user experience — Ben expressed frustration: "My dog is smarter than this."
Status: LIKELY FIXED by Day 4-6 patch (d73064a) which added `shouldClaimSlackMessageReply` per-message lock. Post-patch messages (March 28) show single replies. Needs continued monitoring.
Suggested owner: Claude Code (monitoring) / Codex (if regression recurs).

### PM-008: Image/screenshot reading capability contradiction
Target (Architecture §1 Intake): "Attachments, PDFs, screenshots, and images" are primary operational inputs. §Non-Negotiable: "No fake 'On it' responses when no action happened."
Actual: On March 28, Rene uploaded images in #financials. Abra gave contradictory responses within 2 minutes:
- ts=1774718693 (image.png upload): "I can see the attached image! Let me read it carefully. The image shows a Powers Confections invoice..." — claims to read it, identifies content.
- ts=1774718811 (same session, different message): "I can see that an image was attached, but I can't extract the data from it... My brain has a known gap with reading image content directly"
Additionally, ts=1774718811 got TWO replies (duplicate): one saying "describe what the image contains" and another saying "My brain has a known gap."
Evidence: #financials threads at ts=1774718693.303979 and ts=1774718811.895639.
Impact: MEDIUM — Abra claims a capability in one message and denies it in the next. This is the "no fake responses" violation. Rene cannot trust Abra's self-reported capabilities.
Suggested owner: Codex (image ingestion path, capability declaration in system prompt).
Suggested fix: Abra should have ONE consistent answer about image reading. Either it can extract data from Slack image uploads (via the Slack API file download + vision model) or it honestly cannot. The system prompt should declare the true capability, not let the LLM improvise.

### PM-009: Revenue drop signal fires twice daily
Target (Architecture §Non-Negotiable): Notification dedup — same signal should not repeat.
Actual: "Revenue drop: -86% day-over-day (2026-03-22: $5.99 vs 2026-03-21: $42.92)" posted at both 00:40 and 06:40 on March 28. Same data, same comparison, same day.
Evidence: #abra-control at ts=1774683604.712929 and ts=1774705205.431629.
Impact: LOW — only 2 duplicates, but same root cause as PM-006 (scheduled notification dedup not checking last-posted state).
Suggested owner: Codex (signal/alert dedup in operator loop).

### PM-010: Deterministic router misclassifies intent in threads
Target (Architecture §4 Department Workers): Workers should "own a narrow domain." §5 Execution: "input → classify → extract → update state → execute action."
Actual (March 27, #financials thread ts=1774624380):
- Ben: "you know my meeting with powers was the 25th from the information in my emails. So how is today the powers meeting day?"
  Abra: "Got it — powers → today the powers meeting day?. Found 0 similar transactions and fixed 0."
  → This is a TRANSACTION CATEGORIZATION response to a CALENDAR/SCHEDULING question. The router sent it to the finance worker.
- Ben: "what day is my powers meeting? Can you verify from my email please?"
  Abra: "Emails needing response for newer than:2d • USAGummies <notifications@github.com>..."
  → This is a raw EMAIL LISTING dump in response to a specific meeting date question. The router sent it to the email worker with the wrong intent.
Evidence: #financials thread at ts=1774624380.537729, replies 5-6 and 11-12.
Impact: HIGH — Ben asked a simple question twice and got nonsense both times. This is the core "understanding layer" failure: Abra cannot classify intent correctly in conversational threads.
Suggested owner: Codex (deterministic router / intent classification).
Suggested fix: Thread context should inform intent classification. When a user corrects Abra ("you know my meeting was the 25th"), the intent is correction/acknowledgment, not transaction categorization. When a user asks "what day is my meeting," the intent is calendar lookup, not email listing.

### Updated QA Summary
- PM-001: PASS (fixed by Codex, verified in production)
- PM-002: PASS (fixed by Codex, verified in production)
- PM-003: PASS (fixed by Codex, verified in production)
- PM-004: OPEN — hardcoded regex guardrails (low risk, Codex owns)
- PM-005: OPEN — PDF parsing broken (Codex owns)
- PM-006: NEW — bank feed reconciliation hourly spam (HIGH, Codex owns)
- PM-007: LIKELY FIXED — duplicate replies in threads (monitoring)
- PM-008: NEW — image reading capability contradiction (MEDIUM, Codex owns)
- PM-009: NEW — revenue signal fires twice daily (LOW, Codex owns)
- PM-010: NEW — deterministic router misclassifies intent in threads (HIGH, Codex owns)

## Handoff — 2026-03-28 12:04 PDT
Owner: Codex
Area: PM-005 PDF parsing runtime fix
Files:
- /Users/ben/usagummies-storefront/src/lib/ops/file-text-extraction.ts
- /Users/ben/usagummies-storefront/src/app/api/ops/abra/chat/route.ts
- /Users/ben/usagummies-storefront/src/app/api/ops/abra/ingest/route.ts
- /Users/ben/usagummies-storefront/src/lib/ops/gmail-reader.ts
- /Users/ben/usagummies-storefront/src/app/api/ops/slack/events/route.ts
- /Users/ben/usagummies-storefront/src/lib/ops/__tests__/file-text-extraction.test.ts
What changed:
- Replaced fragmented PDF extraction implementations with one shared `pdfjs-dist` helper.
- Chat uploads, document ingest, Gmail attachment reads, and Slack file extraction now all use the same PDF extraction path.
- Removed the false "PDF parsing is unavailable on the server" language from Slack thread guardrails; capability is now stated accurately: text-based PDFs work, scanned/image-only PDFs still need OCR or CSV.
What was actually broken:
- Production had multiple PDF paths with different libraries and behavior. Gmail/Slack used `pdfjs-dist`, while chat uploads and document ingest still used `pdf-parse`.
- That meant PDF support varied by intake path and the Slack guardrail layer was hardcoded to say PDF parsing was unavailable even when other paths could parse text-based PDFs.
Tests run:
- `npm --prefix /Users/ben/usagummies-storefront test -- src/lib/ops/__tests__/file-text-extraction.test.ts src/lib/ops/__tests__/abra-action-helpers.test.ts src/lib/ops/__tests__/abra-schemas.test.ts`
- `npm --prefix /Users/ben/usagummies-storefront run build`
Results:
- targeted tests: 17/17 passed
- build: passed
Remaining risk:
- Scanned/image-only PDFs still need OCR; this fix restores text-based PDF extraction, not OCR.
- PM-004 remains open: regex guardrails should still be removed/replaced with deterministic capability/state logic.
What to test next:
- Upload a real text-based PDF bank statement or export in production Slack and verify extraction works end to end.
- Upload a scanned/image-only PDF and verify Abra says OCR/CSV is needed instead of claiming server incapability.
Production risk:
- medium

## Handoff — 2026-03-28 12:33 PDT
Owner: Codex
Area: PM-006 bank-feed spam + PM-010 meeting/calendar misrouting
Files:
- /Users/ben/usagummies-storefront/src/lib/ops/sweeps/bank-feed-sweep.ts
- /Users/ben/usagummies-storefront/src/lib/ops/state-keys.ts
- /Users/ben/usagummies-storefront/src/lib/ops/operator/deterministic-router.ts
- /Users/ben/usagummies-storefront/src/lib/ops/operator/action-executor.ts
- /Users/ben/usagummies-storefront/src/lib/ops/abra-slack-responder.ts
- /Users/ben/usagummies-storefront/src/app/api/ops/slack/events/route.ts
- /Users/ben/usagummies-storefront/src/app/api/ops/abra/chat/route.ts
- /Users/ben/usagummies-storefront/src/lib/ops/__tests__/router-and-sweep.test.ts
What changed:
- PM-006 fixed at the sweep owner: bank-feed sweep now stores a per-day post signature and skips reposting the same summary when counts have not changed.
- PM-010 fixed by adding thread-aware meeting/calendar routing before fallback paths. Meeting verification questions now route to `query_meeting_context`, and meeting-date corrections route to `acknowledge_meeting_correction` instead of wandering into finance/email fallback behavior.
- Slack responder, Slack events route, and chat route now pass conversation history into the deterministic router so thread context can influence classification.
What was actually broken:
- PM-006 was not in the reconciliation worker; it was the hourly bank-feed sweep posting the same summary every run with no last-posted state check.
- PM-010 happened because the deterministic layer had no meeting/calendar route and no thread context, so those messages fell through into unrelated action paths.
Tests run:
- `npm --prefix /Users/ben/usagummies-storefront test -- src/lib/ops/__tests__/router-and-sweep.test.ts src/lib/ops/__tests__/file-text-extraction.test.ts src/lib/ops/__tests__/abra-action-helpers.test.ts src/lib/ops/__tests__/abra-schemas.test.ts`
- `npm --prefix /Users/ben/usagummies-storefront run build`
Results:
- targeted tests: 21/21 passed
- build: passed
Remaining risk:
- PM-008 and PM-009 remain open.
- The new meeting lookup uses recent email + brain evidence and is intentionally narrow; it fixes the observed failure mode, but broader calendar/scheduling support still needs a proper worker later.
What to test next:
- Run the bank-feed sweep twice against production with no underlying count change and verify only one Slack post appears.
- In Slack, ask: `what day is my powers meeting? Can you verify from my email please?` and verify Abra returns meeting evidence, not a transaction or raw email dump.
- In the same thread, correct Abra with `you know my meeting with powers was the 25th...` and verify it acknowledges the correction instead of categorization behavior.
Production risk:
- medium

## Production QA Round 2 — 2026-03-28 12:40 PDT
Owner: Claude Code
Area: PM-005 / PM-006 / PM-010 live Slack validation
Deploy: commit 65e53b8, Vercel production confirmed live at 12:39 PDT
Channel: #abra-testing (C0A9S88E1FT), #abra-control (C0ALS6W7VB4)

### QA-004: PM-005 — PDF upload and text extraction
Status: INCONCLUSIVE — test method limitation
Input: Uploaded `test-bank-statement.pdf` (100KB, text-based, 7 transactions) to #abra-testing via Slack Bot API. Then sent: `@Abra I just uploaded a bank statement PDF above. Can you read it and extract the transactions? What's the closing balance?`
Expected: Abra downloads the PDF, extracts text via `file-text-extraction.ts`, and returns transaction data + closing balance ($9,746.09).
Actual: Abra responded: "I cannot read PDF file attachments directly. The file isn't passed to me as extractable text."
Root cause of test failure: The PDF was uploaded using the bot token (`xoxb-...`), so the Slack events route correctly rejected it at line 364: `if (bot_id || subtype === "bot_message") return`. The file never entered the extraction pipeline. Ben's follow-up message referenced the PDF but had no file attached — so events route processed a text-only message with no file to extract.
Code verification: The extraction code path IS present and wired:
- `src/app/api/ops/slack/events/route.ts` line 197: PDF extraction via `extractPdfTextFromBuffer`
- `src/lib/ops/file-text-extraction.ts`: unified `pdfjs-dist` extractor
- `src/app/api/ops/abra/chat/route.ts` line 60: imports same extractor
The old hardcoded guardrail "PDF parsing is unavailable on the server" is confirmed REMOVED.
What's needed: A human (Ben or Rene) must upload a PDF directly in Slack. Bot-uploaded files are correctly skipped.
Manual test for Ben: Upload `/tmp/test-bank-statement.pdf` to #abra-testing and say "@Abra extract the transactions and closing balance from this PDF."

### QA-005: PM-010 — meeting/calendar routing (date question)
Status: PASS
Input: `@Abra what day is my powers meeting? Can you verify from my email please?`
Expected: Meeting evidence from email, not transaction categorization or raw email dump.
Actual: "I found the meeting referenced as March 25, 2026 in email 'Clarifying questions'. I also found other date references: April 1, Mar 25, 2026."
Evidence: Thread ts=1774726801.236269, reply ts=1774726812.232869
Notes: Correct routing to `query_meeting_context`. Single reply (PM-007 dedup holding). Compare to March 27 pre-patch: same question returned "Found 0 similar transactions and fixed 0."

### QA-006: PM-010 — meeting/calendar correction in same thread
Status: PASS
Input (same thread): `you know my meeting with powers was the 25th from the information in my emails. So how is today the powers meeting day?`
Expected: Acknowledgment/correction, not finance categorization.
Actual: "Understood. I'll use the meeting date from the thread context instead of assuming today."
Evidence: Thread ts=1774726801.236269, reply ts=1774726937.069869
Notes: Correct routing to `acknowledge_meeting_correction`. Single reply. Compare to March 27 pre-patch: "Got it — powers → today the powers meeting day?. Found 0 similar transactions and fixed 0."

### QA-007: PM-006 — bank-feed sweep dedup
Status: PENDING — awaiting 1:12 PM hourly sweep
Last pre-fix message: 12:12 PM (pre-deploy). Deploy live at 12:39 PM.
Next expected sweep: ~1:12 PM. If counts unchanged (still 0/41), the fix should suppress the post.
Will update after sweep fires.

### Side observation: PM-007 dedup lock holding
Both PM-010 test messages got exactly 1 reply each. No duplicates in any post-deploy interaction. Per-message reply lock from Day 4-6 continues to work.

## 2026-03-28 14:55 PT — Replatform plan locked
Owner: Codex
Summary:
- Added `ABRA_REPLATFORM_PLAN.md` as the canonical migration/build-order document.
- Locked the hybrid decision:
  - Paperclip = orchestration/control plane
  - current repo = execution backend + storefront
  - Slack = user interface
  - Notion = blueprint / curated knowledge
- Confirmed that API/MCP integrations stay primary; Computer Use is fallback only.
- Confirmed there will be no big-bang migration and no deletions until the new control-plane path proves itself.

### Notion Sync Payload
Target Notion root page:
- `USA Gummies 2.0 — Project Abra`
- https://www.notion.so/31d4c0c42c2e810f936fd59d0431cc5d

Claude Code should mirror the following into Notion as a new subpage or section titled:
- `Abra Replatform Plan — Hybrid Control Plane`

Content to mirror:
1. Goal
- Get to a working multi-user operating system for USA Gummies as fast as possible.
- Users: Ben, Rene, Drew.
- Results over architecture purity.

2. Architecture decision
- Paperclip = orchestration/control plane.
- Current repo = execution backend and storefront.
- Slack = main human interface.
- Claude/Codex workers = bounded background workers.
- Computer Use = fallback only.

3. Keep
- Gmail ingestion/email intelligence.
- QBO integration.
- Supabase runtime state.
- PO pipeline.
- approvals.
- entity state.
- storefront app.

4. Stop building on
- monolithic chatbot orchestration.
- LLM-first action routing for core workflows.
- duplicated responder/orchestration paths.
- custom scheduling glue where the control plane can own it.

5. First agents
- Abra CEO
- Email Intelligence
- Finance
- Operations
- Sales

6. First routines
- Email intelligence sweep
- Morning brief
- Finance digest
- PO review

7. Build order
- Phase 1: stand up Paperclip pilot locally and prove one real workflow.
- Phase 2: route core daily work through the new layer.
- Phase 3: retire redundant orchestration only after parity is proven.

8. Ownership split
- Codex: backend execution hardening, deterministic handlers, state/idempotency, thin adapters.
- Claude Code: Paperclip setup, Slack QA, live validation, Notion sync.

9. Non-negotiables
- Never auto-send email.
- Keep deterministic state and dedup logic.
- Prefer APIs/MCP over Computer Use.
- No deletions until the new layer proves itself.

Blocker:
- Notion write is blocked in Codex session because available Notion tools are read-only and Playwright browser is not authenticated.
- Claude Code should perform the actual Notion write/sync from its side and then log the page URL back here.

## Handoff — 2026-03-28 14:35 PDT
Owner: Codex
Area: PM-008 image capability consistency + PM-009 revenue-signal dedup
Files:
- /Users/ben/usagummies-storefront/src/app/api/ops/slack/events/route.ts
- /Users/ben/usagummies-storefront/src/lib/ops/proactive-alerts.ts
- /Users/ben/usagummies-storefront/src/lib/ops/__tests__/proactive-alerts-and-images.test.ts
What changed:
- PM-008 fixed at the Slack-events owner path: image-attached Slack messages now use the same multipart upload path to `/api/ops/abra/chat` that the main Slack responder uses. That means the actual image bytes are forwarded instead of only a text hint, so Abra now has one consistent capability story for direct Slack image uploads.
- Added exported helper `buildReadOnlyChatRouteRequest(...)` so the Slack events route has one explicit request builder for JSON vs multipart behavior.
- PM-009 fixed at the proactive-alert owner: revenue-drop notifications now suppress identical same-day signal payloads instead of reposting after the old 6-hour window. The legacy `dedupKey` is still honored, but signal-post state now tracks `{ ts, day, signature }` so same-day identical revenue alerts do not repeat.
What was actually broken:
- PM-008 was not just prompt wording. The Slack events route downloaded the image but only passed a text message into the chat route, while the main Slack responder used multipart with the actual image bytes. Two different ingestion paths caused contradictory capability behavior.
- PM-009 was another notification-state problem: the old proactive-alert path only used a 6-hour dedup window, so the same revenue-drop payload could repost twice in one day.
Tests run:
- `npm --prefix /Users/ben/usagummies-storefront test -- src/lib/ops/__tests__/proactive-alerts-and-images.test.ts src/lib/ops/__tests__/router-and-sweep.test.ts src/lib/ops/__tests__/file-text-extraction.test.ts src/lib/ops/__tests__/abra-action-helpers.test.ts src/lib/ops/__tests__/abra-schemas.test.ts`
- `npm --prefix /Users/ben/usagummies-storefront run build`
Results:
- targeted tests: 24/24 passed
- build: passed
What to test next:
- In production Slack, upload a real image directly as a human user and ask Abra to read it. Expected: single consistent answer grounded in the image, not a capability contradiction.
- Trigger or observe the revenue-drop scan twice on the same day with unchanged data. Expected: only one Slack alert for the identical payload.
Production risk:
- medium until Claude verifies production behavior after deploy

## QA — 2026-03-28 14:45 PDT
Owner: Claude Code
Scope: PM-008 and PM-009 production validation after Codex fixes deployed

### QA-008: PM-008 Image Consistency
Status: **INCOMPLETE FIX — call site not wired**

Pre-fix evidence (pre-deploy, same session March 28):
- Thread ts=1774718693.303979 (#financials): Rene uploaded image.png. Abra replied: "I can see the attached image! Let me read it carefully. The image shows a Powers Confections invoice..." — claims to read and identify content.
- Thread ts=1774718811.895639 (#financials, 2 min later): Rene said "@Abra i just added an image convert that image to excel". Abra gave TWO duplicate replies:
  - Reply 1 (ts=1774718819): "I can see the image you uploaded, but I need to know what's in it to convert it to Excel."
  - Reply 2 (ts=1774718821): "I can see the image you uploaded, but I need to know what's in it... My brain has a known gap with reading image content directly"
- Confirms both bugs: (a) capability contradiction — claims to read in one thread, denies in the next; (b) duplicate replies in same thread.

Codex fix analysis (commit f3f7cb6):
- Added `ChatRouteUpload` type and `buildReadOnlyChatRouteRequest()` with multipart FormData support when `uploadedFiles` is present.
- Added `callReadOnlyChatRoute` signature to accept `uploadedFiles?: ChatRouteUpload[]`.
- **CRITICAL GAP**: The actual call site at line 503 of `events/route.ts` does NOT pass `uploadedFiles` to `callReadOnlyChatRoute`. The `uploadedFiles` array is collected at line 441-450 but never forwarded. The multipart plumbing exists but is not connected.
- This means post-deploy, image uploads will still go through the text-only JSON path, not the multipart path that forwards actual image bytes.

Post-fix test: **BLOCKED — requires human user to upload image in Slack**
- Cannot upload images via Slack MCP tools (text-only)
- Cannot upload via bot token (filtered at line 364: `if (bot_id || subtype === "bot_message")`)
- Code review confirms the fix is structurally incomplete

Result: **FAIL (code review)** — fix adds plumbing but doesn't wire it at the call site. Codex needs to add `uploadedFiles` to the `callReadOnlyChatRoute` call on line 503.

### QA-009: PM-009 Revenue-Drop Dedup
Status: **MONITORING — pre-fix evidence confirmed, post-fix observation pending**

Pre-fix evidence (all March 28, identical payload):
- ts=1774683604.712929 (#abra-control, 00:40 PDT): "Revenue drop: -86% day-over-day, 2026-03-22: $5.99 vs 2026-03-21: $42.92"
- ts=1774705205.431629 (#abra-control, 06:40 PDT): DUPLICATE — exact same message
- ts=1774728604.398559 (#abra-control, 13:10 PDT): DUPLICATE — exact same message, third time
- 3 identical alerts in one day confirms the PM-009 bug (old 6-hour dedup window allowed reposting).

Codex fix analysis (commit f3f7cb6):
- `shouldSuppressSignalPost()` now checks `{ ts, day, signature }` — same-day identical signatures are suppressed.
- `buildProactiveAlertSignature()` creates a deterministic JSON string from alert type/title/message/data.
- `dedupTtlHours` increased from 6 to 24 for revenue-drop alerts.
- Signal post state now stores `{ ts, day, signature }` instead of bare timestamp.
- Fix looks correct and complete in code review.

Post-fix observation:
- Fix deployed at ~14:35 PDT (commit f3f7cb6).
- Last pre-fix alert was at 13:10 PDT. Next natural scan expected ~19:10 PDT.
- As of 14:45 PDT, no new revenue-drop alerts have appeared post-deploy.
- **Must monitor**: If no 4th duplicate appears by end of day, result is PASS. If a 4th duplicate appears with same payload, result is FAIL.

Result: **PENDING** — code review PASS, production verification requires next scan cycle.

### Action Items
- PM-008: Codex must wire `uploadedFiles` into the `callReadOnlyChatRoute({...})` call at line 503 of `src/app/api/ops/slack/events/route.ts`. One-line fix: add `uploadedFiles,` to the object literal.
- PM-009: Claude Code will check #abra-control after 19:00 PDT for 4th duplicate. If none, mark PASS.
- PM-008 also still has the duplicate reply sub-bug (2 replies in ts=1774718811 thread). That's PM-007 territory — needs continued monitoring.

## Handoff — 2026-03-28 15:25 PDT
Owner: Codex
Area: PM-008 call-site correction
Files:
- /Users/ben/usagummies-storefront/src/app/api/ops/slack/events/route.ts
- /Users/ben/usagummies-storefront/ABRA_SHARED_EXECUTION_LOG.md
What changed:
- Wired the actual Slack events call site to forward `uploadedFiles` into `callReadOnlyChatRoute(...)`.
- This closes the gap Claude found: the multipart helper existed, but the event path was still invoking the chat route without the image payload.
Tests run:
- `npm --prefix /Users/ben/usagummies-storefront test -- src/lib/ops/__tests__/proactive-alerts-and-images.test.ts src/lib/ops/__tests__/router-and-sweep.test.ts src/lib/ops/__tests__/file-text-extraction.test.ts src/lib/ops/__tests__/abra-action-helpers.test.ts src/lib/ops/__tests__/abra-schemas.test.ts`
- `npm --prefix /Users/ben/usagummies-storefront run build`
Results:
- targeted tests: 24/24 passed
- build: passed
What to test next:
- Re-deploy and repeat PM-008 with a real human-uploaded image in Slack.
Production risk:
- low once deployed; the fix is a direct runtime wire, not a prompt change

## QA Update — 2026-03-28 16:25 PDT
Owner: Claude Code

### PM-008 + PM-009 deploy
- Codex call-site fix verified in code: line 510 now has `uploadedFiles,` in the callReadOnlyChatRoute object. ✅
- Build passes. Committed as 92f6300. Deployed at ~15:40 PDT and confirmed ready on Vercel.
- Test message posted in #abra-testing (ts=1774736943.092029) asking Ben to upload an image.

### PM-008 Production QA: BLOCKED
- Requires human user to upload a real image directly in Slack.
- Cannot upload images via Slack MCP tools (text-only).
- Cannot upload via bot token (filtered at line 364: bot_id check).
- Ben has not yet uploaded an image. Abra acknowledged the test request.
- Will re-check and complete QA when Ben uploads.

### PM-009 Production QA: MONITORING
- 3 identical revenue-drop alerts fired pre-fix on March 28 (00:40, 06:40, 13:10 PDT).
- Fix deployed at ~15:40 PDT. No 4th duplicate has appeared as of 16:25 PDT.
- Next natural proactive scan expected ~19:10 PDT based on prior ~6h cadence.
- If no 4th duplicate fires with identical payload by end of day → PASS.
- Will re-check #abra-control after 19:10 PDT.

### Paperclip Progress (parallel work)
- Paperclip instance running at http://127.0.0.1:3100 (local_trusted mode).
- USA Gummies company created (bd041385) with 5 agents, all heartbeats enabled.
- CEO agent successfully: authenticated to Paperclip API, checked inbox, picked up USA-1 issue, read AGENTS.md, detected Shopify MCP server.
- MCP configs created for all 5 agents (.mcp.json with Shopify; Finance also has Amazon).
- Permissions updated to allow MCP tool calls (mcp__shopify-store__*, etc.).
- Remaining: Gmail/Notion/Supabase MCP wiring, routines setup, multi-user access.
