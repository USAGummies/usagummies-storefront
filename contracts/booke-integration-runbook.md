# Booke Integration Runbook

**Status:** OPERATOR-RUN — actions in this runbook MUST be performed by Ben or Rene. Claude Code SHALL NOT install credentials, click through Booke settings, or paste tokens in chat.

**Owner:** Ben (issues token) · Rene (verifies in Booke) · Claude Code (consumes via env var only)

**Trigger:** Rene's 2026-05-03 09:47 PT request in `#financials`: *"can viktor have coded access to booke? i need him to grab and evaluate data — all items still require my approval."*

---

## 1. What this gets you

Once the runbook is complete:

- Viktor's W-9 finance close-loop workflow can read Booke's To Review queue, accounts, and vendors directly (no manual extract).
- Viktor proposes category mappings + surfaces discrepancies in `#financials`.
- Rene approves each mapping with a single click; approved mappings flow back to Booke via Class B `booke.category.apply`.
- QBO writes still route through the Class C `qbo.journal_entry.post` approval — Booke access does NOT bypass QBO's dual-approval gate.

What it explicitly does NOT do:

- It does NOT give Viktor direct QBO write access.
- It does NOT auto-back-post into closed periods (closed-period rule still applies).
- It does NOT eliminate the approval-button audit trail — every applied mapping records `:white_check_mark: Approved by gonz1rene: <slug>`.

---

## 2. Steps (Ben + Rene)

### Step 1 — Issue an API token in Booke (Rene, 2 min)

1. Sign in to https://app.booke.ai with the USA Gummies admin account.
2. Settings → Integrations → API tokens (or Developer / API).
3. Click **"Generate token"** with these scopes:
   - `transactions:read`
   - `accounts:read`
   - `vendors:read`
   - `transactions:update_category` (for the future Class B apply lane; no harm enabling now)
4. Name the token: `usa-gummies-viktor-readonly-2026-05-03`
5. Copy the token VALUE. **Do not paste it in Slack.**

### Step 2 — Install the token in Vercel (Ben, 1 min)

```bash
# From the project root, with the token VALUE on your clipboard:
printf '%s' "<TOKEN-VALUE>" | vercel env add BOOKE_API_TOKEN production
printf '%s' "<TOKEN-VALUE>" | vercel env add BOOKE_API_TOKEN preview
printf '%s' "<TOKEN-VALUE>" | vercel env add BOOKE_API_TOKEN development
```

⚠️ Use `printf '%s'` (NOT `echo`) when piping to `vercel env add` — `echo` adds a trailing newline that silently breaks API auth (per CLAUDE.md "Lessons Learned" / Feb 28 audit).

### Step 3 — Trigger a Vercel redeploy (Ben, automatic on next push)

The next push to `main` picks up the new env var. Or kick a manual redeploy in the Vercel dashboard for the current deployment.

### Step 4 — Verify (Rene, 1 min)

After redeploy, hit:

```
GET https://www.usagummies.com/api/ops/email-agents/status
```

(or any auth-gated readiness page) and look for the `BOOKE_API_TOKEN` line — it should flip from `not configured` to `configured`. Once confirmed, message Viktor:

> "viktor — booke access ready, run W-9 against today's close"

Viktor's session will pick up the live token on its next read.

---

## 3. Rotation policy

- Token rotation: every 90 days, OR immediately on any credential leak.
- Rotation step: revoke current token in Booke → repeat Step 1 + Step 2 with a new value.
- Audit: every Booke API call logs `actor=agent:viktor` + `recordedAt` in the existing audit trail. Rene reviews monthly during close.

---

## 4. What happens before this runbook is complete

Until `BOOKE_API_TOKEN` is configured, every Viktor Booke call returns:

```json
{ "ok": false, "configured": false, "reason": "BOOKE_API_TOKEN not configured" }
```

This is by design. Viktor falls back to the `tryKv()` queue-state path (which Rene can keep updating manually via webhook / Zapier bridge if desired), so existing morning briefs stay accurate.

Viktor's W-9 trigger phrases (`prepare book to complete`, `is booke next to complete`, `lets complete amazon`) still fire — Viktor responds with "Booke access not configured yet — operator must complete `/contracts/booke-integration-runbook.md`" instead of guessing or making blind calls.

---

## 5. Why this is bounded (read for Class C / governance review)

| Lane | Class | Approver | What Viktor can do |
|---|---|---|---|
| Booke transaction read | A | none | Read To Review queue, accounts, vendors |
| Booke `category.apply` | B | Rene | Apply a proposed category to a Booke transaction (updates Booke's queue, NOT QBO) |
| QBO write (any) | C | Ben + Rene | Post journal entries / invoices / bills via existing `requestApproval()` flow |

This matches Rene's stated boundary: *"all items still require my approval."* Viktor reads + proposes + applies (in Booke) on Class B; the QBO write lane stays Class C with no change to existing taxonomy.

---

## 6. Version history

- **v1.0 — 2026-05-03** — Initial publication. Trigger: Rene's `#financials` 09:47 PT request after the May-1 Amazon coding close session showed Viktor doing the right work but blocked by missing live access. Aligned with `/contracts/viktor.md` v3.2 W-9 + `/contracts/approval-taxonomy.md` Class B `booke.category.apply` (new) + Class C `qbo.journal_entry.post` (existing).
