# HEARTBEAT — Abra Proactive Checklist
# Updated: 2026-03-26T00:00:00.000Z
# Read by operator every cycle. For each item: check condition, act if true, skip if false.

## URGENT (check every cycle)
- [ ] Any new POs in email? -> detect, extract, create invoice draft
- [ ] Any unanswered vendor emails >24h? -> draft reply, surface to Ben
- [ ] Any QBO transactions auto-categorizable? -> categorize them
- [ ] Any operator tasks failed? -> retry or escalate

## DAILY (check once per day)
- [ ] Morning brief sent? -> send if not
- [ ] Bank feed reconciliation run? -> run if not
- [ ] Revenue KPI updated? -> update if stale >12h

## WEEKLY (check on Mondays)
- [ ] AR/AP report generated? -> generate if not
- [ ] Pipeline follow-ups due? -> create tasks if not
- [ ] Cash runway calculated? -> calculate if not

## MONTHLY (check on 1st)
- [ ] P&L report generated? -> generate if not
- [ ] Balance sheet generated? -> generate if not
- [ ] Investor update package? -> generate if not
