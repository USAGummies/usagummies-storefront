# Go-Live Runbook — USA Gummies 3.0

**Purpose:** step-by-step checklist for taking the 3.0 control plane live. Every step is either a code action (already done) or a manual action (blocked on Ben / Rene / Drew) with exact commands/payloads. No guessing.

**Canonical authority:** Notion blueprint `USA GUMMIES 3.0 — RESEARCH BLUEPRINT` + [`/contracts/`](../contracts/) + [`/ops/`](.).

**Order of operations:** don't skip ahead. The stack degrades gracefully if pieces are missing — but the readiness endpoint will keep returning 503 until each required item is green.

---

## Precondition: environment has all required env vars

Required on Vercel production:

| Env var | Purpose | Status check |
|---|---|---|
| `CRON_SECRET` | scheduled + low-authority admin routes (daily brief, drift audit, violations, corrections, inspect endpoints) | `components.cronSecret.status` |
| `CONTROL_PLANE_ADMIN_SECRET` | **admin-tier mutations only — unpause.** Must be a DIFFERENT value from `CRON_SECRET`. Uses header `X-Admin-Authorization: Bearer …` (not `Authorization`). | `components.controlPlaneAdminSecret.status` + `components.unpauseRoute.status` |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | approval/audit/enforcement stores | `components.approvalStore`/`auditStore`/`pauseSink` = ready |
| `PLAID_CLIENT_ID` + `PLAID_SECRET` | daily-brief cash position | shows up as degraded-but-functional when Plaid isn't yet connected |
| `SLACK_BOT_TOKEN` | outbound Slack posts | `components.slackConfig` needs this to be ready |
| `SLACK_SIGNING_SECRET` | Slack approval route verification | same |

Optional but recommended:

| Env var | Purpose |
|---|---|
| `SLACK_USER_BEN` / `_RENE` / `_DREW` | override paperclip-era default Slack user IDs for approval-route owner resolution |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | alternative KV env var names; either pair works |

Verify all in one shot:

```bash
curl -sH "Authorization: Bearer $CRON_SECRET" \
  https://www.usagummies.com/api/ops/control-plane/health | jq .
```

Expected green state: `ok:true`, `degraded:false`, `summary: "READY — all components healthy"`. Any other state → the `components.*.detail` string is the operator instruction.

---

## Step 1 — Secret rotation (P0, Ben, ~30 min)

Per [`ops/blocked-items.md`](blocked-items.md) §"P0 manual tasks". Do these first — the AWS IAM key, Shopify admin token, and Open Brain MCP key were leaked in historical files and must be rotated before go-live. Exact commands in `blocked-items.md` B-3 through B-8.

Confirm complete by re-checking that no `shpat_` / `AKIA` full-value string exists in the tree:

```bash
cd /Users/ben/usagummies-storefront
git grep -nE 'shpat_[a-f0-9]{16,}|AKIA[0-9A-Z]{16}' -- '**/*.md' '**/*.ts' '**/*.tsx' '**/*.json' && \
  echo "LEAK STILL PRESENT" || echo "clean"
```

## Step 2 — Retire Paperclip (P0, Ben, ~5 min)

Paperclip has been credit-failing every 30 min since 2026-03-31. Unload its launchd jobs and archive the plists so nothing auto-reloads:

```bash
launchctl unload ~/Library/LaunchAgents/com.usagummies.paperclip-heartbeat.plist
launchctl unload ~/Library/LaunchAgents/com.usagummies.paperclip-server.plist
launchctl unload ~/Library/LaunchAgents/com.usagummies.session-archive-monday.plist
mkdir -p ~/Library/LaunchAgents/archive-2026-04
mv ~/Library/LaunchAgents/com.usagummies.paperclip*.plist ~/Library/LaunchAgents/archive-2026-04/
mv ~/Library/LaunchAgents/com.usagummies.session-archive-monday.plist ~/Library/LaunchAgents/archive-2026-04/
```

Verify:
```bash
launchctl list | grep usagummies
# should no longer show paperclip-heartbeat / -server / session-archive-monday
```

## Step 3 — Provision the new Slack app (Ben, ~15 min)

The old Paperclip bot returns `account_inactive`. Create a fresh 3.0 bot:

1. https://api.slack.com/apps → Create New App → From scratch → Name: "USA Gummies Ops 3.0".
2. **Bot Token Scopes** (OAuth & Permissions):
   - `chat:write` (post to channels)
   - `chat:write.public` (post to channels without explicit membership — optional but convenient)
   - `channels:read`, `groups:read` (list channels for admin CLI)
3. **Interactivity & Shortcuts**:
   - Enable → Request URL: `https://www.usagummies.com/api/slack/approvals`
4. **Install to Workspace** → copy the Bot User OAuth Token (`xoxb-...`) → set as `SLACK_BOT_TOKEN` in Vercel.
5. **Signing Secret** (App Credentials) → set as `SLACK_SIGNING_SECRET` in Vercel.
6. Re-deploy so the env is live: `vercel --prod` or push any trivial commit to main.
7. Re-check health: `components.slackConfig.status = "ready"`.

## Step 4 — Create the 9 day-one Slack channels (Ben, ~15 min)

From [`contracts/channels.json`](../contracts/channels.json) `active[]`:

```
#ops-daily  #ops-approvals  #ops-audit  #ops-alerts
#sales  #finance  #operations  #research
#receipts-capture  (already exists — keep)
```

For each:
1. Create (public).
2. Invite the new bot.
3. Set topic to the channel's `purpose` field from `channels.json`.
4. Post the `allowed` / `not_allowed` summary as the first pinned message.

Archive per `channels.json` → `retired_day_one`: `#abra-control`, `#abra-testing`, `#email-inbox`, `#customer-feedback`, `#abandoned-carts`, `#wholesale-leads` (or rename `#wholesale-leads` → `#sales`).

## Step 5 — Publish the canonical Viktor prompt (Ben, ~5 min)

Go to https://getviktor.com → settings → system prompt. Clear memory. Paste §2–§6 of [`/contracts/viktor.md`](../contracts/viktor.md) as the new system prompt. Save.

Test: ask "Viktor, what's our HubSpot pipeline value right now?" in `#sales`. Viktor must query HubSpot live and cite source with `retrievedAt` timestamp.

## Step 6 — Confirm contracts (Ben + Rene + Drew, ~10 min each)

Per Monday checklist item T4a — each division's human owner posts `Approved — <name>` in `#ops-approvals` with a link to their contract:

| Owner | Contract |
|---|---|
| Ben | `/contracts/governance.md`, `/contracts/viktor.md`, `/contracts/slack-operating.md` |
| Rene | `/contracts/agents/booke.md`, `/contracts/agents/finance-exception.md` |
| Drew | `/contracts/agents/ops.md` + fulfillment rule acknowledgment |

## Step 7 — Wire Make.com scenarios (Ben, ~30 min)

Per [`ops/make-webhooks.md`](make-webhooks.md) §1. Create three scheduled HTTP scenarios in Make:

| Schedule (`America/Los_Angeles`) | Request |
|---|---|
| Weekdays 07:00 | `POST /api/ops/daily-brief?kind=morning` |
| Weekdays 18:00 | `POST /api/ops/daily-brief?kind=eod` |
| Sunday 20:00 | `POST /api/ops/control-plane/drift-audit` |

Every request sends `Authorization: Bearer $CRON_SECRET`. Scenarios have no body initially (Plaid cash is fetched server-side, other revenue lines render as "unavailable — not wired" until Make pre-fetch scenarios are added per §4 of `make-webhooks.md`).

## Step 8 — Seed first violation + correction (Ben, ~2 min)

Per health endpoint — violation/correction stores show `degraded` until at least one entry exists. This is by design (so operators can distinguish "never populated" from "measured zero"). Seed one of each to flip them to ready:

```bash
export CRON_SECRET=<from Vercel>

# Seed one violation (e.g., the known historical Jungle Jim's delay)
node scripts/ops/append-violation.mjs \
  --agentId viktor \
  --division sales \
  --kind stale_data \
  --detail "Jungle Jim's warm-lead reply sat in Gmail drafts Apr 15-17" \
  --detectedBy human-correction \
  --remediation "Viktor v3.0 thread-history check installed; 48h dedup gate enforced"

# Seed one correction (Ben correcting Viktor's stage tracking)
node scripts/ops/append-correction.mjs \
  --agentId viktor \
  --division sales \
  --correctedBy Ben \
  --field deal_stage \
  --wrongValue "Sample Requested" \
  --correctValue "Sample Shipped" \
  --note "Tracking 9405550206217111155635 was in the thread but HubSpot timeline missed it"
```

Re-check health — `components.violationStore.status` + `components.correctionStore.status` should flip to ready.

## Step 9 — Run smoke tests (Ben, ~15 min)

See [`ops/smoke-tests.md`](smoke-tests.md) — one-pass walkthrough of every endpoint with curl + expected responses.

## Step 10 — Post the first manual company brief (Ben)

Post to `#ops-daily` by hand: yesterday's Shopify + Amazon + Faire revenue, open approvals count, top priority for the week. This establishes the format the automated brief will mirror.

---

## Final sign-off checklist (blueprint §15.5)

- [ ] Canonical research/blueprint page exists (Notion) ✓ (already landed as `/contracts/`)
- [ ] 6 active divisions assigned + acknowledged (Step 6)
- [ ] 9 Slack channels live with pinned rules (Step 4)
- [ ] Approval taxonomy published (`/contracts/approval-taxonomy.md`) ✓
- [ ] Dead runtime retired (Step 2 — Paperclip; `/SOUL.md` + `/HEARTBEAT.md` + `/VIKTOR_OPERATING_CONTRACT.md` already deprecated-and-forwarded)
- [ ] Exposed secrets rotated (Step 1)
- [ ] Every live HubSpot deal has owner + next_action + next_action_date (Tuesday T1 — separate)
- [ ] `#research` receives tagged `[R-1]`..`[R-7]` findings (scheduled agents haven't been dispatched yet — tracked as post-go-live work)
- [ ] First daily brief posted to `#ops-daily` (Step 10)
- [ ] First audit-log entries visible in `#ops-audit` (auto after first Slack click or admin API call)

When every box is checked, the 3.0 control plane is live.
