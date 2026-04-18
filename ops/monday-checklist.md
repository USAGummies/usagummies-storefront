# Monday–Wednesday Operator Checklist

**Canonical source:** Notion blueprint §15.4. This doc is the deployable operator version — one page, tick-as-you-go.

**Timezone:** Pacific.
**Lead:** Ben (items unless otherwise marked).

Strike through each line as completed. Drop the run evidence (link, screenshot, Git SHA, or Slack ts) in the "Evidence" column.

---

## Monday 2026-04-20 — Establish the control surface

| # | Action | Who | Evidence |
|---|---|---|---|
| M1 | Approve the Notion blueprint page as canonical 3.0 spec (one comment: "Approved 2026-04-20 as canonical"). | Ben | |
| M2a | Unload Paperclip launchd jobs: `paperclip-heartbeat`, `paperclip-server`, `session-archive-monday`. | Ben | |
| M2b | Move `com.usagummies.paperclip*.plist` + `session-archive-monday.plist` out of `~/Library/LaunchAgents/` into `~/Library/LaunchAgents/archive-2026-04/`. | Ben | |
| M2c | Delete two dead Make scenarios: #4711828 (Instantly Reply Detector), #4712381 (Instantly→HubSpot Lead Sync). Revoke Make connection #8312617 (Instantly). | Ben | |
| M2d | Deprecate-and-forward the dead repo runtime. Already applied in the 3.0 landing commit: `SOUL.md`, `HEARTBEAT.md`, and `VIKTOR_OPERATING_CONTRACT.md` now contain a single-paragraph redirect to their canonical replacements under `/contracts/`. Do **not** delete these files — the forwarders stay until every downstream reference is known to be updated (tracked as a post-Monday cleanup item). Also applied: `@deprecated` JSDoc headers on `src/lib/ops/engine-schedule.ts` and `src/lib/ops/notify.ts`, pointing at `src/lib/ops/control-plane/`. | Claude Code | landing commit SHA |
| M3a | Rotate Shopify Admin token (Shopify → Apps → custom apps → regenerate). Update Vercel env + `claude_desktop_config.json`. | Ben | |
| M3b | Rotate AWS IAM SP-API keys (IAM console → delete the current `AKIA…` access key — look it up in the console, never paste the full value into this repo — create new, update `claude_desktop_config.json` only). | Ben | |
| M3c | Rotate Amazon LWA refresh token (Seller Central reauth; update `claude_desktop_config.json`). | Ben | |
| M3d | Rotate Open Brain MCP access key (Supabase secrets → new key). **Delete the line containing `44464eb...` from the Apr 17 Execution Log Notion page.** Search all of Notion for `44464eb` to confirm no other copy exists. | Ben | |
| M3e | Rotate `CRON_SECRET` (Vercel env). Ensure no trailing newline (`printf '%s'` when adding). | Ben | |
| M3f | Revoke the inactive Paperclip Slack bot token permanently via Slack app admin. | Ben | |
| M4 | Reconcile Viktor contract: publish `contracts/viktor.md` (v3.0) as the single live contract; paste its §2–§6 into Viktor's runtime system prompt at getviktor.com (replace the v2.0 prompt). | Ben | getviktor.com save confirmation |
| M5a | Create 9 Monday Slack channels: `#ops-daily`, `#ops-approvals`, `#ops-audit`, `#ops-alerts`, `#sales`, `#finance`, `#operations`, `#research`, `#receipts-capture`. Keep `#receipts-capture` as-is. | Ben | |
| M5b | Archive legacy channels per `contracts/channels.json` → `retired_day_one`: `#abra-control`, `#abra-testing`, `#email-inbox`, `#customer-feedback`, `#abandoned-carts`, `#wholesale-leads` (rename `#wholesale-leads` → `#sales` if easier). | Ben | |
| M5c | Set channel topics to the `purpose` field from `contracts/channels.json`. Post the `allowed` / `not_allowed` summary as the first pinned message in each channel. | Claude Code | paste topics |
| M6 | Post the Slack Operating Contract + Approval Taxonomy into `#ops-daily` (short summary) and `#ops-approvals` (approval-class quick-reference). Links back to `contracts/slack-operating.md` and `contracts/approval-taxonomy.md`. | Claude Code | Slack ts |
| M7 | Produce a Make-scenario inventory: one row per active scenario with `{owner, source_system, destination, failure_path}`. Drop in `ops/make-scenarios.md`. | Claude Code | file |
| M8 | Post the first manual company brief to `#ops-daily`: yesterday's Shopify + Amazon + Faire revenue, open approvals, top priority for the week. | Ben | Slack ts |

### Monday sign-off sub-check

- [ ] Canonical blueprint approved (M1)
- [ ] Paperclip unloaded, 2 Make scenarios deleted, dead repo files removed (M2a–M2d)
- [ ] 6 secret locations rotated, Open Brain key removed from Notion (M3a–M3f)
- [ ] Viktor has exactly one live contract (M4)
- [ ] 9 Slack channels live; legacy channels archived (M5a–M5c)
- [ ] Slack operating contract + approval taxonomy posted (M6)
- [ ] Make inventory committed (M7)
- [ ] First daily brief posted (M8)

---

## Tuesday 2026-04-21 — Move live work into the new model

| # | Action | Who | Evidence |
|---|---|---|---|
| T1 | HubSpot cleanup pass 1: every live deal must have `owner`, `next_action`, `next_action_date`. Start with the 49 Reunion deals + 5 whales. | Ben (Viktor proposes in `#sales`) | HubSpot export count |
| T2 | Gmail triage: clear the 22 stale drafts from Apr 15. **Start with the Jungle Jim's draft (threadId 19d650cb793cc302).** Send or archive each. | Ben | drafts count → 0 |
| T3a | Stand up the unified `#research` process: post first `[R-3]` competitive finding + `[R-4]` channel finding (or whatever is ready) to establish the tag pattern. | Claude Code | Slack ts |
| T3b | Announce `[R-1]..[R-7]` tag convention in `#research` pin. Link to `contracts/slack-operating.md`. | Claude Code | |
| T4a | Confirm contracts for the 6 active division leads (each signed-off by the human owner in `#ops-approvals`). Links: `contracts/viktor.md`, `contracts/governance.md`, `contracts/slack-operating.md`, `contracts/approval-taxonomy.md`. | Ben + Rene + Drew | each approves in `#ops-approvals` |
| T4b | Draft division contracts for Booke, Finance exception agent, Ops/vendor agent, Research Librarian, 7 research specialists (R-1..R-7). Commit to `/contracts/agents/<name>.md`. | Claude Code | commit SHA |
| T5a | Implement `ApprovalStore` (Vercel KV adapter) at `src/lib/ops/control-plane/stores/kv-approval-store.ts`. | Claude Code | commit SHA |
| T5b | Implement `AuditStore` (Vercel KV adapter) at `src/lib/ops/control-plane/stores/kv-audit-store.ts`. | Claude Code | commit SHA |
| T5c | Implement `ApprovalSlackSurface` + `AuditSlackSurface` at `src/lib/ops/control-plane/slack/`. | Claude Code | commit SHA |
| T5d | Implement Slack interactive-message handler at `src/app/api/slack/approvals/route.ts` (tap-to-approve). | Claude Code | commit SHA |
| T6 | Start mirroring every agent write to `#ops-audit` via `logWrite()` → `mirror()`. Start with Viktor, then Booke. | Claude Code | Slack channel populated |

---

## Wednesday 2026-04-22 — Stabilize and measure

| # | Action | Who | Evidence |
|---|---|---|---|
| W1 | 48-hour postmortem: review `#ops-audit` for routing errors, missed approvals, noisy channels. | Ben + Claude Code | notes in Open Brain |
| W2 | Tighten prompts, routing rules, approval thresholds based on actual failures. Update Viktor's runtime prompt from `contracts/viktor.md`. | Claude Code | commit SHA |
| W3a | Turn on recurring daily brief cadence: 7 AM PT morning brief + 6 PM PT EOD wrap in `#ops-daily`. Via Make.com scenario referencing `src/app/api/ops/daily-brief`. | Claude Code | Make scenario id |
| W3b | Turn on weekly drift audit: Sunday 8 PM PT, samples 10 agent outputs, scorecard to `#ops-audit`. Implementation lives in `src/lib/ops/control-plane/drift-audit.ts` (new). | Claude Code | commit SHA |
| W4 | Define activation triggers for the 6 latent divisions in `/contracts/activation-triggers.md`. | Claude Code | file |
| W5 | Score Monday against `§15.5` sign-off checklist (below) and publish the scorecard to `#ops-daily`. | Ben | Slack ts |

---

## §15.5 Sign-off checklist (the rebuild counts as live only when all true)

- [ ] One canonical research/blueprint page exists (Notion page 3454c0c42c2e81a1b6f4f35e20595c26)
- [ ] 6 active divisions are assigned and acknowledged by their human owners
- [ ] 9 Slack channels are live with defined rules (first pinned message present)
- [ ] One approval taxonomy is published and understood (posted in `#ops-approvals`)
- [ ] Dead runtime layers are retired or explicitly quarantined (Paperclip, dead Make, dead repo files)
- [ ] Exposed secrets are rotated or actively in rotation (6 locations)
- [ ] Every live HubSpot deal has a next action and owner
- [ ] Research runs through one visible surface with tagged sub-streams ([R-1]..[R-7])
- [ ] First daily brief has posted to `#ops-daily`
- [ ] First audit log entries are visible in `#ops-audit`

---

## §15.6 Do-not-do list for the first week

- Do not activate the 6 latent divisions.
- Do not create more Slack channels "because they feel useful."
- Do not grant autonomous send / pay / ship authority.
- Do not add more tools until the current tools have one owner and one purpose.
- Do not create another competing blueprint page.
