# `/contracts/agents` — Active-Division Specialist Contracts

One contract per agent. Schema is defined in [`/contracts/governance.md`](../governance.md) §3. Each contract follows the same shape so drift between agents is measurable.

## Canonical spec

[USA GUMMIES 3.0 — RESEARCH BLUEPRINT](https://www.notion.so/3454c0c42c2e81a1b6f4f35e20595c26) §14–§15.

## Active-division inventory (Monday day-one)

| File | Division | Human owner | Purpose |
|---|---|---|---|
| [`../viktor.md`](../viktor.md) | Sales | Ben | Slack Q&A, HubSpot hygiene, outreach drafts (per-send approval) |
| [`booke.md`](booke.md) | Financials | Rene | Auto-categorize bank transactions in QBO; flag anomalies |
| [`finance-exception.md`](finance-exception.md) | Financials | Rene | Finance exception triage, digest composition, Rene coordination |
| [`ops.md`](ops.md) | Production & Supply Chain | Drew | Vendor + PO + shipping coordination, sample watcher, inventory thresholds |
| [`research-librarian.md`](research-librarian.md) | Research & Intelligence | Ben | Cross-cutting synthesis across R-1..R-7; weekly digest; entity dedup |
| [`r1-consumer.md`](r1-consumer.md) | Research & Intelligence | Ben | Consumer research |
| [`r2-market.md`](r2-market.md) | Research & Intelligence | Ben | Market / category research |
| [`r3-competitive.md`](r3-competitive.md) | Research & Intelligence | Ben | Competitive intelligence |
| [`r4-channel.md`](r4-channel.md) | Research & Intelligence | Ben | Channel / retailer research |
| [`r5-regulatory.md`](r5-regulatory.md) | Research & Intelligence | Ben | Regulatory research |
| [`r6-supply.md`](r6-supply.md) | Research & Intelligence | Ben | Ingredient / supply-chain research |
| [`r7-press.md`](r7-press.md) | Research & Intelligence | Ben | Press / media research |

**Executive Control & Governance** (Division 1) and **Platform / Data / Automation** (Division 6) are run by the control plane itself and by Claude Code respectively — covered by [`/contracts/governance.md`](../governance.md), not duplicated as separate agent contracts.

## Rules

1. One agent, one contract, one human owner. Changes increment the version and add a dated version-history entry.
2. `agent_id` is a placeholder (`<uuid>`) until the agent is first registered at runtime. At that point the UUID is minted by `newRunContext()` in `src/lib/ops/control-plane/run-id.ts` and written back to the contract by the next commit.
3. Every contract must resolve every action in `write_scope` against a slug in [`/contracts/approval-taxonomy.md`](../approval-taxonomy.md). Agents cannot invoke unregistered slugs (fail-closed per control plane).
4. Contracts are read by humans and by agents. Keep them operational, not aspirational.
5. Monday activation gate: Ben, Rene, or Drew (owner per division) must approve the corresponding contracts in `#ops-approvals` before the agent is turned on.
