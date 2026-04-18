# `src/lib/ops/control-plane`

USA Gummies 3.0 — Layer 5 control plane. Pure, storage-agnostic core.

## Canonical spec

[USA GUMMIES 3.0 — RESEARCH BLUEPRINT](https://www.notion.so/3454c0c42c2e81a1b6f4f35e20595c26) — §14, §15.

Do not add behavior to this module that contradicts §15. If the blueprint changes, update this module; if this module grows behavior the blueprint doesn't cover, write it up before merging.

## Surface

| Module | Role |
|---|---|
| `types.ts` | All shared types: divisions, channels, approvals, audit entries, run context, health, violations. |
| `taxonomy.ts` | Approval classes A/B/C/D + registered action specs. Fail-closed on unknown actions. |
| `approvals.ts` | Pure state machine: build, apply decision, stand-down, check expiry, escalate. Storage adapter interface. |
| `audit.ts` | Write + human-write loggers. Storage adapter interface. |
| `run-id.ts` | Run identity helpers. Every agent invocation mints one run_id. |
| `divisions.ts` | Typed registry of the 6 active + 6 latent divisions. |
| `channels.ts` | Typed registry of the 9 active + 5 latent Slack channels. |
| `index.ts` | Public exports. Import from here. |

## Storage — currently TODO

The control plane is storage-agnostic. Two adapters need to be implemented to go live:

- `ApprovalStore` (see `approvals.ts`) — persists approval requests and decisions.
- `AuditStore` (see `audit.ts`) — appends audit entries, supports listing by run/agent/recency.

**Recommended backend:** Vercel KV for the first week (low latency, zero-setup, cheap), migrated to a dedicated Postgres schema by end of week 2 once volume and retention requirements firm up. The blueprint's §15.4 Tuesday step 5 gates this.

Stub implementations belong at `src/lib/ops/control-plane/stores/` when added.

## Slack surface — currently TODO

Two surfaces need implementation:

- `ApprovalSlackSurface` (see `approvals.ts`) — posts approval requests to `#ops-approvals` with tap-to-approve buttons; updates the thread on decision.
- `AuditSlackSurface` (see `audit.ts`) — mirrors every audit entry as a one-line post to `#ops-audit`.

**Implementation note:** Slack writes failing must not invalidate persisted state. The store is authoritative; Slack is a mirror.

Recommended location: `src/lib/ops/control-plane/slack/`.

The Slack interactive-message webhook handler at `src/app/api/slack/approvals/route.ts` is the other half — not yet built. §15.4 Tuesday step 6 ("Start posting all agent writes to #ops-audit") gates this.

## What this module is NOT

- **Not a scheduler.** Cadence (cron, /loop, QStash) lives elsewhere; the control plane is invoked by those.
- **Not an LLM client.** No prompt templates, no Anthropic SDK calls.
- **Not a connector.** HubSpot/QBO/Shopify/Amazon clients live at `src/lib/...` and call into this.
- **Not a memory layer.** Open Brain (Supabase pgvector) is separate.

## Deprecations this module replaces

- `src/lib/ops/engine-schedule.ts` — empty stub, was the hook for the retired 70-agent Abra registry.
- `src/lib/ops/notify.ts` — empty stub, was the Slack/SMS/iMessage fan-out for Abra.

Both are marked DEPRECATED (see file headers) but left in place so imports from legacy code don't break. Delete after all callers migrate.

## Tests

`__tests__/approvals.test.ts` exercises the full state machine:
- class-D rejection (ProhibitedActionError)
- unknown action (UnknownActionError, fail-closed)
- class-B single-approver happy path + reject + ask
- class-C dual-approver: one approve stays pending, two approve → approved; single reject → rejected
- approver authority check + no double decisions
- stand-down
- 24h escalation + 72h expiry windows

Run with `npm test` (vitest is already in `vitest.config.ts`).
