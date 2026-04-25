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

### Fin4.7 AP Packet Dashboard (`/ops/ap-packets`)
- **Trigger:** Operator opens the page (Rene + Ben). Read-only.
- **Source:**
  - `/api/ops/ap-packets` (no slug) — roster of every packet with `attachmentSummary`, `nextActionsCount`, `firstNextAction`, and a per-slug `lastSent` join from KV `ap-packets:sent:<slug>`.
  - `/api/ops/ap-packets?account=jungle-jims` — full detail for the JJ panel (existing flow).
- **AI role:** None — pure derivation through `src/lib/ops/ap-packet-dashboard.ts`. `deriveDashboardRow()` picks one recommended next action per packet from the priority list: pricing review → missing docs → attachments needing review → recently sent → stale send → ready-to-send → first nextActions entry. Never invents copy.
- **Approver:** N/A for the page. **Send/resend stays gated through `POST /api/ops/fulfillment/ap-packet/request-approval` (Class B `gmail.send`, Ben approves in `#ops-approvals`).** The dashboard never sends email directly.
- **Slack:** None directly. The send route already posts the approval card to `#ops-approvals` and the audit to `#ops-audit`.
- **Writeback:** None. Zero side effects — this surface only reads the existing GET endpoints.
- **Audit:** None — read-only views are not auditable events.
- **Failure mode:** Roster fetch fails → roster section shows the error string + "0 rows", JJ detail panel still loads independently. KV miss for `ap-packets:sent:<slug>` → "Last sent" shows "—", dashboard treats as `not_yet_sent`.
- **Tests:** 18 unit tests in `ap-packet-dashboard.test.ts` lock the contract: missing/review counts, plural-aware copy, recent vs stale send classification (30-day boundary), pricing review precedence, action-required fallback to `firstNextAction`, no-fabrication when nextActions is empty, summary aggregation, `hasPacketTemplateRegistry()` returns false today.
- **Monday MVP:** 🟢 — page is ready for Rene + Ben. Surfaces every packet with status, attachments, last sent (if any), and recommended next action. New packets land in the roster automatically when added to `listApPackets()`.
- **Later:** (1) Build a packet template registry (currently `hasPacketTemplateRegistry()` returns false; the "Create from template" link is explicitly disabled with a "not wired yet" pill). (2) Wire the Slack approve button at `/api/slack/approvals` to dispatch the `ap-packet/send` execution automatically when the approval flips, instead of the caller-driven `?approvalToken=` path.

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
