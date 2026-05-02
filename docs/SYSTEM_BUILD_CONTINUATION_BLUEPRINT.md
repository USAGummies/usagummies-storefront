# USA Gummies System Build Continuation Blueprint

**Status:** execution blueprint  
**Date:** 2026-05-02  
**Purpose:** keep Codex / Claude Code moving when one agent times out. This document is the next-step map for turning the current raw ops platform into a polished, Slack-first, business-wide operating system.

---

## 1. Current Reality

The repo now has a broad operating platform: sales command center, readiness dashboard, Slack approvals, channel registry, Faire Direct workflows, finance review queues, receipt OCR review packets, AP packets, shipping artifacts, OpenAI workspace tools, and email-agent readiness gates.

The core issue is not lack of primitives. The issue is **system integration and operator polish**:

- Many workflows exist as isolated route/page/helper islands.
- Slack is now correctly routed by live channel IDs, but the app-side Slack configuration still must be smoke-tested in production.
- Approval cards are materially better, but most workflow-specific payload previews still need bespoke renderers.
- Email workflows have safety gates, but the actual email-agent group must be made observable, recoverable, and Slack-editable before it can run daily.
- OpenAI workspace tools exist as read-only connectors, but they are not yet organized into department agent workpacks with daily/weekly task loops.
- Browser dashboards exist, but Slack should become Ben’s primary command surface and the browser dashboards should be the deep-link/detail surfaces.

---

## 2. Highest-Risk Problems To Fix First

### P0 — Slack App Live Wiring Is Still The Bottleneck

Code now expects:

- Events API to hit `/api/ops/slack/events`
- Interactivity to hit `/api/slack/approvals`
- `SLACK_SIGNING_SECRET` present
- `SLACK_BOT_TOKEN` present
- bot invited to active private channels
- bot scopes for `chat:write`, `commands` if slash commands are added, `channels:history` / `groups:history` where read loops need history, and `files:write` where file upload is used

If this is not correct in the Slack App Admin UI, the repo can be perfect and Slack will still feel dead.

### P0 — Approval “Needs edit” Is Now Structured, But Not Yet Payload-Revising

Current behavior:

- `Needs edit` opens a modal.
- Submitted edit request records a non-terminal `ask`.
- Thread note tells the operator/agent to revise and open a fresh approval.

Missing next layer:

- For email approvals, the modal should eventually edit the draft payload directly and regenerate the approval card.
- For non-email approvals, the modal should capture structured correction fields by workflow type.

Do not jump straight to autonomous LLM rewriting. First ship deterministic edit storage + reissue.

### P0 — Email Agent Group Needs Control Plane Runtime, Not Just Readiness

Current state:

- Email-intel direct run remains restricted after the 2026-04-30 incident.
- Email-agent readiness/dry-run surfaces exist.
- Gmail draft/send primitives exist.
- Slack approval edit modal now exists.

Missing:

- unified email-agent inbox queue
- safe daily triage heartbeat
- draft packet review surface
- Slack approval cards with email-specific preview
- edit-resubmit loop
- send-on-approve only

### P1 — Slack Command Center Is Read-Only But Too Narrow

Current:

- `ops dashboard` posts Sales Command Center Block Kit card in-thread.
- It covers revenue/action/readiness-ish context.

Missing:

- `/ops today` or `ops today` command that summarizes all departments, not only sales.
- “What needs Ben?” command for pending approvals + blockers.
- “Finance today”, “Shipping today”, “Sales today” departmental slices.

### P1 — Department Workflows Need Canonical Work Queues

Several departments have data surfaces but not one clear queue:

- Sales: good command center, but daily action assignment still implicit.
- Finance: review page exists, but receipt-review promotion is not yet connected all the way to QBO bill creation.
- Shipping: labels/artifacts/dispatch exist, but not all manual fallback flows are a single button path.
- Marketing: scripts and Meta Ads handoff exist, but the marketing operating lane is less hardened than sales/finance/shipping.
- Research: notes + librarian exist, but findings are not yet turned into assignments.

### P1 — OpenAI Workspace Agents Need Workpacks

Current OpenAI workspace tooling is mostly read-only and safe. That is correct.

Missing:

- curated workpack per department
- “allowed reads / allowed writes / prohibited actions” per workpack
- prompts that ChatGPT workspace agents can use reliably
- heartbeat outputs written to audit/status
- clear human handoff object when an agent cannot act

---

## 3. Operating Doctrine For The Next Builds

1. **Slack first, browser second.** Slack should show the decision card / summary / command. Browser dashboards hold detail, filters, and raw JSON links.
2. **Every department gets one “today” queue.** If Ben asks “what do I do now?” the system should answer from canonical data.
3. **Every write action stays gated.** Gmail send, HubSpot mutation, QBO mutation, ShipStation label buy, Faire invite/follow-up, pricing/terms all stay Class B/C.
4. **No fabricated zeros.** `not_wired`, `error`, and `empty` are different states.
5. **Every workflow gets an edit loop.** Approval cards need approve/reject/needs-edit; needs-edit must create a clear revision path.
6. **Agents produce work records, not vibes.** Heartbeat output should become queue rows, approval requests, or audit/status entries.

---

## 4. Recommended Implementation Sequence

### Build 1 — Slack App Live Smoke + Self-Test Route

**Goal:** prove production Slack wiring from code, not by guessing.

Files to touch:

- `src/app/api/ops/slack/self-test/route.ts` (new)
- `src/app/api/ops/slack/self-test/__tests__/route.test.ts` (new)
- `src/lib/readiness/status.ts`
- `src/lib/readiness/__tests__/status.test.ts`
- `contracts/slack-operating.md`

Build:

1. Add `GET/POST /api/ops/slack/self-test`.
2. Auth-gated via `isAuthorized()`.
3. `GET` returns:
   - bot token present boolean
   - signing secret present boolean
   - live channel registry status
   - expected Slack App URLs
   - no secrets
4. `POST` optionally posts a test card to a requested channel, default `#ops-daily` by channel ID.
5. Add readiness smoke item linking to `/api/ops/slack/self-test`.
6. Tests lock no-secret-leak and channel-ID routing.

Acceptance:

- Operator can hit the route after deploy and prove Slack app config.
- No secrets leak.
- No external workflow mutation.

### Build 2 — Department Command Cards

**Goal:** Slack can answer “what needs Ben?” across departments.

Files to touch:

- `src/lib/ops/operator-command-center.ts` (new pure aggregator)
- `src/lib/ops/slack-operator-command-center.ts` (new renderer)
- `src/app/api/ops/operator-command-center/route.ts` (new read-only route)
- `src/app/api/ops/slack/events/route.ts`
- tests under `src/lib/ops/__tests__/` and `src/app/api/ops/.../__tests__/`

Build:

1. Aggregate:
   - pending approvals
   - sales actions
   - finance review counts
   - shipping preflight / labels needing action
   - email-agent readiness / queued drafts
   - readiness blockers
2. Render Slack Block Kit:
   - header “What needs Ben”
   - top 5 actions
   - blockers
   - buttons to `/ops/sales`, `/ops/finance/review`, `/ops/shipping`, `/ops/readiness`
3. Wire Slack messages:
   - `ops today`
   - `what needs ben`
   - `ben queue`
4. Read-only only.

Acceptance:

- Ben can ask Slack for his queue.
- The card is short, visual, and deep-links to dashboards.
- No mutations.

### Build 3 — Email Agent Work Queue

**Goal:** restart email automation safely as a queue + approval flow, not a raw runner.

Files to inspect first:

- `src/app/api/ops/fulfillment/email-intel/run/route.ts`
- `src/lib/ops/email-intelligence/*`
- `src/app/api/ops/email-agents/status/route.ts`
- `src/app/ops/email-agents/*`
- `contracts/incident-2026-04-30-email-intel.md`

Build:

1. New queue helper:
   - `src/lib/ops/email-agent-queue.ts`
   - KV keys for candidate emails, draft packets, status
2. New route:
   - `POST /api/ops/email-agents/triage`
   - dry-run default
   - reads Gmail, classifies, writes queue rows only
   - never sends
3. New dashboard section:
   - `/ops/email-agents`
   - shows candidates, draft status, blocked reasons
4. Slack command:
   - `email queue`
   - posts summary card with top drafts needing review
5. Tests:
   - no Gmail send
   - no HubSpot write unless existing approved path
   - incident phrases remain blocked
   - queue errors never become “0”

Acceptance:

- Email agents can run daily in queue-only mode.
- Ben can see draft candidates from Slack/browser.
- Sending still requires existing approval closer.

### Build 4 — Email Approval Edit-Resubmit

**Goal:** make email approvals feel like a polished approval station.

Files to inspect first:

- `src/lib/ops/email-intelligence/approval-executor.ts`
- approval request creation route for email drafts
- `src/app/api/slack/approvals/route.ts`
- `src/lib/ops/control-plane/slack/approval-surface.ts`

Build:

1. Add email-specific payload ref loader.
2. Add edit-modal callback for email approvals:
   - fields: To, Subject, Body
   - save writes revised draft payload
   - original approval stands down or remains pending with revision note
   - new approval card opens with revised preview
3. Approval card preview:
   - To
   - Subject
   - 8-12 line body excerpt
   - claims/safety warnings
   - source email link
4. Tests:
   - edit does not send
   - revised card opens
   - original audit trail preserved
   - forbidden claims still blocked

Acceptance:

- Ben can edit an email draft in Slack and resubmit without asking an agent manually.
- Send still fires only after approve.

### Build 5 — Finance Receipt Lane Closure

**Goal:** move from OCR suggestions to Rene-ready accounting packets, still no unsafe QBO writes.

Build:

1. Register or confirm taxonomy for `receipt.review.promote`.
2. Add browser button on `/ops/finance/review` to request review packet approval when eligible.
3. Slack card for Rene:
   - vendor/date/amount/category
   - OCR warnings
   - source receipt link
   - approve/reject/needs-edit
4. On approve, packet becomes `rene-approved`.
5. Separate later Class B action creates QBO bill only when taxonomy and QBO mapping are locked.

Acceptance:

- Receipts no longer stall as passive suggestions.
- Rene has a clean approval station.
- No QBO write yet unless separately approved.

### Build 6 — OpenAI Workspace Agent Workpacks

**Goal:** make ChatGPT workspace agents useful without giving them unsafe write access.

Files to inspect first:

- `contracts/openai-workspace-agents.md`
- `src/lib/ops/openai-workspace-tools/registry.ts`
- `/api/ops/openai-workspace-tools/*`
- `contracts/agent-heartbeat.md`
- `src/lib/ops/agent-heartbeat/*`

Build:

1. Add `src/lib/ops/workpacks/*`:
   - `sales.ts`
   - `finance.ts`
   - `shipping.ts`
   - `email.ts`
   - `marketing.ts`
2. Each workpack defines:
   - role
   - read tools
   - allowed outputs
   - prohibited actions
   - approval slugs it may open
   - daily checklist prompt
3. Add route:
   - `GET /api/ops/openai-workspace-tools/workpacks`
4. Add Slack command:
   - `agents status`
   - returns active workpacks + stale heartbeats
5. Tests:
   - workpacks are read-only unless explicit approval slug
   - prohibited actions include QBO autonomous writes, pricing, checkout, Shopify product logic, ungated Gmail sends

Acceptance:

- ChatGPT agents can read and summarize each department safely.
- Any write proposal becomes an approval request, not a direct mutation.

### Build 7 — Marketing Lane Hardening

**Goal:** bring marketing up to the same operating standard as sales/finance.

Known current weakness:

- marketing scripts exist but appear partly outside the hardened ops workflow.
- Meta Ads handoff exists, but Slack daily digest automation still needs webhook/config verification.

Build:

1. Create `/ops/marketing` command dashboard if not already sufficient.
2. Add read-only scorecard:
   - Meta Ads status
   - creative queue
   - daily spend/readiness
   - blockers
3. Slack command:
   - `marketing today`
4. Approval lane:
   - creative publish
   - ad spend launch/change
   - claims review
5. No product/pricing/cart changes.

Acceptance:

- Marketing has the same “today queue” and approval shape as other departments.

---

## 5. Slack UX Standard For All Future Cards

Every Slack card should be Block Kit, not plain wall text.

Minimum structure:

1. Header block: workflow + state
2. Context block: run id, source, generated time
3. Section fields: 2-column key metrics
4. Brief section: “What this means”
5. Risk / blocker section
6. Actions block:
   - approve/reject/needs-edit for approvals
   - open dashboard links for read-only summaries
7. Thread follow-up for execution result

Avoid:

- raw JSON dumps
- full email bodies above 12 lines
- giant evidence lists
- channel names instead of IDs for post targets
- top-level duplicate posts when a thread exists

---

## 6. Exact Next Prompt For Claude Code / Codex

```text
You are working in /Users/ben/usagummies-storefront on main.

Goal: continue polishing USA Gummies into a Slack-first business operating system.

Start with Build 1 from docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md:
Slack App Live Smoke + Self-Test Route.

Constraints:
- Do not touch pricing, cart, bundle math, Shopify product logic, checkout, QBO writes, or inventory rules.
- Do not touch unrelated dirty creative/script files.
- Keep changes small and test-backed.
- Slack writes must route by canonical live channel IDs via the channel registry.
- No secrets may ever appear in responses or logs.

Build:
1. Add GET/POST /api/ops/slack/self-test.
2. GET returns boolean-only Slack readiness: bot token present, signing secret present, live channel registry ids, expected Events URL, expected Interactivity URL, required scopes as checklist text.
3. POST optionally posts a compact Block Kit test card to a requested registered channel; default ops-daily. Auth-gated with isAuthorized().
4. Add readiness smoke-check entry linking to /api/ops/slack/self-test.
5. Tests:
   - 401 unauthenticated
   - GET no secret leak
   - GET includes expected URLs
   - POST defaults to C0ATWJDKLTU
   - POST refuses unknown channel id/name
   - POST never accepts archived channel ids
6. Update contracts/slack-operating.md version history.

Run:
- npx vitest run
- npx tsc --noEmit
- npm run lint

Commit and push.

Acceptance:
- Operator can verify Slack app live wiring from /ops/readiness.
- Self-test proves the bot can post to a live channel by channel ID.
- No workflow mutation occurs.
- Tests/typecheck/lint pass.
```

---

## 7. Current Residual Worktree Warning

At the time this blueprint was written, the worktree had unrelated creative/script changes:

- `scripts/creative/draft-creative.mjs`
- `scripts/generate-sales-sheet.mjs`
- untracked `scripts/creative/*`
- untracked `scripts/marketing/`

Do not stage or revert those unless Ben explicitly says they are part of the current task.
