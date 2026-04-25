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

### S1.4 Faire Direct invites
- **Status:** ❌ Stub
- **Tests:** Missing
- **Monday MVP:** 🔴 — slug exists in taxonomy, no route. Manual via Faire UI

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

---

## Monday-readiness summary

| Status | Count | Workflows |
|---|---|---|
| 🟢 Green | 28 | Email-intel triage (CLOSED LOOP), Sample-request → shipping bridge, Vendor master creation (QBO path), HubSpot dispatch, Auto-ship, Sample dispatch, Shipping label artifacts, Durable NCS/vendor-doc upload, Wallet check, Inventory snapshot/forecast/burn-rate, Vendor threads, Outreach validate, Marketing content, Research Librarian, Compliance (fallback), Control plane, Slack approvals, Drift audit, Hard-rules pin, Customer chat, Finance Exception, Freight-comp manager, Stamps.com daily ping, Wholesale page, Gmail send/draft primitives, AP packet send (JJ-only), Reply composer (untested but live) |
| 🟡 Yellow | 7 | Reply composer + Pipeline enrich (no tests), Inbox triage (one-shot), AP packet send (Drive scope), QBO write paths (sparse tests), Approved Claims (KV-only), Vendor onboarding Notion/Drive dossier parent IDs/scopes, Receipts intake queue (review-only; no OCR/QBO write) |
| 🔴 Red | 8 | Faire Direct invites, Reorder triggers, Drew East-Coast routing confirmation, Klaviyo / social, R-1..R-7 specialists, Trade-show pod, USPTO/FDA tracking, external vendor portal |

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
- **1.0 — 2026-04-24** — First publication. Synthesizes 2 division-audit agent reports + 5 P0 deliverables + email-intelligence build. Replaces ad-hoc workflow descriptions across other contract docs.
