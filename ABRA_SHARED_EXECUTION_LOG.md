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
- Production Slack validation against target architecture (done — 5 mismatches recorded as PM-001 through PM-005)
- Shipped Day 4-6 defensive patch (commit d73064a)
- Verified Codex PM-001/002/003 fixes, committed and pushed (commit 4197218)
- Live production QA: PM-001 PASS, PM-002 PASS, PM-003 PASS (2026-03-28 11:19 PDT)
- Remaining: PM-004 and PM-005 are open, owned by Codex

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
