# Agent Contract — Booke

**Status:** CANONICAL (day-one, in-the-loop)
**Version:** 1.0 — 2026-04-18
**Division:** `financials`
**Human owner:** Rene
**Schema:** [`/contracts/governance.md`](../governance.md) §3

---

## Identity

- **agent_id:** `<uuid — minted on first run>`
- **agent_name:** `BOOKE`
- **model:** Booke AI (third-party SaaS — not an LLM agent in our control plane, but governed by the same contract discipline). When Booke flags an item, the control plane treats the flag as an input event, not an autonomous LLM decision.
- **temperature:** n/a (deterministic categorizer)
- **cost_budget_usd_per_day:** $0.67 (Booke Starter $20/mo / 30 days)

## Role

One job: auto-categorize bank transactions in QBO and flag anomalies. Rene is the final authority on every categorization outside the learned allow-list.

## Boot ritual

1. Pull current QBO Chart of Accounts (via `GET /api/ops/qbo/accounts`).
2. Pull last 30 days of bank feed via Plaid (read-only).
3. Pull Booke's running learned-rules list.
4. Log session start to Open Brain with `division:financials actor:booke`.

## Read scope (Class A)

| System | Scope |
|---|---|
| QBO | Chart of Accounts, recent transactions, vendor list |
| Plaid | Bank balance + transaction feed |
| Gmail | `Receipts` / `AI/Order Issue` labeled threads only — for matching receipts to transactions |
| Open Brain | `division:financials` tags — prior categorizations + Rene's corrections |

## Write scope

| Action slug | Class | Approver | Notes |
|---|---|---|---|
| `qbo.transaction.categorize` | **A** (autonomous) | none | Only if the vendor/amount pattern matches a learned rule with confidence ≥ 0.95 |
| `qbo.transaction.flag_anomaly` | **A** | none | Pushes the flag to `#finance` via the audit surface |
| `qbo.transaction.categorize.low_confidence` | **B** | Rene | Confidence < 0.95 → Rene approves |
| Everything else in QBO | — | **PROHIBITED** | Booke never edits beyond categorization |

## Prohibited

- Creating or deleting QBO accounts, vendors, or customers.
- Modifying invoices, POs, or sales receipts.
- Editing categories on transactions already reviewed by Rene.
- Categorizing Rene-investor-transfer events as anything other than `Loan from Owner` (liability). Hard rule per `/contracts/governance.md` §1.
- Categorizing Amazon FBA inbound-inventory transfers as revenue (Amazon is consignment — revenue only when Amazon sells).

## Heartbeat

`event` — triggered by Plaid bank-feed webhook or Booke's internal categorizer cycle.

## Memory

- **memory_read:** `division:financials category:categorization-rule`, `category:rene-correction`, `vendor:<normalized-name>`.
- **memory_write:** every categorization result (with `confidence`, `rule_matched`, `vendor_key`) + every Rene correction verbatim.

## Audit

- **audit_channel:** `#ops-audit` (one-line mirror per write).
- **Division channel on flag:** `#finance` with tier = `action` when an anomaly is surfaced.

## Escalation

- **Rene** is the primary; every Class B low-confidence categorization lands in `#ops-approvals` mentioning `@Rene`.
- If Rene has 10+ pending Class B approvals for > 24h, escalate tier = `warning` with mention to Ben in `#ops-alerts`.

## Health states

- **green** — all sources (QBO, Plaid, Booke) reachable; last 24h Rene-correction count ≤ 1.
- **yellow** — source stale > 6h OR 2+ Rene corrections in 24h. Flag all categorizations with `[YELLOW]`.
- **red** — QBO or Plaid unreachable OR 3+ Rene corrections in 24h. Pause all Class A writes; queue everything as Class B pending Rene.

## Graduation criteria

Booke is already on-the-loop for Class A (learned-rule auto-categorization). No further graduation — expansion beyond categorization is prohibited per contract.

## Violation consequences

| Violation | Action |
|---|---|
| Autonomous Class A write with confidence < 0.95 | Correction logged; categorization reverted; 3 in 24h → health = RED, Class A paused for 24h. |
| Categorization of a Rene-investor-transfer as income | Immediate pause. Ben + Rene review. |
| Amazon-to-FBA transfer booked as revenue | Immediate pause. Ben + Rene review. |

## Weekly KPI

- **Auto-categorization accuracy:** ≥ 95% of all categorizations accepted by Rene without correction.
- **Rene-facing exception volume:** < 5 genuine exceptions per week (not counting first-time vendors).

## Version history

- **1.0 — 2026-04-18** — First canonical publication.
