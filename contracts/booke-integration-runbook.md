# Booke Integration Runbook

**Status:** SUPERSEDED in part — see §0 architectural finding below. Booke has no partner API; Viktor reads QBO directly.

**Owner:** Ben (architecture call) · Rene (W-9 close approver) · Claude Code (consumes QBO read scope; Booke client kept as forward-looking stub)

**Trigger:** Rene's 2026-05-03 09:47 PT request in `#financials`: *"can viktor have coded access to booke? i need him to grab and evaluate data — all items still require my approval."*

---

## 0. ⚠️ Architectural finding (2026-05-03 PM, Chrome verification)

**Booke AI does not have a public partner REST API.** Verified by walking `https://booke.ai`, `https://booke.ai/en-us/sla`, `https://booke.ai/en-us/partner`, `https://docs.booke.ai`, `https://booke.ai/api`, and `https://app.booke.ai` — no developer documentation, no API token settings, no partner API path. Their marketing page actively positions Booke AGAINST API-based architecture:

> *"With API-Based AI Tools — Works outside QuickBooks/Xero and can only suggest basic tasks. Multiple integrations, hours of setup. Learn a new dashboard."*
>
> *"Booke AI works inside QuickBooks/ Xero, just like you. Uses your existing bank connection. Categorizes, matches to invoices/ bills, requests missing documents, reconciles — all automatically. Invite user + connect once."*

Booke's product model is: **invite Booke as a QBO user → Booke logs in and writes categorizations directly to QBO → operators review exceptions in QBO**. There is no separate Booke data store to query — the data lives in QBO.

### What that means for Viktor's W-9 workflow

The "Booke AI 22 items" carry-forward Viktor has been tracking since Apr 11 is really *"22 QBO bank-feed transactions in the For Review tab that Booke has proposed categorizations for."* The right read path is **QBO directly**, not Booke.

Viktor's existing read scope per `/contracts/viktor.md` already covers this:

> *"QBO — via `https://www.usagummies.com/api/ops/qbo/*` — query only — P&L, AR, vendors, invoices for finance Q&A"*

To pull the For Review queue specifically, ship `GET /api/ops/qbo/for-review` (uses QBO's `transactionList` API with bank-feed filter). That's a follow-up build; until then Viktor reads via the existing query endpoints + Rene's manual confirmation in `#financials`.

### What's still useful from this runbook

- The `:white_check_mark: Approved by gonz1rene: <slug>` audit pattern stays canonical.
- The Class B `booke.category.apply` slug is parked for the day Booke ships a partner API (not soon).
- The hard rules locked from the 2026-05-03 close session (no 6000/7000, one bank-matching JE per Amazon deposit, etc.) still apply — they're properties of the close workflow, not of Booke specifically.

### What changes in code

- `src/lib/ops/booke-client.ts` — the REST helpers (`listToReviewTransactions`, `listAccounts`, `listVendors`) stay in place as **forward-looking stubs**. They cleanly return `{ ok: false, configured: false }` because no token will ever land — there is no token to issue. They become live only if Booke ships a partner API (would require a new architectural review at that point).
- The legacy `getBookeQueueState()` KV path stays — Rene/Ben can manually push the count to KV via webhook/Zapier if a daily morning-brief surface is wanted. That path is unaffected.
- The W-9 Slack trigger (`booke status` / `is booke next` / etc.) remains useful — it surfaces the readiness state + doctrine reminder in-thread when Rene starts a close session. The card now correctly says *"Booke writes to QBO; the data lives there. Viktor reads QBO For Review."*

### Doctrinal answer to Rene's question

*"can viktor have coded access to booke?"* → **Functionally yes, structurally no.** There's nothing to grant — Booke doesn't expose a partner API. But the underlying ask (*"i need him to grab and evaluate data"*) is already satisfied by Viktor's existing QBO read scope. The 22 To Review items Booke is processing live in QBO; Viktor reads them via `/api/ops/qbo/*` directly. The approval boundary Rene specified (*"all items still require my approval"*) is preserved by the existing Class B/C lanes — no change.

---

## 1. ~~What this gets you~~ (superseded by §0)

The original §1 below is preserved for history but no longer applies as written. Read §0 for the corrected architecture.

Once the runbook is complete:

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

- **v1.1 — 2026-05-03 PM** — §0 architectural finding added after Chrome verification: Booke does NOT expose a partner REST API. Their product model is "invite Booke as a QBO user; data lives in QBO; review exceptions in QBO." Viktor's correct read path is QBO For Review via the existing `/api/ops/qbo/*` read scope, not a Booke API. The booke-client REST helpers stay as forward-looking stubs (return `not configured` cleanly because no token will ever land). The Class B `booke.category.apply` slug is parked for the day Booke ships a partner API — until then, the Class B/C QBO write lanes are the only relevant approval boundaries. Steps §2–§5 below are preserved for history but no longer execute against a real API.
- **v1.0 — 2026-05-03** — Initial publication. Trigger: Rene's `#financials` 09:47 PT request after the May-1 Amazon coding close session showed Viktor doing the right work but blocked by missing live access. Aligned with `/contracts/viktor.md` v3.2 W-9 + `/contracts/approval-taxonomy.md` Class B `booke.category.apply` (new) + Class C `qbo.journal_entry.post` (existing).
