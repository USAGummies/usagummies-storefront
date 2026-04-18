# Activation Triggers — USA Gummies 3.0

**Status:** CANONICAL
**Source:** Notion blueprint §14.3 (latent divisions) + §15.4 W4
**Version:** 1.0 — 2026-04-18
**Machine-readable mirror:** [`/contracts/divisions.json`](divisions.json) → `latent[].activation_trigger`

---

## Purpose

The 3.0 Monday stack has **6 active divisions** and **6 latent divisions**. Latent divisions have contracts written but no live Slack surface, no heartbeat, no agent runtime. They stay latent until an explicit, measurable criterion fires — at which point the activation procedure in this doc converts them into an active division without reopening the blueprint.

**Do not activate a latent division "because it feels useful."** That is the §15.6 first-week anti-pattern. Activation is event-driven, not opinion-driven.

## Activation principles

1. **Trigger is measurable.** Every trigger is a specific number over a specific window, observable from a system of record — not a gut feeling.
2. **Owner is named.** One human (Ben by default) owns the activation decision once a trigger fires.
3. **Channels and agents are pre-staged.** The first-wave Slack channel, the first-wave agent contract, and the division row in `/contracts/divisions.json` are already written. Activation is a flip, not a design.
4. **Activation is logged.** Ben's flip is a Class B approval in the taxonomy (see §"What this actually automates" below for the exact runtime state).
5. **Deactivation rule.** If the trigger metric drops below its activation threshold for 30 consecutive days, the division goes back to latent. Deactivation is a Class B approval.

## What this actually automates (runtime reality)

Keeping this section honest so nobody reads an activation checklist and assumes the listed slugs will turn into real runtime behavior on their own. Four status buckets — registered, audit-emittable, automated, or manual:

| Capability | Status | Notes |
|---|---|---|
| `division.activate` / `division.deactivate` approval slugs | **Registered** in [`/contracts/approval-taxonomy.md`](approval-taxonomy.md) + [`src/lib/ops/control-plane/taxonomy.ts`](../src/lib/ops/control-plane/taxonomy.ts) as of 2026-04-18 v1.1. | Ben can open these via the existing `/api/slack/approvals` flow; `record()` / `requestApproval()` accept them without fail-closed. |
| `pod.trade-show.activate` / `pod.trade-show.deactivate` | **Registered** alongside the division slugs. | Same approval flow. |
| Approval events for activation → audit log | **Audit-emittable** by default. | Every approval decision already writes a `buildHumanAuditEntry()` with the approval id + before/after; the Slack approvals route at [`src/app/api/slack/approvals/route.ts`](../src/app/api/slack/approvals/route.ts) does this for every click. Scorecard-style `division.activate` entries (e.g. "division=marketing-paid → active, trigger=trailing-30d-ad-spend=$1250") ride on the existing audit path. |
| Flipping `state` in `/contracts/divisions.json` + `/contracts/channels.json` | **Manual commit** by Claude Code after the approval is approved. | No runtime code flips these — they are source of truth; the TypeScript registries mirror them in lockstep and both update together. Blueprint §6.6 doc-canonicalization rule. |
| Creating the first-wave Slack channel | **Manual** by Ben (Slack admin). | Slack channel-creation API calls are intentionally outside the control plane's write scope — workspace admin is Class D-adjacent territory. |
| Writing the first-wave agent contract under `/contracts/agents/<name>.md` | **Manual commit** by Claude Code. | Contract schema + latent-division pointers already exist; the commit is the activation event. |
| Announcement in `#ops-daily` after activation | **Manual** by Ben (or by the daily brief composer on the next tick). | The daily-brief endpoint ([`src/app/api/ops/daily-brief/route.ts`](../src/app/api/ops/daily-brief/route.ts)) surfaces the active-divisions roster from the `listDivisions("active")` registry, so an activation automatically shows up in the next brief once the JSON flip commit lands and is deployed. |

**Net effect:** an activation is a four-step sequence (approve → commit → Slack channel create → agent-contract commit), not a single runtime flip. The approval slugs being registered is step one; the remaining three stay manual until there's enough activation volume to justify automating them.

---

## Trigger registry

### LD-1 · Marketing — Brand

- **Division id:** `marketing-brand`
- **Human owner on activation:** Ben
- **First-wave Slack channel:** `#marketing` (shared with Marketing — Paid on first activation of either)
- **First-wave agent(s):** Content agent (draft-only — post approval only).

**Trigger (either condition):**

| Condition | Source | Measurement window | Threshold |
|---|---|---|---|
| Scheduled brand campaign exists | Notion `brand` calendar | Any time | ≥ 1 campaign scheduled with a launch date within 21 days |
| Sustained publishing cadence | Git blog MDX commits + Notion social schedule | Last 2 weeks | ≥ 2 posts / week, 2 weeks in a row |

**Measurement owner:** Ben (manual check during Friday weekly review); can be automated later by a read-only cron scanning `content/blog/*.mdx` + the Notion brand calendar.

**Activation checklist (when trigger fires):**

1. Ben opens a Class B `division.activate` approval (target: `marketing-brand`) referencing the trigger measurement.
2. On approve: Research Librarian flips `state` in `contracts/divisions.json` → `active`; runtime reflects via `isActive()` on next import (deploy-gated).
3. Create `#marketing` Slack channel (if not already present) and pin the purpose line from `channels.json` → `latent.marketing.purpose`.
4. Publish the Content-agent contract under `/contracts/agents/content.md` (not yet written — gating on activation).
5. Post activation announcement to `#ops-daily` with link to the new contract + the trigger evidence.

**Deactivation:** 30 days with < 1 post/week AND no scheduled campaigns in the forward 30-day calendar → Class B `division.deactivate`.

---

### LD-2 · Marketing — Paid

- **Division id:** `marketing-paid`
- **Human owner on activation:** Ben
- **First-wave Slack channel:** `#marketing` (shared with Marketing — Brand)
- **First-wave agent(s):** Triple Whale Moby AI (attribution), Madgicx (Meta), Google Ads agent. All Class A read-only at activation; any budget mutation is Class B.

**Trigger (either condition):**

| Condition | Source | Measurement window | Threshold |
|---|---|---|---|
| Monthly ad spend | Meta Ads API + Google Ads API settlements in QBO | Trailing 30 days | > $1,000 |
| Attribution pixel installed | Shopify Admin app list | Any time | Triple Whale Shopify app installed AND a pixel event seen in the last 24h |

**Measurement owner:** Claude Code via a weekly cron job (Friday 9 AM PT) comparing QBO ad-spend totals to threshold; also surfaces the Triple Whale pixel presence via GA4 event list.

**Activation checklist:**

1. Ben opens Class B `division.activate` (target: `marketing-paid`) with the trailing-30-day spend or pixel-install evidence attached.
2. On approve: write agent contracts under `/contracts/agents/` for Madgicx, Triple Whale Moby, Google Ads. Publish read-scope = ads APIs + GA4; write-scope = budget/creative mutations are Class B Ben-approved.
3. Ensure `#marketing` channel exists (activate per LD-1 if needed) or reuse.
4. Add `marketing-paid` to `/contracts/divisions.json` → `active`.
5. Announce in `#ops-daily`.

**Deactivation:** trailing 30d spend < $500 AND pixel uninstalled → Class B `division.deactivate`.

---

### LD-3 · Trade Shows & Field

- **Division id:** `trade-shows-field`
- **Human owner on activation:** Ben
- **First-wave Slack channel:** `#trade-shows` (created per show — see Pod model below)
- **First-wave agent(s):** Trade-show coordinator agent. Class A only at activation; all outbound (pitch emails, booth orders) routed through Viktor per the Sales division.

**Trigger (hard gate):**

| Condition | Source | Measurement | Threshold |
|---|---|---|---|
| Booth booked | Ben's calendar + QBO (paid booth invoice) | Single event | Booth confirmed for a specific show with a confirmed date |

**Measurement owner:** Ben (manual — the act of booking fires the trigger).

**Pod model:** Unlike the other latent divisions, Trade Shows activates **per event**, not permanently. Each booked show spins up a short-lived "pod" — a `#trade-shows-<slug>` channel (e.g. `#trade-shows-reunion-2026`) and a trade-show agent instance scoped to that one event. The pod closes 14 days after the show ends (post-show follow-up window). If a second show is booked before the pod closes, they run in parallel with separate channel slugs.

**Activation checklist (per show):**

1. Ben posts a Class B `pod.trade-show.activate` approval in `#ops-approvals` with the show name, dates, booth location, booth budget line in QBO.
2. On approve: create `#trade-shows-<slug>` channel with purpose pinned from this doc.
3. Publish a per-show agent contract under `/contracts/agents/trade-show-<slug>.md` with the division set to `trade-shows-field`.
4. Wire the booth-order form (already exists) to post to the show-specific channel.
5. Announce in `#ops-daily` with channel + show dates + budget.

**Deactivation (per pod):** 14 days after show end date → Class B `pod.trade-show.deactivate`. Channel archived, agent contract marked `[RETIRED <date>]`, deals tagged `referring_trade_show=<slug>` stay in HubSpot under the persistent Sales division.

---

### LD-4 · Outreach / Partnerships / Press

- **Division id:** `outreach-partnerships-press`
- **Human owner on activation:** Ben
- **First-wave Slack channel:** `#outreach-pr`
- **First-wave agent(s):** PR agent (draft-only — press pitches drafted, Ben approves per-send per Class B `gmail.send`).

**Trigger (either condition):**

| Condition | Source | Measurement window | Threshold |
|---|---|---|---|
| Inbound press volume | Gmail label `Press/Inbound` + HubSpot `Press` contact property | Trailing 30 days | ≥ 5 distinct inbound press inquiries |
| Dedicated PR push launched | Ben's explicit decision recorded in Notion `PR tracker` | Any time | PR campaign with a named target outlet list + 30-day calendar |

**Measurement owner:** Claude Code via a weekly cron scanning the `Press/Inbound` Gmail label; cron posts a silent capture to Open Brain unless the count ≥ 5.

**Activation checklist:**

1. Ben opens Class B `division.activate` (target: `outreach-partnerships-press`).
2. On approve: publish PR-agent contract under `/contracts/agents/pr.md`. The contract mirrors `viktor.md`'s thread-history + per-send approval pattern.
3. Create `#outreach-pr` channel.
4. Wire R-7 Press Research output (which is already active) to feed the new PR agent's research queue directly, instead of landing only in the Librarian's weekly synthesis.
5. Announce in `#ops-daily`.

**Deactivation:** trailing 30d press volume < 2 AND no active campaign → Class B `division.deactivate`.

---

### LD-5 · Customer Experience

- **Division id:** `customer-experience`
- **Human owner on activation:** Ben
- **First-wave Slack channel:** `#cx`
- **First-wave agent(s):** Gorgias AI (Tier 1 auto-responder, Class A only — escalates to Ben for safety/allergen/refund issues).

**Trigger (hard gate):**

| Condition | Source | Measurement window | Threshold |
|---|---|---|---|
| DTC support ticket volume | Gmail `AI/Customer Support` label + Shopify contact-form submissions | Sustained 2-week window | > 20 tickets / month (pro-rated: > 10 tickets in the last 2 weeks) |

**Measurement owner:** Claude Code via a weekly cron counting tickets in the window; captures to Open Brain every week regardless of threshold for trend visibility.

**Activation checklist:**

1. Ben opens Class B `division.activate` (target: `customer-experience`).
2. On approve: install and configure Gorgias Starter ($10/mo). Wire to Shopify + Gmail.
3. Publish Gorgias agent contract under `/contracts/agents/gorgias.md` — Class A Tier-1 auto-response (WISMO, return policy, allergen FAQ, shipping Qs); Class B Ben-approved for anything involving refunds, complaints, or safety escalations.
4. Create `#cx` channel.
5. Migrate Gmail `AI/Customer Support` threads into Gorgias inbox.
6. Announce in `#ops-daily`.

**Deactivation:** trailing 30d ticket volume < 5 AND Gorgias subscription cancelled → Class B `division.deactivate`.

---

### LD-6 · Product / Packaging / R&D

- **Division id:** `product-packaging-rd`
- **Human owner on activation:** Ben
- **First-wave Slack channel:** `#product-rd`
- **First-wave agent(s):** Product agent (roadmap + claims review, draft-only).

**Trigger (hard gate):**

| Condition | Source | Measurement | Threshold |
|---|---|---|---|
| First new SKU or formulation decision | Notion `Product roadmap` page creation OR explicit Ben decision recorded in Open Brain | Single event | A new SKU / formulation spec opened (e.g. "sugar-free variant", "seasonal flavor", "vitamin gummy") |

**Measurement owner:** Ben (manual — the act of opening the spec fires the trigger).

**Activation checklist:**

1. Ben opens Class B `division.activate` (target: `product-packaging-rd`) with the new SKU spec link.
2. On approve: publish product-agent contract under `/contracts/agents/product.md`. Scope: formulation compare-and-contrast, claim-compliance review (against R-5 Regulatory findings), vendor tech-spec intake. Prohibited: contacting vendors (that is Ops), setting pricing (that is Finance + Ben), making a go/no-go product decision (that is Ben).
3. Create `#product-rd` channel.
4. Wire R-6 Supply Research + R-5 Regulatory Research to feed the product agent's context on every run.
5. Announce in `#ops-daily`.

**Deactivation:** 60 days with no active SKU spec in `Product roadmap` AND no SKU currently in test-run → Class B `division.deactivate`.

---

## Activation audit trail

Every activation and deactivation leaves a trail in four places. The first two are automated; the last two are manual commits + Slack admin actions.

1. **Approval queue (automated):** `division.activate` / `division.deactivate` / `pod.trade-show.activate` / `pod.trade-show.deactivate` — Class B approvals registered in [`/contracts/approval-taxonomy.md`](approval-taxonomy.md). Ben opens these via `/api/slack/approvals` or the approvals queue.
2. **Audit log (automated, `#ops-audit` + audit store):** the approval decision event is logged by [`src/app/api/slack/approvals/route.ts`](../src/app/api/slack/approvals/route.ts) with approval id, before/after status, and the Slack user who clicked. No separate `activation.division` audit action is required — the `approval.approve` / `approval.reject` entry carries the approval id, and the approval payload itself encodes the target division + trigger evidence.
3. **Canonical data (manual commit by Claude Code):** after approval, a commit flips the `state` field in `/contracts/divisions.json` and `/contracts/channels.json`. Commit message must include the Class B approval id. The TypeScript registry at `src/lib/ops/control-plane/divisions.ts` / `channels.ts` is updated in the same commit.
4. **Slack (manual by Ben):** Ben (or a delegate with Slack admin) creates the new division channel and pins its purpose line from `channels.json`. This is outside the control-plane's write scope — see §"What this actually automates."

## Unregistered trigger = do nothing

If a scenario seems like it should activate a latent division but no trigger here fires, **do not activate**. Open a Class B `contract.revise` approval against this doc to register a new trigger first, then activate against the updated trigger. Blueprint non-negotiable #9: rules are revised in writing, not bypassed.

## Version history

- **1.1 — 2026-04-18** — Added §"What this actually automates" split to call out which capabilities are runtime-real (approval slugs registered; approval decisions logged) versus which are manual (JSON flip commit; Slack channel create; agent-contract write; announcement). Approval-slug rows in `approval-taxonomy.md` updated to v1.1. No overclaiming: Ben opening a Class B approval no longer implies the division is automatically live.
- **1.0 — 2026-04-18** — First canonical publication. Covers all 6 latent divisions per blueprint §14.3 + §15.4 W4.
