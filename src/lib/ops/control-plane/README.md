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
| `record.ts` | Canonical agent write helpers: `record()` (Class A) + `requestApproval()` (Class B/C). Agents go through these; never store/surface directly. |
| `run-id.ts` | Run identity helpers. Every agent invocation mints one run_id. |
| `divisions.ts` | Typed registry of the 6 active + 6 latent divisions. |
| `channels.ts` | Typed registry of the 9 active + 5 latent Slack channels. |
| `stores/` | `InMemoryApprovalStore` + `InMemoryAuditStore` (tests/local); `KvApprovalStore` + `KvAuditStore` (production). Factory in `stores/index.ts` picks by `process.env.VERCEL`. |
| `slack/` | `ApprovalSurface` + `AuditSurface` + minimal Slack Web API client. Degrades gracefully when `SLACK_BOT_TOKEN` is absent (store is authoritative). |
| `index.ts` | Public exports. Import from here. |

Also:
- `src/app/api/slack/approvals/route.ts` — Slack interactivity webhook; verifies signing secret, resolves button clicks through `recordDecision()`, mirrors to `#ops-audit`.

## Storage — wired

- `InMemoryApprovalStore` + `InMemoryAuditStore` in `stores/memory-stores.ts` — tests + local dev
- `KvApprovalStore` + `KvAuditStore` in `stores/kv-stores.ts` — production (Upstash Redis under the `3.0:` namespace)
- `stores/index.ts` — factory `approvalStore()` / `auditStore()`; picks by `process.env.VERCEL`

## Slack surface — wired

- `slack/approval-surface.ts` — block-kit approval message with Approve / Reject / Ask buttons; updates the same message on decision
- `slack/audit-surface.ts` — one-line mirror for each audit entry
- `slack/client.ts` — minimal Slack Web API wrapper; **degraded mode** when `SLACK_BOT_TOKEN` is absent (store is authoritative; surface is best-effort)
- `slack/index.ts` — factory `approvalSurface()` / `auditSurface()`
- `src/app/api/slack/approvals/route.ts` — Slack interactivity webhook; verifies signing secret, routes button clicks through `recordDecision()`

## Canonical agent write path

Agents never call stores or surfaces directly. They call the two helpers in `record.ts`:

```ts
import { record, requestApproval, newRunContext } from "@/lib/ops/control-plane";

const run = newRunContext({
  agentId: "viktor",
  division: "sales",
  source: "on-demand",
});

// Class A — autonomous. Returns AuditLogEntry. Mirrors to #ops-audit.
await record(run, {
  actionSlug: "hubspot.task.create",
  entityType: "task",
  entityId: "t-123",
  result: "ok",
  sourceCitations: [{ system: "hubspot", id: "deal-999" }],
  confidence: 0.9,
});

// Class B/C — gated. Returns ApprovalRequest. Surfaces to #ops-approvals.
// Action does NOT execute yet; it runs after approvers decide.
await requestApproval(run, {
  actionSlug: "gmail.send",
  targetSystem: "gmail",
  payloadPreview: "Reply to Jungle Jim's vendor setup",
  evidence: {
    claim: "Warm lead asked for vendor packet on Apr 15",
    sources: [{ system: "gmail", id: "thread-1", retrievedAt: new Date().toISOString() }],
    confidence: 0.95,
  },
  rollbackPlan: "Recall within 30 minutes",
});
```

Invariants guaranteed by these helpers:
- Unknown action slug → throws (fail-closed).
- Class D action slug → throws `ProhibitedActionError`.
- Class B/C via `record()` → throws (must use `requestApproval()`).
- Class A via `requestApproval()` → throws (must use `record()`).
- Every successful autonomous write appends to the audit store **before** the Slack mirror is attempted.
- Slack mirror failures do NOT fail the audit write. Store is authoritative per blueprint §15.2.

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

4 vitest files, 42 tests total. Run with `npx vitest run src/lib/ops/control-plane/__tests__/`.

- `__tests__/approvals.test.ts` (20) — state machine: class-D rejection, unknown-action fail-closed, B happy/reject/ask, post-ask approve/reject, repeat-ask allowed, C dual-approve flows, duplicate-decision guards, stand-down (no fake human rejection), 24h escalation + 72h expiry.
- `__tests__/memory-stores.test.ts` (8) — store semantics: round-trip cloning, null on unknown id, pending-filter sort, by-agent newest-first + limit, audit recent cap, byRun chronological grouping, byAgent sinceISO cutoff, mutation isolation.
- `__tests__/slack-rendering.test.ts` (4) — surface rendering across pending/approved/rejected/stood-down in degraded mode (no Slack token needed).
- `__tests__/record.test.ts` (10) — end-to-end wiring: Class A → audit store + mirror; Class B/C → approval store + surface + audit approval.open entry; class-D and unknown fail-closed; Slack mirror failure does not fail the audit write; Ben-approves → terminal → `updateApproval` called.
