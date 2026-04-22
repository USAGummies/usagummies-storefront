# Blocked Items — Manual Actions Required

**Purpose:** Inventory every item that requires Ben / Rene / Drew / manual admin work before the 3.0 build can go fully live. Each entry has the exact command, URL, or payload needed so the blocked human can execute without ambiguity.

**Convention:** items are keyed to Monday checklist IDs (M1, M2a…) where applicable.

## Secret handling rule
- **Never paste full secret values into this file or any tracked repo file.** Use prefix-only references (`shpat_…`, `AKIA…`, `xoxb-…`, `sk-…`) or the literal placeholder `<ROTATE_THIS_TOKEN>`.
- If a secret was previously pasted here, it was redacted on **2026-04-18**. Assume leak; treat rotation as already-overdue.

## P0 manual tasks (tracked, not a build-pause)
Items **B-3..B-8** and **B-12** (secret rotations + Paperclip Slack-bot revoke + admin-tier secret provisioning) are **P0 manual** for Ben. They gate Monday go-live sign-off per blueprint §15.5, but the control-plane build continues in parallel.

## Code-complete status — 2026-04-20

The control plane, stores, Slack surfaces, approval route, daily brief, drift audit, admin API, CLI tools, health endpoint, runtime pause guard, and canonical contracts are all code-complete and tested (174 green vitest tests, 0 new tsc errors).

### New since 2026-04-18 (Block 3 + shipping hub + two specialist runtimes)

- **Approval taxonomy v1.2** — 71 total slugs across A/B/C/D, CF-09 channel-segmentation rule encoded in code + doc.
- **AR-split daily brief** — enforces 2026-03-30 Ben correction (drafts ≠ AR).
- **8 specialist contracts added** — executive-brief, platform-specialist, drift-audit-runner, sample-order-dispatch, faire-specialist, compliance-specialist, reconciliation-specialist, inventory-specialist.
- **Viktor W-7 Rene Response Capture** — [`/api/ops/viktor/rene-capture`](../src/app/api/ops/viktor/rene-capture/route.ts) + [`contracts/agents/viktor-rene-capture.md`](../contracts/agents/viktor-rene-capture.md). Live; Viktor handles via his existing Slack presence.
- **Shipping Hub** — [`/ops/fulfillment`](../src/app/ops/fulfillment) with 4-stage machine (received → packed → ready → shipped), carton-progress tracker, tracking-# drop-off, Gmail sample-lead promotion, ShipStation `createLabel` integration, and ShipStation tracking webhook. Fully shipped (Phase 1, 2, 3).
- **Finance Exception Agent runtime** — [`/api/ops/agents/finance-exception/run`](../src/app/api/ops/agents/finance-exception/run/route.ts). Weekday 06:15 PT digest to `#finance`. Live, returning real provenance-tagged data.
- **Ops Agent runtime** — [`/api/ops/agents/ops/run`](../src/app/api/ops/agents/ops/run/route.ts). Weekday 09:00 PT digest to `#operations`. Live.
- **6 cron entries wired** in [`vercel.json`](../vercel.json): health, finance-exception digest, morning brief, ops digest, EOD brief, weekly drift audit.
- **Canonical runtime inventory** — [`contracts/activation-status.md`](../contracts/activation-status.md) (source of truth for "what's live").

### New blocked items (2026-04-20, from shipping hub + agent rollout)

- **B-13 (M9)** — Ben: set `FULFILLMENT_WEBHOOK_SECRET` env on Vercel + register ShipStation webhook (see new section below).
- **B-14 (M10)** — Ben: verify `SHIPSTATION_FROM_STREET1` matches the Ashford warehouse (I defaulted to `30815 SR 706 E` based on the Mettler context — double-check before first real label buy).
- **B-15 (M11)** — Ben + Rene + Drew: smoke-check the first live digest posts tomorrow morning in `#finance` and `#operations` before the 06:15 / 09:00 PT crons run unsupervised for a week.

### New blocked items (2026-04-21, overnight build arc — 33 commits)

- **B-16 (URGENT)** — Ben: top up Stamps.com wallet in ShipStation UI (currently $23.84; floor $100, preflight refuses label buys until $120+). Recommend $150-200.
- **B-17** — Ben: Shopify webhook for `orders/paid`. Shopify Admin → Settings → Notifications → Webhooks. URL: `https://www.usagummies.com/api/ops/webhooks/shopify/orders-paid`. `SHOPIFY_WEBHOOK_SECRET` already set. Once configured, Shopify DTC orders auto-dispatch into `#ops-approvals`.
- **B-18** — Ben: HubSpot webhook for `deal.propertyChange` (dealstage). HubSpot Settings → Integrations → Private Apps → Webhooks. URL: `https://www.usagummies.com/api/ops/webhooks/hubspot/deal-stage-changed`. Set `HUBSPOT_APP_SECRET` env on Vercel for signature-v3 verification.
- **B-19** — Ben + counsel: create Notion `/Legal/Compliance Calendar` database. Minimum columns: Name (title), Due (date), Owner (text), Status (status), Category (select). Until populated, Compliance Specialist runs in `[FALLBACK]` doctrine mode (11 categories listed, no dates). Reference: `src/lib/ops/compliance-doctrine.ts`.
- **B-20** — Ben: `FAIRE_ACCESS_TOKEN` on Vercel when Faire volume justifies. Without it, Faire Specialist stays degraded.
- **B-21** — Ben OR Rene: `BOOKE_API_TOKEN` on Vercel OR wire a Zapier bridge posting to `/api/ops/booke/push` every few hours. Unblocks Finance Exception "Uncategorized transactions" cell.
- **B-22** — Ben: tune `INVENTORY_BURN_RATE_BAGS_PER_DAY` env on Vercel (default 250 is a placeholder). Once sales velocity stabilizes, set this to the real rolling-30d burn. Per-SKU via `INVENTORY_BURN_RATE_<SKU>`.
- **B-23** — Ben: follow up on Stamps.com refund escalation (2026-04-20 email). If no reply, hit the thread with a ping. $130.90 in flight for 17 Viktor voids.
- **B-24** (monitor) — Vercel cron count = 14. Hobby plan historically capped lower; watch the deploy log for cron rejections. Fallback: migrate 2-3 to Make.com.

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

### B-13 (M9) — Register ShipStation tracking webhook  **[PARKED — MFA step]**
- **FULFILLMENT_WEBHOOK_SECRET** is already set on Vercel production (2026-04-20 via Chrome).
- **What's left:**
  1. Navigate to `https://ship14.shipstation.com/settings/api` → **Generate API Key** (12-month expiration). Complete the ShipStation email MFA when it prompts (Claude Code can't reliably automate ShipStation's React-controlled per-digit inputs — this is a 30-second manual step).
  2. The modal shows the new API key + secret **once**. Paste both into Vercel env as `SHIPSTATION_API_KEY` and `SHIPSTATION_API_SECRET` (production + preview).
  3. Then Claude Code can run `POST /api/ops/fulfillment/webhook-register` with bearer `CRON_SECRET` — it's already deployed and reads the creds from Vercel to subscribe the `ITEM_SHIP_NOTIFY` webhook with the correct `?token=<FULFILLMENT_WEBHOOK_SECRET>` URL.
- **What it unlocks:** when UPS scans a label, the webhook promotes the matching fulfillment-hub entry from `ready` → `shipped` automatically. Until then the hub works manually — click **Mark shipped** after the label prints and tracking is in hand.

### B-14 (M10) — Verify Ashford ship-from address
- **Where:** Vercel env vars (production).
- **Action:** Set `SHIPSTATION_FROM_STREET1` / `_CITY` / `_STATE` / `_POSTALCODE` / `_PHONE` to match the Mettler warehouse. I defaulted to `30815 SR 706 E`, Ashford WA 98304, phone `3072094928` — verify these match the warehouse lease address before buying a label.
- **Why blocked on Ben:** only Ben knows the canonical street number for the rental.
- **Safety:** label purchase will return a 400 from UPS if the ship-from fails address validation; cheap to catch but worth verifying before a 30-case PO hits the street.

### B-15 (M11) — Smoke the first two live agent digests
- **Tomorrow (Tuesday) ~06:15 PT:** watch `#finance` for Finance Exception Agent's first live digest (cash / AP / AR / drafts / approvals, all provenance-tagged).
- **Tomorrow (Tuesday) ~09:00 PT:** watch `#operations` for Ops Agent's first live digest (open POs / watched vendors / inventory low).
- **If either is wrong or posts to the wrong channel:** Slack Ben + I'll hot-fix; Rene approves the finance contract in `#ops-approvals` and we leave the cron running. (Drew intentionally out of the loop until Ben re-engages him.)

---

## Rene

### R-1 — Confirm the Finance division contracts
- **Where:** `#ops-approvals`
- **What to read:**
  - [`/contracts/governance.md`](../contracts/governance.md) §7 (secrets) + §1 (non-negotiables)
  - [`/contracts/approval-taxonomy.md`](../contracts/approval-taxonomy.md) Class B/C finance slugs (v1.2, 2026-04-20 — includes the CF-09 channel-segmentation rule)
  - [`/contracts/agents/finance-exception.md`](../contracts/agents/finance-exception.md) — the daily-digest agent that will post to `#finance` at 06:15 PT weekdays
  - [`/contracts/agents/reconciliation-specialist.md`](../contracts/agents/reconciliation-specialist.md) — Thursday-weekly reconcile prep
  - [`/contracts/agents/viktor-rene-capture.md`](../contracts/agents/viktor-rene-capture.md) — Viktor W-7 that captures Rene's `R.NN / J.NN / CF-NN / D.NNN / APPROVED / REDLINE` replies in `#finance`
- **Action:** post `Approved — Rene` in `#ops-approvals` with links to the contracts above.

### R-2 — Confirm Booke's scope
- **Where:** [`/contracts/agents/booke.md`](../contracts/agents/booke.md)
- **Action:** Read + approve Booke's contract before the drift audit starts scoring it. (Booke is external SaaS; the contract governs what we expect from its feed.)

### R-3 — Watch tomorrow's first live finance digest
- **When:** Tuesday 06:15 PT (first live cron).
- **Where:** `#finance`.
- **What you'll see:** BoA checking balance (Plaid), open AP (unpaid bills from QBO), open AR split into sent-outstanding vs drafts-NOT-AR (per the 2026-03-30 rule you drove), pending financials approvals count, uncategorized count (currently "unavailable" until Booke integration lands). If any number is off, Slack Ben — we'll hot-fix.

---

## Drew

_No Drew assignments pending per Ben 2026-04-20. The Production & Supply Chain contracts (ops.md, inventory-specialist.md, sample-order-dispatch.md) remain canonical doctrine, and the Ops Agent runtime posts to `#operations` unassigned. Drew re-enters the blocked-items list when Ben brings him in._

---

## Claude Code (unblocked; listed for completeness)

### Done 2026-04-19..20

- Control-plane stores, Slack surfaces, approval route, drift audit, daily brief — all code-complete, 174/174 vitest green.
- Agent contracts under `/contracts/agents/`: booke.md, finance-exception.md, ops.md, research-librarian.md, r1-consumer.md through r7-press.md, sample-order-dispatch.md, viktor-rene-capture.md, reconciliation-specialist.md, inventory-specialist.md, faire-specialist.md, compliance-specialist.md, executive-brief.md, platform-specialist.md, drift-audit-runner.md.
- Approval taxonomy v1.2 (71 slugs).
- Viktor W-7 Rene Response Capture runtime.
- Shipping Hub (3 phases): stage machine, sample queue, ShipStation `createLabel`, tracking webhook.
- Finance Exception Agent runtime.
- Ops Agent runtime.
- Make.com scenario inventory at `ops/make-scenarios.md`.
- Canonical runtime inventory at [`contracts/activation-status.md`](../contracts/activation-status.md).

### Next (post-cutover, bigger impact first)

1. **ShipStation shipment-history cross-ref** — auto-clears the "paid, verify shipped" flag on wholesale invoices in the fulfillment hub.
2. **Shopify on-hand inventory integration** — lights up Ops Agent inventory-low threshold + ATP honesty in the shipping hub.
3. **Gmail labeled vendor-thread scraper** — Ops Agent surfaces stale Powers/Belmark/Inderbitzin threads.
4. **Booke queue feed** — Finance Exception Agent uncategorized count.
5. **Compliance Specialist runtime** — COI watcher + Approved Claims gate.
6. **Faire Specialist runtime** — Direct-share uplift (requires Faire brand-portal scraper).
7. **Research Librarian + R-1..R-7 agent runtimes** — weekly synthesis + on-demand research. 1-2 week LLM + tool-use build.
8. **Agent health dashboard** at `/ops/agents` — consolidate run history per agent, graduation gauge per non-negotiable §4.

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
