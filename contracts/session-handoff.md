# Session Handoff — USA Gummies 3.0 storefront

**Status:** AUTO-MAINTAINED — kept fresh by every commit cycle
**Last updated:** 2026-04-30 (post Phase D full-loop ship + sales-tour v0.1→v0.3 + email-intel incident postmortem + pricing v2.3 ratification template)
**Purpose:** 1-page brief for any new Claude Code / Codex / human session — what's in flight, what's parked, what's broken, what's next. Save 10-20 minutes of re-orientation per session.

---

## Where the build is right now

**Test suite:** 3,083 green across 188 files. **Latest baseline:** Phase D5 v0.2 Apollo enrichment routes (`3508ada`) + pricing v2.3 ratification thread template (`9445c2a`).

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
- ✅ **B2B Revenue operating loop (Phase D)** — DONE 2026-04-30. All six sub-lanes shipped:
  - **D1 stale-buyer detection** (`be3ef3c`) — 8 stalest deals per stage with next-action templates, surfaced in morning brief.
  - **D2 sample queue health** (`a4581b6`) — awaiting-ship + behind-queue + shipped-awaiting-response counts.
  - **D3 wholesale onboarding blockers** (`5454d76`) — stalled flow detection from existing Phase 35.f.5 KV store.
  - **D4 reorder follow-ups** (`234977c`) — channel-aware: Amazon FBM 60d + wholesale 90d (Shopify DTC 90d slot reserved for v0.2).
  - **D5 Apollo enrichment** v0.1 helpers (`a9cab02`) + v0.2 routes (`3508ada`) — `/api/ops/sales/apollo-enrich/[contactId]` + `/sweep`. Bulk auto-cron deferred to v0.3.
  - **D6 morning-brief integration** (folded into D1).
  Morning brief in `#ops-daily` now surfaces FIVE sales slices in priority order (Sales Command → Stale buyers → Sample queue → Onboarding blockers → Reorder follow-ups), all quiet-collapse on zero signal, EOD-skipped.
- ✅ **Sales tour field workflow (Ashford → Grand Canyon May 11–17 trip — 11 days out)** — v0.1 typed-input booth → Slack quote (`1cdd8b9`); v0.2 voice + Twilio SMS to Ben (`692d48f`); v0.3 SMS to buyer with prefilled NCS-001 deeplink + real-time HubSpot deal autosync (`cfb56dd`). Doctrine at `/contracts/sales-tour-field-workflow.md`. Trip-ready end-to-end.
- 🟡 **Pricing v2.3 reconciliation** — proposal at `/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md` (`1b3027b`); ratification thread template at `/contracts/proposals/pricing-grid-v2.3-ratification-thread-template.md` (`9445c2a`). Awaits Class C `pricing.change` Slack thread between Ben + Rene.
- 🟡 **Email-intel incident postmortem** (`261fe79`) — classifier + template fixes shipped; kill switch stays default-OFF + crons stay removed per Ben's incident brief; box 3 (approval-gate audit) awaits Ben's Slack-log confirmation. Doctrine at `/contracts/incident-2026-04-30-email-intel.md`.
- ⏸ **Research agent runtime activation** (R-1..R-7 latent, awaiting Ben's external tool decisions).

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
| OpenAI / ChatGPT workspace MCP connector (Phase 0) | Codex | DONE | `03d3c30..62222d2` (6 commits) |
| Sales-tour booth field workflow v0.1 → v0.2 → v0.3 | Claude Code | DONE 2026-04-30 | `1cdd8b9`, `692d48f`, `cfb56dd` |
| Phase D B2B Revenue operating loop (D1+D2+D3+D4+D5+D6) | Claude Code | DONE 2026-04-30 | `be3ef3c`, `a4581b6`, `5454d76`, `234977c`, `a9cab02`, `3508ada` |
| Email-intel incident postmortem (classifier + template fixes; gate held off) | Claude Code | DONE 2026-04-30 | `261fe79` (after Ben's containment commit `24de7b6`) |
| Shopify auto-ship `Tag: Internal` cosmetic fix | Claude Code | DONE 2026-04-30 | `6b63d3a` |
| Pricing v2.3 ratification thread template | Claude Code | DONE 2026-04-30 | `9445c2a` (proposal `1b3027b`) |
| Sales-tour prospect list (Ashford → Grand Canyon) | Codex / Ben | DONE | `b117995`, `6ca4282` |
| QBO invoice PUT `poNumber` field support | Codex | DONE | `483bf1d` |
| Brand story / supply-chain copy / pricing ladder + ad kill-list | Codex / Ben | DONE | `c7361ee`, `abe8da5`, `b2c705a`, `8aae948` |

---

## What's parked (waiting on humans)

| Item | Blocker | Owner |
|---|---|---|
| `qbo.bill.create.from-receipt` closer wiring (the actual "create the QBO bill on Rene approval" hop) | Rene's CoA mapping per category | Rene → Ben |
| Faire token rotation | Ben explicitly DROPPED 2026-04-29 ("im not rotating the token, let it go") — no longer parked, just noted | Ben (decided not to) |
| Powers B0001 batch pickup form (count + final date) | First production batch | Ben |
| Snow Leopard Ventures vendor PDF attachment to QBO #78 | Resolved 2026-04-12 in code (commit `14a0d61`) — actual attach pending Ben's manual pickup | Ben |
| Pricing v2.3 ratification — Q1–Q5 Slack thread | Awaits Ben + Rene reply via the template at `/contracts/proposals/pricing-grid-v2.3-ratification-thread-template.md` | Ben + Rene |
| Email-intel re-enable box 3 (approval-gate audit) | Awaits Ben's confirmation: did he click approve in Slack on the Eric Miller send, or was there no Slack approval at all? | Ben (read `/contracts/incident-2026-04-30-email-intel.md` §4) |
| Sales-tour env config for v0.2 + v0.3 | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` + `SALES_TOUR_BEN_SMS_TO` + `SALES_TOUR_BUYER_SMS_ENABLED=true` + Slack `files:read` scope on bot | Ben (~5 min in Vercel env + api.slack.com/apps) |
| Apollo enrichment — manual sweep watch | Run `POST /api/ops/sales/apollo-enrich/sweep?dryRun=true` first, watch a few real sweeps before D5 v0.3 cron auto-schedules | Ben (next sales-call window) |
| Research agents R-1..R-7 runtime | External tool decisions: Feedly / Muck Rack / SerpAPI / USPTO TESS / SEC EDGAR / Finbox | Ben |
| Slack `:white_check_mark:` reaction → mark-dispatched | Slack app event subscriptions (`reaction_added` + `reaction_removed`) + `reactions:read` scope + reinstall | Ben (one-time, ~2 min at api.slack.com/apps) |
| Mike Hippler / Thanksgiving Point first wholesale onboarding | Awaiting customer NCS-001 return | Mike (external) |

---

## What's broken / known gaps

| What | Status | Workaround |
|---|---|---|
| Make.com bridge | Broken since ~Apr 13 per memory; Ben to fix eventually | `/api/leads` bypasses Make.com via direct HubSpot `createDeal()` (Phase 1.b) |
| Email-intel auto-replier | DISABLED 2026-04-29 after Eric Miller incident; kill switch default-OFF + crons removed (`24de7b6`); structural fixes shipped (`261fe79`); awaits Ben's box-3 sign-off before re-enable | Postmortem at `/contracts/incident-2026-04-30-email-intel.md`; do NOT flip `EMAIL_INTEL_ENABLED=true` until §0 boxes ticked |
| Vercel CLI auth on this worktree | No credentials in `.vercel/` | Pull env vars manually via Chrome MCP from Vercel UI when needed |
| `files:read` Slack scope | Not on bot token (blocks sales-tour v0.2 voice transcription) | Add at api.slack.com/apps + reinstall to workspace; v0.1 typed input still works |
| Notion canon manifest fetcher | Not wired into P0-7 lockstep auditor | Auditor degrades gracefully (notionManifest=null); add when needed |
| Live recon agent currently shows 0 Faire/Shopify payout lines | 14-day window is just quiet — Faire pays Tue/Fri, no payouts hit recently | Verified token + scope are wired; will populate when next payout settles |
| D4 Shopify DTC reorder slot | Reserved in `ReorderChannel` enum but not populated — needs Shopify admin Customer-with-last-order query | Amazon FBM 60d + wholesale 90d already fully wired; v0.2 adds Shopify |
| D5 brief integration + auto-cron | Per-contact + bulk routes shipped; brief slot + cron deferred until Ben watches a few manual sweeps | Hit `POST /api/ops/sales/apollo-enrich/sweep?dryRun=true` first to preview |

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
