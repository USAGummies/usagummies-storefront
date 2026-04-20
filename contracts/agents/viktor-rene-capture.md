# Viktor W-7 — Rene Response Capture (Finance Decision Queue)

**Status:** CANONICAL — 2026-04-20
**Extension to:** [`/contracts/viktor.md`](../viktor.md) v3.0 (Viktor remains a Sales-division agent; this workflow is a bounded log-only bridge into the Financials division)
**Human owner:** Ben (enables); Rene (originates the responses being captured)
**Notion mirror:** [Viktor W-7 — Rene Response Capture](https://www.notion.so/3484c0c42c2e8126a758ecdd296c9857)

---

## Purpose

When Rene Gonzalez replies to the finance decision queue (R.XX / J.XX / CF-XX / D.XXX / APPROVED / REDLINE) in Slack, Viktor durably logs the response to the canonical working documents without requiring Ben or Claude to be online.

Anchor thread: `#finance` (C0ATF50QQ1M) message_ts `1776666120.467889` posted 2026-04-20.

## Trigger

Event-driven on any of:
- New message or threaded reply in `#finance` (C0ATF50QQ1M) from Rene (U0ALL27JM38) matching the §Match-pattern regex.
- DM from Rene to Viktor matching the pattern.
- Any finance-adjacent channel message from Rene matching the pattern.

Fallback cadence until the event listener is wired: every 30 minutes, scan the last 30 minutes of #finance for the pattern.

## Match pattern

```
^\s*([>`\*]*\s*)?((?:[RBJ]\.\d+)|(?:CF-\d+)|(?:D\.\d+)|APPROVED|REDLINE)\s*[:\-]?\s*(.+)$
```

Multi-line, case-insensitive. Group 2 = decision ID. Group 3 = answer payload.

Ambiguous replies (no match, or free text that references a decision without a strict ID prefix) are captured with a `DISCUSS-WITH-BEN` tag and a clarifying reply posted back to Rene.

## Read scope (Class A — autonomous)

| System | Scope |
|---|---|
| Slack | `#finance` (C0ATF50QQ1M), `#receipts-capture` (C0APYNE9E73), Rene DMs, `#ops-audit` for cross-ref |
| Notion | Finance Doctrine 01–07, Finance Registers (Decision Log / Contradictions / Open Decisions / Automation Implications), Finance Templates index, Consolidated Canon, 22.A Decision Queues, 19.11 Internal Decision Register |
| Open Brain | pre-capture lookup on `finance:rene-response`, `decision:<ID>` |

## Write scope (Class A — log-only)

No consequential finance writes. All writes are logging into working documents.

| Destination | Action per captured response | Class |
|---|---|---|
| Finance / Register — Decision Log | Append entry: date, decision_id, Rene's verbatim answer, Slack permalink, `captured_by: Viktor W-7` | A |
| Finance / Register — Contradictions | If ID matches `CF-NN`, update Status to `RESOLVED (Rene ratified YYYY-MM-DD, Slack permalink)` with answer text | A |
| Relevant Finance Doctrine page | Append `Rene sign-off YYYY-MM-DD` note + flip DRAFT → CANONICAL banner where the answer closes a draft | A |
| 19.11 Internal Decision Register | Update status cell for D.XXX row | A |
| Finance Templates index | For APPROVED/REDLINE on a template ID, update §5 status map + the template-file status line | A |
| Open Brain | Capture with tags `finance:rene-response`, `decision:<ID>`, provenance `{slack_ts, slack_channel, user: U0ALL27JM38, retrievedAt}` | A |
| Slack thread (reply to originating message) | Post confirmation: `Logged: <ID> → <short summary>. Updated: <pages>. — Viktor W-7` | A (`slack.post.audit`) |
| `#ops-audit` mirror line | `{run_id, decision_id, source_slack_permalink, notion_pages_updated, open_brain_tag, viktor_version}` | A (`slack.post.audit`) |

## Prohibited (Class D for this workflow)

- Modifying QBO (read-only; Class B/C via Rene or Ben+Rene stays with the humans).
- Sending any email / external communication in response to captured answers.
- Rewriting doctrine content beyond sign-off banner updates. Material rewrites require a working Claude Code / Codex session.
- Capturing Rene-queue IDs (R.XX, CF-01/03/04/05/07/08) from anyone other than Rene.
- Marking Joint queue IDs (J.XX) as RESOLVED until BOTH Ben and Rene have acknowledged.
- Fabricating a resolution when the reply is ambiguous — post back for clarification and wait.
- Escalating `DISCUSS-WITH-BEN`-tagged items to Ben on Rene's behalf unless Ben explicitly asked.

## Cascade rules

Captured decisions that cascade across multiple doctrine pages — Viktor lists the cascade set in the Slack confirmation reply:

| Decision ID | Cascaded pages |
|---|---|
| R.03 | Finance Doctrine 01 §6; Finance Doctrine 07 Amazon-Connector block; FRT-001 Amazon row |
| R.04 | Finance Doctrine 07 §7; Booke bounded contract (TBD); 22.C Lane D |
| R.05 + CF-04 | Finance Doctrine 01 §8; Finance Doctrine 06 per-channel; Contradictions CF-04 |
| R.06 + CF-03 | Finance Doctrine 01 §9; Finance Doctrine 04; Contradictions CF-03 |
| R.07 + CF-01 | Finance Doctrine 06 §3 and §5; FRT-001 Reconcile sheet; Contradictions CF-01 |
| R.10–R.12 | Finance Doctrine 03 §3/§4/§5; ARR-001..004 template headers |
| R.15 | Finance Doctrine 06 §3; Finance Doctrine 07 §4; 22.C Lane B.12 |
| R.16 | Finance Doctrine 04 §11; Finance Doctrine 07 §8; 22.C Lane B.13 |
| R.19 | Finance Doctrine 06 §10; OCS KPI K.23 |
| J.02 | Finance Doctrine 02 §3; 22.C Lane B.11; Canon §11.1 |
| J.09–J.11 | Finance Doctrine 05 §3; approval-taxonomy.md v1.2 prep |
| CF-NN | Contradictions register + any doctrine page referencing that CF |
| APPROVED/REDLINE | Finance Templates index §5 + the specific template |

## Confirmation reply format

```
Logged: R.04 → "0.95 / 0.70 / escalate"
Status: DRAFT → CANONICAL (Rene sign-off 2026-04-20)
Updated: Finance Doctrine 07 §7; 22.C Lane D.1; Decision Log 2026-04-20 entry.
Cascade: Booke bounded contract draft still pending; flagged for next Claude Code session.
— Viktor W-7
```

One short block per captured decision. No batching unrelated decisions into a single reply.

## Heartbeat + degraded mode

**2026-04-20 runtime direction (Ben):** Viktor picks up W-7 via his own existing Slack presence on the Sales-division runtime. No Vercel Cron is wired — Hobby's 1x/day limit is too weak. Viktor reads this SOP on boot and handles cadence as part of his normal Slack loop. The on-demand HTTP route at `/api/ops/viktor/rene-capture` (bearer `CRON_SECRET`, GET or POST) remains for manual triggers / smoke / future webhook, not on a schedule.

| State | Behavior |
|---|---|
| Primary | Viktor's Slack listener on #finance + Rene DMs picks up messages matching the §Match-pattern regex; reacts in real time. |
| Manual trigger | `/api/ops/viktor/rene-capture` called on demand (bearer `CRON_SECRET`); processes the last 25h by default; useful for catch-up after any outage. |
| Notion unreachable | Cache response in Open Brain; reply in Slack noting temporary delay; retry queue |
| Open Brain unreachable | Reply in Slack noting temporary delay; do NOT write to Notion (preserves provenance); retry queue |
| Slack unreachable | Fail-closed: the workflow is Slack-triggered. No fallback trigger from elsewhere |

## Audit

`#ops-audit` mirror line per capture with `{run_id, decision_id, source_slack_permalink, notion_pages_updated, open_brain_tag, viktor_version, retrievedAt}`.

Weekly drift audit (Sun 8 PM PT per governance.md §5) samples the last week of Rene responses in #finance against the Decision Log to verify zero captures were missed or misfiled.

## Weekly KPI

| KPI | Target |
|---|---|
| Rene responses logged within 10 min of receipt (event-mode) or within 30 min (poll-mode) | 100% |
| Captured responses with correct cascade updates | 100% |
| Ambiguous-response rate | < 10% / week |
| Double-capture (same response logged twice) | 0 |
| Silent drops (response in Slack, no Notion log) | 0 |

## Graduation

Stays in-the-loop indefinitely. W-7 is log-only; no approval-class graduation required. Expanding scope (doctrine edits beyond sign-off banner) requires Ben + Rene sign-off + a W-7 v2 contract.

## Implementation note

This contract is doctrine today; runtime wiring is TBD.

**Path 1 (preferred) — Event-driven.** Add a Slack Events API handler at `src/app/api/slack/events/route.ts` that filters on `channel == C0ATF50QQ1M` + `user == U0ALL27JM38` + §Match-pattern regex, then dispatches to the W-7 handler.

**Path 2 (fallback) — Scheduled poll.** Vercel Cron `*/30 * * * *` that reads the last 30 minutes of #finance via `slack.conversations.history`, filters by user + pattern, and dispatches to the same handler.

Recommended: ship Path 2 first (fully satisfies "works even when we are offline"), then layer Path 1 for sub-10s latency.

Until wired, captures are performed manually by the next Claude Code session (first action on start).

## Version history

- **1.0 — 2026-04-20** — First canonical publication. Anchor thread `1776666120.467889` in C0ATF50QQ1M.
