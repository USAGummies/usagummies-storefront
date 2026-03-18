# Prompt 4 Runtime Activation Checklist

## Scope
Activate and verify Prompt 4 runtime artifacts created in repo:
- `n8n-workflows/W03-daily-briefing-generator.json`
- `n8n-workflows/W04-company-finance-snapshot.json`
- `n8n-workflows/W06-approval-processor.json`
- `/ops/permissions` + `/api/ops/approvals`

## Prerequisites
1. n8n env has:
- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (if used by workflow path)
- `SLACK_ALERT_WEBHOOK_URL` (optional alert branch)
2. Supabase schema includes Prompt 3.5 compatibility columns.
3. Ops app env includes Supabase URL + service key server-side.

## n8n Import + Activate
1. Import `W04-company-finance-snapshot.json`.
2. Import `W03-daily-briefing-generator.json`.
3. Import `W06-approval-processor.json`.
4. Confirm all HTTP nodes read secrets from `$env.*` (no plaintext).
5. Activate workflows.

## Webhook Setup
1. Copy W06 production webhook URL.
2. Set app env:
- `N8N_APPROVAL_WEBHOOK_URL=<w06-webhook-url>` (preferred server-side routing)
- `NEXT_PUBLIC_APPROVAL_WEBHOOK_URL=<w06-webhook-url>` (optional fallback)
3. Redeploy app if env changed.

## Smoke Tests
### W04
1. Manual trigger W04.
2. Verify `kpi_timeseries` rows for today.
3. Verify financial summary written to `open_brain_entries`.
4. If critical anomaly generated, verify one pending approval row.

### W03
1. Manual trigger W03 after W04.
2. Verify briefing entry written to `open_brain_entries`.
3. Verify summary text contains risk/opportunity line.

### W06 + PWA
1. Open `/ops/permissions`.
2. Confirm pending approvals load.
3. Approve one card; verify `approvals` updated and `decision_log` insert.
4. Deny one card with reasoning; verify denial logged and Open Brain learning row.
5. Retry already-decided approval; expect conflict behavior.

## Evidence to Capture
- Workflow execution IDs (W03/W04/W06)
- Supabase row IDs for:
  - updated approval
  - decision_log row
  - open_brain_entries row
  - kpi_timeseries rows
- Screenshot of `/ops/permissions` success state.

## Security Debt Reminder
Running under founder waiver does **not** close credential debt.
Complete post-execution rotation/rebinding/invalidation for full security closure.
