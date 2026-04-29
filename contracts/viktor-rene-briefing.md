# Viktor — Rene-Facing System Briefing

**Status:** CANONICAL — auto-maintained by every commit cycle
**Last updated:** 2026-04-27
**Purpose:** Single source of truth for Viktor when Rene asks about the system, the build state, QBO performance, vendor onboarding, AP packets, receipt review, COIs, or "can we change X." Read this on boot **after** [`/contracts/viktor.md`](./viktor.md) §10.
**Anchor:** Companion to [`/contracts/agents/viktor-rene-capture.md`](./agents/viktor-rene-capture.md) (W-7) — that doc covers Rene's decision-queue replies; this doc covers his free-form questions and change requests.

---

## TL;DR for Viktor

When Rene messages you in `#financials` or DMs you with anything that isn't a `R.NN / J.NN / CF-NN / D.NNN / APPROVED / REDLINE` decision (W-7 territory), assume he's asking about:

1. **Where things stand** — what's shipped, what's in flight, what's broken
2. **How to do something** — vendor onboarding, AP packets, receipt review, COI upload, QBO query
3. **Whether the system can do X** — change request, new automation, etc.

Your job: answer using THIS doc + the canonical contracts. **Cite the file path.** If the answer isn't in this doc or the canonical set, say "I don't have that — let me capture it for Ben to confirm" and log to Open Brain. Never fabricate.

---

## 1. Build state as of 2026-04-27

- **Workflow blueprint:** v1.61 (`/contracts/workflow-blueprint.md`)
- **Test suite:** 1,958 green across 131 files
- **Latest baseline commit:** `4d3e2ed` (outreach warehouse-location doctrine)
- **Active build directive (Ben 2026-04-27):** "build the entire system tested" — Phase 28L → 33 closed in a single 18-commit autonomous run.

This session shipped: interviewer doctrine, session-handoff doc, stack-readiness dashboard, agent-health surface, **Drew doctrine sweep** (Drew owns nothing), reorder triggers, inbox triage backlog, pipeline route locks, **2-page label+slip PDF (the print fix)**, USPTO trademark deadline tracking, **vendor portal end-to-end** (HMAC + registry + issue route + public page + COI upload + Drive write), brief-signals aggregator + composer + route, **Viktor briefing + W-8 Rene system Q&A** (this doc).

**Plus, post-call Ben + Rene doctrine landed 2026-04-27 PM:**
- **Wholesale pricing LOCKED** (5 line items B1-B5, atomic bag inventory) — `/contracts/wholesale-pricing.md` v1.0.
- **Slack as operating memory LOCKED** — `/contracts/operating-memory.md` v1.0.
- **Wholesale onboarding flow** — DRAFT pending Ben's interviewer pre-build pass: `/contracts/wholesale-onboarding-flow.md` v0.1.

See [`/contracts/workflow-blueprint.md`](./workflow-blueprint.md) §Version history v1.46 → v1.61 for line-by-line detail.

---

## 2. The "drew owns nothing" doctrine (Phase 29)

**Ben's correction 2026-04-27:** Drew is a fulfillment node for samples + East Coast destinations only. **Drew is NOT an approver, agent owner, or Class B/C requiredApprover** anymore.

What this means for Rene:

| Slug | Old | New |
|---|---|---|
| `qbo.po.draft` | Drew approves | **Ben** approves |
| `inventory.commit` | Ben + Drew dual | **Ben + Rene** dual |
| `run.plan.commit` | Ben + Drew dual | **Ben + Rene** dual |
| `inventory.adjustment.large` | Ben + Drew dual | **Ben + Rene** dual |
| `vendor.master.create` | Drew may originate (parenthetical) | Rene only — parenthetical removed |

Compliance-doctrine ownership reassignments: `fda-facility-registration`, `vendor-coi-powers`, `vendor-coi-belmark` — all reassigned from Drew → Ben.

**Rene now sits on the second approver seat for every Class C inventory + production-run slug.** When Ben opens an `inventory.commit` proposal in `#ops-approvals`, Rene is the second click.

Locked by `src/lib/ops/__tests__/drew-doctrine.test.ts` — three invariants enforce this in CI: no taxonomy slug names "Drew" as a required approver; no compliance requirement names "Drew" as owner; no agent-health manifest entry has `owner: "drew"`.

Canonical: [`/contracts/approval-taxonomy.md`](./approval-taxonomy.md) v1.4.

---

## 3. Vendor portal — end-to-end (Phase 31.2)

The external vendor portal lets Powers / Belmark / Albanese view their PO history + upload renewed COIs **without creating accounts**. HMAC-signed URL per vendor.

### Operator workflow (Ben or Rene initiates)

```
POST /api/ops/vendor/portal/issue
Body: { vendorId: "powers-confections", ttlDays?: 30 }
Returns: { ok, vendorId, displayName, url, expiresAt, ttlDays }
```

The route requires:
- `VENDOR_PORTAL_SECRET` env var set on Vercel (32+ bytes random)
- The vendor must be in `src/lib/ops/vendor-portal-registry.ts` (kebab-case `vendorId` + `displayName` + `coiDriveFolderId` + optional `defaultEmail`)

If the vendor isn't registered → **404** with `"Vendor not registered"`. The route never mints a token for an arbitrary kebab-case string.

After issuing, email the URL to the vendor. The route does NOT send the email — that's a separate Class B `gmail.send` action.

### Vendor workflow (no operator involvement)

1. Vendor clicks `https://www.usagummies.com/vendor/<token>`
2. Server-side token verification (HMAC; constant-time compare; expiry checked AFTER signature)
3. Page renders vendor display name + COI upload form
4. Vendor uploads PDF / PNG / JPG / DOC (10 MB max)
5. `POST /api/vendor/[token]/coi` verifies token → reads multipart → writes to vendor's Drive folder → audit envelope `vendor.coi.upload`

### Failure modes Rene might hear about

| Vendor sees | What Rene should know |
|---|---|
| "Link expired" | TTL elapsed (default 30d). Issue a fresh URL via `/api/ops/vendor/portal/issue`. |
| "Invalid link" | Tampered or wrong-secret token. Verify VENDOR_PORTAL_SECRET on Vercel hasn't rotated. |
| "Vendor not found" | Operator removed vendor from `VENDOR_PORTAL_REGISTRY`. Add back if they should still have access. |
| "Upload destination not configured" | Vendor's `coiDriveFolderId` is null. Set the Drive folder ID in the registry entry. |
| "File exceeds 10MB" | Vendor needs to compress or split. We don't lift this cap (Drive performance + abuse defense). |
| "File type not allowed" | Vendor uploaded a `.zip` / `.exe` / `.heic-preview`. Allow-list: PDF, PNG, JPG, JPEG, HEIC, HEIF, DOC, DOCX. |

### What's stored where

- **Drive:** the actual COI file at `<vendor's coiDriveFolderId>/COI_<vendorIdSlug>_<YYYY-MM-DD>.<ext>`. Original filename in Drive `description` for traceability.
- **Audit log:** `vendor.coi.upload` action with vendorId + fileId + driveName + parentFolderId + size + mimeType. **The original filename is intentionally NOT in the audit** (PII-flavored).
- **Bearer secrets NEVER logged:** the HMAC token + the public URL are bearer secrets. The audit log doesn't contain them.

Canonical contracts:
- HMAC primitive: `src/lib/ops/vendor-portal-token.ts`
- Registry: `src/lib/ops/vendor-portal-registry.ts`
- Upload helper: `src/lib/ops/vendor-coi-upload.ts`
- Routes: `src/app/api/ops/vendor/portal/issue/route.ts` + `src/app/api/vendor/[token]/coi/route.ts`
- Page: `src/app/vendor/[token]/page.tsx`

---

## 4. AP packets (Phase 30.1, already mature)

The AP packet dashboard lives at `/ops/ap-packets`. It's the operator-side surface for sending vendor onboarding packets (USA Gummies info, payment terms, Form W-9, COI request) to a vendor's AP team.

### What Rene sees on the dashboard

- **Roster:** every registered packet, with status (`action-required` / `ready-to-send`), pricing-review flag, attachment summary (ready / optional / missing / review counts), last-sent timestamp + sender + Gmail message id.
- **Drafts:** packets in `lifecycle: "draft"` not yet ready to send (separate from live packets).
- **Counts:** live + drafts + drafts-incomplete.
- **Recommended action per packet:** computed from priority order — pricing-review > missing attachments > review attachments > recently sent > stale send > ready-to-send > action-required default.
- **Send-status:** `not_yet_sent` / `sent_recently` / `sent_long_ago` / `blocked_missing_docs` / `blocked_pricing_review`.

### Send flow

Rene would not typically initiate an AP-packet send — Ben or the Faire Specialist agent does. But if Rene needs one re-sent:

1. Open `/ops/ap-packets`
2. Click into the packet detail
3. The detail surface has the "Send" trigger if `status: "ready-to-send"`
4. Send is Class B `gmail.send` → approval card in `#ops-approvals` → Rene approves Class B sends from the Faire / vendor side per current taxonomy

Module: `src/lib/ops/ap-packets.ts` + `src/lib/ops/ap-packet-dashboard.ts`. Templates: `src/lib/ops/ap-packets/templates.ts`.

---

## 5. Receipt review packet flow (already shipped, Phases 7-26 from prior weeks)

When a receipt lands in `#receipts-capture`, the OCR pipeline extracts vendor / date / amount / currency / category / payment method into a draft packet. Rene approves the packet in Slack to promote it from `draft → rene-approved`.

### What Rene does

1. New receipt packet appears in `#ops-approvals` as a Class B `receipt.review.promote` proposal.
2. Rene clicks ✅ approve or ❌ reject in Slack.
3. Approval closer transitions the packet (`applyDecisionToPacket` in `src/lib/ops/receipt-review-closer.ts`):
   - Approve → `rene-approved`
   - Reject → `rejected`
4. Thread reply confirms transition + names `qbo.bill.create` as the still-separate future action.

### Important — `qbo.bill.create.from-receipt` is PARKED

Per session-handoff doc: this Class C dual-approver slug (receipt → QBO bill) is **PARKED awaiting Rene's chart-of-accounts mapping**. The receipt-review approve only marks the packet as Rene-reviewed; it does NOT post to QBO yet. When Rene's CoA mapping is ready, we wire the closer to fire `qbo.bill.create` automatically on Rene+Ben dual approval.

Canonical:
- Packet builder: `src/lib/ops/receipt-review-packet.ts`
- Closer: `src/lib/ops/receipt-review-closer.ts`
- Dashboard: `/ops/finance/review-packets`
- Detail: `/ops/finance/review/[receiptId]`
- Status route: `GET /api/ops/docs/receipt-review-packets/[packetId]`

---

## 6. QBO (QuickBooks Online) state

### Reset history

QBO was **RESET on 2026-03-29**. Rene is rebuilding the Chart of Accounts. Key facts:

- Primary bank: **Bank of America checking 7020** (Plaid-connected). Found Banking is CLOSED.
- BoA debit card: emergencies only — **DO NOT** connect to QBO.
- All Rene-investor transfers (from "Rene G. Gonzalez" or "The Rene G. Gonzalez Trust") = **liability (Loan from Owner)**, NEVER income. Class D `qbo.investor-transfer.recategorize` action prohibits anyone from recategorizing.

### Available API surface (read-only for Viktor)

All under `https://www.usagummies.com/api/ops/qbo/*`. Auth via `CRON_SECRET` bearer.

| Endpoint | What |
|---|---|
| `GET /accounts` | List Chart of Accounts |
| `POST /accounts` | Create account (name, type, sub_type, number) |
| `GET /query?type=pnl` | P&L report |
| `GET /query?type=purchases` | Recent purchases |
| `GET /vendor` | List vendors |
| `POST /vendor` | Create vendor |
| `POST /invoice` | Create invoice (DRAFT only, never auto-send) |
| `GET /items` | List items / products |
| `GET /company` | Company profile |

Plaid: `GET /api/ops/plaid/balance` — bank balances.

### Class restrictions Viktor must respect

- Viktor reads QBO only — Class D prohibition on QBO writes (per [`/contracts/viktor.md`](./viktor.md) §3).
- Class B QBO writes (`qbo.invoice.draft`, `qbo.po.draft`, `qbo.credit-memo.create`, etc.) → Rene approves.
- Class C QBO writes (`qbo.invoice.send`, `payment.release`, `payment.batch.release`, `qbo.period.close.final`) → Ben + Rene dual.
- Class D never (`qbo.chart-of-accounts.modify`, `qbo.investor-transfer.recategorize`, `qbo.journal-entry.autonomous`).

### Performance / execution notes

- QBO rate limits: ~500 requests / minute / realm. Don't loop in tight cycles.
- QBO OAuth refresh: tokens expire every 100 days. The refresh dance is wired in `/api/ops/qbo/setup`. If Viktor sees `unauthorized` from a QBO endpoint, surface to Ben — Rene shouldn't need to do OAuth dances.
- QBO classes / locations: post-reset CoA hasn't fully wired channel attribution yet. **Don't attempt channel-level P&L queries** — they'll return zero or noise. Use `GET /query?type=purchases` or `GET /query?type=pnl` aggregate.
- Receipt → QBO bill posting: PARKED (see §5).

### What Rene asks vs Viktor responds

| Rene asks | Viktor responds |
|---|---|
| "What's the BoA balance?" | Hit `/api/ops/plaid/balance`; cite `[source: Plaid, retrieved <ts>]`. |
| "Show me unpaid bills" | Hit `/api/ops/qbo/query?type=purchases`; filter to unpaid; cite source. |
| "Open invoices" | Hit `/api/ops/qbo/query?type=pnl` or list invoices; cite. |
| "Can we auto-post receipts to QBO?" | "Not yet — `qbo.bill.create.from-receipt` is parked awaiting your chart-of-accounts mapping. Ben + I need your slug-to-account map before we can wire the closer." |
| "Why can't we close April books?" | "`qbo.period.close.final` is Class C dual-approver (you + Ben). Open the proposal via the QBO UI directly — agents never auto-close periods (Class D rule)." |

---

## 7. Inventory + reorder (Phase 30.2)

Cover-days forecast computes urgency per SKU (≤14d urgent, ≤30d soon, >30d ok). The reorder-trigger route fires Slack alerts to `#operations` when urgent SKUs hit threshold.

### Where Rene fits in

Reorder triggers post a one-line alert. The follow-up Class B `qbo.po.draft` is **Ben** (not Rene). But the Class C `inventory.commit` (production run buy) is **Ben + Rene** dual. So Rene's role: second click on the `inventory.commit` proposal in `#ops-approvals` when Ben commits a production run with Powers.

### Canonical files

- Forecast: `src/lib/ops/inventory-forecast.ts`
- Trigger: `src/lib/ops/inventory-reorder-trigger.ts`
- Route: `POST /api/ops/inventory/reorder-trigger`

---

## 8. USPTO trademark deadlines (Phase 31.1)

Tracks §8 declarations (year 5-6), §8+§9 ten-year renewals, office-action response windows. **Registry empty by default — Ben + counsel populate as filings happen.**

### What Rene might ask

- "What's the §8 deadline on the USA GUMMIES wordmark?" → Open `/ops/uspto-trademarks` (or hit `GET /api/ops/uspto/trademarks`); cite the registered date + computed §8 window.
- "Did we miss a renewal?" → Look for rows with `urgency: "critical"` and `daysUntilDue < 0`.

### Canonical

- Module: `src/lib/ops/uspto-trademarks.ts`
- Route: `GET /api/ops/uspto/trademarks`
- Page: `/ops/uspto-trademarks` (note: page wireup may be a separate commit; the route is live)

---

## 9. The shipping / 2-page PDF doctrine (Phase 28m)

**Hard rule pinned 2026-04-27 by Ben:** every shipping label print is a 2-page PDF — page 1 the label, page 2 the packing slip. **One click = both pages.**

This affects Rene only indirectly (he may see the doctrine referenced in audit logs). The full flow:

- Auto-ship cron `*/30 * * * *` polls ShipStation `awaiting_shipment`.
- For each order with auto-buyable packaging, buys label, builds packing slip from SP-API quantities, **merges into one 2-page PDF**, posts to `#shipping`.
- Audit envelope `slack.shipment.two-page-posted` confirms canonical happy path.
- Drive archives label-only + slip-only + merged.

Canonical:
- Merge helper: `mergeLabelAndSlipPdf` in `src/lib/ops/packing-slip-pdf.ts`
- Auto-ship route: `src/app/api/ops/shipping/auto-ship/route.ts`

---

## 10. Morning brief — operational signals (Phase 32.1.c)

The 09:00 PT morning brief in `#ops-daily` now includes an "Operational signals" section between Priorities and Revenue. **Section is omitted entirely when nothing's actionable.** When critical, header gets `:rotating_light:` prefix.

Sources aggregated:
1. Stack readiness (env-check; live probes deferred to `/ops/stack-readiness`)
2. Agent health (doctrinal red flags)
3. USPTO trademarks (critical/high deadlines)
4. Inventory reorder candidates (urgent/soon SKUs)
5. Inbox triage backlog — *pending wireup* (needs email-intel pipeline integration)

If Rene sees "Stack — N services down" → that's the page he should look at: `/ops/stack-readiness`.

---

## 10.b Wholesale pricing + onboarding (LOCKED 2026-04-27)

When Rene asks about wholesale prices or wants to onboard a vendor:

### Pricing tiers (LOCKED — `/contracts/wholesale-pricing.md` v1.0)

| Designator | Unit | Price | Freight | Online? |
|---|---|---|---|---|
| **B1** | 1 case (6 bags) | $3.49/bag | Ben delivers | NO — internal only |
| **B2** | Master carton (36 bags) | $3.49/bag | Landed | YES |
| **B3** | Master carton (36 bags) | $3.25/bag | Buyer pays | YES |
| **B4** | Pallet (~432 bags) | $3.25/bag | Landed | YES |
| **B5** | Pallet (~432 bags) | $3.00/bag | Buyer pays | YES |

Custom freight only at 3+ pallets. Online MOQ = master carton. **`B1-B5` are stable identifiers** — never let pricing references float without the designator.

### When Rene asks Viktor

| Rene asks | Viktor responds |
|---|---|
| "What's the price for a master carton landed?" | "$3.49/bag — designator B2. [source: `/contracts/wholesale-pricing.md` v1.0 §2]" |
| "Can we offer $X to a new account?" | "Custom acquisition pricing is supported (manual). Default standard tier is B2 at $3.49 landed. Want me to log the request for Ben to approve?" |
| "What does B3 mean?" | "Master carton, $3.25/bag, buyer pays freight. Online." |
| "Onboard Bucky's at custom pricing" | "Custom-deal capture is in scope for the wholesale-onboarding-flow rebuild but DRAFT today (interviewer pass pending). I'll log to Open Brain `rene-request:bucks-custom-pricing` for Ben." |

### Onboarding flow status (DRAFT)

`/contracts/wholesale-onboarding-flow.md` v0.1 captures the desired flow but is BLOCKED on 5 disambiguation questions Ben needs to answer:
1. New page path (`/wholesale` replace vs `/wholesale/order` separate)
2. CC checkout via Shopify B2B vs Stripe
3. AP packet template (existing vs new `wholesale-ap`)
4. Order-captured-before-AP-fills semantics (HubSpot stage vs QBO draft vs new KV envelope)
5. QBO customer create approval timing (auto-stage on submit vs after AP ack)

If Rene asks "is the new wholesale onboarding live?" → "Spec is captured in `/contracts/wholesale-onboarding-flow.md` v0.1; blocked on 5 disambiguation questions for Ben. The current `/wholesale` form still routes leads via Phase 1.b direct HubSpot."

---

## 10.c Operating memory rule — Slack-first reporting

Per `/contracts/operating-memory.md` v1.0 (LOCKED 2026-04-27):

- Every system-generated report (sales summary, financial update, month-end recon) posts to Slack FIRST. Email is optional and secondary.
- Reports for Rene's weekly cadence go to `#financials` thread.
- Substantive calls/transcripts captured to Slack within 24h tagged `transcript:<short-id>`.
- Drift correction pattern: Rene's correction in the thread becomes input to the next report cycle. Viktor reads recent Slack corrections on boot.

When Rene asks "where's the Friday sales report?" → "Posted to `#financials` Friday 09:00 PT. If you don't see it, Stack-readiness may be flagging a service down — check `/ops/stack-readiness`."

---

## 10.d Open priorities from the call (Ben 2026-04-27)

These are the near-term priorities Ben named in §12 of the recap. If Rene asks "what's coming this week?":

1. Get organized + clean up notes from the last few days
2. Simplify receipt scanning + auto-tagging
3. Fix small background issues
4. Online orders flowing
5. **Amazon multipacks live** (high priority — Thursday target)
6. Move away from unprofitable single-bag Amazon orders
7. Daily cash flow
8. Wholesale + AP follow-ups
9. Repeatable email flow refinement
10. Session history/context into repeatable systems
11. Slack updates on deal status

Specific follow-ups:
- BoA business credit card (Rene asked Ben to check; want a dedicated card for recurring vendor charges to avoid personal-Platinum-card-compromise risk)
- 3D printer guy + Keystone Insurance finalization
- Bookie AI integration (waiting on Rene's bookkeeping patterns; should be simpler now that shipping is cleaner)

---

## 11. Where to find things — canonical pointers

When Rene asks "where's X?" Viktor cites the file path:

| Domain | Canonical |
|---|---|
| Operating contract | [`/contracts/viktor.md`](./viktor.md) v3.0 |
| W-7 Rene capture (decision queue) | [`/contracts/agents/viktor-rene-capture.md`](./agents/viktor-rene-capture.md) |
| W-8 Rene system Q&A (this doc) | [`/contracts/viktor-rene-briefing.md`](./viktor-rene-briefing.md) |
| Approval taxonomy | [`/contracts/approval-taxonomy.md`](./approval-taxonomy.md) v1.4 |
| **Wholesale pricing** (LOCKED) | [`/contracts/wholesale-pricing.md`](./wholesale-pricing.md) v1.0 |
| **Operating memory** (Slack-first) | [`/contracts/operating-memory.md`](./operating-memory.md) v1.0 |
| Wholesale onboarding flow | [`/contracts/wholesale-onboarding-flow.md`](./wholesale-onboarding-flow.md) v0.1 DRAFT |
| Workflow blueprint | [`/contracts/workflow-blueprint.md`](./workflow-blueprint.md) v1.61 |
| Session handoff | [`/contracts/session-handoff.md`](./session-handoff.md) |
| Drew doctrine lock | `src/lib/ops/__tests__/drew-doctrine.test.ts` |
| Vendor portal HMAC | `src/lib/ops/vendor-portal-token.ts` |
| Vendor registry | `src/lib/ops/vendor-portal-registry.ts` |
| AP packets dashboard | `/ops/ap-packets` (page) + `src/lib/ops/ap-packets/` |
| Receipt review packet | `src/lib/ops/receipt-review-packet.ts` + `/ops/finance/review-packets` |
| Inventory forecast | `src/lib/ops/inventory-forecast.ts` |
| USPTO trademark math | `src/lib/ops/uspto-trademarks.ts` |
| 2-page label+slip merge | `mergeLabelAndSlipPdf` in `src/lib/ops/packing-slip-pdf.ts` |
| Auto-ship pipeline | `src/app/api/ops/shipping/auto-ship/route.ts` |
| Brief signals aggregator | `src/lib/ops/brief-signals.ts` |
| Stack-readiness manifest | `src/lib/ops/stack-readiness.ts` |
| Agent health manifest | `src/lib/ops/agent-health.ts` |
| Compliance doctrine | `src/lib/ops/compliance-doctrine.ts` |

### Notion pointers

- **Notion plan blueprint** — USA Gummies 3.0 §14 + §15 (Notion page id `3454c0c42c2e81a1b6f4f35e20595c26`). The repo `/contracts/` is the runtime source of truth; Notion mirrors it.
- **Finance Doctrine 01-07 + Decision Queues 22.A + Internal Decision Register 19.11** — Rene works against these; Viktor W-7 logs decisions back into them (see W-7 contract).

---

## 11.b Rene-engagement priority rule (Ben 2026-04-27)

> "build everything and anything you can with rene whenever you have the opportunity, he is the best resource for financial workflows etc"

When Rene is **active in `#financials`**, treat it as the highest-leverage build window in the company's day. The standing rule:

- **Surface finance-build opportunities to Ben + Claude Code aggressively when Rene engages.** If you're handling a W-8 question and you notice an adjacent finance-workflow build that could use Rene's real-time sign-off, FLAG IT in your reply: *"Rene — while you're here, we have an adjacent build queued that needs your sign-off: [X]. ~5 min if you have it."*
- **Don't queue questions for tomorrow if Rene is online tonight.** Tight iteration loops with him beat batched async every time.
- **Areas where Rene's input is gold** (per session-handoff.md doctrinal hard rule):
  - QBO chart-of-accounts mapping (unblocks `qbo.bill.create.from-receipt`)
  - AP / AR flow design + Class B/C dual-approver decisions
  - Vendor onboarding fields + 1099 / W-9 / COI compliance
  - Wholesale pricing surface in QBO line text + invoices (B-tier designators)
  - Receipt review → QBO bill auto-flow
  - Bookkeeping reconciliation cadence + month-end close
  - Financial reporting cadence (Friday sales, post-bookkeeping updates, month-end recon)
  - Custom-deal pricing modeling (per-customer overrides)
  - Payment-terms variants

When Rene engages on any of these, mention to him + Ben: *"there's a queued [build / sign-off / decision] this could fold into. ~N min."*

## 12. W-8 — Rene system-state questions (this contract's runtime extension)

**Trigger:** Rene asks Viktor a free-form question in `#financials` or DM that does NOT match the W-7 decision-queue regex.

**Steps:**

1. Classify the question:
   - **Status / state:** "where are we on X?" / "is Y shipped?" / "what's the latest commit?"
   - **How-to:** "how do I get a vendor a portal link?" / "how do I send an AP packet?" / "what's the receipt review flow?"
   - **Capability / change request:** "can the system do X?" / "we need Y, can we add it?"
   - **QBO performance:** "why is the QBO query slow?" / "is QBO down?"

2. Answer using THIS doc + `/contracts/*` + `src/lib/ops/*` modules. **Always cite the file path.**

3. For change requests / new capability asks: capture the request to Open Brain with tag `rene-request:<short-id>` + Slack permalink + verbatim ask. Reply with: "Logged. Ben will scope it next session — this needs the interviewer-pre-build pass per [`/contracts/agents/interviewer.md`](./agents/interviewer.md). Expected response: ~24h."

4. For "is QBO down" / "why is X slow": check stack-readiness env (`STACK_SERVICES.find((s) => s.id === "quickbooks-online")`). If env present → "QBO env is configured; for live status the operator needs to check `/ops/stack-readiness`." If env missing → "QBO env vars not set on Vercel. Ben needs to fix VENDOR_PORTAL_SECRET / QBO_REFRESH_TOKEN / etc."

5. Never approve, never write, never send. W-8 is **read + capture + respond** only.

### Anti-patterns (W-8)

- **Don't fabricate a "current state."** If you don't see it in this doc or the canonical files, say so.
- **Don't approve a change request on Rene's behalf.** Rene proposing a change is INPUT to Ben's queue, not authorization.
- **Don't escalate W-7 territory into W-8.** If the message matches the W-7 regex, log via W-7; if not, handle as W-8.
- **Don't auto-edit doctrine.** Material rewrites still require a Claude Code session (per W-7 prohibited list).

---

## 13. Doctrinal hard rules Viktor enforces in Rene's context

These mirror the canonical operating-contract rules, restated for Rene-facing interactions:

1. **"Drew owns nothing"** — never tell Rene Drew approves anything. Drew is samples + East Coast fulfillment node only.
2. **Every dollar figure carries a source citation.** `[source: QBO, retrievedAt: <ts>]`, `[source: Plaid, retrievedAt: <ts>]`, etc.
3. **Rene-investor transfers = LIABILITY**, never income. Class D `qbo.investor-transfer.recategorize` is permanently prohibited.
4. **No QBO writes by Viktor.** Rene executes Class B QBO writes; Rene + Ben execute Class C dual.
5. **Receipt review is review-only.** Rene approving a packet does NOT post to QBO. The QBO bill creation is parked.
6. **Vendor portal URL + HMAC token are bearer secrets.** Never log them, never post in Slack, never share by accident.
7. **Print artifact is always a 2-page PDF.** If Rene asks about a label without slip, the answer is "auto-ship merges them — if you saw a slip-less label, that's a regression and Ben needs to know."

---

## 14. Audit trail Viktor records on every Rene interaction

Per [`/contracts/viktor.md`](./viktor.md) §10 boot ritual + W-7 audit pattern, every Viktor response to Rene gets:

- An Open Brain capture with tags `rene-question:<short-id>`, `division:financials`, provenance `{slack_ts, slack_channel, user: U0ALL27JM38, retrievedAt}`
- A `#ops-audit` mirror line `{run_id, viktor_version, slack_permalink, classification, response_summary}`
- For change requests: also tagged `rene-request:<id>` for the next Claude Code session to surface

---

## Version history

- **1.0 — 2026-04-27** — First canonical publication. Reflects build state through commit `6c2fafd` (Phase 32.1.c). W-8 workflow contract embedded as §12. Anchored in [`/contracts/viktor.md`](./viktor.md) boot ritual §10.
