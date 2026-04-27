# Interviewer Agent — pre-build spec disambiguation

**Status:** CANONICAL — 2026-04-27
**Owner:** Ben (operator) + Claude (runtime)
**Inspiration:** Nate B. Jones, "First Agent Should Be an Interviewer, Not Assistant" (Apr 14, 2026) — *specification is the 40-hour problem nobody is solving; every successful deployment shares the same markdown-file architecture; the hard problem is producing a usable spec.*

---

## Why this contract exists

Yesterday's manual-script bug shipped 6 packing slips with `qty: 1` hardcoded — wrong for the 3-bag, 2-bag orders. **The bug wasn't in the code; it was in the spec I assumed without asking.** A pre-build interviewer pass would have caught it in 30 seconds:

> *"Confirm: every Amazon FBM order is a single 7.5 oz bag, right?"*

Ben would have answered "no, sometimes 2-pack or 3-pack via QuantityOrdered" and the code would have shipped right the first time.

The interviewer's job: **before any non-trivial build, ask 3-5 disambiguation questions if the request is under-specified.** No questions when the spec is already crisp; ruthless questioning when it's hand-wavy.

---

## Trigger

Any request from Ben (or other operator) that would produce code, doctrine, or external writes AND meets at least one "under-specified" predicate:

| Predicate | Example |
|---|---|
| **Quantity / scale ambiguity** | "ship the labels" — how many? all backlogged? today's only? |
| **Source-of-truth ambiguity** | "the customer info" — Amazon SP-API? ShipStation? HubSpot? |
| **Failure-mode ambiguity** | "fix this" — fail-soft and continue, or fail-hard and rollback? |
| **Scope ambiguity** | "the customers" — Amazon FBM? Shopify DTC? all channels? |
| **Approval-class ambiguity** | "send the invite" — Class A autonomous, Class B human-gated, Class C dual? |
| **Reversibility ambiguity** | "delete the X" — soft-delete, archive, or hard-delete? |
| **Boundary ambiguity** | "tag X as Y" — only this one, or every matching record? |

When NONE of these predicates apply (e.g. "fix the typecheck error", "rerun the tests"), skip the interviewer pass and execute.

---

## Question protocol

**Limit: 3-5 questions.** If a request needs more than 5 questions to disambiguate, the request itself is too broad — split it into smaller ones.

**Format:** numbered list, one question per line, each with a default Claude will assume if Ben doesn't answer:

```
Before I build:
  1. Is this for Amazon FBM only, or all channels? (default: Amazon only)
  2. Should we count repeat customers across SKUs, or per-SKU? (default: across SKUs)
  3. What's the retention window for inactive records? (default: 1 year)
```

If Ben answers some but not all, **fill the rest with the named defaults — don't re-ask.** Ben doesn't have to babysit the interview.

If Ben says "just build it" or similar (no answers), proceed with all defaults but **tell him in the summary which assumptions were made** so he can correct if any are wrong.

---

## Anti-patterns (do NOT do these)

- **Asking obvious questions.** "Should the route be auth-gated?" — yes, every `/api/ops/*` is. Don't waste cycles.
- **Asking before reading existing code.** If the answer is in `CLAUDE.md`, `MEMORY.md`, `/contracts/*.md`, or the existing route, READ FIRST and only ask if the answer isn't there.
- **Using the interview as a stalling tactic.** If you can answer your own question by spending 60 seconds reading code, do that instead.
- **Asking permission to do work the user just authorized.** "Should I commit this?" — no, just commit it. Permission is implicit in "build it."
- **Asking the same question across sessions.** Once Ben has answered "X means Y" once, it goes into MEMORY.md or the relevant contract; don't re-ask next time.

---

## Hard rules

1. **The interviewer NEVER produces code.** It only produces questions + assumed defaults. Code production happens in the next turn after Ben answers (or skips).
2. **The interviewer is fail-open.** If you can't decide whether the request is under-specified, default to building (don't ask). Better to ship the wrong thing fast than block on questions.
3. **The interviewer is invoked once per request.** Not once per build-step. After Ben answers, every downstream decision uses the answers; don't re-interrogate mid-build.
4. **Default-and-record beats ask-and-block.** When unsure, pick a sane default + state it explicitly + proceed. Ben can correct.
5. **The interviewer DOES NOT replace `STOP-AND-ASK` rules in CLAUDE.md.** QBO writes, financial commitments, irreversible deletes, and the 7 prohibited actions still hard-stop regardless of how the interviewer concludes.

---

## When the interviewer would have caught a real bug

| Bug | Date | Disambiguation question that would've caught it |
|---|---|---|
| Manual packing-slip script hardcoded `qty: 1` | 2026-04-26 | *"Confirm: every Amazon FBM order is single 7.5 oz bag?"* (Ben: no — quantities vary) |
| `permalinkToMessageTs` returned undefined for live uploads | 2026-04-27 | *"Does `file.permalink` from completeUploadExternal carry the channel-message ts, or just the file URL?"* (would've prompted live test before relying on it) |
| Make.com bridge silently broken for `/wholesale` → HubSpot deal | ~2026-04-13 | *"Is HubSpot deal creation in `/api/leads` direct or via Make.com?"* (would've surfaced the broken dependency) |

Three bugs in 14 days that 30-second pre-build interviews would've caught. **Cumulative cost of NOT having an interviewer: ~6 hours of triage + Ben's "we just went through this" frustration.** Cost of having the interviewer: ~2 minutes per build.

---

## Audit

Each invoked interview leaves a trail in the chat (the questions asked + answers received) — natural session log. No separate auditStore write. The doctrine update is the audit.

---

## Graduation

This contract is in **active use** as of 2026-04-27. Graduates to "always-on default behavior" after 4 consecutive builds where it caught a real disambiguation gap. If after 4 builds it has only ever produced unnecessary questions, demote to "advisory only" and move on.
