# Pricing Governance, Partner Communication & Route Economics

**Status:** CANONICAL ADDENDUM
**Version:** 1.0 — 2026-04-29
**Source:** Ben + Rene operating doctrine ratified 2026-04-29 PM, codifying the route-economics model that overlays the SKU/tier grid in [`/contracts/wholesale-pricing.md`](wholesale-pricing.md).
**Notion target:** `USA Gummies — Business Model & Strategic Framework (Definitive)` (page id `3334c0c4-2c2e-81c9-81db-dd041807ae56`), section `CANONICAL ADDENDUM — Pricing Governance, Partner Communication & Route Economics`.
**Scope:** Source-of-truth for sales scripts, pricing calculators, Claude/agent prompts, and Notion/company OS sync. Anything outside this doc that promises pricing or freight terms is a violation to be flagged, not followed.

---

## 0. Why this exists (and why it does NOT replace `/contracts/wholesale-pricing.md`)

`/contracts/wholesale-pricing.md` v2.2 is the canonical **SKU + tier grid** (`B1`..`B5`, fulfillment-type codes `LCD/MCL/MCBF/PL/PBF`, batch-SKU pattern, freight modes). It tells the system how to *price a line* on an invoice.

This doc is the **route + governance layer that sits on top of that grid**. It tells humans (Ben, Rene) and agents (Viktor, Faire-specialist, Ops, Wholesale-onboarding):

- *When* to deviate from the standard grid.
- *How* to communicate between Ben and Rene on those deviations.
- *Which* prices anchor a route vs fill a route.
- *What* escalation language ships on every reorder, landed offer, or strategic deal.
- *What* checkpoint runs internally before any non-standard pricing offer leaves the building.

Where the two docs disagree on a number, **the route-governance doctrine here is the live policy and `/contracts/wholesale-pricing.md` will be updated in lockstep at its next version bump.** See §11 (Open Reconciliations).

---

## 1. Three canonical price points (route doctrine)

These are the three doctrinally-named price points used in route planning, partner conversations, and the deal-check process. They sit *on top of* the B1–B5 SKU grid in `/contracts/wholesale-pricing.md`; the SKU grid is what posts to QBO, this doctrine governs what we offer in conversation.

| Doctrine name | Per-bag | Freight model | Minimum / context | Use it for |
|---|---|---|---|---|
| **Pickup floor** | **$2.00 / bag** | Buyer-paid freight ONLY (pickup or buyer's carrier on buyer's account) | None on the floor, but never used as a freight-paid price | Distributors, repackers, or strategic accounts willing to handle their own freight; deep-discount slots that would not be viable with USA Gummies absorbing freight. |
| **Route anchor** | **$3.00 / bag** | LANDED — USA Gummies handles freight as a *route cost* | **3-pallet minimum** at this price. 3 pallets is what makes the route pay. | The cornerstone account that justifies dispatching the route. One $3.00 / 3-pallet customer makes the truck move. |
| **Route fill** | **$3.25 – $3.49+ / bag** | LANDED — freight built into bag price | Smaller / flexible / opportunistic stops along an already-anchored route | Secondary stops on a route the anchor already paid for. The marginal stop carries margin, not break-even freight. |

**The three rules behind these numbers:**

1. **$2.00 is pickup-only.** It is *never* a freight-paid number. If a buyer wants $2.00, they pay freight (their carrier, their account, their pickup). USA Gummies does not eat freight at $2.00.
2. **$3.00 is the route-anchor floor.** Below 3 pallets, this price is not on the table. 3 pallets is the threshold that turns one customer into a viable trip. (Aligned with `/contracts/wholesale-pricing.md` §3 "Free freight only at 3+ pallet MOQ.")
3. **$3.25 – $3.49+ is route-fill margin.** These stops only exist because the anchor already justified the truck. Per-bag margin on fill stops is the actual route P&L; the anchor at $3.00 is closer to break-even on the freight leg alone.

**Operationally:** when a sales conversation starts, the deal-check (§7) classifies the prospect as anchor, fill, or pickup before a price is named.

---

## 2. Landed pricing vs pickup pricing — the operational distinction

| Term | What it means | Customer pays for freight? | USA Gummies P&L |
|---|---|---|---|
| **Landed** | The per-bag price is the *all-in delivered price*. We dispatch + freight the load to the buyer's dock. | NO (it is built into the per-bag number). | Freight cost posts to `Freight Out / Shipping & Delivery Expense` (per `/contracts/wholesale-pricing.md` §12 / CF-09). Margin = (per-bag price − $1.77 COGS − allocated freight per bag). |
| **Pickup** | Per-bag price is the *EXW / dock-of-Ashford price*. Buyer arranges and pays for transit. | YES (their carrier, their account, OR they show up). | No freight on our P&L. Margin = (per-bag price − $1.77 COGS). |

**Hard rule:** Never quote $2.00 as a landed number. Never absorb freight on a $2.00 deal. Pickup-floor pricing is structurally incompatible with freight absorption — we lose money.

**Hard rule:** Never quote $3.00 / bag without the 3-pallet minimum attached. The MOQ is what makes the freight math work.

**Hard rule:** Pickup price + freight built in ≠ landed price. If a buyer wants delivery, they pay landed. If they want $2.00, they pick up. There is no third option that splits the difference; a freight estimate added to a pickup price is a different conversation that requires a deal-check.

---

## 3. Route economics — how we actually make money at scale

USA Gummies' wholesale economics are not "per customer." They are "per route." A truck that goes out and stops at one $3.00 / 3-pallet anchor and three $3.49 / master-carton fills makes meaningfully more money than a truck dispatched to a single $3.49 / pallet customer.

**Route P&L identity (canonical):**

```
Route revenue        =  Σ (bag_count_per_stop × per_bag_price)
Route product COGS   =  total_bags × $1.77                             (per /contracts/wholesale-pricing.md §1)
Route freight cost   =  fuel + driver-time-equivalent (founder-drive)  OR  LTL broker bid (fallback)
Route margin         =  Route revenue  −  Route product COGS  −  Route freight cost
```

Profit lives in **density** — how many margin-bearing fill stops a single anchor pays for. The $3.00 anchor often nets close to break-even on the freight leg in isolation; the $3.25–$3.49 fills carry the actual margin.

**This is the structural moat** (locked in `/contracts/wholesale-pricing.md` §3 "Founder-driven freight"). At ~16 mpg loaded with diesel ~$3.95/gal, fuel-only cost beats LTL by 30–50% per pallet. Multi-stop routing compounds the math via opportunistic sales calls + sample drops along the route. Margin models for any landed offer default to drive economics; LTL is the fallback when the founder cannot make the trip.

**Implication for the deal-check (§7):** before approving a landed-pricing offer, the route plan must show at least one anchor + fills sufficient to clear the route freight. A standalone $3.00 / 3-pallet stop with no route around it should be flagged.

---

## 4. Freight is a ROUTE cost, not a SINGLE-CUSTOMER cost

This is the doctrinal reframe. Old mental model: "Customer X's order eats $X in freight; quote them landed at +$X/bag." New mental model:

- The *route* has a freight cost.
- The route has multiple stops.
- Each stop's per-bag price is set by its role on the route (anchor / fill / pickup), not by its individual freight share.
- Freight is allocated to the *route P&L*, not to one stop's invoice line.

**Why it matters:**

- A $3.49 / single-master-carton fill on an already-anchored route is highly profitable, even though "its share" of route freight is non-trivial.
- A $3.00 / 3-pallet anchor with no fills behind it can underperform, even though "its share" is tidy on paper.
- Quoting freight as a per-stop cost biases us toward defensive prices that miss the route opportunity.

**Operationally:** sales conversations price by role (anchor / fill / pickup), not by per-stop freight estimate. Freight estimates show up only when a stop is *off-route* and we have to spin a dedicated trip — that is a deal-check trigger (§7).

---

## 5. Route-anchor vs route-fill logic

| Question | Anchor ($3.00) | Fill ($3.25–$3.49+) | Pickup ($2.00) |
|---|---|---|---|
| Quantity | ≥ 3 pallets | 1 case → 2 pallets typical | Any |
| Geography | Drives the route — picks the destination | Along an already-justified route | Buyer comes to Ashford |
| Frequency | Monthly / quarterly reorder (the standing customer) | Opportunistic, repeatable | One-off or set-up by buyer's logistics |
| Conversion bar | High (we will reroute the truck for this account) | Medium (we will add this stop if it's near the route) | Standard (no route impact) |
| Commitment language | "We're routing to your region — we can serve [Y, Z] also at fill rates." | "We're already routing to [region] on [date]; we can drop a master carton at [X]." | "Pickup is $2.00 / bag. Here's our dock address and hours." |

**Anchor-fill chaining:** when an anchor lands, the salesperson immediately scopes nearby fill prospects — co-located retailers, distributors, demo stops, sample drops. The CRM adjustment is to tag the anchor's region and surface fill candidates within a 2-hour radius for the next 7 days.

**Fill-anchor inversion:** if 4+ fill prospects cluster in a region without an anchor, that becomes a route-development play — we pursue an anchor in that region rather than dispatching for fills alone.

---

## 6. Escalation clauses — mandatory on every reorder, landed, or strategic offer

Every non-pickup, non-published-grid pricing offer goes out with an **escalation clause**. The clause protects margin on reorders and prevents customers from anchoring our price downward as costs move.

**Required escalation language (paste-ready):**

> Pricing is held at this level for the current order and the next [N] pallets / [M] months, whichever comes first. Reorders beyond that window are subject to repricing based on (a) input cost movement (gelatin, sugar, packaging, freight), (b) route density at the time of the reorder, and (c) any updates to USA Gummies' standard wholesale pricing schedule.

**Variants by deal type:**

- **Reorder protection (anchor account):** N = 3 pallets, M = 90 days. Reorders inside that window honor the anchor price.
- **Landed delivery offer:** N = 1 pallet, M = 30 days. Landed prices are exposed to freight market drift; tighter window.
- **Strategic / promotional / show special:** N and M named explicitly in the deal memo. Defaults to "this order only" unless the deal-check approved otherwise.

**Hard rule:** **Never promise "forever pricing"** without explicit Ben + Rene approval (Class C `pricing.change` per [`/contracts/approval-taxonomy.md`](approval-taxonomy.md)). Any salesperson, agent, or template that emits a price without an escalation clause has produced a defect.

---

## 7. Deal-check — the internal checkpoint before non-standard pricing leaves the building

**Definition:** any pricing offer that is not a published B1–B5 line in [`/contracts/wholesale-pricing.md`](wholesale-pricing.md) §2 *or* not the standing distributor offer in [`/contracts/distributor-pricing-commitments.md`](distributor-pricing-commitments.md) is a **non-standard offer** and requires a deal-check before it is sent.

### 7.1 Triggers for deal-check

A deal-check is mandatory when ANY of the following apply:

1. The quoted price is below the published B-tier for the order shape.
2. The quoted price is at or below $2.49 / bag for any order other than a Sell-Sheet-v3 standing distributor.
3. The offer includes landed freight on an order < 3 pallets.
4. The offer includes "free freight" on a sub-3-pallet order.
5. The offer uses route-anchor pricing ($3.00 / 3-pallet) without a route plan (anchor + ≥ 1 fill candidate identified).
6. The offer is a reorder protection beyond the default escalation window (N > 3 pallets, M > 90 days).
7. The buyer is asking for "best price" with no quantity / freight / route context — that is a deal-check trigger, not an answer.

### 7.2 Deal-check process

The deal-check is a fast internal checkpoint, not a slow approval. Default cycle time: **under 30 minutes**. The flow:

1. **Salesperson posts the proposed offer** in `#wholesale` Slack with: customer, geography, requested price, quantity, freight ask, route role (anchor / fill / pickup), and an escalation clause.
2. **Ben** classifies the deal (anchor / fill / pickup / strategic) and signs off on the commercial terms.
3. **Rene** signs off on the financial / margin / freight side (verifies COGS + freight allocation lands on the right account; flags any AR / credit-limit issue).
4. **Both ack** in the thread; salesperson copies the approved language verbatim into the customer-facing message and sends.

Approval class mapping (per [`/contracts/approval-taxonomy.md`](approval-taxonomy.md)):

- Single non-standard order quote, on the published B-grid floor or above → **Class B `account.tier-upgrade.propose`** (Ben).
- Pricing that diverges from the published B-grid (any of the §7.1 triggers) → **Class C `pricing.change`** (Ben + Rene).
- Promising "forever pricing" or modifying discount rules → **Class D `pricing.discount.rule.change`** (red-line; never autonomous; manual only).

### 7.3 Speed externally, checkpoint internally

The doctrine: move fast in the buyer-facing conversation (don't go silent for hours), but always run the deal-check before pricing precedent is created. A bad deal-check delay loses momentum; a missing deal-check creates a precedent that haunts every future buyer who hears about it.

**Fast path:** if the proposed offer matches the published B-grid AND the standing distributor schedule, no deal-check is required. The salesperson quotes the grid price + escalation clause and proceeds.

---

## 8. Partner communication — Ben ↔ Rene operating rhythm

Ben and Rene operate the pricing and route doctrine as a partnership, not as escalation tiers.

| Ben's lane | Rene's lane | Joint lane |
|---|---|---|
| Sales conversations, route classification, anchor vs fill calls, customer commitments, founder-drive routing, in-person partner relationships | Margin sanity-check, freight allocation, AR / credit-limit, QBO posting, BoM cost movement, escalation-clause variant selection on a deal | Class C `pricing.change` co-approval; quarterly review of the published B-grid; route-density forecast review |

**Communication channel for pricing decisions:** `#wholesale` for the deal itself. `#financials` for the financial review side. Both threaded; never a DM. Audit trail lives in `#ops-audit` per [`/contracts/governance.md`](governance.md) §1 #3.

**Cadence:**

- **Live ops:** Slack threads as deals come in; deal-check default cycle time < 30 min.
- **Weekly:** route-density review (Ben + Rene, ~15 min). Looks at the past week's anchor-fill ratio, fill stops missed, anchor accounts whose escalation window is closing.
- **Monthly:** B-grid review. Are the anchor / fill / pickup numbers still right given input-cost movement? Drift gets logged as an open item; structural changes go through Class C `pricing.change`.
- **Quarterly:** doctrinal review. Is the route-economics model still describing reality? Note in the version history below.

**Hard rule:** neither Ben nor Rene quotes a non-standard price without the other's sign-off. The partnership rule is bidirectional — Rene also does not commit a financial term (write-off, credit-limit, freight-account-change) that has commercial-relationship implications without Ben's sign-off. The system is designed so that one approver's silence is never the same as approval.

---

## 9. What this doctrine binds

This doctrine is the source-of-truth for:

1. **Sales scripts and pitch templates** — `/contracts/outreach-pitch-spec.md`, `/contracts/wholesale-onboarding-flow.md`, any future cold-outreach or trade-show variants. Pricing language MUST cite the role (anchor / fill / pickup) and ship the escalation clause from §6.
2. **Pricing calculators** — `src/lib/wholesale/pricing-tiers.ts`, `src/app/booth/BoothOrderForm.tsx`, future `/api/ops/wholesale/quote`. Calculators MUST produce a deal-check trigger when any of the §7.1 conditions fire.
3. **Claude / agent prompts** — Viktor (`/contracts/viktor.md`), Faire-specialist (`/contracts/agents/faire-specialist.md`), Ops (`/contracts/agents/ops.md`), Wholesale-onboarding flow agents. Agents MUST refuse to autonomously emit a non-standard offer; their output is a deal-check request, not a quote.
4. **Notion / company OS sync** — the `USA Gummies — Business Model & Strategic Framework (Definitive)` page (id `3334c0c4-2c2e-81c9-81db-dd041807ae56`) carries this doctrine as a CANONICAL ADDENDUM section, mirroring this file's content verbatim.
5. **Customer-facing messaging** — escalation clauses are non-optional; "forever pricing" language is a defect.

---

## 10. Hard-rule index (for the linter, the deal-check checklist, and the agents)

For machine-readable + checklist use:

- `R1` — `$2.00/bag` is **pickup-only / buyer-paid freight only**.
- `R2` — `$3.00/bag` is **landed route-anchor pricing with a 3-pallet minimum**.
- `R3` — `$3.25–$3.49+/bag` is **route-fill margin** for smaller / flexible / opportunistic stops.
- `R4` — **3 pallets anchors the route; 6–8 pallets optimizes the route.**
- `R5` — **Freight is a route cost, not a single-customer cost.**
- `R6` — **Route density is how USA Gummies controls profitability at scale.**
- `R7` — **Escalation language is mandatory** on reorder, landed, or strategic pricing offers.
- `R8` — **No "forever pricing"** without explicit Class C `pricing.change` approval (Ben + Rene).
- `R9` — **Any non-standard pricing offer requires a deal-check** before sending.
- `R10` — **Move fast externally, but checkpoint internally** before pricing precedent is created.

---

## 11. Open reconciliations vs `/contracts/wholesale-pricing.md` v2.2

> **Reconciliation proposal in flight:** [`/contracts/proposals/pricing-grid-v2.3-route-reconciliation.md`](proposals/pricing-grid-v2.3-route-reconciliation.md) v0.1 — six-class taxonomy proposal, awaiting Ben + Rene Class C `pricing.change` ratification in `#wholesale` (cross-post `#financials`). On ratification, this section is marked CLOSED and `wholesale-pricing.md` graduates to v2.3.

The route-governance numbers in §1 do not yet reconcile cleanly with the SKU/tier grid in `/contracts/wholesale-pricing.md` §2. Tracked here for the next wholesale-pricing version bump:

| Doctrine name (this file) | Per-bag | Closest current B-tier | Notes |
|---|---|---|---|
| **Pickup floor** ($2.00 / bag, pickup-only) | $2.00 | *No equivalent in B1–B5.* | The B-grid does not currently expose a $2.00 pickup tier. The closest committed offer is the Sell-Sheet-v3 distributor floor ($2.10 delivered, Inderbitzin Option B per `/contracts/distributor-pricing-commitments.md`). The new pickup-floor is **not delivered** and is structurally distinct. **Action:** evaluate adding a `B0-pickup` tier or adjacent SKU at the next wholesale-pricing version bump, or document $2.00 pickup explicitly as an out-of-grid Class C deal-check default. |
| **Route anchor** ($3.00 / bag, landed, 3-pallet min) | $3.00 | `B5` is currently $3.00 / pallet **buyer-pays** (NOT landed). | Doctrinal evolution: the route-economics frame treats $3.00 as the *landed* anchor price (USA Gummies absorbs freight as a route cost), where $3.00 in the SKU grid was the *buyer-pays* price. **Action:** at the next version bump of `wholesale-pricing.md`, decide whether `B5` becomes the landed-anchor (and what replaces it as the buyer-pays pallet floor), or whether route-anchor pricing lives off-grid as a Class C deal-check default. |
| **Route fill** ($3.25–$3.49+ / bag, landed) | $3.25–$3.49+ | `B2` ($3.49 landed master carton) and `B4` ($3.25 landed pallet) | Mostly aligned. The doctrine adds the conceptual framing (these are *fill* margins, only profitable because an anchor justified the route). No SKU grid change required, only a labeling/comment refresh on `pricing-tiers.ts` to surface the role. |

**Action owners:** Ben + Rene to ratify the reconciliation in a Class C `pricing.change` thread; this doctrine is live in the meantime.

---

## 12. Cross-references

- [`/contracts/wholesale-pricing.md`](wholesale-pricing.md) — SKU/tier grid (`B1`..`B5`, freight modes, batch SKUs, atomic bag inventory model). v2.2.
- [`/contracts/distributor-pricing-commitments.md`](distributor-pricing-commitments.md) — Sell-Sheet-v3 distributor commitments, Option-A / Option-B Inderbitzin pricing, Glacier PO 140812.
- [`/contracts/approval-taxonomy.md`](approval-taxonomy.md) — Class B `account.tier-upgrade.propose` (Ben), Class C `pricing.change` (Ben + Rene), Class D `pricing.discount.rule.change` (red-line).
- [`/contracts/governance.md`](governance.md) — non-negotiables (§1), audit-log requirement, no "just this once" exceptions (§1 #9).
- [`/contracts/outreach-pitch-spec.md`](outreach-pitch-spec.md) — pitch deck + show-deck pricing language; outbound-shipping pallet build (25 master cartons / 900 bags / pallet); 3+ pallet free-freight MOQ.
- [`/contracts/viktor.md`](viktor.md), [`/contracts/agents/faire-specialist.md`](agents/faire-specialist.md), [`/contracts/agents/ops.md`](agents/ops.md) — agents whose pricing prompts must reference this doctrine.

---

## Version history

- **1.0 — 2026-04-29** — First canonical publication. Codifies the route-economics layer that overlays the B1–B5 SKU grid: three doctrinal price points (pickup floor / route anchor / route fill), landed-vs-pickup operational distinction, route P&L identity, freight-as-route-cost reframe, escalation-clause requirement, deal-check process, Ben↔Rene partner operating rhythm. Open reconciliations vs `wholesale-pricing.md` v2.2 captured in §11 for the next pricing version bump.
