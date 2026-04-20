# Blocked Items — Manual Actions Required

**Purpose:** Inventory every item that requires Ben / Rene / Drew / manual admin work before the 3.0 build can go fully live. Each entry has the exact command, URL, or payload needed so the blocked human can execute without ambiguity.

**Convention:** items are keyed to Monday checklist IDs (M1, M2a…) where applicable.

## Secret handling rule
- **Never paste full secret values into this file or any tracked repo file.** Use prefix-only references (`shpat_…`, `AKIA…`, `xoxb-…`, `sk-…`) or the literal placeholder `<ROTATE_THIS_TOKEN>`.
- If a secret was previously pasted here, it was redacted on **2026-04-18**. Assume leak; treat rotation as already-overdue.

## P0 manual tasks (tracked, not a build-pause)
Items **B-3..B-8** and **B-12** (secret rotations + Paperclip Slack-bot revoke + admin-tier secret provisioning) are **P0 manual** for Ben. They gate Monday go-live sign-off per blueprint §15.5, but the control-plane build continues in parallel.

## Code-complete status — 2026-04-18

The control plane, stores, Slack surfaces, approval route, daily brief, drift audit, admin API, CLI tools, health endpoint, runtime pause guard, and canonical contracts are all code-complete and tested (139+ green vitest tests, 0 new tsc errors).

What's left is strictly manual/admin work — the items below plus the cutover sequence in [`cutover-sequence.md`](cutover-sequence.md).

**Recommended next human action:** go to [`go-live-runbook.md`](go-live-runbook.md) Step 1.

---

## Ben

### B-1 (M1) — Approve the canonical blueprint
- **Where:** [USA GUMMIES 3.0 — RESEARCH BLUEPRINT](https://www.notion.so/3454c0c42c2e81a1b6f4f35e20595c26)
- **Action:** Add a top-of-page comment: `Approved 2026-04-20 as canonical USA Gummies 3.0 spec — Ben`.
- **Why blocked:** only Ben can sign off.

### B-2 (M2a, M2b) — Unload Paperclip
Paperclip launchd jobs are currently running a zombie loop (691 credit-exhausted failures since 2026-03-31). Unload:

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
# should no longer show paperclip-heartbeat, paperclip-server, or session-archive-monday
```

### B-3 (M3a) — Rotate Shopify Admin token  **[P0]**
- **Where:** Shopify Admin → Apps → Develop apps → your app → API credentials
- **Action:** Revoke the current `shpat_…` token (look it up in the console — never paste the full value here or anywhere in this repo), generate new.
- **Update locations:**
  - `~/Library/Application Support/Claude/claude_desktop_config.json` → `shopify-store.env.SHOPIFY_ACCESS_TOKEN`
  - Vercel env: `SHOPIFY_ADMIN_TOKEN` and any related names (verify with `vercel env ls`).
  - Local `.env.local`.
- **Placeholder in code/docs until replaced:** `<ROTATE_THIS_TOKEN>`.

### B-4 (M3b) — Rotate AWS IAM keys (SP-API)  **[P0]**
- **Where:** AWS IAM console → Users → the IAM user backing SP-API → Security credentials → Access keys
- **Action:** Delete the existing `AKIA…` access key (look it up in the IAM console), create new, copy secret (shown once).
- **Update location:** `~/Library/Application Support/Claude/claude_desktop_config.json` → `amazon-seller-central.env.AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
- **Do NOT commit the full key ID or secret into this repo, Notion, or Slack.**

### B-5 (M3c) — Rotate Amazon LWA refresh token
- **Where:** Amazon Seller Central → Partner Network → Develop Apps (or reauth via your LWA OAuth flow).
- **Action:** Reauthorize. Copy new refresh token.
- **Update location:** `~/Library/Application Support/Claude/claude_desktop_config.json` → `amazon-seller-central.env.LWA_REFRESH_TOKEN`.

### B-6 (M3d) — Rotate Open Brain MCP access key + scrub Notion leak
- **Rotate:**
  ```bash
  # in the worktree that has supabase CLI configured
  mv .env.local .env.local.bak
  supabase secrets set MCP_ACCESS_KEY="$(openssl rand -hex 32)" --project-ref zdvfllvopocptwgummzb
  mv .env.local.bak .env.local
  ```
- **Scrub Notion:** Search all of Notion for `44464eb` (the leaked key prefix). Confirmed location: the Apr 17 Execution Log page. Edit that page → delete the line containing the key. Verify no other Notion page has the substring.
- **Update any consumer of the MCP endpoint** (Claude Code session configs, Claude Desktop config if wired).

### B-7 (M3e) — Rotate CRON_SECRET
```bash
NEW=$(openssl rand -hex 32)
printf '%s' "$NEW" | vercel env add CRON_SECRET production
printf '%s' "$NEW" | vercel env add CRON_SECRET preview
printf '%s' "$NEW" | vercel env add CRON_SECRET development
# update local .env.local
```
- **Verify:** `grep -E '^CRON_SECRET=' .env.local | head -1` — value should not end with `\n`.

### B-8 (M3f) — Revoke Paperclip Slack bot
- **Where:** https://api.slack.com/apps → the Paperclip app → Install App → Revoke / Uninstall.
- **Why:** bot is already `account_inactive`; revoke so the workspace cannot be re-installed silently.

### B-12 (M3g) — Provision CONTROL_PLANE_ADMIN_SECRET  **[P0]**
Admin-tier secret used by `/api/ops/control-plane/unpause` on the `X-Admin-Authorization` header. MUST be a different value from `CRON_SECRET` — the health endpoint refuses to mark `controlPlaneAdminSecret` ready if they match (that defeats the two-tier split).

```bash
NEW_ADMIN=$(openssl rand -hex 32)
# Sanity: make sure it isn't equal to CRON_SECRET
[ "$NEW_ADMIN" = "$CRON_SECRET" ] && echo "REGENERATE — equal to CRON_SECRET" && exit 1
printf '%s' "$NEW_ADMIN" | vercel env add CONTROL_PLANE_ADMIN_SECRET production
printf '%s' "$NEW_ADMIN" | vercel env add CONTROL_PLANE_ADMIN_SECRET preview
printf '%s' "$NEW_ADMIN" | vercel env add CONTROL_PLANE_ADMIN_SECRET development
# store locally for smoke-tests.md §A.4 / C.6 / D.3 cleanup
echo "CONTROL_PLANE_ADMIN_SECRET=$NEW_ADMIN" >> .env.local
```

- **Verify:** after deploy, `curl -sH "Authorization: Bearer $CRON_SECRET" $BASE/api/ops/control-plane/health | jq '.components.controlPlaneAdminSecret.status, .components.unpauseRoute.status'` → both `"ready"`.
- **Storage:** only Ben holds this. Do NOT share in Slack or Notion — it grants unilateral agent-unpause authority.

### B-9 (M4) — Publish the canonical Viktor contract — **DONE 2026-04-19 (DM-based)**

The current Viktor product (app.getviktor.com) has **no admin "system prompt" UI** — confirmed by probing every settings tab and grepping the loaded JS bundle (zero hits for `prompt`/`persona`/`instructions`/`onboarding`/`systemPrompt`). The path described in the original blueprint ("settings → system prompt") was written against an older Viktor product that no longer exists. Modern Viktor configures itself via Slack DM context.

What was actually done:
- Captured pre-cutover Viktor state to `/tmp/viktor-state-2026-04-19.json` and DM tail to `/tmp/viktor-dm-history-2026-04-19.txt` (rollback files outside the repo).
- Delivered the canonical §1–§6 of `/contracts/viktor.md` as a single REFERENCE message in Viktor's DM (channel `D0AQKNXQW2W`, ts `1776644251.092119`). Message explicitly framed so Viktor continues in-flight tasks rather than context-switching.

If Ben observes drift back to pre-cutover behavior (the Apr 17 directives still live in Viktor's DM history), DM Viktor: "use the 2026-04-19 contract as your operating reference; ignore prior instructions that conflict."

### B-10 (M5a, M5b, M5c, M6) — Slack channel migration — **DONE 2026-04-19**

Reality on rollout day: the workspace was already partly migrated. All 9 canonical channels existed; the 4 archive targets below were the entire delta. Per workspace state on 2026-04-19:

| Channel | Status |
|---|---|
| `#ops-daily` (C0ATWJDKLTU) | already existed → joined Ben → topic + starter pinned (incl. Slack Operating Contract summary, M6) |
| `#ops-approvals` (C0ATWJDHS74) | already existed → joined Ben → topic + starter pinned (incl. Approval Taxonomy summary, M6) |
| `#ops-audit` (C0AUQSA66TS) | already existed → joined Ben → topic + starter pinned |
| `#ops-alerts` (C0ATUGGUZL6) | already existed → joined Ben → topic + starter pinned |
| `#sales` (C0AQQRXUYF7) | already existed → topic + starter pinned |
| `#finance` (C0ATF50QQ1M) | already existed → joined Ben → topic + starter pinned |
| `#operations` (C0AR75M63Q9) | already existed → topic + starter pinned |
| `#research` (C08HWA9SRP1) | already existed → topic + starter pinned (incl. T3b tag-convention) |
| `#receipts-capture` (C0APYNE9E73) | already existed → topic + starter pinned |
| `#abra-control` (C0ALS6W7VB4) | **archived** |
| `#customer-feedback` (C0AS7UHDHS6) | **archived** |
| `#wholesale-leads` (C0AS7UHNGPL) | **archived** (not renamed — `#sales` already existed) |
| `#financials` (C0AKG9FSC2J) | **archived** (not renamed to `#finance` — `#finance` already existed; consolidation by archive) |
| `#email-inbox`, `#abandoned-carts`, `#abra-testing` | already archived previously |

Topics set from `contracts/channels.json` → `purpose`. Make Slack bot (`U0ABJC5RQS1`) is a member of all three new Make destination channels (`#sales`, `#operations`, `#finance`).

### B-11 (M8) — Post first manual company brief
- **Where:** `#ops-daily`
- **Contents:** yesterday's Shopify revenue (live query), Amazon settlement day-over-day, Faire relay orders, open approvals count, top priority for the week.
- **Why blocked on Ben:** first brief sets tone and format.

---

## Rene

### R-1 — Confirm the Finance division contract
- **Where:** `#ops-approvals`
- **Action:** Read `/contracts/governance.md` §7 (secrets), `/contracts/approval-taxonomy.md` (Class B/C finance slugs), then post `Approved — Rene` with a link to this contract.

### R-2 — Confirm Booke's scope
- **Where:** `/contracts/agents/booke.md` (created Tuesday by Claude Code)
- **Action:** Read + approve Booke's contract before the drift audit starts scoring it.

---

## Drew

### D-1 — Confirm the Production & Supply Chain contract
- **Where:** `#ops-approvals`
- **Action:** Read `/contracts/governance.md` + the Ops agent contract at `/contracts/agents/ops.md` (Tuesday), post `Approved — Drew`.

### D-2 — Acknowledge fulfillment rule
Confirm in `#operations`:
- Orders ship from Ashford WA via Ben.
- Samples ship East Coast via Drew.
- Drew does NOT ship customer orders. Viktor and agents cannot instruct Drew to ship — all shipment approvals come from Ben per `/contracts/viktor.md` §6.7 + blueprint fulfillment rules.

---

## Claude Code (unblocked; listed for completeness)

Tuesday–Wednesday implementation work that does not need Ben/Rene/Drew:
- `src/lib/ops/control-plane/stores/kv-approval-store.ts`
- `src/lib/ops/control-plane/stores/kv-audit-store.ts`
- `src/lib/ops/control-plane/slack/approval-surface.ts`
- `src/lib/ops/control-plane/slack/audit-surface.ts`
- `src/app/api/slack/approvals/route.ts` (interactive-message handler)
- `src/lib/ops/control-plane/drift-audit.ts` (Sunday 8 PM sampler)
- Agent contracts under `/contracts/agents/`: booke.md, finance-exception.md, ops.md, research-librarian.md, r1-consumer.md through r7-press.md
- Make.com scenario inventory at `ops/make-scenarios.md`

## Outstanding open questions (needed before Monday sign-off per §9 of blueprint)

1. **Research agent hosting:** Vercel cron vs `/loop` on laptop vs new local daemon. **Recommendation:** Vercel cron. **Needs:** Ben confirm.
2. **Secret store for local dev:** macOS Keychain vs 1Password CLI. **Recommendation:** Keychain. **Needs:** Ben confirm.
3. **Research budget:** $/agent/month cap. **Recommendation:** $15/agent ($105 total). **Needs:** Ben confirm.
4. **Press & PR agent tooling (R-7):** Muck Rack vs Feedly Pro. **Recommendation:** Feedly Pro first 90 days. **Needs:** Ben confirm.

## Signal → no-go

If any of the following cannot be completed by EOD Monday, sign-off is deferred:
- Paperclip is still running (B-2 incomplete).
- The Open Brain MCP leaked key is still in Notion (B-6 scrub incomplete).
- Viktor has more than one active contract (B-9 incomplete).
- Any of the 9 Slack channels isn't live with its topic set.
