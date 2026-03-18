# Prompt 3.5 Remediation Report

## Scope
Stabilization-only pass across Prompts 1-3.
Originally no Prompt 4 feature work.
Current operating status is founder-waiver mode; Prompt 4 execution has started with explicit credential debt tracking (see overnight report).

## Repository fixes completed
Updated workflows:
- `n8n-workflows/W01-gmail-ingestion.json`
- `n8n-workflows/W02-email-classifier.json`
- `n8n-workflows/W10-integration-health.json`

Added/updated migration:
- `supabase/migrations/20260308000006_prompt35_stabilization.sql`

## What was remediated

### 1) Secret hygiene in workflow JSON
- Removed plaintext secrets from W01/W02/W10.
- Replaced with runtime env references:
  - `$env.SUPABASE_SERVICE_ROLE_KEY`
  - `$env.OPENAI_API_KEY`
  - `$env.SLACK_ALERT_WEBHOOK_URL`
- Replaced hardcoded Supabase base URLs in W01/W02/W10 with:
  - `$env.SUPABASE_URL || $env.NEXT_PUBLIC_SUPABASE_URL`

### 2) Silent-failure removal
- Confirmed critical write paths in W01/W02/W10 no longer use `neverError: true`.
- Critical write failures now surface as explicit workflow errors.

### 3) RPC contract repair (W02)
- `release_stale_email_classification_locks` called with `lock_timeout_minutes`.
- `claim_email_events_for_classification` called with `batch_size`, `worker_id`.
- Live RPC checks succeeded (`/tmp/overnight_p35_gate_audit.json`).

### 4) Approval contract hardening (W02)
- Fixed trigger->action mapping:
  - `distributor_response -> contact_distributor`
  - `payment_issue -> commit_funds`
  - `production_decision -> schedule_production`
  - `external_response_draft -> send_email`
  - `commitment -> commit_funds`
- Added defensive normalization for legacy trigger labels.
- Added pending-approval pre-check branch:
  - `Build Approval -> Check Existing Pending Approval -> IF Approval Missing -> Create Approval`
- Removed fragile `on_conflict` from approval insert path.

### 5) Open Brain contract repair (W01)
- W01 payload uses schema-valid values:
  - `entry_type='finding'`
  - `category='email_triage'`
  - `confidence='medium'`
  - `priority='normal'`

### 6) Integration health normalization (W10)
- Canonical workflow contract set to `service_name` + `status`.
- Compatibility fields still written: `system_name` + `connection_status`.

## Live verification evidence
Artifacts:
- `/tmp/p35_verify_summary.json`
- `/tmp/overnight_p35_gate_audit.json`

### Substitute end-to-end chain
Validated:
1. Insert synthetic `email_events` row (`status='new'`) ✅
2. Claim via `claim_email_events_for_classification(batch_size, worker_id)` ✅
3. Release stale lock via `release_stale_email_classification_locks(lock_timeout_minutes)` ✅
4. Patch classification state to `triaged` ✅
5. Create approval row with live-accepted trigger/action contract ✅
6. Insert Open Brain record via `embed-and-store` ✅
7. Upsert integration health with canonical fields ✅
8. Confirm briefing source rows exist (approvals/email/integration_health) ✅

### Contract probes (live)
- `email_events.source_thread_id` exists ✅
- `email_events.thread_id` does not exist ✅
- `integration_health` currently supports both canonical+compat columns ✅
- Approval duplicate probe now returns 409 (DB-level dedupe present for tested key) ✅

## Live drift discovered and handled
- `approvals.approval_trigger` accepts live set including:
  - `distributor_response`, `payment_issue`, `production_decision`, `external_response_draft`, `commitment`, `none`
- It rejects labels like `regulatory_flag` unless normalized.
- W02 normalization was patched to emit live-compatible values.

## Remaining manual remediation (required)

### A) Secret rotation (critical)
Must rotate and rebind runtime secrets:
- Supabase service role key
- Slack webhook used by n8n
- Any other credential previously exposed in workflow/config exports

Note: `OPENAI_API_KEY` from local env currently returns 401 (inactive) in the latest audit.

### B) Runtime credential verification (critical)
After rotation:
- verify new credentials are configured in live n8n credentials/env
- verify Supabase/Vercel runtime references are updated where applicable
- confirm old credentials are invalidated and unusable
- record exactly which runtime systems were verified

### C) Migration pipeline alignment
`20260308000006_prompt35_stabilization.sql` exists in repo but was not applied from this workspace via Supabase CLI due local auth/env limitations.
- Live behavior indicates at least part of the expected DB contract now exists.
- Migration should still be applied through the normal controlled migration pipeline for provenance.

## Prompt 4 readiness
Current state: **CONDITIONAL GO (Founder Waiver)**
- Technical stabilization and substitute E2E checks pass.
- Runtime credential gate is not fully cleared with verified rotation + invalidation evidence across all required systems.
- Prompt 4 is allowed in bounded waiver mode, while credential closure remains a P0 security debt item.
