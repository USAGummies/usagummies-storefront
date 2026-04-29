# Operating Memory — Slack as the Running Tally Board

**Status:** CANONICAL
**Source:** Ben + Rene call recap, 2026-04-27 §8 + §16 + §17
**Version:** 1.0 — 2026-04-27

---

## Core principle

**Slack is the company's operating memory.** Not just communication — the running, searchable, correctable tally board.

> "If reports are wrong three times and Renny or Ben corrects them in Slack, Claude Code should be able to inspect those Slack corrections and reverse-engineer the upstream issue. Slack is the place where drift becomes visible."

Email is useful to query but is NOT the main brain. Notion is structured doctrine. Supabase is AI-oriented memory. Slack is the daily operational layer where decisions, corrections, drift, and follow-ups all surface.

---

## What Slack must capture

Per §8 of the recap, Slack must capture:

| Category | Examples | Channel |
|---|---|---|
| Decisions | "We're locking pricing at B1-B5 today." | `#financials` (finance), `#abra-control` (ops) |
| Corrections | "That report is wrong — actual figure is $X." | The originating report's thread |
| Order events | Auto-ship label posts, dispatch marks | `#shipping` |
| Shipping events | Tracking pushes, exceptions | `#shipping`, `#operations` |
| Financial report issues | "P&L missing channel attribution" | `#financials` |
| Renny / Ben feedback | Doctrine corrections, scope changes | The appropriate division channel |
| Victor drift corrections | "Victor said X, but actually Y" | The originating thread |
| Follow-up tasks | "Need to test wholesale flow tonight" | `#financials`, `#abra-control` |
| System-generated summaries | Daily brief, weekly KPI | `#ops-daily` |

---

## Slack-first reporting pattern

**Reports go to Slack. Email may follow.**

Per §9 of the recap: when Rene wants a recurring report (Friday sales summary, post-bookkeeping financial update, month-end), the canonical pattern is:

1. Generate the report
2. Post to the relevant Slack channel (`#financials` for finance, `#abra-control` for ops)
3. Optionally send the same content via email if the recipient prefers

Why Slack-first: Slack copy is searchable, threadable, correctable. Corrections in the thread become inputs to the next report cycle.

---

## Transcript / call capture rule (§17)

When a substantive conversation happens (Ben + Rene call, vendor meeting, internal strategy session), the transcript or recap must be saved to Slack memory before the day ends.

**Why:**
- Decisions made in voice but not in code disappear within hours.
- Future Claude Code / Viktor sessions need the source to detect contradictions:
  - "These three points are opposed."
  - "Five out of six times you said X."
  - "This latest instruction contradicts prior pricing logic."

**Where:**
- General company calls / strategy → `#abra-control` thread tagged `transcript:<short-id>`
- Finance-specific calls → `#financials` thread tagged `transcript:<short-id>`
- Vendor calls → `#operations` thread tagged `transcript:vendor:<short-id>`

**Format:** post the full recap as a thread under a top-line summary message. Top-line is searchable; thread holds the body.

---

## Drift detection via Slack corrections

The whole point of Slack-as-memory is that **drift becomes visible**.

Pattern:
1. System produces a report or takes an action.
2. Rene or Ben corrects in Slack.
3. The correction is observable to Claude Code via `slack.conversations.history` + the audit trail.
4. Claude Code's next session can read recent Slack corrections + reverse-engineer the upstream bug.

This is what `/api/ops/slack/events` + the W-7 Rene-capture route already do for the finance decision queue. The same pattern applies broadly — corrections aren't noise, they're inputs.

---

## Hard rules

1. **Every system-generated report posts to Slack first.** Email is optional, never primary.
2. **Decisions made in Slack threads are durable.** The `#financials` decision queue per W-7 is the canonical ledger; non-queue decisions thread under their originating message.
3. **Corrections are inputs.** Claude Code sessions read recent Slack corrections on boot to detect drift before producing new output.
4. **Transcripts are saved within 24h of the call.** Per §17, capture before the conversation evaporates.
5. **No silent action.** Every autonomous write produces an audit envelope AND a Slack notification (per `/contracts/slack-operating.md`).
6. **BCC `rene@usagummies.com` on every new-wholesale-customer first email.** See §"BCC-Rene rule" below.

---

## BCC-Rene rule on new-customer first emails (LOCKED 2026-04-28)

**Rule:** Every email sent to a new wholesale customer carries `BCC: rene@usagummies.com` until the customer is fully onboarded.

**Scope — applies to:**
- Wholesale-AP onboarding packet send (`apPacketSend` handler / `/api/ops/wholesale/send-ap-packet` route)
- First invoice email
- Any system-generated outreach to a customer who has NOT YET returned a completed NCS-001 form
- Manual-but-system-traced sends (e.g. operator-driven Gmail drafts that get sent through the same audit pipeline)

**Scope — does NOT apply to:**
- Auto-ack lead receipt email (`lead.auto-ack` Class A) — that's pre-customer; no AP visibility needed
- Internal team emails
- Sends to customers AFTER NCS-001 is returned + QBO customer record finalized (Rene has the AP info on file at that point; further visibility goes through standard QBO + AR aging surfaces)

**Why:**
- Finance has full visibility on intent + thread state without putting Rene on the To/CC line (which would invite the customer to reply-all to Rene, polluting his inbox)
- BCC keeps the customer-facing thread clean; CC `ben@` is the visible second recipient (matches Apr 13 CIF-001 v3 lock — Ben is the public face, Rene is the back-office)
- Drift-detection-via-Slack: if Rene sees a BCC'd email and notices something off, his correction in `#financials` becomes the input to the next iteration cycle (per §"Drift detection via Slack corrections" above)

**Where this rule is wired in code:**
- `src/lib/wholesale/onboarding-dispatch-prod.ts` — `RENE_BCC_EMAIL` constant, applied in `sendWholesaleApPacket()`
- Tests lock the rule: `src/lib/wholesale/__tests__/onboarding-dispatch-prod.test.ts` asserts `bcc: "rene@usagummies.com"` on every send
- The one-off route `POST /api/ops/wholesale/send-ap-packet` reuses the same helper, so the BCC is enforced regardless of entry point

**Drift detection:**
- If a `wholesale-ap-packet` send goes out without `BCC: rene@usagummies.com`, that's a regression. Future Claude Code session reading recent Slack corrections + audit envelopes can spot it (audit envelope captures the recipient list).

**Source:** Ben directive 2026-04-28, in the context of preparing the first wholesale customer (Mike Hippler / Thanksgiving Point) onboarding bundle. The rule generalizes from "BCC Rene on Mike's emails today" to "BCC Rene on every new-customer first-email until full onboard."

---

## Where this rule shows up in the codebase

| Mechanism | File |
|---|---|
| Audit envelope → Slack mirror | `src/lib/ops/control-plane/slack/index.ts` (`auditSurface().mirror()`) |
| Daily brief → `#ops-daily` | `src/app/api/ops/daily-brief/route.ts` |
| Auto-ship → `#shipping` | `src/app/api/ops/shipping/auto-ship/route.ts` |
| Reorder triggers → `#operations` | `src/app/api/ops/inventory/reorder-trigger/route.ts` |
| W-7 Rene capture | `src/app/api/ops/viktor/rene-capture/route.ts` |
| W-8 Rene system Q&A | (handled in Viktor's runtime; doctrine in `/contracts/viktor-rene-briefing.md` §12) |
| Slack channel registry | `src/lib/ops/control-plane/channels.ts` |

---

## Version history

- **1.0 — 2026-04-27** — First canonical publication. Locks Slack-as-operating-memory per Ben + Rene call recap §8, §16, §17. Pins drift-detection-via-Slack-corrections doctrine.
- **1.1 — 2026-04-28** — Adds BCC-Rene-on-new-customer rule (§"BCC-Rene rule on new-customer first emails"). Wired in `src/lib/wholesale/onboarding-dispatch-prod.ts` ahead of first-customer Mike Hippler / Thanksgiving Point send.
