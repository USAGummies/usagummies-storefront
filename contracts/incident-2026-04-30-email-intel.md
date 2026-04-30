# Incident — Email-Intel auto-replier (Eric Miller / Event Network)

**Status:** CONTAINED · root-cause classifier + template fixes shipped 2026-04-30 AM
**Date of incident:** 2026-04-29 9:00 PM PT (cron tick `0 4 * * *` UTC = 21:00 PT)
**Date of postmortem:** 2026-04-30 AM
**Owner:** Ben (containment) · Claude Code (postmortem + classifier/template fixes)
**Recovery:** Manual correction email sent 12:03 AM PT 4/30 by Ben.
**Public-facing impact:** 1 prospect (Eric Miller @ Event Network) received a confused-looking sample-offer reply after he had already confirmed sample receipt + active review. Recoverable; not catastrophic.

---

## 0. Re-enable doctrine (DO NOT FLIP UNTIL ALL THREE ARE TRUE)

`EMAIL_INTEL_ENABLED=true` MUST NOT be set, and the cron entries MUST NOT be re-added to `vercel.json`, until ALL THREE of the following hold:

- [x] **Classifier fix shipped + tested.** `samples arrived` / `samples received` / `team is reviewing` and 14 other "already-received" phrases now exclude the `sample_request` category. See §3 + the regression test fixtures in `src/lib/ops/email-intelligence/__tests__/classifier.test.ts`.
- [x] **Template audit complete.** All 8 templates in `src/lib/ops/email-intelligence/draft.ts` audited against `/contracts/outreach-pitch-spec.md` §1 / §5 / §6 / §8. The `sample_request` and `b2b_sales` templates were rewritten; the other 6 (`ap_finance`, `shipping_issue`, `customer_support`, `vendor_supply`, `marketing_pr`, `receipt_document`, `junk_fyi`) had no SKU references and pass clean.
- [ ] **Approval-gate audit complete.** Pending Ben's confirmation that the gate did/did-not behave correctly during the incident (see §4 — the bypass mechanism Ben described in the incident brief was NOT found in the code path; the most likely actual mechanism is human approval-without-reading).

The first two boxes ticked = the structural regression is fixed. The third remains because the postmortem can't fully reconstruct the live run without the actual Slack approval log.

---

## 1. Timeline

| Time (PT) | Event |
|---|---|
| 2026-04-27 (week prior) | Ben emails Eric Miller @ Event Network offering samples; samples shipped |
| 2026-04-28 day-of | Eric replies confirming receipt at 9645 Granite Ridge; team is reviewing |
| 2026-04-29 21:00 | `0 4 * * *` UTC cron fires `GET /api/ops/fulfillment/email-intel/run` |
| 21:00 | Cron pulls Eric's "samples arrived, actively reviewing" reply via Gmail INBOX after-cursor |
| 21:00 | Classifier matches `SAMPLE_REQUEST_REGEX` on the bare word "samples"; no exclusion phrase matched |
| 21:00 | `generateDraftReply` produces the (then-stale) `sample_request` template body with "1-pack, 5-pack, or master case" language |
| 21:00 | `createGmailDraft` saves the draft (Class A `draft.email`) |
| 21:00 | `requestApproval` opens a Class B `gmail.send` card in `#ops-approvals` |
| ~21:00–23:00 | Approval transitions to `approved` (mechanism undetermined — see §4) |
| ~21:00–23:00 | `executeApprovedEmailReply` fires `sendGmailDraftDetailed`; Eric receives the confused reply |
| 4/30 00:09 PT | Ben commits `24de7b6 fix(ops): kill email-intel auto-replier after Eric Miller incident`: removes 5 daily crons + inverts kill-switch default to OFF |
| 4/30 00:03 PT | Recovery correction email sent manually to Eric Miller |
| 4/30 AM | Postmortem + classifier + template fixes shipped (this doc + companion commit) |

---

## 2. Root causes

Two independent bugs collided. Either alone would have prevented the incident; both at once produced the visible defect.

### 2.1 Classifier mis-classification (PRIMARY)

`SAMPLE_REQUEST_REGEX = /\b(samples?|trial pack|product samples|send.*sample)\b/i` matched "samples" anywhere in the body. Eric's reply ("samples arrived, my team is actively reviewing") matched on the first word and had no exclusion phrase. Only the existing `SAMPLE_DECLINE_REGEX` ("no thanks", "not interested", "unsubscribe", "no longer") was checked, which is a different exclusion class — buyers DECLINING samples, not buyers WHO ALREADY RECEIVED them.

This is the structural defect: **the classifier has no guard against "buyer already has the samples".**

### 2.2 Stale SKU template (SECONDARY)

`draft.ts` line 135 (pre-fix) had: `"  • Whether you'd like the 1-pack, 5-pack, or master case"`. None of those SKUs exist in the canonical pricing grid (`/contracts/outreach-pitch-spec.md` §6 + `/contracts/wholesale-pricing.md` §2). The canonical SKUs are: single 7.5 oz bag, inner case (6 bags), master carton (36 bags), pallet (25 master cartons / 900 bags). The retired language probably dates back to a pre-Phase-35 SKU model that nobody pruned when wholesale-pricing was canonicalized.

Independently, the `b2b_sales` template said "$3.49/bag, $20.94/case (6-pack), 36-bag master carton" — math correct ($3.49 × 6 = $20.94) but the "6-pack" wording is ambiguous (a 6-pack of what — bags? cases?). Replaced with the canonical inner-case + master-carton + pallet vocabulary.

### 2.3 Approval-gate behavior (UNDETERMINED)

Ben's incident brief said: *"a sample_request reply hit gmail.send WITHOUT going through requestApproval — that's the underlying bug."*

I could not reproduce a code path that bypasses `requestApproval`. The cron flow is structurally sound:

```
cron tick → classifyEmail → generateDraftReply
         → createGmailDraft (Class A draft.email)
         → requestApproval(actionSlug:"gmail.send", payloadRef:"gmail:draft:<id>")
         → Slack #ops-approvals card posted
         ↓
Slack approval → approvalsRoute → executeApprovedEmailReply(approval)
              → sendGmailDraftDetailed(draftId)
              → Eric receives email
```

Search for any other call site of `sendGmailDraftDetailed` / `gmailSend`:

```
src/lib/ops/email-intelligence/approval-executor.ts:97  ✓ (gated by approval.status === "approved")
src/lib/ops/gmail-reader.ts:850                          ✓ (the function itself)
src/lib/ops/email-intelligence/__tests__/approval-executor.test.ts (mocks)
```

No bypass found. The most likely actual mechanism: **the approval was clicked through too quickly.** The approval card body shows up to 800 chars of the draft per `report.ts` line 215, so the stale "1-pack/5-pack/master case" language WAS visible — but glanceable Slack approvals are common during high-velocity ops, especially late evening.

**This is unresolved.** The third checkbox in §0 stays unchecked until Ben confirms either:
(a) he clicked approve in Slack on the bad draft (closes the loop — gate held; classifier was the only bug), or
(b) there was no Slack approval at all (means there IS a bypass we haven't found, which is a much bigger structural issue).

---

## 3. Fixes shipped (2026-04-30 AM)

### 3.1 Classifier exclusion regex

`src/lib/ops/email-intelligence/classifier.ts` adds `SAMPLE_RECEIVED_REGEX` covering 16 real-world "buyer already received" phrasings:

- "samples arrived" / "samples received" / "samples are here" / "samples landed" / "samples came in" / "samples delivered"
- "received the samples" / "got the samples"
- "we received" / "we got" / "received your shipment" / "received the package" / "received the box"
- "actively reviewing" / "currently reviewing" / "still reviewing"
- "team is reviewing" / "crew is reviewing"
- "in review" / "still tasting" / "trying them out" / "sharing with the team"

The `sample_request` rule now requires `SAMPLE_REQUEST_REGEX.test(text) && !SAMPLE_DECLINE_REGEX.test(text) && !SAMPLE_RECEIVED_REGEX.test(text)`.

Regression tests: 18 fixtures in `src/lib/ops/email-intelligence/__tests__/classifier.test.ts` including a real-world Eric-Miller-shaped phrasing and a positive control (an actual sample REQUEST without any received-phrase keywords still classifies correctly).

### 3.2 Sample-request template rewrite

`src/lib/ops/email-intelligence/draft.ts` `sample_request` body:

- Removed: `"  • Whether you'd like the 1-pack, 5-pack, or master case"`
- Added: `"  • How many bags works for your team — a single 7.5 oz bag for tasting, or an inner case (6 bags) for a wider team review"`

Plus an inline doctrine comment pointing future maintainers at `/contracts/outreach-pitch-spec.md` §6 + `/contracts/wholesale-pricing.md` §2 as the authority for SKU vocabulary.

Regression test: locks the body shape — must not contain "1-pack" / "5-pack" / "master case"; must contain "7.5 oz bag" + "inner case (6 bags)".

### 3.3 b2b-sales template rewrite

`src/lib/ops/email-intelligence/draft.ts` `b2b_sales` body:

- Removed: `"  • Wholesale: $3.49/bag, $20.94/case (6-pack), 36-bag master carton"`
- Added: `"  • Wholesale: $3.49/bag landed master carton (36 bags) · $3.25/bag pallet landed (25 master cartons / 900 bags) · $3.00/bag at 3+ pallet free-shipping tier"`

Regression tests: locks all four canonical price points ($3.49, $3.25, $3.00, "3+ pallet") + locks vocabulary (no "6-pack", must contain "master carton" + "pallet").

### 3.4 What was NOT changed

- The kill-switch in `src/app/api/ops/fulfillment/email-intel/run/route.ts:117` remains DEFAULT-OFF per Ben's `24de7b6`. **Re-enable still requires explicit `EMAIL_INTEL_ENABLED=true` env var + manual cron re-add.** This commit does NOT touch either.
- No other templates (`ap_finance`, `shipping_issue`, `customer_support`, `vendor_supply`, `marketing_pr`, `receipt_document`, `junk_fyi`) had SKU references that needed updating. They reference inbound topic shape (W-9, tracking, allergens, etc.), not outbound SKU language.
- The `executeApprovedEmailReply` executor was NOT modified. Its existing gate (`if (approval.status !== "approved") return { handled: false }`) is the right gate; the bug was upstream of the gate.

---

## 4. Open question for Ben

Per §2.3 above, the third checkbox in §0 stays unchecked until you can confirm whether you clicked approve in Slack on the bad draft, or whether the email went out without your click. Three possible answers:

- **(a) "I clicked approve."** → Gate held; classifier was the only bug; close the postmortem and tick box 3.
- **(b) "I didn't click approve."** → There IS a bypass we haven't found. Reopens the investigation; do NOT re-enable until found + closed.
- **(c) "I don't remember."** → Treat as (b) for safety; the bypass investigation runs anyway.

Recommendation: even if the answer is (a), strengthen the approval card before re-enable so glance-approval is harder for stale templates. Specifically: when the classifier confidence is < 0.9 OR the inbound contains any SAMPLE_RECEIVED phrase, the card should add a `:warning: This may be a misclassification — read the full body carefully` banner above the preview.

---

## 5. Re-enable checklist (when ready)

When all three checkboxes in §0 are ticked, the steps to re-enable are:

1. **Set Vercel env:** `EMAIL_INTEL_ENABLED=true` (production scope, no preview/dev). Use `printf '%s' true | vercel env add EMAIL_INTEL_ENABLED production` per `/CLAUDE.md` to avoid the trailing `\n` corruption pattern.
2. **Re-add ONE cron** to `vercel.json` (start with one tick/day, not five): `{ "path": "/api/ops/fulfillment/email-intel/run", "schedule": "0 19 * * *" }` (12 PM PT). Watch one full week of runs before adding more ticks.
3. **Smoke-test with `dryRun: true`** first via `POST /api/ops/fulfillment/email-intel/run` with `{ "dryRun": true }`. Confirm no misclassifications.
4. **Watch the FIRST two days of approvals carefully.** Read the full draft body on each card, not the headline.
5. **If any false-positive misclassification emerges**, immediately `EMAIL_INTEL_ENABLED=false` again and reopen this postmortem.

---

## 6. Cross-references

- Incident-containment commit: `24de7b6 fix(ops): kill email-intel auto-replier after Eric Miller incident` (2026-04-30 00:09 PT). Removes 5 daily crons from `vercel.json`; inverts `isEnabled()` default to OFF.
- Postmortem fix commit: companion to this doc — classifier `SAMPLE_RECEIVED_REGEX` + `sample_request` template rewrite + `b2b_sales` template rewrite + 18 regression tests.
- `/contracts/outreach-pitch-spec.md` §1 + §5 + §6 + §8 — canonical product / case-pack / pricing-tier vocabulary that templates MUST reference.
- `/contracts/wholesale-pricing.md` v2.2 §2 — the B1–B5 SKU/tier grid.
- `/contracts/approval-taxonomy.md` v1.6 — `gmail.send` Class B gate.
- `/contracts/governance.md` §1 #4 — "Financial / customer-facing / shipping / money-moving actions require explicit per-instance human approval until the agent has graduated. Graduation is earned by measured reliability, not calendar time." The email-intel agent has NOT graduated; this incident is precisely why graduation is reliability-gated.

---

## 7. Lessons + structural takeaways

1. **Default-OFF kill switches are non-optional for any agent that emits outbound customer-facing copy.** `24de7b6` made this concrete; this doctrine should propagate to any future agent in the same risk class.
2. **Classifier rules need exclusion regexes for "intent-already-resolved" states**, not just for "intent-decline" states. Sample requested vs sample received vs sample declined are three states; the classifier was only guarding against one of them.
3. **Templates referencing SKU vocabulary must have lockstep tests against the canonical pricing contracts.** Both `sample_request` and `b2b_sales` had retired SKU language for an unknown amount of time before the incident exposed it. Future template additions must include a lockstep test that fails when canonical SKU vocab drifts.
4. **High-velocity Slack approvals are a known human-factors failure mode.** Even with the body shown in the card, glance-approval happens. Mitigations: (a) larger preview, (b) classifier-confidence-based warning banners, (c) "read full body" required-click before approve for low-confidence classifications.

---

## 8. Version history

- **2026-04-30 AM** — First publication. Captures the Eric Miller incident, the two root causes, the fixes shipped, the unresolved approval-gate question, and the re-enable checklist.
