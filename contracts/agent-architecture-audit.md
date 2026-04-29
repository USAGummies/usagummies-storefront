# Agent Architecture Audit
**Status:** CANONICAL
**Source:** Ben directive 2026-04-27 — response to ChatGPT agent-pack proposal
**Version:** 1.0 — 2026-04-27

> Doctrine: Do not create new agents until we audit what exists. The 70-agent registry
> is real. The 21 contracts are real. Most "missing" capabilities are partials, not gaps.
> This audit names the 5–10 agents that are genuinely missing and the dozens that are
> already covered.

The trigger for this doc was a ChatGPT-generated "agent pack" proposal that recommended ~30 new agents. Before any of that is built, we owe ourselves a clear-eyed inventory. This audit is the deliverable. Section 10 lists the few agents that are genuinely P0. Section 11 lists the ones we are explicitly NOT building because the existing system already covers them.

---

## 1. Current doctrine summary

The agent stack is governed by six load-bearing contracts in this repo. Every behavioral rule below comes from one of them.

### 1.1 The non-negotiable locks

From [`/contracts/governance.md`](governance.md) §1 + [`/contracts/hard-rules.md`](hard-rules.md):

1. **Single source of truth per domain.** No domain has two systems of record.
2. **Every output carries source, timestamp, confidence.** "I don't have that data" is acceptable; a guess is never acceptable.
3. **Every autonomous write is logged to `#ops-audit`** with destination, entity id, actor, before/after, run_id.
4. **Financial / customer-facing / shipping / money-moving actions require explicit per-instance human approval** until the agent has graduated.
5. **Every agent has exactly one job.** No generalists. Bounded scope, specific tools, specific measurable output.
6. **Connector failure forces degraded-mode disclosure, not invented certainty.**
7. **Secrets never live in Notion, Slack, or plaintext repo files.** Managed stores only.
8. **Slack is the human command/approval/audit surface. Not the database.**
9. **No feature flags or "just this once" exceptions.** Rules are revised in writing, not bypassed.
10. **Weekly drift audit is mandatory.** Reasoning quality is measured.

### 1.2 The six-layer operating stack (governance.md §2)

| Layer | Role | Implementation |
|---|---|---|
| L1 — Source Systems | Transactional truth | Shopify, Amazon SP-API, HubSpot, QBO, Plaid, ShipStation, Gmail, GA4, Faire |
| L2 — Capture & Routing | Deterministic event bus | Make.com (~20 scenarios), webhooks, QStash |
| L3 — Domain Memory | Persistent semantic memory | Open Brain (Supabase pgvector) |
| L4 — Specialist Agents | Bounded LLM agents, one job each | Viktor, Booke, Finance, Ops, Research, etc. |
| L5 — Control Plane | Policy + approval state machine + audit log | `src/lib/ops/control-plane/` |
| L6 — Human Surface | Slack command/approval/audit | `#ops-daily`, `#ops-approvals`, `#ops-audit`, `#ops-alerts`, division channels |

### 1.3 Approval taxonomy (taxonomy.md)

- **Class A — Autonomous.** Observe / Prepare. No approval gate.
- **Class B — Single approval.** Ben for sales/commercial + ops; Rene for finance.
- **Class C — Dual approval.** Ben + Rene for money + supply commitments.
- **Class D — Red-Line / prohibited.** Never autonomous. Agents must refuse and escalate.

Fail-closed on unknown action slugs. Code mirror at `src/lib/ops/control-plane/taxonomy.ts`.

### 1.4 Operating-memory doctrine (operating-memory.md)

Slack is the running tally board for the company. Reports go to Slack first; email may follow. Corrections in Slack threads are inputs to the next iteration cycle. Transcripts saved within 24h of any substantive call. No silent action — every autonomous write produces both an audit envelope AND a Slack notification.

The new BCC-Rene rule (locked 2026-04-28): every email to a new wholesale customer carries `BCC: rene@usagummies.com` until the customer is fully onboarded. Wired in `src/lib/wholesale/onboarding-dispatch-prod.ts`.

### 1.5 Slack operating doctrine (slack-operating.md)

9 active channels day-one (`#ops-daily`, `#ops-approvals`, `#ops-audit`, `#ops-alerts`, `#sales`, `#finance`, `#operations`, `#shipping`, `#research`, `#receipts-capture`). 5 latent. Severity tiers (info / action / warning / critical) drive routing. One live object → one thread. Every autonomous write gets a one-line `#ops-audit` mirror with `{run_id, agent, division, action, entity_ref, approval_id?, source_citations, confidence}`.

### 1.6 Viktor canonical contract (viktor.md v3.1)

Sales-division Slack-native agent. Read scope wide; write scope gated per approval class. Class B `gmail.send` requires per-send Ben approval. Hard rules: thread-history check before send, 48h dedup gate, HOLD means HOLD, HubSpot is source of truth, never tell Drew to ship. W-7 captures Rene's finance decisions; W-8 answers Rene's free-form system-state questions.

### 1.7 Drew owns nothing (approval-taxonomy.md v1.4, 2026-04-27)

Drew is not an approver. All approval slugs that previously named Drew (`qbo.po.draft`, `inventory.commit`, `run.plan.commit`, `inventory.adjustment.large`) have been reassigned to Ben (Class B) or Ben+Rene (Class C). Drew remains a fulfillment node for samples + East Coast destinations per `CLAUDE.md`, but does not own any approval lane.

---

## 2. Existing division model

From [`/contracts/divisions.json`](divisions.json) (mirror at `src/lib/ops/control-plane/divisions.ts`).

**Divisions are not agents.** Divisions are organizational units that agents serve. Multiple agents per division is expected. The 6-active / 6-latent split is intentional — latent divisions only activate when their measurable trigger fires (see `activation-triggers.md`).

### 2.1 Active divisions (6)

| ID | Name | Owner | Channels | Primary AI layer | What it does today |
|---|---|---|---|---|---|
| `executive-control` | Executive Control & Governance | Ben | `#ops-daily`, `#ops-approvals`, `#ops-audit`, `#ops-alerts` | Control plane + audit | Decisions, approvals, audit trail, drift detection |
| `sales` | Sales (B2B + DTC + Amazon) | Ben | `#sales` | Viktor + revenue support | Outreach drafts, HubSpot hygiene, deal threads, Faire Direct |
| `financials` | Financials | Rene | `#finance`, `#receipts-capture` | Booke + finance-exception | AP/AR, reconciliation, exceptions, decision queue |
| `production-supply-chain` | Production & Supply Chain | Drew (vendors) / Ben (orders) | `#operations`, `#shipping` | Ops agent + S-08 dispatch | POs, vendors, samples, freight, inventory thresholds |
| `research-intelligence` | Research & Intelligence | Ben | `#research` | Research Librarian + R-1..R-7 | Cross-cutting synthesis from 7 research streams |
| `platform-data-automation` | Platform / Data / Automation | Ben | `#ops-alerts`, `#ops-audit` | Claude Code + control plane | Substrate health, integrations, secrets, drift prevention |

### 2.2 Latent divisions (6) — do not activate without trigger

| ID | Name | Activation trigger |
|---|---|---|
| `marketing-brand` | Marketing — Brand | First scheduled brand campaign OR > 1 post/week sustained 2 weeks |
| `marketing-paid` | Marketing — Paid | Monthly ad spend > $1,000 OR Triple Whale pixel installed |
| `trade-shows-field` | Trade Shows & Field | Booth booked for a specific show (pod fires for that show only) |
| `outreach-partnerships-press` | Outreach / Partnerships / Press | ≥ 5 inbound press/mo OR dedicated PR push launched |
| `customer-experience` | Customer Experience | DTC tickets > 20/mo sustained 2 weeks |
| `product-packaging-rd` | Product / Packaging / R&D | First new SKU or formulation decision started |

---

## 3. Existing agent registry summary

### 3a. The 70-agent code registry — RETIRED

The 70-agent `ENGINE_REGISTRY` referenced in old project memory is **already retired**. The file `src/lib/ops/engine-schedule.ts` is a deprecated stub:

> "@deprecated 2026-04-17 — was the entry point for the retired 70-agent Abra registry. Replaced by the USA Gummies 3.0 control plane."

Same for `src/lib/ops/engine-runner.ts` — both `runAgent()` and `runEngineAgent()` return `{ status: "disabled" }`. The 6-engine model (B2B Outbound, SEO, DTC, Supply Chain, Revenue Intelligence, Social) **does not exist as runtime code**. It existed only as a registry of intent, and its replacement is the contract-driven control plane below.

This is itself an important audit finding: anyone reasoning from "the 70-agent registry" is reasoning from a ghost. The replacement is fewer agents, each with a written contract.

### 3b. The live agent runtimes (per `activation-status.md`, 2026-04-21)

This is what is actually running today:

| Agent / Runtime | Contract | Cron / Trigger | Channel | Status |
|---|---|---|---|---|
| Executive Brief | [`agents/executive-brief.md`](agents/executive-brief.md) | Wkdy 08:00 PT + Tue-Sat 17:00 PT | `#ops-daily` | LIVE |
| Platform Health | governance.md §7 | Wkdy 07:00 PT | `#ops-audit` | LIVE |
| Drift Audit Runner | [`agents/drift-audit-runner.md`](agents/drift-audit-runner.md) | Sunday 20:00 PT | `#ops-audit` | LIVE |
| Viktor (Sales) | [`viktor.md`](viktor.md) | `@viktor` mentions + W-7 | `#sales`, `#finance` | LIVE |
| Viktor W-7 Rene Capture | [`agents/viktor-rene-capture.md`](agents/viktor-rene-capture.md) | Event (Slack) | `#finance` | LIVE |
| Finance Exception Agent | [`agents/finance-exception.md`](agents/finance-exception.md) | Wkdy 06:15 PT | `#finance` | LIVE |
| Ops Agent | [`agents/ops.md`](agents/ops.md) | Wkdy 09:00 PT | `#operations` | LIVE |
| Compliance Specialist | [`agents/compliance-specialist.md`](agents/compliance-specialist.md) | Wkdy 11:00 PT | `#operations` (degraded `#ops-audit`) | LIVE — fallback mode |
| Faire Specialist | [`agents/faire-specialist.md`](agents/faire-specialist.md) | Thursday 11:00 PT | `#finance` + `#sales` | LIVE — degraded (no FAIRE_ACCESS_TOKEN) |
| Research Librarian | [`agents/research-librarian.md`](agents/research-librarian.md) | Friday 11:00 PT | `#research` | LIVE |
| Booke queue feed | [`agents/booke.md`](agents/booke.md) | Event | Feeds Finance Exception | LIVE — degraded (no BOOKE_API_TOKEN) |
| Reconciliation Specialist | [`agents/reconciliation-specialist.md`](agents/reconciliation-specialist.md) | Thursday 10:00 PT | `#finance` | LIVE (cron live; runtime is subset of Finance Exception) |
| Amazon Settlement | (no contract — derives from reconciliation) | Thursday 10:30 PT | `#finance` | LIVE |
| Sample/Order Dispatch (S-08) | [`agents/sample-order-dispatch.md`](agents/sample-order-dispatch.md) | Event (Shopify/HubSpot/Amazon FBM webhooks) | `#ops-approvals` | LIVE |
| Inventory Specialist (S-07 MVP) | [`agents/inventory-specialist.md`](agents/inventory-specialist.md) | On-demand | (subset of Ops Agent today) | LIVE — folded into Ops Agent |
| Shipping Hub + ShipStation | (derived from S-08) | Always-on session + Wkdy 09:00 PT wallet check | `/ops/fulfillment` UI + `#operations` | LIVE |
| Fulfillment drift audit | — | Monday 20:30 PT | `#ops-audit` | LIVE |
| CF-09 freight-comp queue | distributor-pricing-commitments.md §5 | Event on every buy-label | Finance Exception digest | LIVE |
| Amazon FBM unshipped alerts | — | Wkdy 09:00 / 13:00 / 16:00 PT | `#operations` | LIVE |
| Amazon FBM dispatch bridge | — | On-demand | `#ops-approvals` | LIVE |
| Inventory cover-day forecast | `src/lib/ops/inventory-forecast.ts` | On-demand | API + UI | LIVE |
| Agent Status UI | — | Polled every 60s | `/ops/agents/status` | LIVE — 12 agents tracked |
| Rene's Ledger UI | — | Polled every 60s | `/ops/ledger` | LIVE |
| Interviewer | [`agents/interviewer.md`](agents/interviewer.md) | Pre-build (operator-invoked) | N/A — produces questions | LIVE (doctrine, not runtime) |

### 3c. The 21 agent contracts — one-line summaries

Mapped against the inventory above. Most contracts have a runtime; some are deliberate Phase 2.

| Contract | Division | Owner | What it does | Runtime status |
|---|---|---|---|---|
| `viktor.md` | sales | Ben | Slack Q&A, HubSpot hygiene, outreach drafts, finance Q&A for Rene | LIVE |
| `agents/booke.md` | financials | Rene | Auto-categorize bank transactions in QBO; flag anomalies | LIVE — degraded |
| `agents/finance-exception.md` | financials | Rene | Daily Rene digest; route exceptions to `#finance` | LIVE |
| `agents/reconciliation-specialist.md` (S-06) | financials | Rene | Daily/weekly reconciliation prep (Plaid↔QBO, Amazon, Shopify, Faire payouts) | LIVE (subset of Finance Exception) |
| `agents/ops.md` | production-supply-chain | Ben | Open POs, vendor threads, sample/shipment commitments, blockers | LIVE |
| `agents/sample-order-dispatch.md` (S-08) | production-supply-chain | Ben/Drew | Enforces Ashford-WA-for-orders / East-Coast-for-samples; classifies + composes Class B `shipment.create` | LIVE |
| `agents/inventory-specialist.md` (S-07) | production-supply-chain | Ben | Per-SKU cover-day scan; ATP gate; production-run proposal triggers | LIVE — folded into Ops |
| `agents/compliance-specialist.md` (S-14) | executive-control | Ben | Compliance calendar (COIs, W-9s, FDA FFR, USPTO §8/§9, WY filings); Approved Claims gate | LIVE — fallback mode |
| `agents/executive-brief.md` (S-23) | executive-control | Ben | Morning + EOD brief to `#ops-daily` from control-plane authoritative stores | LIVE |
| `agents/drift-audit-runner.md` (S-25) | executive-control | Ben | Weekly Sunday 8 PM scorecard; flags ≥ 2 violations → auto-pause | LIVE |
| `agents/platform-specialist.md` (S-24) | platform-data-automation | Ben | Daily connector smoke test; secret-rotation alerts | LIVE (extends platform health cron) |
| `agents/faire-specialist.md` (S-12) | sales | Ben | Faire Direct invite drives; weekly payout reconcile prep | LIVE — degraded |
| `agents/research-librarian.md` | research-intelligence | Ben | Weekly cross-stream synthesis; entity dedup | LIVE |
| `agents/r1-consumer.md` | research-intelligence | Ben | Consumer voice (weekly post `[R-1]`) | PENDING — note-capture infra live, individual LLM blocked on tool decision |
| `agents/r2-market.md` | research-intelligence | Ben | Category trend (weekly `[R-2]`) | PENDING — same |
| `agents/r3-competitive.md` | research-intelligence | Ben | Competitor moves (daily `[R-3]`, silent-unless-change) | PENDING — same |
| `agents/r4-channel.md` | research-intelligence | Ben | Channel/retailer opportunities (weekly `[R-4]`) | PENDING — same |
| `agents/r5-regulatory.md` | research-intelligence | Ben | FDA/state regulation (daily check, silent-unless-change `[R-5]`) | PENDING — same |
| `agents/r6-supply.md` | research-intelligence | Ben | Ingredient + packaging cost trends (weekly `[R-6]`) | PENDING — same |
| `agents/r7-press.md` | research-intelligence | Ben | Press/media targets (weekly `[R-7]`) | PENDING — same |
| `agents/viktor-rene-capture.md` | financials (extension to sales Viktor) | Ben | W-7 capture of Rene decision-queue replies | LIVE |
| `agents/interviewer.md` | meta | Ben | Pre-build spec disambiguation (3-5 questions) | LIVE (doctrine, operator-invoked) |

**Bottom line on §3:** the registry is contract-first, not code-first. 21 contracts. 13–15 of those are already running in some form. 7 are PENDING (the R-1..R-7 cohort, blocked on Ben's tool-stack decision). 0 are unwritten-but-running.

---

## 4. Proposed pack / read-model views

A "pack" is a read-model — a curated cross-cut of the agent registry for a specific audience or division. Packs do **not** add agents. They reorganize how existing agents are surfaced.

The point of packs: when Rene opens her dashboard, she should see one consolidated view of every agent that touches finance, not have to know the 21 contract filenames. Same for Drew on operations, Ben on the executive view, etc.

### Pack 1 — Executive Pack (Ben)

| Field | Value |
|---|---|
| Audience | Ben |
| Feeds from | Executive Brief, Drift Audit Runner, Platform Health, all approval queues, all `#ops-audit` writes |
| Surfaces | `#ops-daily`, `#ops-approvals`, `#ops-audit`, `#ops-alerts`, `/ops/agents/status` |
| Owner | Ben |
| One-line purpose | "What needs my attention today, what got approved, what's broken." |

### Pack 2 — Finance Pack (Rene)

| Field | Value |
|---|---|
| Audience | Rene |
| Feeds from | Booke, Finance Exception Agent, Reconciliation Specialist, Amazon Settlement, Compliance Specialist (COI/W-9 tax angle), Viktor W-7 capture, CF-09 freight-comp queue |
| Surfaces | `#finance`, `#receipts-capture`, `/ops/ledger`, `/ops/finance/review-packets`, `/ops/ap-packets` |
| Owner | Rene |
| One-line purpose | "AP/AR truth, exception queue, decision-queue back-pointer, money-moving approvals." |

### Pack 3 — Operations Pack (Drew + Ben split)

| Field | Value |
|---|---|
| Audience | Ben (orders) + Drew (samples + East Coast + vendor threads) |
| Feeds from | Ops Agent, Sample/Order Dispatch (S-08), Inventory Specialist (S-07), Shipping Hub, ShipStation wallet/void watcher, CF-09 freight-comp, Amazon FBM unshipped alert |
| Surfaces | `#operations`, `#shipping`, `/ops/fulfillment`, `/ops/shipping`, `/ops/amazon-fbm`, `/ops/vendors` |
| Owner | Ben (with Drew read-only on the samples + East Coast slice) |
| One-line purpose | "Every PO / vendor thread / sample / order / inventory threshold in one place." |

### Pack 4 — Sales Pack (Ben)

| Field | Value |
|---|---|
| Audience | Ben |
| Feeds from | Viktor, Faire Specialist, R-4 Channel research outputs, HubSpot deal-stage automation, Sample/Order Dispatch (sample-shipped events) |
| Surfaces | `#sales`, `/ops/pipeline`, `/ops/wholesale`, `/ops/faire-direct`, `/ops/sales` |
| Owner | Ben |
| One-line purpose | "Pipeline, outreach drafts pending approval, retailer onboarding, Faire Direct conversion." |

### Pack 5 — Research Pack (Ben)

| Field | Value |
|---|---|
| Audience | Ben |
| Feeds from | Research Librarian (synthesis) + R-1..R-7 specialists |
| Surfaces | `#research`, `/ops/auto-research`, `/ops/competitors` |
| Owner | Ben |
| One-line purpose | "Weekly synthesis + tagged daily/weekly findings across consumer, market, competitive, channel, regulatory, supply, press." |

### Pack 6 — Compliance Pack (Ben + counsel)

| Field | Value |
|---|---|
| Audience | Ben + Wyoming Attorneys (consulted only) |
| Feeds from | Compliance Specialist, R-5 Regulatory research, Approved Claims list, vendor COI store |
| Surfaces | `#operations` (regulatory items) + `#ops-audit` (fallback while `/Legal/Compliance Calendar` still pending in Notion) |
| Owner | Ben |
| One-line purpose | "Every dated obligation, every claim review, every COI/W-9 expiry — never miss." |

### Pack 7 — Platform Pack (Ben + Claude Code)

| Field | Value |
|---|---|
| Audience | Ben (escalation only) + Claude Code (working surface) |
| Feeds from | Platform Specialist, Drift Audit Runner, Fulfillment drift audit, audit envelope stream, secret-rotation calendar |
| Surfaces | `#ops-alerts`, `#ops-audit`, `/ops/agents/health`, `/ops/agents/status`, `/ops/stack-readiness`, `/ops/readiness` |
| Owner | Ben |
| One-line purpose | "Is the substrate honest? Connectors green? Secrets within rotation window? Drift score?" |

7 packs total. No new agents implied — these are read-models over the existing 21 contracts and ~25 live runtimes.

---

## 5. Mapping table: proposed capability → existing agent → gap

The ChatGPT pack proposed roughly 30 new agents. Below is each proposed capability mapped against what already exists. **Be honest** — most rows are "covered" or "partial." Only a handful are "missing."

| Proposed capability | Already covered by | Gap | Recommendation |
|---|---|---|---|
| Lead generation / cold outreach | Viktor W-2 (outbound drafting) + Faire Specialist + Apollo (external) | none | skip |
| Inbound reply triage | Viktor W-1 (inbound classification) | none | skip |
| Pipeline hygiene | Viktor W-3 + W-4 | none | skip |
| Deal stage automation | HubSpot `deal.propertyChange` webhook + S-08 dispatch HubSpot adapter | none | skip |
| Faire Direct conversion | Faire Specialist (S-12) | partial — degraded on `FAIRE_ACCESS_TOKEN` | extend existing (provision token) |
| Faire marketplace order intake | Faire Specialist + S-08 | partial — Faire adapter blocked on token | extend existing |
| Wholesale onboarding (NCS-001, AP packet) | `src/lib/wholesale/onboarding-dispatch-prod.ts` + `wholesale-onboarding-flow.md` + `/ops/wholesale/onboarding` | none | skip |
| BCC-Rene on new-customer first emails | `RENE_BCC_EMAIL` constant in onboarding-dispatch-prod.ts (locked 2026-04-28) | none | skip |
| Auto-categorize bank transactions | Booke (third-party) + Booke contract | partial — degraded on `BOOKE_API_TOKEN` | extend existing |
| AP/AR aging | `src/lib/ops/ap-ar-aging.ts` + Finance Exception digest | none | skip |
| Daily Rene digest | Finance Exception Agent | none | skip |
| Decision-queue capture (R.NN, J.NN, CF-NN) | Viktor W-7 capture | none | skip |
| Free-form Rene Q&A (system state) | Viktor W-8 + `viktor-rene-briefing.md` | none | skip |
| Receipt capture + OCR | `#receipts-capture` channel + receipt review packet flow + Class B `receipt.review.promote` | none | skip |
| Bill creation (`qbo.bill.create`) | Class B slug + Rene approves | partial — needs vendor-master pre-step | extend existing (vendor-master flow) |
| Weekly payout reconciliation | Reconciliation Specialist (S-06) + Amazon Settlement cron | none | skip |
| Vendor thread freshness | Ops Agent + `src/lib/ops/vendor-threads.ts` (Powers, Belmark, Inderbitzin, Albanese) | none | skip |
| Open PO tracking | Ops Agent | none | skip |
| Shopify on-hand inventory | Ops Agent daily + inventory snapshot KV | none | skip |
| ATP gate (no-oversell) | `src/lib/ops/atp-gate.ts` | none | skip |
| Cover-day forecast | Inventory Specialist (S-07 MVP) at `/api/ops/inventory/cover-days` | none | skip |
| Sample request → Drew dispatch | S-08 Sample/Order Dispatch | none | skip |
| Order request → Ben dispatch | S-08 Sample/Order Dispatch | none | skip |
| ShipStation label buy + tracking webhook | Shipping Hub | partial — webhook registration parked on MFA | extend existing |
| ShipStation wallet floor | wallet-check cron (BUILD #8) | none | skip |
| Stale void-refund watcher | wallet-check cron (BUILD #9) | none | skip |
| Delivered-pricing freight guard | `src/lib/ops/delivered-pricing-guard.ts` + Class C override | none | skip |
| CF-09 freight-comp auto-queue | freight-comp-queue route + Finance Exception drain | none | skip |
| Amazon FBM unshipped alerts | Amazon FBM unshipped-alert cron | none | skip |
| Amazon FBM dispatch | Amazon dispatch bridge → S-08 | none | skip |
| Amazon FBA restock check | `/api/ops/amazon/restock-check` | partial — read-only today | extend existing |
| Compliance calendar | Compliance Specialist (S-14) | partial — fallback doctrine list, awaits `/Legal/Compliance Calendar` Notion DB | extend existing (Notion DB) |
| Approved Claims gate (ad/content publish) | Compliance Specialist + Class B `approved-claims.add/retire` + Class D `ad.claim.publish-unreviewed` | partial — awaits `/Marketing/Approved Claims` Notion DB | extend existing (Notion DB) |
| Trademark renewal tracking (USPTO §8/§9) | Compliance Specialist | none | skip |
| FDA Food Facility Registration (Oct-Dec 2026) | Compliance Specialist | none | skip |
| Vendor COI/W-9 expiry alerts | Compliance Specialist + `coi.expiry-alert` Class A | none | skip |
| Press / media monitoring | R-7 Press research | partial — PENDING runtime | extend existing (provision Muck Rack/Feedly) |
| Consumer voice monitoring | R-1 Consumer | partial — PENDING runtime | extend existing |
| Competitor monitoring | R-3 Competitive | partial — PENDING runtime | extend existing |
| Channel research | R-4 Channel | partial — PENDING runtime | extend existing |
| Regulatory monitoring | R-5 Regulatory | partial — PENDING runtime | extend existing |
| Ingredient cost monitoring | R-6 Supply | partial — PENDING runtime | extend existing |
| Market/category research | R-2 Market | partial — PENDING runtime | extend existing |
| Cross-stream research synthesis | Research Librarian | none | skip |
| Daily executive brief | Executive Brief (S-23) | none | skip |
| Weekly drift scorecard | Drift Audit Runner (S-25) | none | skip |
| Connector health smoke test | Platform Specialist (S-24) | none | skip |
| Secret rotation alerting | Platform Specialist | none | skip |
| Audit envelope stream | `src/lib/ops/control-plane/audit.ts` + slack mirror | none | skip |
| Approval queue | `src/lib/ops/control-plane/approvals.ts` + `/ops/approvals` | none | skip |
| Pre-build spec disambiguation | Interviewer agent | none | skip |
| Customer-support tier-1 (DTC) | Latent — Customer Experience division (Gorgias AI) | gap by design — division latent until > 20 tickets/mo | skip until trigger fires |
| Brand content calendar / blog scheduling | Latent — Marketing-Brand division | gap by design — latent | skip until trigger fires |
| Paid-media optimization | Latent — Marketing-Paid division (Madgicx + Triple Whale) | gap by design — latent | skip until trigger fires |
| Trade-show booth ops | Latent — Trade Shows division pod | gap by design — latent | skip until trigger fires |
| Press outreach + pitching | Latent — Outreach/Partnerships/Press division | gap by design — latent | skip until trigger fires |
| New-SKU R&D coordination | Latent — Product/Packaging/R&D division | gap by design — latent | skip until trigger fires |
| **Slack-corrections drift detector** (read recent corrections, surface upstream bug to next session) | Mentioned in operating-memory.md §"Drift detection via Slack corrections" — not yet a discrete agent | **MISSING** | new build (P0, see §10) |
| **Open-Brain capture write-back per agent** | Doctrine present in every agent contract; runtime not uniformly wired | **PARTIAL — most agents do not write back to Open Brain after acting** | extend existing |
| **/ops/agents/packs read-model dashboard** | Does not exist as a cross-cutting view | **MISSING** | new build (P0, see §10 + §12) |
| **Operating-memory transcript saver** (24h call/transcript capture rule per operating-memory.md §17) | Doctrine present; no agent enforces it | **MISSING** | new build (P0, see §10) |
| **Vendor-master coordinator** (orchestrate `vendor.master.create` Class B end-to-end: QBO vendor + Notion dossier + Drive folder) | Slug exists; no agent owns the end-to-end flow | **PARTIAL — manual today** | new build (P0, see §10) |
| **Approval-expiry sweeper** (24h auto-tag Ben, 72h auto-expire per taxonomy.md §Rules) | Logic exists in `approvals.ts`; no scheduled sweeper visibly cron'd | **PARTIAL — verify runtime** | extend existing or build small cron |
| **Notion ↔ contracts/* lockstep auditor** (governance.md §8 says contracts live in Notion + repo, kept in lockstep by drift audit; not visibly enforced) | Drift Audit Runner samples agent outputs; does not specifically diff Notion-vs-repo contracts | **PARTIAL** | extend Drift Audit Runner |
| **Receipt OCR → bill draft pipeline** (Phase 7 + Phase 9 promotion → Class B `qbo.bill.create`) | Receipt review packet flow exists; full pipe to `qbo.bill.create` is partial | **PARTIAL** | extend existing |

---

## 6. Approval slug mapping

For each agent that writes (Class B/C/D) — verify a registered slug. Anything that writes without a registered slug is a governance violation per taxonomy.md §Rules #1 (fail-closed on unknown actions).

| Agent | Class A slugs used | Class B/C slugs requested | Status |
|---|---|---|---|
| Viktor | `system.read`, `open-brain.capture`, `draft.email`, `slack.post.audit`, `internal.note`, `hubspot.task.create`, `lead.enrichment.write` | `gmail.send` (B, Ben), `hubspot.deal.stage.move` (B, Ben) | OK — all registered |
| Booke | `booke.categorize.suggest` (≥ 0.95 auto-commit) | `booke.categorize.edit` (B, Rene) | OK |
| Finance Exception | `slack.post.audit`, `system.read` | none — surfaces only | OK |
| Reconciliation Specialist | `system.read`, `open-brain.capture`, `slack.post.audit` | `qbo.invoice.partial-payment.apply` is Class A; staging only — Rene posts JEs manually (Class D `qbo.journal-entry.autonomous` blocks agents) | OK |
| Ops Agent | `system.read`, `slack.post.audit` | `qbo.po.draft` (B, Ben) | OK |
| Sample/Order Dispatch (S-08) | `system.read`, `slack.post.audit` | `shipment.create` (B, Ben), `shipstation.rule.modify` (B, Ben) | OK |
| Inventory Specialist (S-07) | `system.read`, `slack.post.audit` | `inventory.commit` (C, Ben+Rene), `run.plan.commit` (C, Ben+Rene), `inventory.adjustment.large` (C, Ben+Rene) | OK — reassigned 2026-04-27 (Drew sweep) |
| Compliance Specialist (S-14) | `coi.expiry-alert`, `slack.post.audit`, `hubspot.task.create` | `approved-claims.add/retire` (B, Ben), `legal.doc.expiry-override` (B, Ben), `claim.counsel-review.request` (B, Ben) | OK |
| Executive Brief (S-23) | `brief.publish`, `slack.post.audit` | none | OK |
| Drift Audit Runner (S-25) | `audit.sample.score`, `slack.post.audit` | none | OK |
| Platform Specialist (S-24) | `connector.health.post`, `slack.post.audit` | none | OK |
| Faire Specialist (S-12) | `system.read`, `slack.post.audit`, `hubspot.task.create`, `lead.enrichment.write` | `faire-direct.invite` (B, Ben), `account.tier-upgrade.propose` (B, Ben), `retailer.onboard.company-create` (B, Ben) | OK |
| Research Librarian | `research.post.tagged`, `internal.note`, `slack.post.audit`, `hubspot.task.create` | none | OK |
| R-1..R-7 (each) | `research.post.tagged`, `open-brain.capture`, `slack.post.audit` | none | OK — Class A only by design |
| Viktor W-7 (Rene capture) | `slack.post.audit`, `internal.note`, `open-brain.capture` | none — read + log only | OK |
| Interviewer | none — produces text only | none | OK — meta agent, no writes |
| Sample/Order Dispatch shipping-hub adjuncts (CF-09 freight-comp queue) | `invoice.dispute.flag`, `shipment.tracking-push` | `qbo.credit-memo.create` (B, Rene) for freight-comp post-clear | OK |

**Findings:** every contract resolves cleanly to registered slugs. No detected violations. Two soft observations:

1. The expansion v1.2 (44 new slugs added 2026-04-20) is recent and broad. Worth a follow-up audit to verify every code-path that calls `record()` or `requestApproval()` uses a slug from the canonical list (a `git grep` audit, not a doctrine question).
2. The Class D registry has 12 entries. Section §9 below catalogs them.

---

## 7. Open Brain / Supabase memory read/write rules

From `operating-memory.md`, governance.md §2 (L3 Domain Memory), and Supabase migration notes.

### 7.1 Read rules

Every active agent's boot ritual includes "Query Open Brain for division-tagged thoughts captured in the last N days." Read scope is open — any agent can search the semantic store via `search-memory` Edge Function.

### 7.2 Write rules

- **`open-brain.capture` is Class A** — every agent may write captured observations with provenance (system, id, retrievedAt, confidence) and division/topic tags.
- **Embeddings via `embed-and-store` Edge Function** — OpenAI embeddings; all writes carry `agent_id`, `run_id`, `source_citations`, `confidence`.
- **No edits or deletions of prior memory** — additive only. Corrections write a new entry tagged `corrects:<prior_id>`.
- **`corrections` table is a separate slot** — per governance.md §6, when Ben/Rene/Drew says an agent is wrong, the agent writes `{timestamp, field, wrong_value, correct_value, corrected_by, division}` to `corrections`.

### 7.3 Which agents touch the Edge Functions

Today, the most consistent users:

- **Viktor** — every session start + after every W-1/W-2/W-5/W-7/W-8 step.
- **Research Librarian** — weekly synthesis writes findings + entity dedup.
- **Booke** — captures categorization decisions for replay/learning.
- **Finance Exception, Ops, Compliance, Faire** — capture digest snapshots for next-day diff.

### 7.4 Gaps observed

- **Open-Brain write-back is not uniformly wired** in every specialist contract. Most contracts mention `memory_write` in the schema; not all runtimes follow through. Worth retrofitting each specialist's runtime to verify write-back on every action.
- **Founder auth bootstrap** for `auth.users` linking `ben@usagummies.com` is still pending per project memory.
- **7 BOOTSTRAP DEFAULT cost values** in `product_config` need replacement with real numbers.

---

## 8. Audit envelope rules

Every Class B/C/D action produces an audit envelope. The envelope schema and write path:

- **Schema (canonical):** `src/lib/ops/control-plane/types.ts` — `AuditLogEntry` includes `{run_id, agent_id, division, action_slug, entity_type, entity_id, result, source_citations[], confidence, before, after, approval_id?, timestamp}`.
- **Write path:** `src/lib/ops/control-plane/audit.ts` — `auditWriter()` writes to `auditStore()` (KV in prod, in-memory in tests).
- **Slack mirror:** `src/lib/ops/control-plane/slack/audit-surface.ts` — one-line post to `#ops-audit` per entry. Mirror is best-effort; store is authoritative (slack-operating.md §Audit rule).
- **Retention:** KV namespace `3.0:audit:*`; archive job in `/api/ops/archive/sync` rotates old entries to long-term storage. `/api/ops/archive/health` reports archive lag.
- **Append-only:** humans do not post to `#ops-audit`. Channel rules in `slack-operating.md`.

### 8.1 Compliance status per agent

| Agent | Audit envelopes? | Slack mirror? | Notes |
|---|---|---|---|
| Viktor | YES — via `record()` / `requestApproval()` | YES | reference impl |
| Booke | partial — Booke is third-party SaaS; flag ingest writes envelope | YES (downstream) | acceptable per contract — Booke is L1 source, not L4 agent |
| Finance Exception | YES | YES | |
| Reconciliation Specialist | YES | YES | |
| Ops Agent | YES | YES | |
| Sample/Order Dispatch (S-08) | YES — every Class B `shipment.create` request | YES | |
| Compliance Specialist | YES | YES | |
| Executive Brief | YES — via `brief.publish` Class A | brief itself is the post | |
| Drift Audit Runner | YES — via `audit.sample.score` Class A | YES | |
| Platform Specialist | YES — via `connector.health.post` | YES | |
| Faire Specialist | YES | YES | |
| Research Librarian + R-1..R-7 | YES — via `research.post.tagged` | YES | weekly digest, daily/weekly tagged posts |
| Viktor W-7 | YES — capture writes to `decision-log.ts` + `slack.post.audit` mirror | YES | |
| Sample/Order webhooks (Shopify/HubSpot/Amazon FBM) | YES — every webhook proposal writes envelope | YES | |

**Findings:** no missing audit envelopes detected in the current registry. The two retrofits needed are (a) ensure every contract's runtime calls through `record()` / `requestApproval()` (not bespoke writers), and (b) Open-Brain capture write-back as noted in §7.

---

## 9. Red-line Class D exclusions

From [`approval-taxonomy.md`](approval-taxonomy.md) §Class D + governance.md §10 + hard-rules.md.

Class D = autonomous-write **prohibited**. Agents must refuse and escalate. Humans perform manually. The 12 registered Class D actions:

| Slug | What |
|---|---|
| `secret.share` | Share or emit a secret — under any circumstance |
| `data.delete.prod` | Delete production data — never autonomous |
| `permissions.modify` | Modify Notion / Slack admin / Vercel team / repo permissions |
| `contract.sign` | Sign a contract |
| `system.destructive` | Drop schema, force-push main, revoke prod key, etc. |
| `pricing.discount.rule.change` | Change pricing or discount rules without explicit project approval |
| `qbo.chart-of-accounts.modify` | Modify QBO Chart of Accounts — Rene policy, agents never touch |
| `qbo.investor-transfer.recategorize` | Recategorize a Rene-investor transfer to anything other than `Loan from Owner` (CLAUDE.md canonical: ALWAYS investor loan, NEVER income) |
| `qbo.journal-entry.autonomous` | Post a JE in QBO autonomously — Rene posts manually |
| `qbo.period.close.reopen` | Reopen a closed QBO accounting period — Ben+Rene+audit only |
| `ad.claim.publish-unreviewed` | Publish ad creative not reviewed against the Approved Claims list |
| `customer.data.export-external` | Export customer data to a non-canonical system |

### 9.1 Cross-doc red lines (not registered slugs but still hard prohibitions)

From CLAUDE.md, hard-rules.md, viktor.md §3 Class D, and operating-memory.md:

- **No Drew shipping for orders.** Orders ship from Ashford WA (Ben). Samples ship from East Coast (Drew). Viktor never tells Drew to ship customer orders. (S-08 enforces this on every shipment.)
- **No removing BCC `rene@usagummies.com`** on new-customer first emails. Rule locked 2026-04-28 in `onboarding-dispatch-prod.ts`; tests assert it.
- **No fabricating financial data.** "Approximately" does not make a guess acceptable. "I don't have that data" is acceptable.
- **No silent action.** Every autonomous write produces both an audit envelope AND a Slack notification.
- **No new account creation autonomously.** Vendor master, customer master, etc. all gated as Class B.
- **No HOLD bypass.** When Ben says HOLD on a contact, zero outreach until lifted in current conversation.
- **No "just this once" exceptions.** Rules are revised in writing or not bypassed.

---

## 10. P0 build list

Genuinely missing — not duplicating anything in §3. P1+ items deferred to a future doc.

The list is short on purpose. Most "missing" capabilities are partials that need extension, not new agents. The 6 below are net-new. Each is stated with name, division, what it does, why nothing currently covers it, approval class, Slack channel, and rough complexity.

### P0-1 — Slack-Corrections Drift Detector — ✅ IMPLEMENTED 2026-04-29

| Field | Value |
|---|---|
| Name | `slack-corrections-drift-detector` |
| Division | `executive-control` |
| What it does | Reads captured operating-memory entries (the persisted output of P0-3 transcript-saver) within a configurable lookback window, runs five deterministic detectors against each entry, and emits a `DriftReport` for human review. The five detectors: (1) Drew approver regression — flags any entry suggesting Drew take an approval lane (CLAUDE.md doctrine lock); (2) Class D red-line action requests — matches both verbatim Class D slugs from the registry and paraphrase patterns ("delete prod data", "modify CoA", "post a journal entry", etc.); (3) unknown approval slug — flags slug-shaped tokens in entry bodies that aren't registered in `approval-taxonomy.md` (fail-closed rule); (4) doctrine contradiction — eight canonical doctrine locks (Drew-owns-nothing, BCC-Rene, single-job-per-agent, no-silent-action, no-agent-CoA-modify, Rene-investor-transfer-is-loan, no-B-tier-prefix-in-invoice-text, orders-from-Ben-Ashford); (5) stale contract reference — flags references to contract paths that no longer exist in the bundle. |
| Why nothing covers it | Doctrine in `operating-memory.md` §"Drift detection via Slack corrections" said drift becomes visible in Slack corrections; no discrete agent does the extraction. Drift Audit Runner samples agent outputs but does not specifically scan captured corrections. P0-3 (transcript-saver) shipped 2026-04-28 made the underlying corpus persistent + queryable — this detector consumes that corpus. |
| Approval class | A only (observation-only). The library never writes; the route returns the report read-only. No `slack.post.audit` is emitted by default. |
| Channel | UI / API surface — `GET /api/ops/operating-memory/drift` returns the structured report. Findings can later be mirrored to `#ops-audit` via a separate Class A `slack.post.audit` if desired (out of scope for v1). |
| Complexity | M (delivered; ~750 lines + 30 tests). |
| Code | `src/lib/ops/operating-memory/{drift-types,drift-doctrine,drift-detector}.ts`; route `src/app/api/ops/operating-memory/drift/route.ts`; tests `src/lib/ops/operating-memory/__tests__/drift-detector.test.ts` |
| Acceptance locks | (1) Drew regression — pattern catches "Drew should approve" / "reassign approval to Drew" but NOT "Drew handles East Coast samples" (legitimate fulfillment role). (2) Class D — both slug-verbatim (`qbo.chart-of-accounts.modify`) and paraphrase patterns ("delete production data", "post journal entry", etc.). (3) Unknown slug — flags slug-shaped tokens not in `ACTION_REGISTRY`; doesn't flag registered slugs or domain-shaped false positives like `gmail.com`. (4) Doctrine contradiction — 8 canonical locks; tests assert "remove BCC to Rene", "use B2 prefix", "agent modify CoA" all fire. (5) No mutation — tests verify the operating-memory store size is unchanged after a detection run; the detector's `proposedHumanReview` text NEVER routes review to Drew. (6) Dedupe — finding ids are sha256(detector + fingerprint + sub-context), stable across clock injection; running the detector twice yields the same id set. |

### P0-2 — `/ops/agents/packs` Dashboard — ✅ IMPLEMENTED 2026-04-29

| Field | Value |
|---|---|
| Name | `agent-packs-renderer` (UI-only — read-model dashboard, not a runtime agent) |
| Division | `executive-control` / `platform-data-automation` |
| What it does | Server-rendered dashboard at `/ops/agents/packs` cross-cutting the 21+ agent contracts into 6 audience-shaped read-models: B2B Revenue, Executive Control, Finance/Cash, Ops/Fulfillment, System Build, Research/Growth. Each pack card shows member agents with lifecycle (live / partial / latent / blocked / disabled), division, channel, role, blockers, runtime path, and class-coded approval slugs. Page also surfaces: (a) ghost-registry warning explaining the legacy 70-agent `engine-schedule.ts` is intentionally empty post-3.0; (b) P0 build status mirrored from §10 of this doc; (c) latest drift summary from P0-1 called server-side via `runDriftDetection()` (no client self-fetch); (d) discipline-invariants badge (Drew-owns-nothing, every-slug-resolves, no-new-divisions, no-new-slugs). |
| Why nothing covers it | `/ops/agents/status` exists but tracks individual agents flat with no pack-level cross-cut. No surface today shows the doctrinal grouping (which audience opens which pack), the ghost-registry honesty banner, or the P0 + drift roll-up next to the agent inventory. |
| Approval class | A only — server-side renderer. Zero writes. No new approval slug, no new division, no new agent (every agent on the page has a shipped contract). |
| Channel | UI only (`/ops/agents/packs`). The drift loader hits the read-only `GET /api/ops/operating-memory/drift` data path internally via the same library helper. |
| Complexity | S/M (delivered; ~770 lines + 65 tests). |
| Code | `src/lib/ops/agents-packs/{registry,reader}.ts`; page `src/app/ops/agents/packs/page.tsx`; tests `src/lib/ops/agents-packs/__tests__/{registry,reader}.test.ts`. |
| Acceptance locks | (1) Read-only — `AGENT_REGISTRY` + `PACK_REGISTRY` are `Object.freeze`d; tests assert no mutation across `buildPacksView()` calls. (2) No new org layer — every `division` is in the canonical `DivisionId` set; every `slug` is in `ACTION_REGISTRY`; tests fail-closed if either invariant breaks. (3) Ghost-registry warning shown when `ENGINE_REGISTRY.length === 0 && runAgent().status === "disabled"` (the EXPECTED post-3.0 state); flips to a "regression" banner if either signal flips back. (4) Drew-owns-nothing — no agent has `humanOwner: "Drew"`; the UI's invariants badge stays green. Sample/Order Dispatch keeps Drew as a *fulfillment node* (samples + East Coast routing fact), but the contract owner is Ben. (5) Approval slugs resolve via `taxonomy.classify()`; `resolvedSlugs[]` carries the class letter for color-coding. (6) ChatGPT-pack §11 rejected proposals do NOT appear as agent names or ids in `AGENT_REGISTRY` — test pinned with the full ~50-name reject list. |

### P0-3 — Operating-Memory Transcript Saver — ✅ IMPLEMENTED 2026-04-28

| Field | Value |
|---|---|
| Name | `transcript-saver` |
| Division | `executive-control` (caller-supplied; library is division-agnostic) |
| What it does | Implements the §17 rule from `operating-memory.md`: when a substantive call happens (Ben+Rene call, vendor meeting, internal strategy), the transcript or recap must be saved to Slack memory before the day ends. Captures pasted recaps (and webhook-pushed Slack content), classifies them into `correction` / `decision` / `transcript` / `followup` / `report`, redacts secrets before persistence, fingerprints for dedupe, and tags each entry under a `transcript:<short-id>` (or `transcript:vendor:<short-id>`) thread tag. |
| Why nothing covers it | Doctrine present, no agent enforced. Transcripts evaporate within hours of the call ending. |
| Approval class | A only (`open-brain.capture`). Class enforced by module-load-time guard `assertClassA()` — if a future taxonomy edit promotes the slug, the module throws on import. |
| Channel | The originating channel (caller's choice via `slack.post.audit` Class A) + `#ops-audit` mirror via factory-backed audit surface. |
| Complexity | S (delivered; ~770 lines + 90 tests). |
| Code | `src/lib/ops/operating-memory/{types,redact,classify,fingerprint,store,transcript-saver}.ts`; route `src/app/api/ops/transcript/capture/route.ts`; tests `src/lib/ops/operating-memory/__tests__/*.test.ts` |
| Acceptance locks | (1) dedupe on same fingerprint — `InMemoryOperatingMemoryStore` + KV impl both honor idempotent `put()`. (2) secret-shape patterns scrubbed before persistence (AWS, Stripe, OpenAI, GitHub, Slack, JWT, PEM, Bearer, password=, SSN, CC, ACH). (3) Class A only — slug `open-brain.capture` is in `AUTONOMOUS_ACTIONS`; tests assert it's NOT in B/C/D registries. (4) provenance required — `source.sourceSystem`, `source.sourceRef`, `actorId`, `actorType`, `capturedAt`, `division` all enforced at validation. (5) classification — correction-shaped bodies always file under `correction` even when caller passes `kindHint: "decision"` (drift-detection priority). |

### P0-4 — Vendor-Master Coordinator — ✅ IMPLEMENTED 2026-04-29

| Field | Value |
|---|---|
| Name | `vendor-master-coordinator` |
| Division | `financials` (with `production-supply-chain` read scope) |
| What it does | Adds a doctrine-enforced upstream gate over the existing `vendor.master.create` Class B approval flow (already shipped in `src/lib/ops/vendor-onboarding.ts`). The coordinator: (1) re-validates the slug class B + Rene approver against `taxonomy.classify()` defense-in-depth, (2) parses input via the shared pure parser, (3) runs a dedupe pre-check against the existing registry / pending-approval KV space, (4) validates 8 required fields (name, contactName, email, taxIdentifier, address.line1/city/state/postalCode) and surfaces missing ones honestly via a `review-needed` packet, (5) only when all checks pass, delegates to the canonical `openVendorOnboardingApproval()` which opens a single Class B `#ops-approvals` request for Rene. The lower onboarding module's approved-closer continues to atomically create QBO vendor + Notion dossier + Drive folder ON Rene approval — the coordinator is the upstream gate, not a duplicate of that closer. |
| Why nothing covered it | The Class B approval path + 3-system approved-closer existed but had no doctrine-enforced field validator above it: a sparse intake (just `name`) could still open an approval, leaving Rene to chase missing fields in Slack. The coordinator surfaces missing fields BEFORE the approval enters the queue. |
| Approval class | B only (Rene approver, slug `vendor.master.create`). Coordinator is read+delegate only — never writes QBO, Notion, Drive, payment instructions, or CoA. Drew NEVER selected (slug-guard verifies `requiredApprovers` includes Rene and excludes Drew). |
| Channel | `#ops-approvals` (existing canonical surface) for the Rene approval card; `#ops-audit` mirror via existing `auditSurface()`. Coordinator emits no new audit envelope — it relies on the `requestApproval()` canonical path's envelope. |
| Complexity | S (delivered; ~340 lines + 28 tests). Existing 3-system closer in `vendor-onboarding.ts` unchanged. |
| Code | `src/lib/ops/vendor-master/coordinator.ts`; pure parser extracted to `src/lib/ops/vendor-onboarding-parse.ts`; tests `src/lib/ops/vendor-master/__tests__/coordinator.test.ts`. |
| Acceptance locks | (1) Valid packet → `status:"ready"` + approval opened exactly once; no QBO/Notion/Drive call. (2) Missing required fields → `status:"review-needed"` with `missing[]`; approval NOT opened. Recommended-but-missing → `warnings[]` (non-blocking). (3) Duplicate vendor → `status:"duplicate"` with reason `vendor-already-onboarded` or `vendor-onboarding-pending`; approval NOT opened. Dedupe runs BEFORE field validation so stale-data spurious review-needed states don't surface. (4) No QBO write before approval — only side-effectful dep is `approvalOpener.open()`; closer fires only on Rene approval. (5) No CoA mutation — registered slug is `vendor.master.create` (Class B), never `qbo.chart-of-accounts.modify` (Class D). (6) Drew never selected — slug-guard verifies `requiredApprovers` excludes Drew; serialized `ready` packet contains zero Drew references. (7) Unknown slug fail-closed — if `classify()` returns undefined, returns `status:"error"`. If slug is somehow Class D, refuses to delegate. If slug suddenly lists Drew, refuses. (8) Audit/back-reference — coordinator delegates to canonical `requestApproval()` path; approval id surfaced for back-reference. |

### P0-5 — Approval-Expiry Sweeper — ✅ IMPLEMENTED 2026-04-29

| Field | Value |
|---|---|
| Name | `approval-expiry-sweeper` |
| Division | `executive-control` |
| What it does | Verifies and operationalizes `approval-taxonomy.md` §Rules #2: pending → escalate at 24h → expire at 72h. The pure transitions (`checkExpiry`, `shouldEscalate`) already lived in `src/lib/ops/control-plane/approvals.ts`; this build replaces the no-op stub at `src/lib/ops/sweeps/approval-expiry.ts` with a real sweeper that reads pending approvals, persists `expired` for 72h+ items (already-allowed terminal state), records 24h+ items as escalation findings (no state mutation — escalation is a notification with `escalationTag: "Ben"`), and emits one audit envelope per state event. Hourly cron at `/api/ops/control-plane/approval-sweep`. |
| Why nothing covered it | Verification first: `vercel.json` had no entry; `/api/ops/sweeps/[sweep]/route.ts` returned `{disabled:true}`; `src/lib/ops/sweeps/approval-expiry.ts` was `export default {};`. The legacy QStash `abra-approval-expiry` schedule pointed at the disabled stub — dead config. The pure functions existed but nothing called them on the live queue. |
| Approval class | A only — never executes the underlying Class B/C action. The sweeper persists ONLY the `expired` terminal state (already in `ApprovalStatus`) plus audit envelopes (`approval.sweep.expire`, `approval.sweep.escalate`, `approval.sweep.fail-closed`). |
| Channel | Audit envelopes mirror to `#ops-audit` via the existing `auditSurface()` pattern. Route returns the `SweepReport` JSON to the cron caller. |
| Complexity | S (delivered; ~280 lines + 22 tests + cron entry). |
| Code | `src/lib/ops/sweeps/approval-expiry.ts` (replaces no-op stub); route `src/app/api/ops/control-plane/approval-sweep/route.ts`; cron entry in `vercel.json` (hourly `22 * * * *`); tests `src/lib/ops/sweeps/__tests__/approval-expiry.test.ts`. |
| Acceptance locks | (1) 23h approval untouched — `untouched++`, no audit envelope. (2) 24h approval → escalation finding emitted; status stays pending; audit shows `escalationTag: "Ben"`. (3) 72h approval → status persists as `expired`; audit before/after pair captured. (4) Approved / rejected / expired / stood-down approvals filtered by `listPending()`; sweeper sees zero. (5) Unknown action slug (action name doesn't resolve via `taxonomy.classify()` name index) → fail-closed: status untouched, surfaced in `failClosed[]`, audit envelope `approval.sweep.fail-closed` with `result: "skipped"`. (6) No Class B/C execution — the sweeper imports zero outbound execution surfaces (gmail / hubspot / qbo / shopify); test asserts `every(action.startsWith("approval.sweep."))`. (7) Drew never selected — escalation tag is hard-coded `"Ben"`; `requiredApprovers` is preserved as-is in audit envelope but the sweeper never synthesizes Drew. |

### P0-6 — Receipt-OCR → Bill-Draft Promoter — ✅ IMPLEMENTED 2026-04-29

| Field | Value |
|---|---|
| Name | `receipt-bill-promoter` |
| Division | `financials` |
| What it does | Bridges the rene-approved receipt-review packet (Phase 9 `receipt.review.promote`) into a `qbo.bill.create` Class B / Rene approval. Pure DI coordinator: validates the packet is `rene-approved`, enforces required CANONICAL reviewed fields (vendor, date, amount, category — OCR-only values never satisfy these), resolves the vendor against an injected vendor probe (P0-4 vendor-master registry), dedupes via a stable sha256 idempotency key tied to packet id + vendor + amount + date, builds an OCR-vs-canonical delta preview, then delegates to an injected approval opener (canonical `requestApproval()` path). Returns one of six explicit statuses: `approval-opened` / `review-needed` / `blocked-packet-status` / `blocked-vendor` / `duplicate` / `fail-closed`. |
| Why nothing covered it | Phase 7 (OCR) + Phase 8 (review-packet builder) + Phase 9 (`receipt.review.promote` slug) + Phase 10 (closer flips packet → rene-approved) shipped; the actual bridge from `rene-approved` packet to a `qbo.bill.create` approval was the missing "later" hop noted in `approval-taxonomy.md` §receipt.review.promote. |
| Approval class | The promoter itself is observation+delegate (Class A from its perspective); the underlying staged action is Class B `qbo.bill.create` (Rene approver). Coordinator never writes QBO directly — the canonical `requestApproval()` path emits the audit envelope; the bill creation happens only on Rene's approval of THAT request via the QBO closer (out of scope here). |
| Channel | `#ops-approvals` (canonical Rene approval surface); `#ops-audit` mirror via existing `auditSurface()`. Promoter emits NO new audit envelope — it relies on the canonical path's emission. |
| Complexity | M (delivered; ~440 lines + 35 tests). |
| Code | `src/lib/ops/receipts/bill-draft-promoter.ts`; tests `src/lib/ops/receipts/__tests__/bill-draft-promoter.test.ts`. Existing receipt OCR (Phase 7), review-packet builder (Phase 8), and closer (Phase 10) untouched. |
| Acceptance locks | (1) Valid reviewed receipt → `status:"approval-opened"` with `actionSlug === "qbo.bill.create"`. (2) Rene approver enforced via slug-guard at module entry; corrupted approver list returns `fail-closed`. (3) OCR-only receipt → `review-needed` (canonical-source check). (4) Missing canonical fields surface verbatim in `missing[]`; vendorProbe NOT called (fail-fast). (5) Vendor not-found / pending / ambiguous → `blocked-vendor` with `vendorMasterDependency.coordinatorPath` pointing to P0-4. (6) Duplicate dedupe via sha256 of packet+vendor+amount+date (case-insensitive vendor name); `approval-pending` and `approval-completed` both blocked. (7) No QBO write — promoter accepts only `vendorProbe.resolve()` + `dedupeProbe.check()` + `approvalOpener.open()` — no createQBOBill / createQBOVendor imports. (8) No vendor creation bypass — VendorProbe interface exposes ONLY `.resolve()`; structural lock asserts no `.create` member. (9) No CoA mutation — registered slug is `qbo.bill.create` (Class B), never `qbo.chart-of-accounts.modify` (Class D). (10) Class D slug → `fail-closed`. (11) Unknown slug → `fail-closed` with "unknown action slug" message. (12) Drew approver → `fail-closed`; payload serialization Drew-free. (13) Canonical fields preserved — when OCR disagrees, preview keeps canonical and surfaces deltas in `ocrDeltas[]`. (14) Approval payload includes `evidence.claim` (canonical-only / OCR-suggestion-only language), `evidence.sources` (packet + receipt + vendor-master citations), `evidence.confidence` (0.95 no-deltas / 0.85 with deltas), `rollbackPlan` ("Rene voids" + no-payment guarantee). (15) Audit/back-reference preserved — coordinator delegates to canonical `requestApproval()` which emits the envelope; approval id surfaced for back-reference; `targetEntity.id` is the idempotency key for stable lookup. (16) Status table updated only after green (separate test in reader.test.ts asserts P0-6 implemented). |

### P0-7 — Notion ↔ /contracts Lockstep Auditor — ✅ IMPLEMENTED 2026-04-29

| Field | Value |
|---|---|
| Name | `contract-lockstep-auditor` |
| Division | `executive-control` |
| What it does | Implements governance.md §8 — agent contracts live in Notion + repo and must stay in lockstep. Pure DI auditor: `auditLockstep({repoManifest, notionManifest, now, doctrineMarkerIds?, staleThresholdDays?})` returns a structured `LockstepReport`. Eight detectors: (1) missing-in-notion — repo contract has no Notion mirror; (2) missing-in-repo — Notion canon item with no repo file; (3) version-mismatch — numeric versions differ; (4) stale-notion-timestamp — Notion lastEditedAt > N days behind repo versionDate (default 14); (5) title-mismatch — titles differ after normalization; (6) doctrine-contradiction — repo body trips a doctrine-lock pattern (shared with P0-1); (7) drew-regression — repo or Notion content asserts Drew approval lane (CLAUDE.md violation); (8) unknown-slug — referenced slug-shaped tokens not in `taxonomy.classify()`. Each finding includes severity, confidence, repo path, Notion page id/url, mismatch type, evidence snippet, and a proposed-human-review sentence (NEVER routes to Drew). Compact summary surfaces on `/ops/agents/packs` server-side via `lockstepLoader` injection. |
| Why nothing covers it | Drift Audit Runner samples agent outputs against system-of-record ground truth; it does not diff doc-vs-doc. P0-1 detects drift in operating-memory captures; this auditor handles the contract-vs-Notion lockstep specifically. |
| Approval class | A only (read + report). **No Notion writes** — the original spec called for auto-supersede tagging, but per the 2026-04-29 directive that capability is OUT OF SCOPE; the auditor surfaces drift and humans resolve it via Notion UI. |
| Channel | UI surface — compact summary on `/ops/agents/packs` (server-rendered). Full report consumed by P0-2 via `lockstepLoader` dependency. Degraded mode (notionManifest=null) is explicit about uncertainty — repo-side detectors still run; cross-walk detectors are honestly skipped. |
| Complexity | M (delivered; ~750 lines + 45 tests). |
| Code | `src/lib/ops/contract-lockstep/{types,repo-manifest,lockstep-auditor}.ts`; integration via `BuildPacksViewDeps.lockstepLoader`; tests `src/lib/ops/contract-lockstep/__tests__/{lockstep-auditor,repo-manifest}.test.ts`. |
| Acceptance locks | (1) missing-in-notion — flagged HIGH for CANONICAL repo contracts, LOW for DEPRECATED. (2) missing-in-repo — Notion items with absent or repoPath-mismatch flagged. (3) version-mismatch — numeric prefix normalization (`v1.0` ↔ `1.0` matches; `1.4` ≠ `1.2` flagged). (4) stale-notion-timestamp — 14-day default, override via `staleThresholdDays`. (5) drew-regression — fires on repo body OR Notion excerpt; legitimate "Drew handles East Coast samples" passes. (6) unknown-slug — fires on `referencedSlugs` AND body scrape; registered slugs + domain false positives don't trip. (7) No mutation — input manifests are not modified (JSON.stringify snapshots match); auditor is a pure function. (8) Pack dashboard surface — `view.lockstep` is null when no loader, `{ok:true,...}` summary when loaded, `{ok:false,error}` on loader throw. Page renders "auditor inactive" / "degraded mode" cards explicit about uncertainty (no fake-green badges). |
| Channel | `#ops-audit` weekly summary |
| Complexity | M (Notion API + markdown diff + tagging logic) |

**Total: 7 P0 items.** Five of these are clearly net-new agents (P0-1, P0-3, P0-4, P0-6, P0-7). One is a UI dashboard (P0-2). One is a small cron (P0-5) that may already exist — verify before building.

Recommendation: build in the order listed. P0-1, P0-3, P0-5 are the cheapest wins (combined ~3-5 days). P0-2, P0-4, P0-6, P0-7 are the deeper builds (combined ~2 weeks).

---

## 11. Rejected / redundant agent list

Agents from the ChatGPT pack proposal (and any "we should build X" hunches) that we are explicitly **NOT** building because §3 already covers them.

| Proposed name | Replaced by | Why the existing one is sufficient |
|---|---|---|
| Lead Generation Agent | Viktor W-2 + Faire Specialist + Apollo (external) | Viktor's outbound drafting workflow is gated and contract-bound; Apollo handles enrichment per the locked tech stack |
| Inbound Triage Agent | Viktor W-1 | Already classifies hot/warm/cold/noise on every inbound |
| Cold Email Specialist | Viktor W-2 (per-send Class B `gmail.send`) | Per-send approval is the right answer; an "autonomous cold-email agent" is a Class D violation by design |
| Pipeline Manager | Viktor W-3 (daily 10 AM PT) + W-4 (Monday 9 AM PT) | Hygiene queries + stale-deal surfacing already covered |
| Deal Stage Manager | Viktor W-1 + HubSpot deal-stage automation cron + S-08 HubSpot adapter | Stage moves are Class B `hubspot.deal.stage.move`; auto-advance only wired for sample-shipped events |
| Faire Direct Outreach Agent | Faire Specialist (S-12) | Direct invite drives are this agent's primary job |
| Faire Marketplace Order Agent | Faire Specialist + S-08 dispatch | Already wired (degraded on token) |
| Booking / Trade-Show Agent | Latent — Trade Shows division pod | Pod activates only when a show is booked; do not pre-build |
| Customer Support Agent (Tier 1) | Latent — Customer Experience division | Activates at > 20 tickets/mo for 2 weeks; Gorgias AI handles |
| Bookkeeper / Categorizer | Booke (third-party SaaS, contract bound) | Booke is the system of record for categorization suggestion |
| AP Manager | Finance Exception + Class B `qbo.bill.approve-for-payment` + Class C `payment.batch.release` | Rene approves; agents only stage |
| AR Manager | Finance Exception (drains AR aging) + Class B `ar.hold.set/clear` | Already covered |
| Reconciler | Reconciliation Specialist (S-06) + Amazon Settlement cron | Live |
| Receipt Capture Agent | `#receipts-capture` channel + receipt review packet flow | Live |
| Tax Filing Agent | (out of scope — Rene handles via Wyoming Attorneys + accountant) | Not an agent role |
| Vendor Manager | Ops Agent + vendor-threads.ts + (P0-4) Vendor-Master Coordinator | P0-4 covers the master-data orchestration; Ops handles thread freshness |
| PO Manager | Ops Agent + Class B `qbo.po.draft` | Live |
| Sample Coordinator | S-08 Sample/Order Dispatch | Live |
| Order Coordinator | S-08 Sample/Order Dispatch + Shipping Hub | Live |
| Inventory Manager | Inventory Specialist (S-07) + Ops Agent + ATP gate + cover-day forecast | Live |
| Production Run Planner | Class C `run.plan.commit` (Ben+Rene); Inventory Specialist proposes | No autonomous agent — by design |
| Shipping Coordinator | Shipping Hub + S-08 + ShipStation Health | Live |
| Tracking Notifier | `shipment.tracking-push` Class A + S-08 webhook | Live |
| FBM Order Watcher | Amazon FBM unshipped-alert cron | Live (3x/day) |
| FBA Restock Watcher | Amazon restock-check route | Live (extend; partial) |
| Compliance Calendar Agent | Compliance Specialist (S-14) | Live (fallback mode pending Notion DB) |
| Approved Claims Reviewer | Compliance Specialist + Class B `claim.counsel-review.request` | Live (counsel review gate present) |
| FDA Filing Agent | Compliance Specialist | Tracks Oct-Dec 2026 FFR window already |
| USPTO Maintenance Agent | Compliance Specialist | §8/§9 dates tracked |
| Insurance Renewal Agent | Compliance Specialist | Same calendar |
| COI Tracker | Compliance Specialist + `coi.expiry-alert` Class A | Live |
| Press Outreach Agent | Latent — Outreach/Partnerships/Press division | Activates at ≥ 5 inbound press/mo |
| Press Monitor | R-7 Press research | Pending runtime; do not duplicate |
| Consumer Insight Agent | R-1 Consumer | Pending runtime |
| Market Research Agent | R-2 Market | Pending runtime |
| Competitor Watch Agent | R-3 Competitive | Pending runtime |
| Channel Research Agent | R-4 Channel | Pending runtime |
| Regulatory Watch Agent | R-5 Regulatory | Pending runtime |
| Supply Watch Agent | R-6 Supply | Pending runtime |
| Research Synthesizer | Research Librarian | Live |
| Daily Brief Composer | Executive Brief (S-23) | Live |
| Drift Auditor | Drift Audit Runner (S-25) | Live |
| Connector Health Monitor | Platform Specialist (S-24) | Live |
| Secret Rotation Manager | Platform Specialist | Live |
| Audit Logger | `src/lib/ops/control-plane/audit.ts` + Slack mirror | Infrastructural — not an agent |
| Approval Queue Manager | `src/lib/ops/control-plane/approvals.ts` + `/ops/approvals` UI | Infrastructural |
| Memory Embedder | Supabase `embed-and-store` Edge Function | Infrastructural |
| Memory Searcher | Supabase `search-memory` Edge Function | Infrastructural |
| Spec Disambiguator | Interviewer | Live |
| Brand Content Agent | Latent — Marketing-Brand division | Latent |
| Paid Media Agent | Latent — Marketing-Paid division | Latent |
| Product R&D Agent | Latent — Product/Packaging/R&D division | Latent |

**Total: ~50 proposed agents rejected as redundant or premature.** The ratio is roughly 7 P0 builds vs 50 rejected — which is the correct shape per Ben's directive.

---

## 12. Recommended `/ops/agents/packs` dashboard spec

A new page at `/ops/agents/packs` rendering the 7 packs from §4. **Spec only** — implementation is P0-2 in §10.

### 12.1 Route + auth

- **Route:** `src/app/ops/agents/packs/page.tsx` — server component with revalidate=30
- **Data API:** `src/app/api/ops/agents/packs/route.ts` — GET handler, returns pack manifest + live agent state
- **Auth:** mirrors other `/ops/*` pages — NextAuth.js v5 session, role-gated. Roles `admin` and `investor` can read; only `admin` can drill into `#ops-approvals` items
- **Middleware self-auth:** `/api/ops/agents/packs` — bearer `CRON_SECRET` for programmatic access if needed

### 12.2 Data sources

- **Pack manifest:** static config in `src/lib/ops/control-plane/packs.ts` (new file). 7 packs from §4. Each pack lists agent IDs, surface channels, owner.
- **Agent registry:** the 21 contracts in `/contracts/agents/` + `viktor.md` — parsed on build to extract `agent_name`, `division`, `human_owner`, `model`, `weekly_kpi`.
- **Live agent state:** `/api/ops/agents/status` (existing) — tracks 12 agents today; extend to all 21.
- **Health probes:** `agent-health.ts` (existing) — green / yellow / red per agent.
- **Run history:** `agent-performance.ts` (existing) — last-run timestamp, last-run result.
- **Approval queue per pack:** `approvalStore()` filtered by `division` matching the pack's served divisions.
- **Audit-envelope feed per pack:** `auditStore()` filtered same way; show last 5.

### 12.3 Layout

- **Page header:** "Agent Packs — Read-models" + last-refresh-time + count of packs.
- **Pack cards (7):** one card per pack with these fields:
  - Pack name + audience + owner
  - 1-line purpose
  - Live agent count (e.g. "Finance Pack — 6 agents — 6 green / 0 yellow / 0 red")
  - Last cross-pack run (most recent across all member agents)
  - Pending approvals count badge (clickable → drill-down to that pack's approval queue)
  - "Open" button → drill-down page
- **Drill-down page:** `/ops/agents/packs/[pack-id]/page.tsx`
  - Pack header + back link
  - Per-agent cards (member agents only)
    - Agent name + division + owner + class indicators (A / B / C / D — what classes this agent emits)
    - Health (green/yellow/red) + last-run + next-run + run count last 7d
    - Recent audit envelopes (last 5) with action slug + entity ref
    - Link to contract file
  - Sub-section: "Approval queue (this pack)" — pending approvals only, with `Approve / Reject / Ask` buttons (admin only)
  - Sub-section: "Recent corrections (this pack)" — last 7d from `corrections` table, useful for drift detection per §7

### 12.4 Class indicators per agent

- Render a small chip row: `[A]` `[B]` `[C]` `[D]`
- `[A]` always green if any Class A slug used
- `[B]` orange if any pending Class B request older than 24h (per P0-5)
- `[C]` red if any pending Class C request older than 24h
- `[D]` always grey — Class D is prohibited; no agent emits

### 12.5 What this page is NOT

- Not a runtime — does not invoke agents.
- Not a scheduler — does not change cron cadence.
- Not an editor — does not modify contracts.
- Read-only surface for human operators.

### 12.6 Out of scope for v1

- Per-pack KPI rollup (weekly) — Phase 2, after `weekly_kpi` is uniformly populated in every contract.
- Per-pack cost rollup (sum of `cost_budget_usd_per_day`) — Phase 2.
- Cross-pack search (find agent by name) — Phase 2; current navigation through 7 cards is sufficient.

---

## Version history

- **1.0 — 2026-04-27** — First publication. Audits the (already retired) 70-agent registry + the 21 contracts in `/contracts/agents/` + `viktor.md` + the meta `interviewer.md` against ChatGPT's pack proposal. Confirms `engine-schedule.ts` is a deprecated stub. Maps the live runtime inventory (~25 surfaces) per `activation-status.md` 2026-04-21. Names 7 P0 builds and rejects ~50 redundant proposals. Spec for `/ops/agents/packs` dashboard included as §12.
- **1.1 — 2026-04-28** — P0-3 (Operating-Memory Transcript Saver) shipped. New module `src/lib/ops/operating-memory/` with redaction + classification + fingerprint + storage adapters (in-memory + KV); Class A route at `POST /api/ops/transcript/capture`; 90 tests added (full suite 2504 green). Class A only; uses the registered `open-brain.capture` slug. No new approval slugs introduced; no Class B/C/D side effects. Status badge added to §10 P0-3.
- **1.2 — 2026-04-29** — P0-1 (Slack-Corrections Drift Detector) shipped. New modules `drift-types.ts` + `drift-doctrine.ts` (8 canonical doctrine locks) + `drift-detector.ts` (5 detectors: drew-regression, class-d-request, unknown-slug, doctrine-contradiction, stale-reference); read-only route `GET /api/ops/operating-memory/drift`; 30 tests added (full suite 2534 green). Class A only — observation-only library, no writes. Reuses P0-3 capture pipeline as the source corpus. Status badge added to §10 P0-1.
- **1.3 — 2026-04-29** — P0-2 (`/ops/agents/packs` Dashboard) shipped. New modules `agents-packs/registry.ts` + `agents-packs/reader.ts` mapping 21+ existing contracts into 6 audience-shaped packs (B2B Revenue, Executive Control, Finance/Cash, Ops/Fulfillment, System Build, Research/Growth); server-rendered page at `/ops/agents/packs` with ghost-registry warning, P0 status mirror, drift summary called via `runDriftDetection()` server-side, and discipline-invariants badge; 65 tests added (full suite 2599 green). Class A renderer only — zero writes, zero new agents/divisions/slugs. Status badge added to §10 P0-2.
- **1.4 — 2026-04-29** — P0-7 (Notion ↔ /contracts Lockstep Auditor) shipped. New module `src/lib/ops/contract-lockstep/` with `types.ts` + `repo-manifest.ts` (front-matter parser + slug + doctrine-marker scrapers) + `lockstep-auditor.ts` (pure DI auditor with 8 detectors). Optional `lockstepLoader` wired into `buildPacksView()`; the page renders a compact lockstep summary section with explicit degraded-mode disclosure when Notion manifest unavailable. **No Notion writes** — observation-only by design; the original §10 "auto-supersede" capability was scoped out per the 2026-04-29 directive. 45 tests added (full suite 2644 green). Status badge added to §10 P0-7.
- **1.7 — 2026-04-29** — P0-6 (Receipt-OCR → Bill-Draft Promoter) shipped. New module `src/lib/ops/receipts/bill-draft-promoter.ts` is the upstream gate from a rene-approved review packet to a `qbo.bill.create` Class B / Rene approval. Pure DI: vendor-probe (P0-4 dependency), dedupe-probe (stable sha256 idempotency), approval-opener (canonical `requestApproval()` path). OCR remains suggestion-only — canonical fields never overwritten; reviewer sees OCR-vs-canonical deltas side-by-side. 35 tests added (full suite 2731 green). Class B staging only — zero QBO/Notion/Drive write; vendor creation routes to P0-4; Drew never selected. **All 7 P0s now shipped.** Status badge added to §10 P0-6.
- **1.6 — 2026-04-29** — P0-4 (Vendor-Master Coordinator) shipped. New module `src/lib/ops/vendor-master/coordinator.ts` is the upstream doctrine gate over the existing `vendor.master.create` Class B approval (`vendor-onboarding.ts` unchanged). Pure parser extracted to `src/lib/ops/vendor-onboarding-parse.ts` so the coordinator is testable without dragging server-only QBO/Notion imports. Slug-guard re-validates Class B + Rene approver before delegating; 8-field required-set with honest missing-field surfacing; dedupe pre-check against existing registry/pending KV. 28 tests added (full suite 2695 green). Class B only — zero QBO/Notion/Drive write before Rene approval; Drew never selected. Status badge added to §10 P0-4.
- **1.5 — 2026-04-29** — P0-5 (Approval-Expiry Sweeper) verified missing then shipped. Pure transitions `checkExpiry()` / `shouldEscalate()` already lived in `approvals.ts`; the sweeper that called them was a no-op stub. Replaced `src/lib/ops/sweeps/approval-expiry.ts` with `runApprovalExpirySweep()` that reads pending approvals, persists `expired` for 72h+ items, records 24h+ items as escalation findings (status stays pending), emits audit envelopes (`approval.sweep.expire` / `.escalate` / `.fail-closed`), and fail-closes on unknown action slugs. New protected route `/api/ops/control-plane/approval-sweep` (bearer CRON_SECRET); hourly Vercel Cron added to `vercel.json` (`22 * * * *`). Class A only — zero execution of underlying Class B/C actions; escalation tag hard-coded "Ben" preserves Drew-owns-nothing. 22 tests added (full suite 2666 green). Legacy `/api/ops/sweeps/[sweep]` stub left untouched (dead route); QStash `abra-approval-expiry` schedule remains as dormant config — operator cleanup is separate. Status badge added to §10 P0-5.
