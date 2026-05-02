# USA Gummies System Build Continuation Blueprint

**Status:** execution blueprint  
**Date:** 2026-05-02  
**Purpose:** keep Codex / Claude Code moving when one agent times out. This document is the next-step map for turning the current raw ops platform into a polished, Slack-first, business-wide operating system.

---

## 1. Current Reality

The repo now has a broad operating platform: sales command center, readiness dashboard, Slack approvals, channel registry, Faire Direct workflows, finance review queues, receipt OCR review packets, AP packets, shipping artifacts, OpenAI workspace tools, and email-agent readiness gates.

The core issue is not lack of primitives. The issue is **system integration and operator polish**:

- Many workflows exist as isolated route/page/helper islands.
- Slack is now correctly routed by live channel IDs. The production self-test route posted a Block Kit card to `#ops-daily` successfully on 2026-05-02, proving bot token + channel routing for `chat.postMessage`.
- Approval cards are materially better, but most workflow-specific payload previews still need bespoke renderers.
- Email workflows have safety gates, but the actual email-agent group must be made observable, recoverable, and Slack-editable before it can run daily.
- OpenAI workspace tools exist as read-only connectors, but they are not yet organized into department agent workpacks with daily/weekly task loops.
- Browser dashboards exist, but Slack should become Ben’s primary command surface and the browser dashboards should be the deep-link/detail surfaces.

---

## 2. Highest-Risk Problems To Fix First

### P0 — Slack Event Ingestion Is The Remaining Bottleneck

Verified working:

- `SLACK_BOT_TOKEN` present in production
- `SLACK_SIGNING_SECRET` present in production
- `/api/ops/slack/self-test` deployed
- production bot can post a Block Kit card to `#ops-daily` by canonical channel ID
- `/ops/slack` exists as the operator-facing Slack control board

Still not proven:

- Events API to hit `/api/ops/slack/events`
- Interactivity to hit `/api/slack/approvals`
- bot invited to active private channels
- bot scopes for `commands` if slash commands are added, `channels:history` / `groups:history` where read loops need history, and `files:write` where file upload is used

Important live finding: messages posted through the ChatGPT Slack connector showed up in `#ops-daily`, but did **not** generate in-thread replies from `/api/ops/slack/events`. That likely means Slack Events does not deliver bot/app-origin messages, the app event subscription is not firing for that channel, or the event URL/subscription configuration still needs admin verification. The repo now has diagnostics, but Slack App Admin still needs a human smoke.

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

Current OpenAI workspace tooling is mostly read-only and safe. That is correct. The first generic workpack queue now exists and `/ops/workpacks` exposes it to operators.

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

### Build 1 — Slack App Live Smoke + Self-Test Route — SHIPPED

**Status:** shipped in commits `85a9e12d` and `9c62d57a`.

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

- Operator can hit `/ops/slack` after deploy and see Slack readiness.
- `POST /api/ops/slack/self-test` posts a compact Block Kit card to `#ops-daily`.
- No secrets leak.
- No external workflow mutation.

Production verification completed 2026-05-02:

- `GET /api/ops/slack/self-test` returned 200 with bot/signing-secret booleans present and active channel registry rows.
- `POST /api/ops/slack/self-test {channel:"ops-daily"}` returned 200 and posted to `#ops-daily` at Slack ts `1777758790.850549`.
- Slack connector readback confirmed the `USA Gummies Ops` bot message landed in `#ops-daily`.

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

### Build 6 — OpenAI Workspace Agent Workpacks — PARTIALLY SHIPPED

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

Shipped so far:

- `src/lib/ops/workpacks.ts`
- `GET/POST /api/ops/workpacks`
- `/ops/workpacks`
- Slack workpack router for phrases like `ask codex`, `ask claude`, `draft reply`, `summarize`, and `turn into task`
- app/bot-origin explicit commands are allowed by the local route tests

Still missing:

- actual Slack Events live delivery for connector-origin commands
- workpack execution/claiming loop
- department-specific workpack prompt packs
- result cards back into Slack threads

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

### Build 8 — External Agent + GTM Tool Adapter Layer

**Goal:** let tools like Polsia, Sola, Reevo, OpenAI workspace agents, and Claude Code help the business without becoming uncontrolled systems of record.

Principle:

- HubSpot remains CRM source of truth.
- Slack remains Ben's command board.
- Repo-native routes remain the only execution path for sensitive writes.
- External tools may propose work, drafts, leads, research, and code prompts.

Build:

1. Define a normalized external work item schema:
   - source tool
   - department
   - entity reference
   - proposed action
   - risk class
   - allowed execution path
   - blocked actions
2. Add adapter lanes:
   - Reevo lead/outreach proposals
   - Polsia strategy/creative/prototype proposals
   - Sola browser/RPA runbook outputs
   - OpenAI/Claude/Codex workpack outputs
3. Render each item as a Slack card with:
   - source
   - evidence
   - recommended action
   - approve/edit/reject or open-dashboard actions
4. No external tool directly mutates:
   - HubSpot stages/properties
   - Gmail sends
   - QBO
   - Shopify cart/pricing/checkout/product logic
   - ad spend
   - ShipStation labels

Acceptance:

- External tools increase throughput without creating data drift.
- Every proposed write enters the same approval/control-plane path.

### Build 9 — Slack Visual Command Board

**Goal:** make Slack feel like a polished operating cockpit instead of text dumps.

Build:

1. Standardize Block Kit department cards:
   - Sales
   - Finance
   - Email
   - Shipping
   - Marketing
   - Ops readiness
2. Add compact visual summaries:
   - metric tiles
   - status bands
   - emoji-free severity labels where clarity matters
   - chart/image attachments for dense reports when useful
3. Add thread-first behavior:
   - top-level card is short
   - evidence/raw details stay in thread or dashboard
4. Add edit modals for draft-heavy workflows.

Acceptance:

- Ben can scan Slack from the road and understand what matters in seconds.
- Slack messages become decision cards, not walls of text.

### Build 10 — HubSpot Proactive Revenue Agent

**Goal:** stop relying on Ben's memory for customer follow-up, stalled deals, and reorder opportunities.

Phase 1 is read-only.

Build:

1. Add a pure proactive revenue classifier:
   - stale active deals
   - stalled sample follow-ups
   - open call tasks
   - reorder/check-in candidates when supported by HubSpot timestamps
   - CRM hygiene gaps when source fields exist
2. Add read-only route:
   - `GET /api/ops/hubspot/proactive`
3. Add `/ops/sales` section:
   - “HubSpot proactive queue”
   - grouped actions + top five rows
4. Add morning brief / Slack slice after the first browser version is stable.
5. No HubSpot writes, no email drafts, no stage changes in Phase 1.

Acceptance:

- HubSpot becomes a proactive signal source.
- A HubSpot outage is an error state, never a fabricated zero.
- No CRM mutation happens.

### Build 11 — Slack AI Operator Router — PARTIALLY SHIPPED

**Goal:** let Ben converse with ChatGPT / Claude Code / Codex from Slack and get real structured results without model drift.

Build:

1. Add workpack schema + KV queue:
   - `queued`
   - `running`
   - `needs_review`
   - `approved`
   - `done`
   - `failed`
2. Add Slack reply parser:
   - `draft reply`
   - `summarize`
   - `explain`
   - `turn into task`
   - `ask codex`
   - `ask claude`
3. Add workpack builder:
   - source message/thread
   - entity refs
   - allowed actions
   - prohibited actions
   - expected output schema
4. Add first safe actions:
   - draft-only email reply
   - prepare Codex/Claude implementation prompt
   - summarize thread into task
5. No model-owned sends or writes. Approved execution remains repo-native.

Shipped so far:

- workpack schema + KV queue
- Slack message parser/router
- in-thread `Workpack queued` reply path in code
- `/ops/workpacks` dashboard for fallback visibility

Live blocker:

- Connector-origin messages in `#ops-daily` did not trigger the production event route during the 2026-05-02 smoke. The code path is tested, but Slack Events delivery/config needs admin validation.

Acceptance:

- Ben can work from Slack while on the road.
- AI workers return structured cards, not freeform drift.
- Every serious action still has a human approval gate.

### Build 12 — Slack Event Receipt Ledger

**Goal:** stop guessing whether Slack Events is firing. Record the last safe subset of inbound event metadata so the operator can see whether Slack is delivering events to the app.

Files to touch:

- `src/lib/ops/slack-event-ledger.ts` (new)
- `src/app/api/ops/slack/events/route.ts`
- `src/app/api/ops/slack/events/ledger/route.ts` (new read-only route)
- `src/app/ops/slack/SlackControlBoard.client.tsx`
- tests under `src/lib/ops/__tests__` and `src/app/api/ops/slack/events/__tests__`

Build:

1. Add a KV-backed event receipt ledger with a capped index (`ops:slack-events:index`).
2. Store only non-secret metadata:
   - event id / team id if present
   - channel id
   - message ts
   - subtype
   - whether command was recognized
   - whether the event was skipped and why
   - createdAt
3. Call it at the top of `/api/ops/slack/events` after signature/auth verification and body parse.
4. Add `GET /api/ops/slack/events/ledger?limit=25` auth-gated read-only route.
5. Add a “Recent Slack Events” section to `/ops/slack`.
6. Tests:
   - no raw message body stored beyond a short safe snippet
   - bot/app message with explicit command records `recognized=true`
   - normal bot chatter records skipped reason
   - ledger KV failure never blocks event handler

Acceptance:

- Ben can open `/ops/slack` and immediately see whether Slack Events are reaching production.
- Event delivery failures are distinguishable from parser failures.
- No secrets or long message bodies are stored.

### Build 13 — Workpack Claim / Result Loop

**Goal:** make `/ops/workpacks` useful for Codex/Claude handoff, not just a queue.

Files to touch:

- `src/lib/ops/workpacks.ts`
- `src/app/api/ops/workpacks/[id]/route.ts` (new)
- `src/app/ops/workpacks/WorkpacksView.client.tsx`
- tests

Build:

1. Add `updateWorkpack()` with safe fields:
   - status
   - assignedTo
   - resultSummary
   - resultPrompt
   - resultLinks
   - failureReason
2. Add `PATCH /api/ops/workpacks/[id]`.
3. UI controls:
   - mark running
   - mark needs_review
   - mark done
   - attach result summary/prompt
4. Keep all execution external/human-operated for this phase.
5. Tests lock:
   - status enum
   - no business-system imports
   - source guardrails preserved
   - invalid transitions fail closed where needed

Acceptance:

- A Slack-created workpack can be claimed and completed from the browser.
- Claude/Codex can resume from a structured prompt instead of session-history soup.
- No automated writes happen.

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

Goal: build Build 12 from docs/SYSTEM_BUILD_CONTINUATION_BLUEPRINT.md:
Slack Event Receipt Ledger.

Context:
- Slack self-test is shipped and production-verified.
- /ops/slack exists and can post a visual Block Kit self-test card.
- /ops/workpacks exists.
- The remaining blocker is knowing whether Slack Events are actually reaching
  /api/ops/slack/events in production. Connector-origin `ask codex...`
  messages appeared in #ops-daily but did not get bot replies.

Constraints:
- Do not touch pricing, cart, bundle math, Shopify product logic, checkout, QBO writes, or inventory rules.
- Do not touch unrelated dirty creative/script files.
- Keep changes small and test-backed.
- Slack writes must route by canonical live channel IDs via the channel registry.
- No secrets may ever appear in responses or logs.

Build:
1. New src/lib/ops/slack-event-ledger.ts:
   - appendSlackEventReceipt()
   - listSlackEventReceipts()
   - capped KV index
   - stores safe metadata only, not full raw event bodies
2. Wire appendSlackEventReceipt into /api/ops/slack/events after request
   verification/body parse. Ledger failures must never block event handling.
3. New GET /api/ops/slack/events/ledger:
   - auth-gated with isAuthorized()
   - returns recent receipts + totals
4. Extend /ops/slack with a Recent Slack Events section:
   - event time
   - channel
   - subtype
   - recognized command yes/no
   - skipped reason
5. Tests:
   - no secret leak / no full body leak
   - explicit app/bot command records recognized=true
   - regular bot chatter records skipped reason
   - ledger KV failure does not break the Slack event handler
   - GET route auth-gated

Run:
- npx vitest run
- npx tsc --noEmit
- npm run lint

Commit and push.

Acceptance:
- Operator can verify Slack Events delivery from /ops/slack.
- Event-delivery failures are distinguishable from parser/router failures.
- No workflow mutation occurs beyond the diagnostic KV ledger.
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
