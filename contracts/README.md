# `/contracts` — Canonical Operations Contracts

Single source of truth for live operating contracts in USA Gummies 3.0.

## Canonical spec

[USA GUMMIES 3.0 — RESEARCH BLUEPRINT](https://www.notion.so/3454c0c42c2e81a1b6f4f35e20595c26) — §14, §15.

## Contents

| File | Purpose |
|---|---|
| `viktor.md` | **The** Viktor contract. Supersedes `/VIKTOR_OPERATING_CONTRACT.md` and the three Notion Viktor contracts. |
| `governance.md` | System governance — non-negotiables, control plane, drift audit, secret policy, graduation. |
| `slack-operating.md` | Slack operating contract — 9 active channels, thread rules, severity tiers. |
| `approval-taxonomy.md` | Approval classes A/B/C/D with registered actions + approvers. |
| `activation-triggers.md` | Measurable triggers + activation checklists for the 6 latent divisions. |
| `divisions.json` | Machine-readable: 6 active + 6 latent divisions. |
| `channels.json` | Machine-readable: 9 active + 5 latent Slack channels. |
| `agents/` | Per-agent contracts (Booke, Finance Exception, Ops, Research Librarian, R-1..R-7, Viktor at `../viktor.md`). |

## Rules

1. One canonical contract per topic. Older versions in Notion or this repo are marked `[DEPRECATED YYYY-MM-DD]` and do not apply.
2. `divisions.json` and `channels.json` are the data. `src/lib/ops/control-plane/divisions.ts` and `channels.ts` mirror them in TypeScript; the two must stay in lockstep.
3. When a contract changes, increment its `version:` and add a dated entry to its version-history section.
4. Contracts are read by humans and by agents. Keep them operational, not aspirational.

## Deprecations this directory replaces

| Retired | Reason |
|---|---|
| `/VIKTOR_OPERATING_CONTRACT.md` | Apr 13 version forbade all email sends; superseded by the per-send approval model in `viktor.md`. |
| `/SOUL.md` | Abra identity doc; Abra is retired. |
| `/HEARTBEAT.md` | Abra proactive checklist; runtime has been dead 19 days. |
| Notion page "Viktor Operating Contract — Hard Rules & Pass/Fail Criteria" (Apr 10) | Superseded — archive with `[SUPERSEDED 2026-04-17]`. |
| Notion page "Viktor Operating Contract — Management Agent Guardrails" (Apr 12) | Superseded — archive with `[SUPERSEDED 2026-04-17]`. |
| Notion page "Viktor System Prompt v2.0 — Master Prompt (Production Ready)" (Apr 17) | Absorbed into `viktor.md` — archive with `[FOLDED-INTO-CANONICAL 2026-04-17]`. |
