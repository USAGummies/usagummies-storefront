# Pricing v2.3 — Ratification Thread Template

**Status:** PROPOSAL — companion to `/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md`
**Version:** 0.1 — 2026-04-30
**Purpose:** Ready-to-paste Slack thread template for the Class C `pricing.change` ratification conversation between Ben + Rene. Drop into `#wholesale` (cross-post `#financials`), each of you answers `Q1: Option [A/B/C]` (or your own answer), and the result is logged via the Class C approval flow.

> **Why a template:** the 5 decisions in the v2.3 proposal aren't independent — Q3 (keep B5 as buyer-pays?) interacts with Q2 (designator strategy for C-ANCH). A real-time Slack thread with the questions verbatim + Claude's reads + space for your answers eliminates cross-talk and keeps the audit trail clean.

---

## Paste this into `#wholesale` (cross-post `#financials`)

```
:rotating_light: *Pricing v2.3 ratification — Class C `pricing.change`*

Reconciles the open items in `/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md`
(commit `1b3027b`). Five decisions; each gets a `QN: Option X` reply (or your own).
Both Ben + Rene must approve — the thread itself is the audit trail.

Background — current state vs proposal:
• `/contracts/wholesale-pricing.md` v2.2 = the SKU/tier grid (B1–B5).
• `/contracts/pricing-route-governance.md` v1.0 = the route-economics
  governance layer (anchor / fill / pickup, escalation clauses, deal-check).
• Two open conflicts: $2.00 pickup-only doesn't exist in v2.2, and
  $3.00 landed-anchor collides with B5 ($3.00 pallet buyer-pays).

The 5 decisions:

*Q1: Should `$2.00/bag` pickup-only become an official pricing class
(C-PU / B0-PU)?*
  • A — YES, grid-resident with `ONLINE_AVAILABLE = false`
  • B — YES, off-grid (track in distributor-style commitments doc) ← _Claude's read_
  • C — NO, treat each $2.00 deal as Class C `C-EXC` exception
  → Reply: `Q1: B` (or A / C)

*Q2: Should `$3.00/bag` landed route-anchor become an official class
(C-ANCH / B6-ANCH)?*
  • A — YES, grid-resident with NEW designator (preserves B5) ← _Claude's read_
  • B — YES, take over the B5 slot (reassigns B5 meaning)
  • C — NO, keep route-anchor off-grid; every offer = Class C
  → Reply: `Q2: A` (or B / C)

*Q3: Should `B5` remain a buyer-paid pallet ($3.00, today's definition)?*
  • A — YES, B5 stays buyer-pays; route-anchor lives at B6-ANCH
  • B — NO, retire B5's buyer-pays meaning; reassign to landed-anchor
  • C — NO, retire B5 entirely; pallet is landed-only at B4 + B6-ANCH
  → Reply: `Q3: A` (or B / C — Rene's call as much as Ben's)

*Q4: Should landed route-anchor pricing require Class C approval every
time, or only when outside approved route corridors?*
  • A — Class C every time (max friction, fewest anchors at a time)
  • B — Class C first-time + Class B for reorders inside an approved corridor ← _Claude's read_
  • C — Class B always after first ratification (aggressive, scales fast)
  → Reply: `Q4: B` (or A / C)

*Q5: Should all outbound offers include explicit escalation language?*
  • A — YES, mandatory on every outbound (no exceptions) ← _Claude's read_
  • B — YES, on every non-pickup offer (pickup exempt)
  • C — NO, Ben's discretion (recommended but not required)
  → Reply: `Q5: A` (or B / C)

*Q6 (NEW — raised by Rene 2026-04-30): Buyer-paid-freight +$0.25/bag surcharge?*
  • A — YES, +$0.25 across ALL buyer-pays lines (B3 → $3.50, B5 → $3.25,
    C-PU → $2.25). Inverts price gap so landed becomes the default. ← _Claude's read_
  • B — YES on master carton (B3) only, NO on pallet (B5). Handling
    cost per unit smaller at pallet scale.
  • C — NO, keep current grid ($3.25 B3 / $3.00 B5).
  → Reply: `Q6: A` (or B / C). Rene's pre-signaled yes; Ben's call.

After both of you have answered all 6, I'll synthesize the v2.3 grid +
queue the follow-up commit:
  - `wholesale-pricing.md` graduates to v2.3 with the new tier rows
  - `pricing-route-governance.md` §11 marked CLOSED
  - `src/lib/wholesale/pricing-tiers.ts` + tests updated in lockstep
  - Test invariant `Designator stability invariant` may need amending
    if Q3 = B (reassigning B5)

Reply format: `QN: Option X` per question. Rene approves once both
have signed off via this thread = Class C `pricing.change` complete.
```

---

## What happens after both of you reply

When both Ben and Rene have answered all 5 questions, the next session:

1. **Reconciles the answers into a v2.3 specification.** Specifically: the new tier rows for `wholesale-pricing.md` v2.3, the closed-section update for `pricing-route-governance.md` §11, the calculator changes, and the test-invariant deltas.

2. **Ships one commit** that:
   - Bumps `/contracts/wholesale-pricing.md` v2.2 → v2.3 with the agreed grid
   - Marks `/contracts/pricing-route-governance.md` §11 reconciliations as CLOSED, adds a v1.1 entry pointing at the ratified grid
   - Updates `src/lib/wholesale/pricing-tiers.ts` to the new closed enum + prices + freight modes
   - Updates `src/lib/wholesale/__tests__/pricing-tiers.test.ts` to lock the v2.3 invariants (and amends `Designator stability invariant` if Q3 = B)
   - Updates `src/lib/sales-tour/classify-booth-tier.ts` if the new C-PU or C-ANCH pricing changed (the booth helper currently uses the off-grid prices from §1 of `pricing-route-governance.md`)

3. **Notion sync** — `/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md` §0 calls out the Notion target page id. The ratification result gets summarized into a CANONICAL ADDENDUM there.

4. **Out-of-band** — any of your standing distributor commitments (Inderbitzin, Glacier) at $2.10 delivered are unchanged regardless of the answers. The proposal's §7.1 explicitly preserves them. If you change your mind on any future committed price, that's a separate conversation, not v2.3.

---

## Cross-references

- [`/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md`](./pricing-grid-v2.3-route-reconciliation.md) — the full proposal with the 6-class taxonomy, full table, and the 7-item risk + migration considerations.
- [`/contracts/pricing-route-governance.md`](../pricing-route-governance.md) §11 — the open reconciliations this ratification closes.
- [`/contracts/wholesale-pricing.md`](../wholesale-pricing.md) v2.2 — the current SKU/tier grid that v2.3 amends.
- [`/contracts/approval-taxonomy.md`](../approval-taxonomy.md) v1.6 — `pricing.change` slug (Class C, Ben + Rene dual-approve).

---

## Version history

- **0.1 — 2026-04-30** — First publication. Companion ratification-thread template for the v2.3 reconciliation proposal. Drops into `#wholesale` (cross-post `#financials`); answers logged in-thread = the Class C audit trail.
