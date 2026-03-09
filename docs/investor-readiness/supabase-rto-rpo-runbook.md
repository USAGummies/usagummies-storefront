# Supabase Dependency Hardening Runbook

## Scope
This runbook covers outage handling for Supabase-backed operational APIs, with primary focus on `/api/ops/approvals`.

## Targets
- RTO (service recovery target): **15 minutes** for read traffic (cached fallback), **60 minutes** for write traffic.
- RPO (data loss target): **0 minutes** for committed writes, **<=10 minutes** for cached read snapshots.

## Runtime Controls
- Circuit breaker state: `supabase-circuit-state`.
- Read fallback cache: `approvals-cache`.
- Fail-open behavior for reads: cached approvals served with `degraded: true`.
- Fail-closed behavior for writes: approval POST operations return `503` while circuit is open.

## Alerting Signals
- `/api/ops/alerts` emits integration alarms when critical connectors are `not_configured` or `stale_credentials`.
- `/api/ops/status` includes `resilience.supabaseCircuit` and nightly failure-injection summary.

## Restore Drill (Quarterly)
1. Simulate Supabase outage by removing service key in staging.
2. Confirm `/api/ops/approvals` GET serves cached response with `source: "cache"` and `degraded: true`.
3. Confirm `/api/ops/approvals` POST returns `503` with circuit metadata.
4. Restore Supabase credentials.
5. Confirm first successful GET clears circuit state and returns `source: "supabase"`.
6. Record timestamped evidence in deployment log.

## Exit Criteria
- Circuit breaker closed (`open: false`).
- Fresh Supabase-backed payload returned for approvals.
- No critical Supabase-related alert remains open.
