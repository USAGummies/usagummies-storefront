# Session Handoff — USA Gummies 3.0 storefront

**Status:** AUTO-MAINTAINED — kept fresh by every commit cycle
**Last updated:** 2026-04-29 (post P0-1..P0-7 ship + Faire wired + OpenAI MCP composed)
**Purpose:** 1-page brief for any new Claude Code / Codex / human session — what's in flight, what's parked, what's broken, what's next. Save 10-20 minutes of re-orientation per session.

---

## Where the build is right now

**Test suite:** 2,795 green across 167 files. **Latest baseline:** the OpenAI-MCP/agent-packs-snapshot integration commit (this push).

**ALL 7 P0s from `/contracts/agent-architecture-audit.md` §10 shipped 2026-04-28..29:**

| P0 | Title | Class | Surface |
|---|---|---|---|
| P0-1 | Slack-Corrections Drift Detector | A | `GET /api/ops/operating-memory/drift` |
| P0-2 | `/ops/agents/packs` Dashboard | A | `/ops/agents/packs` (server) + `GET /api/ops/agents/packs/snapshot` |
| P0-3 | Operating-Memory Transcript Saver | A | `POST /api/ops/transcript/capture` |
| P0-4 | Vendor-Master Coordinator | B (Rene) | upstream gate over existing `vendor.master.create` flow |
| P0-5 | Approval-Expiry Sweeper | A | `GET/POST /api/ops/control-plane/approval-sweep` (hourly cron) |
| P0-6 | Receipt-OCR → Bill-Draft Promoter | B (Rene) | upstream gate over existing `qbo.bill.create` flow |
| P0-7 | Notion ↔ /contracts Lockstep Auditor | A | `auditLockstep()` library + packs dashboard surfacing |

**Cross-agent integration:** Codex's OpenAI / ChatGPT workspace MCP connector (`src/lib/ops/openai-workspace-tools/`, `/api/ops/openai-workspace-tools/mcp`) ships ChatGPT custom-connector tools over our ops surfaces. Two registry entries (`ops.agent.packs`, `ops.operating-memory.search`) flipped from `planned` → `ready` once P0-2 + P0-3 landed; they now have backing routes wired by this push.

**Doctrine LOCKED 2026-04-29:**
- `/contracts/agent-architecture-audit.md` v1.7 — all 7 P0s marked implemented; ~50 ChatGPT-pack §11 proposals locked as rejected.
- Faire access token wired in Vercel env (FAIRE_ACCESS_TOKEN); recon agent + Faire-direct routes live.
- Digest cron retimed to Rene's locked cadence: 6 AM CT + 5 PM CT weekdays (UTC `0 11 * * 1-5` + `0 22 * * 1-5`).
- Approval-expiry hourly cron firing (UTC `22 * * * *`) — 24h escalate / 72h auto-expire from blueprint §5.2 finally on the wall clock.
- Shopify Payments payouts pulling into Thursday recon digest with CoA tag `400020.05` per CF-09.
- All prior doctrine still LOCKED: `/contracts/wholesale-pricing.md` v2.2, `/contracts/operating-memory.md` v1.1 (BCC-Rene rule), `/contracts/wholesale-onboarding-flow.md` v1.0, `/contracts/approval-taxonomy.md` v1.4 ("Drew owns nothing").

**Active build directive (Ben 2026-04-29):** P0 roadmap closed. Next phases per `/contracts/agent-architecture-audit.md`:
- B2B Revenue operating loop (Phase D in original mission directive — morning-brief actions, stale-buyer detection, sample queue health, wholesale onboarding blockers, reorder follow-up, Apollo enrichment with provenance).
- Sales tour prep for May 11-13 Ashford → Grand Canyon trip (12 days out — voice-note → freight quote → vendor signup form → on-spot price quote workflow).
- Research agent runtime activation (R-1..R-7 latent, awaiting Ben's external tool decisions).

**Recommended first 5 minutes of any new session:**
1. `git log --oneline -10` — see what just shipped.
2. Read `/contracts/agent-architecture-audit.md` §10 P0 status table to know where the canonical roadmap stands.
3. Read this doc + `CLAUDE.md` Operating Contracts section.
4. Skim `/contracts/agents/interviewer.md` — pre-build spec discipline.
5. Run `npx vitest run --reporter dot` — confirm baseline test count matches.

---

## What's in flight (recent + active lanes)

| Lane | Owner | State | Commit |
|---|---|---|---|
| P0-1..P0-7 (full agent-architecture-audit roadmap) | Claude Code | DONE | 9 commits in `49a0498..ab35711` (2026-04-29 push) |
| Faire token wired in Vercel env + production redeploy | Ben + Claude Code | DONE | env-only change (no code commit) 2026-04-29 |
| Digest cadence cron + approval-expiry cron + Shopify Payments wiring | Claude Code | DONE | `ab35711` |
| OpenAI / ChatGPT workspace MCP connector (Phase 0 registry + auth + JSON-RPC handler) | Codex | DONE | `03d3c30..62222d2` (6 commits) |
| OpenAI MCP `ops.agent.packs` + `ops.operating-memory.search` backing routes wired | Claude Code | DONE | this push |
| QBO invoice PUT `poNumber` field support | Codex | DONE | `483bf1d` |
| Storefront audit fixes (conversion-blockers, FTC risk, freight quoting, COGS) | Codex / Ben | DONE | `fdf96f4`, `f8f9996`, `d177cca`, `d50e497` |
| Sales-tour prospect list (Ashford → Grand Canyon May 11-13) | Codex / Ben | DONE | `b117995`, `6ca4282` |
| Brand story rewrite (anonymous voice + 3-state supply chain) | Codex / Ben | DONE | `c7361ee` |
| Free-shipping pricing ladder + buy-widget mobile-first | Codex / Ben | DONE | `abe8da5`, `b2c705a` |
| Ad-creative-performance kill-list + budget concentration tool | Codex / Ben | DONE | `8aae948` |

---

## What's parked (waiting on humans)

| Item | Blocker | Owner |
|---|---|---|
| `qbo.bill.create.from-receipt` closer wiring (the actual "create the QBO bill on Rene approval" hop) | Rene's CoA mapping per category | Rene → Ben |
| Faire token rotation | Token was generated + pasted in chat history; rotate to invalidate exposed copy | Ben (1 min in Faire portal + Vercel) |
| Powers B0001 batch pickup form (count + final date) | First production batch | Ben |
| Snow Leopard Ventures vendor PDF attachment to QBO #78 | Resolved 2026-04-12 in code (commit `14a0d61`) — actual attach pending Ben's manual pickup | Ben |
| 6-step tradeshow field workflow (voice → freight quote → vendor form → price → invoice → ship) | Pending design + dispatcher build for May 11 trip | Claude Code (next session) |
| Research agents R-1..R-7 runtime | External tool decisions: Feedly / Muck Rack / SerpAPI / USPTO TESS / SEC EDGAR / Finbox | Ben |
| Slack `:white_check_mark:` reaction → mark-dispatched | Slack app event subscriptions (`reaction_added` + `reaction_removed`) + `reactions:read` scope + reinstall | Ben (one-time, ~2 min at api.slack.com/apps) |
| Mike Hippler / Thanksgiving Point first wholesale onboarding | Awaiting customer NCS-001 return | Mike (external) |

---

## What's broken / known gaps

| What | Status | Workaround |
|---|---|---|
| Make.com bridge | Broken since ~Apr 13 per memory; Ben to fix eventually | `/api/leads` bypasses Make.com via direct HubSpot `createDeal()` (Phase 1.b) |
| Vercel CLI auth on this worktree | No credentials in `.vercel/` | Pull env vars manually via Chrome MCP from Vercel UI when needed |
| `files:read` Slack scope | Not on bot token | Use `conversations.history` to resolve message ts |
| Notion canon manifest fetcher | Not wired into P0-7 lockstep auditor | Auditor degrades gracefully (notionManifest=null); add when needed |
| Live recon agent currently shows 0 Faire/Shopify payout lines | 14-day window is just quiet — Faire pays Tue/Fri, no payouts hit recently | Verified token + scope are wired; will populate when next payout settles |

---

## Cross-agent integration map (Claude Code ↔ Codex composition)

This codebase is co-built by two AI agents in worktrees. The doctrine: **"If Claude Code is actively working a lane, do not touch its files. Work on docs, env readiness, smoke tests, or a disjoint workflow only."** (Per `ops/LIVE-RUNWAY-2026-04-25.md`.)

Recent composition examples (read these before assuming a lane is yours):

| Surface | Built by | Composed with |
|---|---|---|
| `src/lib/ops/agents-packs/` (P0-2 dashboard) | Claude Code | Surfaced via Codex's MCP connector at `ops.agent.packs` |
| `src/lib/ops/operating-memory/` (P0-1 + P0-3) | Claude Code | Surfaced via Codex's MCP connector at `ops.operating-memory.search` |
| `src/lib/ops/contract-lockstep/` (P0-7) | Claude Code | Internal — wired into P0-2 dashboard's `lockstepLoader` |
| `src/lib/ops/vendor-master/coordinator.ts` (P0-4) | Claude Code | Stacks above existing `vendor-onboarding.ts` (Codex/Ben prior) |
| `src/lib/ops/receipts/bill-draft-promoter.ts` (P0-6) | Claude Code | Bridges existing `receipt-review-packet.ts` (Codex/Ben prior) → `qbo.bill.create` flow |
| `src/lib/ops/openai-workspace-tools/` (Phase 0 MCP) | Codex | Now consumes both Claude Code surfaces above |
| `src/app/api/ops/qbo/{attachment,journal-entry,salesreceipt}/route.ts` | Codex/Ben | Used by Viktor for Snow Leopard + Q1 reclassification JEs |
| `src/lib/finance/shopify-payments.ts` `fetchRecentShopifyPayouts()` | Claude Code | Wired into reconciliation agent (Codex/Ben's prior contract) |

The OpenAI MCP registry (`src/lib/ops/openai-workspace-tools/registry.ts`) is the cleanest single-source-of-truth for what ChatGPT can read or request approval for. Read it before adding new external-AI surfaces.

---

## Doctrinal hard rules (do NOT relax)

**Print artifact rule (Ben 2026-04-27):**
Every shipping label print MUST be a 2-page PDF — page 1 the label, page 2 the packing slip with correct quantities + product name. **One click = both pages.** Implementation: `mergeLabelAndSlipPdf` in `src/lib/ops/packing-slip-pdf.ts`, called by the auto-ship route BEFORE the Slack upload. No thread reply on the happy path. Falling back to label-only is permitted ONLY when merge fails (loud audit `artifact.label.merge-failed`).

**Viktor briefing rule (Ben 2026-04-27):**
Viktor reads [`/contracts/viktor-rene-briefing.md`](./viktor-rene-briefing.md) on every session boot. That doc is auto-maintained alongside this session-handoff. When Rene asks Viktor a free-form question (W-8), Viktor answers from the briefing + cites file paths. Never fabricates. Change requests log to Open Brain `rene-request:<id>` for Ben's next session.

**Rene-engagement priority rule (Ben 2026-04-27):**
When Rene (`U0ALL27JM38`) is **active in `#financials`**, that is the highest-leverage build window in the company's day. Treat it as a session-wide priority interrupt. Drop other queued work for finance-touching builds. Walk him through it live in tight 2-min iteration loops. Capture every clarification to canonical contracts. Apply the interviewer-pre-build pass when scope is fuzzy. Audit-trail Rene-touching commits with `rene-touch` tag in the commit body. When Rene goes offline, leave a tight handoff with signed-off lanes, queued items, parked items, commit list.

These are immutable. If the user asks to relax one, push back and reference this doc.

1. **Every dollar figure needs a source citation.** Cite `[source: QBO]`, `[source: ShipStation live]`, etc. "Approximately" is not a license to fabricate.
2. **Every state transition writes an audit envelope.** No silent writes.
3. **Class A/B/C/D approval taxonomy is the authority.** Class C and D writes never go autonomous. Slack-approval click is the authorization.
4. **The `interviewer` agent runs first on under-specified non-trivial requests.** Ask 3-5 questions with defaults; never block longer than that.
5. **Drew owns nothing** (2026-04-27 correction). Phase 29 sweep DONE — taxonomy / compliance-doctrine / divisions / ops + inventory-specialist agent contracts all reassigned to Ben (or Ben+Rene Class C). Drew may appear only as an East Coast fulfillment node for samples. Locked by `src/lib/ops/__tests__/drew-doctrine.test.ts`.
6. **Orders → Ben (Ashford WA), samples → Drew, `#shipping` is the single source of truth** for label PDFs (v1.0 SHIPPING PROTOCOL pinned 2026-04-10).
7. **No QBO writes without registered taxonomy slug + Class B/C approval.**
8. **No secret extraction from Chrome / page content / user paste.** Class D `secret.share`. Even with explicit user permission, the agent refuses and routes the human to do the paste themselves. (Ratified 2026-04-29 during Faire token episode.)
9. **GitHub Push Protection scans for literal token prefixes (`sk_live_`, `xoxb-`, `AKIA`, `ghp_`).** Test fixtures that match real-secret regex patterns must split the prefix in source via string concatenation, e.g. `"sk_li" + "ve_FIXTURE..."`. Don't paste real-looking docs examples into tests.

---

## Conventions (cross-session)

- **`/api/ops/*` routes** require `isAuthorized()` (session OR `Authorization: Bearer $CRON_SECRET`) OR `isCronAuthorized()` (bearer only — for cron-fired routes). New routes need their prefix on `SELF_AUTHENTICATED_PREFIXES` in `src/middleware.ts` to bypass NextAuth's middleware-level redirect.
- **Pure helpers** live in `src/lib/ops/<feature>/`. Tests in `src/lib/ops/<feature>/__tests__/`. Routes in `src/app/api/ops/<feature>/route.ts`. Pages in `src/app/ops/<feature>/`.
- **KV keys** prefixed by domain: `shipping:`, `amazon:customer:`, `receipt-review-packet:`, `wholesale:flow:index`, `3.0:opmem:` (operating memory), etc. TTLs vary by retention need.
- **Slack channel registry** at `src/lib/ops/control-plane/channels.ts` + `contracts/channels.json`. Use `slackChannelId` (Cxxx) for `files.completeUploadExternal`; `name` (`#shipping`) for `chat.postMessage`-style.
- **Commit style:** `feat(<scope>): <one-liner>` followed by paragraphs explaining WHY, what it locks, +N tests, full suite count. End with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` for Claude Code, or Codex's equivalent.
- **Single-branch (`main`) only.** No feature branches — Vercel deploys every pushed branch. Push to `main` once at end of session, batches multiple commits into one Vercel deploy.
- **Pre-existing lint warnings are tolerated; do NOT introduce new ones.** Build must pass `npm run build`.

---

## What "done" means for the current build directive

P0 roadmap from `/contracts/agent-architecture-audit.md` §10 is **100% complete** as of 2026-04-29:

- 7/7 P0 agents shipped, 315 P0 tests, full suite 2,795 green
- All 7 entries in P0_STATUS_TABLE marked `implemented` with code citations
- Audit doc v1.7 history reflects each P0's ship date and acceptance scorecard
- OpenAI MCP composes cleanly with Claude Code's P0 surfaces (no greenfield rebuild)

Next directive set per agent-architecture-audit.md and the original mission scope:

1. **B2B Revenue operating loop** (Phase D) — high-leverage for Ben's one-person sales motion
2. **Sales tour May 11-13 prep** — 12 days out, time-bounded
3. **Research agents R-1..R-7** — pending Ben's external tool decisions
4. **`qbo.bill.create.from-receipt` closer wiring** — pending Rene's CoA mapping
5. **Notion canon fetcher for P0-7** — when Notion mirroring becomes a real operator concern

Each of these can be a separate session. The interviewer-agent pre-build pass should run on any of them when scope is fuzzy.
