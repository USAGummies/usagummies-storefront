# Email Capabilities System — DRAFT PROPOSAL (NOT YET CANONICAL)

**Status:** DRAFT — strategy input only. **NOT approved as canonical runtime design.** Requires simplification before canonicalization. Not a green-light to build code or to register new agents.
**Author:** Claude (drafted from full 2026-04-30 session history; revised v0.4 against `/contracts/agent-architecture-audit.md` + `/contracts/agent-heartbeat.md` + `/contracts/approval-taxonomy.md` v1.6 lockstep)
**Trigger:** Ben's 2026-04-30 PM directive: *"how do you build a real set of email agents and workflows, so we can actually automate email, scanning the inbox, drafting replies, strategy etc etc, draft for me what that addition to the system would be."*
**Pairs with:** [`/contracts/governance.md`](governance.md), [`/contracts/approval-taxonomy.md`](approval-taxonomy.md), [`/contracts/agent-architecture-audit.md`](agent-architecture-audit.md), [`/contracts/agent-heartbeat.md`](agent-heartbeat.md), [`/contracts/operating-memory.md`](operating-memory.md), [`/contracts/financial-mechanisms-blueprint.md`](financial-mechanisms-blueprint.md), [`/CLAUDE.md`](../CLAUDE.md) Execution Rules

---

## 0a. Doctrine alignment (read this first)

This proposal originally framed the build as **"26 new agents."** That framing is wrong against canonical doctrine and is **explicitly retired in v0.4**.

The correct framing is **5 subsystems composed of capabilities** that map onto existing contract-backed runtimes (Viktor, Booke, Finance Exception Agent, Ops Agent, Sample/Order Dispatch S-08, Compliance Specialist, Faire Specialist, Research Librarian, Drift Audit Runner, Platform Specialist, Executive Brief). Most "capabilities" in this proposal are *workflows already covered by an existing agent*, surfaced through the existing approval taxonomy and the agent-heartbeat doctrine.

Per `/contracts/agent-architecture-audit.md`:

> "Do not create new agents until we audit what exists. The 70-agent registry is retired. The 21 contracts are real. Most 'missing' capabilities are partials, not gaps."

And per `/contracts/agent-heartbeat.md` §14:

> "The next layer is heartbeat activation: turning contract-backed agents into scheduled, bounded, cash-flow-producing operators."

**Hard rules this proposal MUST honor (lock-aligned with existing doctrine):**

1. **No new runtime agents added to `AGENT_REGISTRY` from this proposal.** A capability becomes a runtime agent only after it passes the §15 promotion gate.
2. **No new approval slugs.** Every Class B/C action this proposal triggers MUST already exist in `/contracts/approval-taxonomy.md` v1.6 (we use `gmail.send`, `hubspot.deal.stage.move`, `shipment.create`, `qbo.bill.create`, `lead.enrichment.write`, `hubspot.task.create`, `draft.email`, `internal.note`, `open-brain.capture`, etc. — all already registered).
3. **No new divisions.** Existing 6-active-/-6-latent division model holds.
4. **Class A/B/C/D approval taxonomy is law.** No relaxation, no "just this once" exceptions.
5. **Drew owns nothing.** Drew is a fulfillment node only; never appears as an approver, owner, or reviewer.
6. **Slack = command/approval/audit. Notion = research/doctrine canon-in-progress. Repo contracts = executable doctrine. Open Brain/Supabase = memory. HubSpot = B2B sales truth. Gmail = communication truth. QBO = finance truth.** This proposal is read-and-prepare against those systems, not write-against.
7. **Packs are dashboard views only.** No pack creates an agent or alters an approval flow.
8. **No pricing/cart/bundle/inventory changes.** No QBO Chart of Accounts mutation. No customer-facing sends without approval.
9. **P0-1 through P0-7 are complete preconditions.** Phase 37 cannot start without all P0 items closed (per `agent-heartbeat.md` §12 activation order).
10. **B2B Revenue Watcher (`agent-heartbeat.md` §11) is the canonical first proactive cash-flow lane.** Phase 37 below is the *operationalization* of that watcher's email surface — not a new agent that competes with it.

**HubSpot hard gate (Ben's lock 2026-04-30 PM):**

> *"If it is not reflected in HubSpot with owner, next action, due date, cadence state, and source, it is not live."*

A prospect/buyer/lead that fails this check is invisible to the system; the cadence sequencer + drafters refuse to operate on it.

---

## 0. Why this proposal exists

Across today's session we manually triaged ~50 inbound emails (replies, auto-replies, bounces, polite-no's, pricing pushbacks, sample requests, contact-routing updates) and sent 184 cold outreach emails across 7 waves. Roughly 70% of what we did was pattern-driven and mechanical. The other 30% was strategic — and when I tried to automate the strategic 30%, I leaked internal doctrine to Spottswood, fabricated a gelatin source, and over-pitched a vitamin line to Vahag. The system needs to know which 70% it can autonomously act on and which 30% has to come to you and Rene.

This proposal stands up a multi-agent email pipeline that:
1. **Reads** the inbox continuously (not just when Ben opens it)
2. **Classifies** every message into a category we've actually seen in production
3. **Routes** to a specialist agent per category
4. **Drafts** replies using validated templates + canonical company-vendor-packet data
5. **Gates** every send through the existing Class A/B/C/D approval taxonomy
6. **Logs** everything to HubSpot + Slack so we have a single audit trail
7. **Detects** the strategic 30% (whales, pricing pushbacks, escalations) and **stops** instead of acting

---

## 1. Real categories observed today (the spec for the classifier)

Every email triage today fell into ONE of these classes. The classifier learns these and tags inbound mail accordingly.

### 1.1 Inbound replies on outbound outreach (live engagements)

| # | Category | Example today | Right action |
|---|---|---|---|
| **A** | **Sample request** ("send a sample") | Rob @ Christmas Mouse · Kaylee @ Glacier NP · John @ Yellowstone (declined) | Ship sample (Phase 36 buy-label auto-flow), Touch-2 tracking email fires on UPS scan |
| **B** | **Qualifying question** (single short factual question) | Vahag @ VitaWest "pectin or gelatin?" | Direct factual answer + fishing pivot — *NEVER pitch strategic side-deals here* |
| **C** | **Polite no / not-a-fit** | Ollie @ Hotel Chocolat "Thanks Ben - it's not for us" | Mark contact UNQUALIFIED, close loop, no further outreach |
| **D** | **Pricing pushback** | Charmaine @ Buc-ee's HEB-Albanese-comp | **HARD HOLD** — surface to Ben + Rene in `#financials`, no auto-reply, formal proposal flow |
| **E** | **Vendor application / portal step** | Denise @ CNHA → cnha.org/product-submissions | Queue in portal-submission-backlog, hand off to Claude in Chrome |
| **F** | **Thread continuity issue** | Cindy @ Redstone "why a different email each time?" | Reply IN-THREAD via existing engagement, never start new thread when one exists |
| **G** | **Status check / urgency signal** | "Are we sure the auto-responder actually sent?" | Verify + answer + log; check repeat-guard hadn't suppressed |
| **H** | **AP / vendor-setup form** | Jungle Jim's W-9, Jeffrey Williams accounting | Queue AP packet flow (Phase 35.f wholesale-onboarding) |

### 1.2 Auto-replies / OOO (low signal, mostly close-loop)

| # | Category | Example today | Right action |
|---|---|---|---|
| **I** | **OOO autoreply with return date** | Paul @ Natural Grocers (back 5/1) · Brett @ Paradies (back 5/1) · Peter @ Wakefern (back 5/5) | Create reminder; resume outreach on return date; do not double-send before then |
| **J** | **OOO autoreply naming alternate contact** | Helen @ Cal Academy → apaccounting@calacademy.org · Dorothy @ Philly Zoo → payable.accounts@phillyzoo.org | Update HubSpot contact (UNQUALIFIED + note); create new contact at alternate; queue re-outreach |
| **K** | **Domain-redirect autoreply** | Alexa Nikolaides moved TA-Petro → BP · Dusty @ Lazy Gator → lazygator@gmail.com | Same as J, but flagged for verification (domain change can mean acquisition or invalid data) |
| **L** | **Bot/no-reply mailbox** | AREA15 info@ (auto-redirect to customerservice@) · Bass Pro marketing@ (auto-redirect to vendor-relations) | Re-route to correct mailbox, mark old as UNQUALIFIED |
| **M** | **Generic "we received your email"** | Dollywood Shop · CNHA initial · Glacier initial | Note received-ack, don't double-send, set a 14-day re-poke timer if no real reply |

### 1.3 Bounces / delivery failures

| # | Category | Example today | Right action |
|---|---|---|---|
| **N** | **Hard bounce (550/554/no domain)** | cowboysandindians@frontier.com · ba@retailforce.net · info@forbescandies.com · jovita@sedonacrystalvortex.com · cfrmarketing.com | Mark UNQUALIFIED + bounce-note; if a research path exists, queue an alternate-email lookup task |
| **O** | **Group-restricted (550 group accept-only)** | westyellowstoneinfo@delawarenorth.com | Mark UNQUALIFIED + note; queue research for verified individual contact at the org |
| **P** | **Soft bounce / temporary delay** | Ocracoke Preservation, Fredericksburg General Store (Gmail will retry 46h) | Watch — don't act yet. If permanent-fail comes back, route to N. |

### 1.4 Outbound-system messages (us → us, log only)

| # | Category | Example today | Right action |
|---|---|---|---|
| **Q** | **Drew sample request DM** | "Sample case to queue in ShipStation — East Coast lane" | Phase 36 buy-label flow handles automatically going forward; legacy DMs need manual close |
| **R** | **Approval card from `#ops-approvals`** | every Class B send before this proposal | Validates Ben/Rene approval, executes upon click |

### 1.4a Inbound vendor / financial / receipt messages (BEN'S ADDITION 2026-04-30 PM)

These are the financial-side emails the system needs to handle automatically. Today these get triaged manually by you/Rene, scattered across inbox + receipts-capture Slack + Booke AI uploads.

| # | Category | Example today | Right action |
|---|---|---|---|
| **W** | **Vendor invoice / bill INBOUND** (a vendor billing US — Powers, Belmark, Albanese, Uline, ShipStation, RangeMe) | Greg @ Powers' Run 1 reconciliation 4/30 (invoices `0284037-IN` + `0284052-CM` + credit memo) · RangeMe Premium past-due 4/24 · Jonathan @ Belmark file-prep dispute | Receipt/Invoice Handler §2.7: extract attachment, attach to QBO bill DRAFT in correct CoA bucket (per Rene's mapping), feed to Booke AI for matching, post to `#financials` for Rene approval BEFORE bill posts |
| **X** | **Receipt for credit-card / ACH purchase** (something we paid for that needs categorizing) | Uline shipping confirmation · AmEx welcome · BoA notification | Receipt Handler: OCR/extract vendor + date + amount + payment method, post to `#receipts-capture` Slack with extracted fields, queue Booke AI categorization, link to QBO transaction once matched |
| **Y** | **Customer-payment confirmation INBOUND** (a customer paying US — Stripe, Shopify Payments, Faire payouts, ACH from buyer) | none today, but Mike @ Thanksgiving Point invoice 1539 in flight | AP/AR Reconciler §2.7: match payment to outstanding invoice in QBO, mark invoice paid, surface to `#financials` for Rene |
| **Z** | **Obvious spam / unsubscribe-template** (no engagement, no human contact) | Firecrawl, OpenClaws Labs, Lendzi loan offers, Alibaba Sellers Team, Make.com promo, Roku promo | Spam Cleaner §2.8: trash or auto-archive (Class A-d Delete — see §2.5d), no operator interrupt, weekly digest of "X spam deleted" so Ben sees the volume |
| **AA** | **Statement / monthly close artifact** (BoA monthly statement, AmEx statement, vendor statement-of-account) | none today, but cycle-driven | Statement Handler: pull, attach to QBO month-close packet for Rene, post to `#financials` |

### 1.5 Strategic / whale-class (HUMAN ONLY)

| # | Category | Example today | Right action |
|---|---|---|---|
| **S** | **Whale-class touch** (Buc-ee's, KeHE, McLane, Eastern National, Xanterra, Walmart, HEB, Costco, Aramark, Compass, Delaware North, SSA Group) | Charmaine @ Buc-ee's | **HARD HOLD** — never autonomous reply. Always Ben + Rene approval in `#financials` thread. Formal PDF proposal track. |
| **T** | **Inbound from a known executive title** (CEO, COO, CFO, VP, Chief, Director above mid-level) | Sandra Morales @ Buc-ee's · Elizabeth Silkes @ Grand Canyon Conservancy | Class B (Ben single-approve) at minimum — never Class A |
| **U** | **Inbound containing legal language** (terms, contract, agreement, MNDA, indemnification, exclusivity) | none today, but planned | Class D — human only, attorney loop if needed |
| **V** | **Multi-batch / volume commitment offer** (anything ≥ 3 pallets / 2,700 bags) | Charmaine implied 90-store chain | Class C — Ben + Rene + escalation clause + custom-quote formula run before reply |

---

## 2. Subsystem architecture (capabilities, not new agents)

The model: **a chain of read-only capabilities that classify + draft, gated by a single approval surface. No capability ever sends without crossing the gate. No capability becomes a runtime agent without passing the §15 promotion gate.**

These capabilities are workflow lanes inside the existing contract-backed runtimes (per `/contracts/agent-architecture-audit.md` §3b, §10):

- Inbound triage capabilities (§§2.1–2.6, 2.8) live inside **Viktor** (sales/triage classification + drafting), **Spam Cleaner workflow** (separate Class A-d delete lane), **Sample/Order Dispatch (S-08)** (sample-shipper).
- Receipt / Bill / AP capabilities (§2.7) live inside **Finance Exception Agent + Booke + Compliance Specialist S-14** with `receipt.review.promote` Class B Rene.
- HubSpot Verification (§2.9) is a cross-cutting **read-mostly helper** with Class A `lead.enrichment.write` writes.
- Weekly Audit (§2.10) is a workflow inside the existing **Drift Audit Runner (S-25)**.

### 2.1 Inbox Scanner (read-only, scheduled)

**Role:** continuously poll Gmail (or subscribe to Push notifications) for new inbound mail. Pull message metadata + body. Skip bot/marketing senders via the existing `from:` denylist (semrush, linkedin, helpareporter, apollo.io, helium10, make.com, roku, america250, substack, rushordertees, ecommerceequation, firecrawl, puzzle.io, euna, lendzi, americanexpress, rangeme, alibaba — denylist canonicalized in this contract).

**Schedule:** every 5 minutes on weekdays 6 AM – 9 PM PT; every 30 minutes off-hours. Configurable.

**Output:** JSON record per message → KV-backed inbox queue at `inbox:scan:<message_id>` with status `received`.

**Class:** A (autonomous read-only).

### 2.2 Classifier Agent (read-only, on-demand)

**Role:** for each unprocessed message in the queue, classify into one of A–V from §1.

**Heuristics + rule layer (deterministic before LLM):**
- `from:postmaster|mailer-daemon` AND body contains `Address not found`/`mailbox unavailable` → **N (bounce)**
- `from:postmaster|mailer-daemon` AND body contains `temporary problem`/`Gmail will retry` → **P (soft bounce)**
- `subject:Automatic reply` AND body matches `out of (the )?office`/`return on` → **I or J (OOO)**
- Whale-domain match (`buc-ees.com`, `kehe.com`, `mclaneco.com`, `walmart.com`, `heb.com`, etc.) → **S (whale)** — short-circuit, NEVER classify-into-anything-else
- `body matches /no longer (with|at)/` → **J (contact left org)**
- `subject:Re:` AND HubSpot has prior engagement on the contact → mark for **F (thread-continuity check)** before drafting

**LLM layer (only after deterministic rules pass):**
- 1-shot classification call into the remaining categories with structured output (category + confidence)
- Below 0.75 confidence → escalate to **human review** in `#ops-approvals` instead of auto-routing

**Output:** record updated with `category`, `confidence`, `summary`. Status → `classified`.

**Class:** A (autonomous read-only) — but classification ≠ action. The action gate is below.

### 2.3 Inbound triage capabilities (NOT new agents)

Each row below is a **capability** — a bounded workflow lane within an existing contract-backed agent runtime (typically Viktor for sales-class triage, Ops Agent + S-08 for sample-class triage, Finance Exception Agent for receipt/bill-class triage). **No new agents are created by this proposal.** Capabilities become runtime agents only by passing the §15 promotion gate.

| Capability | Handles | Owning runtime | Drafts based on |
|---|---|---|---|
| `sample-shipper` | A | Sample/Order Dispatch (S-08) — already LIVE | Phase 36 buy-label flow + canonical sample-shipment doctrine §3.5 |
| `qualifying-answerer` | B | Viktor (sales) — already LIVE | Company-vendor-packet only; **never** offers strategic side-deals — fish-don't-pitch rule |
| `polite-no-closer` | C | Viktor — already LIVE | One-line acknowledgment; request `hubspot.deal.stage.move` Class B to mark UNQUALIFIED |
| `whale-escalator` | D, S, T, V | Viktor + Executive Brief — already LIVE | **Drafts a HOLD card** for Ben + Rene — never an outbound reply |
| `portal-submitter` | E | Operator (Claude in Chrome) — already LIVE | Hands off via portal-submission-backlog |
| `thread-continuity-fixer` | F | Viktor — already LIVE | Reply within existing Gmail thread (preserves `In-Reply-To` header) |
| `urgency-checker` | G | Viktor — already LIVE | Surfaces in `#ops-approvals` immediately, drafts verify-then-answer |
| `ap-onboarder` | H | Phase 35.f wholesale-onboarding flow — already LIVE | Hands off to existing onboarding-dispatch-prod path |
| `ooo-tracker` | I, M | Viktor (operating-memory write) — Class A `internal.note` | Sets a 14-day re-poke reminder via `hubspot.task.create`; quiet-collapses |
| `routing-updater` | J, K, L | Viktor — Class A `lead.enrichment.write` | HubSpot patch (mark old UNQUALIFIED, create new contact at alternate, link via note) |
| `bounce-cleaner` | N, O | Viktor — Class A `lead.enrichment.write` | HubSpot UNQUALIFIED + note; queue alternate-email research task if applicable |
| `delay-watcher` | P | Viktor — `system.read` only | No action; watch for retry success or final fail |

Each capability is a **read-only function that emits a draft or a Class A internal write**. Sends happen at the §2.5 approval gate. This list does not register new agents and does not add slugs.

### 2.7 Receipt / Invoice / AP Handling capabilities (NOT new agents)

Handles categories **W, X, Y, AA** — the financial-side inbox. These are capabilities within the existing **Finance Exception Agent + Booke + S-08-style operator surface**. Each leverages already-registered approval slugs (`qbo.bill.create` Class B Rene, `receipt.review.promote` Class B Rene, `vendor.master.create` Class B Rene, `qbo.invoice.partial-payment.apply` Class A). **No new agents, no new slugs.**

**Capability functions:**

- **`vendor-bill-extractor`** (category W) — for INBOUND vendor invoices (Powers, Belmark, Albanese, Uline, ShipStation Premium, RangeMe Premium, etc.):
  1. Pulls the PDF attachment from the email
  2. OCRs / parses (vendor name, invoice #, line items, date, amount, terms)
  3. Cross-references vendor against `/contracts/per-vendor-margin-ledger.md` + `/CLAUDE.md` Production list
  4. Drafts a QBO bill DRAFT (never posted) under the correct CoA bucket per Rene's mapping
  5. Uploads PDF attachment to QBO via `POST /api/ops/qbo/attachment` (already wired per Viktor 4/29 ops audit)
  6. Posts the draft + extracted line items + suggested CoA bucket to `#financials` thread for Rene **Class C** approval
  7. On Rene approval, posts bill via existing QBO route. Failure-mode: bill stays DRAFT in QBO until Rene clears it manually.
  8. Hands a copy to **Booke AI workflow** for cross-validation against bank-statement line items (existing Booke workflow remains source of truth on bookkeeping; the agent just feeds it cleaner inputs).

- **`receipt-categorizer`** (category X) — for credit-card / ACH receipts:
  1. Pulls the receipt body / attachment
  2. Cross-references against the categorized Pirate Ship / Uline / vendor-receipt patterns Viktor already locked (see Pirate Ship synopsis 2026-04-19)
  3. Posts to `#receipts-capture` Slack with `{vendor, date, amount, payment_method, suggested_CoA, source_email_id}` — preserves the existing Slack-receipt-upload doctrine
  4. On Rene confirmation, fires `POST /api/ops/qbo/receipt` (or queues for Booke AI) — Class B approval

- **`ap-ar-reconciler`** (category Y) — for INBOUND customer-payment confirmations:
  1. Match the payment amount to outstanding QBO invoices via `GET /api/ops/qbo/query?type=ar`
  2. If exact match → draft `mark invoice paid` action (Class B Rene approve)
  3. If no exact match → flag in `#financials` for Rene to manually reconcile (Class C)
  4. Tracks payment-method (Shopify Payments, Faire payouts, ACH from buyer, Stripe, check) for the per-channel proforma

- **`statement-handler`** (category AA) — pulls monthly bank/cc/vendor statements, attaches to QBO month-close packet, posts to `#financials` for Rene's monthly close.

**Doctrine:** the agent NEVER auto-posts to QBO without Rene's approval. The agent's job is **extraction + classification + draft preparation** — the financial-write decision is always Rene's. Per `/contracts/approval-taxonomy.md` — `qbo.bill.create.from-receipt` is parked at PARKED status, and this agent is what unlocks it (with the Class C gate).

### 2.8 Spam / Junk Cleaner (BEN'S ADDITION 2026-04-30 PM)

Handles category **Z** — auto-deletes obvious-spam emails so the inbox stops getting cluttered.

**Detection rules (deterministic, layered):**
- `from:` matches the existing canonicalized denylist (semrush, linkedin, helpareporter, apollo.io, helium10, make.com, roku, america250, substack, rushordertees, ecommerceequation, firecrawl, puzzle.io, euna, lendzi, americanexpress, rangeme, alibaba — minus rangeme/Faire which sometimes have real campaign data we DO want)
- AND no prior engagement on the contact in HubSpot (no real relationship)
- AND no attachment (no invoice/PDF that needs handling)
- AND subject matches noise patterns (`unsubscribe`, `*-day sale`, `% off`, `Last call`, `View this online`, `Customers Often Purchase`, `Earn rewards`)

**Action:** **Class A-d (autonomous DELETE)** — moves to Gmail Trash via `gmail.users.messages.trash`. Adds a row to a daily spam-cleanup log. Posts a daily digest to `#ops-audit` like *"Spam cleaner: deleted 47 emails today (semrush ×12, helpareporter ×9, apollo.io ×7, ...)."*

**Safety:** if a sender ever lands a real human reply (HubSpot has any prior engagement), the spam-cleaner WILL NOT delete from that domain again, period. Domain gets pulled off the spam-eligible list permanently.

### 2.9 HubSpot Verification Agent (BEN'S ADDITION 2026-04-30 PM)

**Doctrine:** *"when it comes to customers/people we actually engage with, everything gets logged to HubSpot, everything is verified and queried against HubSpot."*

This is a **cross-cutting agent** — runs at multiple touch points:

1. **Pre-send check** — before any outbound reply leaves the system, the agent verifies:
   - Recipient email exists as a HubSpot contact (or creates it)
   - Recipient is associated with at least one HubSpot deal (or creates one)
   - The drafted message is logged as an `engagement` on both contact + deal AT SEND TIME (atomic — no orphaned sends)
   - HubSpot lead-status is NOT `UNQUALIFIED` (if it is, send is HARD BLOCKED with a "this contact is marked unqualified — override?" surface)

2. **Pre-classify check** — before the classifier runs, the agent enriches each inbound message with the HubSpot context:
   - Contact id + name + last activity + lifecycle stage
   - Associated deal(s) + stage(s) + amount(s)
   - Last 5 engagements (for thread-continuity context)
   - This enrichment is what lets the classifier short-circuit on "we already have a relationship here, this is a reply, not a cold contact"

3. **Daily reconciliation** — at 8 PM PT (post-EOD), runs a sweep:
   - Every Gmail thread modified today → check that an engagement exists in HubSpot
   - Any send / receive without a corresponding engagement → flag in `#ops-approvals` for manual link

### 2.10 Weekly Audit Agent (BEN'S ADDITION 2026-04-30 PM)

**Doctrine:** *"once a week there is an audit against our sent mail to verify that everything is being logged into HubSpot and everything is caught/captured. And that double-touches are not occurring."*

**Schedule:** Sunday 8 PM PT, posts to `#ops-approvals` thread for Ben's Monday-morning review.

**Audit checklist (machine-runnable):**
1. **Sent-mail coverage** — every outbound message in Gmail's `Sent` folder this week → confirm a matching HubSpot engagement exists. Misses → list with `gmail_message_id` + `to:` + `subject` for manual link or re-fire.
2. **Inbound coverage** — every inbound classified message → confirm HubSpot engagement was created. Same exception list.
3. **Double-touch detection** — any contact who received >1 cold-outreach in the same week without a real reply in between → flag as a likely repeat-guard miss. Dedup-fix recommendation included.
4. **Bounce sweep** — any send to an address that bounced in the last 30 days that wasn't marked UNQUALIFIED — fix and report.
5. **HOLD audit** — every HOLD in the system → confirm it's still actively held (not silently stuck for 14+ days). Stale HOLDs → flag.
6. **Validator BLOCKED-phrase recall** — sample 50 random sends from the week, run them through the current validator, ensure all pass (catches drift where an agent learns a new pattern that should have been blocked).
7. **Compliance fabrication audit** — scan all outbound sends for assertions about kosher/halal/beef/pork-gelatin/organic/non-GMO. Any unsourced assertion → flag.
8. **Doctrine drift** — diff this week's outbound against the canonical templates; surface anything that drifted.

**Output:** a single `#ops-approvals` post per week titled "Weekly Email Audit — YYYY-MM-DD" with each section's findings + total counts. Quiet-collapses to "✅ All clean" when zero exceptions.

### 2.4 Validator (existing, extend)

Already shipped at `scripts/outreach-validate.mjs` with BLOCKED phrases. Extend to:
- Run on **every** outbound draft (not just cold outreach)
- Add `compliance-class` BLOCKED phrases (kosher/halal/beef-derived/pork-derived gelatin source) — block if asserted without source citation per the gelatin-walk-back doctrine in `/contracts/company-vendor-packet.md` v1.3 §10
- Add `pricing-class` BLOCKED phrases (any per-bag $ figure that's not in canonical grid OR in distributor-pricing-commitments.md) — Phase 36.6 visibility flag at the validator boundary
- Hard-block if the draft contains `tag:hold` or matches a HOLD-doctrine pattern (whale, exclusivity, multi-year)

### 2.5 Approval Gate — UNIVERSAL (BEN'S DIRECTIVE 2026-04-30 PM)

**Doctrine:** *"we also want to be sure that nothing goes out without approval, nothing."*

Every outbound email — cold outreach, reply to inbound, sample-confirm, polite-no, OOO ack, even routing-update notifications — is presented as a draft in Slack with **interactive Approve / Deny / Edit buttons**. There is NO Class A autonomous outbound path. Class A is reserved for **internal-state writes** (HubSpot lead-status updates, KV state flips, Slack `#ops-audit` logs, deletions of category-Z spam).

| Class | Action type | Example | Gate |
|---|---|---|---|
| **A-w** (autonomous WRITE, internal only) | HubSpot patch, KV flip, audit log, file move | Mark Ollie/Hotel Chocolat UNQUALIFIED · Delete category-Z spam · Update OOO return-date in KV | Autonomous; logs to `#ops-audit` |
| **A-d** (autonomous DELETE, narrow) | Spam-cleaner delete (category Z only, with the safety rules in §2.8) | Delete Lendzi loan offer | Autonomous; daily digest to `#ops-audit` |
| **B** | Outbound to known-warm contact, low-stakes content (sample ack, OOO acknowledge, polite-no close) | Reply "we'll get the sample out this week" | Ben one-tap Approve/Deny/Edit in `#ops-approvals` |
| **C** | Pricing reply, multi-batch commitment, anything > $1,000 GP impact, vendor bill posts to QBO | Reply with quoted price · Post Powers bill to QBO | Ben + Rene both approve in `#financials` thread |
| **D** | Whale class, legal language, contract, attorney loop, exclusivity | Charmaine @ Buc-ee's reply · multi-year MNDA | HUMAN ONLY — never agent-drafted, only human-composed |

**Critical:** there is NO outbound email Class A path. Even a one-line "Got it, thanks" goes through the Approve gate so we have a clean audit trail and we don't drift over time into autonomous-send territory.

**Token format (legacy, retained):** `<approver>:<action>:<id>`. Going forward the Slack interactive buttons in §2.5a are the primary surface; the token format is the fallback for when Slack is degraded.

### 2.5a Slack Interactive Approval UI (BEN'S DIRECTIVE 2026-04-30 PM)

Every drafted outbound posts as a single Slack message in `#ops-approvals` (or `#financials` for Class C/D) with:

```
┌────────────────────────────────────────────────────┐
│ 📧 EMAIL DRAFT — <Category> (Class B/C/D)         │
│ To: <recipient>                                    │
│ Subject: <subject>                                 │
│                                                     │
│ ─── STRATEGIC FRAMEWORK ───                        │
│ • Premise: <why they wrote / what triggered>      │
│ • Relationship: cold | warm | established | repeat│
│ • Opportunity: <volume × tier × LTV estimate>     │
│ • Goal: sale | close | qualify | hold | deflect   │
│ • Risk: <what could go wrong>                     │
│ • Financial frame: <margin / AR / escalation>     │
│ • Internal-only DON'T-SHARE: <list>               │
│ • Play: <strategic objective in this exchange>    │
│                                                     │
│ ─── DRAFT REPLY ───                               │
│ <full reply body, formatted for read>             │
│                                                     │
│ [✅ Approve]  [❌ Deny]  [✏️ Edit]                 │
└────────────────────────────────────────────────────┘
```

**Button behavior:**

- **✅ Approve** — fires send via existing `send-email.sh` / `send-and-log.py`, validator runs one final time, HubSpot engagement created atomically. On failure, post error reply in the thread; never silent-fail.

- **❌ Deny** — drops the draft entirely. Ben can optionally type a reason in a Slack reply on the thread; the system logs it to the audit so we learn what classes of drafts get rejected. No further action on this email until a human re-engages it.

- **✏️ Edit** — opens a Slack modal (`views.open` API) with the draft pre-loaded as editable text. Ben edits inline. **On submit, the system pings the LLM (Claude / GPT) with `{original_draft, ben_edits, original_strategic_framework}` and asks it to "execute these changes — preserve tone + intent + the strategic framework constraints, apply Ben's specific edits."** The LLM emits a v2 draft. The v2 draft is RE-PRESENTED in `#ops-approvals` as a new approval card with the diff inline ("Ben requested: <his edit text>"). New approve/deny/edit cycle. No infinite loop — after 3 edit cycles, the system surfaces "this draft has been edited 3 times — review with Ben in person before re-presenting."

**Slack interactive UI implementation:**
- Block Kit JSON with `actions` block containing 3 `button` elements
- `action_id` = `email_approve_<draft_id>`, `email_deny_<draft_id>`, `email_edit_<draft_id>`
- Slack interactivity webhook → existing `/api/ops/slack/interactive` endpoint (build it if not exists)
- Edit modal uses `views.open` with `plain_text_input` block, multiline=true, initial_value=draft
- LLM call uses Claude via Anthropic SDK (preferred — same provider as the rest of the system)

**Failure modes:**
- Slack down → Ben gets the draft via email (to his own inbox) with `[APPROVE]` / `[DENY]` mailto: links that hit the same endpoint
- LLM unavailable for edit → modal shows "LLM offline — please copy-paste your edit and I'll send when service returns"
- Webhook timeout (>5s) → Slack retry delivers the action; idempotency on `draft_id` prevents double-sends

### 2.5b Strategic Framework — the "what's the play here" check (BEN'S DIRECTIVE 2026-04-30 PM)

**Doctrine:** *"there needs to be full strategy thought out around each response, so it is thorough, and we don't give away company info / internal info, and we always approach every email from the perspective of what is the play here, are we selling, are we closing a deal, what is the full concept, what is the premise, what is the goal, what is the relationship, what is the opportunity, what is the risk, and of course financials etc, and then we craft a response based with what is our strategy in this conversation."*

**Hard rule:** every drafter (every specialist agent in §2.3 + §2.7) MUST run the inbound through the 8-question Strategic Framework BEFORE generating a draft. The 8-question analysis appears at the top of every approval card in §2.5a so Ben/Rene can see the strategic logic AND the draft together.

**The 8 questions:**

1. **Premise** — Why is this person writing? What triggered the message? (their pricing pushback, our outreach, a referral, a sample request, a problem)
2. **Relationship** — Cold contact? Warm prospect? Established buyer? Repeat customer? Distributor? Whale-class? (use HubSpot context from §2.9)
3. **Opportunity** — What could this become at full upside? Volume × tier × LTV. Quote a dollar number range. (this prevents under-investing in big plays and over-investing in small ones)
4. **Goal** — In THIS specific exchange, what are we trying to achieve? (Sale / Close / Qualify / Nurture / Deflect / Hold-class / Redirect)
5. **Risk** — What could go wrong? (Over-commitment, locked pricing, leak doctrine, tone mismatch, exclusivity trap, brand dilution, double-booking, AR exposure, attorney loop)
6. **Financial frame** — What's the margin band on this play? Any AR exposure? Does it require Class C / multi-batch escalation clause / off-grid pricing approval?
7. **Internal-only DON'T-SHARE list** — What MUST stay out of the reply? (route doctrine · COGS breakdown · custom-quote formula details · per-vendor margin · "we deliver freight on 3+ pallets to subsidize routes" · "$0.10/bag savings on loose-pack" · etc. — from the Spottswood incident lessons)
8. **Play** — Stated as a single strategic objective. Not "send a reply" but "open the door to a 3-store pilot at our standard B2 rate" or "soft-decline without burning the relationship" or "hold-class — gather more data before responding."

**Deliverables of the framework:** before drafting, the agent emits a structured `StrategicFrame` object:

```typescript
interface StrategicFrame {
  premise: string;
  relationship: "cold" | "warm" | "established" | "repeat" | "distributor" | "whale";
  opportunity: { lowUsd: number; highUsd: number; rationale: string };
  goal: "sale" | "close" | "qualify" | "nurture" | "deflect" | "hold" | "redirect" | "info-gather";
  risks: string[];
  financialFrame: {
    marginBand: string;
    arExposure: string | null;
    requiresClassC: boolean;
    escalationClauseRequired: boolean;
  };
  dontShare: string[];
  play: string;
}
```

The draft is then generated WITH the frame as context. The frame is rendered at the top of the Slack approval card so the human can see the strategy before reading the draft. **If the frame is missing or any of the 8 fields is empty, the system rejects the draft and forces re-analysis.**

### 2.5c Internal-info redaction guard

Cross-cuts §2.4 validator + §2.5b strategic framework. The validator's BLOCKED phrase list is extended with auto-flagged internal-only terms (sourced from the `dontShare` list across all `StrategicFrame` outputs ever produced — the system learns its own private vocabulary):

- Absolute-block phrases (regex):
  - `route( \w+){0,3} (anchor|fill|density|economics)` (route-doctrine leak — Spottswood pattern)
  - `\$1\.79|\$1\.77|\$1\.52|cogs|cost of goods` (COGS leak)
  - `loose[- ]pack savings|secondary packaging savings` (cost-reduction internal lever)
  - `albanese|powers confections|belmark` (supplier names — sometimes OK in proposals, but blocked by default — operator must whitelist for a specific draft)
  - `class [abcd]|approval taxonomy` (governance vocabulary)
  - `B[0-9](-ANCH|-FILL|-EXC|-PU)` (B-tier internal codes)
  - `wholesale-pricing\.md|per-vendor-margin-ledger\.md` (contract paths)
  - Custom-quote formula step language (`min_margin_floor`, `wiggle`, `tier_classification`)

If any of these appear in a draft, the validator HARD-BLOCKS and the draft is sent back to the specialist agent with the offending phrase(s) called out. Operator can manually whitelist specific phrases for a specific draft via the Edit button (LLM rewrites without the phrase).

### 2.6 Sender + Logger

**Sender:** existing `scripts/send-email.sh` (himalaya/SMTP) for cold outreach AND replies. For replies, **pass `In-Reply-To` and `References` headers** so Gmail threads correctly (Cindy/Redstone fix). Repeat guard stays — but `--allow-repeat` available to specialist agents that explicitly need it (e.g. legitimate same-day reply to inbound).

**Logger:** every send creates HubSpot `engagement` AND posts a permalink to `#ops-approvals` for audit. Existing pattern via `scripts/sales/send-and-log.py` — extend to handle reply mode (`--reply-to <message_id>`).

---

## 3. Strategic detection layer (the 30% the system stops on)

These are the things I tried to automate today and got wrong. The system needs explicit detection + HARD STOP.

### 3.1 Whale-class detection

**Rule:** any inbound from a domain in the whale list → instant classification S (whale), no LLM second-guess. Whale list (canonicalized in this doc):
- `buc-ees.com`
- `kehe.com`
- `mclaneco.com`
- `walmart.com`, `samsclub.com`
- `heb.com`
- `costco.com`
- `aramark.com`, `compass-usa.com`, `delawarenorth.com`, `delawarenorth.onmicrosoft.com`
- `xanterra.com`
- `ssagroup.com`
- `nationalgeographic.com`
- `evelynhill.com`
- `easternnational.org`
- `kroger.com`, `wholefoods.com`, `unfi.com`, `kehe.com`
- `dotfoods.com`, `core-mark.com`
- `bp.com`, `7-eleven.com`, `wawa.com`, `sheetz.com`, `ta-petro.com`, `cfrmarketing.com`, `eg.com`

**Action:** whale agent drafts a **HOLD card** in `#financials` thread; sends NOTHING.

### 3.2 Pricing pushback detection

**Rule:** any inbound containing per-bag $ figures, "per oz", "premium over", "Albanese", "wholesale rate", "case cost", "MOQ" → classify D (pricing pushback). Same hold pattern. Surface to Ben + Rene with the exact pushback excerpt and the matched B-tier rebuttal.

### 3.3 Exclusivity / multi-year detection

**Rule:** any inbound containing "exclusive", "exclusivity", "multi-year", "auto-renew", "minimum commitment", "guaranteed volume", "first right of refusal" → Class D. Never autonomous.

### 3.4 Compliance fabrication guard

**Rule:** any draft asserting kosher, halal, vegan, beef-gelatin, pork-gelatin, organic, non-GMO without a citation in the company-vendor-packet → BLOCK. Drafter must cite source or stop.

### 3.5 Strategic side-pitch guard (the Vahag rule)

**Rule:** when the inbound is a single qualifying question, the drafter is FORBIDDEN from offering future product lines, side deals, or strategic positioning. The reply answers the question, then asks ONE fishing question. No more.

### 3.6 Regulatory-hook guardrail (Ben's lock 2026-04-30 PM)

**Rule:** Regulatory tailwinds (CA AB 418, CA AB 2316, TX SB 25, FDA dye bans, state dye-restriction bills, USDA / FDA actions) are **internal positioning only**. They never auto-render in customer-facing copy.

- A `ProspectFrame.regulatoryHook` value is ONLY allowed in INTERNAL fields (briefing notes, strategic-frame analysis, deal-desk memos).
- Any draft that would render a regulatory hook in outbound customer-facing copy MUST FIRST pass through the existing Compliance Specialist (S-14) `approved-claims.add` Class B Ben-approval flow + counsel review (`claim.counsel-review.request` Class B). The phrase must already be in the Approved Claims List.
- The validator §2.5c absolute-block list catches unapproved regulatory phrasing and HARD-BLOCKS the send (e.g. unverified `TX SB 25`, `CA AB 2316`, `dye ban`, `FDA action`).
- Regulatory hooks should **rarely** be the default first-line outreach angle. Default to the doctrine-match in §11.1 (gateway communities, premium impulse, sample-as-credential, distributor-pyramid). Use regulatory framing only when a specific approved-claim line maps to the prospect's vertical AND counsel has reviewed it.

This guardrail is doctrine-aligned with `/contracts/approval-taxonomy.md` v1.6 Class D `ad.claim.publish-unreviewed` (any claim that hasn't been reviewed against the Approved Claims List is prohibited).

---

## 4. Memory + state

We need to remember:

- **Conversation history per contact** — already in HubSpot engagements
- **Classifications already made** — don't re-classify the same message twice
- **HOLD state** — `tmp/sends/holds/<id>.json` exists; canonicalize as `kv:hold:<contact_or_deal_id>` so it survives restarts
- **OOO return dates** — `kv:ooo:<email>` with `returnDate`, `resumeAfter`. Block outreach to that email until that date
- **Polite-no's** — UNQUALIFIED in HubSpot is the source of truth; outbound flow respects it
- **Bounce status** — UNQUALIFIED with category bounce_email; outbound flow respects it
- **Delivered-pricing commitments** — `/contracts/distributor-pricing-commitments.md` (existing); the validator reads it
- **Per-vendor margin context** — `/contracts/per-vendor-margin-ledger.md` (Phase 36.1 parser exists)

No new persistence layer needed beyond what's wired today. KV + HubSpot + the canonical contract markdowns are the system memory.

---

## 5. Integration with what's already shipped

This proposal does NOT propose new infrastructure — it proposes a **specialist-agent layer** on top of what exists.

| Existing | Reused as |
|---|---|
| `scripts/sales/send-and-log.py` | Sender for cold outreach + replies (extend with `--reply-to`) |
| `scripts/outreach-validate.mjs` | Validator at draft → send boundary (extend with compliance + pricing rules) |
| `scripts/send-email.sh` | Plain SMTP send for one-off replies (already in use) |
| `/contracts/approval-taxonomy.md` | Class A/B/C/D gate (already enforced) |
| `/contracts/company-vendor-packet.md` v1.3 | Drafter pulls every fact from here |
| `/contracts/wholesale-pricing.md` v2.4 | Pricing answers reference grid |
| `/contracts/distributor-pricing-commitments.md` | Distributor-class answers |
| `/contracts/per-vendor-margin-ledger.md` | Vendor-margin context per deal |
| `/contracts/portal-submission-backlog.md` | Hand-off destination for category E |
| `/contracts/integrations/shipstation.md` §3.5 | Sample-shipment automation flow (Phase 36 buy-label) |
| `/contracts/financial-mechanisms-blueprint.md` §6.4–6.6 | Off-grid + escalation + vendor-margin already gate the send |
| `#ops-approvals` channel | Approval surface |
| `#financials` channel | Class C / whale escalation |
| `#shipping` channel | Sample-shipment audit |
| `daily-brief.ts` morning brief | Surface counts of classified inbound, OOO returners due today, pending HOLDs |

---

## 6. Build phases (sequenced)

| Phase | Build | Effort | Dependencies |
|---|---|---|---|
| **37.1** | **Inbox Scanner** — Gmail Push subscription OR 5-min cron poll. Writes `inbox:scan:<msg_id>` records. | M | none |
| **37.2** | **Classifier Agent** — deterministic rule layer + LLM fallback. Whale-domain detector. Updates KV with `category`. | M | 37.1 |
| **37.3** | **HubSpot Verification Agent** §2.9 — pre-send check, pre-classify enrich, daily reconciliation | M | 37.1 |
| **37.4** | **Validator extension** — compliance + pricing BLOCKED rules + internal-info redaction §2.5c | S | none, parallel |
| **37.5** | **Strategic Framework** §2.5b — `StrategicFrame` struct + 8-question analyzer | M | 37.2, 37.3 |
| **37.6** | **Slack Interactive Approval UI** §2.5a — Block Kit message + Approve/Deny/Edit buttons + edit-via-LLM modal | M | 37.5 |
| **37.7** | **Spam Cleaner** §2.8 — category Z auto-delete with safety rules | S | 37.2 |
| **37.8** | **Bounce Cleaner + Routing Updater + OOO Tracker** (categories I, J, K, L, M, N, O, P) | S | 37.2 |
| **37.9** | **Sample Shipper specialist** (category A) — wraps existing Phase 36 buy-label flow | S | 37.2 + Phase 36 (already done) |
| **37.10** | **Whale Escalator + Pricing Pushback Holder** (categories D, S, T, V) — drafts HOLD cards, never sends | M | 37.2, 37.5 |
| **37.11** | **Polite-No Closer + Qualifying Answerer + Thread Continuity Fixer** (categories C, B, F) | M | 37.4, 37.5, 37.6 |
| **37.12** | **Receipt / Vendor-Bill Handler §2.7** — sub-agents `vendor-bill-extractor`, `receipt-categorizer`, `ap-ar-reconciler`, `statement-handler`. QBO bill DRAFT only — Rene approves before post. | L | 37.2, 37.3 + existing `/api/ops/qbo/attachment` route + Booke AI workflow |
| **37.13** | **Memory layer** — KV ooo / hold / bounce records as canonicalized state | S | 37.8, 37.10 |
| **37.14** | **Daily-brief surface** — morning brief shows: N inbound classified, M HOLDs awaiting decision, K OOO returners today, J bounces cleaned, L portal-handoffs queued, P vendor bills awaiting Rene | S | 37.1–37.12 |
| **37.15** | **Weekly Audit Agent §2.10** — Sunday 8 PM PT, 8-section audit posted to `#ops-approvals` | M | all above |
| **37.16** | **Tests + drift audit** — sample fixtures for every category A–AA; weekly drift audit catches new categories the classifier sees with low confidence | M | all above |

Recommended sequence (matches highest-value-first / lowest-risk-first / HARD STOPS first):
**37.1 → 37.2 → 37.3 → 37.4 → 37.7 → 37.5 → 37.6 → 37.10 → 37.8 → 37.9 → 37.11 → 37.12 → 37.13 → 37.14 → 37.15 → 37.16**

Rationale:
- **Spam cleaner (37.7) ships before any drafter** — the inbox needs to be clean before classification gets stress-tested. Plus it's the only Class A-d delete in the system; getting the safety rules right is critical.
- **Strategic framework (37.5) + Slack UI (37.6) ship before reply-drafting agents** — every drafter consumes the framework + presents through the UI, so they're foundational.
- **Whale escalator (37.10) ships before reply-drafting (37.11)** — same rationale as before: HARD STOP for whales must land before any reply goes live.
- **Receipt/Bill Handler (37.12) ships AFTER the drafter and approval pipeline is hardened** — touching QBO is high-stakes; we want every other safety rail in place first.
- **Weekly audit (37.15) ships near the end** — it's the safety net that catches everything else's drift, but it has nothing to audit until the system is producing real output.

---

## 7. What the system explicitly does NOT do

These are guardrails Ben/Rene have established today that the proposal preserves. **Updated 2026-04-30 PM with Ben's universal-approval directive.**

1. **No autonomous outbound email. Period.** Every outbound goes through the §2.5a Slack approval card with Approve/Deny/Edit buttons. Class A is reserved for internal-state writes (HubSpot patches, KV flips, audit logs, category-Z spam delete) — never email send.
2. **No auto-reply to whale-class inbound.** Ever. (§3.1)
3. **No autonomous pricing answer.** Class C minimum.
4. **No fabricated compliance assertions** (gelatin source, kosher, halal, vegan, organic, non-GMO). The validator's compliance-class BLOCKED phrases are HARD-blocks; the operator must whitelist explicitly.
5. **No strategic side-pitches** in qualifying-answer replies (the Vahag rule, §3.5).
6. **No reply that creates a NEW thread when one exists** (the Cindy/Redstone fix; Thread Continuity Fixer §2.3).
7. **No double-send** within 24 hours (existing repeat guard, preserved). The Weekly Audit Agent §2.10 §3 catches misses.
8. **No outbound to UNQUALIFIED contacts** without explicit operator override (HubSpot Verification Agent §2.9 hard-blocks).
9. **No internal-info leakage.** §2.5c absolute-block phrases catch route doctrine, COGS, custom-quote formula, B-tier internal codes, etc. Operator must whitelist per draft if a specific phrase is needed.
10. **No QBO write without Rene approval.** Receipt/Vendor-Bill Handler §2.7 always drafts; never auto-posts.
11. **No agent fabricates anything from training data** — the validator BLOCKED phrase list catches the most common drift patterns.
12. **No autonomous send during Ben's "quiet hours"** (configurable; default 9 PM – 6 AM PT) for non-urgent outbound. Hold-pattern queues for next-morning approval card.
13. **No spam-cleaner delete from a domain that has any HubSpot engagement history.** Cross-cuts §2.8 — once we've talked to a human at a domain, that domain is permanently off the spam-eligible list.
14. **No edit-via-LLM cycle exceeding 3 iterations.** After 3 edit cycles on a single draft, the system stops and surfaces "review with Ben in person" — prevents LLM drift on a tricky draft.

---

## 8. Specific incidents from today the system would have caught

The proposal is sized to today's actual failure modes. Each row maps an incident → which agent + rule would have prevented it.

| Incident | Today's behavior | What the system would do |
|---|---|---|
| Spottswood internal-doctrine leak | Validator missed; sent | Validator extension §2.5c catches "anchor a profitable route run" / route-doctrine phrases; HARD BLOCK + Strategic Framework §2.5b `dontShare` audit pre-draft |
| Vahag vitamin-line over-pitch | I drafted strategic side-pitch | Strategic side-pitch guard §3.5 + Strategic Framework §2.5b `play` constraint = "qualifying answer only, no side-deals" |
| Gelatin "beef-derived" fabrication | I asserted without source | Compliance fabrication guard §3.4 + validator BLOCKED rule + Strategic Framework `dontShare` populates from `/contracts/company-vendor-packet.md` source-citation rules |
| Charmaine reply almost auto-fired | Caught by manual hold | Whale-class detection §3.1 short-circuits classifier → HOLD card via Whale Escalator §2.3 specialist |
| Bot token dead → can't push files | Had to email + drag-drop manually | Sender falls back to email-Ben-for-attach automatically; Slack UI §2.5a degrades gracefully to email-with-mailto-buttons |
| Christmas Mouse sample only DM'd Drew | No #shipping artifact | Sample-Shipper specialist §2.3 row 1 forces Phase 36 buy-label flow which auto-pushes |
| Ripley's HubSpot 6-filter crash | wave runner died, lost 4 hours | Bug already fixed (commit 968f0e2) — system would treat the helper failure as a Class A error log, not a process kill |
| Repeat guard tripping legitimate replies | Had to use --allow-repeat manually | Reply specialist passes `--allow-repeat` automatically (it's a reply, not a duplicate cold-intro) |
| Bad Apollo data on Flagstaff row 29 | Validator caught (bad first name + pipe char) | Same. Already working. |
| Cindy/Redstone "different email each time" | Had to manually thread | Thread-Continuity Fixer §2.3 row 5 — replies in-thread by passing `In-Reply-To` + `References` headers |
| 4 contacts left their orgs (Alona/Helen/Alexa/Dorothy) | I cleaned up manually | Routing Updater §2.3 row 9 — automatic, posts approval card with the auto-detected new email + UNQUALIFIED-old action |
| 6 bounces from Wave 1 | I cleaned up manually | Bounce Cleaner §2.3 row 11 — automatic Class A-w mark UNQUALIFIED + note |
| Greg @ Powers Run 1 reconciliation invoices not auto-attached to QBO | I posted to `#financials` thread for Rene, manually linked | Vendor-Bill-Extractor §2.7 — auto-extracts the 3 PDFs, drafts QBO bill DRAFT linked to Powers vendor record, posts to `#financials` for Rene Class C approval |
| RangeMe Premium past-due invoice 4/24 | Surfaced manually in inbox triage | Vendor-Bill-Extractor §2.7 — auto-detects past-due, escalates to `#financials` immediately |
| Inbox cluttered with Lendzi / Firecrawl / Alibaba / Roku / Make.com promo | Manually filtered in every triage | Spam Cleaner §2.8 — auto-deletes; daily digest shows volume |
| Email signature mismatch (I used short sig, Ben pushed back) | Ben corrected manually | Strategic Framework §2.5b enforces signature block from `/contracts/wholesale-pricing.md` §14 brand signature standard — drafter pulls from canonical source, can't drift |
| Vahag answer over-explained ("five flavors, real fruit juice, made in USA") | Ben said "just gelatin based, not all this mumbo jumbo" | Strategic Framework `goal: qualify` + `play: fishing-only` = drafter rule "answer the asked question only, then ask one question, no expansion" |
| No HubSpot record for Charmaine despite multiple engagements | I created manually | HubSpot Verification Agent §2.9 — pre-classify enrichment creates the contact + deal association atomically |
| Rob (Christmas Mouse) wrongly attached to Bronner's deal | I manually re-associated | HubSpot Verification Agent §2.9 — domain-based dedup prevents the cross-association in the first place |
| Patrick @ King Henry's contact not associated with deal | I manually associated | Same — atomic engagement-create includes deal-association |

---

## 9. Open questions — answers locked in v0.4 + remaining for Ben + Rene

**ANSWERED in v0.4 (locked into doctrine):**

- **OQ-16 — Universal approval gate exceptions:** ✅ confirmed. Zero exceptions for outbound email. Class A reserved for internal-state writes only.
- **OQ-17 — Apollo cap:** ✅ Tue/Thu only, 30 candidates/run, 60 candidates/week max. Quality > volume. No scale-up until Phase 37 reply loop is proven AND API rate limits verified. Locked in §11.3.1.
- **OQ-18 — Vertical taxonomy completeness:** ✅ keep 18, mark `airline_amenity`, `military_exchange`, `co_pack_partner` as EXPERIMENTAL. `co_pack_partner` may move to ops/strategic-partnerships if no real product sales motion. Locked in §11.2.
- **OQ-19 — Touch cadence timing:** ✅ default Touch 1 day 0 / Touch 2 day 5–7 / Touch 3 day 14. Gateway/local: T2 day 3 / T3 day 7. Whale/T0: T2/T3 manual Ben decisions. Locked in §11.3.4.
- **OQ-20 — Whale Touch-1 class:** ✅ Class B `gmail.send`, Ben approval. T1 strategic = Class B. T2/T3 follow-ups remain Class B until enough measured history. No autonomous external sends yet. No Class C escalation by default unless pricing/money/vendor/exclusivity is in play. Locked in §11.3.4.
- **OQ-21 — HARO filter strictness:** ✅ strict allow-list (USA-made / dye-free / clean-label / founder-led CPG / America 250 / family business / food manufacturing / small business AI-operated / retail-gift-souvenir trends). Everything else ignored. No autonomous send. Locked in §11.3.7.
- **OQ-22 — Distributor-pyramid data source:** ✅ manual quarterly mapping + HubSpot relationship mapping. NO scraping pipeline until manual map proves useful. Locked in §11.3.8.
- **OQ-23 — Pitch-angle LLM cost cap:** ✅ deterministic vertical templates first. LLM generation only for T0 / T1 / approved daily batches / explicit Ben-approved special campaigns. NOT 6,200 calls/year by default. Locked in §11.3.3 + Phase 38.4.
- **OQ-24 — Operation Souvenir Shelf migration:** ✅ migrate the 17 Notion targets into HubSpot via Phase 38.3 backfill, marked `source = Operation Souvenir Shelf`, `cadence_state = not_started`, `approval_required = true`. Do not contact until Phase 37 is complete and cadence starts. Locked in §13 / Phase 38.3.

**REMAINING for Ben + Rene to answer before approval:**

1. **OQ-1 — Cron frequency:** is 5-min weekday-business-hours polling acceptable, or do you want Gmail Push (lower latency, more setup)?
2. **OQ-2 — Whale list:** is §3.1 the canonical list, or do you want to add/remove?
3. **OQ-3 — Quiet hours:** confirm 9 PM – 6 AM PT default for the approval-card surface?
4. **OQ-4 — OOO re-poke:** 14-day default re-poke window correct, or shorter/longer?
5. **OQ-5 — Class C vs Class D escalation for legal-language:** Class C (Ben + Rene) or Class D (human-only, attorney-loop)?
6. **OQ-6 — Phase ordering inside Phase 37:** does my recommended sequence match your priority?
7. **OQ-7 — Memory hygiene:** weekly "stale state" cleanup that prunes OOO records past return date + bounces older than 90 days, or keep forever?
8. **OQ-8 — LLM provider for classifier + edit-via-LLM:** Claude API only, or option to switch?
9. **OQ-9 — Notion integration for Rene's AP review surface:** HubSpot + Slack sufficient, or also Notion view?
10. **OQ-10 — Booke AI handoff format:** existing manual-upload flow Rene runs, or direct API integration if exposed?
11. **OQ-11 — Vendor-bill auto-attach to QBO via existing `/api/ops/qbo/attachment`:** use it, or wait for Rene's CoA mapping to fully canonicalize?
12. **OQ-12 — Spam-cleaner deletion semantics:** Trash (30-day recovery) or HARD delete? My read: Trash.
13. **OQ-13 — Edit-cycle limit:** 3 edit cycles per draft, or different?
14. **OQ-14 — Strategic Framework rendering:** top-of-card for whales/Class C/D, collapsed for routine — confirm or change?
15. **OQ-15 — Weekly audit recipient channel:** `#ops-approvals` only, or also `#financials`?

---

## 11. B2B Sales Research Sub-System (Viktor's strategies, productized)

**Doctrine added 2026-04-30 PM per Ben:** *"add the B2B sales research strategies that we have learned from Viktor."* Viktor has been the de facto research engine since 2026-04-09. Codifying his patterns into specialist agents so research runs continuously, not just when Viktor (or Ben) opens a research session.

### 11.1 The strategic doctrine that drives research

These are the strategic frames the research sub-system optimizes for. Every prospect we surface, every cadence we build, every angle we pitch must be classified into one of these.

| Doctrine | Source | What it means |
|---|---|---|
| **"Hunt the whales, build the routes behind"** | Ben 2026-04-26+ | Pursue Tier-0 whales (Buc-ee's, KeHE, McLane, Eastern National, Xanterra) for credentialing + cash-flow; in parallel build dense regional routes (3+ pallets per truck) so when a whale lands, the operating muscle is already there |
| **Gateway Communities channel** | `/contracts/gateway-communities-channel.md` | Visitor centers, NPS concessionaires, gift shops, lodges, military-exchange retail. Premium impulse + Americana shelf. Different math than commodity grocery |
| **Operation Souvenir Shelf** (March 2026 channel pivot) | `MEMORY.md` | Airports, museums, parks, military exchanges. $3.00–$3.49 wholesale at 48–55% retail margin. 17 active targets in Notion CRM |
| **Premium-impulse positioning** | `/contracts/wholesale-pricing.md` v2.4 + Buc-ee's analysis 4/30 | NEVER compete on $/oz vs Albanese commodity bulk. Strip-clip register fixture, $4.99–$5.99 retail, single-bag impulse. Different shelf, different math |
| **Regulatory tailwind framing** | Buc-ee's proposal 4/30 | TX SB 25 (eff. Jan 2027) + CA AB 2316 + CA AB 418 — every cold-intro to TX/CA-exposed retailers leverages this |
| **Distributor-pyramid play** | Inderbitzin/Glacier ($2.10) + sell-sheet ($2.49) | One distributor commit unlocks a region of accounts. Quote distributor delivered, not retail FOB |
| **Multi-channel route compounding** | Ben's "every dollar must work" | A single Utah trip funds Thanksgiving Point + Sweets & Snacks booth setup + sales calls along the I-15 corridor. Truck routes are revenue events, not cost events |
| **Sample-as-credential** | Eastern National play | A sample to one Tier-0 venue (Statue of Liberty, Yellowstone, Grand Canyon) is worth more than 100 sample bags shipped to mid-tier prospects. Allocate accordingly |

### 11.2 Vertical-targeting framework + Cashflow + Strategic frames (typed structs)

Every prospect researched by Viktor / `apollo-prospector` capability gets THREE composing frames before any outreach is drafted: `ProspectFrame` (vertical-strategic), `CashflowFrame` (speed-to-cash priority — added 2026-04-30 PM per Ben), and `StrategicFrame` (per-exchange play — already in §2.5b).

**ProspectFrame (vertical + opportunity context):**

```typescript
type ProspectVertical =
  | "nps_concessionaire"        // Eastern National, Xanterra, Forever Resorts
  | "nps_friends_org"           // Glacier NP Conservancy, Yellowstone Forever, Yosemite Conservancy, Mount Rushmore Society
  | "gateway_community_retail"  // visitor center gift shops, lodge retail, gateway-town main street
  | "museum_gift_shop"          // standalone museum retail (Smithsonian, Field Museum, MOMA)
  | "souvenir_destination"      // Christmas Mouse, Bronner's, theme-aware gift retail
  | "convenience_premium"       // Buc-ee's, Sheetz, Wawa (premium impulse, NOT commodity c-store)
  | "specialty_grocer"          // Jungle Jim's, HEB, Wegmans, Erewhon
  | "distributor_regional"      // Inderbitzin, Glacier Distributing
  | "distributor_national"      // KeHE, McLane, Core-Mark, UNFI, Dot Foods
  | "wholesale_marketplace"     // Faire, Mr. Checkout
  | "trade_show_lead"           // Reunion, Sweets & Snacks, Northwest Food Show booth-floor leads
  | "co_pack_partner"           // EXPERIMENTAL — King Henry's, Powers, Albanese; this is a strategic-partnership lane, not a sales-prospect lane. Move to ops/strategic-partnerships if no real product sales motion exists.
  | "press_outlet"              // HARO, Substack, podcast outreach
  | "marketplace_listing"       // RangeMe, MadeInUSA.com, Alibaba (declined)
  | "airline_amenity"           // EXPERIMENTAL — Avolta, Hudson, Paradies Lagardère (airport concession)
  | "military_exchange"         // EXPERIMENTAL — AAFES, NEX, MCX, CGX
  | "rangeme_campaign"          // limited-time RangeMe sourcing campaigns
  | "research_agent_inbound";   // direct-from-website wholesale inquiry forms

interface ProspectFrame {
  vertical: ProspectVertical;
  experimental?: boolean;  // TRUE for co_pack_partner / airline_amenity / military_exchange — needs validation pass before scale
  angle: string;            // Why this prospect specifically — not a generic angle.
  targetTitle: string[];    // The buyer title we want. Researched per-org.
  tier: "T0" | "T1" | "T2" | "T3";
  opportunityUsd: { lowGp: number; highGp: number }; // Annual GP if landed at projected volume
  doctrineMatch: string[];  // Strategic doctrine match (§11.1)
  /** Regulatory hook for INTERNAL positioning ONLY. NEVER auto-render in customer-facing copy.
   *  Customer-facing regulatory framing requires Approved Claims List inclusion (Class B `approved-claims.add`)
   *  + counsel review (`claim.counsel-review.request`). See §11.3.x regulatory guardrail. */
  regulatoryHook: string | null;
  competitiveShelf: string; // What's already on shelf, why we beat it (internal note only)
  sampleAsCredential: boolean; // TRUE if this is a credentialing-class send
}
```

**CashflowFrame (speed-to-cash + risk — Ben's addition 2026-04-30 PM):**

The existing `ProspectFrame` is strategic. The `CashflowFrame` is operational — it ranks prospects by speed-to-cash and inventory movement so the daily brief can prioritize bags that ship this week vs strategic credentialing plays that may take months to convert.

```typescript
interface CashflowFrame {
  expectedOrderDays: number;            // Days from now to first PO landing (estimate)
  expectedFirstOrderBags: number;       // Bag count of likely first PO
  expectedGrossRevenue: number;         // First-PO revenue at the projected tier
  expectedGrossProfit: number;          // First-PO GP at locked $1.79 COGS + tier price
  cashSpeed: "today" | "this_week" | "this_month" | "strategic";
  paymentRisk: "low" | "medium" | "high"; // AR exposure / Net-30 reliability / new vs known buyer
  reorderLikelihood: "low" | "medium" | "high"; // Based on vertical + competitive shelf + buyer signal
}
```

**Doctrine:** every cold-outreach draft AND every reply specialist's draft (when the reply involves pricing, quote, or commitment) consumes ALL THREE frames: `ProspectFrame` + `CashflowFrame` + `StrategicFrame`. The `StrategicFrame.play` field composes from `ProspectFrame.vertical + tier` AND `CashflowFrame.cashSpeed`. **The CashflowFrame.cashSpeed is what decides daily priority in the morning brief** — strategic credentialing plays (cashSpeed = "strategic") never block cashflow plays (cashSpeed = "today"/"this_week"). *No drafts without all three frames present.*

### 11.3 Research / outbound capabilities (NOT new agents)

Eight **capabilities** sit on the research / outreach side. All are read-only against external APIs; the only "write" is to HubSpot CRM (via the already-registered Class A `lead.enrichment.write` slug) and the outreach queue (which still requires §2.5 universal approval before any send).

**These are NOT runtime agents.** They are workflow lanes within Viktor (sales drafting), Research Librarian (cross-stream synthesis), and operator-driven flows (Apollo enrichment sweep, RangeMe / HARO scanners). To graduate any one of these to a true runtime agent it MUST clear all 7 §15 gates: queue source, cadence, budget, approval boundary, tests, dashboard surface, measurable cashflow output. Until then they are *capabilities* that can be activated as a workflow inside an existing runtime.

#### 11.3.1 `apollo-prospector` capability

**Role:** Source of new prospects. Pulls from Apollo's API by vertical + geography + employee-count + title filter. Per-vertical filter rules:
- `nps_friends_org`: nonprofit, 10–50 employees, "executive director" / "retail director" / "merchandising" titles
- `gateway_community_retail`: small business, "owner" / "buyer" / "general manager"
- `convenience_premium`: chain headquarters, "category buyer — candy" / "snack manager"

**Initial cap (Ben's lock 2026-04-30 PM, answers OQ-17):**
- Tue/Thu only (matches Viktor's historical research-drop rhythm).
- **Maximum 30 candidates per run, 60 candidates per week.**
- Quality > volume. No scale-up until inbound reply loop (Phase 37) is proven AND Apollo API tier/rate limits are verified against the cap.
- Apollo enrichment writes are Class A `lead.enrichment.write` (already in taxonomy v1.6) — no new slug.

Each candidate gets a `ProspectFrame` populated from Apollo + web scrape, AND a `CashflowFrame` populated from vertical + tier defaults. NEVER sends. The downstream cadence sequencer (§11.3.4) decides if/when to outreach.

#### 11.3.2 `vertical-classifier`

**Role:** For every prospect (from `apollo-prospector` OR inbound web form), assign the canonical `ProspectVertical` from §11.2. Deterministic rules first (whale-domain, NPS-friends-org name pattern, RangeMe campaign URL), LLM classifier second.

**Output:** updates `prospect:queue:<id>` with `vertical` + `tier` + `doctrineMatch[]`.

#### 11.3.3 `pitch-angle-builder`

**Role:** For each prospect, build a vertical-specific opening angle. Consumes:
- The `ProspectFrame` from §11.3.2
- The competitive-shelf intel (Albanese / Trolli / Haribo presence at the prospect's stores — scraped from public RangeMe / GoogleMaps / their own website)
- The regulatory hook (if state-applicable)
- The doctrine match (gateway-community? souvenir-shelf? distributor-pyramid?)

**Output:** a 2–4-sentence opening hook tailored to the prospect, NOT a copy-paste from the canonical T1 cold-intro template. The opening hook + the canonical follow-on body = the full draft.

**Hard rule:** the angle NEVER mentions internal-only fields (route doctrine, COGS, custom-quote formula). Pulls from §2.5c absolute-block phrases as redaction guard.

#### 11.3.4 `cadence-sequencer` capability

**Role:** Owns the multi-touch outreach cadence per prospect. Reads HubSpot deal stage + last-engagement-date and uses the Class B `gmail.send` slug (already registered) to request approvals. Cadence defaults answer OQ-19 + OQ-20.

**Default cadence (Ben's lock 2026-04-30 PM):**
- **Touch 1:** day 0 — fires when prospect is in `Lead` stage with no prior engagement. **Class B `gmail.send`, Ben approval.**
- **Touch 2:** day 5–7 (7d default) — Class B `gmail.send`, Ben approval. Tighter, references prior touch.
- **Touch 3:** day 14 — Class B `gmail.send`, Ben approval. Final-window framing.
- **No Touch 4** — after Touch 3 silence + 30 more days, prospect auto-flips to `UNQUALIFIED — no response` via Class A `lead.enrichment.write`.

**Vertical-specific cadence overrides:**
- **Gateway community / local retail (`gateway_community_retail`, `souvenir_destination`, in-region museum/NPS):**
  - Touch 2: day 3
  - Touch 3: day 7
- **Whale / T0 (Buc-ee's, KeHE, McLane, Eastern National, Walmart, HEB, Costco, Aramark, Compass, Delaware North, Xanterra, SSA Group):**
  - Touch 1: **Class B `gmail.send`, Ben approval** — uses canonical T1 cold-intro template, agent-drafted is fine for Touch 1.
  - **Touch 2 + Touch 3: manual Ben decisions only.** No autonomous drafter for whale follow-ups. Each becomes a HOLD card requiring Ben to hand-craft. Whale T0 never escalates to Class C by default unless pricing/money/vendor/exclusivity is in play.
- **Trade-show lead:** compressed cadence (Touch 1 within 24h of show, Touch 2 within 7 days, Touch 3 within 14 days), all Class B.
- **Sample-as-credential prospect:** Touch 1 framing = "we'd like to send a sample case to credential" — NOT "wholesale opportunity."

**Feedback loop:** if any Touch generates a classified inbound reply, cadence pauses; inbound triage capability set (§§1–10) takes over.

**No Class C / Class D escalation by default.** Per Ben's lock answering OQ-20: T0/T1 strategic Touch-1 stays Class B `gmail.send` Ben-approval. Class C only triggers when the draft includes pricing, vendor commitment, money movement, or unusual risk (matches existing approval taxonomy v1.6 Class C `pricing.change` triggers). No autonomous external sends yet — Phase 37 must prove the inbound reply loop first.

#### 11.3.5 `trade-show-scanner`

**Role:** Continuously monitor public trade-show booth-registration lists, exhibitor directories, post-show sponsor lists. For each event we attended (Reunion 2026, Northwest Food Show, etc.) OR are considering, pulls the buyer-attendance list and cross-references against existing HubSpot contacts.

**Output:** new prospects flow into `apollo-prospector` for enrichment; existing contacts get a tag `event:<name>` for cadence lookup. Pre-show outreach campaigns ("see you at Sweets & Snacks") fire as a separate cadence type.

**Doctrine:** trade-show leads compound — Ben at Sweets & Snacks May 19-21 + a known buyer attending = an 8x conversion rate vs cold. Worth tracking.

#### 11.3.6 `rangeme-campaign-scanner` capability

**Role:** Watch RangeMe's weekly campaign emails (`campaigns@rangeme.com`) for limited-time submission opportunities. Filter for **candy / impulse / specialty foods / Made-in-USA** category matches. Skip RTD beverages, snacks, non-confection categories.

**Required structured output (Ben's lock 2026-04-30 PM):** every flagged campaign produces a structured card with:

- Opportunity summary (1-2 sentences, the buyer + product fit)
- Fit score (0–100, weighted by vertical match × deadline urgency × buyer tier)
- Required category / buyer (verbatim from the RangeMe campaign brief)
- Required assets (sell sheet / COA / nutritional panel / case-pack info / etc.)
- Application deadline (date + countdown)
- **Submit / Skip recommendation with justification**

**Approval boundary:** *No submissions without approval.* The card surfaces in `#ops-approvals` for Ben one-tap approval. On approve, hands off to operator (Claude in Chrome) via `/contracts/portal-submission-backlog.md`. Class B `gmail.send` is NOT used here — RangeMe submissions are portal-form-fills, not emails.

**Memory:** maintains a "RangeMe campaigns we've submitted to" log via Class A `open-brain.capture` (already in taxonomy v1.6) to prevent double-submission + measure conversion rate.

#### 11.3.7 `haro-press-scanner` capability

**Role:** Watch HARO emails (`haro@helpareporter.com`) for journalist queries we can answer.

**Strict allow-list filter (Ben's lock 2026-04-30 PM, answers OQ-21):** ONLY surface opportunities matching these themes:

- USA-made
- dye-free / clean-label candy
- founder-led CPG
- America 250 / patriotic retail
- family business
- food manufacturing
- small business / AI-operated business
- retail / gift / souvenir trends

**Everything else is ignored.** No category drift.

**Output:** drafts a 2-paragraph answer + Ben quote for matching queries. **NEVER autonomous send.** Posts to `#ops-approvals` for Ben one-tap approval (Class B `gmail.send` if HARO route is via email; Class B equivalent if HARO uses their portal). Logs PR-source via Class A `open-brain.capture` if a published article hits. Memory feeds into `MEMORY.md` for backlinks + "as featured in" claims on the website.

**Compliance interplay:** any quote drafted here that makes a regulatory / health / nutritional / safety claim MUST pass through the existing Compliance Specialist (S-14) Approved Claims gate (`approved-claims.add` Class B + `claim.counsel-review.request` Class B) BEFORE it can leave the system. No claim leaves the system that hasn't been registered in the Approved Claims List.

#### 11.3.8 `distributor-pyramid-mapper` capability

**Role:** Maintains a structural map of the distributor → retailer relationships in our active markets. When we land a new distributor commit (Inderbitzin / Glacier / future), surfaces the downstream retail network so Ben can prioritize the highest-leverage retail asks.

**Data source (Ben's lock 2026-04-30 PM, answers OQ-22):**
- **Start with manual quarterly mapping** + HubSpot relationship mapping (HubSpot company associations are the canonical source).
- **Do NOT build a scraping pipeline** (LinkedIn, trade-pub web scrape) until the manual map proves useful. Scraping pipelines accumulate compliance + maintenance debt that has not earned its place yet.
- Quarterly cadence: Ben + Viktor sit down once per quarter, review every active distributor, and update the map manually in HubSpot via Class A `internal.note` + `lead.enrichment.write`.

**Example:** Inderbitzin commit → 200+ WA gift-shop network → cross-reference with Apollo for buyer titles at top 30 → queue cold-intro cadence with "your Inderbitzin rep can deliver this on standard freight" as the angle.

**Output:** weekly map update to `#ops-approvals` (read from HubSpot, no scrape) + delta-report ("12 new retail prospects unlocked by Inderbitzin's last 6 stops"). Class A `slack.post.audit` (already in taxonomy).

### 11.4 How research sub-system integrates with inbound triage

The two sub-systems are NOT separate — they're a closed loop:

```
[apollo-prospector + vertical-classifier]
        ↓ enriched prospect
[pitch-angle-builder]
        ↓ tailored draft
[cadence-sequencer Touch 1]
        ↓ approval card
[Slack §2.5a Approve]
        ↓ send via send-and-log
[Inbox Scanner §2.1]   ← (reply arrives)
        ↓ classified
[Specialist agent §2.3] ← routes by category
        ↓ drafts reply with §2.5b Strategic Framework
[Slack §2.5a Approve]
        ↓ deal advances in HubSpot
[cadence-sequencer pauses for this prospect]
        ↓ if Sample Shipped → Sample Shipper §2.3
        ↓ if Pricing Pushback → Whale Escalator §2.3
        ↓ if Polite No → mark UNQUALIFIED, cadence terminates
        ↓ if Quoted → wholesale-onboarding flow Phase 35.f takes over
        ↓ if Closed Won → reorder-follow-up Phase D4 takes over
        ↓ if no reply at all → cadence-sequencer schedules Touch 2
[Weekly Audit §2.10]  ← catches anything that fell through
```

Every transition is auditable; every send goes through §2.5 universal approval; every prospect has a traceable `ProspectFrame` AND `StrategicFrame` that the human sees on the approval card.

### 11.5 Cashflow Scoreboard doctrine (Ben's lock 2026-04-30 PM)

**Every outbound, research, and inbound workflow must ultimately report against a single scoreboard.** The scoreboard is the unifying metric — strategic credentialing plays serve cashflow, they don't replace it.

**Per-row scoreboard fields (the system writes these to HubSpot for every active prospect / deal):**

| Field | Source | Required |
|---|---|---|
| Bags expected | `CashflowFrame.expectedFirstOrderBags` | Yes |
| Cash expected | `CashflowFrame.expectedGrossRevenue` | Yes |
| Gross profit expected | `CashflowFrame.expectedGrossProfit` | Yes |
| Buyer / account | HubSpot `Company` + `Contact` | Yes |
| Next action | HubSpot `Next Action` field | Yes |
| Due date | HubSpot `Due Date` field | Yes |
| Approval required? | Y/N + slug if Y | Yes |
| Current status | HubSpot deal stage | Yes |

These are wholly readable by the existing Executive Brief (S-23) + B2B Revenue Watcher (`agent-heartbeat.md` §11). No new metric infrastructure — the scoreboard is just a view.

### 11.6 HubSpot hard gate (cross-reference)

Ben's lock 2026-04-30 PM — *"If it is not reflected in HubSpot with owner, next action, due date, cadence state, and source, it is not live."*

**Schema status (updated 2026-04-30 PM):** ✅ **The 9 missing custom properties + 2 property groups were created via API** per Ben's directive (Path B from `/contracts/email-agents-hubspot-property-spec.md` v0.3). Properties live in HubSpot under the `usagummies_email_system` property group on both Contacts and Deals. §11.6 hard-gate is now writable. Phase 38.3 backfill is unblocked from the schema side; remaining gates are the 15 OQs in §9 + Phase 37 build-sequence completion.

Required HubSpot fields per active prospect / deal (now all available — 5 standard + 9 custom):

- Company
- Contact
- Vertical (HubSpot custom property — already exists as part of Apollo enrichment)
- Tier (HubSpot custom property — T0/T1/T2/T3)
- Source (HubSpot lifecycle stage source field)
- Next Action (HubSpot custom field; must be populated)
- Owner (Ben — standard HubSpot owner field; never Drew)
- Due Date (HubSpot custom field)
- Cadence State (HubSpot custom property: not_started / touch_1_sent / touch_2_due / touch_3_due / paused / closed)
- Last Touch (HubSpot last-engagement-date)
- Strategic Frame (HubSpot custom note)
- Prospect Frame (HubSpot custom note)
- Cashflow Frame (HubSpot custom note)
- Approval State (HubSpot custom field tied to active approval slug + id)

**Doctrine:** any prospect missing any of these fields is invisible to the cadence sequencer + drafters. The HubSpot Verification Agent §2.9 is the gatekeeper — it refuses to surface a prospect for outreach until HubSpot is complete. This is the Ben-2026-04-30 lock and the v0.4 simplification: HubSpot does the source-of-truth work; the email system reads from it.

### 11.7 Daily-brief integration — cashflow-first surface

The morning brief already surfaces several research-related slices (per `daily-brief.ts`): `staleBuyers` (Phase D1), `sampleQueue` (D2), `onboardingBlockers` (D3), `reorderFollowUps` (D4), `enrichmentOpportunities` (D5), `vendorMargin` (Phase 36.3), `offGridQuotes` (Phase 36.6).

**Phase 38 brief surface — cashflow-first ordering (Ben's lock 2026-04-30 PM):**

The brief leads with cashflow, NOT with prospect-pipeline-depth. Order matters:

1. **Top cashflow actions today** — sorted by `CashflowFrame.cashSpeed` descending, with bag count + cash + GP each
2. **Expected bags moving this week** — sum across `cashSpeed: today/this_week`
3. **Expected cash collected this week** — sum across active invoices + first-PO commits
4. **Expected GP this week**
5. **Approvals blocking cash** — pending approvals on CashflowFrame≥this_week prospects, with click-to-approve
6. **Overdue buyer replies** — already exists as Phase D1 stale-buyer slice; filter to CashflowFrame ≥ this_month
7. **Sample / onboarding blockers** — Phase D2 + D3
8. **Reorder opportunities** — Phase D4
9. **Gateway-community prospects due today** — cadence-due Touch 2 / 3 in `gateway_community_retail` / `souvenir_destination`
10. **RangeMe / HARO / trade-show opportunities** — *only if actionable and within 7-day deadline*. Otherwise quiet-collapse.

**Quiet-collapse rule:** strategic credentialing plays (CashflowFrame.cashSpeed = "strategic") never appear above the line. They show in a "Strategic pipeline" footer when they have a real cadence event due.

---

## 12. Sub-system architecture summary (the full picture)

The complete email system has **5 coordinated sub-systems**, each with its own specialist agents but unified through:
- The `#ops-approvals` Slack channel as the single approval surface
- HubSpot as the single source of customer truth (§2.9)
- The canonical contract markdowns (`/contracts/*.md`) as the source of every doctrine + every form-field answer
- The Class A/B/C/D approval taxonomy as the universal gate

```
┌─────────────────────────────────────────────────────────────────────┐
│              SUB-SYSTEM 1 — Inbound Triage (§§1–10)                  │
│  inbox-scanner → classifier → 11 specialist agents → validator →    │
│  approval card → sender + logger                                    │
└─────────────────────────────────────────────────────────────────────┘
                                  ↕ (closed loop via HubSpot stage events)
┌─────────────────────────────────────────────────────────────────────┐
│       SUB-SYSTEM 2 — Outbound Research + Outreach (§11)             │
│  apollo-prospector → vertical-classifier → pitch-angle-builder →    │
│  cadence-sequencer → trade-show-scanner / rangeme-scanner /         │
│  haro-scanner / distributor-pyramid-mapper                          │
└─────────────────────────────────────────────────────────────────────┘
                                  ↕
┌─────────────────────────────────────────────────────────────────────┐
│     SUB-SYSTEM 3 — Financial / Receipt / AP Handling (§2.7)         │
│  vendor-bill-extractor → receipt-categorizer → ap-ar-reconciler →   │
│  statement-handler → QBO bill DRAFT → Rene Class C approval →       │
│  Booke AI cross-validation                                          │
└─────────────────────────────────────────────────────────────────────┘
                                  ↕
┌─────────────────────────────────────────────────────────────────────┐
│           SUB-SYSTEM 4 — HubSpot Verification (§2.9)                │
│  pre-send check → pre-classify enrich → daily reconciliation        │
│  (cross-cuts all four other sub-systems)                            │
└─────────────────────────────────────────────────────────────────────┘
                                  ↕
┌─────────────────────────────────────────────────────────────────────┐
│       SUB-SYSTEM 5 — Audit + Spam-Cleanup (§2.8 + §2.10)            │
│  spam-cleaner (daily) → weekly-auditor (Sunday 8 PM PT) →           │
│  drift detection → BLOCKED-phrase recall sample → coverage report   │
└─────────────────────────────────────────────────────────────────────┘
```

**Cross-cutting layers:**
- §2.4 Validator — runs at every draft → send boundary
- §2.5b Strategic Framework — runs before every drafter
- §2.5c Internal-info redaction guard — hard-blocks on leak phrases
- §2.5a Slack Interactive UI — universal approval surface
- §3 Strategic detection rules — whale class, pricing pushback, exclusivity, compliance fabrication, side-pitch guard

**Total: 5 subsystems composed of capabilities, NOT 26 new agents.**

The capability count (≈26) is preserved as a *workflow inventory*. Most capabilities map onto existing contract-backed runtimes (Viktor, Ops Agent, S-08, Finance Exception Agent, Booke, Compliance Specialist, Faire Specialist, Research Librarian, Drift Audit Runner, Platform Specialist, Executive Brief). New runtime agents are added **only** when a capability passes the §15 promotion gate.

**No additions to `AGENT_REGISTRY`, no new approval slugs, no new divisions** as a result of approving this proposal. The "agent count" in v0.3 was a category error; v0.4 corrects it.

---

## 13. Phase 38 — B2B Cashflow Research System (collapsed build units)

**Phase 37 must ship fully before Phase 38 starts. This is a HARD doctrine lock:**

> *Firing Touch 1's at scale without reply-handling equals Spottswood at scale.*

**Phase 38 is collapsed from 10 micro-agent builds to 8 build units.** Capabilities are bundled where they share queue/output; no build unit creates a new runtime agent. Each unit ships behind the §15 promotion gate.

| Phase | Build unit | Capabilities included | Effort | Dependencies |
|---|---|---|---|---|
| **38.1** | **Prospect Research Engine** | apollo-prospector + vertical-classifier + distributor-pyramid-mapper (manual quarterly) + Operation Souvenir Shelf backfill scaffolding | M | Phase 37 complete; Apollo API confirmed under cap |
| **38.2** | **ProspectFrame + CashflowFrame typed structs** | Frame schemas, validators, persistence to HubSpot custom-property notes via Class A `lead.enrichment.write` | S | 38.1 |
| **38.3** | **HubSpot Backfill — Operation Souvenir Shelf import** | Migrate the 17 Notion targets into HubSpot with required cadence_state=`not_started`, source=`Operation Souvenir Shelf`, vertical/tier populated, approval_required=true. **Do not contact until Phase 37 is complete and cadence starts.** | S | 38.2 |
| **38.4** | **Outreach Preparation Engine** | pitch-angle-builder + sample-as-credential logic + strategic-frame composition (composes §2.5b `StrategicFrame` from `ProspectFrame` + `CashflowFrame` deterministically before any LLM call) | M | 38.2, validator §2.4 + §2.5c, Approved Claims gate (S-14) |
| **38.5** | **Cadence Sequencer** | Touch 1/2/3 cadence engine with vertical-specific overrides; HubSpot stage-event integration; pause-on-reply | L | 38.4 + Phase 37 inbound triage closed-loop functional |
| **38.6** | **Opportunity Scanner Engine** | trade-show-scanner + rangeme-campaign-scanner + haro-press-scanner — all three share a "weekly external-signal" cadence + same HARO/RangeMe allow-list filters | M | 37.7 spam-cleaner; 38.4 (haro draft path uses pitch-angle infra) |
| **38.7** | **Daily Cashflow Brief Surface** | Cashflow-first morning-brief slices per §11.7; integrates with existing `daily-brief.ts` Phase D1–D5 + Phase 36.3/36.6 surfaces | S | 38.1–38.6 |
| **38.8** | **Tests + drift audit + heartbeat instrumentation** | Sample fixtures for every category A–AA + every vertical, drift audit detector for unauthorized regulatory-hook customer-facing copy, heartbeat metadata for any capability promoted to runtime per §15 | M | all 38.x above |

**Net Phase 38 = 8 build units (from v0.3's 10 micro-builds).** Total Phase 38 work shrinks because vertical-classifier was double-counted with apollo-prospector, daily-brief was a deliverable not a build, and the three opportunity scanners share infrastructure.

---

## 14. (RETIRED in v0.4) Open questions added in v0.3 — answered + migrated to §9

OQ-17 through OQ-24 originally lived here as DRAFT v0.3 questions. **All eight have been answered and locked into doctrine in v0.4 (§§11.2, 11.3.1, 11.3.3, 11.3.4, 11.3.7, 11.3.8, 13).** See §9 for the migrated answer block. This section is retained as a stub for change-history clarity.
---

## 15. "No new runtime agent unless justified" (the promotion gate)

**Rule (Ben's lock 2026-04-30 PM):** A *capability* described in this proposal can be promoted to a *runtime agent* (added to `AGENT_REGISTRY`, registered for cron, granted heartbeat metadata) **only after** it passes ALL SEVEN of these gates:

1. **Recurring volume** — there is enough work to justify a scheduled wake-up, not a once-a-quarter run.
2. **Queue source** — there is a defined queue (KV key, HubSpot view, Gmail filter, Slack channel event) the agent reads from on each heartbeat.
3. **Cadence** — cron / event / on-demand is decided, with documented frequency caps.
4. **Approval boundary** — every external-write action maps to an existing slug in `/contracts/approval-taxonomy.md`. No new slugs.
5. **Measurable cashflow or system-protection output** — the agent produces a cash-positive, cash-protective, or drift-detection result that is countable in the daily brief or weekly drift audit.
6. **Tests exist** — pure-helper tests + integration fixture for the heartbeat output state per `agent-heartbeat.md` §5.
7. **Dashboard surface** — the agent appears in `/ops/agents/packs` (read-only) and `/ops/agents/status` (live status) before it executes against production.

Until a capability passes all 7 gates, it remains a workflow inside an existing runtime (typically Viktor for sales-class, Ops Agent + S-08 for sample-class, Finance Exception Agent for receipt/bill-class, Compliance Specialist for regulatory-class). This honors `/contracts/agent-architecture-audit.md` §10 ("the few agents that are genuinely P0") and `/contracts/agent-heartbeat.md` §13 ("Do not introduce a new scheduler framework without approval").

**Initial Phase 37/38 capability promotions allowed with this proposal:** ZERO. All capabilities ship as workflows inside existing runtimes. Promotion to runtime agent happens later via separate per-capability proposals after the gates are met.

---

## 16. Doctrine-compatibility audit (against canonical contracts)

This proposal's compatibility against the load-bearing contracts. Audit performed 2026-04-30 PM, v0.4.

| Contract | Compatibility | Notes |
|---|---|---|
| `/CLAUDE.md` Execution Rules | ✅ aligned | No autonomous outbound; HubSpot is sales truth; QBO is finance truth; Drew owns nothing; orders→Ben Ashford |
| `/contracts/governance.md` | ✅ aligned | Single source of truth per domain preserved; every output cites source; no Class D bypass |
| `/contracts/agent-architecture-audit.md` | ✅ aligned (v0.4 fixed v0.3 violation) | v0.3's "26 agents" framing was a violation; v0.4 reframes to capabilities + §15 promotion gate |
| `/contracts/agent-heartbeat.md` | ✅ aligned | First proactive cash-flow lane = B2B Revenue Watcher §11; this proposal operationalizes its email surface, not replaces it |
| `/contracts/approval-taxonomy.md` v1.6 | ✅ aligned | Uses only existing slugs (`gmail.send`, `hubspot.deal.stage.move`, `shipment.create`, `qbo.bill.create`, `lead.enrichment.write`, `hubspot.task.create`, `draft.email`, `internal.note`, `open-brain.capture`, `slack.post.audit`, `approved-claims.add`, `claim.counsel-review.request`, `receipt.review.promote`, `vendor.master.create`); no new slugs |
| `/contracts/operating-memory.md` | ✅ aligned | Slack-first reporting; BCC-Rene rule preserved (handled by existing wholesale-onboarding-flow); drift detection via Slack corrections feeds the weekly audit |
| `/contracts/session-handoff.md` | ✅ aligned | All 9 immutable doctrinal hard rules preserved; print artifact rule, Viktor briefing rule, Rene-engagement priority rule unchanged |
| `/contracts/workflow-blueprint.md` | ✅ aligned | Phase 37 / Phase 38 numbering follows the 35.x → 36.x → 37.x → 38.x convention; no parallel-Phase number conflict |
| `/contracts/financial-mechanisms-blueprint.md` | ✅ aligned | Phase 36 (vendor margin / off-grid / escalation language) is reused; this proposal adds Phase 37 (inbound triage) + Phase 38 (research) into the same blueprint registry |
| `/ops/LIVE-RUNWAY-2026-04-25.md` | ✅ aligned | P0-1 through P0-7 are noted as preconditions; receipt-review packet flow + Class B `receipt.review.promote` reused as-is |
| `src/lib/ops/control-plane/taxonomy.ts` | ✅ aligned | No mutation; this proposal reads from the taxonomy, never writes to it |
| `src/lib/ops/agents-packs/registry.ts` | ✅ aligned | No new pack added; existing 6-pack model holds. Heartbeat metadata for any future-promoted capability would land here per §15 gate 7 |

**No prohibited mutations introduced by this proposal:**

- ❌ No additions to `AGENT_REGISTRY`
- ❌ No new approval slugs
- ❌ No new divisions
- ❌ No revival of the 70-agent registry
- ❌ No bypass of P0-1..P0-7 completion
- ❌ No Class A autonomous customer-facing send
- ❌ No QBO Chart of Accounts mutation
- ❌ No pricing / cart / bundle / inventory changes
- ❌ No assertion that Drew owns anything

---

## 17. What approval looks like

**Strategic approval status (as of v0.4):**

- ✅ Approved as DRAFT strategy input.
- ❌ NOT approved as canonical runtime design yet.
- 🔧 Requires resolution of OQ-1..OQ-15 (15 remaining open questions in §9) before promotion to canonical.
- 🔒 §15 promotion gate must be applied per capability — no automatic capability-to-runtime-agent promotion.

**Once you (Ben + Rene) resolve the remaining OQs and explicitly approve this as canonical:**

1. I move this doc from `email-agents-system-proposal.md` (DRAFT) → `/contracts/email-agents-system.md` (CANONICAL v1.0).
2. I add it to `/contracts/financial-mechanisms-blueprint.md` as **Phase 37** (inbound triage + financial-handling) and **Phase 38** (B2B Cashflow Research System). Phase numbering does NOT conflict with existing 35.x / 36.x.
3. I open **Phase 37.1 — Inbox Scanner** as the first build commit, only AFTER P0-1..P0-7 are confirmed complete (per `agent-heartbeat.md` §12 activation order).
4. Phase 38 starts ONLY after Phase 37 is complete (per §13 hard doctrine lock).
5. Each phase ships as its own commit + tests + Slack post in `#ops-approvals`.
6. Drift Audit Runner picks up the new capabilities in its weekly scan; any capability that fires Class A actions outside its registered lane is caught and reported.
7. Each subsystem gets a monthly review cadence — first Friday of each month, posted to `#ops-approvals`, surfacing per-subsystem stats (sends approved/denied/edited, prospects sourced, classifications by category, audit findings) so the email engine has a real KPI surface.

**Until you approve as canonical, no code is written.** This document is a strategy input, not a build authorization.

---

## Version history

- **v0.4.1 — 2026-04-30 PM (DRAFT, status update only)** — §11.6 schema status updated to ✅ EXECUTED. Per Ben's directive, the 9 missing HubSpot custom properties + 2 property groups were created via API (Path B from the companion spec). No doctrine change, no canonicalization shift, no new agents/slugs/divisions. This is a status note documenting the unblock; remaining gates (15 OQs + P37 build sequence) unchanged. See `/contracts/email-agents-hubspot-property-spec.md` v0.3 §7 for the per-property creation log.
- **v0.4 — 2026-04-30 PM (DRAFT, doctrine-alignment audit)** — Major restructure to align with `/contracts/agent-architecture-audit.md` + `/contracts/agent-heartbeat.md` + `/contracts/approval-taxonomy.md` v1.6: (a) §0a doctrine-alignment block — *"5 subsystems composed of capabilities, NOT 26 new agents"* framing; (b) HubSpot hard gate locked from prior implicit reference into explicit §11.6 rule; (c) all "specialist agents" renamed to "capabilities" — none register new runtime agents until §15 promotion gate is met; (d) Phase 38 collapsed from 10 micro-builds to 8 build units (38.1–38.8); (e) NEW `CashflowFrame` struct (§11.2) — peer to `ProspectFrame`, decides daily priority via `cashSpeed` axis; (f) NEW §11.5 Cashflow Scoreboard doctrine — bags / cash / GP / next action / due / approval / status as the unifying scoreboard fields written to HubSpot; (g) §11.7 daily-brief made cashflow-first per Ben's lock — strategic credentialing plays never block cashflow plays; (h) NEW §15 promotion gate ("no new runtime agent unless 7 conditions met"); (i) NEW §16 doctrine-compatibility audit; (j) §3.6 regulatory-hook guardrail (NEVER customer-facing without Approved Claims + counsel review); (k) HARO scanner strict allow-list locked; (l) RangeMe scanner produces structured submit/skip recommendation card, NEVER autonomous; (m) Distributor-pyramid set to manual quarterly + HubSpot, NO scraping pipeline; (n) Apollo cap: Tue/Thu only, 30/run, 60/week max; (o) Touch cadence locked: 0/5–7/14 default, 0/3/7 gateway, T0 manual T2/T3; (p) Whale Touch-1 = Class B `gmail.send` Ben approval, NOT Class C unless pricing/money/exclusivity in play; (q) pitch-angle LLM cost capped — deterministic templates first, LLM only for T0/T1/approved batches; (r) `co_pack_partner`, `airline_amenity`, `military_exchange` marked EXPERIMENTAL; (s) Operation Souvenir Shelf migration spec'd via Phase 38.3 backfill, do-not-contact-until-Phase-37-complete. OQ-17..OQ-24 all answered + retired. 15 remaining open questions documented in §9.
- **v0.3 — 2026-04-30 PM (DRAFT, Viktor research strategies + sub-system architecture)** — Major additions: (a) §11 B2B Sales Research Sub-System — 8 specialist research agents (apollo-prospector, vertical-classifier, pitch-angle-builder, cadence-sequencer, trade-show-scanner, rangeme-campaign-scanner, haro-press-scanner, distributor-pyramid-mapper); (b) §11.1 strategic-doctrine block (hunt-whales-build-routes, gateway-communities, Operation Souvenir Shelf, premium-impulse positioning, regulatory tailwind, distributor-pyramid, multi-channel route compounding, sample-as-credential); (c) §11.2 vertical-targeting framework with `ProspectVertical` + `ProspectFrame` typed structs (18 verticals); (d) §11.4 closed-loop integration with inbound triage; (e) §11.5 daily-brief surfaces for research; (f) §12 sub-system architecture summary — 5 coordinated sub-systems, 23 specialists + 3 cross-cutting; (g) §13 Phase 38 build phases (38.1–38.10) with inbound-before-outbound sequencing rationale; (h) §14 8 new open questions (Apollo rate limits, vertical taxonomy completeness, cadence timing, HARO filter strictness, Notion → HubSpot migration). Total open questions now 24.
- **v0.2 — 2026-04-30 PM (DRAFT, Ben's expansion)** — Major additions per Ben's feedback: HubSpot Verification Agent §2.9, Receipt/Invoice/AP Handler §2.7 (4 sub-agents + Booke AI), Spam Cleaner §2.8, Weekly Audit Agent §2.10, Universal Approval Gate §2.5, Slack Interactive UI §2.5a (Approve/Deny/Edit + edit-via-LLM), Strategic Framework §2.5b (8-question analysis), Internal-info redaction guard §2.5c. New categories W, X, Y, Z, AA. Phase count 37.1–37.16. Open questions doubled to 16.
- **v0.1 — 2026-04-30 PM (DRAFT)** — Initial proposal authored from full session 2026-04-30 history. 22 categories (A–V), 11 specialist agents, 10 build phases (37.1–37.10), 10 explicit guardrails, 13 incident-to-prevention mappings, 10 open questions for Ben + Rene.
