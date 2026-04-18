# Cutover Sequence — USA Gummies 3.0

**Purpose:** the explicit ordering for the actual "turn it on" moment. This is the hour-by-hour sequence for Monday (or whichever day cutover happens). Every item is either a human action or a verification — no ambiguity on who does what.

**References:** [`go-live-runbook.md`](go-live-runbook.md) has the setup steps; [`smoke-tests.md`](smoke-tests.md) has the verification; [`blocked-items.md`](blocked-items.md) has the detailed commands for each manual step.

---

## T-24h (Sunday evening)

**Who:** Ben
**Goal:** every precondition green before Monday morning starts.

| Time | Action | Check |
|---|---|---|
| Sun 20:00 PT | Step 1 — rotate all leaked secrets (`blocked-items.md` B-3..B-8) | `git grep -nE 'shpat_[a-f0-9]{16,}\|AKIA[0-9A-Z]{16}'` → empty |
| Sun 20:15 PT | Step 2 — unload Paperclip launchd | `launchctl list \| grep usagummies` shows no paperclip-* |
| Sun 20:30 PT | Step 3 — provision new Slack app + set SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET in Vercel | deploy picks up new env |
| Sun 20:45 PT | `curl /api/ops/control-plane/health` | `components.slackConfig.status = "ready"` |
| Sun 21:00 PT | Confirm KV + Plaid env vars set in Vercel | health shows all stores ready |

**Gate to cutover:** health endpoint returns `ok:true`. If not, resolve the specific `components.*.detail` message before Monday.

---

## T-0 (Monday morning — the actual cutover)

**Who:** Ben (and at 09:00 PT, Rene + Drew)
**Goal:** switch live human traffic to the 3.0 Slack surface + seed the enforcement stores so the stack is fully operational.

### 06:00 PT — Channel migration (15 min)

1. Create the 9 day-one Slack channels per go-live Step 4.
2. Set topics + pin rules from [`contracts/channels.json`](../contracts/channels.json).
3. Invite the new bot to each.
4. Archive legacy channels (`#abra-control`, `#abra-testing`, `#email-inbox`, `#customer-feedback`, `#abandoned-carts`). Rename `#wholesale-leads` → `#sales` (or archive).

### 06:15 PT — Viktor prompt cutover (5 min)

1. getviktor.com → settings → system prompt → clear memory.
2. Paste §2–§6 of `/contracts/viktor.md`.
3. Save. Test with "Viktor, what's our HubSpot pipeline value right now?" in `#sales`.

### 06:20 PT — Seed the enforcement stores (2 min)

```bash
node scripts/ops/append-violation.mjs \
  --agentId viktor --division sales --kind stale_data \
  --detail "Jungle Jim's warm-lead reply sat in Gmail drafts Apr 15-17" \
  --detectedBy human-correction --remediation "Viktor v3.0 thread-history check"

node scripts/ops/append-correction.mjs \
  --agentId viktor --division sales --correctedBy Ben \
  --field deal_stage --wrongValue "Sample Requested" \
  --correctValue "Sample Shipped" \
  --note "Tracking 9405... in thread but HubSpot timeline missed it"
```

### 06:25 PT — Health check (1 min)

```bash
curl -sH "Authorization: Bearer $CRON_SECRET" \
  https://www.usagummies.com/api/ops/control-plane/health | jq '.ok, .degraded, .summary'
```

Expect `ok: true`. `degraded` should now be false OR only degraded due to unrelated items (e.g. revenue integrations not wired — acceptable).

### 06:30 PT — Wire Make.com scheduled scenarios (30 min)

Three scheduled HTTP scenarios per [`make-webhooks.md`](make-webhooks.md) §1:
- Morning brief @ 07:00 PT weekdays
- EOD wrap @ 18:00 PT weekdays
- Drift audit @ Sunday 20:00 PT

Paste the exact curl payloads from §1. First-time: let the 07:00 scenario fire automatically and check `#ops-daily` for the post.

### 07:00 PT — First automated brief (auto)

Make.com fires the scheduled scenario. Daily brief lands in `#ops-daily`. Ben reads it.

### 07:05 PT — First manual company brief (5 min)

Ben posts the human-authored brief to `#ops-daily` — yesterday's revenue, open approvals, week's top priority. Blueprint §15.4 M8. This establishes the format the automated brief will mirror.

### 09:00 PT — Division contract acknowledgments (10 min)

In `#ops-approvals`:
- Ben: `Approved — Ben` with links to governance / Viktor / Slack-operating contracts.
- Rene: `Approved — Rene` with links to Booke + finance-exception contracts.
- Drew: `Approved — Drew` with link to ops contract + fulfillment rule ack.

### 10:00 PT — Smoke tests (15 min)

Run [`smoke-tests.md`](smoke-tests.md) sections A through E. Any failure → stop and resolve before opening Viktor to outbound.

### 12:00 PT — Open Viktor for live outbound (Ben decides)

Viktor has been drafting all morning; this is the first hour Ben approves a real outbound send in `#ops-approvals`. Clicking approve runs the full loop: interactivity route → store update → audit entry → Gmail send.

### 18:00 PT — First EOD wrap (auto)

Make.com fires; EOD brief lands in `#ops-daily`.

### 20:00 PT — Day-1 retrospective (Ben, 15 min)

Run the operator checklist from blueprint §15.4 Wednesday W1: review 24h of routing errors, missed approvals, noisy channels. Notes go in Open Brain (or just a Notion page under `/Operations/Retros`).

---

## T+7d (Sunday night — first weekly drift audit)

### Sun 20:00 PT — Drift audit (auto)

Make.com fires the weekly scenario. Scorecard lands in `#ops-audit`. Ben reviews:
- Any agents auto-paused? If yes: investigate the violation trail, then decide whether to unpause (`node scripts/ops/unpause-agent.mjs --agentId <id> --reason <...>`) or tighten the agent's contract before unpausing.
- Samples flagged `needs-review`? Assign to the relevant human owner.

If the scorecard surfaces nothing actionable, the system is operating cleanly.

---

## Rollback

If the stack misbehaves during cutover:

1. **Slack posts wrong things:** rotate `SLACK_BOT_TOKEN` in Vercel → outbound posts stop (falls into degraded mode, audit continues).
2. **Runaway approvals:** `POST /api/ops/control-plane/unpause` doesn't work for this — instead revoke `SLACK_BOT_TOKEN` to stop outbound, then edit the approval-store entries directly via KV if needed.
3. **Full halt:** rotate `CRON_SECRET`. Every automated endpoint 401s. Slack interactivity still works because it uses the signing secret. When ready, re-set `CRON_SECRET` and re-deploy.
4. **Viktor rogue:** clear getviktor.com system prompt and paste a minimal "I'm in maintenance — do nothing" prompt. All Viktor actions freeze.

Nothing in this sequence can't be rolled back within 5 minutes by changing env vars.

---

## Sign-off

Ben records cutover completion in Notion: date, time, smoke-test passes, any post-cutover punch list items. The punch list goes into a follow-up commit in the repo, not into the Notion master — keep the blueprint page clean.
