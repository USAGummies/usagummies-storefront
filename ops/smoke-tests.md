# Smoke Tests — USA Gummies 3.0

**Purpose:** one-pass post-deploy verification. Every test is a single `curl` (or CLI) with an expected response. Run top to bottom after the go-live runbook completes — catches any drift between config and runtime.

**Prereq:**
```bash
export CRON_SECRET=<from Vercel env>
export BASE=https://www.usagummies.com   # or http://localhost:3000 for local
```

---

## A. Authentication gates

### A.1 — Unauth requests return 401
```bash
curl -s -w '\n%{http_code}\n' -o /dev/null "$BASE/api/ops/control-plane/health"
# expect: 401
```

### A.2 — Bearer CRON_SECRET returns 200
```bash
curl -s -w '\n%{http_code}\n' -o /dev/null \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/health"
# expect: 200 (or 503 if any component is still unready)
```

### A.3 — Wrong token returns 401
```bash
curl -s -w '\n%{http_code}\n' -o /dev/null \
  -H "Authorization: Bearer not-the-right-token" \
  "$BASE/api/ops/control-plane/health"
# expect: 401
```

---

## B. Health readiness

### B.1 — Full health dump
```bash
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/health" | jq .
```

Expect JSON with `ok`, `degraded`, `summary`, `components.*`.

**Acceptance before go-live:** `ok: true`. `degraded: false` is the ultimate target; during rollout `degraded: true` is acceptable as long as every reason is a known item on [`blocked-items.md`](blocked-items.md).

---

## C. Control-plane admin endpoints

### C.1 — List paused (should be empty on first go-live)
```bash
curl -sH "Authorization: Bearer $CRON_SECRET" "$BASE/api/ops/control-plane/paused" | jq .
# expect: { ok: true, count: 0, paused: [] }
```

### C.2 — List pending approvals
```bash
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/approvals?mode=pending" | jq .
# expect: { ok: true, mode: "pending", count: 0, approvals: [] }
```

### C.3 — Recent audit (should have the seed entries if Step 8 ran)
```bash
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/audit?mode=recent&limit=10" | jq .
```

### C.4 — Append a violation (seed) + verify
```bash
node scripts/ops/append-violation.mjs \
  --agentId viktor --division sales --kind missing_citation \
  --detail "Smoke test seed" --detectedBy self-check

curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/violations?agentId=viktor&windowDays=1" | jq .
# expect: count >= 1, last entry agentId=viktor
```

### C.5 — Append a correction (seed) + verify
```bash
node scripts/ops/append-correction.mjs \
  --agentId viktor --division sales --correctedBy Ben \
  --note "Smoke test seed"

curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/corrections?windowDays=1" | jq .
# expect: count >= 1
```

### C.6 — Unpause a non-paused agent returns 409 (no-op safety)
```bash
curl -s -w '\n%{http_code}\n' \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"not-really-paused","reason":"smoke test"}' \
  "$BASE/api/ops/control-plane/unpause"
# expect: 409, body { ok: false, error: "not-paused", ... }
```

---

## D. Drift audit end-to-end

### D.1 — Dry run (no violations → no pauses)
```bash
curl -X POST -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/drift-audit" | jq '.scorecard.enforcement, .enforcement'
# expect: scorecard.enforcement.mode = "not-needed" unless violation seeding is volumous
```

### D.2 — Scorecard persisted → visible in recent audit
```bash
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/scorecards?limit=1" | jq .
# expect: count=1, scorecards[0].summary contains "samples=" + "enforcement="
```

### D.3 — Auto-pause actually fires (stress test)
Append 2 violations for one agent then re-run the audit:
```bash
for i in 1 2; do
  node scripts/ops/append-violation.mjs \
    --agentId viktor-smoke --division sales --kind stale_data \
    --detail "smoke stress $i" --detectedBy drift-audit
done

curl -X POST -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/drift-audit" | jq '.scorecard.agentsAutoPaused, .scorecard.enforcement'
# expect: agentsAutoPaused includes "viktor-smoke", enforcement.mode = "enforced"

curl -sH "Authorization: Bearer $CRON_SECRET" "$BASE/api/ops/control-plane/paused" | jq .
# expect: count >= 1, paused[].agentId includes "viktor-smoke"

# Clean up (unpause so live operations aren't affected by smoke test):
node scripts/ops/unpause-agent.mjs --agentId viktor-smoke --reason "smoke test cleanup" --actor Ben
```

---

## E. Daily brief end-to-end

### E.1 — Morning brief, no post
```bash
curl -X POST -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/daily-brief?kind=morning&post=false" | jq '.brief.meta, .degraded'
```

Expect `brief.meta.kind="morning"`. `degraded` may be true until revenue integrations are wired — that is expected.

### E.2 — Body override renders in brief
```bash
curl -X POST -sH "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"revenueYesterday":[{"channel":"Shopify DTC","amountUsd":100,"source":{"system":"smoke","retrievedAt":"2026-04-20T00:00:00Z"}}]}' \
  "$BASE/api/ops/daily-brief?kind=morning&post=false" | jq '.brief.blocks' | grep -E 'Shopify|100'
# expect: the channel name + amount appear in the rendered blocks
```

### E.3 — Morning brief with Slack post
```bash
curl -X POST -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/daily-brief?kind=morning" | jq '.post, .degraded'
```

When SLACK_BOT_TOKEN is configured: `post.ok: true`, `post.ts` is a Slack ts. Go verify a message landed in `#ops-daily`.

---

## F. Slack interactivity route

### F.1 — Signing-secret-missing returns 503 (fail-closed)
Only run if SLACK_SIGNING_SECRET is intentionally unset in a test env; otherwise skip.

### F.2 — Bad signature returns 401
```bash
curl -s -w '\n%{http_code}\n' \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "x-slack-request-timestamp: $(date -u +%s)" \
  -H "x-slack-signature: v0=bogus" \
  -d "payload=%7B%22type%22%3A%22block_actions%22%7D" \
  "$BASE/api/slack/approvals"
# expect: 401
```

Real interactivity verification requires posting from Slack's test-harness — covered in go-live Step 5 (Viktor pipeline-value query triggers a real approval → Ben clicks → this route fires).

---

## G. End-to-end happy path

Only runs after go-live Step 5 (Viktor prompt live). In `#sales`:

1. Ben says `@viktor draft a follow-up to Jungle Jim's based on the Apr 15 thread`.
2. Viktor drafts + posts a Class B `gmail.send` approval request to `#ops-approvals`.
3. Ben clicks **Approve**. The Slack approval route fires; the decision is recorded; a `runtime.agent-unpaused`-style human audit entry appears in `#ops-audit`.
4. Viktor follows through with the send (or, if Viktor's send pipeline isn't wired, the approval state transitions to `approved` and the send is queued for manual execution until the send automation lands).

Verify:
```bash
curl -sH "Authorization: Bearer $CRON_SECRET" \
  "$BASE/api/ops/control-plane/approvals?mode=by-agent&agentId=viktor&limit=5" | jq .
```

Expect the approval with `status: "approved"` and a `decisions` array containing Ben's approve.

---

## Exit criteria

Every section passes → the 3.0 control plane is operationally verified. Ben signs off in Notion per blueprint §15.5.
