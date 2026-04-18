# System Governance Contract — USA Gummies 3.0

**Status:** CANONICAL
**Source:** Notion blueprint §1, §6, §14.6, §14.7
**Version:** 1.0 — 2026-04-17
**Governance anchor:** NIST AI RMF — documented roles, inventorying, ongoing review, decommissioning.

---

## 1. Non-negotiables

1. **Single source of truth per domain.** No domain has two systems-of-record. Conflicts resolved by designating one canonical system; the other becomes a read-only mirror or is retired.
2. **Every agent output carries source, timestamp, confidence.** No claim without a citation. "I don't have that data" is an acceptable answer; a guess is never acceptable.
3. **Every autonomous write is logged to `#ops-audit`** with destination, entity id, actor, before/after, run_id.
4. **Financial / customer-facing / shipping / money-moving actions require explicit per-instance human approval** until the agent has graduated. Graduation is earned by measured reliability, not calendar time.
5. **Every agent has exactly one job.** No generalists. Bounded scope, specific tools, specific measurable output.
6. **Connector failure forces degraded-mode disclosure, not invented certainty.** Agents say so and escalate; they do not fabricate.
7. **Secrets never live in Notion, Slack, or plaintext repo files.** Secrets live in managed stores (macOS Keychain, Vercel env, Supabase secrets).
8. **Slack is the human command/approval/audit surface. Not the database.**
9. **No feature flags, backwards-compatibility shims, or "just this once" exceptions.** Rules are revised in writing, not bypassed.
10. **Weekly drift audit is mandatory.** Reasoning quality is measured and logged.

## 2. The six-layer operating stack

| Layer | Role | Implementation |
|---|---|---|
| L1 — Source Systems | Transactional truth | Shopify, Amazon SP-API, HubSpot, QBO, Plaid, ShipStation, Gmail, GA4, Meta/Google Ads, Faire |
| L2 — Capture & Routing | Deterministic event bus | Make.com (20 live scenarios), webhooks, QStash |
| L3 — Domain Memory | Persistent semantic memory | Open Brain (Supabase pgvector, `open_brain_entries`) |
| L4 — Specialist Agents | Bounded LLM agents, one job each | Viktor, Booke, Finance, Ops, Research agents, etc. |
| L5 — Control Plane | Policy engine, approval state machine, audit log | `src/lib/ops/control-plane/` |
| L6 — Human Surface | Slack command/approval/audit | `#ops-daily`, `#ops-approvals`, `#ops-audit`, `#ops-alerts`, division channels |

## 3. Agent contract schema (every specialist must satisfy)

Every agent contract includes:
- `agent_id` (uuid), `agent_name`, `division`, `owner_human`
- `model`, `temperature` (= 0 for deterministic behavior)
- `boot_ritual` — required steps that run every session start
- `read_scope` — exact systems + scopes
- `write_scope` — exact systems + scopes + per-action approval class
- `prohibited` — explicit red lines
- `heartbeat` — cron | event | on-demand
- `memory_read` — Open Brain tags/filters consulted before acting
- `memory_write` — Open Brain tags written after acting
- `audit_channel` — `#ops-audit`
- `escalation` — human + trigger
- `health_states` — green | yellow (degraded) | red (down)
- `graduation_criteria` — 14-day pass conditions to expand scope
- `violation_consequences` — what happens on a rule break
- `weekly_kpi` — measured output
- `cost_budget_usd_per_day` — hard cap

## 4. Graduation criteria

An agent graduates from `in-the-loop` to `on-the-loop` for a specific action class when, for that class:

- **14 consecutive days** with zero contract violations
- **≥ 10 successful approvals** with zero human corrections in the window
- **100% of outputs** carried source + timestamp + confidence (audit-verified)
- **Zero corrections** logged in the `corrections` table during the window
- **Ben explicitly signs off** in a Notion graduation record

Any single violation during the window resets the counter.

## 5. Weekly drift audit

- **When:** Sunday 8 PM PT
- **Owner:** Claude Code (automated)
- **Procedure:**
  1. Sample 10 random agent outputs from the previous week.
  2. Verify each against ground truth in the relevant system of record.
  3. Score: correct / partial / wrong / hallucinated.
  4. Count corrections logged during the week.
  5. Count violations per agent.
  6. Post scorecard to `#ops-audit` + archive in Notion.
  7. Agents with ≥ 2 violations in a week → auto-paused pending Ben review.

This replaces the self-graded "Sunday Standup Operating Contract v1.0 Review" pattern, which was optimistic about its own health.

## 6. Correction protocol

When Ben, Rene, or Drew says an agent is wrong:

1. Agent STOPS arguing immediately.
2. Agent logs `{timestamp, field, wrong_value, correct_value, corrected_by, division}` to the `corrections` table in Open Brain.
3. Agent asks for the correct figure/state.
4. If ≥ 2 corrections in 24h for a single agent → health = RED, agent paused.
5. If the same correction repeats across ≥ 3 days → contract revision required before unpause.

## 7. Secret governance

- **Allowed stores (only):**
  1. macOS Keychain (local dev)
  2. Vercel environment variables (production)
  3. Supabase Secrets (Edge Functions)
- **Prohibited stores:** Notion page bodies, Slack messages, plaintext files checked into the repo, `claude_desktop_config.json` body, per-agent `.env` files scattered across workspaces.
- **Rotation schedule:**
  - Shopify Admin token: every 90 days
  - AWS IAM keys (SP-API): every 90 days
  - Amazon LWA refresh token: rotate after account changes
  - Open Brain MCP access key: post-leak rotate now, then 180 days
  - Slack tokens: only if leaked or scope changes
  - `CRON_SECRET`: 180 days
- **Leak response:** any secret found outside an allowed store triggers `#ops-alerts` critical and immediate rotation by Ben.

## 8. Documentation canonicalization

- **Notion:** one page per topic. Older versions get `[SUPERSEDED YYYY-MM-DD]` suffix and move to `/Archive` teamspace.
- **Repo:** exactly two identity files at root — `CLAUDE.md` (AI operating officer scope) and `AGENTS.md` (frontend code-edit scope). Everything else is deprecated or moved into `/contracts/` or `/ops/`.
- **Agent contracts** live in Notion (human-readable) and in this repo under `/contracts/` (machine-readable). They are kept in lockstep by the weekly drift audit.
- **CLAUDE.md references must exist as files.** No dangling references.

## 9. What the control plane does (scope guard)

The control plane (`src/lib/ops/control-plane/`) is the policy engine + approval state machine + audit log + typed registry for divisions and channels. It is **not**:

- a scheduler (cadence is external)
- an LLM client (no Anthropic SDK calls here)
- a connector (HubSpot/QBO/Shopify clients live outside and call in)
- a memory layer (Open Brain is separate)

## 10. Red lines (Class D — never autonomous)

See `/contracts/approval-taxonomy.md` Class D. Agents must refuse and escalate if asked to perform any Class D action.

## Version history

- **1.0 — 2026-04-17** — First canonical publication. Derived from blueprint §1, §6, §14.6, §14.7.
