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

#### Phase 11 — "Request Rene review" UI button on `/ops/finance/review` (NEW)
- **Why:** Phases 7-10 closed the server-side loop, but Rene/Ben still had to call `POST /api/ops/docs/receipt/promote-review` from operator tooling to open an approval. Phase 11 surfaces that action inline on the existing Finance Review dashboard so reviewers can initiate the Rene-review flow without leaving the page.
- **Architecture:**
  - **Pure presenter** in `src/app/ops/finance/review/data.ts`: `derivePromoteReviewPill(state) → { variant, label, color, detail }`. Five state kinds: `idle | loading | opened | draft-only | error`. Pure → unit-testable in `__tests__/data.test.ts` without React rendering.
  - **Per-row state** in `FragmentRow` (`FinanceReviewView.client.tsx`): `useState<PromoteReviewState>({ kind: "idle" })`. The button's `onClick` flips to `loading`, calls a thin `promoteReviewRequest(receiptId)` helper, and stores the next state.
  - **`promoteReviewRequest`** is a small client-side fetch wrapper that POSTs to `/api/ops/docs/receipt/promote-review` (the Phase 9 route) with `{ receiptId }`, parses the response, and projects it into a `PromoteReviewState` value. Eligible (`approval.opened: true`) → `opened` with id/status/approvers; ineligible (`approval.opened: false`) → `draft-only` with the verbatim reason + missing-fields list; non-200 → `error` with the underlying message.
  - **Two new visible columns/rows**:
    - A new "Rene review" header column carrying the per-row "Request Rene review" button.
    - A conditional **promote sub-row** that renders only after the operator clicks. Mirrors the OCR sub-row layout (label cell + colSpan body) and footers with "Read-only — review fields above are unchanged. QBO posting still runs through a separate `qbo.bill.create` action."
  - **OCR sub-row updated**: `colSpan` bumped from `3` to `4` to match the new 8-column header.
- **Hard rules locked by 11 new tests:**
  - **Read-only render.** No inline edit of canonical fields. The button NEVER auto-fires `qbo.bill.create`, NEVER creates vendors/categories, NEVER guesses fields.
  - **idle → "Request Rene review"** label, neutral color, empty detail.
  - **loading → "Requesting…"** label, neutral color.
  - **opened → green pill** with approval status + truncated 8-char id + approvers list. Defensive: empty approver list renders as `(none)` not silent empty string.
  - **draft-only → amber pill** with the route's verbatim reason. When `missing[]` is non-empty, appends `· missing: vendor, amount, ...`. When `missing[]` is empty/absent, NO stray `· missing:` suffix.
  - **error → red pill** with the underlying error verbatim. NEVER paraphrases (`ECONNREFUSED` stays `ECONNREFUSED`; tests lock this for both `error` and `draft-only` paths).
  - **Determinism.** `derivePromoteReviewPill(state)` is pure — same input → same output.
- **Tests (Phase 11):** 11 new in `src/app/ops/finance/review/__tests__/data.test.ts` covering each state kind + the no-paraphrase invariant + the empty-approvers/empty-missing edge cases + determinism. Full suite: **1197 green** (was 1187).
- **What's NOT in this commit:**
  - **Slack-thread permalink** — the route doesn't yet return a permalink, so the pill renders the truncated approval id only. Phase 12 will add the permalink once the slack-approvals surface returns one.
  - **Polling/auto-refresh** — once Rene clicks approve/reject in Slack, the operator currently has to refresh the page to see the packet's new status. Phase 12/13 may add a per-row poll.
- **Monday MVP:** 🟢 — Reviewers can request a Rene approval directly from `/ops/finance/review` without context-switching to a script or tooling shell. Eligible packets show their `approval.id` + status inline in green; ineligible packets show the reason in amber so the reviewer knows exactly which canonical field to fill before re-clicking.

#### Phase 12 — Slack-thread permalink + per-row poll for closer transition (NEW)
- **Why:** Phase 11 surfaced the approval id + status inline but the operator still had to copy the id, jump to `#ops-approvals`, and find the thread by hand. They also had to refresh the page to see Rene's `rene-approved`/`rejected` decision reflected in the pill once Phase 10's closer ran. Phase 12 closes both gaps with read-only additions: a Slack-thread permalink in the route response, and a bounded per-row poll on the pill that updates the label as soon as the closer flips the packet.
- **Architecture:**
  - **`getPermalink(channel, message_ts)`** added to `src/lib/ops/control-plane/slack/client.ts`. Read-only `chat.getPermalink` call. Returns `null` on degraded mode (`SLACK_BOT_TOKEN` missing), empty channel/ts, or Slack rejection. Defensive — never throws.
  - **`POST /api/ops/docs/receipt/promote-review`** refactored: builder helper now produces the *params* object; the route uses `openApproval(store, surface, params)` instead of `buildApprovalRequest + store.put` so `slackThread` is populated by `surfaceApproval`. New `resolveApprovalPermalink(approval)` runs immediately after open + on the idempotent path. Response's eligible `approval` envelope gains `permalink: string | null`.
  - **`GET /api/ops/docs/receipt-review-packets/[packetId]`** — new auth-gated read-only route. Returns `{ ok, packetId, receiptId, packetStatus, approvalStatus, approvalId }`. Looks up the matching approval via `store.listPending()` first, then falls back to `store.listByAgent("ops-route:receipt-promote", 50)` for terminal-state lookups. **No mutation** — locked by static-source assertion: no `qbo*`/`hubspot*`/`shopify-*`/`slack-(send|client)`/`createQBO*-write`/`chat.postMessage`/`WebClient`; no `openApproval`/`buildApprovalRequest`; only `GET` exported.
  - **Pill helper extension** in `src/app/ops/finance/review/data.ts`: `PromoteReviewState.opened` gains optional `permalink?: string | null` and `packetStatus?: "draft" | "rene-approved" | "rejected"`. `PromoteReviewPill` gains `permalink?: string | null`. The `opened` derivation flips:
    - `packetStatus === "rene-approved"` → label `"Rene approved"`, color `green`.
    - `packetStatus === "rejected"` → label `"Rene rejected"`, color **amber** (visible gap signal).
    - `packetStatus === "draft"` (or undefined) → label `"Approval opened · pending"`, color `green`.
  - **Per-row poll** in `FragmentRow` (`FinanceReviewView.client.tsx`): once `promoteState.kind === "opened"` AND `packetStatus !== "rene-approved" | "rejected"`, a `setInterval` fires `fetchPacketStatus(packetId)` every `POLL_INTERVAL_MS` (30s) for at most `POLL_MAX_TICKS` (6) ticks. On each tick: if the GET returns a packetStatus, update the per-row state; on terminal status, clear the interval. On any failure (404/500/network throw), the poll silently stops — pill keeps its last-known state.
  - **UI link**: when `pill.permalink` is non-null, the promote sub-row renders an `Open thread →` anchor (`target="_blank" rel="noopener noreferrer"`) in the pill's color. When null, no link is rendered (no fabrication).
- **Hard rules locked by 15 new tests:**
  - **`pill.permalink` is `null`** (NOT undefined, NOT empty string) when the route returns a missing/empty permalink. Locked at the `derivePromoteReviewPill` boundary.
  - **`pill.permalink` is `undefined`** for non-opened states (idle/loading/draft-only/error) — they never carry a Slack URL.
  - **`packetStatus = rene-approved`** → label `"Rene approved"`, color `green`.
  - **`packetStatus = rejected`** → label `"Rene rejected"`, color `amber` (the deliberate "rejection is a visible gap" signal — locked).
  - **Status route 401** when `isAuthorized` rejects.
  - **Status route 400** on whitespace-only `packetId`.
  - **Status route 404** when packet not found in KV.
  - **Status route 200** with `packetStatus: "draft"` and `approvalStatus: null` for a freshly-promoted packet that hasn't been Rene-decided.
  - **Status route reflects `rene-approved`** after `updateReceiptReviewPacketStatus` runs (closer simulation).
  - **Status route reflects `rejected`** after closer rejection.
  - **Status route NEVER mutates** — multiple GETs leave the packet in `draft`. Locked by re-read assertion.
  - **Status route static-source**: no QBO/HubSpot/Shopify/Slack-send imports; no `openApproval`/`buildApprovalRequest`; only `GET` exported.
  - **Phase 9 eligible response now carries `approval.permalink`** — locked as `null` in test env (SLACK_BOT_TOKEN unset → degraded mode → `ts: ""` → `getPermalink` returns null). The route NEVER invents a Slack URL.
- **Tests (Phase 12):** 8 new in `src/app/ops/finance/review/__tests__/data.test.ts` (permalink: null/verbatim/empty-string-defensive/non-opened-states-undefined; packetStatus: rene-approved + rejected + draft) + 6 new in `src/app/api/ops/docs/receipt-review-packets/[packetId]/__tests__/route.test.ts` (401, 400, 404, 200 happy path with null approvalStatus, packetStatus reflects closer transitions in both directions, multiple GETs don't mutate, no-forbidden-imports static assertion) + 1 reframed Phase 9 test asserting `permalink: null` in test env. Full suite: **1212 green** (was 1197).
- **What's NOT in this commit:**
  - **Aggregate dashboard for review packets** — operator currently sees per-row state only. A future Phase 13 sub-lane could add a `/ops/finance/review-packets` dashboard listing every packet with its current status + approval id.
  - **`qbo.bill.create` auto-fire from `rene-approved`** — explicitly out of scope; remains a separate Class B/C action.
- **Monday MVP:** 🟢 — When Rene clicks approve in `#ops-approvals`, the operator's `/ops/finance/review` pill flips to `"Rene approved"` within 30 seconds — without leaving the page. The green pill links straight to the Slack thread for context. Rejection shows amber so the gap stays visible. Bounded poll (max 3 minutes) keeps the client cheap and predictable.

#### Phase 13 — Aggregate review-packets dashboard at `/ops/finance/review-packets` (NEW)
- **Why:** Phases 7–12 closed the per-row loop on `/ops/finance/review`, but the operator could only see one packet at a time (one per receipt row). Phase 13 surfaces the *whole* packet pipeline in a single view — every packet's current status (`draft` / `rene-approved` / `rejected`), vendor, amount, eligibility, and creation time — so Rene/Ben can scan the queue at a glance.
- **Architecture:**
  - **List route** `GET /api/ops/docs/receipt-review-packets` — auth-gated, read-only. Returns `{ ok, count, limit, packets }`. `limit` clamped server-side to [1, 500] (default 100). KV exception → HTTP 500 with reason; never returns `count: 0` silently.
  - **Pure helper** `buildReviewPacketsView(packets)` in `src/app/ops/finance/review-packets/data.ts`:
    - Projects each packet into a `ReviewPacketRow` with `{ packetId, packetIdShort, receiptId, status, color, vendor, vendorSource, amountUsd, amountSource, eligibilityOk, eligibilityMissing, createdAt }`.
    - **Sort:** draft-first (because draft = "still actionable"), then most-recent-first by `createdAt` within tier. Locked by test.
    - **Status → color:** `draft → amber`, `rene-approved → green`, `rejected → red`. Locked.
    - **Vendor / amount:** canonical wins, OCR fallback, `null` + source `"missing"` when neither has a value. NEVER fabricated. Source attribution surfaced on the row so the UI can append `(ocr)` for OCR-only values.
    - **Counts:** `{ total, draft, reneApproved, rejected }` derived verbatim from the rows. No inflation.
    - **Pure:** same input → same output; doesn't mutate the input array.
  - **Format helpers** `formatAmountCell` / `formatVendorCell` produce display strings — `"—"` for null/empty, `(ocr)` suffix on OCR-suggested values. NaN/Infinity treated as null defensively.
  - **Server page** `src/app/ops/finance/review-packets/page.tsx` — thin server component. Auth gating handled by `src/middleware.ts` (existing `/ops/*` rule).
  - **Client view** `ReviewPacketsView.client.tsx` — fetches the list route, renders a counts strip ("N packets · X draft · Y rene-approved · Z rejected") + table with color-coded status pills. Refresh button. Empty / loading / error states explicit.
- **Hard rules locked by 28 new tests:**
  - **Sort order:** draft-first, then most-recent-first by createdAt. Locked with a 5-packet fixture across all three statuses + multiple createdAt values.
  - **Counts derivation:** verbatim from rows; empty input → all-zero counts; never inflates.
  - **Status → color:** `draft → amber`, `rene-approved → green`, `rejected → red` — independent assertions per status.
  - **Vendor fallback:** canonical wins; OCR-only fills; missing on both → `null` + source `"missing"`. The vendor source is surfaced on the row so the UI can render `(ocr)` next to OCR values.
  - **Amount fallback:** same canonical-then-OCR rule. NaN/Infinity → null defensively.
  - **Eligibility flags:** `eligibilityOk` and `eligibilityMissing` surfaced verbatim from the original packet build.
  - **packetIdShort:** ≤14 char ids pass through; longer ids truncate to 14 chars + `…`.
  - **Determinism:** same input → same output; input array not mutated.
  - **`formatAmountCell`:** null → `"—"`; canonical → `"$N.NN"`; ocr-suggested → `"$N.NN (ocr)"`; NaN/Infinity → `"—"`.
  - **`formatVendorCell`:** null/empty/whitespace → `"—"`; canonical verbatim; ocr-suggested adds `(ocr)` suffix.
  - **List route:** 401 on auth fail; 200 with empty list when no packets; 200 with packets verbatim; `limit` clamped (`limit=0`/`limit=-5`/`limit=999999` all safe); 500 on KV throw with reason — never `count: 0` silently.
  - **List route static-source:** no `qbo*`/`hubspot*`/`shopify-*`/`slack-(send|client)`/`createQBO*-write`/`chat.postMessage`/`WebClient` imports; no `import { openApproval }` / `openApproval(`/ `import { buildApprovalRequest }` / `buildApprovalRequest(`. Only GET exported.
- **Tests (Phase 13):** 22 new in `src/app/ops/finance/review-packets/__tests__/data.test.ts` (sort, counts, status→color, vendor/amount fallback, eligibility surfacing, packetIdShort truncation, determinism, format-cell helpers) + 6 new in `src/app/api/ops/docs/receipt-review-packets/__tests__/route.test.ts` (auth gate, empty list, packets returned, limit clamping, KV-throw 500, no-forbidden-imports static assertion). Full suite: **1240 green** (was 1212).
- **What's NOT in this commit:**
  - **Inline re-promote action** on the dashboard table — operator currently re-promotes from the per-row Phase 11 button on `/ops/finance/review`. A future Phase 14 may add an inline "Re-promote" button (still using the Phase 9 route — no new write paths).
  - **Filters** (status / vendor / date range) — Phase 14 will add operator-driven filters on the table.
- **Monday MVP:** 🟢 — Rene/Ben open `/ops/finance/review-packets` and see every receipt review packet in one read-only view, color-coded by status, with eligibility gaps visible on draft rows. Counts strip at top summarizes the queue. Reuses Phase 8/9/10/12 storage + closer; no new write paths.

#### Phase 14 — Filters + inline Re-promote on the aggregate dashboard (NEW)
- **Why:** Phase 13 surfaced every packet in one view, but at scale the operator needs to narrow the queue (status, vendor, date range) and to re-promote a packet without context-switching back to `/ops/finance/review`. Phase 14 adds operator filters + an inline Re-promote button per row that reuses the existing Phase 9 route. Read-only render contract preserved — no new server routes, no new write paths.
- **Architecture:**
  - **Pure helper** `applyReviewPacketsFilters(view, spec)` in `src/app/ops/finance/review-packets/data.ts`. Takes the built `ReviewPacketsView` + a `ReviewPacketsFilterSpec` and returns a new view with filtered rows + recomputed counts. Does NOT mutate the input.
  - **Filter spec** (all optional): `status: "all" | "draft" | "rene-approved" | "rejected"`; `vendorContains: string` (case-insensitive substring against the formatted vendor cell, including the `(ocr)` suffix); `createdAfter` / `createdBefore` (ISO date or date-time, parsed via `Date.parse`).
  - **Defensive defaults**: `status: "all"` / undefined / empty-string vendor / whitespace-only vendor / unparseable `createdAfter` / `createdBefore` all collapse to "no filter" — keystroke errors NEVER hide rows. A row whose `createdAt` is itself unparseable is excluded under any active date filter (we don't show data we can't position in time).
  - **Counts always recomputed** from the filtered rows verbatim — no cached aggregate, no inflation.
  - **Filter strip** rendered above the table: status `<select>` (All / Draft / Rene approved / Rejected), vendor `<input type="text">`, two `<input type="date">` for the range, and a "Clear filters" button that's only visible when at least one filter is active.
  - **Counts strip** flips to show `(filtered)` in gold when filters are active so the operator knows the totals reflect the narrowed view.
  - **Empty-state copy** branches: filters active → `"No packets match the current filters. Try clearing them."`; otherwise the original empty-state.
  - **Inline Re-promote button** in a new "Action" column on each row. `onClickRepromote(receiptId)` POSTs to `/api/ops/docs/receipt/promote-review` (Phase 9 route). On success, the per-row state flips to "Re-promote queued" and the list refreshes (so any new approval / status change shows up). On failure, the per-row pill flips to red with the underlying error verbatim.
  - **Per-row state** stored in a `Record<string, "loading" | "ok" | { error: string }>` map keyed on `receiptId`. Cleared on every refresh so a stale state can't linger past a fresh load.
- **Hard rules locked by 15 new tests:**
  - **No new server routes.** Re-promote reuses `POST /api/ops/docs/receipt/promote-review` (Phase 9). The list route is unchanged.
  - **Read-only render.** No inline edit of canonical fields. No auto-fire of `qbo.bill.create`. No vendor creation. No category guess.
  - **Pure filter helper.** Same input + same spec → same output. Input view not mutated. Counts recomputed verbatim.
  - **`status: "all"` (or undefined) → no status filter.**
  - **Empty / whitespace-only vendor → no vendor filter.** Locked separately — defensive.
  - **Vendor matching is case-insensitive AND tolerates the `(ocr)` suffix** so `"belmark"` matches an OCR-suggested `"Belmark Inc (ocr)"`.
  - **Unparseable date filters → no filter applied** (NEVER hides rows on a keystroke error).
  - **Row with unparseable `createdAt` excluded under any active date filter** (no silent inclusion of un-positionable data).
  - **Combined filters AND together** (status + vendor + date range narrow correctly).
  - **Filter that excludes everything → empty rows + zero counts** (no fabrication).
- **Tests (Phase 14):** 15 new in `src/app/ops/finance/review-packets/__tests__/data.test.ts`: no-spec passthrough; status filter + counts; "all" = undefined; vendor case-insensitive; vendor matches OCR cells; vendor empty/whitespace = no filter; createdAfter / createdBefore / range; unparseable dates = no filter; combined-filter AND; exclude-all → empty; non-mutation; pure determinism; unparseable createdAt excluded under date filter. Full suite: **1255 green** (was 1240).
- **What's NOT in this commit:**
  - **Per-row poll on the aggregate dashboard** — the list refresh happens on Re-promote success and on the Refresh button. Phase 15 may add a passive poll.
  - **Server-side filtering** — filtering runs entirely client-side over the limit-100 page. Phase 15 may push filters into the list route's query string for larger datasets.
  - **`qbo.bill.create` auto-fire** — explicitly out of scope.
- **Monday MVP:** 🟢 — Rene/Ben can narrow the receipt-review queue by status + vendor + date range, and re-promote a stale packet with one click — without leaving `/ops/finance/review-packets`. Counts strip flips to show `(filtered)` so the totals never mislead. Re-promote always reuses the existing Phase 9 route — no new write paths landed.

#### Phase 15 — Server-side filtering + bounded passive poll (NEW)
- **Why:** Phase 14 ran filters entirely client-side over the limit-100 page payload. As the queue grows, that becomes wasteful (the server ships every packet just for the client to discard most of them) and slow. Phase 15 pushes the canonical filter spec into the list route's query string AND adds a bounded passive poll on the aggregate dashboard so closer transitions land inline without the operator clicking Refresh. Both run through the SAME pure helper (`filterPacketsBySpec`) so client and server filter behavior stays bit-identical — locked by test.
- **Architecture:**
  - **Server-safe canonical helper.** `applyReviewPacketsFilters` already lives in `src/app/ops/finance/review-packets/data.ts` with no `"use client"` directive and zero React imports. Phase 15 adds three new pure helpers in the same file (still server-safe):
    - `parseReviewPacketsFilterSpec(query)` — `URLSearchParams` (or any `{ get(name) }`) → `ReviewPacketsFilterSpec`. Reads only the four canonical params (`status`, `vendor`, `createdAfter`, `createdBefore`); ignores extras (URL tracking compatibility); collapses unknown / empty / whitespace values to `undefined` (= "no filter").
    - `reviewPacketsFilterSpecToQuery(spec)` — inverse projection. Skips `status: "all"` (default at server) and skips empty/whitespace string fields. `parse(serialize(x))` round-trips for typical inputs.
    - `filterPacketsBySpec(packets, spec)` — server-side helper that internally projects through `buildReviewPacketsView` + `applyReviewPacketsFilters`, then maps the filtered rows back to a `Set<packetId>` and returns matching packets in input order. **Lockstep guarantee** locked by a parity test that asserts the server's packetId set is bit-identical to the client helper's.
  - **List route extension** at `GET /api/ops/docs/receipt-review-packets`:
    - Parses the four canonical query params via `parseReviewPacketsFilterSpec` (server-safe — same helper as the client).
    - Applies `filterPacketsBySpec(packets, spec)` only when at least one filter is non-default. `status=all` collapses to no-filter.
    - Response gains `totalBeforeFilter: number` (operator can compare against `count` to see "filter narrowed N → M") and `filterApplied: boolean`.
    - Auth gate, limit clamp, KV-throw → HTTP 500 contract all unchanged.
    - Static-source assertion still locks no-mutation imports.
  - **Client view** (`ReviewPacketsView.client.tsx`):
    - `fetchPackets(spec)` now serializes the spec via `reviewPacketsFilterSpecToQuery` before fetching — server pre-filters.
    - Defensive client-side `applyReviewPacketsFilters` belt remains so a stale route version can't silently widen the rendered set.
    - **Bounded passive poll**: 60s × 10 ticks (10 min worst case) increments `refreshKey`; the existing fetch effect re-fires. Stops on the final tick, on unmount, and naturally re-arms when filters change (the effect re-runs with a new `filterSpec` identity).
- **Hard rules locked by 24 new tests:**
  - **`status` whitelist** — known values pass; unknown values collapse to `undefined`.
  - **Empty / whitespace string params omitted** — keystroke errors never become unintended filters.
  - **Unknown / extra query params ignored** — `utm_source`, `random`, etc., don't affect filter behavior.
  - **Round-trip**: `parseReviewPacketsFilterSpec(reviewPacketsFilterSpecToQuery(spec)) === spec` for typical inputs.
  - **Serialization trims** string fields and skips empty / `"all"` defaults.
  - **`filterPacketsBySpec` lockstep** — packetId set bit-identical to `applyReviewPacketsFilters` over the same view.
  - **Input order preserved** in `filterPacketsBySpec` (the route returns raw packets; the client re-derives the view).
  - **Non-mutation** of the input packets array.
  - **Pure determinism** — same input + same spec → same output.
  - **Server route**: no filter params → `count === totalBeforeFilter`, `filterApplied: false`. Vendor narrows server-side. `status=draft` narrows. `status=all` collapses to `filterApplied: false`. Far-future `createdAfter` filters all packets out (`count: 0`). Server filter result equals the canonical client helper's output. Unknown query params ignored.
- **Bounded poll discipline** — matches Phase 12's per-row poll: clear interval on unmount, re-arm only on user interaction, no exponential backoff, no auth-failure noise, no log spam on success.
- **Tests (Phase 15):** 17 new in `src/app/ops/finance/review-packets/__tests__/data.test.ts` (parser cases + serializer cases + round-trip + `filterPacketsBySpec` lockstep + 4 invariants) + 7 new in the route tests (no filter / vendor / status / status=all / date range / lockstep / unknown params). Full suite: **1279 green** (was 1255).
- **What's NOT in this commit:**
  - **Approval-status filter** — the route doesn't yet filter by `approvalStatus` (pending / approved / rejected). The packet's `status` field already covers terminal state via the closer; approval-status would require a join through `approvalStore`. Defer.
  - **Pagination** — `limit` is still a single page. For >500 packets we'd need cursor-based pagination. Phase 16 territory.
- **Monday MVP:** 🟢 — Server pre-filters via the same canonical helper as the client. The bounded passive poll keeps the aggregate dashboard live without operator clicks; closer transitions land inline within 60 seconds. No new write paths landed.

#### Phase 16 — Approval-status filter (control-plane state) (NEW)
- **Why:** Phases 13–15 surfaced the *packet* state (`draft` / `rene-approved` / `rejected`) and let the operator filter on it, but a `draft` packet with a `pending` approval is in a different operational state than a `draft` packet that's never been promoted. Phase 16 adds an approval-status dimension so reviewers can ask "which packets are sitting in `#ops-approvals` waiting for Rene's click?" without leaving the dashboard. Read-only on external systems — no new write paths.
- **Why this over cursor pagination (the other Phase 16 candidate):** approval-status surfaces operationally meaningful state distinctions today, even at low volume; cursor pagination only matters once the queue exceeds the existing 500-packet cap (~6 months out at current ingress rates). Both stay open as future phases.
- **Architecture:**
  - **`ReviewPacketRow` extended** with `approvalId: string | null` and `approvalStatus: string | null`. NEVER fabricated — `null` when the packet has no associated approval.
  - **`ApprovalsByPacketId`** — exported `Map<packetId, { id, status }>` shape. The list route builds it; the canonical view helper consumes it.
  - **`buildReviewPacketsView(packets, approvalsByPacketId?)`** — accepts the optional lookup map. Phase 13/14 callers (no map) get rows with `{approvalId: null, approvalStatus: null}` and continue to work unchanged.
  - **`applyReviewPacketsFilters`** gains an `approvalStatus` clause supporting `"any"` (default), `"no-approval"`, and exact matches against `"pending"` / `"approved"` / `"rejected"` / `"expired"` / `"stood-down"`. Locked by tests for each value.
  - **`filterPacketsBySpec(packets, spec, approvalsByPacketId?)`** — server-side filter accepts the same map. Without it, only `"any"` and `"no-approval"` can match anything (locked by test — defensive: a route that forgets the map can't accidentally match arbitrary statuses).
  - **`parseReviewPacketsFilterSpec` / `reviewPacketsFilterSpecToQuery`** — extended with `approvalStatus`. Unknown values defensively collapse to `undefined`. `"any"` is omitted from the serialized query so the route default applies.
  - **List route** (`GET /api/ops/docs/receipt-review-packets`):
    - New `buildApprovalLookup()` helper builds the `ApprovalsByPacketId` map from `approvalStore.listPending()` (pending entries win on conflict) + `approvalStore.listByAgent("ops-route:receipt-promote", 200)` (terminal-state fallback for the operator-route's promote-review agent). Both sources fail-soft — partial maps are returned rather than throwing.
    - Response gains `approvals: Record<packetId, { id, status }>` so the client can attach approval state without a second fetch.
    - `filterApplied` now also detects an active `approvalStatus` filter.
    - Static-source no-mutation contract still holds.
  - **Client view** gains an "Approval" `<select>` (Any / No approval / Pending / Approved / Rejected / Expired / Stood down) and a new "Approval" table column color-coded by status (approved=green, pending=amber, rejected=red, others=dim). The clear-filters button resets it back to `"any"`. The bounded passive poll (Phase 15) re-arms when the spec changes — already wired.
- **Hard rules locked by 23 new tests:**
  - **Approval enrichment honest** — view rows have `approvalId/Status: null` when no map is passed, when the map omits the packet, OR when the route-side join fails. Locked.
  - **Filter values whitelisted** — only the seven canonical strings parse; unknowns / empty / whitespace collapse to undefined.
  - **`"any"` (or undefined) → no filter** at both `applyReviewPacketsFilters` and `parseReviewPacketsFilterSpec`.
  - **`"no-approval"` matches only rows whose `approvalStatus` is null.** Locked separately.
  - **Specific statuses match exactly** — `"pending"` doesn't match `"approved"` and vice versa.
  - **Combines AND with status / vendor / date filters.** Locked with a multi-filter fixture.
  - **Counts re-aggregate after the filter.** Locked.
  - **Without map, `approvalStatus !== "any" | "no-approval"` → empty** (defensive — route that forgets the map never silently widens the rendered set).
  - **Lockstep parity** — `filterPacketsBySpec(packets, spec, map)` packetId set equals `applyReviewPacketsFilters(view, spec)` row packetId set when `view = buildReviewPacketsView(packets, map)`. Locked.
  - **Round-trip** — `parse(serialize({approvalStatus: "no-approval"})) === input`.
  - **Route end-to-end** — response carries an `approvals` lookup; `approvalStatus=any` does not flip `filterApplied`; `approvalStatus=no-approval` correctly counts unpromoted packets in test env (where no approvals are seeded); `approvalStatus=pending` returns zero in test env; unknown values collapse to no-filter.
- **Tests (Phase 16):** 18 new in `src/app/ops/finance/review-packets/__tests__/data.test.ts` (3 enrichment + 7 filter cases + 3 parser + 3 serializer round-trip + 2 server-filter parity) + 5 new in route tests (`approvals` map present, `approvalStatus=any` no-filter, `no-approval` matches all unpromoted, `pending=0` in test env, unknown value defensively collapses). Full suite: **1302 green** (was 1279).
- **What's NOT in this commit:**
  - **Cursor-based pagination** — list route still single page (limit 500). Phase 17+ when data scales.
  - **Server-side caching of the approval lookup** — currently rebuilt on every request. Sufficient for current operator volume; revisit if route latency becomes a concern.
  - **`qbo.bill.create` auto-fire from `rene-approved`** — explicitly out of scope.
- **Monday MVP:** 🟢 — Reviewers can ask "what's stuck in `#ops-approvals` waiting for Rene right now?" via a single dropdown. Each row's approval state is visible at a glance, color-coded, and re-aggregates the count when filtered. Lockstep client/server semantics still locked by parity test.

#### Phase 17 — Cursor-based pagination on the list route (NEW)
- **Why:** The aggregate dashboard's underlying storage caps at 500 packets — at current ingress rates that buys roughly 6 months of runway before the queue starts dropping records off the back. Phase 17 adds deterministic cursor-based pagination so the queue stays scrollable past 500 packets, with a "Load more" button that preserves operator scroll state. Read-only — no new write paths.
- **Architecture:**
  - **Cursor codec** in `data.ts`: `encodeReviewPacketCursor({ts, packetId})` → `base64url(JSON.stringify({ts, packetId}))`. Opaque to the client; the client treats `nextCursor` verbatim and sends it back as `?cursor=...` for the next page.
  - **`decodeReviewPacketCursor(cursor)`** is defensive — returns `null` for null/undefined/empty/whitespace, malformed base64, valid base64 but non-JSON payload, JSON missing `ts` or `packetId`, wrong types, OR empty `packetId` (the last guards against pagination loops). Locked by 8 separate test cases.
  - **`paginateReviewPackets(packets, {limit, cursor?})`** — pure helper. Returns `{page, nextCursor}`. Sorts internally via the canonical comparator (`createdAt DESC, packetId ASC` tie-break) so callers don't have to. `limit` clamped to [1, 500]. `nextCursor` is `null` when fewer than `limit` items remain. Malformed cursor falls back to first page.
  - **Canonical sort** is `createdAt DESC, packetId ASC`. Locked by test that traverses 5-packet fixture (with two ties on `createdAt`) and asserts every packet visited exactly once in deterministic order.
  - **List route** (`GET /api/ops/docs/receipt-review-packets`):
    - Loads the full sorted set via existing `listReceiptReviewPackets({limit: 500})` (storage helper unchanged — backwards compat).
    - Applies the canonical filter spec.
    - Paginates the FILTERED set (so cursor traversal of e.g. `?approvalStatus=pending` doesn't show half-empty pages).
    - Response gains `matchedTotal: number` (full filtered length, distinct from `count` = page length) and `nextCursor: string | null`.
    - The `approvals` lookup is now scoped to the current page's packets — irrelevant entries are dropped.
  - **Client view**:
    - New `nextCursor`, `matchedTotal`, `loadingMore`, `pageCount` state.
    - Filter change / refresh / passive poll → reset `pageCount` to 1, replace view entirely.
    - **Load more button** (rendered when `nextCursor` present): fetches the next page and APPENDS rows + recomputes counts client-side. Preserves operator scroll state.
    - **End of queue** label rendered when `nextCursor` is null.
    - **Showing X of Y** label visible when paginated (`matchedTotal !== rows.length`) or `pageCount > 1`.
    - **Phase 15 bounded passive poll** now skips when `pageCount > 1` — yanking accumulated rows mid-scroll is worse than slightly stale data; manual Refresh is one click.
- **Hard rules locked by 24 new tests:**
  - **Cursor opacity** — encoded cursor matches base64url charset only; no plaintext leakage of `packetId`.
  - **Round-trip** — `decode(encode(x)) === x` for typical cursors.
  - **Defensive decode** — null / undefined / empty / whitespace / malformed-base64 / non-JSON / missing-fields / wrong-types / empty-packetId all return `null`. Locked separately.
  - **Pagination determinism** — first page is most-recent-first; traversing all pages visits every packet exactly once with no duplicates; tie-break on `packetId` ASC is stable across pages.
  - **`nextCursor` is null** when fewer than `limit` items remain.
  - **`limit` clamped to [1, 500]** at the helper boundary.
  - **Malformed cursor → first page** (defensive — never throws).
  - **Empty input → empty page + null cursor** (no fabrication).
  - **No input mutation.**
  - **Filter+paginate composition idempotent** — filtering an empty set then paginating returns empty page + null cursor.
  - **Route end-to-end:** `nextCursor` non-null when more remain; `nextCursor` null on final page; full-traversal hits every packet exactly once; malformed cursor falls back to first page; filters apply BEFORE pagination (cursor over filtered set); `approvals` lookup scoped to current page; `matchedTotal === totalBeforeFilter` when no filter applied.
- **Tests (Phase 17):** 17 new in `src/app/ops/finance/review-packets/__tests__/data.test.ts` (8 codec + 9 paginate) + 7 new in `src/app/api/ops/docs/receipt-review-packets/__tests__/route.test.ts` (cursor present/null/traversal/malformed/filter-precedence/approvals-scoped/matchedTotal-equals-total). Full suite: **1326 green** (was 1302).
- **What's NOT in this commit:**
  - **Storage cursor** — `listReceiptReviewPackets` still returns a single packet array (capped at 500 by KV storage). For >500 rows a future phase would shard the storage or paginate at the storage layer.
  - **Server-side caching of the approval lookup** — still rebuilt on every request. Sufficient for current operator volume.
  - **`qbo.bill.create` auto-fire from `rene-approved`** — explicitly out of scope.
- **Monday MVP:** 🟢 — The dashboard scrolls past 500 packets without losing operator state. "Load more" appends pages; passive poll respects accumulated pages. Cursor traversal is deterministic over the canonical sort order even with timestamp ties. No new write paths landed.

#### Phase 18 (Option A) — CSV export of the filtered review-packets queue (NEW)
- **Why:** Phase 17 closed the queue-management half — operators can scroll, filter, and act on the queue from the dashboard. Phase 18 adds a one-click CSV export so finance ops can hand the filtered queue to others (auditors, accounting, Rene's spreadsheet workflows) without the operator copy-pasting cells. Read-only — no new write paths.
- **Why this over caching (Option B) or `qbo.bill.create` entry (Option C):** Option A delivers immediate operator value and stays inside the read-only contract. Option B is premature optimization at current operator volume. Option C crosses the QBO-write boundary and would need a new taxonomy slug registered with Ben first.
- **Architecture:**
  - **Pure helpers** in `data.ts`:
    - `escapeCsvCell(value)` — RFC-4180-compatible cell escaping. Quotes cells containing `,` / `"` / `\n` / `\r` / leading-or-trailing whitespace. Doubles internal `"` per RFC. Returns empty string for null/undefined/empty.
    - `renderReviewPacketsCsv(rows)` — pure projection over `ReviewPacketRow[]` to RFC-4180 CSV string. Header row is **fixed and locked** (column order: status, packetId, receiptId, vendor, vendorSource, amountUsd, amountSource, currency, eligibilityOk, eligibilityMissing, approvalId, approvalStatus, createdAt). Empty input → header-only CSV (1 line + trailing CRLF). Multiple rows in input order, separated by CRLF.
    - `reviewPacketsCsvFilename(now)` — stable `usa-gummies-review-packets-YYYY-MM-DD.csv`.
  - **No-fabrication rules** locked separately:
    - Null vendor / amount / approval render as **empty cells** (NEVER `"null"` / NEVER `"0"` / NEVER `"—"` — the em-dash is a dashboard rendering choice, not a finance-tooling value).
    - OCR-suggested vendor renders with the dashboard's `(ocr)` suffix verbatim so the source attribution survives the CSV boundary.
    - `eligibilityMissing` joins with `|` (NOT `,`) so the column boundary stays intact.
    - `eligibilityOk` renders as `"true"` / `"false"`.
    - `amountUsd` formatted to 2 decimals; NaN/Infinity render as empty.
  - **Route** `GET /api/ops/docs/receipt-review-packets/export.csv`:
    - Auth-gated; same `isAuthorized()` gate as the JSON list route.
    - Reuses the canonical filter parser + `filterPacketsBySpec` + `buildReviewPacketsView` so the CSV mirrors what the operator sees on the dashboard.
    - Default `limit` is **500** (full queue, not 100 like the JSON list — exporters want the full set).
    - `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="usa-gummies-review-packets-YYYY-MM-DD.csv"`, `Cache-Control: no-store` (never serve a stale CSV from CDN).
    - **No pagination** — exports the full filtered set up to `limit`. The Phase 17 cursor applies only to the JSON list route; finance ops want one CSV per export.
    - 401 → JSON `{error: "Unauthorized"}`. KV throw → HTTP 500 `text/plain` with `csv_export_failed: <reason>`. Never empty CSV silently.
  - **Client** gains an "Export CSV" anchor next to the Refresh button. The anchor's `href` rebuilds with the current filter spec via `reviewPacketsFilterSpecToQuery`, so the operator gets a CSV that matches their on-screen view exactly. The browser handles the download via `Content-Disposition: attachment`.
- **Hard rules locked by 33 new tests:**
  - **`escapeCsvCell`:** plain values pass through; commas/CRLF/quotes get quoted; internal quotes doubled per RFC-4180; leading/trailing whitespace gets quoted (Excel-safe); null/undefined/empty → empty string.
  - **`renderReviewPacketsCsv`:** header order locked; empty input → header-only; null fields → empty cells; OCR `(ocr)` suffix preserved; vendor with embedded `,` and `"` correctly quoted + doubled; `eligibilityMissing` pipe-joined; eligibilityOk → `"true"`/`"false"`; amount formatted to 2 decimals; NaN/Infinity → empty; multiple rows in input order separated by CRLF; ends with CRLF terminator; pure deterministic; no input mutation.
  - **`reviewPacketsCsvFilename`:** correct format; zero-pads single-digit month/day.
  - **Route:** 401 on auth fail; 200 with `text/csv` + `Content-Disposition: attachment` + locked filename pattern; `Cache-Control: no-store`; locked header line; empty queue → header-only; vendor filter narrows; status filter narrows; filter-narrows-to-zero → header-only (no fabrication); unknown query params ignored; KV throw → 500 `text/plain` with `csv_export_failed` reason; static-source no-mutation contract (no `qbo-client` / `qbo-auth` / `hubspot` / `shopify-` / `slack-(send|client)` / `createQBO*-write` / `chat.postMessage` / `WebClient` / `openApproval(` / `buildApprovalRequest(`); only GET exported.
- **Tests (Phase 18 Option A):** 21 new in `src/app/ops/finance/review-packets/__tests__/data.test.ts` (6 escapeCsvCell + 13 renderReviewPacketsCsv + 2 reviewPacketsCsvFilename) + 12 new in `src/app/api/ops/docs/receipt-review-packets/export.csv/__tests__/route.test.ts` (auth, content-type, disposition, cache-control, header line, empty-queue, multi-row, vendor filter, status filter, zero-match, unknown params, KV-throw 500, static-source). Full suite: **1359 green** (was 1326).
- **What's NOT in this commit:**
  - **Cursor/pagination on CSV** — exports the full filtered set up to 500. If queues grow past that, Phase 19 may add `?cursor=...` to the export route too (or split into multi-page CSVs).
  - **Approval-lookup caching (Option B)** — premature at current volume.
  - **`qbo.bill.create` entry (Option C)** — explicitly out of scope; crosses the QBO-write boundary and needs a new taxonomy slug.
- **Monday MVP:** 🟢 — Rene/Ben can hand the filtered review queue to anyone as a CSV with one click. Filter narrows the export the same way it narrows the dashboard. No new write paths landed.

#### Phase 19 (Option B) — approval-lookup caching + dedup (NEW)
- **Why:** Phases 13/15/16/17/18 each had a copy of `buildApprovalLookup()` inlined into a route — the JSON list route, the CSV export route, and (originally) the per-row poll. Two copies were already drifting (the export route's copy carried a JSDoc note that it was duplicated "rather than imported because the JSON route's helper is module-private"). Phase 15 also added a bounded passive poll on every active dashboard client (60s × 10 ticks), which means every active operator's tab was hammering `approvalStore.listPending()` + `listByAgent()` on every tick. Phase 19 (Option B) deduplicates the helper into a canonical module + adds a 30-second KV cache so the bounded poll respects a single source of truth.
- **Why this over Option C (`qbo.bill.create` entry):** Option C crosses the QBO-write boundary and would need a new Class B/C taxonomy slug registered with Ben first. Option B is read-only, internal, and unblocks Option C by ensuring the `rene-approved` lookup is fast/canonical when Option C eventually lands.
- **Architecture:**
  - **New module** `src/lib/ops/receipt-review-approval-lookup.ts`:
    - `buildApprovalLookupFresh(): Promise<ApprovalsByPacketId>` — the canonical builder. Reads `approvalStore.listPending()` + `approvalStore.listByAgent("ops-route:receipt-promote", 200)` and merges into `Map<packetId, {id, status}>`. Pending wins on conflict (a pending row is NEVER overwritten by an older terminal-state row from `listByAgent`). Both reads fail-soft: an error in `listPending` does not lose `listByAgent` results, and vice versa. Two-throw → empty map (still no throw).
    - `getCachedApprovalLookup(): Promise<ApprovalsByPacketId>` — the production entry point. Reads `kv.get("approval-lookup:receipt-review:v1")`; if it's a valid `CachedShape` AND `Date.now() - cachedAt ∈ [0, 30_000]ms`, deserialize → return. Otherwise rebuild via `buildApprovalLookupFresh` + best-effort `kv.set` with `ex: 30`. KV.get throw, future-dated `cachedAt`, garbage shape, per-entry malformed shape, or stale TTL all fall through to a fresh build. KV.set throw is swallowed — the freshly-built map is still returned.
    - `invalidateApprovalLookupCache()` — `kv.del`, swallowed-on-throw, for future admin "force refresh" buttons or post-closer hooks.
    - `__INTERNAL = { CACHE_KEY: "approval-lookup:receipt-review:v1", CACHE_TTL_SECONDS: 30 }` — exposed for lockstep tests in callers.
  - **Cached shape** is `{ cachedAt: number, entries: Record<packetId, {id, status}> }` — flat, JSON-serializable. `Map<>()` is not directly JSON-serializable, so `serializeMap` / `deserializeMap` handle the round-trip. `isValidCachedShape` validates before deserialization; per-entry malformed shapes are skipped without rejecting the whole cache.
  - **Cache key is versioned** (`:v1` suffix) so a future shape change forces a clean rollout instead of poisoning the cache.
  - **30-second TTL** chosen because the bounded passive poll fires every 60s; staleness window can never exceed the TTL by more than the poll cadence. Operators see closer transitions on the tick after expiry.
  - **List route** (`src/app/api/ops/docs/receipt-review-packets/route.ts`) — drops its inlined `buildApprovalLookup` and calls `getCachedApprovalLookup()`.
  - **CSV export route** (`src/app/api/ops/docs/receipt-review-packets/export.csv/route.ts`) — drops ITS duplicate copy and calls `getCachedApprovalLookup()`.
- **Hard rules locked by 20 new tests + existing route tests:**
  - **`buildApprovalLookupFresh`:** keys map by `targetEntity.id` only; skips approvals with no targetEntity.id (defensive); pending wins over terminal-state listByAgent on conflict; `listPending` throw → still returns `listByAgent` rows; `listByAgent` throw → still returns `listPending` rows; both throw → empty map (no throw).
  - **`getCachedApprovalLookup`:** cache miss → fresh build → KV.set with `ex: 30` → return fresh; cache hit (within TTL) → return cached without rebuilding (locked by mutating fixture between calls); KV.get throw → fresh build (best-effort write still attempted); garbage cached value → fresh build; cached `entries` field not an object → fresh build; stale cached value (older than TTL) → fresh build; future-dated `cachedAt` (clock skew → negative ageMs) → fresh build; KV.set throw → fresh result still returned (write error swallowed); cached map round-trips through serialize/deserialize correctly; cached entry with malformed inner shape is skipped per-entry without rejecting the whole cache.
  - **`invalidateApprovalLookupCache`:** clears the key so the next call rebuilds; KV.del throw → swallowed.
  - **`__INTERNAL`:** exposes the locked CACHE_KEY (`approval-lookup:receipt-review:v1`) + CACHE_TTL_SECONDS (`30`).
  - **Static-source assertion** on the new module locks no `qbo-client` / `qbo-auth` / `hubspot` / `shopify-` / `slack-(send|client)` / `createQBO*-write` / `chat.postMessage` / `WebClient` / `openApproval(` / `buildApprovalRequest(` imports or call sites; only the canonical surface (`buildApprovalLookupFresh`, `getCachedApprovalLookup`, `invalidateApprovalLookupCache`) is exported.
  - **Both routes** continue to pass their existing static-source assertions — switching the import from `@/lib/ops/control-plane/stores` to `@/lib/ops/receipt-review-approval-lookup` does not introduce any forbidden patterns.
- **Tests (Phase 19 Option B):** 20 new in `src/lib/ops/__tests__/receipt-review-approval-lookup.test.ts` (1 __INTERNAL + 6 buildApprovalLookupFresh + 11 getCachedApprovalLookup + 2 invalidateApprovalLookupCache + 1 static-source — counted as 20 because some `describe` blocks share `it` siblings). Full suite: **1379 green** (was 1359).
- **What's NOT in this commit:**
  - **Cache invalidation hook from the closer** — Phase 10 closer flips a packet to `rene-approved`/`rejected` but does NOT call `invalidateApprovalLookupCache()`. Operators see the new state on the tick after TTL expiry (≤ 30s). Wiring the closer is a follow-up if 30s feels long.
  - **CSV export cursor pagination** — still capped at 500 (the storage cap). Only matters once queue > 500 packets.
  - **`qbo.bill.create` auto-fire from `rene-approved`** — explicitly out of scope; crosses the QBO-write boundary and needs a new Class B/C taxonomy slug registered with Ben first.
- **Monday MVP:** 🟢 — Operator dashboards stop hammering the approval store on every passive-poll tick. The two route copies of `buildApprovalLookup` are gone — there is one canonical helper, one cache, one source of truth. No new write paths landed.

#### Phase 20 — Closer cache-invalidation hook (NEW)
- **Why:** Phase 19 added a 30-second TTL on the canonical approval lookup. That's a great floor for the bounded passive poll, but it means operators who decide an approval in Slack now wait *up to 30s* before the dashboard reflects the new packet status — even though the closer fired sub-second after the click. Phase 20 closes that window: when the Phase 10 closer flips a packet's status (`draft → rene-approved` / `draft → rejected`), it busts the cache so the next dashboard / list-route / CSV-export request rebuilds from the fresh `approvalStore` state.
- **Why not a longer TTL with broader invalidation:** A 30s TTL is already the right ceiling for the passive poll; the issue is purely the gap between "closer landed" and "operator sees it". A targeted invalidation at the success edge keeps the rebuild work bounded to one-per-decision instead of one-per-poll-tick-after-decision.
- **Architecture:**
  - **One new line of behavior** in `src/lib/ops/receipt-review-closer.ts`:
    ```typescript
    await appendCloseAudit(run, approval, { result: "ok", packetId, newStatus });
    await invalidateApprovalLookupCache();   // ← Phase 20
    ```
  - **Strict positioning:** the invalidate call fires AFTER the success audit lands, BEFORE the closer returns the success result. Audit ordering preserved (audit is the source of truth for what happened; cache is downstream observability).
  - **NEVER fires on:**
    - **Gating returns (`handled: false`)** — non-receipt-review approvals, missing/wrong-type targetEntity, non-terminal approval status: no transition occurred → cache is still correct.
    - **Error path (`ok: false, handled: true`)** — packet not found in KV, malformed `targetEntity.id`: no transition occurred → cache is still correct.
  - **Best-effort guarantee:** `invalidateApprovalLookupCache()` swallows `kv.del` failures internally (Phase 19's existing contract), so a KV-del failure NEVER propagates back through the closer's success path. The packet status flip already landed in KV; the cache is downstream observability and its failure cannot retroactively fail the transition.
  - **No other surface changes:** the closer's `ReceiptReviewCloserResult` shape, `threadMessage` text, audit envelope, and gating branches are byte-identical to Phase 10. Phase 20 is a single internal side-effect addition.
- **Hard rules locked by 8 new tests in `src/lib/ops/__tests__/receipt-review-closer.test.ts`:**
  - **Approved transition:** `kv.del` is called with the canonical cache key (`approval-lookup:receipt-review:v1`).
  - **Rejected transition:** `kv.del` is called with the canonical cache key.
  - **Observable invalidation:** a primed cache value at the canonical key is REMOVED from the backing KV after a successful transition (asserts the helper's del actually mutated state).
  - **Gating return (non-receipt-review approval):** `kv.del` is NOT called.
  - **Gating return (pending approval):** `kv.del` is NOT called.
  - **Error path (malformed `targetEntity.id`):** `kv.del` is NOT called.
  - **Error path (packet not found in KV):** `kv.del` is NOT called.
  - **`kv.del` throw:** swallowed inside the helper; closer's success path is unaffected — `result.ok === true`, `result.newStatus === "rene-approved"`, packet's status DID land. The invalidate attempt was made (so future closer wiring can rely on at-least-one cache-bust attempt per success).
- **Tests (Phase 20):** 8 new in `src/lib/ops/__tests__/receipt-review-closer.test.ts`; closer test count rises from 16 → 24. Full suite: **1387 green** (was 1379).
- **What's NOT in this commit:**
  - **Cache invalidation on `executeStandDown` / approval expiry** — those don't currently route through this closer; if a future change makes them flow through here, this same hook will fire automatically. If they bypass the closer, a separate Phase 21+ hook would be needed.
  - **Cache invalidation on the Phase 14 inline Re-promote path** — that doesn't transition a packet's `status` field (it creates a NEW approval for a still-`draft` packet); the lookup map's keys are packetId, but the value's `status` would change from "no entry" → "pending". Operator visibility on that surface depends on the next passive-poll tick (≤ 60s) plus the Phase 19 TTL (≤ 30s); fine as-is.
  - **Refresh button behavior** — the dashboard's manual Refresh continues to ride the Phase 19 cache; it does NOT force-invalidate. Operators who want a hard-refresh path can wait the ≤ 30s TTL or get one via a closer-driven decision.
  - **`qbo.bill.create` auto-fire** — explicitly out of scope; would need a new Class B/C taxonomy slug registered first.
- **Monday MVP:** 🟢 — Operator decisions in Slack are reflected on the dashboard sub-second after the closer lands, instead of waiting up to 30s for the cache TTL. The closer's `result.ok === true` contract is unchanged: packet status flip remains the source of truth; cache invalidation is a downstream observability concern that cannot break the transition.

#### Phase 21 — CSV cursor pagination (NEW)
- **Why:** Phase 18 capped CSV exports at the storage cap (500). Phase 17 added cursor pagination on the JSON list route but the CSV stayed pagination-less, with a noted carve-out in the workflow blueprint: *"If queues grow past that, Phase 19 may add `?cursor=...` to the export route too."* Phase 21 closes that gap so CSV exports keep working when storage cap eventually grows past 500. The dashboard's "Export CSV" button is unchanged (no cursor → first page, up to 500 rows; backward-compat with Phase 18).
- **Why not multi-file CSV bundling:** The dashboard button delivers a single file per click — that's the operator-facing contract. Programmatic clients (curl, scripts, future Drive sync) handle pagination by chasing `nextCursor` themselves. Bundling pages on the server would require streaming + a non-standard filename pattern; chasing cursors via a documented header is the standard RFC 5988 pattern.
- **Architecture:**
  - **Route** (`src/app/api/ops/docs/receipt-review-packets/export.csv/route.ts`):
    - Accepts `?cursor=...` (the same opaque base64url shape from Phase 17).
    - Loads full storage cap (500) → applies filter → paginates with `paginateReviewPackets(filtered, { limit, cursor })` (mirrors Phase 17's contract on the JSON list route — filters apply BEFORE pagination so cursor traversal of an active filter doesn't emit half-empty pages).
    - Body is the CSV of `paginated.page` (NOT the full filtered set; backward-compat at <500 because the page = the full set).
    - Response headers:
      - `X-Matched-Total: <number>` — full filtered set length (NOT page length). Always present. Mirrors the JSON list's `matchedTotal` body field.
      - `X-Next-Cursor: <opaque>` — present iff more pages remain. **Absent** (NOT empty string, NOT `"null"`, NOT `"0"`) on the final page. Defensive locked.
      - `Link: <next-url>; rel="next"` — RFC 5988 navigation hint. Present iff `X-Next-Cursor` is present. URL preserves all current filter params (status, vendor, createdAfter, createdBefore, approvalStatus, limit) + swaps in the `cursor` value.
    - Filename stays stable — `usa-gummies-review-packets-YYYY-MM-DD.csv`. Multi-page consumers rename downloaded files locally; that's not the route's concern.
  - **Backward compatibility:** request with no cursor + queue ≤ 500 → same body, same headers shape minus the (then-absent) `X-Next-Cursor` + `Link`. Dashboard button keeps working unchanged.
  - **Malformed cursor:** falls back to first page automatically (Phase 17's `decodeReviewPacketCursor` returns `null` on bad input; `paginateReviewPackets` treats null as first page). Defensive — never throws.
- **Hard rules locked by 9 new tests:**
  - **`X-Matched-Total`** always set; equals filtered set length (NOT page length).
  - **`X-Next-Cursor` + `Link: rel="next"`** present iff more pages remain. Both values come from the same `paginated.nextCursor` (locked together).
  - **`X-Next-Cursor` + `Link` ABSENT** on the final page — `res.headers.get("X-Next-Cursor") === null`. NEVER fabricated as empty string, `"null"`, or `"0"`.
  - **Cursor traversal visits every packet exactly once** over a 5-packet fixture with `limit=2` (3 pages) — locked by parsing the CSV body's packetId column and asserting set size = 5.
  - **Malformed cursor** → first page, same `X-Matched-Total`, no throw.
  - **Filters apply BEFORE pagination** — cursor walks the filtered set; `vendor=Vendor 1` returns `X-Matched-Total: 1` not the unfiltered storage size.
  - **Backward compat** — small queue + no cursor returns same Phase 18 body shape (header + 1 data row + trailing empty CRLF) with `X-Matched-Total: 1`, no `X-Next-Cursor`, no `Link`.
  - **Link header URL preserves filter params** — extracted URL retains `status=draft`, `limit=2`, and a non-empty `cursor` value.
  - **`limit` clamps** to `[1, 500]` — `limit=0` clamps to 1, `limit=999999` clamps to 500.
- **Tests (Phase 21):** 9 new in `src/app/api/ops/docs/receipt-review-packets/export.csv/__tests__/route.test.ts`. CSV export route test count rises from 12 → 21. Full suite: **1396 green** (was 1387).
- **What's NOT in this commit:**
  - **Streamed multi-page export** — the dashboard button still gets one file per click. Programmatic clients chase cursors themselves.
  - **Storage cap raised past 500** — that's a separate KV-shape decision; Phase 21 just makes the export route ready when it happens.
  - **Client-side multi-page download UX** — a future "Download all matching" button could chase cursors browser-side via `fetch` and concat pages, but that's a UX layer, not a route contract change.
- **Monday MVP:** 🟢 — Programmatic CSV consumers can paginate via `?cursor=...` with standard RFC 5988 `Link: rel="next"` navigation. Dashboard "Export CSV" button is unchanged. Filenames stay stable. No new write paths landed.

#### Phase 22 — Promote-review cache-invalidation hook (NEW)
- **Why:** Phase 20 wired the closer to invalidate the Phase 19 cache, but the closer is only ONE entry point that mutates packet/approval state. The Phase 14 inline **Re-promote** button hits a different path: `POST /api/ops/docs/receipt/promote-review` opens a new pending Class B Rene approval via `openApproval()`. That new approval doesn't flow through the closer (the closer only fires on Slack-side decisions, not on operator-side opens). So when an operator clicks Re-promote, the dashboard's Phase 19 cache stays stale for up to 30s — even though the new approval landed in the store sub-second after the click.
- **Why NOT just rely on TTL:** The Re-promote button is operator-facing. Phase 14's contract is "click → row updates" — and "click → wait 30s for the next passive-poll tick" breaks the operator's mental model. Phase 22 mirrors Phase 20 on this active code path so the dashboard reflects the new pending approval immediately.
- **Architecture:**
  - **One new line of behavior** in `src/app/api/ops/docs/receipt/promote-review/route.ts`, fired AFTER `openApproval(...)` returns successfully and BEFORE the route's response is built:
    ```typescript
    const request = await openApproval(store, approvalSurface(), params);
    approval = { opened: true, id: request.id, /* ... */ };
    await invalidateApprovalLookupCache();   // ← Phase 22
    ```
  - **Strict positioning:** the invalidate fires ONLY in the brand-new-approval branch — NOT on the idempotent existing-approval path, NOT on ineligible packets, NOT on missing-slug packets, NOT on the openApproval error path.
  - **Why skip the idempotent path:** the existing-approval branch returns the same approval id that's already reflected in the cache (assuming the cache was loaded after the original open). Invalidating here would force a rebuild that returns the same data — wasted work.
  - **Why skip openApproval-throw:** the route surfaces `approval.opened: false` in this case, so the operator sees no state change. Stale-by-30s aligns with the operator's view.
  - **Best-effort guarantee:** `invalidateApprovalLookupCache()` swallows `kv.del` failures internally (Phase 19's existing contract), so a KV-del failure NEVER propagates back through the route's success path. The new approval already landed in the store; the cache is downstream observability.
  - **No other surface changes:** the route's response shape (`{ ok, packet, approval, taxonomy_status }`), idempotency contract, taxonomy gating, and 4xx error shapes are byte-identical to Phase 9/12. Phase 22 is a single internal side-effect addition on the new-approval branch.
- **Hard rules locked by 8 new tests in `src/app/api/ops/docs/receipt/promote-review/__tests__/route.test.ts`:**
  - **Eligible packet → new approval opened:** `kv.del` is called with the canonical cache key (`approval-lookup:receipt-review:v1`).
  - **Observable invalidation:** a primed cache value at the canonical key is REMOVED from the backing KV after a successful Re-promote.
  - **Idempotent path:** second Re-promote of the same receipt does NOT call `kv.del` again — call count stays at 1 (locked by tracking `kvDelCalls.length`).
  - **Ineligible packet:** no approval opened → `kv.del` is NOT called.
  - **401 (auth fail):** `kv.del` is NOT called (defense-in-depth — auth gate is separate from cache).
  - **400 (missing receiptId):** `kv.del` is NOT called.
  - **404 (unknown receiptId):** `kv.del` is NOT called.
  - **`kv.del` throw:** swallowed inside the helper; route still returns 200 with `approval.opened: true` and the same approval id. The invalidate attempt was made (so future closer wiring can rely on at-least-one cache-bust attempt per success).
- **Tests (Phase 22):** 8 new in `src/app/api/ops/docs/receipt/promote-review/__tests__/route.test.ts`; promote-review test count rises from 18 → 26. KV mock extended with `del` (with throw-knob, mirroring the Phase 20 closer test setup). Full suite: **1404 green** (was 1396).
- **What's NOT in this commit:**
  - **`standDown()` / `checkExpiry()` invalidation hooks** — audit confirms neither helper is invoked from production code today; both are pure transformers waiting for a future dispatcher caller. When a caller is wired up, that caller MUST also call `invalidateApprovalLookupCache()` if its targetEntity is a `receipt-review-packet`. Documented inline; not wired here because YAGNI on a non-existent caller.
  - **Audit / metrics on cache invalidation rate** — could surface as a Sales Command sub-card if cache-bust storms become a concern.
  - **`qbo.bill.create` auto-fire** — explicitly out of scope; would need a new Class B/C taxonomy slug registered first.
- **Monday MVP:** 🟢 — Re-promote click now feels instant. The route's success contract is unchanged: approval-open is the source of truth; cache invalidation is downstream observability that cannot break the route. With Phase 20 (closer hook) + Phase 22 (open hook), the two active receipt-review state-transition entry points both bust the cache; the Phase 19 30s TTL becomes a safety floor for any future paths that bypass these hooks.

#### Phase 23 — ID-substring search on the dashboard (NEW)
- **Why:** Operators frequently arrive at `/ops/finance/review-packets` with a specific id in hand — pasted from a Slack thread (Phase 12 permalink linking to a packet's approval thread), an audit log entry, a CSV row from finance, or a fellow operator's question. Today they have to scroll through the whole queue (or filter by vendor and hope for the best). Phase 23 adds a search input that takes a packetId, receiptId, OR approvalId substring and narrows to the matching row(s) — locked to lockstep client/server semantics like every other Phase 14-21 filter.
- **Why it's parallel to Phase 23 QBO entry:** The earmarked Phase 23 was `qbo.bill.create` (STOP-AND-ASK on the QBO-write boundary). Audit identified blocker: that lane needs Rene's chart-of-accounts mapping before a route can be built. While that unblocks (Slack DM to Rene queued), this phase ships parallel-safe operator value. Phase numbering follows ship order; the QBO-write candidate becomes Phase 24+.
- **Architecture:**
  - **Pure helper extension** in `src/app/ops/finance/review-packets/data.ts`:
    - `ReviewPacketsFilterSpec` gains optional `idContains?: string` (mirrors the existing `vendorContains` shape).
    - `applyReviewPacketsFilters` matches the substring (case-insensitive) against `row.packetId`, `row.receiptId`, AND `row.approvalId ?? ""`. AND semantics with all other filters (status / vendor / date / approvalStatus). Empty / whitespace collapses to "no filter".
    - `parseReviewPacketsFilterSpec` reads the canonical `id` query param.
    - `reviewPacketsFilterSpecToQuery` serializes back (trims before writing; omits empty/whitespace).
    - `filterPacketsBySpec` (server) inherits the new dimension via the existing `applyReviewPacketsFilters` projection — bit-identical client/server semantics.
  - **Client view** (`ReviewPacketsView.client.tsx`) gains an "ID search" `<input>` in the filter strip with a `title` tooltip explaining the three id types it matches. Wired into the same memoized `filterSpec` that drives the server fetch + the client-side defensive belt. Cleared by the existing "Clear filters" button.
  - **Routes** (list + CSV export) extend their `filterApplied` check to include `spec.idContains !== undefined` so the bounded passive poll + the CSV's `Cache-Control: no-store` flag fire correctly when only the id filter is active.
  - **No new approval-id surfacing:** the dashboard already exposes `approvalId` per row via Phase 16's view enrichment + the `Approval` column. Operators who don't know the approval id already have it on screen. Phase 23 just lets them paste it back.
- **Hard rules locked by 26 new tests:**
  - **`applyReviewPacketsFilters`:** matches by packetId substring; matches by receiptId substring (when packetId doesn't contain the needle); matches by approvalId substring (when only approvalId contains the needle); a row with `approvalId: null` CAN'T match an approval-id-only needle (no fabrication); case-insensitive on all three id fields; empty / whitespace collapses to "no filter"; no match across any of three fields → empty rows; composes with status filter (AND); composes with vendor filter (AND); composes with approvalStatus filter (AND).
  - **`parseReviewPacketsFilterSpec`:** `id` query param parses to `idContains`; empty / whitespace omitted; preserves verbatim (no trim on parse — matches existing vendor semantics).
  - **`reviewPacketsFilterSpecToQuery`:** trims before serializing; empty / whitespace omits the param; round-trip with `idContains` alone preserves the spec; round-trip with all six dimensions composed together preserves the full spec.
  - **`filterPacketsBySpec` (server lockstep):** server filter produces the same packetIds as the client helper for an id needle (locked by parity assertion); approvalId match works server-side when `approvalsByPacketId` is plumbed through; approvalId match returns 0 packetIds when the lookup map is missing (defensive — no fabrication of approvalId on the row).
  - **List route (`?id=...`):** unique-receiptId-suffix narrows to that packet's row; full packetId matches exactly one row; no-match → `count: 0` (no fabrication, `matchedTotal: 0`, `totalBeforeFilter` reflects unfiltered storage); empty / whitespace `?id` collapses to no filter; composes with vendor filter (AND); server route is bit-identical to the client helper for the same id needle.
- **Tests (Phase 23):** 18 new in `src/app/ops/finance/review-packets/__tests__/data.test.ts` (10 applyFilters + 3 parse + 3 toQuery + 2 filterPacketsBySpec lockstep) + 6 new in `src/app/api/ops/docs/receipt-review-packets/__tests__/route.test.ts` (route narrowing). Combined: **+26 tests** in this phase. data.test.ts test count rises from 112 → 130. Full suite: **1430 green** (was 1404).
- **What's NOT in this commit:**
  - **CSV export route id-search test coverage** — the CSV route inherits the `idContains` filter for free via the shared `parseReviewPacketsFilterSpec` + `filterPacketsBySpec` helpers (locked by data.test.ts parity tests). A dedicated CSV-side route test would only re-prove the same parity.
  - **Search auto-focus / keyboard shortcut** — no `Cmd+F` or `/` hotkey wired up. Operators using the search field tab or click into it.
  - **Search across the OCR-suggested cells** (e.g. payment_method) — Phase 23 scopes to ids only. Vendor-substring already covers vendor name; date filters cover date; amount has no need for substring. If operators ask, payment_method or category substring is a one-line addition.
- **Monday MVP:** 🟢 — Operator pastes any of the three ids (packetId / receiptId / approvalId) from a Slack thread, audit log, or CSV row → table narrows to that row in one keystroke. Stays read-only; lockstep client/server semantics; no new write paths.

#### Phase 24 — Cache freshness indicator on the dashboard (NEW)
- **Why:** Phase 19 added a 30s TTL on the canonical approval lookup; Phase 20 + Phase 22 wired both active state-transition entry points to invalidate on success. So the cache is mostly fresh — but operators have NO way to tell whether the dashboard view they're seeing was just rebuilt or is being served from the (≤30s) TTL window. That's the "is this stale?" question. Phase 24 surfaces the cache age as a small indicator near the counts strip ("as of 5s ago" / "fresh") so operators can answer the question without clicking Refresh.
- **Why this over the originally-earmarked Phase 24 (`qbo.bill.create`):** That QBO-write entry is **PARKED** pending Rene's chart-of-accounts mapping (Slack draft for Rene queued in 2026-04-25 conversation history but not yet posted; Ben confirmed Class C + BOTH idempotency layers; resume context captured in `LIVE-RUNWAY-2026-04-25.md` "Parked Items" + Notion §7). Phase numbering follows ship order; the QBO-write candidate stays parked without a phase number until unblocked.
- **Architecture:**
  - **`getCachedApprovalLookupWithMeta(): Promise<{ map, cachedAt }>`** — new variant of the canonical Phase 19 helper. Returns the same `ApprovalsByPacketId` map plus the cached value's `cachedAt` Unix-ms timestamp (or `null` when freshly built). The plain `getCachedApprovalLookup()` becomes a thin wrapper that just returns the map — backward-compat preserved for the CSV export route + Phase 20/22 callers that don't care about cache age.
  - **List route response gains `approvalsLookupCachedAt: number | null`.** Always present (no missing-key ambiguity); `null` on fresh build, number on cache hit. NEVER fabricated as 0 / -1 / now.
  - **`formatLookupFreshness(cachedAt, now)` pure helper** in `data.ts` (server-safe, no React imports — testable without JSX overhead, reusable from any future server-rendered surface). Defensive on null / NaN / Infinity / future-dated input — all collapse to `"fresh"`. Output buckets: `"as of just now"` (0s) / `"as of <N>s ago"` (1-59s) / `"as of <N>m ago"` (60s+).
  - **Client view (`ReviewPacketsView.client.tsx`)** plumbs `approvalsLookupCachedAt` through the fetch result and renders the indicator on the right edge of the counts strip. A 1s clock tick (`useEffect setInterval(setNow, 1000)`) keeps the label advancing live without refetching. Tooltip explains the source: "Cache TTL is 30s; closer + Re-promote actions invalidate immediately (Phase 20 + Phase 22)."
  - **No new write paths.** Read-only on every system; the new helper variant just exposes existing in-memory metadata that was already being computed.
- **Hard rules locked by 27 new tests:**
  - **`getCachedApprovalLookupWithMeta`:** cache miss → `{ map, cachedAt: null }`; cache hit → `{ map, cachedAt: <cached-value's-cachedAt> }` (NOT `Date.now()`); KV.get throw → fresh + `null`; garbage cached value → fresh + `null`; stale (> TTL) → fresh + `null`; future-dated cachedAt → fresh + `null`; KV.set throw → fresh + `null` (write error swallowed); thin-wrapper `getCachedApprovalLookup` returns same map content; `cachedAt` is the original write timestamp, never fabricated.
  - **List route response:** `approvalsLookupCachedAt` always present in response shape (no missing-key); `null` on fresh build; number equal to cached value's `cachedAt` on cache hit; NEVER fabricated as 0 / now on fresh build.
  - **`formatLookupFreshness`:** null / NaN / Infinity / future-dated → `"fresh"`; 0s → `"as of just now"`; 1-59s → `"as of <N>s ago"`; 60s+ → `"as of <N>m ago"` (rounded); pure (same input → same output); NEVER renders empty / `"null"` / `"undefined"` / `"NaN"` / `"0"` on any input.
  - **Static-source assertion** on `receipt-review-approval-lookup.ts` extended to lock the new `getCachedApprovalLookupWithMeta` export alongside the existing canonical surface.
- **Tests (Phase 24):** 9 new in `src/lib/ops/__tests__/receipt-review-approval-lookup.test.ts` (WithMeta variant) + 4 new in `src/app/api/ops/docs/receipt-review-packets/__tests__/route.test.ts` (response field surfacing) + 14 new in `src/app/ops/finance/review-packets/__tests__/data.test.ts` (`formatLookupFreshness` formatter). Combined: **+27 tests**. Full suite: **1457 green** (was 1430).
- **What's NOT in this commit:**
  - **Force-refresh button on the dashboard.** With Phase 20+22 invalidation hooks already firing on every state transition, the cache is mostly fresh and Refresh suffices for non-transition state changes. A force-invalidate button is unnecessary today.
  - **Cache age in the CSV export route response.** CSV is data, not UI metadata. Operators consuming CSV programmatically don't need the freshness label.
  - **Server-side `cachedAt` propagation from the cache build through to other surfaces** (e.g. `/ops/finance/review` page). Phase 19 cache is private to the receipt-review-packets dashboard surface today; expanding scope is unnecessary.
- **Monday MVP:** 🟢 — Operator scans the dashboard and sees "Approvals: as of 5s ago" right next to the counts. The "is this stale?" question is answered without a refresh click. Cache invalidation behavior (Phase 20 + 22) is now visible — when an approval transitions, the indicator flips back toward "fresh" on the next poll tick or load.

#### Phase 25 — Recent activity (audit feed sub-card) on the dashboard (NEW)
- **Why:** Phase 13 + 23 made the dashboard scannable for state and findable by id. Phase 24 made the cache age visible. But operators still had to scroll the table or open Slack threads to see *what just got approved/rejected* across the whole queue. Phase 25 surfaces the last-N closer transitions in a "Recent activity" sub-card right above the table — situational awareness without context-switching.
- **Why an audit feed and not just polling the table:** The dashboard table is filtered by the operator's spec. An approved-this-morning packet might sit out-of-view if their filter is "draft only". The audit feed is a *global* recent-activity view (last N successful + errored closer transitions, regardless of current filter), pulled from `auditStore.byAction("receipt-review-promote.closer", N)` which already exists from Phase 10. No new audit emission was needed — Phase 25 just projects the existing envelope.
- **Architecture:**
  - **New route** `GET /api/ops/docs/receipt-review-packets/audit-feed`:
    - Auth-gated (`isAuthorized`).
    - Reads `auditStore().byAction("receipt-review-promote.closer", limit)` — same canonical interface, returns newest-first per adapter contract.
    - `limit` clamped to `[1, 100]` (default 20).
    - Each entry projects through `projectAuditEntryToFeedRow` and malformed rows are SKIPPED (defense-in-depth: a bad write can't poison the feed).
    - Response: `{ ok, count, entries: AuditFeedRow[] }`.
    - 401 → JSON `{error: "Unauthorized"}`. auditStore throw → HTTP 500 `{ok: false, error: "audit_feed_read_failed", reason}`. NEVER returns `count: 0` silently.
  - **Pure helper** `projectAuditEntryToFeedRow(entry)` in `data.ts` (server-safe, no React imports):
    - Returns `null` for any non-`receipt-review-promote.closer` action (defense-in-depth on top of the byAction filter).
    - `result: "ok"` requires `after.packetId` (string) AND `after.newStatus` (`"rene-approved"` | `"rejected"`); otherwise `null`. `entityId` is the fallback for `packetId` when `after.packetId` is missing.
    - `result: "error"` requires `error.message` (string); otherwise `null`. `newStatus` is allowed to be missing (the closer logged an error before any transition).
    - Any other `result` value → `null`.
    - `packetIdShort = "…<last 12 chars>"` when packetId > 12 chars; the full id when shorter.
    - Pure: no Date.now(), no random, no I/O. Same entry → same row.
    - Exposes `RECEIPT_REVIEW_CLOSER_ACTION = "receipt-review-promote.closer"` constant — typo guard for routes / tests / future call sites.
  - **Client view** gains a "Recent activity" sub-card rendered between the counts strip and the table:
    - Fetches once on mount + on every refresh tick (`refreshKey` change).
    - Renders up to 10 rows compactly: `[icon] [packetIdShort] [verb] [error message if any] [<relative-time>]` per row.
    - Icons: `✅` for approved, `❌` for rejected, `⚠️` for closer error.
    - Relative time computed inline against the same 1s clock tick that drives Phase 24's freshness indicator.
    - Failure surfaces a `Audit feed unavailable: <reason>` banner inside the card; the rest of the dashboard keeps working.
- **Hard rules locked by 28 new tests:**
  - **`projectAuditEntryToFeedRow`:** action filter is locked (typo guard); ok approve / ok reject project to complete rows; ok with missing newStatus → null; ok with missing packetId AND missing entityId → null (no fabrication); ok falls back to entityId when after.packetId is absent; ok with non-canonical newStatus value → null; error with error.message → row with `newStatus: null`; error with NO error.message → null (no fabrication); error with no packetId at all → packetId / packetIdShort null but row valid; result other than ok/error → null; approvalId is null when missing on either path; malformed `after` (string) → null; pure (same input → same projection); does NOT mutate input; packetIdShort is `…<last 12 chars>` when long, full id when short.
  - **Route:** 401 on auth fail; 200 with empty list when no entries; 200 with newest-first entries; limit clamps to `[1, 100]` (default 20); auditStore throw → 500 with reason (NEVER 200 with count: 0); malformed audit entries are SKIPPED (no fabrication of null fields); error rows with valid `error.message` project through; response shape stable.
  - **Static-source assertion** on the new route locks no qbo-client/qbo-auth/hubspot/shopify-/slack-(send|client)/createQBO*-write/chat.postMessage/WebClient/openApproval/buildApprovalRequest imports + no `approvalStore().put` / `recordDecision` mutation. Only GET exported.
- **Tests (Phase 25):** 18 new in `src/app/ops/finance/review-packets/__tests__/data.test.ts` + 10 new in `src/app/api/ops/docs/receipt-review-packets/audit-feed/__tests__/route.test.ts`. Combined: **+28 tests**. Full suite: **1485 green** (was 1457).
- **What's NOT in this commit:**
  - **Audit feed for OTHER receipt-review actions** (Phase 22 promote-review opens, Phase 8 packet creation, Phase 7 OCR runs). Phase 25 scopes to the closer specifically because that's the moment of truth — when state actually changed. Adding more action filters (e.g. "show recent Re-promote opens") is a future incremental.
  - **Click-through to packet detail / Slack thread.** Each row carries `approvalId` but there's no link surface yet. A future "Open thread" button could call `getPermalink` per-row when the operator clicks (lazy resolution avoids the N+1 problem on initial render).
  - **Vendor name in the row.** Audit envelope doesn't carry vendor info today; adding it would be a Phase 10-era envelope change. Operators recognize packetIdShort + status + time, which is enough for situational awareness.
  - **Server-side filter on the audit feed by date / status.** The route returns the most-recent N regardless of operator's table filters; the feed is intentionally global.
- **Monday MVP:** 🟢 — Operator scans the dashboard and immediately sees "X approved by Rene 5m ago, Y rejected 12m ago, Z closer error 47m ago". Read-only; never fabricates; degrades gracefully if `auditStore` is offline (banner inside the card, rest of page stays live).

#### Phase 26 — Audit feed click-through to Slack threads (NEW)
- **Why:** Phase 25 surfaced the recent transitions but rows weren't clickable. Operators wanted to jump from "✅ pkt-belma… approved 5m ago" → the actual Slack thread to read Rene's reasoning, ask follow-ups, or trace the audit context. Phase 26 adds an "Open thread" link per row that lazily resolves the Slack permalink on click — one network round trip per click, no N+1 on initial render.
- **Why lazy resolution:** A per-render permalink resolver would bundle 10 `chat.getPermalink` round trips into every audit feed render (= every dashboard load + every refresh tick). Lazy resolution shifts the cost to the operator's actual click intent, which is bounded by the number of times they click "Open thread" — typically zero or one per dashboard visit.
- **Architecture:**
  - **Route extension** in `src/app/api/ops/docs/receipt-review-packets/[packetId]/route.ts`:
    - The existing GET route gains a `permalink: string | null` field in its response.
    - New local helper `resolveApprovalPermalink(approval)` mirrors the same pattern from the Phase 12 promote-review route — `null` when no approval matched, when `slackThread.ts` is empty (degraded mode), or when `chat.getPermalink` rejects.
    - `getPermalink` short-circuits to `null` without `SLACK_BOT_TOKEN` (Phase 12 contract preserved); the route NEVER manufactures a Slack URL.
    - `getPermalink` is **NEVER called** when no approval matches OR when `slackThread.ts` is missing — saves wasted round trips on packets that haven't been promoted yet.
  - **Client-side click handler** in `ReviewPacketsView.client.tsx`:
    - New `fetchPacketPermalink(packetId)` helper — single GET to the existing per-packet route, defensive on every error path (returns `null` instead of throwing).
    - Audit feed row gains an "Open thread →" button when `entry.packetId !== null` (skipped on closer-error-no-id rows).
    - Click flow: button label flips to "Resolving…" + disabled → fetch permalink → success: open in new tab via `window.open(url, "_blank", "noopener,noreferrer")`. Failure: label flips to "Unavailable" for 2 seconds, then resets. NEVER opens a fabricated URL.
    - The existing per-row pill in the table (Phase 12) already had a permalink anchor on freshly-Re-promoted rows; this phase brings the same affordance to the audit feed.
- **Hard rules locked by 5 new tests:**
  - **Permalink: null when packet has no associated approval.** Defensive — getPermalink should NOT be called.
  - **Permalink: null when approval exists but `slackThread` is missing** (degraded mode contract: surface returned `ts: ""`). getPermalink NOT called.
  - **Permalink: `<url>` when slackThread is set and getPermalink returns a URL.** getPermalink is called once with the right `{channel, message_ts}` coords (locked).
  - **Permalink: null when getPermalink throws.** Defensive — no fabrication, response still 200.
  - **Response always includes `permalink` field** (no missing-key ambiguity for the client).
  - **Static-source assertion** preserved — the route still imports nothing from QBO writes / HubSpot / Shopify / Slack-send / openApproval / buildApprovalRequest. `chat.getPermalink` is a read-only Slack API method and is allowed; `chat.postMessage` / `chat.update` / `WebClient` remain forbidden.
- **Tests (Phase 26):** 5 new in `src/app/api/ops/docs/receipt-review-packets/[packetId]/__tests__/route.test.ts`. Per-packet route test count rises from 8 → 13. Full suite: **1490 green** (was 1485).
- **What's NOT in this commit:**
  - **Permalink in the JSON list route response.** Adding it there would re-introduce the N+1 problem (10 packets per page = 10 round trips per request). The lazy per-click resolution is the right pattern.
  - **Permalink caching.** A short-TTL cache (similar to Phase 19's approval-lookup cache) could amortize repeat clicks on the same packet. Not necessary today; ship if operator click rate justifies it.
  - **Audit feed routing for non-closer actions** (Phase 22 promote-review opens, Phase 8 OCR runs). Phase 25 + 26 scope to closer transitions — the moment of truth.
- **Monday MVP:** 🟢 — Operator scans the audit feed, clicks "Open thread →" on a row, lands in the Slack thread for that decision in a new tab. Lazy: one round trip per click, never fabricates URLs, degrades to "Unavailable" gracefully. With Phase 25 + 26, the dashboard can fully replace "switching to Slack to see what's happening" for routine queue-management.

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
| 🔴 Red | 6 | Reorder triggers, Klaviyo / social, R-1..R-7 specialists, Trade-show pod, USPTO/FDA tracking, external vendor portal |

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

- **1.53 — 2026-04-27** — **Phase 28m: 2-page merged label+slip PDF (the fix Ben demanded).** After two regressions where Ben got a label with no packing slip (Phase 28i + the Amy Catalano 2026-04-27 propagation race), Ben's directive: *"when i click to print the shipping label, it should be a 2 page print, one is the label, and the other is the packing sheet with correct quanities and name of the product we are shipping, do you understand."* The architectural fix replaces the entire thread-reply path with a **single 2-page PDF** — page 1 is the label, page 2 is the packing slip. One click = both pages print together. No thread reply = no race condition possible. New helper `mergeLabelAndSlipPdf(labelBytes, slipBytes)` in `src/lib/ops/packing-slip-pdf.ts` uses pdf-lib's `PDFDocument.copyPages` to concatenate label + slip into a single document; copies ALL label pages (some carriers include a shipper-receipt second page — preserved); slip is always 1 page (built by `buildPackingSlipPdfBuffer`); throws on empty inputs (the doctrinal anti-fabrication rule — never produce a label-only PDF and call it "merged"). Auto-ship route refactor: BEFORE the Slack upload, attempt `mergeLabelAndSlipPdf(labelOnlyBytes, customPackingSlipPdf)`; on success, post the single merged PDF as `shipment-<orderNumber>.pdf` with title `Shipment <orderNumber> (label + packing slip)`. Audit envelope `slack.shipment.two-page-posted` records the canonical happy path. On merge-failure (defense in depth), fall back to label-only post + the existing thread-reply path with retry+backoff (Phase 28i+ fix from `434be27`) — slip-only Drive copy still exists for archival. The Phase 28i `resolveChannelMessageTs` retry stays as the fallback's fallback. **+8 merge tests** locking the 2-page contract: single+single → 2 pages; multi-page label preserved (3 pages from 2-label + 1-slip); page order (label first, slip second — verified via dimension fingerprint); works with real `buildPackingSlipPdfBuffer` output for the actual Amy Catalano fixture; throws on empty label input; throws on empty slip input; round-trips through `PDFDocument.load`; accepts `Uint8Array` as well as `Buffer`. Plus the 4 retry tests from `434be27` still pass. Full suite **1825 green** (was 1817); tsc clean. **The doctrinal rule going forward:** Ben's print is always a 2-page PDF. Always. No exceptions. Commit pending.

- **1.52 — 2026-04-27** — Phase 30.4: Reply Composer + Pipeline Enrich validation-surface lock. Both routes (`/api/ops/pipeline/reply-composer` + `/api/ops/pipeline/enrich`) had no test coverage. Today they're called from the Pipeline dashboard with operator-supplied prospect ids / deal arrays + a Claude API call gated behind those inputs. The risk surface: a regression that bypasses validation could 1) call the LLM with bogus payloads (paid token spend), 2) silently return fabricated emails when `ANTHROPIC_API_KEY` is unset (already handled, but no test was locking the behavior), or 3) accept malformed `deals` arrays. **+14 tests** across both routes locking the auth + validation surface — deliberately NOT exercising the Claude happy-path (that's an integration test, not a unit lock). reply-composer (6 tests, uses `isAuthorized` — CRON-friendly): 401 on auth rejection; 500 when ANTHROPIC_API_KEY unset (locks the deliberate "never run a paid LLM call without an env" behavior + "never silently fabricate an email"); 400 on missing prospect_id; 404 when prospect lookup returns null; **does NOT call Claude when prospect is missing** (locks the gate); does NOT call Claude when prospect_id is missing (locks the gate). enrich (8 tests, uses NextAuth `auth()` — session-only): 401 when there's no session; 401 when session is present but `user.email` is missing (defense in depth — middleware should also catch this but route locks too); 400 when body has no deals key; 400 when deals is not an array; 400 when deals is empty; 400 on invalid JSON payload; does NOT call Claude when validation fails; does NOT call Claude when auth fails. Vitest mock setup: `vi.mock` for `isAuthorized` / `auth()`/ `getProspect` / `getTouches` / `validateOutreachClaims` / `canUseSupabase` / `markSupabase*` / `model-policy.HARD_RULES_PROMPT` so the validation paths exercise without Supabase + Anthropic env. Full suite **1813 green** (was 1799); tsc clean. Closes the test-gap on the two LLM-calling pipeline routes — the surface where a regression could cost real money is now locked. Commit pending.

- **1.51 — 2026-04-27** — Phase 30.3: Inbox triage closed-loop (backlog selector). The email-intelligence pipeline (`src/lib/ops/email-intelligence/*`) already classifies, dedupes, drafts replies, and posts approval cards. What was missing: a visibility surface that answers *"how many emails were triaged but never decided?"* This module is the selector. Pure — no I/O. New `src/lib/ops/inbox-triage-backlog.ts`: `BacklogUrgency` (`critical | high | medium | low`) decoupled from the email-intelligence Classification (which doesn't carry urgency); `BacklogState` (`handled | awaiting-decision | junk | fyi-only`); `BacklogClassifierInput` config with three injected predicates (`requiresApproval(category)`, `isApprovalTerminal(approvalId)`, `urgencyFor(scannedEmail)`); `defaultUrgencyForCategory(category)` heuristic (shipping_issue + ap_finance → high; b2b_sales + sample_request + vendor_supply → medium; customer_support + marketing_pr + receipt_document + junk_fyi → low); `defaultRequiresApproval(category)` matching the canonical `gmail.send` Class B taxonomy slug (b2b_sales, ap_finance, vendor_supply, sample_request, shipping_issue, marketing_pr require approval; customer_support, receipt_document, junk_fyi do not); `ageHoursSince(iso, now)` (clamps future to 0; returns null on missing/unparseable); `computeBacklogState(scannedEmail, cfg)` with explicit priority order (junk_fyi → junk; approval terminal → handled; approval pending → awaiting-decision; draft + requiresApproval → awaiting-decision; draft + !requiresApproval → fyi-only; no draft + !requiresApproval → fyi-only; else → awaiting-decision); `projectBacklogRow` + `projectBacklogRows` produce typed rows with subject (clamped 120 chars), receivedAt, ageHours; `summarizeBacklog(rows)` returns counts per state + per category + per urgency, plus `oldestAwaitingHours` (only awaiting-decision rows count toward this — handled rows don't poison the metric); `STALE_HOURS_BY_URGENCY` registry (critical=1h, high=4h, medium=12h, low=24h — matches Ben's morning + afternoon scan cadence); `pickStaleAwaiting(rows, {limit})` filters to awaiting-decision rows whose age exceeds the per-urgency threshold, sorts critical>high>medium>low, oldest first within tier, caps at limit (default 5); `renderBacklogBriefLine(summary)` quiet-collapses to "" when zero awaiting, otherwise emits `:envelope: *Inbox triage:* N awaiting decision[, oldest Mh ago][ — K stale].`. **+27 tests**: ageHoursSince (positive past, future-clamps-to-0, null on missing/unparseable); defaultUrgencyForCategory (all 8 mappings); defaultRequiresApproval (all 9 categories); computeBacklogState (junk short-circuits regardless of other state, terminal-approval=handled, pending-approval=awaiting, draft+requiresApproval=awaiting, draft+!requiresApproval=fyi-only, no-draft-no-approval-not-required=fyi-only, no-draft-no-approval-required=awaiting); projection + summarization (counts reconcile to total; oldestAwaitingHours surfaces only awaiting rows; null when none; zero-len no NaN); pickStaleAwaiting (only includes rows whose age exceeds STALE_HOURS_BY_URGENCY[urgency]; sorts critical>high>medium>low oldest-first within tier; respects limit; never includes non-awaiting rows); renderBacklogBriefLine (zero-awaiting empty-collapse; canonical line with awaiting + oldest + stale tail; omits stale tail when zero); STALE_HOURS_BY_URGENCY monotonic invariant (critical < high < medium < low). Full suite **1799 green** (was 1772); tsc clean. Closes the inbox-triage observability gap. Wireup to a dashboard or daily-brief is a downstream consumer of this pure selector — the lock is on the math, not the surface. Commit pending.

- **1.50 — 2026-04-27** — Phase 30.1 + 30.2: AP-packet dashboard already mature (acknowledged); reorder triggers shipped. **Phase 30.1 noted as substantially-shipped in earlier work** — `/ops/ap-packets` already has roster + drafts + send-status derivation + recommended-action priority logic + counts summary + last-sent enrichment + 1320-line client view. Closing out with a marker rather than rebuilding. **Phase 30.2 (reorder triggers)** closes the loop on the existing cover-days forecast: `inventory-forecast.ts` was producing `reorderRecommended[]` (urgent ≤ 14d, soon ≤ 30d) but nothing actually fired on it. New module `src/lib/ops/inventory-reorder-trigger.ts`: `formatYmdUtc(date)` slices the ISO string for a TZ-safe day key; `buildReorderDedupKey(sku, day)` produces `inventory-reorder:alert:<sku-lower>:<YYYY-MM-DD>`; `pickReorderCandidates(forecast, {now?, limit?})` filters to urgent + soon, sorts urgent-first then ascending coverDays, caps at 10 (urgent gets the cap first); `renderReorderSlackMessage(candidates, forecast)` emits a Slack post with headline (count + urgent count), per-SKU bullets (`SKU — *N.N days* (urgency, M on hand, ~B/day)`), and a footer recommending `qbo.po.draft` Class B Ben (NOT Drew — post-Phase 29 doctrine, locked in tests); `partitionAlreadyAlerted(candidates, predicate)` splits via dependency-injected predicate so the route can wire KV existence checks while tests use Set fixtures. Quiet collapse: empty list → empty string. New auth-gated `POST /api/ops/inventory/reorder-trigger` reads inventory snapshot fail-soft, runs forecast, picks candidates, dedups via KV `kv.get` against per-SKU-per-day keys (TTL 36h to cover same-day re-fires across DST boundaries), posts to `#operations` only when there's something fresh to say (zero candidates → zero noise), persists fired keys via `kv.set` (best-effort — KV write failure means re-alert next scan, never silent loss), and emits a Class A `slack.post.audit` audit envelope via `buildAuditEntry` + `auditStore.append` with structured `after` payload (candidatesTotal, posted, skipped, slackOk, urgentSkus[]). Returns `{ok, generatedAt, candidatesTotal, posted, alreadyAlertedToday, slackOk, message?}`. Hard rules locked: auth-gated, Class A surface only (no auto-creating Class B `qbo.po.draft` approvals — that's a deliberate human action; approval spam is the anti-pattern), idempotent per SKU per day, fail-soft on every external call, read-only on inventory. **+15 tests** (helper module): formatYmdUtc TZ safety; dedup key shape; pickReorderCandidates filter logic (drops ok+unknown), urgent-first sort, limit cap urgent-prioritized, embeds dedup keys, empty-forecast empty-candidates; renderReorderSlackMessage empty-collapse, headline counts, bullet format, recommends qbo.po.draft Class B Ben, **does NOT mention Drew (post-Phase 29 doctrine lock)**; partitionAlreadyAlerted splits cleanly, empty input, all-alerted edge case. Full suite **1772 green** (was 1757); tsc clean. Closes the inventory observability gap that's been quietly silent since the cover-days forecast first shipped. Next cron-add: weekday 09:00/14:00 PT call to `POST /api/ops/inventory/reorder-trigger` with CRON_SECRET. Commit pending.

- **1.49 — 2026-04-27** — Phase 29: Drew doctrine sweep. Per Ben 2026-04-27 ("drew owns nothing") — Drew is a fulfillment node for samples + East Coast destinations only, NOT an approver, agent owner, or class B/C requiredApprover. **Reassignments executed:** taxonomy slugs (`qbo.po.draft` Drew→Ben; `inventory.commit` / `run.plan.commit` / `inventory.adjustment.large` Ben+Drew→Ben+Rene); compliance-doctrine owners (`fda-facility-registration` / `vendor-coi-powers` / `vendor-coi-belmark` Drew→Ben); divisions registry (`production-supply-chain` humanOwner Drew→Ben with explicit doctrinal note in `notes`); agent contracts (`/contracts/agents/ops.md` v1.0→v1.1: human owner Drew→Ben, write-scope approvers reassigned, escalation rewritten, prohibited section clarified Drew=samples-only-fulfillment-node; `/contracts/agents/inventory-specialist.md` v1.0→v1.1: human owner Drew→Ben, all Class B Drew approvers→Ben, all Class C Ben+Drew→Ben+Rene, monthly cycle-count prompt Drew→Ben, escalation rewritten, version history updated); doctrine docs (`approval-taxonomy.md` v1.3→v1.4 with explicit "Doctrinal correction" note; `activation-status.md` Monday gate "Ben/Rene/Drew"→"Ben/Rene", inventory-specialist owner Drew→Ben, "Rene's + Drew's acknowledgment"→"Ben's + Rene's acknowledgment"). **Drew references KEPT** (per CLAUDE.md fulfillment rules): `sample-order-dispatch.md` (Drew handles East Coast samples), `HumanOwner` type union (preserves audit log compatibility — Drew was an actor before the doctrinal correction), Slack user lookup table (Drew is still a person on Slack), audit.ts type comments (Drew is a real audit actor in historical entries). **New doctrine-lock test** `src/lib/ops/__tests__/drew-doctrine.test.ts` enforces the invariant going forward: no taxonomy slug may name "Drew" as a required approver; no compliance requirement may name "Drew" as owner; no agent-health manifest entry may have `owner: "drew"`. Each lock fires a deliberate, descriptive error message (with the offending slug/id) so a future regression can't slip through silently. Full suite **1757 green** (was 1754); tsc clean. Closes the Drew-as-owner doctrinal sweep that was queued at the top of Phase 28L. Commit pending.

- **1.48 — 2026-04-27** — Phase 28L.4: Agent-health doctrine surface (sibling of `/ops/agents/status`, not replacement). Inspired by Nate B. Jones, "Why 97.5% of Agents Fail" (Apr 23, 2026): the dominant failure mode is shipping *tasks* (run once, report) when you needed *jobs* (close a loop, move state to a terminal). Status answers "did the cron fire?"; health answers "does this agent satisfy the doctrine?" New module `src/lib/ops/agent-health.ts` registers 15 agents with full classification: `classification` (`task` | `job`), `approvalClass` (A/B/C/D), `owner` (named human or "unowned"), `approver` (required for B/C/D jobs), `lifecycle` (`proposed` | `active` | `graduated` | `retired` | `parked`), `purpose` (one-line why), optional `notes` (justification for tasks), optional `runtimeBroken`. **Five doctrine flags:** `drew-owns` (Ben 2026-04-27 "drew owns nothing" → red), `unowned` (no named human → red), `job-without-approver` (B/C/D jobs without an approver → red), `task-without-justification` (active task without notes → yellow soft flag — long-run direction is convert tasks to jobs or retire), `runtime-broken` (manifest flag → red). Health roll-up: empty flags → green; only soft → yellow; any other → red. Combined hard+soft flags surface red (drew + task-without-justification = red because drew is hard). Manifest is hand-curated — adding an agent here is the registration step, forcing classification at registration time. Live manifest is doctrinally clean: zero drew-owners, every B/C/D job has a named approver, every active task has notes (or is exempt as "proposed"). New auth-gated `GET /api/ops/agents/health` returns `{ok, generatedAt, summary, rows}` where summary captures total/green/yellow/red/jobs/tasks/byLifecycle/byApprovalClass/drewOwnedCount. Page `/ops/agents/health` renders 7 counts tiles (Total / Healthy / Soft flag / Doctrinal red / Jobs / Tasks / Drew-owned) + filter strip (all-vs-flagged + classification) + per-agent cards with health pill, classification pill (Job=blue / Task=amber), Class A-D pill colored by severity, lifecycle, owner (red on drew/unowned), approver, contract path, doctrine notes, and any flags fired. Cards arrange in responsive grid (`auto-fill, minmax(380px, 1fr)`). Manifest seeded with 15 agents covering all current contracts: executive-brief (job/A/ben/graduated), finance-exception, ops, compliance-specialist (task/A/ben — intentionally task), faire-specialist, reconciliation-specialist, amazon-settlement (task/A/rene — graduates to job once Amazon→QBO journal slug registered), research-librarian (task/A/ben — research curation intentionally human-led), drift-audit-runner, fulfillment-drift-audit, shipstation-health, sample-order-dispatch, viktor-rene-capture (task/A/rene — Rene approves QBO write through separate slug), interviewer (task/A/ben/proposed — Phase 28L.1), qbo-bill-create-from-receipt (job/C/rene — PARKED awaiting Rene's chart-of-accounts mapping). **+25 tests** (22 module + 3 route): manifest invariants (unique kebab ids; closed enums for classification/class/lifecycle/owner; **manifest contains zero drew-owners** — locked); evaluateAgentDoctrine (clean Class A green; drew-owned red; unowned red; B-job-without-approver red; B-job-with-approver green; A-job exempt from approver; active-task-without-notes yellow; active-task-with-notes green; proposed-task-without-notes does NOT trip soft flag; runtimeBroken red; combined hard+soft → red); buildAgentHealthRows (one row per entry; live manifest has no drew flags; custom manifest respected); summarizeAgentHealth (counts reconcile to total; lifecycle sum + class sum equal total; drewOwnedCount=0 on live manifest, counts custom drew entries; zero-len returns no NaN); route (401 on auth; full shape with one row per manifest entry; live manifest is clean — drewOwnedCount=0). Full suite **1754 green** (was 1729); tsc clean. Closes the third Nate-inspired add (28L.1 interviewer + 28L.2 session-handoff + 28L.3 stack-readiness now joined by 28L.4 agent-health). Commit pending.

- **1.47 — 2026-04-27** — Phase 28L.3: Stack-readiness dashboard. Inspired by Nate B. Jones, "stack literacy is the missing discipline" — Make.com being silently broken since ~Apr 13 was undermining the wholesale-lead → HubSpot deal hop for two weeks because no surface displayed "Make.com webhook failing." Closes that observability gap. New manifest module `src/lib/ops/stack-readiness.ts`: 17 services across 5 architectural layers (compute / storage / auth / integration / marketplace), each with `id` (kebab-case), `name`, `layer`, `envVars[]`, `maturity` (1-5: 1=battle-tested core, 5=deprecation-runway), `degradedMode` (plain-language description of what breaks when this is down), `replacement` (what we'd swap to if it dies for good), and optional `knownIssue`. Make.com rated maturity 4 with knownIssue calling out the broken-since-Apr-13 state; QBO carries a knownIssue noting Rene's chart-of-accounts rebuild parking `qbo.bill.create.from-receipt`. Pure helpers: `checkEnvVars(service, env)` flags whitespace-only and undefined as missing; `combineProbeAndEnv(service, probe, envCheck)` pins env-missing → status="down" (probe outcome can't override missing env); `summarizeStack(rows)` returns counts + average maturity; `noProbe(message)` is honest about un-probed services rather than fabricating green checks; `probeFetch({url, init, okPredicate})` wraps fetch with `AbortSignal.timeout(10000)` and maps thrown rejections to `status="down"` so a single down service can't pin the route. New auth-gated `GET /api/ops/stack-readiness` runs all probes in parallel via `Promise.allSettled`; bounded total wall time ≤10s; returns `{ok, generatedAt, summary, rows}`. Per-service runProbe dispatcher: live HEAD/GET probes for vercel-kv (REST `/get/__stack-readiness-probe`), slack (`auth.test`), shipstation (`/accounts/listtags`), shopify-storefront (GraphQL `{shop{name}}`), shopify-admin (`/shop.json`), hubspot (`/contacts?limit=1`); explicit unprobed for vercel (self-host loopback meaningless), nextauth (the route gate IS the proof), stamps-com (provider via ShipStation), and OAuth-heavy services (qbo / google-drive / gmail / notion / ga4 / plaid / amazon-sp-api) where a live probe needs token refresh. Make.com surfaces as "degraded" with the bypass explanation rather than calling its webhook (which 200s even when broken). Page `/ops/stack-readiness` renders 5 counts tiles (Healthy / Degraded / Down / Unprobed / Avg maturity) plus per-layer tables (Compute → Storage → Auth → Integrations → Marketplaces), each row showing status pill, env-check (`✓ all set` / `✗ N missing`), probe message + latency, maturity bar (1-5 squares colored green→amber→red), and a click-to-expand drawer with degradedMode + replacement + knownIssue + missing env vars + required env vars. Middleware extended: `/api/ops/stack-readiness` added to SELF_AUTHENTICATED_PREFIXES. **+22 tests** (18 module + 4 route): manifest sanity (every layer present; unique kebab ids; required fields; make-com flagged maturity≥4 with knownIssue); checkEnvVars (whitespace/undefined/empty are missing; no-envvar services always ok); combineProbeAndEnv (env-missing forces down regardless of probe; preserves probe degraded/down/unprobed verdicts when env ok); summarizeStack (counts reconcile to total; zero-len returns 0 not NaN); probeFetch (200→ok; non-2xx→down; okPredicate overrides res.ok; never throws on rejection); route (401 on auth; one row per manifest service; full shape including summary/rows; counts reconcile to total; never throws when every probe fails; only read-style HTTP methods invoked). Full suite **1729 green** (was 1707); tsc clean. Closes the second of three Nate-inspired adds (28L.1 interviewer + 28L.2 session-handoff already shipped at `0b4c46b`). Commit pending.

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
- **1.17 — 2026-04-25** — S1.6 Phase 11: "Request Rene review" UI button per receipt on `/ops/finance/review`. New pure presenter `derivePromoteReviewPill(state)` in `src/app/ops/finance/review/data.ts` projects 5 state kinds (idle/loading/opened/draft-only/error) into a typed pill description. `FragmentRow` becomes stateful: button → POST `/api/ops/docs/receipt/promote-review` (Phase 9 route) → `promoteReviewRequest()` parses response → state stored per-row → conditional sub-row renders the pill. Eligible response = green pill with truncated 8-char approval id + status + approvers (`(none)` defensive default). Ineligible response = amber pill with the route's verbatim reason + `missing[]` list when present (NO stray `· missing:` suffix when empty). Error = red pill with underlying message verbatim — locked by no-paraphrase test (ECONNREFUSED stays ECONNREFUSED). Read-only render: no inline canonical-field edit; pill footer reads "Read-only — review fields above are unchanged. QBO posting still runs through a separate `qbo.bill.create` action." OCR sub-row colSpan adjusted from 3→4 to match new 8-column header. +11 tests; full suite 1197 green.
- **1.18 — 2026-04-25** — S1.6 Phase 12: Slack-thread permalink + per-row poll for closer transition. Read-only `getPermalink(channel, message_ts)` added to `src/lib/ops/control-plane/slack/client.ts` (degraded-mode safe). Promote-review route refactored to use `openApproval` so `slackThread` is populated by `surfaceApproval`; eligible response now carries `approval.permalink: string | null`. New auth-gated read-only `GET /api/ops/docs/receipt-review-packets/[packetId]` returns `{ packetStatus, approvalStatus, approvalId }`. `PromoteReviewState.opened` extended with optional `permalink` + `packetStatus`. `derivePromoteReviewPill` flips label to "Rene approved" (green) on `packetStatus = rene-approved` and "Rene rejected" (amber, deliberate gap signal) on `packetStatus = rejected`. `FragmentRow` polls the status route every 30s for up to 6 ticks once `kind === "opened"`; stops on terminal packetStatus or any failure. Pill renders a clickable "Open thread →" anchor when `permalink` is non-null; never invents a URL. Static-source assertions on the new status route lock no-QBO/HubSpot/Shopify/slack-send/createQBO*-write/chat.postMessage/WebClient/openApproval/buildApprovalRequest imports; only GET exported. +15 tests; full suite 1212 green.
- **1.19 — 2026-04-25** — S1.6 Phase 13: Aggregate review-packets dashboard at `/ops/finance/review-packets`. New auth-gated read-only `GET /api/ops/docs/receipt-review-packets` (no packetId, list mode) with `limit` clamped to [1, 500] (default 100). New pure helper `buildReviewPacketsView(packets)` in `src/app/ops/finance/review-packets/data.ts` projects packets into typed table rows + counts (`total / draft / reneApproved / rejected`); sort is draft-first, then most-recent-first by createdAt. Status → color: draft=amber, rene-approved=green, rejected=red. Vendor / amount fallback: canonical → ocr-suggested → null+missing source (NEVER fabricated). `formatAmountCell` / `formatVendorCell` append `(ocr)` suffix when source is OCR-suggested; null/NaN/Infinity → `"—"`. New server page + client view fetch the list route, render a counts strip + status-color-coded table, with refresh button + empty/loading/error states. Static-source assertion on the list route locks no-QBO/HubSpot/Shopify/slack-send/createQBO*-write/openApproval/buildApprovalRequest imports; only GET exported. +28 tests; full suite 1240 green.
- **1.20 — 2026-04-25** — S1.6 Phase 14: Operator filters + inline Re-promote on the aggregate dashboard. New pure helper `applyReviewPacketsFilters(view, spec)` in `src/app/ops/finance/review-packets/data.ts` narrows by status (`all` | `draft` | `rene-approved` | `rejected`), vendor substring (case-insensitive, OCR-suffix-tolerant), and `createdAfter` / `createdBefore` date range. Defensive defaults: empty / whitespace / unparseable filters all collapse to "no filter" (keystroke errors never hide rows). Rows with unparseable `createdAt` are excluded under any active date filter (no silent inclusion of un-positionable data). Counts recomputed verbatim from filtered rows. Client view renders a filter strip (`<select>` + `<input type="text">` + 2× `<input type="date">` + Clear button), filtered counts strip with `(filtered)` indicator, and a new "Action" column with an inline Re-promote button per row. Re-promote POSTs to the existing Phase 9 `POST /api/ops/docs/receipt/promote-review` route — no new server route. On success the list refreshes; on failure the per-row pill renders red with the underlying error verbatim. Per-row state cleared on every refresh. Read-only render contract preserved — no inline canonical-field edit, no auto-fire of `qbo.bill.create`. +15 tests; full suite 1255 green.
- **1.21 — 2026-04-25** — S1.6 Phase 15: Server-side filtering + bounded passive poll on the aggregate dashboard. Three new server-safe helpers in `data.ts` — `parseReviewPacketsFilterSpec(query)`, `reviewPacketsFilterSpecToQuery(spec)`, `filterPacketsBySpec(packets, spec)` — share the same `URLSearchParams` shape across client + server. List route `GET /api/ops/docs/receipt-review-packets` parses the four canonical query params, applies `filterPacketsBySpec` only when a non-default filter is present, and returns `{ count, totalBeforeFilter, filterApplied, packets }`. Server filter behavior is bit-identical to the client helper — locked by a parity test that compares server packetId set to `applyReviewPacketsFilters` output. Client view serializes the filter spec via `reviewPacketsFilterSpecToQuery` before fetching; defensive client-side filter belt remains. Bounded passive poll (60s × 10 ticks = 10 min worst case) refreshes the list automatically; re-arms on filter change; stops on unmount or final tick. Unknown query params ignored; empty/whitespace fields collapse to "no filter"; `status=all` is treated as no filter. Static-source no-mutation contract on the route still holds. +24 tests; full suite 1279 green.
- **1.22 — 2026-04-25** — S1.6 Phase 16: Approval-status filter (control-plane state). `ReviewPacketRow` extended with `approvalId / approvalStatus` (null when no associated approval — never fabricated). `ApprovalsByPacketId` lookup map plumbed through `buildReviewPacketsView` + `filterPacketsBySpec`. `applyReviewPacketsFilters` accepts `approvalStatus: "any" | "no-approval" | "pending" | "approved" | "rejected" | "expired" | "stood-down"`. Without the map, only `"any"` / `"no-approval"` can match anything — defensive lock so a forgetful route can't widen the set. `parseReviewPacketsFilterSpec` / `reviewPacketsFilterSpecToQuery` extended with the same param. List route builds the lookup from `approvalStore.listPending()` + `listByAgent("ops-route:receipt-promote", 200)` (both fail-soft, both read-only); response gains `approvals: Record<packetId, {id, status}>`. Client view gains an "Approval" filter select + table column (color-coded: approved=green, pending=amber, rejected=red, others=dim). Phase 15's bounded passive poll re-arms on the new filter automatically. Lockstep parity test continues to compare server `filterPacketsBySpec` output against client `applyReviewPacketsFilters` rows. +23 tests; full suite 1302 green.
- **1.23 — 2026-04-25** — S1.6 Phase 17: Cursor-based pagination on the list route. New pure helpers in `data.ts`: `encodeReviewPacketCursor` / `decodeReviewPacketCursor` (base64url-encoded `{ts, packetId}`, defensive on null/empty/malformed/wrong-types/empty-packetId — eight separate guard cases) + `paginateReviewPackets(packets, {limit, cursor?})` returning `{page, nextCursor}`. Canonical sort is `createdAt DESC, packetId ASC` tie-break — locked by traversal test over a 5-packet fixture with timestamp ties. List route loads the full set, applies filter, then paginates the FILTERED set (so cursor traversal of an active filter doesn't show half-empty pages). Response gains `matchedTotal` (full filtered length) + `nextCursor: string | null`; `approvals` lookup scoped to the current page only. Client view gains Load more button + accumulated `pageCount` + "Showing X of Y · N pages loaded" label. Phase 15's bounded passive poll skips when `pageCount > 1` to preserve operator scroll state. Malformed cursor falls back to first page (defensive — never throws). +24 tests; full suite 1326 green.
- **1.46 — 2026-04-27** — S1.7 Phase 28k: Amazon FBM customer registry (Option B). The auto-ship pipeline now persists buyers — if "ann (Molak) at 3 Spindrift Way Barrington RI" orders again, the system recognizes her as a repeat customer instead of starting fresh. New module `src/lib/ops/amazon-customers.ts`: `computeAmazonCustomerFingerprint({shipToName, shipToPostalCode})` produces a stable `${lowercased-stripped-name}|${zip5}` key (collapses ZIP+4 → ZIP5, strips punctuation, normalizes whitespace; null when name OR ZIP missing — refuses to collide buyers under a noisy default). `recordAmazonOrderShipped(input)` upserts with idempotency: same orderNumber called twice doesn't double-count aggregates; `recentOrders` capped at 10 newest-first; aggregates increment `orderCount`/`totalBags`/`totalRevenueUsd`/`totalShippingCostUsd`; `firstSeenAt` preserved across upserts; TTL 1 year for first-time / 3 years for repeat. `getAmazonCustomer(fp)` + `listAmazonCustomers({limit, sortBy, repeatOnly})` + `sortAmazonCustomers(records, sortBy)` + `summarizeAmazonCustomers(records)` round out the read surface. New auth-gated `GET /api/ops/customers/amazon` (limit clamps [1,500] default 100; sortBy ∈ {lastSeen, firstSeen, orderCount, totalRevenue}; repeatOnly toggle). Page `/ops/customers/amazon` renders 5-tile counts strip (Unique / Repeat / One-and-done / Total orders / Total bags), sort + repeat-only filter, and a customers table with expandable per-row recent-orders detail; repeat customers tagged with a gold "Repeat ×N" pill. Wired into auto-ship route success path: every Amazon FBM shipment fires `recordAmazonOrderShipped()` after the audit lands; fail-soft (KV outage never rolls back the shipment). Middleware extended: `/api/ops/customers/` added to SELF_AUTHENTICATED_PREFIXES so the route accepts session OR CRON_SECRET. PII note: same data we already have in ShipStation + audit log — this just makes it queryable. **+23 tests** (16 helper + 7 route): fingerprint normalization (case/punctuation/ZIP+4 collapse/null gates), first-time vs repeat upsert, idempotent replay, recentOrders cap, KV-throw fail-soft, sort by all 4 keys + tie-break stability, summary totals + repeat count. Full suite **1707 green** (was 1684); tsc clean. **Doctrinal correction:** "Drew East-Coast routing confirmation" dropped from the readiness grid (Ben 2026-04-27: "drew owns nothing"). Red count: 7 → 6. Wider Drew-as-owner sweep across `contracts/`, `CLAUDE.md`, `src/` ownership references is pending Ben's reassignment direction (10+ slugs/contracts currently name Drew). Commit pending.
- **1.45 — 2026-04-27** — S1.7 Phase 28j: SKU map variant defense + `totalBagsForItems` Infinity guard. While verifying for Ben that the auto-pipeline's slip quantity is actually correct (SP-API qty=1 → audit bags=1 → slip qty=1, all three agree for the broken 113-6688403 order), audited `SKU_BAGS_PER_UNIT` and added pre-emptive entries for `USG-FBM-2PK → 2` + `USG-FBM-3PK → 3`. Today's only live Amazon variant is `USG-FBM-1PK`; the 2/3-pack mappings cover a future variant launch so a 3-pack ordered as `qty:1, sku:USG-FBM-3PK` doesn't silently undercount via the bagsPerUnitForSku default-of-1 fallback. Found + fixed a real bug: `totalBagsForItems` accepted `Number.POSITIVE_INFINITY` quantities (the existing `Math.max(0, Math.floor(Number(...) || 0))` chain doesn't trip the truthy-or-zero shortcut for Infinity). Added `Number.isFinite()` guard so corrupted order items never compute infinite bags + hand undefined behavior to `pickPackagingForBags`. New `src/lib/ops/__tests__/shipping-packaging.test.ts` (no prior coverage) — +23 tests covering all 12 registered SKUs (1PK/2PK/3PK/5PK/10PK Amazon + Shopify variants + wholesale/master), case-insensitive matching, whitespace trim, unknown-SKU warning emission, null/empty/undefined fallbacks, qty=1/3 today's-and-yesterday's-real-data fixtures, 3PK qty=1 → 3 bags variant-launch defense, zero/negative/NaN/Infinity skip path, fractional qty floor, empty-array invariant. Full suite **1684 green** (was 1661); tsc clean. Commit pending.
- **1.44 — 2026-04-27** — S1.7 Phase 28i: fix `uploadBufferToSlack` channel-message ts resolution. **The bug:** `files.completeUploadExternal` returns `file.permalink` as a FILE permalink (`…/files/<userId>/<fileId>/<filename>`), NOT a channel-message permalink (`…/archives/<channel>/p<digits>`). `permalinkToMessageTs` regex `/p<digits>(?:\?|$|#)/` doesn't match the file format, so `uploadBufferToSlack` returned `messageTs: undefined` for every live upload. The auto-ship route's packing-slip thread reply (Phase 28a) is gated on `customPackingSlipPdf && uploadRes.messageTs` — silently never fired since Phase 27 first shipped the helper. Yesterday's threaded posts in `#shipping` worked only because I uploaded them manually via Python with hardcoded parent ts. **Today's first live auto-ship buy** (Amazon order 113-6688403-1140261, recipient ann/Molak Barrington RI, 09:40 PT) surfaced the regression: label posted to `#shipping`, packing slip generated + Drive-written, but **no thread reply** because `messageTs` was undefined. **Triage:** retroactively built + threaded the missing packing slip (Slack file `F0B03DB3NRL` under parent ts `1777298415.214529`) so Ben could print + drop today. **Root fix:** new private helper `resolveChannelMessageTs({token, channelId, fileId})` in `slack-file-upload.ts` queries `conversations.history` (limit=50) and finds the message whose `files[].id` matches the just-uploaded file id; returns that message's `ts`. Uses bot's existing `channels:history` scope (NOT `files:read` which the bot lacks — `missing_scope` confirmed via live probe). Wired into BOTH `uploadFileToSlack` (CSV/XLSX path) AND `uploadBufferToSlack` (auto-ship label path) returns. Falls back to `permalinkToMessageTs(file.permalink)` (still always undefined for these uploads, but kept for future-proofing if Slack ever returns a different shape). Fail-soft: history fetch errors / missing scope / file not in recent 50 → `undefined`; the upload itself still returns `ok: true` because the file already landed. +4 tests on the new resolution path (happy: history finds file → message ts; ok:false fallback; no-match fallback; history-throws-mid-flight upload still ok). Full suite **1661 green** (was 1657); tsc clean. Closes the silent-thread-reply regression — every future auto-ship buy will land both label AND packing slip in `#shipping` correctly. Commit pending.
- **1.43 — 2026-04-26** — S1.7 Phase 28h: morning brief oldest-open-package callout. Builds on Phase 28d (`composeDispatchBriefSlice`). `DispatchBriefSlice` gains two fields: `oldestOpenShipDate: string | null` (lex-smallest YYYY-MM-DD across ALL open rows — not just bought-in-window, because the whole point is to surface silently-aging packages) + `oldestOpenAgeDays: number | null` (whole days, floored, vs `windowEnd`). Garbage shipDate strings don't crash and don't count. New exported constant `DISPATCH_BRIEF_STALE_DAYS = 3` matches Ben's hard rule (Amazon FBM ≤ 2 business days to ship-by — anything older than 3 calendar days is genuinely stale). `renderDispatchBriefMarkdown` extended: when `oldestOpenAgeDays > DISPATCH_BRIEF_STALE_DAYS`, appends a second line `:warning: *Oldest open package: N days on the cart* — past the 2-business-day handling promise; print + drop today.` Day-vs-days pluralization via `=== 1` check (defensive even though >3 means "1 day" never fires today). Quiet collapse preserved: zero activity AND no stale callout → empty string. Stale-without-activity → just the warning line. Activity + stale → two distinct lines. +8 tests (oldestOpenShipDate lex selection, age=null when no open rows, garbage doesn't crash, callout renders >3, NOT at exactly 3-day boundary, callout-only-no-activity render path, both-lines render path, quiet-collapse below threshold). Full suite **1657 green** (was 1649); tsc clean. Closes the loop on "what's been sitting too long" — operators can't miss a stale package on the morning brief now. Commit pending.
- **1.42 — 2026-04-26** — S1.7 Phase 28g: "Recent dispatch activity" sub-card on `/ops/shipping/dispatch` + audit-feed route. Builds directly on the Phase 28e audit trail. New pure projector `src/lib/ops/shipping-dispatch-audit-feed.ts` exposes `DispatchFeedRow` type, `DISPATCH_AUDIT_ACTIONS` constants (`shipping.dispatch.mark` / `shipping.dispatch.clear`), `projectDispatchAuditEntryToFeedRow(entry)` (defensive: unknown action / wrong entityType / missing entityId / colon-less entityId / empty source-or-orderNumber → null; result==="error" without message → null; coerces non-ok/error result variants to "ok"), and `sortDispatchFeedRows(rows)` (newest-first by `timestampIso`, id DESC tie-break). New auth-gated read-only `GET /api/ops/shipping/dispatch-audit-feed` (limit clamped [1,100] default 20) reads BOTH action streams in parallel via `auditStore().byAction()`, projects + filters malformed via the helper, merges + sorts, slices to limit. NEVER returns count:0 silently — auditStore exception → HTTP 500 with reason. Client view (`DispatchBoardView.client.tsx`) gains `<DispatchAuditFeed>` sub-card BELOW the table: refresh button, error inline, empty state, otherwise compact 5-column row (action emoji 📦/↩️, orderNumberShort + source, actor, surface, relative time). +21 tests (15 projector + 6 route): happy paths (mark + clear), short-vs-long orderNumberShort logic, multi-segment Amazon orderNumber preservation, all 6 defensive null paths, error-message preservation, sort newest-first + tie-break + immutability, route auth gate, route 500-on-throw, merge-streams-newest-first, malformed-entries-skipped, limit clamping, final-response-slice. Full suite **1649 green** (was 1628); tsc clean. Closes the loop on dispatch state observability — operators can now see the last 20 transitions at a glance from the dispatch board itself, without bouncing to Slack to scroll thread replies. Commit pending.
- **1.41 — 2026-04-26** — S1.7 Phase 28e + 28f: dispatch audit trail + `/ops/sales` dispatch tile. **28e — audit trail:** every `markDispatched` / `clearDispatched` state flip emits an `auditStore().append()` entry via new `recordDispatchAudit` helper at `src/lib/ops/shipping-dispatch-audit.ts`. Two action slugs: `shipping.dispatch.mark` (first-time + re-marks; `before` is null on first, prior ISO on re-mark) and `shipping.dispatch.clear` (only when there was actually a stamp to clear — already-clear records don't pollute the trail). Surface tag (`slack-reaction` vs `ops-dashboard`) is captured in `actorId` (`shipping-dispatch-reaction` vs `shipping-dispatch-dashboard`) and `after.surface`, plus `after.postedThreadReply` so the trail records whether the corresponding `:package: Dispatched` thread reply landed. Fail-soft: an `auditStore.append()` throw is captured in the helper's return shape but NEVER propagates back to the caller — the dispatch state flip remains the source of truth, the audit trail is downstream observability. Wired into `/api/ops/slack/events` (reaction handler) and `/api/ops/shipping/mark-dispatched` (dashboard POST). +6 tests on the helper (first-mark, re-mark with prior-ISO before, clear, surface→agentId mapping, append-throw captured, entityId formatting). **28f — `/ops/sales` dispatch tile:** new `SectionDispatchSummary` on `SalesCommandCenterReport` with `openCount` + `dispatchedLast24h` (both `SourceState<number>`) + `oldestOpenShipDate` (lex-smallest YYYY-MM-DD among open rows; null when none) + `deepLink` (`/ops/shipping/dispatch`). Pure projector `buildDispatchSummary(input, now)` reads `input.dispatchRows` (same row shape `/api/ops/shipping/dispatch-board` returns) — when omitted, both counts are `not_wired` with default reason "ShipStation not configured." (overridable via `dispatchNotWiredReason`). Open-count + dispatched-24h-count are independent (a row dispatched 2h ago counts toward dispatched but is no longer "open"). Garbage `shipDate` / `dispatchedAt` don't crash and don't count. Wired into `/api/ops/sales` route: when `isShipStationConfigured()`, fetch shipments from the last 14 days + bulk-resolve artifacts + run `buildDispatchBoardRows`, pass rows into the composer; on read failure, set `dispatchNotWiredReason` to surface the specific reason in the tile (e.g. "ShipStation read failed: timeout"). Client view gains `<DispatchSummarySection>` between KPI Scorecard and Aging — two tiles (Open / Dispatched-24h) + "Oldest open package shipped <date>" subline + "Open Dispatch Board →" deep link. +6 tests on the projector (not_wired default reason, custom reason, both-counts-independent semantics, oldestOpenShipDate logic, garbage timestamps don't crash, empty-rows-array → both wired with 0). Full suite **1628 green** (was 1616); tsc clean. Commit pending.
- **1.40 — 2026-04-26** — S1.10 Phase 1.b: HubSpot deal-create wired directly into `/api/leads` — eliminates the Make.com bridge dependency for the wholesale lead → HubSpot deal hop. The public `/wholesale` form posts to `/api/leads`; previously, HubSpot deal creation only happened downstream via a Make.com webhook (which has been broken since Apr 13 per memory). Now the route calls `upsertContactByEmail` + `createDeal` directly (same pattern as `/api/booth-order`), stamping `payment_method=invoice_me` + `dealstage=STAGE_LEAD` + `onboarding_complete=false` + `payment_received=false` + a structured note mirroring the customer's submission. Response now carries `hubspotDealId` + `hubspotContactId` so callers can deep-link into the deal. Fail-soft: HubSpot down / `HUBSPOT_PRIVATE_APP_TOKEN` unset → silent skip (no errors logged in expected dev/preview/test default), public form still 200. Submissions without email never touch HubSpot (deal needs a contact key). Non-wholesale intents (`newsletter` / `footer` / etc.) never touch HubSpot regardless of configuration. +3 tests on the new branch (HubSpot-not-configured silent-skip, non-wholesale-never-calls, no-email-never-calls). Full suite **1616 green** (was 1613); tsc clean. Closes the Make.com dependency for the Rene fake-vendor walkthrough Path B step 3. Commit pending.
- **1.39 — 2026-04-26** — S1.10 Phase 1: Invoice-Me explicit "ship + PO" acknowledgment gate on `/onboarding/[dealId]`. Customer-facing wholesale onboarding form gains a SECOND required checkbox below the existing Net-10 terms agreement: *"I understand that submitting this form ships product and produces a PO."* Lives separately from the Net-10 terms so each obligation is consciously ticked. Wired through `OnboardingPortal.client.tsx` (`shipAndPoAcknowledged` state, `totalSteps` bumped from 12 → 13 on Invoice-Me path) and `POST /api/onboarding` (validates `b.shipAndPoAcknowledged === true` strict, adds to `missing` array on 400, records "Ship + PO acknowledged: YES" line in the HubSpot deal note for audit). Pay-Now path is unaffected (no PO in that flow — it's a paid Shopify checkout). Strict `=== true` payload validation prevents truthy-string spoofs (`"true"`, `1` rejected). +7 route tests on the new gate (HubSpot-not-configured 500, both-acks-required 400 with `missing` array, individual-ack-missing 400, happy-path 200 with note text assertion, strict-truthiness, Pay-Now path skips the new gate). Full suite **1613 green** (was 1606); tsc clean. Reduces the gap between "customer submitted info" and "customer understood we'll ship + invoice based on this submission". Commit pending.
- **1.38 — 2026-04-26** — S1.7 Phase 28d: dispatch board filter strip + morning daily-brief dispatch slice. **Filter strip on `/ops/shipping/dispatch`:** new pure helpers in `src/lib/ops/shipping-dispatch-board.ts` — `applyDispatchBoardFilters(view, spec)`, `dispatchBoardFilterIsActive(spec)`, `parseDispatchBoardFilterSpec(query)`, `dispatchBoardFilterSpecToQuery(spec)`. `DispatchBoardFilterSpec` covers state ("all"|"open"|"dispatched"), source ("all"|"amazon"|"shopify"|"manual"|"faire"), shipDate range (from + to, inclusive YYYY-MM-DD, both ends optional), search (case-insensitive substring against orderNumber + tracking + recipient + postalCode). AND semantics across dimensions; whitespace / unparseable / "all" values collapse to no-filter (defensive — keystroke errors never hide rows). Counts always recomputed on filtered set. `GET /api/ops/shipping/dispatch-board` extended: parses canonical query params, returns `{filterApplied, filterSpec, countsBeforeFilter, counts, rows}` so the client can show "Filtered from N total" indicator. Client view (`DispatchBoardView.client.tsx`) gains `<FilterStrip>` with state/source selects, two date inputs, search input, and Clear-filters button (disabled when no active filter). Each `setSpec` triggers a re-fetch automatically; mark/clear actions refresh respecting current filter. **Morning daily-brief dispatch slice:** new pure projection helper `composeDispatchBriefSlice(rows, now?)` and renderer `renderDispatchBriefMarkdown(slice)` in `src/lib/ops/control-plane/daily-brief.ts`; new `DispatchBriefSlice` type added to `BriefInput`. Window: `[now - 24h, now)`. Counts: `labelsBought` (rows whose shipDate is in-window), `dispatched` (rows whose dispatchedAt is in-window — independent of bought-window so backfill marks count without double-attributing), `stillOpen` (subset of bought-in-window with state="open" — the "go drop them off" nudge). Pure: same input → same output; null/garbage timestamps don't crash and don't count. Renderer emits a single `:package: *Dispatch (last 24h)*  *X* bought · *Y* dispatched · *Z* still on cart — go drop them off` line; quiet collapse to empty string when zero activity (no `0 / 0 / 0` noise). Wired into `composeDailyBrief`: morning + dispatch present → block appears between sales-command and EOD-fulfillmentToday slots; EOD with dispatch → NEVER renders (avoids duplicating fulfillmentToday). Daily-brief route extended: when `kind === "morning"` AND `isShipStationConfigured()`, the route fetches recent shipments + bulk-resolves artifacts + runs `buildDispatchBoardRows` + `composeDispatchBriefSlice` and passes the slice into `composeDailyBrief`. Missing ShipStation creds skip silently (mirrors the salesCommand not-configured pattern); ShipStation errors push to degradations. **+24 tests** (12 filter helpers + 6 dispatch slice composer/renderer + composer integration); full suite **1606 green** (was 1582); tsc + lint clean. Commit pending.
- **1.37 — 2026-04-26** — S1.7 Phase 28c: `/ops/shipping/dispatch` Dispatch Board — second surface for marking shipments dispatched, complementing the Slack `:white_check_mark:` reaction. Useful for batch dispatch when the operator has 10 packages going out at once and reacting to each label post in Slack would be tedious. New pure projection helper `src/lib/ops/shipping-dispatch-board.ts` (`DispatchBoardRow`, `DispatchBoardCounts`, `DispatchBoardView`, `inferSourceFromOrderNumber`, `buildDispatchBoardRows`) joins ShipStation `getRecentShipments` + artifact records into typed rows; sort is open-first, then shipDate DESC, then tracking ASC tie-break; voided excluded by default; counts always sum to `rows.length`. New auth-gated read-only `GET /api/ops/shipping/dispatch-board` (daysBack [1,60] default 14, limit [1,500] default 100, includeVoided=false default) returns `{counts, rows}`. New auth-gated `POST /api/ops/shipping/mark-dispatched` (body `{orderNumber, source ∈ {amazon|shopify|manual|faire}, action ∈ {mark|clear}}`, default action mark) calls `markDispatched` / `clearDispatched`; first-time mark posts the same `:package: Dispatched` thread reply as the Slack reaction handler (resolved via `permalinkToMessageTs(slackPermalink)`); re-marks idempotent; `postMessage` failure NEVER blocks the dashboard click (best-effort). Page at `src/app/ops/shipping/dispatch/page.tsx` + `DispatchBoardView.client.tsx` renders a counts strip (Open / Dispatched / Total), a refresh button, and a table with per-row pill (amber=open, green=dispatched), "Open in Slack" anchor when permalink exists, and a "Mark dispatched" / "Undo" button per row. Cross-link added from existing `/ops/shipping` (live preflight dashboard) so the two surfaces are discoverable. NEVER fabricates a `dispatchedAt`. NEVER auto-marks. +28 tests (10 projection + 6 GET route + 12 POST route); full suite **1582 green** (was 1554); tsc + lint clean. Commit pending.
- **1.36 — 2026-04-26** — S1.7 Phase 28b: `:white_check_mark:` reaction marks shipment dispatched. Adds the "I dropped this off" button per Ben's request (in lieu of a separate UI surface — Slack reactions are the natural button on the post that already exists). `ShippingArtifactRecord` gains optional `dispatchedAt: string | null` + `dispatchedBy: string | null` fields. New helpers in `shipping-artifacts.ts`: `markDispatched({source, orderNumber, dispatchedBy, dispatchedAt?})` returns `{ok, before, after, record}` so callers can detect first-time vs. re-mark; `clearDispatched({source, orderNumber})` nulls the stamp; `findArtifactBySlackTs({channelId, messageTs})` does a KV scan match against the stored `slackPermalink` to map (channel, ts) → artifact (60-day TTL caps the working set). Reaction handler wired into `/api/ops/slack/events`: on `reaction_added` with reaction `white_check_mark` in `#shipping` (channel registry-resolved), looks up the artifact, marks dispatched, and posts a single thread reply `:package: Dispatched — physically left WA Warehouse by <@user> at <PT timestamp>`. Idempotent on duplicate reaction events (re-mark returns `before !== null` → no thread re-post). `reaction_removed` clears the stamp. Hard rules: only `:white_check_mark:` counts (no synonym matching — keeps state unambiguous on the message); only reactions in `#shipping` count; only reactions on bot-posted label messages count (artifact lookup returns null otherwise — no false-positive marks). Operator step (one-time Slack app config) documented in commit message: api.slack.com/apps/<bot> → Event Subscriptions → add `reaction_added` + `reaction_removed` bot events; OAuth → add `reactions:read` scope; reinstall. +11 tests (5 helper + 6 route-integration); full suite **1554 green** (was 1543); tsc clean. Commit `95b1eb2`.
- **1.35 — 2026-04-26** — S1.7 Phase 28a: branded packing-slip generator wired into auto-ship. Replaces ShipStation's empty page-2 (which has no order #, no items, no qty when the order's items aren't synced into ShipStation — historical default for our channel imports) with a pdf-lib generator that builds a single-page Letter slip from the `ShipStationOrderSummary` (which already carries `items` + `shipTo`). New module `src/lib/ops/packing-slip-pdf.ts` exporting `buildPackingSlipPdfBuffer({orderNumber, source, items[], shipTo, carrierService, trackingNumber, orderDate?, shipDate?})` returning a `Buffer`. Output always shows: PACKING SLIP title, USA Gummies sender block, Order # / Order Date / Ship Date / Channel, Ship To, items table (SKU · Description · Qty), Carrier + Tracking, footer. Refuses empty-items input by design — that's the bug we're fixing, so it can't silently regress. `auto-ship/route.ts` updated: keeps `splitLabelAndPackingSlip(pdfBytes).labelOnly` (page 1) but DROPS `packingSlipOnly` (page 2) and substitutes `customPackingSlipPdf` from the new generator for both Drive write (`persistLabelArtifacts.packingSlipOnlyPdf`) and Slack thread reply. Fail-soft: a generation failure is logged to audit (`artifact.packing-slip.generate-failed`) and the auto-ship continues without a slip rather than blocking the label upload. Synthesizes a single "N × USA Gummies — All American Gummy Bears, 7.5 oz Bag" line if order arrives with no items, so the qty (`bags` from `totalBagsForItems`) is always represented. Sanitizes non-WinAnsi characters (em-dashes, smart quotes, accented names, emoji) for pdf-lib StandardFonts compatibility — never crashes on real customer data. Same `SHIPSTATION_FROM_*` env-var overrides used by `/api/ops/fulfillment/packing-slip` so a single config change moves both surfaces. +7 tests on the generator (non-empty buffer, single-page output, refuses empty items, refuses empty orderNumber, survives non-WinAnsi input, multiple line items, missing optional fields); full suite **1543 green** (was 1535); tsc clean. Commit `753d7c3`.
- **1.34 — 2026-04-26** — S1.7 Phase 27 closeout: Drive write end-to-end verified. After v1.33 shipped the channel routing + v1.0 protocol layout + 7-order backfill, the residual was the GMAIL_OAUTH_REFRESH_TOKEN was missing Drive write scopes. Drove the OAuth re-consent flow via Chrome MCP: navigated to `/api/ops/fulfillment/oauth-consent-url` → opened the returned authorizationUrl → ben@usagummies.com → Continue → Google issued a new refresh_token with scopes `drive` + `drive.readonly` + `gmail.modify` + `gmail.send` + `gmail.readonly` (verified via direct token exchange). Updated `GMAIL_OAUTH_REFRESH_TOKEN` in Vercel production via Chrome MCP → triggered Production redeploy → Ready. **Verification:** (a) live auth.test on the bot still returns ok:true with files:write; (b) live token exchange on the new refresh_token returns ok:true with all 5 Google scopes; (c) live Drive write to the Labels folder (`1qRVAgN7DOK8HqBFnMkr_9dHPWQPKl0FF`) succeeded — file created, then deleted via DELETE /v3/files; (d) auto-ship dry-run on prod returns ok:true with empty queue; (e) live test PDF upload to `#shipping` via files.completeUploadExternal returned ok:true with attached PDF visible in channel (then deleted). **Full pipeline now working:** label-buy → Drive write succeeds → Slack file upload succeeds → v1.0 layout post lands in `#shipping` with PDF attached. Future auto-ship cron runs will deliver real label PDFs end-to-end. Historical 7 orders remain text-only because their PDFs were never persisted (auto-ship pre-Phase 27 only kept PDFs in RAM at label-buy moment) — text-only posts with `Reprint from ShipStation` footers are the canonical record. `#shipping` is now the single source of truth per Ben's v1.0 SHIPPING PROTOCOL pinned 2026-04-10.
- **1.33 — 2026-04-26** — S1.7 Phase 27: shipping artifacts → `#shipping` (auto-ship channel routing fix + v1.0 protocol layout + Drive env unblock + 7-order backfill). **The outage:** since at least Apr 23, every auto-ship label-buy logged `slack.upload-failed: getUploadURL failed: missing_scope` to `#ops-audit` — the bot was missing `files:write`. Drive parent env was also unset, so the fallback path silently skipped. Result: 6 labels bought + ShipStation-marked-shipped, 0 visible in `#shipping`. **Code fixes:** (a) added `shipping` to `ChannelId` + channels.ts + channels.json with `slackChannelId: "C0AS4635HFG"` (the canonical Cxxx required by `files.completeUploadExternal`); (b) auto-ship route default `slackChannel` flipped from `"operations"` (non-existent in workspace) → `"shipping"`; (c) destChannel resolution prefers `slackChannelId > name > id > raw`; (d) new pure formatter module `src/lib/ops/auto-ship-format.ts` (`deriveAutoShipTag`, `formatRecipient`, `formatShipToAddress`, `formatShipFrom`, `formatShipmentComment`, `formatPackingSlipComment`) — locks the v1.0 SHIPPING PROTOCOL layout Ben pinned in `#shipping` 2026-04-10 (9 fixed lines: SHIPMENT/To/Address/From/Carrier/Tracking/Cost/Tag/Label); (e) `SlackFileUploadResult` gains `messageTs` (parsed from permalink via new `permalinkToMessageTs` helper) so the auto-ship route can thread the packing slip under the label post; (f) NEVER fabricates — missing fields render `(unknown)` / `(no tracking)` / `(unknown city)`; (g) new `POST /api/ops/shipping/backfill-to-slack` route reads `shipping:auto-shipped` KV, posts text-only or PDF-attached v1.0 layout per missing-from-Slack order, idempotent (skips orders whose artifact already has `slackPermalink`). **Operator fixes (driven via Chrome MCP):** added `files:write` to USA Gummies Ops 3.0 bot OAuth scopes (Slack admin) → reinstalled to workspace → confirmed scope on existing token via `auth.test`; added `GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID = 1qRVAgN7DOK8HqBFnMkr_9dHPWQPKl0FF` to Vercel production env → redeploy ready in 2m 56s; added bot to `#shipping` via `conversations.join` (resolved `not_in_channel` error on first live auto-ship attempt). **Verification:** `files.getUploadURLExternal` now returns `ok: true`; live auto-ship for new order `112-5249905-9718616` bought a $6.74 USPS First Class label; backfill route posted all 7 orders (Apr 23 → Apr 26: Shopify 1016 + 6 Amazon FBM) into `#shipping` in v1.0 protocol layout with `[BACKFILL]` prefix and "Reprint from ShipStation" footer. **Residual:** Drive write still fails with `insufficient authentication scopes` because the GMAIL_OAUTH refresh token was issued without Drive write — needs separate OAuth re-consent (`drive.readonly` + `drive.file` scopes). Auto-ship pipeline is fail-soft on this; Slack remains the single source of truth per protocol. +37 tests in this round (26 v1.0 protocol formatter + 8 permalink parser + 8 backfill route + 3 routing); operator runbook at `ops/runbooks/SHIPPING-ARTIFACTS-RECOVERY.md`. Full suite **1535 green** (was 1490); tsc clean.
- **1.32 — 2026-04-26** — S1.6 Phase 26: audit feed click-through to Slack threads. `GET /api/ops/docs/receipt-review-packets/[packetId]` extended to also return `permalink: string | null` (always present in the response shape). Lazy-resolved via Phase 12's `getPermalink` (read-only `chat.getPermalink` Slack API call). New local `resolveApprovalPermalink` helper mirrors the promote-review pattern — null when no approval matched, null when `slackThread.ts` empty (degraded mode), null when `chat.getPermalink` rejects. `getPermalink` is NEVER called when no approval matches OR when `slackThread.ts` is missing (saves wasted round trips). Client view's audit feed sub-card gains an "Open thread →" button per row (skipped on closer-error-no-id rows); click handler fetches permalink lazily, opens in new tab on success, flips label to "Unavailable" for 2s on failure. NEVER opens a fabricated URL. New `fetchPacketPermalink` client helper defensive on every error path. `chat.getPermalink` is a read-only API and explicitly allowed; static-source assertion still locks chat.postMessage / chat.update / WebClient / openApproval / buildApprovalRequest. +5 tests on the per-packet route (test count 8 → 13). Full suite **1490 green** (was 1485); tsc clean.
- **1.31 — 2026-04-26** — S1.6 Phase 25: recent activity audit feed sub-card on the dashboard. New auth-gated read-only `GET /api/ops/docs/receipt-review-packets/audit-feed` reads `auditStore().byAction("receipt-review-promote.closer", N)` (newest-first per adapter contract) and projects through `projectAuditEntryToFeedRow` (server-safe pure helper in `data.ts`) to a typed `AuditFeedRow[]`. `limit` clamped `[1, 100]` (default 20). Defensive projection: ok rows require `after.packetId` (or fallback `entityId`) AND `after.newStatus` ∈ `{rene-approved, rejected}`; error rows require `error.message`; any other shape → null and the route SKIPS (no fabrication). `packetIdShort` is `…<last 12 chars>` when long, full id when short. New constant `RECEIPT_REVIEW_CLOSER_ACTION` exported as a typo guard. Client view gains a "Recent activity" sub-card between the counts strip and the table; renders up to 10 rows with status icon (✅/❌/⚠️), packetIdShort, verb, optional error message, and relative time computed against the Phase 24 1s clock tick. Fetched on mount + on every `refreshKey` tick. Failure surfaces an inline banner; rest of dashboard stays live. Static-source contract locks no qbo-client/qbo-auth/hubspot/shopify-*/slack-(send|client)/createQBO*-write/chat.postMessage/WebClient/openApproval/buildApprovalRequest/`approvalStore().put`/`recordDecision` imports or call sites; only GET exported. +28 tests (18 helper + 10 route). Full suite **1485 green** (was 1457); tsc clean.
- **1.30 — 2026-04-25** — S1.6 Phase 24: cache freshness indicator on the dashboard. New `getCachedApprovalLookupWithMeta(): Promise<{ map, cachedAt }>` variant in `src/lib/ops/receipt-review-approval-lookup.ts` exposes the cached value's `cachedAt` Unix-ms timestamp (or `null` on fresh build / KV.get throw / stale / garbage / future-dated). Plain `getCachedApprovalLookup()` becomes a thin wrapper preserving backward-compat for the CSV export route + Phase 20/22 callers. List route response gains `approvalsLookupCachedAt: number | null` (always present; never fabricated as 0/-1/now). New `formatLookupFreshness(cachedAt, now)` pure helper in `data.ts` (server-safe, no React imports) projects to "as of just now" / "as of <N>s ago" / "as of <N>m ago" / "fresh" — defensive on null / NaN / Infinity / future-dated → all collapse to "fresh". Client view renders the indicator on the right edge of the counts strip with a 1s clock tick keeping the label advancing live without refetching; tooltip explains the source. Replaces earmarked Phase 24 (`qbo.bill.create`) — that QBO-write entry is **PARKED** pending Rene's chart-of-accounts mapping (Slack draft queued but not yet posted; resume context in LIVE-RUNWAY "Parked Items" + Notion §7). +27 tests (9 WithMeta + 4 route surfacing + 14 formatter). Full suite **1457 green** (was 1430); tsc clean.
- **1.29 — 2026-04-25** — S1.6 Phase 23: ID-substring search on the review-packets dashboard. `ReviewPacketsFilterSpec` gains optional `idContains?: string` — case-insensitive substring match against `row.packetId`, `row.receiptId`, AND `row.approvalId ?? ""`. AND semantics with status/vendor/date/approvalStatus filters. Empty / whitespace collapses to "no filter" (defensive). `parseReviewPacketsFilterSpec` reads canonical `id` query param; `reviewPacketsFilterSpecToQuery` round-trips with trim. `filterPacketsBySpec` (server) inherits the new dimension via the existing `applyReviewPacketsFilters` projection — bit-identical client/server semantics locked by parity test. List route + CSV export route extend their `filterApplied` check to include `spec.idContains !== undefined`. Client view gains an "ID search" `<input>` in the filter strip wired into the memoized `filterSpec` and cleared by the existing "Clear filters" button. Approval-id match requires the approval map plumbed through `buildReviewPacketsView` (otherwise `row.approvalId` is null and only packetId/receiptId can match — defensive lock). Replaces earmarked Phase 23 (qbo.bill.create); QBO-write entry deferred until Rene's chart-of-accounts mapping unblocks. +26 tests (18 in data.test.ts, 6 in list-route test, 2 server-lockstep). data.test.ts count 112 → 130. Full suite **1430 green** (was 1404); tsc clean.
- **1.28 — 2026-04-25** — S1.6 Phase 22: promote-review cache-invalidation hook. `POST /api/ops/docs/receipt/promote-review` (the Re-promote button's backing route) fires `invalidateApprovalLookupCache()` AFTER `openApproval()` succeeds and BEFORE the response is built. NEVER fires on the idempotent existing-approval branch (cache already reflects state), on ineligible packets / no-slug paths (no approval opened), on 401/400/404 surfaces, or on the openApproval-throw catch path (route returns `opened: false` so stale-by-30s aligns with operator view). Best-effort: `kv.del` failures swallowed inside the Phase 19 helper; cache invalidation NEVER propagates back through the route's success path. Mirrors Phase 20's closer hook on a different transition entry point — with Phase 20 + Phase 22, both active receipt-review state-transition paths bust the cache; the Phase 19 30s TTL becomes a safety floor for any future bypass paths. Audit confirms `standDown()` and `checkExpiry()` are pure transformers with NO production callers today; documented inline that any future caller persisting these for receipt-review-packet targetEntity MUST also invalidate. KV mock extended with `del` (+ throw-knob mirroring the Phase 20 closer test setup); +8 tests on promote-review (eligible → del; observable invalidation removes a primed value; idempotent path does NOT call del again; ineligible / 401 / 400 / 404 NEVER call del; KV.del throw swallowed and route still returns 200 with `opened: true`). Promote-review test count 18 → 26. Static-source contract preserved (no new forbidden imports). Full suite **1404 green** (was 1396); tsc clean.
- **1.27 — 2026-04-25** — S1.6 Phase 21: CSV cursor pagination on the export route. `GET /api/ops/docs/receipt-review-packets/export.csv` accepts `?cursor=...` and paginates the FILTERED set via Phase 17's `paginateReviewPackets` helper. Response headers gain `X-Matched-Total: <full-filtered-size>` (always set), `X-Next-Cursor: <opaque>` (present iff more pages remain — NEVER fabricated empty / `"null"` / `"0"` on final page), `Link: <next-url>; rel="next"` (RFC 5988 navigation hint; URL preserves all current filter params + swaps in cursor). Body is CSV of `paginated.page`; same Phase 18 row schema, same fixed header order, same RFC-4180 escaping, same CRLF terminator, same stable filename `usa-gummies-review-packets-YYYY-MM-DD.csv`. Backward-compat: dashboard's Export CSV button (no cursor) returns the same body shape as Phase 18 when the queue fits in a single page (now flagged via the absence of `X-Next-Cursor`). Filters apply BEFORE pagination so cursor traversal of an active filter never emits half-empty pages. Malformed cursor falls back to first page (defensive — `decodeReviewPacketCursor` already returns `null`). Static-source assertion preserved: no qbo-client/qbo-auth/hubspot/shopify-*/slack-(send|client)/createQBO*-write/chat.postMessage/WebClient/openApproval(/buildApprovalRequest( imports; only GET exported. +9 tests; CSV export route test count 12 → 21. Full suite **1396 green** (was 1387); tsc clean.
- **1.26 — 2026-04-25** — S1.6 Phase 20: closer cache-invalidation hook. The Phase 10 receipt-review closer (`src/lib/ops/receipt-review-closer.ts`) fires `invalidateApprovalLookupCache()` AFTER the success audit lands and BEFORE the closer returns its success result. NEVER fires on gating returns (non-receipt-review approval, pending status, missing/wrong-type targetEntity) or on the error path (packet not found in KV, malformed `targetEntity.id`) — no transition occurred → cache is still correct. Best-effort: `kv.del` failures are swallowed inside the Phase 19 helper, so cache invalidation NEVER propagates back through the closer's success path; the packet's status flip is the source of truth, the cache is downstream observability. Closer's `ReceiptReviewCloserResult` shape, `threadMessage` text, audit envelope, and gating branches are byte-identical to Phase 10. Closes the up-to-30s window between "closer landed" and "operator sees the transition on the dashboard": now operator decisions in Slack are reflected sub-second after the closer fires, instead of waiting for the Phase 19 TTL to expire. Closer test KV mock extended with `del` (with throw-knob); +8 tests on the closer (approved → del; rejected → del; observable invalidation removes a primed cache entry; gating returns NEVER call del; error paths NEVER call del; KV.del throw is swallowed and the closer's success path lands the packet status flip). Closer test count 16 → 24. Static-source contract preserved (no new forbidden imports). Full suite **1387 green** (was 1379); tsc clean.
- **1.25 — 2026-04-25** — S1.6 Phase 19 (Option B): canonical KV-cached approval lookup + dedup. New module `src/lib/ops/receipt-review-approval-lookup.ts` exposes `buildApprovalLookupFresh()` (cache-bypassing canonical builder, fail-soft on both store reads, pending wins on conflict with terminal-state listByAgent), `getCachedApprovalLookup()` (KV-cached production entry point, 30s TTL via `kv.set(..., {ex: 30})`, defensive fallthroughs on KV.get throw / future-dated `cachedAt` / garbage shape / per-entry malformed shape / stale TTL, KV.set throw swallowed), `invalidateApprovalLookupCache()` (best-effort `kv.del`), and `__INTERNAL = { CACHE_KEY, CACHE_TTL_SECONDS }` for lockstep tests. Cache key versioned (`approval-lookup:receipt-review:v1`) so future shape changes can roll cleanly. Cached shape is `{ cachedAt: number, entries: Record<packetId, {id, status}> }` — JSON-serializable; `serializeMap` / `deserializeMap` round-trip the `Map<>()`. Both consumer routes — list (`src/app/api/ops/docs/receipt-review-packets/route.ts`) and CSV export (`src/app/api/ops/docs/receipt-review-packets/export.csv/route.ts`) — drop their inlined duplicate `buildApprovalLookup` helpers and call `getCachedApprovalLookup()` instead. The Phase 15 bounded passive poll (every 60s on every active client) now respects the cache instead of hammering `approvalStore.listPending()` + `listByAgent()` per tick. Static-source assertion on the new module locks no qbo-client/qbo-auth/hubspot/shopify-*/slack-(send|client)/createQBO*-write/chat.postMessage/WebClient/openApproval(/buildApprovalRequest( imports or call sites; canonical surface (`buildApprovalLookupFresh`, `getCachedApprovalLookup`, `invalidateApprovalLookupCache`) is the only export. Both routes' existing static-source assertions continue to hold. +20 tests; full suite **1379 green** (was 1359).
- **1.24 — 2026-04-25** — S1.6 Phase 18 (Option A): CSV export of the filtered review-packets queue. Three new pure helpers in `data.ts`: `escapeCsvCell` (RFC-4180 cell escaping), `renderReviewPacketsCsv(rows)` (header-locked CSV with deterministic column order, null/NaN cells empty, OCR `(ocr)` suffix preserved, eligibilityMissing pipe-joined, CRLF terminator), `reviewPacketsCsvFilename(now)` (stable `usa-gummies-review-packets-YYYY-MM-DD.csv`). New auth-gated `GET /api/ops/docs/receipt-review-packets/export.csv` route reuses the canonical filter parser + `filterPacketsBySpec` + `buildReviewPacketsView` so the CSV mirrors what the operator sees on the dashboard; default limit 500 (full queue); `Content-Type: text/csv`, `Content-Disposition: attachment`, `Cache-Control: no-store`. KV throw → 500 `text/plain` with `csv_export_failed:` reason — never empty CSV silently. Client view gains "Export CSV" anchor next to Refresh; href rebuilds via `reviewPacketsFilterSpecToQuery` so the download matches the on-screen filter. Vendor null → empty cell (NEVER `"—"` em-dash from the dashboard formatter); eligibilityMissing joins with `|` not `,` to survive column boundary; OCR-suggested vendor keeps its `(ocr)` suffix verbatim. Static-source assertion locks no qbo-client/qbo-auth/hubspot/shopify-*/slack-(send|client)/createQBO*-write/chat.postMessage/WebClient/openApproval(/buildApprovalRequest( imports; only GET exported. +33 tests; full suite 1359 green.
- **1.0 — 2026-04-24** — First publication. Synthesizes 2 division-audit agent reports + 5 P0 deliverables + email-intelligence build. Replaces ad-hoc workflow descriptions across other contract docs.
