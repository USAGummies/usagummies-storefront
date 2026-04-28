# Session Handoff — USA Gummies 3.0 storefront

**Status:** AUTO-MAINTAINED — kept fresh by every commit cycle
**Last updated:** 2026-04-27 (Phase 28L.2)
**Purpose:** 1-page brief for any new Claude Code / Codex / human session — what's in flight, what's parked, what's broken, what's next. Save 10-20 minutes of re-orientation per session.

---

## Where the build is right now

**Test suite:** 2,109 green (134 files). **Workflow blueprint:** v1.62. **Latest baseline:** `1819059 feat(wholesale): Phase 35.e.2 — applyStepPayload route-layer bridge`. **Viktor briefing:** v1.1 (extended with §10.b-d for wholesale pricing + operating memory + open priorities). **LOCKED doctrine 2026-04-27 PM (post-Ben+Rene call):** `/contracts/wholesale-pricing.md` v1.0 (B1-B5 + atomic-bag), `/contracts/operating-memory.md` v1.0 (Slack-first reporting), `/contracts/wholesale-onboarding-flow.md` **v1.0 CANONICAL** (5 interviewer Qs answered with named defaults — Rene punch-lists tomorrow if anything wrong). **Phase 35.a→e.2 shipped autonomously**: pricing-tiers + onboarding state machine + KV persistence + applyStepPayload route-layer bridge (4 commits, +151 tests).

**Active build directive (Ben 2026-04-27):** "build the entire system tested." Working through Phase 28L → 29 → 30 → 31 autonomously. See workflow-blueprint.md §"Top P0 build items" for the full queue.

**Recommended first 5 minutes of any new session:**
1. `git log --oneline -10` — see what just shipped.
2. Read `contracts/workflow-blueprint.md` last 5-10 entries (most recent at top after v1.46).
3. Read this doc + `CLAUDE.md` Operating Contracts section.
4. Skim `contracts/agents/interviewer.md` — the pre-build spec discipline that prevents `qty=1`-hardcode-style bugs.
5. Run `npx vitest run --reporter dot` — confirm baseline test count matches the blueprint.

---

## What's in flight (this session or recent)

| Lane | State | Commit |
|---|---|---|
| Phase 28L.1 — Interviewer-agent contract + CLAUDE.md anchor | DONE | this session |
| Phase 28L.2 — Session handoff doc | DONE (this file) | this session |
| Phase 28L.3 — Stack-readiness dashboard | DONE | this session |
| Phase 28L.4 — Agent health surface | DONE | this session |
| Phase 29 — Drew doctrine sweep | DONE | this session |
| Phase 30.1 — AP packet dashboard UI | ALREADY-SHIPPED (acknowledged) | prior |
| Phase 30.2 — Reorder triggers | DONE | this session |
| Phase 30.3 — Inbox triage closed-loop | DONE | this session |
| Phase 30.4 — Reply composer + Pipeline enrich tests | DONE | this session |
| Phase 31.1 — USPTO trademark tracking | DONE | this session |
| Phase 31.2 — Vendor portal token (security primitive) | DONE | this session |
| Phase 31.2.a — Vendor registry + issue route | DONE | this session |
| Phase 31.2.b — Public `/vendor/[token]` page | DONE | this session |
| Phase 31.2.c — COI upload route + Drive write | DONE | this session |
| Phase 31.1 — USPTO/FDA tracking | QUEUED | — |
| Phase 31.2 — External vendor portal | QUEUED | — |
| Phase 35.a — Wholesale pricing-tiers module (B1-B5 + 51 tests) | DONE | `f941783` |
| Phase 35.b — Onboarding state machine (11-step + 58 tests) | DONE | `f941783` |
| Phase 35.c — Verification (typecheck + 2068 green) | DONE | `f941783` |
| Phase 35.d — Graduate `/contracts/wholesale-onboarding-flow.md` v0.1 → v1.0 with 5 defaults | DONE | `23915e5` |
| Phase 35.e — KV persistence layer (`onboarding-store.ts` + 21 tests) | DONE | `754c721` |
| Phase 35.e.2 — `applyStepPayload` route-layer bridge (+20 tests) | DONE | `1819059` |
| Phase 35.f — Routes (`POST /api/wholesale/onboarding/advance`) + side-effect dispatcher + UI | NEXT | — |

---

## What's parked (waiting on humans)

| Item | Blocker | Owner |
|---|---|---|
| `qbo.bill.create.from-receipt` (Class C dual-approver, receipt → QBO bill) | Rene's chart-of-accounts mapping | Rene → Ben (DM not yet posted, awaiting Ben's wording approval) |
| Content Factory Phase 2-6 (Phase 1+1B shipped today) | 7 spec decisions (named approver / Google Ads account / default approver / cadence cap / auto-publish split / style mix / storage backend) | Ben |
| Slack `:white_check_mark:` reaction → mark-dispatched | Slack app event subscriptions (`reaction_added` + `reaction_removed`) + `reactions:read` scope + reinstall | Ben (one-time, ~2 min at api.slack.com/apps) |
| Rene fake-vendor walkthrough sign-off | Rene's time | Rene (invite posted in `#financials` thread `1777266794.573699`) |

---

## What's broken / known gaps

| What | Status | Workaround |
|---|---|---|
| Make.com bridge | Broken since ~Apr 13 per memory; Ben to fix eventually | `/api/leads` now bypasses Make.com via direct HubSpot `createDeal()` (Phase 1.b) |
| Vercel CLI auth on this worktree | No credentials in `.vercel/` | Pull env vars manually via Chrome MCP from Vercel UI when needed |
| `files:read` Slack scope | Not on bot token | Use `conversations.history` to resolve message ts (Phase 28i workaround) |
| Drew ownership references in 10+ docs | Doctrinal: Ben said "drew owns nothing" 2026-04-27 | Phase 29 sweep queued |

---

## Doctrinal hard rules (do NOT relax)

**Print artifact rule (Ben 2026-04-27, "this needs to be fixed fucking now"):**
Every shipping label print MUST be a 2-page PDF — page 1 the label, page 2 the packing slip with correct quantities + product name. **One click = both pages.** Implementation: `mergeLabelAndSlipPdf` in `src/lib/ops/packing-slip-pdf.ts`, called by the auto-ship route BEFORE the Slack upload. No thread reply on the happy path. No race condition possible. Falling back to label-only is permitted ONLY when merge fails (loud audit `artifact.label.merge-failed`); the slip then posts via the legacy thread-reply path with the Phase 28i+ retry chain.

**Viktor briefing rule (Ben 2026-04-27, "viktor is up to date on the status of the build etc"):**
Viktor reads [`/contracts/viktor-rene-briefing.md`](./viktor-rene-briefing.md) on every session boot (per `viktor.md` §10 step 2). That doc is auto-maintained by every commit cycle alongside this session-handoff. When Rene asks Viktor a free-form question (W-8), Viktor answers from the briefing + cites file paths. Never fabricates. Change requests log to Open Brain `rene-request:<id>` for Ben's next session.

**Rene-engagement priority rule (Ben 2026-04-27, "build everything and anything you can with rene whenever you have the opportunity, he is the best resource for financial workflows etc"):**

When Rene (`U0ALL27JM38`) is **active in `#financials`**, that is the highest-leverage build window in the company's day. Treat it as a session-wide priority interrupt. Specifically:

1. **Drop other queued work for finance-touching builds.** AP packets, receipt review, QBO writes, vendor onboarding, wholesale pricing surface, bookkeeping reconciliation, financial reporting cadence, chart-of-accounts mapping — anything Rene can ratify in real time. Resume parked work after he taps out.

2. **Walk him through it live.** Don't queue questions for tomorrow if he's online. Use the Path B / Path A walkthrough pattern from 2026-04-27: fire the proposal, post a clear checklist in the thread, watch for his sign-off or punch list, ship the fix immediately, push to prod, ask him to re-test. Tight ~2-min iteration loops. The 7-commit Path B run on 2026-04-27 was the canonical example.

3. **Capture every clarification to canonical contracts.** Rene's call-time / Slack-time guidance is the source of truth for finance doctrine. Land it in `/contracts/wholesale-pricing.md`, `/contracts/operating-memory.md`, `/contracts/approval-taxonomy.md`, etc. — same commit cycle. Don't lose his sign-off in chat history.

4. **Apply the interviewer-pre-build pass when scope is fuzzy.** Per `/contracts/agents/interviewer.md`, ask 3-5 questions with named defaults. Skip-with-defaults is a first-class option (Rene used it on the auto-ack email Option A choice tonight).

5. **Rene's expertise areas** (treat any of these as priority surfaces when he's online): QBO chart-of-accounts mapping, AP / AR flows, bookkeeping reconciliation cadence, vendor onboarding + W-9 / COI / 1099 compliance, receipt → bill auto-flow (the parked `qbo.bill.create.from-receipt` slug needs his CoA), wholesale pricing surface in QBO line text + invoices, monthly close + month-end summaries, B2-B5 designator presentation, customer master record fields needed for AP run, payment-terms variants, financial reporting cadence (Friday sales, post-bookkeeping update, month-end recon). When Rene engages on any of these, that's the build window.

6. **Audit trail Rene-touching commits with `rene-touch` tag in the commit body.** Makes it easy to grep `rene-touch` for "what did we ship together with Rene's sign-off" come month-end review. Tonight's 7 wholesale-flow commits are the seed — going forward, mention `rene-touch` in the trailer.

7. **When Rene goes offline, leave a tight handoff.** Closing message format: signed-off lanes, queued for next session (Path A approval, etc.), parked items (CoA mapping, etc.), commit list. The 2026-04-27 21:24 PT closing message in `#financials` thread is the canonical example.

These are immutable. If the user asks to relax one, push back and reference this doc.

1. **Every dollar figure needs a source citation.** Cite `[source: QBO]`, `[source: ShipStation live]`, etc. "Approximately" is not a license to fabricate.
2. **Every state transition writes an audit envelope.** No silent writes.
3. **Class A/B/C/D approval taxonomy is the authority.** Class C and D writes never go autonomous. Slack-approval click is the authorization.
4. **The `interviewer` agent runs first on under-specified non-trivial requests.** Ask 3-5 questions with defaults; never block longer than that.
5. **Drew owns nothing** (2026-04-27 correction). Phase 29 sweep DONE — taxonomy / compliance-doctrine / divisions / ops + inventory-specialist agent contracts all reassigned to Ben (or Ben+Rene Class C). New doctrine-lock test in `src/lib/ops/__tests__/drew-doctrine.test.ts` enforces the invariant.
6. **Orders → Ben (Ashford WA), samples → Drew, `#shipping` is the single source of truth** for label PDFs (v1.0 SHIPPING PROTOCOL pinned 2026-04-10).
7. **No QBO writes without registered taxonomy slug + Class B/C approval.**

---

## Conventions (cross-session)

- **`/api/ops/*` routes** require `isAuthorized()` (session OR `Authorization: Bearer $CRON_SECRET`). New routes need their prefix on `SELF_AUTHENTICATED_PREFIXES` in `src/middleware.ts` to bypass NextAuth's middleware-level redirect.
- **Pure helpers** live in `src/lib/ops/<feature>.ts`. Tests in `src/lib/ops/__tests__/<feature>.test.ts`. Routes in `src/app/api/ops/<feature>/route.ts`. Pages in `src/app/ops/<feature>/`. Phase numbering in `contracts/workflow-blueprint.md` version history.
- **KV keys** prefixed by domain: `shipping:`, `amazon:customer:`, `receipt-review-packet:`, etc. TTLs vary by retention need.
- **Slack channel registry** at `src/lib/ops/control-plane/channels.ts` + `contracts/channels.json`. Use `slackChannelId` (Cxxx) for `files.completeUploadExternal`; `name` (`#shipping`) for `chat.postMessage`-style.
- **Commit style:** `feat(<scope>): <one-liner>` followed by paragraphs explaining WHY, what it locks, +N tests, full suite count. End with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## What "done" means for the current build directive

Per Ben 2026-04-27, "build the entire system tested." Concretely:
- All 6 RED items on the Monday-readiness grid → green or honestly retired.
- All 7 yellow items either green or have explicit ownership of why they remain yellow.
- 4 Nate-inspired adds shipped (interviewer, session handoff, stack-readiness, agent health).
- Drew doctrine sweep complete.
- 100% of new code shipped with locking tests.

When this is done:
- Workflow-blueprint v1.46 → ~v1.55-1.60 expected.
- Test suite ~1,800-1,900 green.
- Approximately 22-28 hours of cumulative build work.
- Some lanes (USPTO/FDA, external vendor portal) may take multiple sessions.
