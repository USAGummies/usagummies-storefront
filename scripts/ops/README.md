# `/scripts/ops` — Operator CLI tools

Thin wrappers over `/api/ops/control-plane/*` for humans and for Make.com scenarios.

All scripts require `CRON_SECRET` in the environment. Override `CONTROL_PLANE_BASE_URL` (default `https://www.usagummies.com`) for local dev.

## Scripts

| Script | What | Route |
|---|---|---|
| `append-violation.mjs` | Seed a `PolicyViolation` (so the weekly drift audit has real input). | `POST /api/ops/control-plane/violations` |
| `append-correction.mjs` | Record a Ben/Rene/Drew correction per governance §6. | `POST /api/ops/control-plane/corrections` |
| `unpause-agent.mjs` | Unpause an auto-paused agent with an audit-captured reason. | `POST /api/ops/control-plane/unpause` |
| `list-paused.mjs` | List currently paused agents. | `GET /api/ops/control-plane/paused` |
| `control-plane.mjs` | Shared helpers (not invoked directly). | — |

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
