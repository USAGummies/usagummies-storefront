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
| `unpause-agent.mjs` | **`CONTROL_PLANE_ADMIN_SECRET`** | `POST /api/ops/control-plane/unpause` |
| `control-plane.mjs` | — | Shared helpers (not invoked directly). |

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
