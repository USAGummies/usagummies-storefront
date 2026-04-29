# Agent Heartbeat Doctrine — USA Gummies 3.0

**Status:** CANONICAL DRAFT
**Source:** Ryan Mathews / Paperclip-style AI-agent-company research application, adapted to USA Gummies 3.0
**Version:** 0.1 — 2026-04-29
**Purpose:** Define how USA Gummies agents become proactive operators without becoming an unsafe autonomous swarm.

This contract turns the research lesson into repo doctrine: USA Gummies agents should behave like narrow AI employees with a role, queue, cadence, budget, approval boundary, memory routine, audit trail, and measurable output state.

This document does **not** replace the existing control plane. The approval taxonomy remains law. Divisions remain the org primitive. Packs remain dashboard/read-model groupings only.

---

## 1. Core principle

USA Gummies 3.0 is a one-person-led, AI-operated, human-sovereign CPG company.

The system should become proactive by waking itself up, checking assigned business queues, preparing work, opening approvals when required, logging actions, and remembering decisions. It should not become a chaotic multi-agent swarm.

A valid agent heartbeat answers four questions:

1. Does this bring cash in?
2. Does this prevent cash from leaking?
3. Does this speed fulfillment or collection?
4. Does this protect the operating system from drift or failure?

If a heartbeat cannot answer yes to at least one, it is not a priority runtime.

---

## 2. Authority model

### Existing doctrine stays in force

- Slack = command / approval / audit surface.
- Notion = research and doctrine canon-in-progress.
- Repo contracts = executable doctrine.
- Open Brain / Supabase = persistent memory.
- HubSpot = B2B sales truth.
- Gmail = communication truth.
- QBO = finance truth.
- Shopify / Amazon / Faire / ShipStation = commerce and fulfillment truth.
- Class A/B/C/D approval taxonomy = safety primitive.

### No new org layer

The operating primitives remain:

1. **Divisions** — org structure.
2. **Agents** — executors.
3. **Approval taxonomy** — safety / authority.
4. **Packs** — dashboard views only.

Do not introduce a new “pack doctrine,” “AI department,” or “CEO meta-agent” that can override repo contracts.

### Drew owns nothing

Drew may appear only as a fulfillment node for samples / East Coast execution. Drew is never an approver, owner, reviewer, or approval route.

---

## 3. Heartbeat definition

A heartbeat is a bounded scheduled or event-triggered agent run.

Every heartbeat must:

1. Fetch identity + contract.
2. Fetch division + owner + approval permissions.
3. Read assigned queue.
4. Read relevant operating memory.
5. Read current doctrine locks.
6. Check run budget / cadence limits.
7. Claim or dedupe one unit of work.
8. Execute bounded work.
9. Produce a structured output state.
10. Write an audit/run record.
11. Capture material decisions/corrections to operating memory.
12. Escalate if blocked.

Agents do not run forever. They wake, work, report, and exit.

---

## 4. Required heartbeat metadata

Each live contract-backed agent should declare or be mapped to:

| Field | Meaning |
|---|---|
| `agentId` | Stable id matching contract/registry entry |
| `name` | Human-readable name |
| `division` | One of the canonical division ids |
| `owner` | Ben or Rene; never Drew |
| `queueSource` | Source of assigned work |
| `cadence` | cron / event / manual / on-demand |
| `allowedClassA` | Class A slugs the agent may execute |
| `approvalSlugs` | Class B/C slugs the agent may request |
| `prohibitedSlugs` | Class D / explicit red lines |
| `memoryRead` | Open Brain / operating memory scope to read |
| `memoryWrite` | What it may capture |
| `budget` | per-run and monthly budget cap, when applicable |
| `outputStates` | valid result states |
| `escalation` | who/where to escalate |
| `auditSurface` | audit destination |

---

## 5. Valid output states

Every heartbeat must end in exactly one primary state:

| State | Meaning |
|---|---|
| `no_action` | Checked queue; nothing needed |
| `drafted` | Prepared a draft; no external send |
| `task_created` | Internal task created |
| `approval_requested` | Class B/C approval opened |
| `blocked_missing_data` | Cannot proceed without required facts |
| `failed_degraded` | Connector/source unavailable or degraded |
| `expired` | Approval/action window expired |
| `escalated` | Human attention required |

Avoid vague “success.” A run is only useful if it produces a business state.

---

## 6. Approval behavior

### Class A

Agents may proactively perform Class A observe/prepare actions if registered in the taxonomy and allowed by their contract. Examples include:

- `system.read`
- `open-brain.capture`
- `draft.email`
- `internal.note`
- `hubspot.task.create`
- `lead.enrichment.write`
- `brief.publish`
- `audit.sample.score`
- `connector.health.post`
- `research.post.tagged`

### Class B/C

Agents may proactively prepare evidence packets and open approval requests for registered Class B/C actions. They may not execute the underlying action before approval.

Every approval request must include:

- action slug,
- target entity,
- evidence and source citations,
- confidence,
- rollback plan,
- proposed approver(s),
- idempotency key.

### Class D

Agents must refuse and escalate. Do not open routine approval cards for Class D red-lines.

Red-lines include, but are not limited to:

- `secret.share`
- `data.delete.prod`
- `permissions.modify`
- `contract.sign`
- `system.destructive`
- `pricing.discount.rule.change`
- `qbo.chart-of-accounts.modify`
- `qbo.investor-transfer.recategorize`
- `qbo.journal-entry.autonomous`
- `qbo.period.close.reopen`
- `ad.claim.publish-unreviewed`
- `customer.data.export-external`

---

## 7. Task checkout and idempotency

No heartbeat should create duplicate work.

Before opening an approval, creating a task, drafting an email, or preparing a packet, the agent must derive a deterministic idempotency key from the source entity and action type.

Examples:

| Lane | Idempotency basis |
|---|---|
| Buyer reply | Gmail thread id + message id + action slug |
| HubSpot stale deal | deal id + stale-window bucket |
| Sample shipment | sample request id + destination + SKU/qty |
| Vendor master | normalized vendor name + tax id/email + approval slug |
| Receipt bill draft | receipt/review packet id + `qbo.bill.create` |
| Reorder follow-up | account id + last order id + cadence bucket |

Duplicate findings should return `no_action`, `duplicate`, or `blocked_missing_data`, not open repeated approvals.

---

## 8. Memory behavior

Every material heartbeat should read memory and write memory when it changes state.

### Read memory for

- prior corrections,
- buyer/vendor/account history,
- doctrine locks,
- recent approvals,
- recent failures,
- duplicate decision context.

### Write memory for

- important decisions,
- corrections,
- doctrine changes,
- blockers,
- material buyer/vendor state,
- degraded-mode discoveries,
- final run summaries when business-impacting.

Memory writes must include provenance, timestamp, source surface, confidence, and fingerprint/dedupe key.

Secrets must be redacted before persistence.

---

## 9. Budget and cost control

Before activating broad autonomous research or high-frequency watchers, each agent should have:

- per-run budget cap,
- monthly budget cap,
- model/tool allowance,
- run frequency,
- stop condition.

Research agents R-1 through R-7 remain latent until external tools and spend limits are approved.

Do not activate all research pods at once.

---

## 10. Dashboard requirements

`/ops/agents/packs` should evolve into the heartbeat status surface.

It should eventually show, per agent/pack:

- heartbeat cadence,
- last run,
- next run,
- last output state,
- failures/degraded status,
- budget spent/limit,
- approvals opened,
- tasks created,
- drafts produced,
- blocked items,
- drift/lockstep warnings.

The dashboard remains a read model. It does not become source of truth.

---

## 11. First proactive cash-flow lane: B2B Revenue Watcher

After P0 completion, the first true proactive revenue agent should be the B2B Revenue Watcher.

### Cadence

- 8:00 AM PT
- 12:00 PM PT
- 4:00 PM PT
- business days initially

### Inputs

- Gmail buyer threads,
- HubSpot contacts/companies/deals/tasks,
- Faire invite/follow-up queue,
- Shopify/Faire/wholesale order signals where available,
- operating memory corrections.

### Outputs

- hot buyer replies,
- overdue replies,
- sample requests lacking shipment,
- onboarding blockers,
- reorder opportunities,
- stale deals with no next action,
- draft replies,
- approval requests.

### Allowed actions

- `system.read`
- `draft.email`
- `internal.note`
- `hubspot.task.create`
- `lead.enrichment.write`
- `open-brain.capture`
- request `gmail.send`
- request `shipment.create`
- request `hubspot.deal.stage.move`

### Forbidden

- send email without approval,
- custom pricing promise,
- discount rule change,
- HubSpot stage move without approval,
- Shopify pricing/cart changes,
- QBO writes,
- Class D actions.

---

## 12. Activation order

1. Finish P0 foundation, including P0-6.
2. Add heartbeat metadata to agent registry entries.
3. Build repo-native `src/lib/ops/agent-heartbeat/*` primitives.
4. Extend `/ops/agents/packs` with heartbeat status.
5. Build B2B Revenue Watcher.
6. Add Vercel cron schedules for watchers.
7. Add budget/run-count tracking.
8. Activate research runtime only after tool and budget decisions.

---

## 13. Engineering constraints

- Prefer pure helpers with dependency injection.
- Add tests before marking implemented.
- Do not add new approval slugs unless explicitly directed.
- Do not introduce a new scheduler framework without approval.
- Use existing route auth patterns.
- Never claim a run is green unless tests/build were actually run.
- Do not mutate docs/contracts from runtime auditors; report for human review.

---

## 14. Final doctrine

The Ryan Mathews / Paperclip lesson to import is not “zero-human company.”

The correct lesson is:

> Manage AI agents like employees through roles, queues, heartbeats, budgets, approvals, memory, and durable logs.

USA Gummies already has the approval and doctrine foundation. The next layer is heartbeat activation: turning contract-backed agents into scheduled, bounded, cash-flow-producing operators.
