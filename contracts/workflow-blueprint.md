# USA Gummies 3.0 — Whole-Company Workflow Blueprint

**Status:** CANONICAL — 2026-04-24
**Purpose:** Single map of every department's workflows, what powers them, who approves what, where Slack notifications land, and how close each is to Monday autonomous operations.
**Companion:** [`activation-status.md`](activation-status.md) (live runtime inventory) · [`build-sequence.md`](build-sequence.md) (forward-looking order) · [`approval-taxonomy.md`](approval-taxonomy.md) (A/B/C/D action registry)

This doc replaces ad-hoc Slack messages about "what's the workflow for X." If a workflow runs without an entry here, it's drift — flag it.

---

## Format

Each row uses the schema:

| Field | Meaning |
|---|---|
| **Trigger** | Cron / event / human-invoked |
| **Source systems** | What we *read* from |
| **Enrichment** | What we cross-reference for context |
| **AI role** | What an LLM does (drafter, classifier, summarizer, none) |
| **Human approver** | Who clicks approve in Slack |
| **Slack** | Where the result lands |
| **Writeback** | What system gets the durable record |
| **Audit** | What lands in `#ops-audit` |
| **Failure mode** | What we lose if this breaks |
| **Tests** | Coverage status |
| **Monday MVP** | green / yellow / red |
| **Later-state** | Next automation step |

---

## Division 1 — Sales / B2B / HubSpot

### S1.1 Email-intelligence triage (P0 — CLOSED LOOP 2026-04-24)
- **Trigger:** Cron at 8am / 12pm / 3pm / 6pm / 9pm PT
- **Source:** Gmail INBOX since cursor
- **Enrichment:** HubSpot contact lookup, KV processed-set, Gmail SENT thread scan
- **AI role:** Deterministic classifier first (rules-based), LLM fallback only at confidence < 0.7
- **Approver:** Ben for `gmail.send` (Class B, every reply)
- **Slack:** Report → `#ops-daily`. Approval cards → `#ops-approvals`
- **Writeback:** Gmail draft (Class A — `draft.email`); on Slack approval click, the handler calls `executeApprovedEmailReply()` → `sendGmailDraftDetailed()` + HubSpot `logEmail` + audit
- **Audit:** Every classification + draft + approval + send logged to `#ops-audit` via `record()` / `requestApproval()` / `appendExecutionAudit()`
- **Failure:** Gmail unreachable → run logs error, posts partial report. Send failure on approval → thread reply with `:warning:` and the approval row stays approved-but-unsent for retry
- **Tests:** 32 tests across classifier, draft, cursor, report, sample-request, approval-executor
- **Monday MVP:** 🟢 — fully closed loop: read → classify → dedupe → draft → approve → send → log → audit
- **Later:** LLM fallback for ambiguous categories; auto-send for graduated low-risk patterns

### S1.5 Sample-request → shipping bridge (P0 — NEW 2026-04-24)
- **Trigger:** Side-effect of S1.1 — when classifier returns `category=sample_request`
- **Source:** Email envelope (subject + snippet)
- **Enrichment:** Deterministic ship-to extractor (`parseShipToFromEmail`): regex over body for `<number> <words> <USPS-suffix>` + `City, ST 12345` with `US_STATES` allowlist
- **AI role:** None (regex + state-code/ZIP heuristics only — never invents addresses, hard-rules §7)
- **Approver:** Ben (Class B `shipment.create`) — when address parses cleanly, the orchestrator POSTs an `OrderIntent` (channel=`manual`, tags=`["sample","from-email"]`, packagingType=`case`, cartons=1) to `/api/ops/agents/sample-dispatch/dispatch` which opens the existing approval card in `#ops-approvals`. When address is incomplete, the existing draft (which already asks for the missing fields) goes out as the reply — no dispatch, no invented data
- **Slack:** Approval card → `#ops-approvals` (only when ready). Daily report (`#ops-daily`) includes count of sample dispatches opened in the run
- **Writeback:** Approval store (proposalTs); never touches ShipStation directly — channel=`manual` keeps it OFF the auto-ship path (which only fires for Amazon FBM + Shopify). Drew is the origin for sample shipments
- **Audit:** Dispatch attempt + classifier hit logged via the orchestrator's existing audit trail
- **Failure:** Dispatch route 5xx → orchestrator records error, draft still goes out asking for confirmation. Address parse false-negative → caller falls through to draft asking for details (preferred over inventing)
- **Tests:** Yes — `__tests__/sample-request.test.ts` (9 tests): classifier integration, ship-to extraction (clean, missing fields, fake state codes rejected), dispatch hand-off (manual channel, sample tags, intent shape), draft template asks for missing details, no auto-ship promise language
- **Monday MVP:** 🟢
- **Later:** Add HubSpot deal auto-create when sample → manual order conversion happens

### S1.2 HubSpot deal-stage automation
- **Trigger:** Webhook on `deal.propertyChange` (HubSpot signature v3)
- **Source:** HubSpot deal payload
- **AI role:** None (deterministic intent normalizer)
- **Approver:** Ben for `shipment.create` if dealstage moved to PO_RECEIVED / CLOSED_WON
- **Slack:** Approval card → `#ops-approvals`
- **Writeback:** Approval store
- **Audit:** Every dispatch + refusal mirrored
- **Tests:** Yes (`hubspot-deal-to-intent.test.ts`)
- **Monday MVP:** 🟢

### S1.3 Reply Composer + Pipeline Enrich
- **Trigger:** Manual via `/api/ops/pipeline/reply-composer` and `/enrich`
- **Source:** Pipeline (Notion), Supabase brain (pgvector)
- **Enrichment:** Outreach pitch spec + Approved Claims registry — fail-closed if hallucinated claim detected
- **AI role:** Sonnet draft + claims gate
- **Approver:** Ben (Class B `gmail.send`)
- **Slack:** `#ops-audit`
- **Tests:** Missing
- **Monday MVP:** 🟡 — works but no test coverage on the composer
- **Later:** Wire reply-composer into the email-intelligence triage as the LLM fallback drafter

### S1.4 Faire Direct invites — CLOSED LOOP (Phase 1 + 2 + 3)
- **Trigger (write):** Operator POSTs candidate rows to `POST /api/ops/faire/direct-invites`. Each row passes through `validateInvite()`. Valid rows are queued at `faire:invites:<id>` with `status="needs_review"`. Invalid rows go to `errors[]` with stable codes (`validation_failed`, `duplicate`).
- **Trigger (read):** Operator opens `/ops/faire-direct` (auth-gated by `/ops/*` middleware) → `GET /api/ops/faire/direct-invites` → renders invites grouped by status + a degraded banner when `FAIRE_ACCESS_TOKEN` is missing.
- **Source of truth:** KV (`faire:invites:<id>` + `:index`). Dedup key = lowercased email.
- **Hard rules locked by tests:**
  - **No email is sent. No Faire API call is made.** The module imports nothing from Gmail / Slack / faire-client beyond the read-only `isFaireConfigured()` flag. KV is the only mocked side effect in the test suite — any other network call would crash uninstrumented.
  - Validation: `retailerName` + `email` (valid format) + `source` are required. Optional fields trimmed and dropped if blank.
  - Duplicates (within batch + across queue) flagged as `duplicate`, not double-added.
  - Missing `FAIRE_ACCESS_TOKEN` → `degraded: true` with reason on `GET`. Queue ingest still works.
- **Approval class:** Class B `faire-direct.invite` per `/contracts/approval-taxonomy.md` and `/contracts/agents/faire-specialist.md`. Phase 1 builds the queue; Phase 2 will wire the Slack approve click → real Faire send (or manual hand-off if Faire's API doesn't expose invite send).
- **Status response:** 201 on all-valid, 207 Multi-Status on mixed, 200 on all-errors, 400 on missing/non-array body or invalid JSON.
- **Tests (Phase 1):** 23 helpers + 12 route = 35 total. Locked: validation rules (required fields, email shape, optional trims), in-batch + cross-batch dedup, status grouping, degraded-mode signal, no-sends-happen invariant.

#### Phase 2 — review actions (`PATCH /api/ops/faire/direct-invites/[id]`, NEW)
- **Trigger:** Operator opens `/ops/faire-direct`, picks an invite row, changes the status dropdown (`needs_review` / `approved` / `rejected` — `sent` is intentionally absent) and/or types a review note, optionally edits candidate fields, clicks **Save review**. The client `PATCH`es the id-specific endpoint.
- **Body:** `{ status?, reviewNote?, fieldCorrections?, reviewedBy? }`. Field corrections cover any of `retailerName / buyerName / email / city / state / source / notes / hubspotContactId`.
- **Validation:** every accepted change re-runs through `validateInvite()` AFTER the merge. A botched correction (blank `name`, malformed `email`, missing `source`) rejects the whole patch with HTTP 422 + stable `code: "validation_failed"`. Original record stays intact. Status enum enforced. Empty patches → 400 `code: "no_changes"`.
- **Audit fields:** every accepted update stamps `updatedAt` + `reviewedAt` and optionally `reviewedBy` (operator email/username). UI surfaces "Last reviewed at <ts> by <whom>" next to each row.
- **Hard rules locked by tests:**
  - **`status="sent"` is rejected with HTTP 422 + stable code `sent_status_forbidden`.** Sent transitions only happen inside the future Class B `faire-direct.invite` send closer.
  - **No email / Faire / Gmail / Slack network call.** Mocked KV is the only side effect — any other network call would crash uninstrumented in tests. Locked by an exact write-count assertion (one KV write per accepted update).
  - **Missing `FAIRE_ACCESS_TOKEN` does not block review.** The token gates the future send path, not the review queue.
  - **Id is immutable.** A corrected email rewrites the candidate fields but keeps the same KV key. Tests assert that a corrected email collision against another existing record returns HTTP 409 `code: "duplicate_email"`.
- **Status code mapping:** 200 ok / 400 no_changes or invalid JSON / 401 unauth / 404 not_found / 409 duplicate_email / 422 invalid_status | sent_status_forbidden | validation_failed.
- **Tests (Phase 2):** 15 helper tests + 18 route tests = 33 total on top of Phase 1 (cumulative: 68 tests across the Faire Direct module + routes).
- **UI:** `/ops/faire-direct` page now renders each candidate as a card with status dropdown + review-note textarea + **Save review** button. Section header copy: *"Approved means ready for a future Class B send approval, not sent."* Sent records render a read-only "terminal status" cue with no editable status dropdown.

#### Phase 3 — send-on-approve closer (CLOSED LOOP, NEW)
- **Trigger:** Operator approves a row + pastes the brand-portal Faire Direct URL into the row's `directLinkUrl` field. Operator clicks **Request send approval** on `/ops/faire-direct` → `POST /api/ops/faire/direct-invites/[id]/request-approval` opens a Class B `faire-direct.invite` approval, surfaces the card to `#ops-approvals` via `openApproval(approvalStore(), approvalSurface(), …)`. Ben's approve click in Slack hits `/api/slack/approvals`, which calls `executeApprovedFaireDirectInvite()` (chain step 5, after vendor-master + ap-packet).
- **Send mechanics:** the closer sends a single plain-text Gmail message via `sendViaGmailApiDetailed` to the retailer's email. Subject is locked at `"USA Gummies on Faire Direct"`. Body contains a personalized greeting, a one-paragraph pitch (no medical / supplement / vitamin / cure / FDA / heal claims — all locked by tests), and the operator-pasted `directLinkUrl` verbatim. **The Faire API is never called.** Closing carries operator contact only — no recipient PII echo, no internal ids, no HubSpot ids.
- **Approval-readiness rule:** The PATCH route refuses any `status="approved"` transition unless the merged candidate carries a valid `http(s)` `directLinkUrl`. A correction supplied in the same patch (`{ status: "approved", fieldCorrections: { directLinkUrl: "https://faire.com/…" } }`) satisfies the rule. Eligibility is then re-checked at `request-approval` time AND again inside the closer at send time — a row that drifted to `needs_review` between the approval card and the Slack click never sends.
- **KV transition:** On Gmail-send success, `markFaireInviteSent()` flips the row to `status="sent"` in a single KV write, stamping `sentAt`, `sentBy`, `gmailMessageId`, `gmailThreadId`, `hubspotEmailLogId`, and `sentApprovalId`. The review route can never produce this transition (locked by `sent_status_forbidden`).
- **HubSpot mirror:** `logEmail({ subject, body, direction: "EMAIL", to, contactId })` is best-effort. A HubSpot failure does NOT block the success path — the closer captures `hubspotEmailLogId: null` and continues. KV still flips to `sent`. (Locked by tests.)
- **Idempotency:** A re-fire on the same approval id (Slack double-click, retry) detects `record.status === "sent" && record.sentApprovalId === approval.id` and short-circuits with `alreadySent=true`. Gmail is NOT called twice. The original `sentAt` and message id are preserved. (Locked.)
- **Failure paths:** Gmail send failure → `ok=false`, KV NOT flipped to `"sent"`, audit recorded as error, Slack thread reply explains the failure. Operator must fix and re-approve. Network throw is caught and reported. (Locked.)
- **Hard rules locked by tests:**
  - Closer NEVER calls Faire's API (no import from `faire-client` in the closer or the Gmail-send path).
  - Closer NEVER sends to a recipient other than `record.email`.
  - Body contains the directLinkUrl verbatim.
  - Subject is exactly `"USA Gummies on Faire Direct"`.
  - Strict gating: `targetEntity.type === "faire-invite"` + `payloadRef === "faire-invite:<id>"` are both required. Cross-fire with email-reply / shipment.create / vendor-master / ap-packet closers is impossible.
- **Approval class:** Class B `faire-direct.invite` per `/contracts/approval-taxonomy.md` — Ben single-approver, irreversible. Rollback plan: Gmail undo-send window (~30s), then manual correction email.
- **Tests (Phase 3):** 21 invite-helper additions (URL validator + approval readiness + `markFaireInviteSent` idempotency) + 5 PATCH route additions + 8 request-approval route + 18 closer unit tests = **52 new tests**. Cumulative across S1.4: **141 tests**, all green; full suite: **834 tests** green.
- **UI:** `/ops/faire-direct` row now exposes (a) a `directLinkUrl` URL input editable as a field correction, (b) a clickable read-only chip when the link is persisted, (c) a **Request send approval** button on approved+eligible rows that opens the Slack card via the API, (d) a sent-metadata banner showing `sentAt` + `gmailMessageId` for terminal rows. The button is disabled with an inline reason when the row isn't eligible (status not approved, link missing, dirty pending changes).
- **Monday MVP:** 🟢 — full closed-loop. Operator pastes link → approves → clicks Request send approval → Ben clicks Slack → Gmail goes out → KV flips to sent.

- **Required env:** `GMAIL_OAUTH_*` + `SLACK_SIGNING_SECRET` (for the slack approve click) + `CRON_SECRET` (for closer audits). `FAIRE_ACCESS_TOKEN` is NOT required by Phase 3 — the closer never calls Faire's API. The token is still surfaced as a degraded banner in case any future read-only Faire API integration lands.

#### Phase 3.1 — HubSpot contact-id fallback by email lookup (NEW)
- **Trigger:** Side-effect of the Phase 3 send closer's HubSpot mirror block. When `record.hubspotContactId` is missing or empty, the closer now resolves the contact via `findContactByEmail(record.email)` before calling `logEmail`.
- **Module:** `src/lib/faire/hubspot-mirror.ts` exposes `resolveHubSpotContactIdForInvite()` + `…ForInviteRecord()` overloads. Read-only by contract — never creates a contact, never patches `lifecyclestage`, deals, custom properties, or tasks. Mirrors the existing `email-intelligence/approval-executor` pattern.
- **Hard rules:** Skips the network call entirely when `HUBSPOT_PRIVATE_APP_TOKEN` is unset. Fail-soft on HubSpot 5xx / throw — the closer's success path still completes and the email engagement lands in HubSpot's global activity feed (just unassociated). Tests assert this fallback never blocks a Gmail success path.
- **Tests (Phase 3.1):** 10 helper unit + 4 closer fallback path = **14 new tests**. Cumulative across S1.4: **155 tests**, all green; full suite: **848 tests** green at commit `d08e4d5`.

#### Phase 3.2 — Read-only follow-up queue (NEW)
- **Trigger (read):** Operator opens `/ops/faire-direct` → the new `<FollowUpSection>` fetches `GET /api/ops/faire/direct-invites/follow-ups` independently → renders an *Overdue* / *Due soon* breakdown above the existing invite tables. The route is read-only — no KV writes, no Gmail/Faire/HubSpot/Slack network call. (Test asserts an exact zero-write count after seeding.)
- **Eligibility rules locked by tests:**
  - `status="sent"` AND `sentAt` ≥ 7 days ago AND no `followUpQueuedAt` → `bucket="overdue"`, `code="overdue"`.
  - `status="sent"` AND `sentAt` ≥ 3 days ago (but < 7) AND no `followUpQueuedAt` → `bucket="due_soon"`, `code="due_soon"`.
  - `status="sent"` AND `sentAt` < 3 days ago → `bucket="not_due"`, `code="fresh"`.
  - `status="sent"` with `followUpQueuedAt` set → `bucket="not_due"`, `code="follow_up_queued"` (does NOT re-surface).
  - `status="sent"` with no/unparseable `sentAt` → `bucket="not_due"`, `code="missing_sent_at"` (data-integrity gap, not actionable).
  - Any non-sent record → `bucket="not_due"`, `code="wrong_status"`.
- **Sort:** Overdue + due_soon are sorted most-stale first (largest `daysSinceSent` first) so the operator's eye lands on the most-overdue row at the top.
- **Suggested-action copy:** A scrubbed string per actionable row, computed by `suggestNextActionCopy()`. Locked by tests to never promise pricing, lead times, or product effects, and to remind the operator to keep follow-up free of those claims.
- **Forward-compat type field:** `FaireInviteRecord` gains `followUpQueuedAt?: string`. **No writer ships in Phase 3.2** — the field is the queue's "this is handled" marker. A future Class B `faire-direct.follow-up` send closer will be the only path allowed to stamp it.
- **Hard rules locked by tests:**
  - Helpers are pure: no fetch, no KV, no Gmail/Faire/HubSpot/Slack import (the test suite mocks ONLY `@vercel/kv`, and only for the route-level test that has to seed records).
  - Route never calls `kv.set` (test asserts call count delta = 0 after seeding).
  - UI has no Send / Approve / Action buttons — observation only.
- **Approval class:** None. Phase 3.2 ships zero new approvals. The future follow-up send closer will be Class B.
- **Tests (Phase 3.2):** 19 helper unit (`classifyForFollowUp`, `reportFollowUps`, `selectFollowUpsNeedingAction`, `suggestNextActionCopy`, plus boundary/edge-case coverage) + 8 route integration = **27 new tests**. Cumulative across S1.4: **182 tests**, all green; full suite: **875 tests** green.
- **UI:** `/ops/faire-direct` page now renders the *Follow-up queue* section between the totals strip and the existing per-status invite tables. Each actionable card shows retailer + buyer + email + days-since-sent + sent-at timestamp + Gmail message id + HubSpot contact id (when present) + the suggested next-action copy. Two empty states are explicit: "no overdue follow-ups" / "no follow-ups due soon".
- **Monday MVP:** 🟢 — Ben can spot which sent invites need a manual reply on the original Gmail thread without leaving the dashboard. Phase 3.3 closes the loop with approval-gated send.

#### Phase 3.3 — Follow-up draft-for-approval close-loop (NEW)
- **Trigger:** Operator clicks **Request follow-up approval** on an actionable row in the `<FollowUpSection>` of `/ops/faire-direct`. The button POSTs to `/api/ops/faire/direct-invites/[id]/follow-up/request-approval`, which opens a Class B `faire-direct.follow-up` approval card in `#ops-approvals`. Ben's click in Slack drives `executeApprovedFaireDirectFollowUp` (chain step 6 in `/api/slack/approvals`, after the initial-invite closer).
- **Send mechanics:** `sendViaGmailApiDetailed` with reply-on-thread when the original `gmailThreadId` is on the record — the follow-up lands in the same Gmail conversation as the initial invite. Subject is locked at `"Quick check-in — USA Gummies on Faire Direct"`. Body is a one-paragraph nudge plus the same `directLinkUrl` from the initial invite. **Faire's API is never called.**
- **Body invariants locked by tests:**
  - No medical / supplement / vitamin / immune / FDA / cure / treat / heal / "health benefit" claims.
  - No pricing / commission / margin / lead-time / payment-terms / MOQ / "free shipping" promises.
  - No personal cell phone, no SMS / WhatsApp / "text me" invitations — operator-only contact (`ben@usagummies.com`).
  - No echo of recipient PII (HubSpot id, internal id, recipient email inside body copy).
  - Body length under 1500 characters (it's a nudge, not a re-pitch).
- **Eligibility gates (re-checked at request AND send time):**
  - `status === "sent"` and `sentAt` parseable.
  - `classifyForFollowUp` bucket is `due_soon` or `overdue`.
  - `followUpQueuedAt` is unset OR matches the in-flight approval id (idempotent re-fire).
  - `followUpSentAt` is unset (no second follow-up from this surface — the future would be a re-engagement workflow, not 3.3).
- **KV transitions (only writers allowed to touch followUp\* fields):**
  - `markFaireFollowUpQueued` — called by request-approval route after `openApproval` succeeds. Stamps `followUpQueuedAt` + `followUpRequestApprovalId`.
  - `markFaireFollowUpSent` — called by closer after a successful Gmail send. Stamps `followUpSentAt`, `followUpSentBy`, `followUpGmailMessageId`, `followUpGmailThreadId`, `followUpHubspotEmailLogId`, `followUpSentApprovalId`. **Status STAYS at `"sent"`** — follow-up never moves the invite lifecycle.
- **HubSpot mirror:** uses the same `resolveHubSpotContactIdForInviteRecord` helper as the initial invite (operator-pasted id wins; falls back to email lookup). `logEmail` is best-effort — a HubSpot failure does NOT roll back the Gmail send (locked by tests). **No HubSpot lifecyclestage / custom property / deal / task writes.**
- **Failure modes (locked):**
  - Gmail send failure → `ok=false`, `followUpSentAt` NOT stamped, audit error, Slack thread reply explains. `followUpQueuedAt` stays set so duplicate approvals can't be opened; operator clears manually for retry (out-of-scope future patch).
  - HubSpot logEmail throw → KV still flips, `followUpHubspotEmailLogId: null`.
  - Approval rejected in Slack → no closer fires, no Gmail send. `followUpQueuedAt` stays set; same manual-clear caveat.
  - Idempotency: repeat Slack click on the same approval id short-circuits with `alreadySent=true` and does NOT re-send Gmail.
- **Strict cross-fire gate:** chain step 6 in `/api/slack/approvals` is only invoked when `targetEntity.type === "faire-follow-up"` — distinct from the initial invite's `"faire-invite"` type. Tests assert non-faire-follow-up approvals (faire-invite, ap-packet, vendor-master, email-reply) never trigger this closer.
- **Approval class:** Class B `faire-direct.follow-up` (NEW taxonomy slug in `src/lib/ops/control-plane/taxonomy.ts`). Ben single-approver, irreversible.
- **Tests (Phase 3.3):** 8 template + 12 invite-writer (markFaireFollowUpQueued + markFaireFollowUpSent idempotency / wrong-status / refusal paths) + 10 request-approval route + 15 closer = **45 new tests**. Cumulative across S1.4: **227 tests**, all green; full suite: **920 tests** green.
- **UI:** Each `<FollowUpCard>` now exposes a **Request follow-up approval** button (gold pill) plus inline state badges:
  - "Follow-up sent {ts} by {operator} · Gmail \`{messageId}\`" (green) when `followUpSentAt` is set.
  - "Follow-up approval queued {ts} · approval id {…}. Waiting on Ben's click in #ops-approvals" (amber) when only `followUpQueuedAt` is set.
  - Button disables itself when queued / sent / requesting; surfaces inline errors on 4xx/5xx from the route.
- **Monday MVP:** 🟢 — full close-loop. Operator clicks Request follow-up → Slack card → Ben clicks → Gmail goes out on the original thread → KV stamps followUpSentAt → queue stops re-prompting.

### S1.6 Sales Command Center — read-only revenue-action roll-up (NEW)
- **Trigger (read):** Operator opens `/ops/sales` → client component calls `GET /api/ops/sales` → server-side aggregator reads each underlying source directly (no HTTP self-fetch) and returns the consolidated `SalesCommandCenterReport` shape.
- **Sources surveyed:**
  - Faire invites (wired via `listInvitesByStatus()`)
  - Faire follow-ups due/overdue (wired via `reportFollowUps(listInvites())`, top-5 most-stale preview)
  - Pending Slack approvals (wired via `approvalStore().listPending()`, bucketed by `targetEntity.type`, oldest-5 preview)
  - AP packets (wired via `listApPackets()` + best-effort KV scan of `ap-packets:sent:*` rows for the sent count)
  - Location drafts (wired via `listDraftsByStatus()`)
  - Wholesale inquiries (**not_wired** — there is no internal list endpoint today; submissions land in `/api/leads` but aren't archived in a queryable store; surfaced honestly with reason in the Blockers panel)
- **Hard rules locked by tests:**
  - **Read-only.** No KV / Gmail / HubSpot / Faire / Slack / QBO / Shopify mutation; no approval opened, no email drafted. The aggregator helper has zero I/O — pure functions, two identical inputs produce identical outputs.
  - **Never invents data.** A `not_wired` source surfaces as `null` in the top-of-page roll-ups (rendered as "—") and as a row in the Blockers panel with the caller's verbatim reason. Empty-but-wired sources surface as `0` (NOT null) so the dashboard distinguishes "wired but quiet" from "no API at all".
  - **Sort order locked.** Follow-up `topActionable` preserves the caller-supplied most-stale-first order from `reportFollowUps`; aggregator slices to the top 5 without re-sorting. Pending-approvals preview is sorted oldest-`createdAt` first.
  - **Each source independently wrapped.** A single source failure in the route handler converts to `{ status: "error" }` and lands in the Blockers panel; the rest of the dashboard still renders.
- **Sections rendered:**
  1. *Today's revenue actions* — five stat cards (Faire invites awaiting review, follow-ups due/overdue, Slack approvals pending, AP packets action-required, retail drafts to review). Cards link to their respective workflow pages. A `Nothing demands action right now` green note appears when every wired count is zero.
  2. *Faire Direct* — invite counts by status with a "Open Faire Direct queue" deep-link.
  3. *Follow-ups awaiting Ben* — overdue / due_soon / sent-total counts plus top-5 most-stale rows (retailer, email, days-since-sent, bucket badge).
  4. *Wholesale / B2B onboarding* — wholesale inquiry status (currently `not_wired`) + AP packet status.
  5. *Retail proof / store locator pipeline* — draft counts + `/ops/locations` link.
  6. *Slack approvals awaiting Ben* — total pending + oldest-5 preview rows with `targetEntity.type`, action slug, and `createdAt`.
  7. *Blockers / missing envs* — collected `not_wired`/`error` notes plus any unset env vars from a curated short list (`FAIRE_ACCESS_TOKEN`, `HUBSPOT_PRIVATE_APP_TOKEN`); links to `/ops/readiness`.
- **Approval class:** None. Phase 1 ships zero new approvals — the dashboard has no Send/Approve/Action buttons by contract.
- **Tests (Phase 1):** 16 aggregator-helper tests covering: not_wired surfaces as null in roll-ups, empty-but-wired surfaces as 0, exact-count propagation (no inflation), `anyAction` true iff a wired count > 0, follow-up sort preservation, top-5 slice, blockers panel collection, missingEnv passthrough, defaults, purity (same input → same output). No route or page tests in Phase 1 — the aggregator is the contract surface; the route is a thin reader.
- **UI:** `/ops/sales` page server component → `<SalesCommandCenterView>` client component → fetches the route once, renders six sections + a refresh button. Stat cards are clickable when they carry a deep-link. `not_wired` sources render with an explicit "NOT WIRED" amber badge + the reason verbatim.
- **Monday MVP:** 🟢 — Ben gets one read-only browser surface for the day's revenue actions without leaving the storefront repo. Phase 2 (deferred): wire wholesale inquiry archive + add a "Slack permalink" deep-link helper to the awaiting-Ben section.

#### Phase 2 — Sales Command in the morning Slack brief (NEW)
- **Trigger:** Existing morning daily-brief cron (Vercel cron + Make.com scenario) → `POST /api/ops/daily-brief?kind=morning` → composer renders one extra section in `#ops-daily`. EOD wraps skip the section to avoid duplicating the cumulative dashboard.
- **Why this lives in the existing brief, not a separate digest:** Slack is already the command surface. A second daily post would compete with the existing executive brief for Ben's attention. The new section is *one block, ≤12 lines* slotted between the Shipping Hub pre-flight and the pending-approvals breakdown.
- **Architecture:**
  - Source readers extracted to `src/lib/ops/sales-command-readers.ts` (`readFaireInvites`, `readFaireFollowUps`, `readPendingApprovals`, `readApPackets`, `readLocationDrafts`, `readWholesaleInquiries`). Both `/api/ops/sales` and `/api/ops/daily-brief` consume the same readers — no parallel implementations.
  - Pure projection: `composeSalesCommandSlice(input)` in `src/lib/ops/sales-command-center.ts` turns the dashboard input into a tight `SalesCommandSlice` (10 numeric counts + `anyAction` boolean).
  - Renderer: `renderSalesCommandMarkdown(slice)` in `src/lib/ops/control-plane/daily-brief.ts` produces Slack mrkdwn. Locked-by-tests bounded length and empty-state collapse.
- **Hard rules locked by 12 new tests:**
  - **Read-only.** No KV / Gmail / HubSpot / Faire / Slack / QBO / Shopify mutation. The only Slack write is the existing brief post — same surface that already runs.
  - Section appears on `kind="morning"` only; EOD brief explicitly skips it (test-locked).
  - Empty-state → single quiet line: `*Sales Command*` + `_No sales actions queued._` + footer with deep links. No per-source bullets when nothing's actionable.
  - `null` numerics render as `_not wired_`, NEVER as `*0*`. Zero is a real wired-but-quiet count and earns its own line; null means missing source.
  - Wholesale inquiries always renders honestly (currently `_not wired_` because no list endpoint exists). Locked so future wired→quiet flips don't accidentally erase the line.
  - Section bounded under 12 lines (header + ≤6 body lines + footer). Test asserts the worst case.
  - `anyAction` does NOT trip on a wholesale-inquiries-only positive count — that's contextual data, not an action item. Locked so a future not_wired→wired flip on inquiries doesn't noisify the morning brief.
- **Deep links in footer line:** `<https://www.usagummies.com/ops/sales|/ops/sales>`, `<…/ops/faire-direct|Faire Direct>`, `<…/ops/ap-packets|AP packets>`, `<…/ops/locations|Store locator>`.
- **Failure isolation:** the section build is wrapped in try/catch. A reader failure is logged into the existing `degradations[]` (`sales-command: <reason>`) and the section is silently omitted; the rest of the brief renders normally.
- **Tests (Phase 2):** 6 projection tests on `composeSalesCommandSlice` (all not_wired → all null + anyAction false; empty-but-wired → 0 + anyAction false; actionable trip; wholesale-only does NOT trip anyAction; exact propagation; error-state → null) + 6 renderer tests on the morning brief integration (slice present → section appears; EOD skips; empty-state collapse; not_wired rows render correctly with no fabricated zeros; bounded line count; absent slice renders nothing) = **12 new tests**. Full suite: 948 green (was 936).
- **Monday MVP:** 🟢 — Ben sees the day's sales actions in the existing 7 AM PT post in `#ops-daily` without subscribing to a new feed. The dashboard at `/ops/sales` remains the cumulative view; the brief is a daily nudge.

#### Phase 3 — Aging / SLA escalation (NEW)
- **Why:** A queue can be small but stale. Phase 1 + 2 surfaced *counts* of actionable rows; Phase 3 surfaces *which* rows have crossed an SLA threshold, before they drift unnoticed.
- **Architecture:**
  - Pure helpers in `src/lib/ops/sales-aging.ts` — `ageHours`, `ageDays`, `ageDaysFloor`, `classifyAge`, `classifyAgingInput`, `sortAging`, `selectTopAging`, `composeAgingBriefCallouts`, `renderAgingCalloutText`, `formatAgeShort`. Read-only by contract; no I/O.
  - Threshold registry locked in `AGING_THRESHOLDS`:
    - `approval` → watch ≥4h, overdue ≥24h, critical ≥48h
    - `faire-followup` → watch ≥3d, overdue ≥7d, critical ≥14d (matches the existing `reportFollowUps` boundaries)
    - `location-draft` → watch ≥7d, overdue ≥14d, critical ≥21d
    - `receipt` → watch ≥2d, overdue ≥7d, critical ≥14d
    - `ap-packet` is intentionally absent — today's AP-packet schema has no `readyAt` timestamp, so they surface in the **missing-timestamp panel** (see honesty rule below) rather than getting a fabricated age.
  - Source readers in `src/lib/ops/sales-command-readers.ts`: `readApprovalAgingItems`, `readFaireFollowUpAgingItems`, `readApPacketAgingItems`, `readLocationDraftAgingItems`, `readReceiptAgingItems`, `readAllAgingItems`. Each reader projects its source rows into either an `AgingItem` (when the anchor parses) or a `MissingTimestampItem` (when it doesn't). Failures are isolated — a thrown error returns `{ items: [], missing: [] }` instead of poisoning the shared stream.
  - `SalesCommandCenterReport.aging` (new section): `topItems` (default top-10 actionable, oldest critical first), `counts` (per-tier including fresh + total), `missingTimestamps`, deep-link to `/ops/sales`.
  - Morning brief slice gains `agingCallouts: AgingCallout[]` — capped at 3 by `composeAgingBriefCallouts`; renderer adds an `*Aging:*` block before the deep-link footer.
- **Hard rules locked by 38 new tests:**
  - **Read-only.** No KV / Gmail / HubSpot / Faire / Slack / QBO / Shopify / Drive mutation. Helpers are pure; readers wrap reads in try/catch.
  - **Never fabricates an age** when the source has no usable anchor. Missing / unparseable / future-dated timestamps return `MissingTimestampItem` with the raw value surfaced in the reason — never a synthetic `0` or `now`.
  - **Sort order is locked**: critical → overdue → watch → fresh, oldest-first within each tier. Stable on equal keys.
  - **`selectTopAging` excludes fresh by default** — the panel surfaces things drifting past SLA, not fresh rows. Callers who want fresh pass `{ includeFresh: true }`.
  - **Brief callouts capped at 3** by default. The renderer's bounded-line test allows up to 15 lines for the worst case (full body + 5 hand-built callouts) — defensive bound for callers who bypass the slice composer.
  - **No double-counting**: follow-up rows that already had `followUpSentAt` written are excluded from the aging stream — they're not actionable anymore.
  - **`anyAction` trips on aging-only signal**: a single watch/overdue/critical row makes the morning section render even when every per-source count is 0. A pure-fresh stream does NOT trip `anyAction` (locked).
  - AP packets surface in the missing-timestamp panel honestly with a reason that names the schema gap (`AP packet config has no readyAt timestamp`). The dashboard renders this as a separate sub-list under the aging section.
- **Tests (Phase 3):** 30 in `src/lib/ops/__tests__/sales-aging.test.ts` (date math, threshold boundaries, missing-timestamp paths, sort, top-N, callout cap, format, no-mutation invariants) + 8 in `sales-command-center.test.ts` (counts/topItems/missingTimestamps assembly, slice callout cap, anyAction trip) + 3 in `daily-brief.test.ts` (callouts render between body and footer; empty-callouts → no aging block; bounded line count even on hand-built 5-callout slice). Full suite: 990 green (was 948).
- **UI:** Dashboard adds an "Aging / SLA" section between "Slack approvals awaiting Ben" and "Blockers" with per-tier counts (color-coded: critical red, overdue amber, watch navy, fresh dim) + the top-10 list + a "Timestamp missing" sub-panel for AP packets. Each row is one line: tier badge · label · age (Nh under 48h, Nd otherwise).
- **Monday MVP:** 🟢 — Ben can see at a glance which sales-action rows have been sitting too long. The morning brief surfaces the top-3 most-urgent across all queues; the dashboard shows the full top-10 + every missing-timestamp row.

#### Phase 4 — Weekly Revenue KPI Scorecard (NEW)
- **Why:** Phases 1–3 surfaced *what to work on*. Phase 4 surfaces *whether the work is moving the number that actually matters* — the operational completion standard: **$1,000,000 in revenue by Dec 24, 2026 (end of day Pacific)**.
- **Architecture:**
  - Pure helpers in `src/lib/ops/revenue-kpi.ts` — `KPI_TARGET_USD` (1,000,000), `KPI_TARGET_DEADLINE_ISO` (`2026-12-24T23:59:59-08:00`), `daysRemaining`, `requiredDailyPaceUsd`, `requiredWeeklyPaceUsd`, `composeRevenueKpi`, `formatUsdCompact`, `renderRevenueKpiBriefLine`. Pure → no I/O.
  - Read-only readers in `src/lib/ops/revenue-kpi-readers.ts`: `readShopifyLast7d`, `readAmazonLast7d` (with a 6s timeout race against SP-API's 5s/page rate limit), `readFaireLast7d`, `readB2BLast7d` (always `not_wired` — QBO/HubSpot revenue join not yet wired), `readUnknownChannelLast7d` (permanent placeholder), `readAllChannelsLast7d` (parallel aggregator). Each reader returns a `ChannelRevenueState` with `wired | not_wired | error` status + reason; on env-missing or timeout the channel is honestly marked, never silently zeroed.
  - `SalesCommandCenterReport.kpiScorecard` (new section): target + deadline, days remaining, required daily/weekly pace, actual last-7d, gap to weekly pace, per-channel statuses, confidence rubric.
  - Morning brief slice gains `revenueKpi: RevenueKpiSlice` — one-line summary rendered before the deep-link footer (or in the empty-state quiet copy when no actions are queued).
- **Hard rules locked by 40 new tests:**
  - **Read-only.** No KV / Gmail / HubSpot / Faire / Slack / QBO / Shopify / Drive mutation. Every reader awaits a query helper that already exists in the repo.
  - **Never fabricates revenue.** A `not_wired` or `error` channel contributes ZERO to `actualLast7dUsd` AND its absence is surfaced via `confidence` + per-channel `reason`. `actualLast7dUsd` itself is `null` (not 0) when no channel is wired — locked separately so the gap renders as `—` rather than `-$43.5K behind`.
  - **Brief one-liner never invents a number** — when `actualLast7dUsd` is null the renderer falls back to the verbatim "Revenue pace not fully wired." copy. Tests assert no `$` character ever appears in that fallback.
  - **Date math is locked.** Deadline = `2026-12-24T23:59:59-08:00` (PST; no DST in late December). `daysRemaining` floors at 0 (the deadline can pass; we render "0 days remaining" rather than negative). Partial days round up.
  - **Confidence rubric** — full when all three primary online channels (Shopify+Amazon+Faire) are wired; partial when ≥1 wired and ≥1 not; none when zero wired. B2B and Unknown intentionally don't move the rubric — they're known gaps that are always not_wired.
  - **Defensive numerics** — a "wired" channel that regresses to NaN/Infinity gets dropped from the sum (no contamination), but its row is still surfaced in the dashboard.
  - **Bounded latency** — Amazon SP-API call races against a 6s timeout so a slow upstream never blocks the dashboard. On timeout the channel is marked `error` (truthful), not silently zero.
- **Tests (Phase 4):** 30 in `src/lib/ops/__tests__/revenue-kpi.test.ts` (constants, date math, pace identity, confidence rubric, no-fabrication paths, brief renderer fallback + suffixes, defensive NaN handling, immutability) + 7 in `sales-command-center.test.ts` (kpiScorecard attachment, default null actual, daysRemaining via options.now, channel propagation, slice fallback copy, slice compact line, slice no-$ when not wired) + 3 in `daily-brief.test.ts` (KPI line on actionable day, "not fully wired" path, KPI line surfaces in empty-state quiet copy). Full suite: 1030 green (was 990).
- **UI:** Dashboard adds a "Weekly KPI Scorecard" section between "Slack approvals awaiting Ben" and "Aging / SLA". Six tiles (target, days remaining, required/wk, actual last 7d, gap, confidence) + per-channel source list with status badges (`wired` green, `not wired` amber, `error` red). When `actualLast7dUsd` is null, an explicit amber banner says "No revenue source wired — actual last 7d cannot be computed."
- **Monday MVP:** 🟢 — Ben sees the $1M-by-Dec-24 pace every morning. When the pace is honestly computable he gets the gap; when sources aren't wired he sees the gap is unknown and which channel has to come online.

#### Phase 5 — B2B revenue wiring (audit + Phase 1 source) (NEW)
- **Why:** Phase 4 left B2B as `not_wired` honestly. This phase audits every candidate revenue source and wires the safest one without corrupting QBO or HubSpot.
- **Audit findings (no source wired blindly):**
  - **QBO Invoices / SalesReceipts (`getQBOInvoices`, `getQBOSalesReceipts`)** — *UNSAFE.* QBO was reset on 2026-03-29 and Rene is still rebuilding the chart of accounts. There's no Class tracking enabled and no `CustomField` for channel attribution. Booth orders write a QBO Invoice AND a paid Shopify order; counting both inflates revenue. Draft-vs-sent distinction relies on `EmailStatus` which is unreliable (many invoices are mailed via PDF/print). Verdict: **defer until Class or CustomField channel attribution lands in QBO.**
  - **HubSpot Closed-Won deals (`getWholesaleRevenue` in `src/lib/finance/pnl.ts`)** — *UNSAFE per blueprint non-negotiable.* That helper reads `pipeline-cache → "Closed Won" → dealValue`. Closed-Won is a CRM stage, NOT a payment confirmation; deal values include unsigned LOIs and forecasted amounts. The KPI reader explicitly forbids importing this — locked by a static-source test that asserts the readers module never imports HubSpot helpers or `getWholesaleRevenue`.
  - **Shopify wholesale-tagged paid orders** — *SAFE for Phase 1.* The `/api/booth-order` route applies `tag:wholesale` to every wholesale order it creates (pay-now and invoice-me). Shopify GraphQL search supports both `tag:value` and `-tag:value`. `financial_status:paid` excludes drafts and on-hold invoice-me orders naturally. Verdict: **wire as Phase 1 B2B source**, with the no-double-count contract that Shopify-DTC must exclude the same tag.
  - **Booth-order internal queue (order-desk cache)** — defer; only covers the `/booth` flow, not manual wholesale orders created in Shopify Admin.
- **Architecture:**
  - `queryPaidOrdersForBurnRate` (in `src/lib/ops/shopify-admin-actions.ts`) gains an optional `tagFilter: { include?: string[]; exclude?: string[] }` parameter. Backward-compatible — existing callers (`burn-rate-calibration.ts`) pass nothing and get the full set.
  - `B2B_SHOPIFY_TAG = "wholesale"` exported from `revenue-kpi-readers.ts` so both readers reference the same string (no drift).
  - `readShopifyLast7d` now passes `tagFilter: { exclude: [B2B_SHOPIFY_TAG] }` → Shopify channel = DTC only.
  - `readB2BLast7d` (now async) passes `tagFilter: { include: [B2B_SHOPIFY_TAG] }` → B2B = wholesale-tagged paid orders only. Returns `wired` with the actual sum + a source attribution string `"shopify-admin-graphql (B2B; tag:wholesale, financial_status:paid)"`.
  - Confidence rubric in `revenue-kpi.ts` updated: B2B joined `PRIMARY_CHANNELS`. The rubric now also uses the *literal* primary set (not "primaries present in the input") — a caller that omits a primary can't claim "full" confidence by silence.
- **Hard rules locked by 15 new tests:**
  - **Read-only.** No KV / Gmail / HubSpot / Faire / Slack / QBO / Shopify-write / Drive mutation. The B2B reader awaits `queryPaidOrdersForBurnRate` only.
  - **No HubSpot pipeline as revenue.** Static-source assertion: the readers module's source file imports nothing from `qbo-client`, `qbo-auth`, `hubspot-client`, `pipeline-cache`, and never references the legacy `getWholesaleRevenue` helper. Locked by a test that reads the file and grep-asserts the absence.
  - **No drafts, no on-hold invoices.** `financial_status:paid` is enforced by the upstream Shopify query helper — drafts and `invoice_me`-on-hold orders are excluded by Shopify's own filter, not by JS post-processing.
  - **No double-count.** Shopify-DTC and B2B share the same tag string but in opposite directions (one excludes, one includes). The drift-guard test pulls both filter args and asserts they reference `B2B_SHOPIFY_TAG`. A Shopify wholesale paid order can land in B2B *or* in Shopify-DTC, never in both.
  - **Errors don't become 0.** Mock the upstream to reject; the reader returns `{status:"error", amountUsd: null, reason}`. Tested for both `Error` throws and non-`Error` (string) throws.
  - **Token gating.** `SHOPIFY_ADMIN_API_TOKEN` unset (or whitespace-only) → `not_wired` with reason. Tested.
  - **Defensive numerics.** A row with `NaN` or `Infinity` `totalAmount` is dropped from the sum, not surfaced as the running total.
  - **Date filter belt-and-braces.** Even when Shopify's date filter is loose, the reader re-filters by JS `Date.parse(o.createdAt) >= cutoff`.
- **Known Phase 1 gap (documented, not papered over):** Wholesale orders created in Shopify Admin without `tag:wholesale` will be miscounted into Shopify-DTC. Phase 2 will add either a QBO Class-attribution path or a Shopify customer-tag fallback once the QBO chart-of-accounts rebuild settles.
- **Tests (Phase 5):** 13 in `src/lib/ops/__tests__/revenue-kpi-readers-b2b.test.ts` (token gating including whitespace-only, tagFilter pass-through, sum correctness, empty-window wired:0, JS-side date-filter belt, NaN drop, error path with Error and non-Error throws, disjoint contract with Shopify-DTC, drift-guard on tag string, static-source no-QBO-no-HubSpot assertion) + 2 in `revenue-kpi.test.ts` (rubric: 4/4 primary wired = full; B2B-only = partial; "unknown" alone never moves the needle). Full suite: 1045 green (was 1030).
- **UI:** Existing `KpiScorecardSection` renders the new B2B status automatically — channel list now shows `B2B (wholesale)` as `WIRED` (green) when the Shopify Admin token is present, with the source attribution string visible. Confidence rubric tile updates from "partial" to "full" when all four primary channels return wired.
- **Monday MVP:** 🟢 — B2B revenue is honest. Defensible Phase 1 source live, no pipeline-as-revenue, no draft-as-revenue, Shopify-DTC and B2B disjoint by construction. Phase 2 (QBO Class attribution) is documented as the next step.

#### Phase 6 — Wholesale inquiry archive + internal list API (NEW)
- **Why:** Phase 1 left wholesale inquiries as `not_wired` because there was no internal list endpoint. Submissions to `/api/leads` were forwarded to an external webhook + the Notion B2B pipeline, but no queryable archive existed inside the repo. The Sales Command Center couldn't show a real count without inventing one.
- **Architecture:**
  - `src/lib/wholesale/inquiries.ts` — KV-backed durable archive. `appendWholesaleInquiry`, `listWholesaleInquiries`, `getWholesaleInquirySummary`, plus an `__INTERNAL` test-only export for layout assertions.
    - Storage layout: `wholesale:inquiries:index` (capped JSON array of IDs, most-recent first) + `wholesale:inquiry:<id>` (per-record JSON with a 365-day TTL backstop).
    - Index cap: 5,000. Sustains years of organic flow without unbounded growth.
    - Records are minted with `randomUUID()` and a server-side ISO timestamp; empty strings are normalized to undefined so consumers never have to distinguish empty vs missing.
  - `/api/leads` — extended to mirror wholesale submissions into the archive. **Fail-soft contract**: identical to the existing Notion mirror (`.catch(() => {})` so persistence failures never break the public form). The Notion mirror, webhook fan-out, and inquiryUrl token mint are all preserved unchanged.
  - `GET /api/ops/wholesale/inquiries` — auth-gated read-only list endpoint. Returns `{ ok, total, lastSubmittedAt, limit, recent }`. `limit` query param clamped to [1, 500] (default 50) server-side. KV exception → HTTP 500 with reason (NEVER 200 with `total: 0`).
  - `readWholesaleInquiries()` (in `sales-command-readers.ts`) — flipped from sync `not_wired` to async `wired`/`error`. Empty archive → `wired { total: 0 }` (real, source-attested zero). KV exception → `error` with reason. The sales route and the morning daily-brief route both `await` the new async reader in their existing `Promise.all` blocks.
- **Hard rules locked by 30 new tests:**
  - **Public lead form behavior preserved.** Existing `/api/leads/__tests__/route.test.ts` continues to pass (5/5). Wholesale submissions still mint `inquiryUrl`, still call the Notion mirror, still fan out the webhook.
  - **Read-only.** No HubSpot stage/lifecycle writes (locked by static-source assertion on the new route module: imports nothing from `hubspot*` or `qbo*`). No QBO writes. No Shopify product/cart/checkout/pricing changes.
  - **No fabricated zero on outage.** KV exception path returns `error` (not `wired:0`) at every layer — `getWholesaleInquirySummary`, `readWholesaleInquiries`, and the auth-gated route. Locked by tests at all three layers.
  - **Real zero allowed.** An empty-but-reachable archive returns `wired { total: 0 }` — source-attested, not fabricated.
  - **Auth-gated.** The new route returns 401 when `isAuthorized()` rejects; calls `isAuthorized()` once per request (session OR CRON_SECRET). Locked by tests.
  - **Bounded payload.** `limit` clamping is server-side, not just the client's responsibility. `limit=0`, `limit=-5`, `limit=999999` all return safe payloads.
  - **Morning brief stays quiet.** Wholesale inquiries are *context*, not action. The slice composer's `anyAction` calculation deliberately excludes wholesale (locked since Phase 2). Re-asserted by 3 new tests covering wired/zero/error states — none trip `anyAction`.
  - **Boundary defense.** The archive rejects records with neither email nor phone (matches the public route's existing 400 gate). Phone-only records are accepted (matches the public form's "email OR phone" rule).
  - **Dedup.** Re-appending the same id moves the record to the head of the index; never duplicates. Locked by test.
  - **PII discipline.** Records carry only the fields the public form already collects + a server-minted id + a server timestamp. No further enrichment.
- **Tests (Phase 6):** 18 in `src/lib/wholesale/__tests__/inquiries.test.ts` (round-trip, MRU ordering, empty-string normalization, neither-email-nor-phone rejected, phone-only accepted, dedup on id collision, summary on empty archive, summary with records, KV-throw on get, KV-throw with non-Error, listing limit clamping, KV layout sanity for index key + record prefix + cap + TTL) + 9 in `src/app/api/ops/wholesale/inquiries/__tests__/route.test.ts` (401 unauth, isAuthorized called once, 200 empty, 200 with records, MRU ordering in `recent`, limit clamping low/high/negative, 500 on KV throw with reason in body, static-source assertion that the route imports nothing from HubSpot/QBO and exports only GET) + 6 in `src/lib/ops/__tests__/sales-command-readers-wholesale.test.ts` (wired with summary, wired total:0 on empty, error on KV exception, anyAction NOT tripped on positive wholesale count, anyAction NOT tripped on zero, error state surfaces null in slice still doesn't trip anyAction). Full suite: **1075 green** (was 1045).
- **UI:** `/ops/sales` already consumes `report.wholesaleOnboarding.inquiries` via the existing dashboard renderer. With the source flipped from `not_wired` to `wired`, the dashboard tile auto-shows the real count + `lastSubmittedAt` timestamp. No client-side changes required.
- **Monday MVP:** 🟢 — Wholesale inquiry pipeline is no longer a black box. Public form behavior unchanged. Real count visible in `/ops/sales`. Morning brief stays quiet (context, not action). KV outage surfaces as `error` with reason — never as a fake zero.

#### Phase 7 — Receipt OCR extraction (prepare-for-review only) (NEW)
- **Why:** `/ops/finance/review` already aggregates the receipt review queue, but Rene/Ben were doing field-by-field data entry by hand. Phase 7 attaches a *suggestion* to each captured receipt so reviewers see vendor/date/amount/currency/tax/last4/payment hints proposed before they fill in the canonical fields. Promotion remains 100% human — no auto-fill, no QBO write.
- **Architecture:**
  - **Pure extractor** in `src/lib/ops/receipt-ocr.ts`. `extractReceiptFromText(text, {now?})` returns a `ReceiptOcrSuggestion` envelope. Pure function — no I/O, no env reads, no Date.now() (uses `options.now` for determinism). Module-level static-source assertion locks the no-I/O contract.
  - **Storage extension** in `src/lib/ops/docs.ts`. `ReceiptRecord` gains optional `ocr_suggestion?: ReceiptOcrSuggestion`. New helper `attachOcrSuggestion(receiptId, suggestion)` sets it without touching status or canonical review fields.
  - **Auth-gated route** `POST /api/ops/docs/receipt/ocr`. Two body shapes (mutually exclusive — both = 400 ambiguous): `{ receiptId, ocrText }` runs the extractor server-side; `{ receiptId, suggestion }` accepts a pre-extracted envelope (validated via `isReceiptOcrSuggestion` type guard). 404 on unknown id. 401 on auth fail. No GET/PUT/DELETE/PATCH on this route.
  - **Finance Review UI** (`FinanceReviewView.client.tsx`): the existing receipts-needs-review table now renders a non-promoting sub-row labelled `OCR · suggestion` whenever `ocr_suggestion` is present. Confidence badge color-coded; warnings in red with a `⚠`. Footer reads "Suggestion only — review fields above are unchanged." so reviewers can never confuse OCR output with promoted canonical values.
- **Hard rules locked by 57 new tests:**
  - **Pure extractor.** Static-source assertion in `receipt-ocr.test.ts` checks the module imports nothing from `qbo*`, `hubspot*`, `@vercel/kv`, or fetch helpers. Also asserts no `Date.now()` (callers pass `options.now` for determinism).
  - **No fabricated values.** Missing vendor/date/amount/currency each return `null` AND emit a specific warning naming the missing field. Vendor extractor rejects address-shaped lines, "Receipt #"/"Order #"/"Subtotal" lines, and refuses to look beyond the top 5 lines (anti-fabrication bound). Date extractor rejects impossible calendar dates (Feb 30, Apr 31). Amount extractor matches *labelled* totals only (`Total`, `Grand Total`, `Amount Due`, `Balance Due`); a stray `$50` with no label produces null + warning. Currency NEVER silently defaults to USD — `$` alone (no USD/CAD/EUR/GBP/symbol token) → `null` + warning.
  - **Confidence is derived, not free.** `high` requires 4+ wired fields AND zero warnings; `medium` is 2–3 wired or warnings-despite-hits; `low` is 0–1 wired. Locked.
  - **Status preserved on attach.** Receipts in `needs_review` stay in `needs_review` after a suggestion is attached. Locked by route test that re-reads from KV after attach.
  - **Canonical review fields untouched.** Route test snapshots `vendor`/`date`/`amount`/`category`/`payment_method` before attach and asserts they're unchanged after — even when the OCR provided clean values for all of them.
  - **Idempotent attach.** Re-attaching with a new suggestion *replaces* the previous suggestion (no duplicate, no merge). Locked.
  - **Type-safe wire format.** `isReceiptOcrSuggestion` rejects null, non-objects, NaN amounts, unknown confidence values, non-array warnings.
  - **No forbidden imports in route.** Static-source assertion: route imports nothing from `qbo*`, `hubspot*`, `slack-(send|client)`, no `createQBOVendor`/`onboardVendor`/`/api/ops/vendors` references; only POST is exported.
- **Tests (Phase 7):** 45 in `src/lib/ops/__tests__/receipt-ocr.test.ts` covering empty/garbage input, vendor conservatism, every supported date format + impossible-date rejection, labelled-total-only amount, currency-never-defaults, optional tax/last4/paymentHint, confidence rubric, determinism, type guard, and the static-source no-I/O assertion. 12 in `src/app/api/ops/docs/receipt/ocr/__tests__/route.test.ts` covering auth gate, body validation (missing id, missing both, both supplied, malformed envelope, invalid JSON), 404 on unknown id, happy-path attach with status preservation, canonical-fields-untouched, pre-extracted suggestion path, idempotent re-attach, and the route's no-forbidden-imports assertion. Full suite: **1132 green** (was 1075).
- **UI:** `/ops/finance/review` "Receipts needing review" section gains a per-receipt sub-row when `ocr_suggestion` is present. The sub-row shows OCR vendor/date/amount/currency, last4 + paymentHint, tax, a color-coded confidence badge (`high` green, `medium` amber, `low` red), and warnings in red prefixed with `⚠`. Footer disclaimer: "Suggestion only — review fields above are unchanged." No edit/promote button — promotion is by hand-edit on the canonical record.
- **Monday MVP:** 🟢 — Receipt review goes from blank-form-data-entry to suggestion-with-warnings. Reviewer effort drops without any QBO write being auto-triggered, no vendor created, no payment classified beyond the literal hint. The receipt queue stays `needs_review` until a human acts.

#### Phase 8 — Receipt-to-Rene approval promotion (review-packet only) (NEW)
- **Why:** Phase 7 attached an OCR suggestion to each captured receipt. Phase 8 turns a captured receipt + (optional) OCR suggestion into a structured *Rene approval packet draft* that distinguishes canonical (human-edited) fields from OCR-suggested ones. This is the queue-item layer that sits between the receipt capture and a future Class B QBO posting — it does NOT post to QBO and does NOT open a Slack/control-plane approval today.
- **Audit finding (taxonomy gap, surfaced honestly):** the canonical taxonomy at `contracts/approval-taxonomy.md` + `src/lib/ops/control-plane/taxonomy.ts` has no `receipt.review.promote` slug. The closest neighbor is `booke.categorize.edit` (Class B, Rene), which is specifically for the Booke SaaS edit flow — not for receipt promotion. Per the blueprint's fail-closed rule (`UnknownActionError`: "register it in taxonomy.ts before the agent may use it"), the route MUST NOT invent a slug. Phase 8 builds a review-queue item instead and surfaces the missing-slug state in every response so reviewers see why a Slack approval wasn't opened.
- **Architecture:**
  - **Pure builder** (`src/lib/ops/receipt-review-packet.ts`): `buildReceiptReviewPacket(receipt, {now?, taxonomyOverride?})` is pure — no I/O, no env reads, no `Date.now()`. Static-source assertion locks the no-I/O contract.
  - **Per-field merge contract**: `proposedFields` carries `{ value, source: "canonical" | "ocr-suggested" | "missing" }` for each of vendor / date / amount / currency / category / payment_method. Canonical wins when present. OCR is the fallback. Missing stays missing — NEVER fabricated. Whitespace-only canonical values fall through to OCR. NaN amount in canonical falls through to OCR. Category never falls back to OCR (the extractor never proposes categories — locked by test).
  - **Eligibility rubric**: `eligibility.ok = missing.length === 0` for required fields (vendor, date, amount, category). `amount: 0` is a valid value (not missing). OCR `warnings` are mirrored read-only into `eligibility.warnings` prefixed with `"OCR: "`.
  - **Taxonomy gap**: every packet carries `taxonomy: { slug: null, classExpected: "B", reason: "No `receipt.review.promote` slug exists ... fail-closed rule ..." }`. The route's response also carries an envelope-level `taxonomy_status: { has_slug: false, slug: null, class_expected: "B", reason }` so tooling can detect the missing-slug state without inspecting the packet body.
  - **KV storage** (`src/lib/ops/docs.ts`): `requestReceiptReviewPromotion(receiptId)` stores the packet under `docs:receipt_review_packets`, keyed by `packetId = "pkt-v1-<receiptId>"` (deterministic — re-promoting overwrites). Soft cap 500 (matches the receipts blob). Companion helpers `getReceiptReviewPacket(packetId)` and `listReceiptReviewPackets({limit?})` are read-only.
  - **Auth-gated route** (`POST /api/ops/docs/receipt/promote-review`): `isAuthorized()` 401 gate. 400 on invalid JSON, missing `receiptId`, or whitespace-only `receiptId`. 404 when `receiptId` doesn't exist (no fabrication). 200 happy path returns `{ ok, packet, taxonomy_status }`. Only POST is exported.
- **Hard rules locked by 34 new tests:**
  - **Status preserved.** A `needs_review` receipt stays `needs_review` after promotion. Locked by the route test that re-reads the receipts blob from KV after the call.
  - **Canonical fields untouched.** `vendor`, `date`, `amount`, `category`, `payment_method` are snapshotted before and asserted equal after. The OCR-suggested values NEVER overwrite human entries.
  - **Idempotent.** Re-promoting the same receipt overwrites the packet by `packetId` — no duplicate packets in the KV blob. Locked.
  - **No taxonomy invention.** The packet's `taxonomy.slug` is `null` by default and the reason names `receipt.review.promote` + the fail-closed rule.
  - **No Slack/control-plane approval opened.** Static-source assertion: the route imports nothing from `control-plane/approvals`, `control-plane/stores`, or `buildApprovalRequest`. Nothing from `qbo*`, `hubspot*`, `slack-(send|client)`, or vendor-create paths. Locked.
  - **Pure builder, no I/O.** Static-source assertion on the helper module: no QBO/HubSpot/Slack send/control-plane approvals/`@vercel/kv`/`Date.now()`.
  - **Determinism.** `packetId` is deterministic in `receiptId`; `createdAt` comes from `options.now`. Same input + same `now` → identical packet.
  - **`receiptStatusAtBuild` snapshot.** The packet records the receipt's status at build time so reviewers see what state the packet captured (visibility lock).
  - **Honest accounting of missing fields.** `eligibility.missing` lists field names verbatim; `amount: 0` is NOT counted as missing.
- **Tests (Phase 8):** 22 in `src/lib/ops/__tests__/receipt-review-packet.test.ts` (determinism + non-mutation, canonical-preferred merge, OCR fallback, NaN drop, category-never-fallbacks-to-OCR, eligibility rubric, OCR warnings mirrored, taxonomy slug=null + reason, override path, status='draft' invariant, no-I/O static-source) + 12 in `src/app/api/ops/docs/receipt/promote-review/__tests__/route.test.ts` (auth gate, JSON validation, missing/whitespace receiptId, 404 unknown id, 200 happy path with taxonomy_status, eligibility=false on empty, eligibility=true with OCR fallback, status preserved, canonical-fields-untouched, idempotency, no-forbidden-imports + no-approvals-store assertion). Full suite: **1166 green** (was 1132).
- **UI:** Deferred — route + helpers are operator-tooling-callable today. A Phase 9 sub-lane will add a "Promote to review packet" button per receipt in `/ops/finance/review` once a `receipt.review.promote` taxonomy slug lands.
- **Monday MVP:** 🟢 — Reviewers can request a structured promotion packet for any captured receipt. The packet shows canonical and OCR fields side-by-side, lists exactly what's missing for eligibility, and documents why no Slack approval is opened (missing taxonomy slug, fail-closed). Receipts stay `needs_review` until a human edits canonical fields.

#### Phase 9 — `receipt.review.promote` slug + eligible-packet approval-open (NEW)
- **Why:** Phase 8 left the receipt promotion route producing a draft-only packet because no `receipt.review.promote` slug existed in the canonical taxonomy. Phase 9 registers the slug and extends the route to open a Class B Rene approval when the packet's `eligibility.ok` is true. Ineligible packets still stay draft-only with a reason naming the gaps. The approval acknowledges Rene reviewed — it remains read-only on QBO/HubSpot/Shopify.
- **Architecture:**
  - **Taxonomy registration** in both the doc (`contracts/approval-taxonomy.md` v1.3) and the code (`src/lib/ops/control-plane/taxonomy.ts`, `SINGLE_APPROVAL_ACTIONS` Class B). Slug: `receipt.review.promote`. Approver: `Rene`. `irreversible: false` (rejecting just leaves the packet in `draft`).
  - **Builder default** in `src/lib/ops/receipt-review-packet.ts` — `DEFAULT_TAXONOMY.slug` flipped from `null` to `"receipt.review.promote"`. Reason updated to describe the post-Phase-9 review-only semantic and to explicitly mention that the eventual QBO write happens via a separate `qbo.bill.create` action.
  - **Route extension** at `POST /api/ops/docs/receipt/promote-review`:
    - Eligible (`eligibility.ok=true`) → calls `buildApprovalRequest({ actionSlug: "receipt.review.promote", division: "financials", actorAgentId: "ops-route:receipt-promote", targetSystem: "internal-receipts", targetEntity: { type: "receipt-review-packet", id: packet.packetId, label: vendor || receiptId } })` and persists via `approvalStore().put`. Response carries `approval: { opened: true, id, status, requiredApprovers }`.
    - Ineligible → `approval: { opened: false, reason: "Packet ineligible — missing fields: ..." }`. Reason names every missing field verbatim.
    - Idempotent → if a pending approval already exists for the same `packetId`, the route surfaces the existing approval rather than opening a duplicate. Locked by test.
    - Fail-soft on approval-store errors: response still returns the packet; `approval.opened: false` with the underlying reason.
- **Hard rules locked by 5 new tests + 4 reframed Phase 8 tests:**
  - **Slug registered.** Default packet's `taxonomy.slug` is `"receipt.review.promote"` (was `null` in Phase 8); `taxonomy.classExpected` stays `"B"`; reason describes the registered + review-only semantic and explicitly names `qbo.bill.create` as the future write path.
  - **Eligible → approval opened.** A captured receipt with vendor + date + amount + category set returns `approval.opened: true` with a UUID id, `status: "pending"`, `requiredApprovers: ["Rene"]`.
  - **Ineligible → no approval.** Captured receipt with no canonical fields and no OCR returns `approval.opened: false`. Reason names every missing field.
  - **Idempotent.** Re-promoting the same receipt returns the SAME approval id. No duplicates in the approval store.
  - **Receipt status preserved.** A receipt that was `ready` after `processReceipt` (because all required fields were set) stays `ready` after the route opens an approval — the route never auto-promotes or demotes receipt status.
  - **Read-only on external systems.** Updated static-source assertion narrowed: the route still imports nothing from `qbo-client`/`qbo-auth`/`hubspot*`/`slack-(send|client)`/vendor-create paths; no `createQBOBill`/`createQBOInvoice`/`createQBOJournalEntry`; no direct Slack `chat.postMessage`/`WebClient`. The legitimate Phase 9 imports (`control-plane/approvals`, `control-plane/stores`) are now permitted.
- **Tests (Phase 9):** 4 new in `src/app/api/ops/docs/receipt/promote-review/__tests__/route.test.ts` (eligible opens approval; idempotent on approvals; ineligible no approval; status preserved on approval-open) + 4 reframed Phase 8 tests covering the registered-slug semantics + 1 narrowed static-source assertion. Full suite: **1171 green** (was 1166).
- **What's NOT in this commit (deferred):**
  - **Closer** — when Rene approves via Slack, no automatic packet `draft → rene-approved` transition happens yet. The approval is recorded in the audit log; the packet's status is unchanged. A Phase 10 sub-lane will add the closer.
  - **UI button** — operator tooling can call the route today; a "Request Rene review" button on `/ops/finance/review` is deferred to the same Phase 10/11 slot as the closer.
  - **`qbo.bill.create` integration** — receipt promotion is Rene's acknowledgment; the actual QBO posting remains a separate Class B action that doesn't yet auto-fire from a `rene-approved` packet.
- **Monday MVP:** 🟢 — Eligible captured receipts now generate a real Class B Rene approval in the control-plane queue. Rene gets a Slack notification (existing approval-surface), can click approve in `#ops-approvals`, and the audit log records the acknowledgment. Receipt status, canonical fields, and QBO state are all untouched. The lane between OCR capture and QBO posting now has its first machine-readable handoff.

#### Phase 10 — Receipt-review closer (Slack approve/reject → packet status transition) (NEW)
- **Why:** Phase 9 opened a real Class B Rene approval but the packet stayed `draft` even after Rene clicked approve. Phase 10 wires the closer that mirrors the AP-packet / Faire-Direct pattern: `recordDecision()` flips the approval to `approved`/`rejected`, then this closer transitions the packet to `rene-approved`/`rejected`. Closer's only mutation is the packet's `status` field — canonical receipt fields, the receipt's `needs_review`/`ready` status, and QBO state are all untouched.
- **Architecture:**
  - **Pure transition** in `src/lib/ops/receipt-review-packet.ts`: `applyDecisionToPacket(packet, decision: "approve"|"reject"|"ask")` returns the next packet or `null`. `null` for `ask` (clarification path; packet stays draft) and for any decision applied to a packet already in a terminal state (`rene-approved`/`rejected`) — idempotent.
  - **`ReceiptReviewPacket.status` union extended**: `"draft" | "rene-approved" | "rejected"`. The Phase 8/9 `"draft"` invariant becomes the *initial* state; terminal states are the closer's output.
  - **Storage helper** `updateReceiptReviewPacketStatus(packetId, nextStatus)` in `src/lib/ops/docs.ts`. Mutates ONLY the packet's `status` field; returns `null` if `packetId` doesn't exist (no fabrication).
  - **Closer** in `src/lib/ops/receipt-review-closer.ts`: `executeApprovedReceiptReviewPromote(approval)`. Strict gating — `targetEntity?.type === "receipt-review-packet"` AND `targetEntity.id` parses as `pkt-v1-<receiptId>` AND `approval.status` is terminal. Audits both success (`receipt-review-promote.closer` + `result: "ok"`) and failure (`result: "error"`).
  - **Slack-approvals chain** (`src/app/api/slack/approvals/route.ts`): closer slotted AFTER the existing approve-only chain so it fires on BOTH `approved` AND `rejected` (the other closers fire only on approve; receipt-review needs a reject path too). Posts a thread message via `postMessage` when `existing.slackThread?.ts` is present.
- **Hard rules locked by 16 new tests:**
  - **Pure transition contract.** Approve→`rene-approved`, reject→`rejected`, ask→`null`, terminal→`null`. Canonical/proposedFields/eligibility/taxonomy/ocrSuggestion/receiptStatusAtBuild are NEVER mutated. Input packet is not mutated (returns a new object).
  - **Closer gating.** Non-receipt-review approval → handled: false. Pending (non-terminal) approval → handled: false. Missing/malformed `targetEntity.id` → handled: true with `ok: false`.
  - **Closer success path.** Approved → packet flips to `rene-approved`; rejected → packet flips to `rejected`. Re-read from KV confirms.
  - **Only the `status` field changes.** Canonical, proposedFields, eligibility, taxonomy, ocrSuggestion, receiptStatusAtBuild, packetId, receiptId, createdAt are bit-identical before/after.
  - **Receipt's status preserved.** A receipt that was `ready` after `processReceipt` stays `ready` after the closer runs.
  - **Packet not found → handled: true, ok: false** (no silent success; the route surfaces the gap in Slack).
  - **Static-source assertion:** the closer module imports nothing from `qbo-client`/`qbo-auth`/`hubspot*`/`shopify-*`/`slack-(send|client)`/`createQBOVendor`/`onboardVendor`/`createQBOBill`/`createQBOInvoice`/`createQBOJournalEntry`/`chat.postMessage`/`WebClient`. The closer's imports are limited to `audit` + `auditStore` + `auditSurface` + `updateReceiptReviewPacketStatus` + types.
- **Tests (Phase 10):** 16 in `src/lib/ops/__tests__/receipt-review-closer.test.ts`: 5 pure-transition tests (approve/reject/ask/terminal-idempotent/no-mutation/non-mutation-of-input), 4 gating tests (non-receipt-review approval / missing targetEntity / pending approval / malformed targetEntity.id), 5 success-path tests (approved→rene-approved, rejected→rejected, only-status-changes, receipt-status-preserved, packet-not-found→handled+!ok), 1 static-source assertion. Full suite: **1187 green** (was 1171).
- **What's NOT in this commit (deferred to Phase 11):**
  - **UI button** on `/ops/finance/review` per receipt that calls `POST /api/ops/docs/receipt/promote-review` and surfaces the resulting `approval.id` + Slack-thread permalink. Operator tooling can already call the route directly; the UI button is purely a convenience surface.
  - **`qbo.bill.create` auto-fire** from a `rene-approved` packet remains explicitly out of scope — actual QBO posting is a separate Class B/C action.
- **Monday MVP:** 🟢 — The receipt-to-Rene loop now closes end-to-end. Capture → OCR (Phase 7) → packet (Phase 8) → eligible-Slack-approval (Phase 9) → Rene clicks approve/reject → packet transitions to terminal status (Phase 10). Every step is review-only with respect to QBO/HubSpot/Shopify. The actual QBO posting still requires a human-initiated `qbo.bill.create` action.

---

## Division 2 — Email / Inbox / Customer replies

### E2.1 Inbox triage (existing one-shot)
- **Trigger:** POST from caller with up to 20 envelopes
- **AI role:** Sonnet 4.6 classifier with HARD_RULES_PROMPT
- **Tests:** Missing
- **Monday MVP:** 🟡 — works but called only by ops-chat. The new email-intelligence pipeline (S1.1) supersedes for the cron path

### E2.2 Customer-facing chat (`/api/chat`)
- **Trigger:** DTC visitor on usagummies.com
- **AI role:** GPT-4o-mini (after typo fix)
- **Tests:** Missing
- **Monday MVP:** 🟢 — live; no claims gate yet

### E2.3 Gmail draft / send / search primitives
- **Status:** Built, all in `src/lib/ops/gmail-reader.ts`
- **Routes:** `/api/ops/fulfillment/gmail-draft`, `/api/ops/fulfillment/ap-packet/send`, `/api/ops/fulfillment/oauth-consent-url`
- **Approver:** Ben for any actual send (Class B `gmail.send`)
- **Tests:** Indirect via email-intelligence draft.test
- **Monday MVP:** 🟢 — pending OAuth re-consent for `drive.readonly` + `gmail.modify` scopes

---

## Division 3 — Samples / Shipping / Amazon FBM / Shopify Fulfillment

### F3.1 Auto-ship pipeline (unified, channel-agnostic)
- **Trigger:** Cron every 30 min
- **Source:** ShipStation `awaiting_shipment` queue (any store)
- **AI role:** None (rules-based packaging picker)
- **Approver:** Auto-buy when packaging is canonical (1-4 mailer / 5-12 box / 36 master); refuse + surface `#ops-approvals` otherwise
- **Slack:** `#operations` (label PDF + summary on success); `#ops-approvals` (refusals); `#ops-alerts` (Slack file-upload failure with Drive label link inline)
- **Writeback:** ShipStation order shipped + KV dedup + audit + Drive label artifact + Drive packing-slip artifact (commit `2f4e55d`)
- **Audit:** Every ship attempt logged with `labelDriveLink`, `packingSlipDriveLink`, `slackPermalink`, `driveError`
- **Tests:** Yes — auto-ship route (5) + shipping-artifacts module (13) + recent-labels enrichment (2). Locks the invariant that Slack/Drive failures NEVER trigger a second `createLabelForShipStationOrder` call.
- **Monday MVP:** 🟢

#### Runbook — "I got the label-purchased Slack notice but I can't find the file"

Follow this order **without rebuying the label**:

1. **`/ops/shipping` → Recent labels table.** New "Artifacts" column shows three links per row when present: **Open label** (Drive PDF, page 1), **Packing slip** (Drive PDF, page 2), **Slack** (Slack permalink). Click "Open label" → it opens the Drive-hosted PDF in a new tab → Cmd+P to print.
2. **Slack `#operations`** — if the artifact column shows only "Slack" or only the Drive link is missing, search `label-<order-number>` or paste the tracking number. The Slack permalink in the table will jump you straight there.
3. **Slack `#ops-alerts`** — if Slack file upload failed at the time of purchase, an explicit warning was posted here with the Drive label link inline. Search `Slack file upload FAILED <order-number>`.
4. **ShipStation directly** (last resort) — open the order, click "Reprint label". This is the source of truth: the label was bought there, so it's printable from there even if every downstream artifact failed.

**Hard rule:** Never re-run auto-ship and never call `createLabelForShipStationOrder` to "get a fresh PDF." That buys a second label and double-charges the postage account. The artifact pipeline is observability — the label only ever gets bought once.

#### Required env (production, Vercel)

| Var | Purpose | Failure mode if unset |
|---|---|---|
| `GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID` | Drive folder for `labels/<source>/` artifacts | Drive write fail-soft → `driveError` populated, Slack still posts, label still bought. Artifacts column stays "—". |
| `GOOGLE_DRIVE_UPLOAD_PARENT_ID` | Fallback parent for the artifact module + the upload route | Same as above (cascade fallback). |
| `GMAIL_OAUTH_REFRESH_TOKEN` (with `https://www.googleapis.com/auth/drive` scope) | Drive uploads | `driveError: "GMAIL_OAUTH_* missing"` — no Drive write but no run failure. |
| `SLACK_BOT_TOKEN` (with `files:write`) | Slack file upload | Slack upload fails, `#ops-alerts` warning posts, Drive link still works. |

### F3.2 AP packet send (Jungle Jim's-style)
- **Trigger:** Manual via `/api/ops/fulfillment/ap-packet/request-approval`
- **Source:** `src/lib/ops/ap-packets.ts` (hardcoded packet config)
- **AI role:** None (template-driven)
- **Approver:** Ben (Class B `gmail.send`)
- **Slack:** `#ops-approvals` for the card
- **Writeback:** KV `ap-packets:sent:<slug>` + Gmail message
- **Tests:** Missing on send route directly; `record-sent` works
- **Monday MVP:** 🟡 — blocked on Drive OAuth scope for non-JJ packets

### F3.3 Sample-Order Dispatch (S-08)
- **Trigger:** Webhooks (Shopify orders-paid, HubSpot deal-stage-changed, Amazon manual)
- **AI role:** Classifier (deterministic)
- **Approver:** Ben (Class B `shipment.create`)
- **Tests:** Yes (3 adapter tests)
- **Monday MVP:** 🟢

### F3.4 ShipStation wallet + void watcher
- **Trigger:** Cron daily 09:00 PT
- **Source:** ShipStation `/carriers` (balances) + `/shipments?voided=true`
- **AI role:** None
- **Slack:** `#operations` when below floor or stale void > 72h
- **Tests:** Missing
- **Monday MVP:** 🟢 (after bot-in-#operations fix today)

---

## Division 4 — Finance / QBO / AP / AR / Receipts

### Fin4.1 Finance Exception Agent
- **Trigger:** Cron weekday 06:15 PT
- **Source:** QBO + Plaid + Booke + ShipStation void scan + KV freight-comp queue
- **AI role:** None (deterministic digest)
- **Slack:** `#finance` (Rene-tagged)
- **Writeback:** None — read-only digest
- **Audit:** Run logged
- **Tests:** Missing
- **Monday MVP:** 🟢

### Fin4.2 CF-09 freight-comp queue manager
- **Trigger:** Buy-label writes paired DEBIT 500050 / CREDIT 499010 to KV; Rene drains
- **Approver:** Rene (Class B `qbo.bill.approve-for-payment`)
- **Slack:** Surfaced via Finance Exception digest
- **Tests:** Missing on the route directly; freight-comp generator tests yes
- **Monday MVP:** 🟢

### Fin4.3 Receipts intake (`#receipts-capture`)
- **Trigger:** Email-intel classifies `receipt_document`, or operator uploads/posts a receipt file.
- **Source:** Gmail / Drive durable upload / `#receipts-capture`
- **Writeback:** KV receipt queue via `/api/ops/docs/receipt`; no QBO write.
- **Approval:** Rene review required before any QBO bill / category write.
- **Tests:** Yes (`docs-receipts` queue tests)
- **Monday MVP:** 🟡 — intake queue live; OCR + QBO posting intentionally not autonomous

### Fin4.4 QBO write paths (40+ routes)
- **Trigger:** Various — invoice, bill, estimate, JE, transfer, deposit
- **Approver:** Class varies — DRAFT-only for invoices (B), JE is Class D (prohibited)
- **Tests:** Missing on most QBO routes
- **Monday MVP:** 🟡 — write paths work; tests sparse

### Fin4.5 Stamps.com refund escalation
- **Status:** Manual today (Ben pastes drafted text)
- **Slack:** Daily ping in `#operations` listing stale voids (FIXED today)
- **Monday MVP:** 🟢 (alert) / 🟡 (auto-escalation email — next build)

### Fin4.7 AP Packet Dashboard + send-on-approve (CLOSED LOOP)
- **Trigger (dashboard):** Operator opens `/ops/ap-packets` (Rene + Ben). Read-only.
- **Trigger (send-on-approve):** Ben clicks Approve on the AP-packet approval card in Slack `#ops-approvals` → `/api/slack/approvals` updates the canonical approvalStore via `recordDecision()` → `executeApprovedApPacketSend()` fires automatically. No manual `/send` call needed.
- **Source:**
  - `/api/ops/ap-packets` (no slug) — roster of every packet with `attachmentSummary`, `nextActionsCount`, `firstNextAction`, and a per-slug `lastSent` join from KV `ap-packets:sent:<slug>`.
  - `/api/ops/ap-packets?account=jungle-jims` — full detail for the JJ panel.
- **Closer chain order at `/api/slack/approvals`** (each strictly gated by `targetEntity.type` so they never cross-fire):
  1. `email-reply` → `executeApprovedEmailReply()`
  2. `dispatch:<chan>:<id>` payloadRef → `executeApprovedShipmentCreate()`
  3. `vendor-master` → `executeApprovedVendorMasterCreate()`
  4. `ap-packet` → `executeApprovedApPacketSend()` *(new — commit 2026-04-25)*
- **AI role:** None — `deriveDashboardRow()` picks one recommended next action per packet via priority list: pricing review → missing docs → attachments needing review → recently sent → stale send → ready-to-send → `firstNextAction`. Closer is also pure routing — strict gate, then HTTP POST to the existing send route.
- **Approver:** Ben (Class B `gmail.send`). Strict: closer fires only when `approval.status === "approved"` AND `targetEntity.type === "ap-packet"` AND `targetEntity.id` parses as `ap-packet:<slug>`. Tests cover every other state (pending / rejected / expired / stood-down / draft) returning `handled=false` with no `/send` call.
- **Slack:** Approval card → `#ops-approvals`. After approve click, the closer posts a thread reply with sent timestamp, recipient (label parsed from approval), packet slug, Gmail message id, thread id, and HubSpot log id. On failure: thread reply with `:warning:` and the failure reason; **`lastSent` is NOT written** — the send route is the only path that writes `ap-packets:sent:<slug>`, and it only writes on its own success path.
- **Writeback:** Closer never writes Gmail / HubSpot / KV / Drive directly. All side effects flow through `POST /api/ops/fulfillment/ap-packet/send`, which re-validates the approval token, runs triple-gate dedup, fetches Drive attachments, sends via Gmail API, logs to HubSpot, and writes the `ap-packets:sent:<slug>` KV row.
- **Audit:** Two entries per approve click: (1) `approval.approve` (already mirrored by the slack route), (2) `ap-packet.approved.send` written by the closer — `result: "ok"` on success with messageId/threadId/hubspotLogId, `result: "error"` on failure with the surfaced reason.
- **Failure mode:** Send route returns 502/424/409 → closer surfaces error in the Slack thread, audits as `result: "error"`, NEVER writes `lastSent`. Network error reaching the send route → same. The operator can fix the cause and POST `/api/ops/fulfillment/ap-packet/send` manually with the same approvalToken to retry; re-clicking Approve in Slack does NOT re-fire (recordDecision rejects state transitions on already-approved rows).
- **Tests:** 18 dashboard helpers + **12 closer tests** locking: approved → POST /send exactly once with correct body and bearer; pending/rejected/draft/expired/stood-down → no /send call; non-ap-packet (`email-reply` / `vendor-master`) → ignored; missing or empty `targetEntity.id` → fail closed, no /send; send 502 → ok=false + threadMessage flags failure + audit error + no lastSent; 409 dedup conflict → surfaces reason; network error → ok=false + no double-fire; approvalToken passed to /send is the approval id (not the slack ts).
- **Monday MVP:** 🟢 **CLOSED LOOP** — Ben clicks Approve in Slack, the AP packet sends, the dashboard shows lastSent, the audit trail records every step. No manual /send call required.

#### Templates + drafts (NEW 2026-04-26)

- **Source:** `src/lib/ops/ap-packets/templates.ts` exports `USA_GUMMIES_BASE_TEMPLATE` — the USA-Gummies-side fields (legal name, EIN, remit-to, ACH/wire routing, catalog, reply-skeleton with `{{retailer}}` placeholder). Templates are pure constants; retailer data is never baked in.
- **Trigger:** Operator opens `/ops/ap-packets`, scrolls to the "Drafts (template-built)" section, fills in `slug` + `accountName` + `apEmail` + (optional) `owner` / `dueWindow`, clicks **Create draft**. The form posts to `POST /api/ops/ap-packets/drafts`.
- **AI role:** None.
- **Approver:** None — drafts are operator-side scaffolding, not approval-class actions. They don't enter the Class B queue until they're promoted to a live packet (a separate, future flow).
- **Slack:** None directly. Drafts never trigger an approval card.
- **Writeback:** KV only (`ap-packets:drafts:<slug>` + `ap-packets:drafts:_index`). **No email, no QBO write, no Drive write, no Gmail draft.** Locked by tests — the templates module imports nothing from `googleapis`, `gmail-reader`, `hubspot-client`, or any QBO module.
- **Safety:** Drafts are intentionally invisible to `getApPacket()` (the live registry function the send route uses). A draft slug POSTed to `/api/ops/fulfillment/ap-packet/send` returns 404 before any approval check. The dashboard shows drafts in their own table with a clear "DRAFT — INCOMPLETE" / "DRAFT — COMPLETE" badge plus the `missingRequired` field list.
- **Required-field validation:** Slug (kebab-case 2-42 chars), templateSlug, accountName, apEmail (real email shape) — enforced by `buildApPacketDraft()` and the route's 400 path. Missing/invalid → `DraftValidationError` with structured `issues[]`.
- **Completeness rules:** A draft is `requiredFieldsComplete=true` only when accountName + apEmail + owner + dueWindow are populated AND no attachment is in `status="missing"`. Marked `false` until then with `missingRequired[]` listing every gap.
- **Tests:** **22 tests in `templates.test.ts`** (template registry exists, required-field enforcement, `{{retailer}}` substitution, `apEmail` lowercased, mutation safety, KV round-trip, fail-soft on KV outage, drafts not visible to `getApPacket()`, no email/QBO/Drive side effects). **10 tests in `drafts/route.test.ts`** (HTTP 201 on create, 400 on missing fields, 404 on unknown template, 409 on slug clobber, GET returns roster + templates + counts, getApPacket returns null for draft slugs).
- **Monday MVP:** 🟢 — operator can create the next retailer's packet (Whole Foods, Kroger, etc.) from one form without touching code. `hasPacketTemplateRegistry()` now returns `true`.

### Fin4.6 Finance Review surface (`/ops/finance/review`)
- **Trigger:** Operator opens the page (Rene + Ben). Read-only.
- **Source:** Aggregates four live APIs in parallel:
  - `/api/ops/docs/receipt?summary=true` + `?status=needs_review&limit=50`
  - `/api/ops/control-plane/approvals?mode=pending` (canonical Class B/C queue)
  - `/api/ops/fulfillment/freight-comp-queue?status=queued`
  - `/api/ops/ap-packets`
- **AI role:** None (pure aggregation + status derivation; never fabricates)
- **Approver:** N/A — this surface only **shows** what's pending. Decisions still happen in Slack #ops-approvals (Class B/C cards) or via the existing decision endpoints. Future QBO bill/category write paths from this page would be Class B and Rene-approved per `/contracts/approval-taxonomy.md`.
- **Slack:** None directly (the underlying queues already post to their own channels)
- **Writeback:** None. Zero side effects: no QBO write, no Gmail send, no Drive write, no approval state mutation.
- **Audit:** None — read-only views are not auditable events.
- **Failure mode:** When a source errors or returns empty, the section shows **"Error"** or **"Empty"** wiring (not a fake "0 needs review"). Honest dashboard over flattering one.
- **Tests:** Yes — `data.test.ts` (10 tests) locks the no-fabrication contract: error → wiring=error, empty → wiring=empty, populated → wiring=wired with the count summary; Monday-action list is sorted by priority. Receipt status filter covered by `docs-receipts.test.ts`.
- **Monday MVP:** 🟢 — page is ready for Rene + Ben. Will populate as soon as receipts queue, vendor approvals open, or freight-comp items land.

---

## Division 5 — Inventory / Vendors / Powers / Albanese / Belmark

### I5.1 Inventory snapshot + cover-day forecast + burn-rate calibration
- **Trigger:** Cron daily 13:15 UTC + side-effect on every buy-label
- **Source:** Shopify Admin API
- **AI role:** None
- **Slack:** Feeds Ops Agent digest (`#operations`) + ATP gate
- **Tests:** Yes (`inventory-snapshot`, `inventory-forecast`, `burn-rate-calibration`)
- **Monday MVP:** 🟢

### I5.2 Vendor-thread freshness scraper
- **Trigger:** Side-effect of Ops Agent run
- **Source:** Gmail labels per vendor (Powers / Belmark / Albanese / Inderbitzin)
- **Tests:** Missing
- **Monday MVP:** 🟢

### I5.3 Vendor master creation
- **Status:** ✅ Live — `/api/ops/vendors/onboard` + `/ops/vendors/new`
- **Approver:** Rene (`vendor.master.create`)
- **Flow:** Operator form → control-plane approval → Slack click → QBO vendor create → Notion/Drive dossier attempt → audit/thread result
- **Tests:** Yes
- **Monday MVP:** 🟢 for QBO vendor creation / 🟡 for Notion+Drive dossier until env scopes and parent IDs are verified

### I5.4 Reorder triggers (Powers PO, Belmark PO)
- **Status:** ❌ Stub — Drew manual via Gmail thread
- **Monday MVP:** 🔴

---

## Division 6 — Marketing / Claims / Content / Outreach

### M6.1 Outreach validation (`scripts/outreach-validate.mjs`)
- **Trigger:** CLI pre-send gate (run before any outbound batch)
- **Source:** `contracts/outreach-pitch-spec.md` + `src/lib/ops/product-claims.ts`
- **AI role:** None (pattern check)
- **Approver:** Fail-closed on missing Apollo / HubSpot / Gmail dedup signals
- **Tests:** Missing
- **Monday MVP:** 🟢

### M6.2 Marketing content actions (`/api/ops/marketing/content/actions`)
- **Trigger:** Manual via ops UI
- **AI role:** GPT-4o-mini drafter
- **Approver:** Ben (Class B `content.publish`)
- **Tests:** Yes
- **Monday MVP:** 🟢

### M6.3 Approved Claims registry
- **Trigger:** GET via `/api/ops/claims/registry`
- **Source:** KV
- **Approver:** Ben (Class B `approved-claims.add` / `.retire`)
- **Tests:** Missing
- **Monday MVP:** 🟡 — registry works; not yet sourced from Notion canon

### M6.4 Klaviyo / social cross-posting
- **Status:** ❌ Stub
- **Monday MVP:** 🔴 — manual via individual platforms

---

## Division 7 — Research / Trade Shows / Competitive

### R7.1 Research Librarian (synthesis only)
- **Trigger:** Cron Friday 11:00 PT
- **Source:** KV research notes (`/api/ops/research/note` POST)
- **AI role:** Synthesizer
- **Slack:** `#research`
- **Tests:** Yes
- **Monday MVP:** 🟢

### R7.2 R-1 through R-7 specialists
- **Status:** Contracts only — runtime not built
- **Monday MVP:** 🔴 — Phase 2 build

### R7.3 Trade-show pod activation
- **Status:** Slug exists in taxonomy, no runtime
- **Monday MVP:** 🔴 — per-show manual

---

## Division 8 — Compliance / W-9 / COI / Claims / Filings

### C8.1 Compliance Specialist
- **Trigger:** Cron weekday 11:00 PT
- **Source:** Notion `/Legal/Compliance Calendar` (when populated) → fallback to doctrine 11-category list
- **AI role:** None
- **Slack:** `#operations` (live) / `#ops-audit` (degraded mode)
- **Tests:** Missing
- **Monday MVP:** 🟢 (fallback mode) / 🟡 (live mode pending Notion DB)

### C8.2 W-9 / COI tracking in AP packets
- **Status:** Hardcoded in `ap-packets.ts`
- **Monday MVP:** 🟢 (per-vendor) / 🔴 (no expiry watcher)

### C8.3 USPTO / FDA / Wyoming filings
- **Status:** Notion-only manual tracking
- **Monday MVP:** 🔴 — depends on Compliance Calendar going live

---

## Division 9 — Platform / Governance / Approval / Audit / Drift

### P9.1 Control plane (taxonomy v1.2, approvals, audit, stores, surfaces)
- **Status:** ✅ Live + canonical
- **Routes:** `/api/ops/control-plane/{health, approvals, audit, drift-audit, fulfillment-drift-audit, violations, corrections, paused, unpause, scorecards}`
- **Tests:** Yes (extensive)
- **Monday MVP:** 🟢

### P9.2 Slack approvals click handler (`/api/slack/approvals`)
- **Trigger:** Slack interactive payload (signed)
- **AI role:** None
- **Tests:** Yes
- **Monday MVP:** 🟢

### P9.3 Drift audit runner
- **Trigger:** Cron Sunday 20:00 PT
- **Source:** auditStore samples
- **Slack:** `#ops-audit`
- **Tests:** Yes
- **Monday MVP:** 🟢

### P9.4 Hard-rules pin + model-routing policy
- **Status:** ✅ Live (`contracts/hard-rules.md`, `src/lib/ops/ai/model-policy.ts`)
- **Monday MVP:** 🟢

### P9.5 Production Readiness dashboard (`/ops/readiness`)
- **Trigger:** Operator opens `/ops/readiness` (auth-gated by existing `/ops/*` middleware).
- **Source:** `GET /api/ops/readiness` returns the env fingerprint (booleans only, never raw values), the smoke-checklist constants, and the list of read-only routes to probe. The page then probes each listed route from the operator's browser — session cookie travels naturally, no server-to-server auth gymnastics.
- **AI role:** None.
- **Approver:** None — read-only.
- **Slack:** None.
- **Writeback:** None. **Zero side effects** — no Slack post, no KV write, no Gmail send, no QBO write, no approval mutation, no label buy.
- **Probed routes (GET only, all read-only):** `/api/ops/control-plane/health`, `/api/ops/fulfillment/recent-labels`, `/api/ops/docs/receipt?summary=true`, `/api/ops/ap-packets`, `/api/ops/locations/ingest`. Anything that mutates state (label buy, Gmail send, QBO write, approvals, KV writes) is intentionally NOT in the probe list.
- **Env fingerprint:** boolean presence checks for the 12 env vars that gate the platform. Drive parent-folder fallback chain is surfaced explicitly — when `GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID` is missing but `GOOGLE_DRIVE_UPLOAD_PARENT_ID` is set, the row reads "fallback · using GOOGLE_DRIVE_UPLOAD_PARENT_ID."
- **No-secret-leak invariant:** locked by tests. The route input is boolean-only by construction; tests set known secret values in `process.env`, call the route, and assert the secret strings are absent from the response body.
- **Smoke checklist:** stable list of click-through links operators visit by hand to verify public + operator surfaces (`/where-to-buy`, `/wholesale`, `/account/login`, `/account/recover`, `/ops/shipping`, `/ops/finance/review`, `/ops/ap-packets`, `/ops/locations`).
- **Tests:** 16 helper tests (env-status derivation, fallback chain, probe outcome mapping, no-secret-leak invariant) + 5 route tests (auth gate, env fingerprint, no-secret-leak, missing-env reporting, fallback path).
- **Monday MVP:** 🟢 — Ben opens `/ops/readiness`, sees what's red/yellow/green, sets the missing envs in Vercel, redeploys.

---

## Division 10 — Website / Vendor portal / Wholesale onboarding

### W10.1 NCS-001 customer setup form (`/upload/ncs`)
- **Status:** ✅ Live, public-facing
- **Writeback:** `/api/ops/upload` (local FS — broken on Vercel ephemeral)
- **Monday MVP:** 🔴 — known bug: ephemeral FS loses uploads on redeploy. **Fix:** swap to Vercel Blob or Drive

### W10.2 `/wholesale` storefront page
- **Status:** ✅ Live
- **Monday MVP:** 🟢

### W10.3 Vendor onboarding portal (proper)
- **Status:** 🟡 Internal operator portal live at `/ops/vendors/new`; external self-service vendor portal not built
- **Monday MVP:** 🟡 — Rene can open approved vendor masters internally; public/self-service vendor portal remains Phase 2

### W10.4 Wholesale inquiry receipt page (`/wholesale/inquiry/[token]`)
- **Trigger:** Customer submits the form at `/wholesale` → `/api/leads` returns an `inquiryUrl` → `WholesaleForm` redirects.
- **Auth:** HMAC-signed token (no login). 30-day TTL. Verified via `verifyInquiryToken`.
- **Data sources:** existing `/api/wholesale-status?email=` for HubSpot deal status; existing `/api/ops/upload` for doc capture.
- **Writeback:** Drive (via /api/ops/upload). No QBO write, no email send, no HubSpot mutation.
- **Tests:** 13 token + 6 inquiries-route + 5 leads-route.
- **Required env:** `WHOLESALE_INQUIRY_SECRET` (long random secret). Without it, the form keeps working — just no inquiryUrl.
- **Monday MVP:** 🟢 — Phase 1 portal live (commit 3f396af).

### W10.5 Customer account UI (`/account`)
- **Trigger:** Customer visits `/account/login` (or `/account` while signed-out → redirected to login).
- **Auth:** Shopify customer accounts via the existing `/api/member` route. Cookie-based session (`usa_customer_token`, httpOnly, secure in prod, 30-day max age) — already plumbed before this build, just unsurfaced.
- **Pages:**
  - `/account/login` — email + password → `POST /api/member action=login`
  - `/account/recover` — email-only → `POST /api/member action=recover` (Shopify sends the reset email)
  - `/account` — `POST /api/member action=session` for customer + last 10 Shopify orders, plus a read-only B2B status panel for plausible business-domain emails (joins `/api/wholesale-status?email=` server-fetched by the client). Logout button calls `POST /api/member action=logout`.
- **Source of truth:** Shopify Storefront API (orders), HubSpot (B2B deals — read-only).
- **AI role:** None.
- **Approver:** None — read-only customer surface.
- **Slack:** None.
- **Writeback:** Cookie set/clear via `/api/member`. No QBO, no Drive, no Gmail, no cart mutation, no checkout change.
- **Failure mode:** session 401 → redirect to `/account/login`. /api/wholesale-status error → B2B panel shows a friendly "temporarily unavailable" message; orders still render. B2B panel is hidden entirely for consumer mailboxes (gmail/yahoo/etc.) to keep the noise down for DTC customers.
- **Tests:** 19 unit tests in `display.test.ts` lock the no-fabrication contract on order date / total / financial status / fulfillment status / greeting / `shouldQueryB2BStatus` heuristic. **Plus 9 reorder tests in `reorder.test.ts`** locking the no-historical-price contract.
- **Monday MVP:** 🟢 — Phase 2 surface live (commit 45d63ac). No per-account pricing or terms (Phase 3).

#### Reorder ("Buy these again", Phase 3a)
Each order row now carries a **Buy these again** button. Pure helper `intentFromOrder()` (in `src/lib/account/reorder.ts`) maps historical line items against the canonical single-bag variant and returns `{ addable, skipped, hasAnyAddable }`. The button is shown only when at least one line item is safely mappable. On click, the UI loops through the addable items and calls the existing `addToCart()` server action — **Shopify computes the current price; no historical price is ever reused** (locked by a `JSON.stringify(intent)` assertion that price strings are absent from the output). Unavailable lines (deleted product / different SKU / out of stock) surface inline with friendly copy via `copyForSkipReason`. The `CUSTOMER_ORDERS` GraphQL query was extended to surface `variant { id sku availableForSale }` per line item so the helper can classify safely. No new server-action signature, no new env var.

### W10.6 Store locator (`/where-to-buy`)
- **Trigger:** Customer visits `/where-to-buy` (linked from the AppShell nav). Server-rendered, public, read-only.
- **Source of truth:** Hand-curated `src/data/retailers.ts` (5 stores at the time of this entry, across WA/NY/OK/MT/SC). Two channels tracked: `direct` (we ship + invoice) and `faire` (Faire-fulfilled).
- **AI role:** None.
- **Approver:** None — read-only page.
- **Slack:** None.
- **Writeback:** None. Zero side effects — page only reads the static `RETAILERS` array.
- **Pure helpers:** `src/lib/locations/helpers.ts` exports `countStores`, `countStates`, `groupByState`, `normalizeStoreLocation` plus a `StoreLocation` re-export. Helpers fail-soft on null/undefined/empty input, dedup states case-insensitively, and refuse to fabricate a location when fields are missing.
- **Page features:** headline, total-store count, states count, list grouped by state with canonical casing preserved, alphabetical state sort, and an explicit empty state ("Retail locations are being added as distributor sell-through is confirmed.") when `RETAILERS` is empty. Map placeholder rendered when there are no stores so the page never shows a broken / blank SVG.
- **SEO:** WebPage JSON-LD + per-retailer `LocalBusiness` JSON-LD continue to render only when the record passes through the helper's filter (a partial record never produces fake structured data).
- **Tests:** 18 unit tests in `helpers.test.ts` lock the no-fabrication contract: never throws on empty/null input, dedups states case-insensitively, ignores blank states, groups stable + alphabetical with canonical casing, `normalizeStoreLocation` returns null on partial input.
- **Phase 1 boundary:** No external map provider, no Mapbox/Google Maps key, no env var. The existing `USStoreMap` SVG (manually-calibrated `mapX/mapY` per store) is enough until coverage demands a real provider.
- **Monday MVP:** 🟢 — page is ready and adding new retailers is a single literal append to `src/data/retailers.ts`. New entries flow through the helpers automatically.

#### Phase 2 — internal ingest review queue (`/ops/locations`, NEW)
- **Trigger (write):** Operator POSTs to `/api/ops/locations/ingest` with `{ rows: [...], ingestSource? }`. Each row passes through `normalizeStoreLocation()`. Valid rows land in KV at `locations:drafts:<slug>` with `status="needs_review"`. Invalid rows go into the response `errors[]` array (1-based `rowIndex` + stable `code`: `missing_required` / `duplicate` / `unknown`).
- **Trigger (read):** Operator opens `/ops/locations` (auth-gated under existing `/ops/*` middleware) → fetches `GET /api/ops/locations/ingest` → renders drafts grouped by status + the most recent ingest's error envelope.
- **Hard rules locked by tests:**
  - **Public `src/data/retailers.ts` is never mutated.** Test asserts `JSON.stringify(RETAILERS)` is unchanged before/after ingest.
  - **`/where-to-buy` is unchanged.** Drafts live in their own KV store and are intentionally invisible to the public locator. Promotion is a separate, manual PR.
  - Partial / malformed rows never become drafts — the normalize gate refuses them, the route surfaces them in `errors[]`.
  - Duplicates (within a single batch AND against existing drafts) are flagged in `errors[]` with `code: "duplicate"`, never double-added. Dedup key = slug; falls back to `name+state` slug if absent.
  - Auth gate: middleware blocks `/api/ops/*` and `/ops/*` for unauthenticated traffic; `isAuthorized()` re-checks (session OR CRON_SECRET) inside the route.
- **Status response:** 201 when every row produced a draft, 207 (Multi-Status) on a mix of created + errors, 200 when nothing was accepted.
- **Tests:** 13 unit tests on the drafts module (lifecycle, normalize gate, in-batch + cross-batch dedup, KV last-errors envelope, RETAILERS-unchanged invariant) + 10 integration tests on the route (auth gate, happy path, multi-status, validation, GET grouping).
- **Promotion to public:** intentionally NOT automated. To publish accepted drafts, an operator opens a PR appending the records to `src/data/retailers.ts` (which the helpers + `/where-to-buy` already consume). The page never publishes anything.
- **Monday MVP:** 🟢 — internal queue ready. Distributors can send bulk lists; operator stages them via the route, reviews on `/ops/locations`, then promotes only the accepted records.

#### Phase 3 — review actions (`PATCH /api/ops/locations/ingest/[slug]`, NEW)
- **Trigger:** Operator opens `/ops/locations`, picks a draft row, changes the status dropdown (`needs_review` / `accepted` / `rejected`) and/or types a review note, clicks **Save review**. The client `PATCH`es the slug-specific endpoint.
- **Body:** `{ status?, reviewNote?, fieldCorrections?, reviewedBy? }`. Slug is immutable on update; slug-changing corrections are silently dropped.
- **Validation:** every accepted change passes through `normalizeStoreLocation()` AFTER the merge — a botched correction (blank `name`, `lat: NaN`, etc.) rejects the entire patch with HTTP 422 + stable `code: "validation_failed"`. Original draft stays intact. Status enum is enforced (`code: "invalid_status"`, 422). Empty patches return `code: "no_changes"`, 400.
- **Audit fields:** every accepted update stamps `updatedAt` + `reviewedAt` (now) and optionally `reviewedBy` (operator email/username). The page surfaces the last-reviewed timestamp + reviewer next to each row.
- **Hard rules locked by tests:**
  - **`src/data/retailers.ts` is NEVER mutated.** Both `accepted` and `rejected` updates are explicitly tested for "slug never appears in RETAILERS." A full review cycle (ingest → accept → field correction → reject) is asserted byte-identical against `JSON.stringify(RETAILERS)`.
  - **No promote-to-public endpoint exists.** Promotion still requires a PR appending to `src/data/retailers.ts`.
  - Slug is immutable across review actions.
- **Tests:** 13 new on the drafts module (status enum, happy paths, no-changes guard, validation_failed on bad correction, slug immutability, RETAILERS-unchanged across the cycle) + 16 new on the PATCH route (auth gate, happy paths, error codes, RETAILERS untouched). Existing Phase 2 tests still pass.
- **UI:** `/ops/locations` page now renders each draft as a card with status dropdown + review-note textarea + **Save review** button. Section copy: *"Accepted means ready for manual PR, not live."*
- **Monday MVP:** 🟢 — operators can classify drafts into the lifecycle without ever publishing publicly.

---

## Monday-readiness summary

| Status | Count | Workflows |
|---|---|---|
| 🟢 Green | 30 | Email-intel triage (CLOSED LOOP), Sample-request → shipping bridge, Vendor master creation (QBO path), Faire Direct invites (CLOSED LOOP), Sales Command Center (read-only roll-up), HubSpot dispatch, Auto-ship, Sample dispatch, Shipping label artifacts, Durable NCS/vendor-doc upload, Wallet check, Inventory snapshot/forecast/burn-rate, Vendor threads, Outreach validate, Marketing content, Research Librarian, Compliance (fallback), Control plane, Slack approvals, Drift audit, Hard-rules pin, Customer chat, Finance Exception, Freight-comp manager, Stamps.com daily ping, Wholesale page, Gmail send/draft primitives, AP packet send (JJ-only), Reply composer (untested but live) |
| 🟡 Yellow | 7 | Reply composer + Pipeline enrich (no tests), Inbox triage (one-shot), AP packet send (Drive scope), QBO write paths (sparse tests), Approved Claims (KV-only), Vendor onboarding Notion/Drive dossier parent IDs/scopes, Receipts intake queue (review-only; no OCR/QBO write) |
| 🔴 Red | 7 | Reorder triggers, Drew East-Coast routing confirmation, Klaviyo / social, R-1..R-7 specialists, Trade-show pod, USPTO/FDA tracking, external vendor portal |

---

## Top 5 P0 build items remaining for Monday

1. **OAuth re-consent landing** — unblocks Drive scope for AP-packet attachments + Gmail compose for drafts. Ben already clicked through; verify new refresh token has `gmail.modify` + `drive.readonly`.
2. ~~**Send-on-approve hook for email-intel**~~ — DONE 2026-04-24 (commit `16fa4ea`). `executeApprovedEmailReply()` wired into `/api/slack/approvals` click handler.
3. ~~**Sample-request → shipping bridge**~~ — DONE 2026-04-24. See S1.5 above.
4. ~~**Vendor master creation route**~~ — DONE 2026-04-24. `POST /api/ops/vendors/onboard`, `/ops/vendors/new`, Slack approval closer, QBO write after Rene approval.
5. ~~**NCS upload writeback**~~ — DONE 2026-04-24. Durable Drive storage replaces local FS.
6. **AP packet UI dashboard** — show every packet (not just JJ) with sent-status badges + send/record-sent buttons. ~1hr.

### Recommended next workflow after sample-shipping bridge

**Next workflow after vendor master creation:** persistent upload/writeback for NCS/vendor docs.
- Today: uploaded/customer/vendor files can still land in fragile places unless they are already in Drive.
- Build: replace `/api/ops/upload` local filesystem write with durable Drive or Blob storage, then point NCS/vendor document intake to it.
- Why this next: vendor master can now exist; document intake still needs durable storage so W-9/COI/customer forms are not lost on redeploy.

---

## Version history

- **1.1 — 2026-04-24** — Email-intel send-on-approve closed (commit `16fa4ea`). Sample-request → shipping bridge (S1.5) added with 9 tests. Top-5 list refreshed; vendor master creation flagged as next build.
- **1.2 — 2026-04-24** — Vendor master creation closed internally. Added `/ops/vendors/new`, `POST /api/ops/vendors/onboard`, `executeApprovedVendorMasterCreate()`, and Slack approval closer. QBO write is approval-gated; Notion/Drive dossier creation is best-effort until parent envs/scopes are verified.
- **1.3 — 2026-04-25** — Durable uploads and shipping artifacts reflected. Receipts intake moved from red/manual to yellow review-queue: email/Gmail/Drive receipt docs can be captured, but OCR and QBO posting remain blocked behind Rene review.
- **1.4 — 2026-04-29** — S1.4 Faire Direct invites moved from red to green (CLOSED LOOP). Phase 3 added: `directLinkUrl` field with approval-readiness rule, request-approval route, `executeApprovedFaireDirectInvite` closer (chain step 5 in `/api/slack/approvals` after AP-packet), Request-send-approval UI button. Send is via Gmail (operator-pasted Faire Direct URL), never via Faire's API. 52 new tests; cumulative full suite: 834 green.
- **1.5 — 2026-04-25** — S1.4 Phase 3.1: HubSpot contact-id fallback by email lookup landed in the Faire send closer (`src/lib/faire/hubspot-mirror.ts`). Read-only — never creates a contact, never patches lifecyclestage / deals / properties / tasks. +14 tests; full suite 848 green at commit `d08e4d5`. Phase 3.2: read-only follow-up queue (`/api/ops/faire/direct-invites/follow-ups` + `<FollowUpSection>` on `/ops/faire-direct`). 3-day "due soon" / 7-day "overdue" thresholds, most-stale-first sort, suggested-action copy. No writer for `followUpQueuedAt` ships; the field is forward-compat for the future Class B `faire-direct.follow-up` closer. +27 tests; full suite 875 green.
- **1.6 — 2026-04-25** — S1.4 Phase 3.3: Faire Direct follow-up draft-for-approval close-loop. New taxonomy slug `faire-direct.follow-up` (Class B, Ben), `markFaireFollowUpQueued` / `markFaireFollowUpSent` writers, `POST /follow-up/request-approval` route, `executeApprovedFaireDirectFollowUp` closer (Slack chain step 6, after the initial-invite closer), Request-follow-up-approval UI button + queued/sent badges. Reply-on-thread keeps the follow-up in the same Gmail conversation as the initial invite. Faire API never called; no HubSpot stages/properties touched. +45 tests; full suite 920 green. Pre-existing account UI lint errors (`<a>` → `<Link>`) in `src/app/account/AccountView.client.tsx` and `src/app/account/login/LoginForm.client.tsx` fixed inline since the swaps were trivial.
- **1.7 — 2026-04-25** — S1.6 Sales Command Center: read-only revenue-action roll-up at `/ops/sales` + `GET /api/ops/sales`. Aggregates Faire invites, follow-ups, AP packets, location drafts, pending Slack approvals; honestly marks wholesale-inquiries as `not_wired` (no list endpoint exists today). Pure aggregator helper in `src/lib/ops/sales-command-center.ts`; route is a thin server-side reader. No mutations, no buttons, only deep-links to existing surfaces. +16 tests; full suite 936 green. Green workflow count: 29 → 30.
- **1.8 — 2026-04-25** — S1.6 Phase 2: Sales Command compact section wired into the existing morning daily-brief composer (`src/lib/ops/control-plane/daily-brief.ts`) instead of creating a separate noisy digest. New `SalesCommandSlice` type, `composeSalesCommandSlice()` projection, `renderSalesCommandMarkdown()` Slack renderer; section appears on morning brief only, collapses to a quiet line when no actions, renders `not_wired` honestly (never as `*0*`), bounded under 12 lines, deep links to `/ops/sales`, `/ops/faire-direct`, `/ops/ap-packets`, `/ops/locations`. Source readers extracted to `src/lib/ops/sales-command-readers.ts` so both `/api/ops/sales` and `/api/ops/daily-brief` consume the same readers (no parallel implementations). +12 tests; full suite 948 green.
- **1.9 — 2026-04-25** — S1.6 Phase 3: Aging / SLA escalation across approvals, Faire follow-ups, AP packets, location drafts, and receipts. Pure helpers in `src/lib/ops/sales-aging.ts` (ageHours / ageDays / classifyAge / sortAging / selectTopAging / composeAgingBriefCallouts) with locked threshold registry per source (approvals 4h/24h/48h; follow-ups 3d/7d/14d; drafts 7d/14d/21d; receipts 2d/7d/14d; AP packets absent — schema has no readyAt). Source readers added to `sales-command-readers.ts` (`readApprovalAgingItems`, `readFaireFollowUpAgingItems`, `readApPacketAgingItems`, `readLocationDraftAgingItems`, `readReceiptAgingItems`, `readAllAgingItems`). Dashboard `/ops/sales` gains an "Aging / SLA" section with per-tier counts + top-10 actionable rows + a "Timestamp missing" sub-panel. Morning brief gains up to 3 critical-first aging callouts. Missing / unparseable / future timestamps surface honestly as `MissingTimestampItem` — never fabricated as `0` or `now`. +38 tests; full suite 990 green.
- **1.10 — 2026-04-25** — S1.6 Phase 4: Weekly Revenue KPI Scorecard grounded in the operational completion standard ($1M by Dec 24, 2026 EOD PT). Pure helpers in `src/lib/ops/revenue-kpi.ts` (`KPI_TARGET_USD`, `KPI_TARGET_DEADLINE_ISO`, `daysRemaining`, `requiredDailyPaceUsd`, `requiredWeeklyPaceUsd`, `composeRevenueKpi`, `formatUsdCompact`, `renderRevenueKpiBriefLine`). Read-only revenue readers in `src/lib/ops/revenue-kpi-readers.ts` (`readShopifyLast7d`, `readAmazonLast7d` with 6s timeout race, `readFaireLast7d`, `readB2BLast7d` honestly not_wired, `readUnknownChannelLast7d` permanent placeholder). Dashboard `/ops/sales` adds "Weekly KPI Scorecard" with six tiles + per-channel source list. Morning brief gains a one-line `Revenue pace: $X last 7d vs $Y required/wk — gap $Z` (or "Revenue pace not fully wired." when no channel is wired). Confidence rubric: full / partial / none across primary channels. NEVER fabricates a number — locked by tests. +40 tests; full suite 1030 green.
- **1.11 — 2026-04-25** — S1.6 Phase 5: B2B revenue wiring after a deliberate audit. QBO (no Class/CustomField channel attribution post-2026-03-29 reset) and HubSpot Closed-Won pipeline (forbidden as revenue) ruled out. Phase 1 source: paid Shopify orders with `tag:wholesale` (consistently applied by `/api/booth-order`). `queryPaidOrdersForBurnRate` extended with optional `tagFilter:{include?,exclude?}` (backward-compat). `readShopifyLast7d` now excludes the tag (DTC only); new async `readB2BLast7d` includes it. `B2B_SHOPIFY_TAG` exported so both filters reference the same string (drift guard). Confidence rubric promotes B2B into the primary set and now uses the literal primary set (omitted primaries can't fake "full" confidence). Static-source test asserts the readers module imports nothing from QBO, HubSpot, or `pipeline-cache` and never references `getWholesaleRevenue`. +15 tests; full suite 1045 green.
- **1.12 — 2026-04-25** — S1.6 Phase 6: Wholesale inquiry archive + auth-gated internal list API. New durable KV-backed archive (`src/lib/wholesale/inquiries.ts`) with capped index + per-record TTL. `/api/leads` mirrors wholesale submissions fail-soft (parallels existing Notion mirror; public form behavior preserved). New `GET /api/ops/wholesale/inquiries` auth-gated list endpoint with limit clamping. `readWholesaleInquiries` flipped from sync `not_wired` to async wired-from-KV; KV exception → `error` (never fabricated `wired:0`); empty archive → `wired:0` (real source-attested zero). Sales route + morning daily-brief route both await the async reader. Wholesale stays context-only — `anyAction` deliberately doesn't trip on positive count, so morning brief stays quiet. No HubSpot stage/lifecycle writes, no QBO writes, no Shopify changes. +30 tests; full suite 1075 green.
- **1.13 — 2026-04-25** — S1.6 Phase 7: Receipt OCR extraction (prepare-for-review only). Pure extractor `extractReceiptFromText(text, {now?})` in `src/lib/ops/receipt-ocr.ts` produces a `ReceiptOcrSuggestion { vendor, date, amount, currency, tax, last4, paymentHint, confidence, warnings, extractedAt, rawText }` envelope. NEVER fabricates: missing required fields → `null` + named warning; address/system-line vendor candidates rejected; impossible calendar dates rejected; labelled-total-only amount; currency never silent-defaults to USD. `ReceiptRecord` gains optional `ocr_suggestion`; new `attachOcrSuggestion` helper preserves status (`needs_review` stays `needs_review`) and never touches canonical review fields. New auth-gated `POST /api/ops/docs/receipt/ocr` accepts EITHER `{ ocrText }` (server-side extract) OR `{ suggestion }` (validated via `isReceiptOcrSuggestion`); both/neither = 400. Finance Review UI renders a non-promoting "OCR · suggestion" sub-row with confidence badge + warnings + "Suggestion only — review fields above are unchanged." footer. Static-source assertions lock no-QBO/no-HubSpot/no-Slack-send imports in both the extractor and the route. +57 tests; full suite 1132 green.
- **1.14 — 2026-04-25** — S1.6 Phase 8: Receipt-to-Rene approval promotion (review-packet only). Audit found NO `receipt.review.promote` slug in the canonical taxonomy; per fail-closed rule, the route does NOT invent one and does NOT open a Slack/control-plane approval. New pure builder `buildReceiptReviewPacket` (in `src/lib/ops/receipt-review-packet.ts`) produces a draft packet with per-field merge `{value, source: "canonical"|"ocr-suggested"|"missing"}` for vendor/date/amount/currency/category/payment_method. Canonical wins when present; OCR is fallback; missing stays missing. Eligibility rubric: `ok:true` iff vendor+date+amount+category all have values. `taxonomy.slug = null` + reason names the gap; envelope-level `taxonomy_status` mirrors. KV-backed store via `requestReceiptReviewPromotion`/`getReceiptReviewPacket`/`listReceiptReviewPackets` (deterministic `packetId = pkt-v1-<receiptId>`, idempotent overwrite, soft cap 500). Auth-gated `POST /api/ops/docs/receipt/promote-review` route. Receipt status preserved (`needs_review` stays `needs_review`); canonical fields never touched. Static-source assertions lock no-QBO/no-HubSpot/no-Slack-send/no-approvals-store imports in both helper and route — no `buildApprovalRequest` call possible. UI surfacing deferred to Phase 9. +34 tests; full suite 1166 green.
- **1.15 — 2026-04-25** — S1.6 Phase 9: Register `receipt.review.promote` (Class B, Rene) in the canonical taxonomy doc + code, and extend `POST /api/ops/docs/receipt/promote-review` to open a Class B Rene approval when the packet's `eligibility.ok` is true. Ineligible packets stay draft-only with a reason naming the missing fields. Idempotent on the approval store: re-promoting the same receipt returns the existing pending approval id (no duplicates). Receipt status preserved (the route never auto-promotes/demotes). Read-only on external systems: narrowed static-source assertion still locks out `qbo-client`/`qbo-auth`/`hubspot*`/`slack-(send|client)`/vendor-create/`createQBOBill`/`createQBOInvoice`/`createQBOJournalEntry`/direct `chat.postMessage`/`WebClient`. Builder default `taxonomy.slug` flipped from `null` to `"receipt.review.promote"`; reason updated to describe the review-only semantic and name `qbo.bill.create` as the future write path. Closer (auto packet `draft → rene-approved` on Slack approve) and UI button deferred to Phase 10. Approval-taxonomy doc bumped to v1.3. +5 net tests; full suite 1171 green.
- **1.16 — 2026-04-25** — S1.6 Phase 10: Receipt-review closer wires Rene's Slack approve/reject decision into a packet status transition. New pure helper `applyDecisionToPacket(packet, decision)` (approve→rene-approved, reject→rejected, ask→null, terminal-input→null idempotent). `ReceiptReviewPacket.status` union extended with `"rene-approved" | "rejected"`. Storage helper `updateReceiptReviewPacketStatus` mutates only the `status` field. Closer `executeApprovedReceiptReviewPromote` in `src/lib/ops/receipt-review-closer.ts` mirrors the AP-packet pattern: strict gating on `targetEntity.type === "receipt-review-packet"` + `pkt-v1-` id prefix + terminal approval state. Slotted into `/api/slack/approvals` AFTER the existing approve-only chain so it also fires on `rejected`. Posts a thread message in `#ops-approvals` describing the transition + naming `qbo.bill.create` as the still-separate future action. Audited via `receipt-review-promote.closer` action. Static-source assertion locks no qbo-client/qbo-auth/hubspot/shopify-*/slack-send-or-client/vendor-create/createQBO*-write/chat.postMessage/WebClient imports. UI button deferred to Phase 11. +16 tests; full suite 1187 green.
- **1.0 — 2026-04-24** — First publication. Synthesizes 2 division-audit agent reports + 5 P0 deliverables + email-intelligence build. Replaces ad-hoc workflow descriptions across other contract docs.
