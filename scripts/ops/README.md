# `/scripts/ops` — Operator CLI tools

Thin wrappers over `/api/ops/control-plane/*` for humans and for Make.com scenarios.

## Auth tiers

Two distinct secrets — do not reuse them as the same value:

- **`CRON_SECRET`** — required for every routine operator script (violations, corrections, list-paused, daily brief, drift audit, all inspect endpoints). Header: `Authorization: Bearer`.
- **`CONTROL_PLANE_ADMIN_SECRET`** — required ONLY for admin-tier mutations (currently: `unpause-agent.mjs`). Header: `X-Admin-Authorization: Bearer`. Ben-only. Possession of this secret IS the authorization — the unpause route always attributes to "Ben" regardless of body content, so body-supplied `actor` is ignored.

Override `CONTROL_PLANE_BASE_URL` (default `https://www.usagummies.com`) for local dev.

## Scripts

| Script | Secret | Route |
|---|---|---|
| `append-violation.mjs` | `CRON_SECRET` | `POST /api/ops/control-plane/violations` |
| `append-correction.mjs` | `CRON_SECRET` | `POST /api/ops/control-plane/corrections` |
| `list-paused.mjs` | `CRON_SECRET` | `GET /api/ops/control-plane/paused` |
| `daily-brief.mjs` | `CRON_SECRET` | `POST /api/ops/daily-brief?kind=<morning\|eod>&post=<true\|false>` |
| `smoke-openai-workspace-connector.mjs` | `OPENAI_WORKSPACE_CONNECTOR_SECRET` | `GET/POST /api/ops/openai-workspace-tools/mcp` |
| `unpause-agent.mjs` | **`CONTROL_PLANE_ADMIN_SECRET`** | `POST /api/ops/control-plane/unpause` |
| `control-plane.mjs` | — | Shared helpers (not invoked directly). |

## Daily brief

Use the canonical route, not local scripts that talk to Gmail/HubSpot/Slack directly:

```bash
# Compose only; no Slack post
CRON_SECRET=... node scripts/ops/daily-brief.mjs --kind morning --dry

# Post to the configured daily-brief Slack channel
CRON_SECRET=... node scripts/ops/daily-brief.mjs --kind morning --post
```

## Inspection (no dedicated script; curl the endpoints directly)

```bash
# Recent scorecards
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/scorecards?limit=5" | jq .

# Pending approvals
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/approvals?mode=pending" | jq .

# Recent audit
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/audit?mode=recent&limit=20" | jq .

# Audit by agent over last 7 days
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/audit?mode=by-agent&agentId=viktor&sinceDays=7" | jq .

# Violations in last 7 days, filtered by agent
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/violations?agentId=viktor&windowDays=7" | jq .
```

## ChatGPT workspace connector smoke

Read-only by default. It checks MCP discovery, `tools/list`, `search`, and `fetch`.

```bash
OPENAI_WORKSPACE_BASE_URL=https://www.usagummies.com \
OPENAI_WORKSPACE_CONNECTOR_SECRET=... \
node scripts/ops/smoke-openai-workspace-connector.mjs
```

Optional approval-tool smoke opens a real Slack approval; only set both vars intentionally:

```bash
OPENAI_WORKSPACE_SMOKE_APPROVAL_TOOL=request_receipt_review_approval \
OPENAI_WORKSPACE_SMOKE_APPROVAL_ARG=rcpt_... \
OPENAI_WORKSPACE_CONNECTOR_SECRET=... \
node scripts/ops/smoke-openai-workspace-connector.mjs
```
