# Shipping artifacts recovery runbook

**Owner:** Ben (operator) + Claude (code)
**Last firing:** 2026-04-26 — Slack `files:write` scope missing + Drive parent env unset, no labels in `#shipping` since Apr 23.
**Symptom:** Auto-ship pipeline buys labels successfully, ShipStation marks shipped, but every label upload to Slack fails with `getUploadURL failed: missing_scope` AND every Drive write fails. Operator can't see labels in `#shipping` and has nowhere to retrieve PDFs except ShipStation reprint.

---

## Why this runbook exists

The Phase F3.1 auto-ship pipeline writes shipping artifacts to TWO surfaces (Slack `#shipping` for human-visible printing + Google Drive for durable backup). When **both** fail at once, Ben has no visibility into what was shipped without cross-referencing ShipStation, the audit log, and Amazon Seller Central. This is exactly what happened Apr 23-26: 6 labels bought silently, 0 visible in Slack.

This runbook is the playbook for restoring both surfaces, in order, with verification at each step.

---

## Pre-flight check — confirm the symptom

Before firing the recovery, verify the pipeline is actually broken (vs an isolated one-shipment failure).

1. Open Slack `#ops-alerts`. Look for messages like:
   ```
   :warning: Slack file upload FAILED for <order#> — label is bought, just couldn't post the PDF.
   Slack error: `getUploadURL failed: missing_scope`
   ```
2. If you see ≥2 of these in the last 24 hours → the bot scope is broken. Continue with **Stage B-1**.
3. If you see ≥1 with the line `No Drive backup either` → the Drive env is also broken. Continue with **Stage B-2** after B-1.

---

## Stage B-1 — Restore Slack `files:write` scope

### Why

The bot uses Slack's `files.getUploadURLExternal` API to upload PDFs. That endpoint requires the `files:write` Bot Token scope. When the scope is missing, every label upload fails with `missing_scope` BEFORE the channel-attachment step — labels never reach `#shipping` regardless of which channel was targeted.

### Steps (~10 min)

1. **Slack admin** → https://app.slack.com/apps-manage/<your-team-id>
2. Find the bot named **"USA Gummies Ops"** (user ID `U0AUQRVPUN4`)
3. Click **Manage** → **OAuth & Permissions**
4. Scroll to **Bot Token Scopes** → **Add an OAuth Scope** → add **`files:write`**
   - If it's already listed: skip to step 7 — the scope was added but the token wasn't reissued.
5. Scroll to top → click **Reinstall to Workspace**
6. Approve the scope change
7. Copy the new **Bot User OAuth Token** (`xoxb-…`)
8. Update production env in Vercel:
   ```bash
   # From your laptop, in /Users/ben/usagummies-storefront:
   printf '%s' '<paste-new-xoxb-token>' | vercel env rm SLACK_BOT_TOKEN production
   printf '%s' '<paste-new-xoxb-token>' | vercel env add SLACK_BOT_TOKEN production
   vercel --prod
   ```
   (Use `printf '%s'` not `echo` per the trailing-`\n` lesson learned in the env-var hygiene rules.)
9. Wait for the Vercel redeploy to complete (~2 min). Verify with `vercel ls` — most-recent should be your new deployment, status `Ready`.

### Verify B-1

Run the no-op auto-ship dry-run (next stage) — if Slack errors are gone, scope is good.

---

## Stage B-2 — Restore Google Drive parent env

### Why

The auto-ship pipeline uses Drive as the durable fallback when Slack drops a label. The env var `GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID` (or fallback `GOOGLE_DRIVE_UPLOAD_PARENT_ID`) names the parent folder where label PDFs land. If unset OR pointing at a folder the service account can't write to, all Drive writes fail.

### Steps (~5 min)

1. **In Google Drive web UI**, identify (or create) the folder that should hold label PDFs.
   - Suggested: a folder named `USA Gummies / Shipping Artifacts / 2026` under the storefront's shared drive.
   - Note the folder's ID from the URL (`https://drive.google.com/drive/folders/<FOLDER_ID>`).
2. **Confirm the service account has Editor access** to that folder.
   - The service account email lives in `~/.config/usa-gummies-mcp/...` or the Vercel env `GOOGLE_DRIVE_CLIENT_EMAIL`. Find it with:
     ```bash
     vercel env pull .env.vercel-pull --environment=production
     grep GOOGLE_DRIVE_CLIENT_EMAIL .env.vercel-pull
     ```
   - In Drive, share the folder with that email → Editor permission.
3. **Set the env var**:
   ```bash
   # In /Users/ben/usagummies-storefront:
   printf '%s' '<FOLDER_ID>' | vercel env add GOOGLE_DRIVE_SHIPPING_ARTIFACTS_PARENT_ID production
   vercel --prod
   ```
4. Wait for redeploy.

### Verify B-2

After the auto-ship cron runs once (or after the smoke-test fires manually), check `#ops-audit` for `shipping.auto-ship.artifact.drive.write` events. They should now log `result: ok` instead of `result: error`.

---

## Stage C — Smoke test end-to-end

### What

Trigger one auto-ship dry-run and verify the v1.0 SHIPPING PROTOCOL post lands in `#shipping` correctly.

### Steps (~5 min)

1. **From laptop** (or via curl):
   ```bash
   curl -X POST https://www.usagummies.com/api/ops/shipping/auto-ship \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"dryRun": true}'
   ```
2. Response should show `dryRun: true` for any matching orders. Nothing actually shipped (no labels bought, no Slack post). This just confirms the endpoint is reachable.
3. **Now do a real run** (only if there's an actual order in `awaiting_shipment` queue):
   ```bash
   curl -X POST https://www.usagummies.com/api/ops/shipping/auto-ship \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json" \
     -d '{}'
   ```
4. Check Slack `#shipping` — within ~30 seconds you should see ONE top-level post per shipped order in the v1.0 layout:
   ```
   SHIPMENT: <order#>
   To: <recipient> [— <company>]
   Address: <full address>
   From: WA Warehouse (Ashford)
   Carrier: <service>
   Tracking: <number>
   Cost: $<amount>
   Tag: <Sample / Wholesale / FBA / Internal>
   Label: (attached PDF)
   ```
   Plus a thread reply: `Packing slip — <order#>` + packing slip PDF attached.
5. Click the label PDF → verify it opens, prints at 4×6 thermal.
6. Click into the thread → verify the packing slip opens.

If the layout matches → Stage C passes. If anything's off, ping Claude.

---

## Stage D — Backfill the 6 missing labels

After Stages B + C pass, run the backfill route to push the 6 labels from Apr 23-26 into `#shipping` retroactively.

(See `/api/ops/shipping/backfill-to-slack` route for the actual mechanics.)

---

## Hard rules (locked)

- **Never re-buy a label** to get the PDF. ShipStation Reprint is free; rebuy double-charges the postage account.
- **Never DM labels.** `#shipping` is the single source of truth per the v1.0 SHIPPING PROTOCOL Ben pinned 2026-04-10.
- **`files:write` scope is mandatory** for the bot. Without it, label upload fails silently — `#ops-alerts` is the only signal.
- **Drive is the durable fallback.** Even when Slack works, Drive captures the artifact for long-term retrieval. Don't let either surface drift.
