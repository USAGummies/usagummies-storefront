# Session Handoff — USA Gummies 3.0 storefront

**Status:** AUTO-MAINTAINED — kept fresh by every commit cycle
**Last updated:** 2026-04-27 (Phase 28L.2)
**Purpose:** 1-page brief for any new Claude Code / Codex / human session — what's in flight, what's parked, what's broken, what's next. Save 10-20 minutes of re-orientation per session.

---

## Where the build is right now

**Test suite:** 1,707 green (110 files). **Workflow blueprint:** v1.46. **Latest baseline:** `f68fcc1 feat(customers): Amazon FBM customer registry (Phase 28k)`.

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
| Phase 28L.3 — Stack-readiness dashboard | NEXT | — |
| Phase 28L.4 — Agent health surface | QUEUED | — |
| Phase 29 — Drew doctrine sweep | QUEUED | — |
| Phase 30.1-30.4 — AP packet UI, Reorder triggers, Inbox triage closed-loop, Reply composer + Pipeline enrich tests | QUEUED | — |
| Phase 31.1 — USPTO/FDA tracking | QUEUED | — |
| Phase 31.2 — External vendor portal | QUEUED | — |

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

These are immutable. If the user asks to relax one, push back and reference this doc.

1. **Every dollar figure needs a source citation.** Cite `[source: QBO]`, `[source: ShipStation live]`, etc. "Approximately" is not a license to fabricate.
2. **Every state transition writes an audit envelope.** No silent writes.
3. **Class A/B/C/D approval taxonomy is the authority.** Class C and D writes never go autonomous. Slack-approval click is the authorization.
4. **The `interviewer` agent runs first on under-specified non-trivial requests.** Ask 3-5 questions with defaults; never block longer than that.
5. **Drew owns nothing** (2026-04-27 correction). Approver / handler refs to Drew need reassignment — sweep pending in Phase 29.
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
