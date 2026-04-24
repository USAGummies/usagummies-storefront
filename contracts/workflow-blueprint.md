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

### S1.1 Email-intelligence triage (P0 — NEW 2026-04-24)
- **Trigger:** Cron at 8am / 12pm / 3pm / 6pm / 9pm PT
- **Source:** Gmail INBOX since cursor
- **Enrichment:** HubSpot contact lookup, KV processed-set, Gmail SENT thread scan
- **AI role:** Deterministic classifier first (rules-based), LLM fallback only at confidence < 0.7
- **Approver:** Ben for `gmail.send` (Class B, every reply)
- **Slack:** Report → `#ops-daily`. Approval cards → `#ops-approvals`
- **Writeback:** Gmail draft (Class A — `draft.email`), HubSpot timeline on send (deferred to send-on-approve)
- **Audit:** Every classification + draft + approval logged to `#ops-audit` via `record()` / `requestApproval()`
- **Failure:** Gmail unreachable → run logs error, posts partial report
- **Tests:** 20 tests covering classifier, draft, cursor, report
- **Monday MVP:** 🟢 — drafts + approval cards live. Send-on-approve hook is the next layer
- **Later:** Add LLM fallback for ambiguous categories; auto-send for graduated low-risk patterns

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
- **Slack:** `#operations` (label PDF + summary on success); `#ops-approvals` (refusals)
- **Writeback:** ShipStation order shipped + KV dedup + audit
- **Audit:** Every ship attempt logged
- **Tests:** Missing on the orchestrator (downstream primitives covered)
- **Monday MVP:** 🟢

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
- **Status:** Pending OCR owner decision (R.16)
- **Monday MVP:** 🔴 — manual; not blocking core ops

### Fin4.4 QBO write paths (40+ routes)
- **Trigger:** Various — invoice, bill, estimate, JE, transfer, deposit
- **Approver:** Class varies — DRAFT-only for invoices (B), JE is Class D (prohibited)
- **Tests:** Missing on most QBO routes
- **Monday MVP:** 🟡 — write paths work; tests sparse

### Fin4.5 Stamps.com refund escalation
- **Status:** Manual today (Ben pastes drafted text)
- **Slack:** Daily ping in `#operations` listing stale voids (FIXED today)
- **Monday MVP:** 🟢 (alert) / 🟡 (auto-escalation email — next build)

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
- **Status:** ❌ Stub — slug `vendor.master.create` exists, no route
- **Monday MVP:** 🔴 — Rene manual; **next build item**

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
- **Status:** ❌ Missing — does not exist yet
- **Monday MVP:** 🔴 — **Phase 2 build** (replaces Slack as intake per Ben's 2026-04-24 spec)

---

## Monday-readiness summary

| Status | Count | Workflows |
|---|---|---|
| 🟢 Green | 24 | Email-intel triage (NEW), HubSpot dispatch, Auto-ship, Sample dispatch, Wallet check, Inventory snapshot/forecast/burn-rate, Vendor threads, Outreach validate, Marketing content, Research Librarian, Compliance (fallback), Control plane, Slack approvals, Drift audit, Hard-rules pin, Customer chat, Finance Exception, Freight-comp manager, Stamps.com daily ping, Wholesale page, Gmail send/draft primitives, AP packet send (JJ-only), Reply composer (untested but live) |
| 🟡 Yellow | 6 | Reply composer + Pipeline enrich (no tests), Inbox triage (one-shot), AP packet send (Drive scope), QBO write paths (sparse tests), Approved Claims (KV-only), NCS upload (ephemeral FS) |
| 🔴 Red | 11 | Faire Direct invites, Vendor master creation, Reorder triggers, Drew East-Coast routing, Klaviyo / social, R-1..R-7 specialists, Trade-show pod, USPTO/FDA tracking, Vendor onboarding portal, Receipts OCR, Compliance Calendar (Notion gap) |

---

## Top 5 P0 build items remaining for Monday

1. **OAuth re-consent landing** — unblocks Drive scope for AP-packet attachments + Gmail compose for drafts. Action: Ben clicks, pastes new token to Vercel.
2. **Send-on-approve hook for email-intel** — when an approval card's targetEntity.type is `email-reply`, the Slack approvals handler should dispatch a Gmail send + HubSpot logEmail. ~2hr.
3. **Vendor master creation route** — `POST /api/ops/vendors/onboard` with QBO vendor + Notion dossier + Drive folder. ~4hr.
4. **NCS upload writeback** — swap local FS for Vercel Blob or Drive so customer-uploaded forms persist past redeploys. ~1hr.
5. **AP packet UI dashboard** — show every packet (not just JJ) with sent-status badges + send/record-sent buttons. ~1hr.

---

## Version history

- **1.0 — 2026-04-24** — First publication. Synthesizes 2 division-audit agent reports + 5 P0 deliverables + email-intelligence build. Replaces ad-hoc workflow descriptions across other contract docs.
