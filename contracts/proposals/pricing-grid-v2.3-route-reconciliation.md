# Proposal — Pricing Grid v2.3 (Route Reconciliation)

**Status:** PROPOSAL — awaiting Ben + Rene ratification
**Version:** 0.1 (PROPOSAL) — 2026-04-29
**Author:** Claude Code (drafting on behalf of Ben)
**Decision target:** Ben + Rene, Class C `pricing.change` thread in `#wholesale` (with `#financials` cross-post).
**Source documents reconciled:**
[`/contracts/pricing-route-governance.md`](../pricing-route-governance.md) v1.0 §11
+ [`/contracts/wholesale-pricing.md`](../wholesale-pricing.md) v2.2 §2
+ [`/contracts/distributor-pricing-commitments.md`](../distributor-pricing-commitments.md) v1.0
+ [`/contracts/approval-taxonomy.md`](../approval-taxonomy.md) v1.6
+ `src/lib/wholesale/pricing-tiers.ts` (B1–B5 closed enum + tests).

> **This document is a proposal, not live policy.** It exists to give Ben + Rene a single, scoped artifact to ratify. Until ratified, the live policy is `wholesale-pricing.md` v2.2 (SKU/tier grid) + `pricing-route-governance.md` v1.0 (governance overlay, with §11 reconciliations explicitly open). No live pricing logic changes from this doc — the only file edits this proposal makes outside its own creation are documentation cross-links.

---

## 0. Why this exists

Two governance-overlay rules in [`pricing-route-governance.md`](../pricing-route-governance.md) §1 do not reconcile cleanly with the SKU/tier grid in [`wholesale-pricing.md`](../wholesale-pricing.md) v2.2 §2:

1. **`$2.00/bag pickup floor`** — does not exist in the B1–B5 grid. The closest committed offer is the Sell-Sheet-v3 distributor floor at $2.10 *delivered* ([`distributor-pricing-commitments.md`](../distributor-pricing-commitments.md) §1–§2, Inderbitzin Option B / Glacier PO 140812). The new pickup floor is structurally distinct: pickup-only, NOT delivered, freight is the buyer's problem.
2. **`$3.00/bag landed route-anchor`** — collides with the current `B5` definition (`$3.00/bag pallet, BUYER-PAYS freight`). The route-economics frame moves $3.00 from "pallet, buyer-pays" to "landed anchor with 3-pallet minimum, USA Gummies absorbs freight as a route cost." The same number means two different things in the two docs.

Both reconciliations are flagged in `pricing-route-governance.md` §11 as open and "to be ratified in a Class C `pricing.change` thread." This proposal provides the artifact for that ratification.

The hard rules that MUST survive any reconciliation (per `pricing-route-governance.md` §10):

- `R1` — `$2.00/bag` is **pickup-only / buyer-paid freight only**.
- `R2` — `$3.00/bag` landed requires **3-pallet minimum and route economics**.
- `R3` — `$3.25–$3.49+` is **route-fill margin**.
- `R4` — **3 pallets anchors the route; 6–8 pallets optimizes the route.**
- `R5` — **Freight is a route cost, not a single-customer cost.**
- `R6` — **Route density is how USA Gummies controls profitability at scale.**
- `R7` — **Escalation language is mandatory** on reorder, landed, or strategic offers.
- `R8` — **No "forever pricing"** without explicit Class C `pricing.change`.
- `R9` — **Any non-standard pricing offer requires a deal-check** before sending.
- `R10` — **Move fast externally, but checkpoint internally** before pricing precedent is created.

Hard rule preserved by this proposal: **buyer-paid `$3.00` pallet pricing and landed `$3.00` route-anchor pricing are DIFFERENT classes and do not collapse.** Either both stay in the grid (under different designators), or one leaves the grid and the proposal makes that explicit.

---

## 1. Six pricing classes (proposed taxonomy)

The route-governance doctrine creates a *role-based* lens (anchor / fill / pickup) on top of the SKU-shape lens (case / master carton / pallet) that the B-grid uses. This proposal merges the two lenses into a single class taxonomy of **six classes**, each with a clear approval class, freight model, and outbound-template eligibility.

The class names below are doctrinal labels for the proposal. The B1–B5 designators referenced in code, audit logs, and QBO line text are mapped to classes in §3 and either preserved, renamed, or supplemented depending on which decisions Ben + Rene make in §6.

| Class | Doctrinal name | One-line summary |
|---|---|---|
| **C-PU** | Pickup / FOB Ashford | $2.00/bag, buyer-arranged freight, dock-of-Ashford. New class — does not exist in v2.2. |
| **C-DIST** | Distributor / buyer-paid freight | Sell-Sheet-v3 standing offer ($2.49 delivered) + negotiated Option-B floors ($2.10 delivered, Inderbitzin/Glacier). Already canonical via `distributor-pricing-commitments.md`; not part of the B-grid. |
| **C-STD** | Standard pallet wholesale | Today's `B4` ($3.25 landed pallet) + `B5` ($3.00 buyer-pays pallet) — the published online-flow pallet tiers. |
| **C-ANCH** | Landed route-anchor | $3.00/bag, 3-pallet minimum, USA Gummies absorbs freight as a route cost. Today's `B5` price reused with a different freight model. NEW class. |
| **C-FILL** | Route-fill wholesale | $3.25–$3.49+/bag, landed, smaller / opportunistic stops on an already-justified route. Today's `B2` + `B4` reused with route-context framing. |
| **C-EXC** | Strategic credential exception | Any deal that does not fit the five classes above (trade-show specials, founder-prospect plays, accounts-as-credential plays). Always Class C; always deal-checked; always escalation-claused. |

Each class is detailed in §2.

---

## 2. Class detail (proposed)

### 2.1 `C-PU` — Pickup / FOB Ashford

- **Per-bag price:** **$2.00**.
- **Freight:** **NONE on our P&L.** Buyer's carrier or buyer in person; pickup at the Ashford warehouse during published hours. **Never quote $2.00 as landed.**
- **Minimum:** None on the floor. Operationally, sub-master-carton pickups are friction (open inventory, broken seal, etc.) so the pickup-friendly default is **≥ 1 master carton (36 bags).** Below that requires deal-check with extra friction notes.
- **Approval:** **Class C `pricing.change`** the first time the floor is offered to a new buyer (precedent setting). Subsequent reorders from the same buyer at the same price → **Class B `account.tier-upgrade.propose`** with the prior approval id cited.
- **Escalation language required:** YES.
- **Can be offered without Rene review:** NO. First-time deals require Rene's freight-zero / margin sanity-check sign-off because $2.00 is below the standard B-grid floor and below committed-distributor floors. After ratification, Rene + Ben can decide whether to relax this for repeat buyers under a named credit limit.
- **Outbound-template eligible:** NO. Pickup pricing is a 1:1 conversation, not a templated push. Listing $2.00/bag in cold outreach would (a) drag the perceived market price downward, (b) attract pickup-tourists who burn ops time without route value, and (c) anchor distributors to argue for matching delivered pricing.
- **Why this class exists:** lets us serve repackers, deep-discount channels, and strategic accounts that handle their own logistics, without distorting the published wholesale grid.

### 2.2 `C-DIST` — Distributor / buyer-paid freight

- **Per-bag price:**
  - **$2.49/bag delivered** — Sell-Sheet-v3 standing offer.
  - **$2.50/bag delivered** — Option A (with counter display).
  - **$2.10/bag delivered** — Option B (loose bags, no display) — Inderbitzin, Glacier.
- **Freight:** Always delivered (USA Gummies eats the freight). This is the existing committed distributor pattern; the *delivered* clause is non-negotiable per [`distributor-pricing-commitments.md`](../distributor-pricing-commitments.md) §1 + §3 ("Do NOT add a freight line to a 'delivered' distributor's invoice").
- **Minimum:** Sell sheet sets net-30 + 100% buyback; minimums are negotiated per distributor and tracked on each commitment row.
- **Approval:** **Class C `pricing.change`** for any new distributor admission. Standing distributor reorders at locked terms → **Class A `system.read` + Class B `qbo.invoice.draft`** workflow already wired.
- **Escalation language required:** YES (escalation clause is the mechanism that protects against indefinite carry of these floors as input costs move).
- **Can be offered without Rene review:** NO for new distributors. YES for reorders from the named distributors in `distributor-pricing-commitments.md` at their locked terms.
- **Outbound-template eligible:** YES for the sell-sheet ($2.49 delivered) when the audience is a vetted distributor list. NOT eligible for the negotiated floors (Option A/B) — those are 1:1.
- **Why this class is separate from `C-PU`:** distributors are *delivered* customers with a buyback clause and net-30 terms. Pickup is a fundamentally different relationship. Conflating them creates a classic "best of both worlds" demand from buyers ("I'll pay your pickup price AND I want you to deliver").

### 2.3 `C-STD` — Standard pallet wholesale

- **Per-bag price:**
  - `C-STD-LAND` (today's B4): **$3.25** landed master carton or pallet.
  - `C-STD-BPF` (today's B5): **$3.00** pallet with buyer-paid freight — *if* B5 stays in the grid (decision §6.3).
- **Freight:** Landed (`C-STD-LAND`) or buyer-paid (`C-STD-BPF`).
- **Minimum:** 1 master carton or 1 pallet, per the published B-grid.
- **Approval:** **Class A** to quote at the published price (no human approval gate for grid-matching offers). **Class B `account.tier-upgrade.propose`** if the buyer is being moved between tiers as part of a tier upgrade. **Class C `pricing.change`** only if the offer deviates from the grid.
- **Escalation language required:** YES on every published quote (per `R7`). The "pricing held for [N] pallets / [M] months" template runs by default.
- **Can be offered without Rene review:** YES at published prices. NO if any §7.1 deal-check trigger fires.
- **Outbound-template eligible:** YES. This is the workhorse class for the wholesale onboarding flow + outreach pitch deck.
- **Why this class is separate from `C-ANCH`:** at the same $3.00/bag number, B5 is buyer-pays and `C-ANCH` is landed. The freight model is the differentiator, not the price. Collapsing them would create the exact conflict §11 of the route-governance doctrine flagged.

### 2.4 `C-ANCH` — Landed route-anchor

- **Per-bag price:** **$3.00 landed**.
- **Freight:** **LANDED** — USA Gummies absorbs as a route cost, not a per-customer cost (`R5`).
- **Minimum:** **3 pallets** (`R2`). Below this MOQ, the price is not on the table; the buyer is offered `C-STD` instead.
- **Approval:** **Class C `pricing.change`** by default — first time route-anchor pricing is offered to any buyer is a precedent. Once a route-anchor relationship is established (an account has reordered at this price 2+ times), subsequent reorders at the same price within an *approved route corridor* (§6.4) → **Class B `account.tier-upgrade.propose`** with the prior approval id cited.
- **Escalation language required:** YES (anchor accounts have the longest-running pricing exposure; this is non-optional).
- **Can be offered without Rene review:** NO. Landed-pricing margin sanity-check + freight-allocation sign-off is Rene's lane (`pricing-route-governance.md` §8).
- **Outbound-template eligible:** **NO unqualified template language.** Route-anchor offers can only ship in templates that are gated to a specific identified prospect with a route plan attached. "$3.00/bag landed, 3-pallet minimum" as a generic outbound line creates undifferentiated demand and breaks the route-economics model.
- **Why this class is new:** the route-economics frame requires pricing by *role* (anchor / fill / pickup), not by SKU shape alone. Anchor pricing is the reason a truck moves; fill pricing is the margin on stops the truck makes anyway.

### 2.5 `C-FILL` — Route-fill wholesale

- **Per-bag price:** **$3.25–$3.49+** landed.
  - $3.25 mirrors today's `B4` price for landed pallets.
  - $3.49 mirrors today's `B2` price for landed master cartons.
  - The "+" is real: where margin is available on a high-density route, fill stops can be quoted higher than $3.49 (e.g. $3.59, $3.79) at deal-check discretion.
- **Freight:** **LANDED** — built into the bag price, allocated to the route P&L.
- **Minimum:** 1 master carton (`B2` shape) or 1 pallet (`B4` shape). The defining trait of a fill stop is that the truck is *already* going there for an anchor.
- **Approval:** **Class A** when the offer matches `B2` or `B4` published prices and the prospect is on a planned route. **Class C `pricing.change`** when the price exceeds $3.49 or the route is not yet planned.
- **Escalation language required:** YES.
- **Can be offered without Rene review:** YES at the $3.25 / $3.49 published anchors and a planned route. NO above $3.49 or off-route.
- **Outbound-template eligible:** YES — but the template should frame the offer as "we're already routing to [region] on [date]; we can drop a master carton at [X]" rather than as a generic price quote. This is the operational language that signals fill-not-anchor.
- **Why this class exists separately:** fill stops are highly profitable because the route freight is paid by the anchor. Treating them as standalone wholesale (the v2.2 mental model) under-monetizes the truck.

### 2.6 `C-EXC` — Strategic credential exception

- **Per-bag price:** Variable — set by the deal memo. Examples that have triggered this class historically: one-off trade show specials (Reunion 2026), founder-prospect plays, accounts taken on for credential value (e.g. brand-name retailers below margin floor).
- **Freight:** Variable — landed, pickup, or split, per deal memo.
- **Minimum:** Variable.
- **Approval:** **ALWAYS Class C `pricing.change`** with explicit deal memo in the approval thread (per `R9` + `R10`). No exceptions. No "just this once" precedent — strategic credential deals are one-off by design and the deal memo says so verbatim.
- **Escalation language required:** YES, with deal-specific N and M values named in the memo.
- **Can be offered without Rene review:** **NO. Never.** Class C is dual-approval by definition (`/contracts/approval-taxonomy.md` §"Class C").
- **Outbound-template eligible:** **NO.** By definition these are 1:1 deals; templating them would defeat the purpose.
- **Why this class is named:** the doctrine's `pricing.discount.rule.change` red-line (Class D, prohibited) is preserved by giving every legitimate non-grid deal a path through `pricing.change` (Class C). Without this class, the temptation is to either (a) red-line a legitimate deal that should be approveable, or (b) shoehorn it into `C-STD` and break the grid's integrity.

---

## 3. The proposed v2.3 grid (consolidated table)

| Class | Designator(s) | $ / bag | Freight | MOQ | Approval class | Escalation required | Rene review required | Outbound template eligible |
|---|---|---|---|---|---|---|---|---|
| **C-PU** Pickup / FOB Ashford | NEW (proposed `B0-PU` if added to grid) | **$2.00** | Buyer-paid (pickup or buyer's carrier) | None on floor; ≥ 1 MC operationally preferred | Class C first-time, Class B for named-buyer reorders at same price | YES | YES (always for first-time) | NO |
| **C-DIST** Sell-sheet | (off-grid; tracked in `distributor-pricing-commitments.md`) | $2.49 | Delivered (USA Gummies absorbs) | Per distributor agreement | Class C first-time admit; Class A/B for standing-distributor reorders | YES | YES for new; NO for standing | YES (sell sheet) |
| **C-DIST** Option A | (off-grid) | $2.50 | Delivered | Per agreement | Class C admit; standing reorder Class A/B | YES | YES new; NO standing | NO (1:1 negotiated) |
| **C-DIST** Option B | (off-grid) | $2.10 | Delivered | Per agreement | Class C admit; standing reorder Class A/B | YES | YES new; NO standing | NO (1:1 negotiated) |
| **C-STD** Master carton landed (today `B2`) | `B2` | $3.49 | Landed | 1 MC (36 bags) | Class A at grid price; Class B for tier upgrades | YES | NO at grid price | YES |
| **C-STD** Master carton buyer-pays (today `B3`) | `B3` | $3.25 | Buyer-paid | 1 MC (36 bags) | Class A at grid price | YES | NO at grid price | YES |
| **C-STD** Pallet landed (today `B4`) | `B4` | $3.25 | Landed | 1 pallet (900 bags) | Class A at grid price | YES | NO at grid price | YES |
| **C-STD** Pallet buyer-pays (today `B5`, **if retained — see §6.3**) | `B5` | $3.00 | Buyer-paid | 1 pallet (900 bags) | Class A at grid price | YES | NO at grid price | YES |
| **C-ANCH** Landed route-anchor | NEW (proposed `B6-ANCH`) | **$3.00** | Landed (route cost) | **3 pallets** (2,700 bags) | Class C first-time; Class B for reorder in approved corridor | YES | YES (always for first-time) | NO unqualified |
| **C-FILL** Route-fill | (reuses `B2`/`B4` shape with role-context) | $3.25–$3.49+ | Landed | 1 MC or 1 pallet on a planned route | Class A at grid; Class C above $3.49 or off-route | YES | NO at grid + on-route; YES otherwise | YES (with role-framing) |
| **C-EXC** Strategic credential | (off-grid) | Variable | Variable | Variable | **Always Class C** with deal memo | YES (deal-specific N/M) | YES (always) | NO |

**Designator note (`B6-ANCH`, `B0-PU`):** the proposed new designators are placeholders. If §6.3 keeps `B5` as the buyer-pays pallet, then route-anchor needs a new code (`B6-ANCH` is the natural choice). If §6.3 retires `B5` and reassigns the price+code to landed, route-anchor *takes the `B5` slot* and we don't need `B6`. Likewise pickup floor: `B0-PU` keeps the alphanumeric grid sortable; an alternative is `B6-PU` if `B6` is freed up. Final designators are part of the §6 decision.

**Grid enum impact:** the closed enum in `src/lib/wholesale/pricing-tiers.ts` is currently `"B1" | "B2" | "B3" | "B4" | "B5"`. Adding `C-PU` and `C-ANCH` to the grid expands this enum. See §5 for the file deltas.

---

## 4. Approval-class mapping (cross-reference)

This proposal does NOT introduce new approval slugs. Every class above maps to existing slugs in [`approval-taxonomy.md`](../approval-taxonomy.md) v1.6:

| Action | Class | Slug | Approver(s) | Source |
|---|---|---|---|---|
| Quote at the published B-grid (`C-STD`, `C-FILL` on-route ≤ $3.49) | A | `system.read` + `slack.post.audit` for the deal-check entry | (none) | Already canonical. |
| Tier upgrade for a named retailer (`C-STD`, `C-PU` reorder) | B | `account.tier-upgrade.propose` | Ben | Already canonical; v1.6 already cross-links this row to `pricing-route-governance.md` §7. |
| Any non-standard pricing offer (`C-PU` first-time, `C-ANCH` first-time, `C-FILL` > $3.49 or off-route, `C-EXC` always) | C | `pricing.change` | Ben + Rene | Already canonical; v1.6 already cross-links this row to `pricing-route-governance.md` §7.1. |
| Promise "forever pricing" or modify discount rules autonomously | D (red-line) | `pricing.discount.rule.change` | (manual only) | Already canonical. The doctrine's `R8` references this. |

**No new slugs proposed.** The deal-check process already lives in `pricing-route-governance.md` §7 and routes to `pricing.change` for all the proposal's non-standard cases. If §6.4 decides route-anchor reorders inside an approved corridor should be even lighter than Class B, that would be a `pricing-route-governance.md` doctrinal amendment (not a new slug); flag it then.

---

## 5. What changes if this proposal is accepted

Acceptance is a Class C `pricing.change` thread between Ben + Rene. On acceptance, the following file deltas are queued for follow-up Phase work — **none of which run as part of this proposal commit**:

### 5.1 Doctrine deltas

- [`/contracts/wholesale-pricing.md`](../wholesale-pricing.md) → **v2.3**: §2 "five core pricing line items" becomes "six (or seven) core pricing line items" depending on §6.3. Adds rows for `C-PU` and `C-ANCH` with their freight + MOQ rules. §3 "Freight / delivery quote logic" gains a fourth row for "Route cost" allocation. §11 in `pricing-route-governance.md` v1.0 marked CLOSED with a pointer to this proposal as the resolution artifact.
- [`/contracts/pricing-route-governance.md`](../pricing-route-governance.md) → **v1.1**: §11 marked CLOSED. §1 table cross-references the new B-grid designators verbatim. Version-history entry references this proposal.
- [`/contracts/distributor-pricing-commitments.md`](../distributor-pricing-commitments.md) → **v1.1** (optional): cross-link `C-DIST` framing for clarity.

### 5.2 Code deltas (`src/lib/wholesale/pricing-tiers.ts`)

- `PricingTier` closed enum expands by 0–2 members (depending on §6.1, §6.2, §6.3).
- `BAG_PRICE_USD` adds entries for new tiers; *if* `B5` is reassigned (§6.3), its price entry is updated and the test invariant in `__tests__/pricing-tiers.test.ts` lines 36–40 is amended to match.
- `BAGS_PER_UNIT` adds `B0-PU = 36` (if pickup tier is grid-resident at master-carton MOQ) and `B6-ANCH = 2700` (3 pallets × 900 bags).
- `FREIGHT_MODE` adds `B0-PU = "buyer-paid"` and `B6-ANCH = "landed"`. *If* `B5` is reassigned, its freight-mode flips from `"buyer-paid"` to `"landed"`.
- `ONLINE_AVAILABLE` for new tiers: `B0-PU = false` (pickup is 1:1, not online-flow) and `B6-ANCH = false` (route-anchor is 1:1 with an approved corridor, not online-flow).
- `TIER_DISPLAY` and `TIER_INVOICE_LABEL` get the new copy strings.
- `FulfillmentType` mapping (LCD/MCL/MCBF/PL/PBF) gains new codes for pickup + anchor.

### 5.3 Test deltas (`src/lib/wholesale/__tests__/pricing-tiers.test.ts`)

- `describe("BAG_PRICE_USD per-tier prices ...")` block adds assertions for new tiers; updates `B5` if reassigned.
- `describe("FREIGHT_MODE classification per tier")` block adds assertions for new tiers.
- `describe("ONLINE_AVAILABLE — B1 is INTERNAL only ...")` block extends to assert `B0-PU` and `B6-ANCH` are also INTERNAL.
- `describe("Designator stability invariant")` block — verifies the grid expansion does not break existing invariants.
- New `describe("Route-economics deal-check triggers")` block (optional, future work) — asserts that calculator helpers emit the §7.1 deal-check trigger flags correctly.

### 5.4 No live pricing logic changes from THIS commit

The only files this proposal commit edits are:

1. `contracts/proposals/pricing-grid-v2.3-route-reconciliation.md` — NEW (this file).
2. `contracts/README.md` — adds a row for `proposals/` directory + this file.
3. `contracts/pricing-route-governance.md` — adds a cross-link to this proposal at §11 (without changing §11's content; the reconciliations remain open until ratification).
4. `contracts/wholesale-pricing.md` — adds a one-line cross-link in the header `Pairs with:` field.

Repo-check expectation: `tsc --noEmit` exit 0; `node scripts/check-seo-meta.mjs` OK; `npx vitest run src/lib/wholesale/__tests__` 403/403 green (unchanged from pre-commit).

---

## 6. Decision Required (Ben + Rene)

The five decisions below are the irreducible policy choices. Everything else in §1–§5 is mechanical follow-on once these are answered. Please respond inline in `#wholesale` (cross-post `#financials`) with `Q1: yes/no/option` form so the ratification is unambiguous.

### Q1. Should `$2.00` pickup-only become an official pricing class (`C-PU` / `B0-PU`)?

- **Option A — YES, grid-resident.** Add to `BAG_PRICE_USD`, `FREIGHT_MODE`, `ONLINE_AVAILABLE = false`. Deal-check on every first-time use (Class C); Class B for named-buyer reorders.
- **Option B — YES, off-grid, like distributor commitments.** Track as a doctrinal class in `pricing-route-governance.md` §1 + a new section in `distributor-pricing-commitments.md`-style doc (`pickup-pricing-commitments.md`) without entering the closed enum. Forces every $2.00 deal through Class C deal-check.
- **Option C — NO, do not formalize.** Treat $2.00 pickup as a `C-EXC` deal-by-deal exception; never templated; never grid.

**Claude's read:** Option B is the cleanest. It honors `R1` (pickup-only), avoids polluting the online wholesale flow with a grid entry that should never appear there (`ONLINE_AVAILABLE = false` either way), and keeps the precedent under tight Class C control. Option A is fine if Ben sees pickup as a recurring program; Option C only makes sense if pickup is going to be rare (< 4× / year).

### Q2. Should `$3.00` landed route-anchor become an official pricing class (`C-ANCH` / `B6-ANCH`)?

- **Option A — YES, grid-resident, NEW designator (`B6-ANCH`).** Preserves `B5` (buyer-pays pallet) intact. Both `B5` and `B6-ANCH` exist at $3.00/bag with different freight models. Audit logs and QBO line text disambiguate cleanly via the designator.
- **Option B — YES, take over `B5` slot.** Reassign `B5` to landed-anchor; designator is preserved but its meaning flips. Requires a one-shot test/migration update. Keeps the grid at five tiers (six if pickup is also added).
- **Option C — NO, off-grid only.** Route-anchor remains a doctrinal-overlay concept in `pricing-route-governance.md` §1; every offer routes through Class C. Grid stays at B1–B5 per v2.2.

**Claude's read:** Option A is the safest reconciliation because it preserves the v2.2 invariant ("designators are stable; mutating B1–B5's meaning is a contract violation," per `pricing-tiers.ts` doctrinal hard rule #2). Option B is technically correct if Ben + Rene decide buyer-pays pallet is no longer an offer (see Q3) — they can be decided together. Option C under-instruments the route-economics model: every anchor offer becomes Class C indefinitely, which is appropriate at first but slows down anchor reorders that should be Class B once the relationship is established.

### Q3. Should `B5` remain a buyer-paid freight pallet ($3.00, today's definition)?

- **Option A — YES, `B5` stays buyer-pays at $3.00.** Anchor pricing lives at `B6-ANCH`. Two tiers at the same $3.00 price point, distinguished by freight model.
- **Option B — NO, retire `B5`'s buyer-pays meaning.** The slot is reassigned to landed-anchor. Buyers who want a buyer-pays pallet are routed to a `pricing.change` Class C deal-check (effectively `C-EXC`).
- **Option C — NO, retire `B5` entirely.** Buyer-pays pallet becomes a strategic exception class only; pallet wholesale is landed-only at `B4` ($3.25) and `B6-ANCH` ($3.00 with 3-pallet MOQ).

**Claude's read:** ask Rene first. From the doctrine side, both A and C are coherent. C simplifies the grid (buyer-pays is master-carton-only via `B3`, all pallets are landed) and forces the route-economics conversation on every pallet-scale deal, which is the spirit of the doctrine. A keeps optionality at the cost of two tiers at the same price (more invoice-line ambiguity).

### Q4. Should landed route-anchor pricing require Class C approval **every time**, or only when **outside approved route corridors**?

- **Option A — Class C every time.** Maximum deal-check friction; every $3.00 landed offer is a precedent-setting moment. Best when route-anchor is rare (1–3 active anchors at a time).
- **Option B — Class C first-time, Class B for reorders inside an approved corridor.** Approved corridors are named regions where Ben + Rene have ratified a route plan (e.g. "Pacific NW corridor: WA + OR + ID, 90-day window"). Reorders from anchor accounts inside the corridor at the same price are Class B; expansions or off-corridor anchors return to Class C.
- **Option C — Class B always after first ratification.** Once $3.00 anchor is a known offer, every reorder is Class B. Aggressive but viable if Ben wants to scale anchors fast.

**Claude's read:** Option B is the doctrinally-aligned answer — it lets the route-economics model breathe (anchors can scale quickly within a known corridor) while preserving Class C friction at the boundaries (new corridors, new geographies). It also matches the pattern v1.6 of `approval-taxonomy.md` already encodes for `account.tier-upgrade.propose` (Class B with prior-approval citation) vs `pricing.change` (Class C for structural changes). The corridor concept becomes a doctrinal artifact in `pricing-route-governance.md` v1.1.

### Q5. Should all outbound offers include explicit escalation language?

- **Option A — YES, mandatory on every outbound.** No exceptions. The default pitch templates carry the escalation clause inline.
- **Option B — YES, on every non-pickup offer.** Pickup is exempt because the buyer is one-off / opportunistic; everything else (distributor, standard wholesale, anchor, fill, exception) carries the clause.
- **Option C — NO, use Ben's discretion.** The clause is recommended but not required; emit when material, skip when not.

**Claude's read:** Option A. The proposal's hard rule `R7` already says escalation language is mandatory on reorder, landed, or strategic offers. Option A extends "always" to *every* outbound including the published B-grid quotes — and it's the cheapest insurance against a customer arguing later that "you said this price; it never came with conditions." Templates absorb the clause once; the marginal text is two sentences. Option B exempts pickup, which is fine if pickup is going to be rare; Option C is the path of least resistance now and most regret later.

### Q6. Buyer-paid-freight surcharge (NEW — raised by Rene 2026-04-30)

> *Rene 2026-04-30 5:46 AM CT (`#financials`): "is there any reason buyer paid freight we don't increase the pricing by $0.25/bag? this would be anytime a buyer pays freight — we still have to handle and should get something for it and it can push them to us shipping easier — thoughts?"*

The proposal: every buyer-pays line gets *+$0.25/bag* because (a) we still pick/pack/stage the order — that work has cost, (b) the price gap pushes buyers toward landed (which we ship easier and convert to higher gross revenue).

**Today's grid + the proposed surcharge:**

| Line | Today | With +$0.25 surcharge | Delta vs landed equivalent |
|---|---:|---:|---|
| `B3` master carton buyer-pays | $3.25 | **$3.50** | now $0.01 *higher* than B2 landed ($3.49) |
| `B5` pallet buyer-pays | $3.00 | **$3.25** | now equal to B4 landed ($3.25) |
| `C-PU` pickup floor (if Q1=A keeps off-grid) | $2.00 | **$2.25** | still pickup-only; no landed comparison |

**The intentional inversion:** at +$0.25 the buyer-pays prices are equal to or *higher* than the landed equivalents — not because we want to discourage buyer-pays, but because it makes "landed" the obvious default. Buyers with cheaper-than-our-cost freight (distributors with their own carriers) still come out ahead choosing buyer-pays; everyone else picks landed.

**Decision options:**

- **Option A — YES, +$0.25 surcharge across all buyer-pays lines.** Updates B3 → $3.50, B5 → $3.25, C-PU → $2.25 (if Q1=A grid-resident). Locked into `wholesale-pricing.md` v2.3.
- **Option B — YES on master carton (B3), NO on pallet (B5).** Rationale: at pallet scale (900 bags) the handling cost per unit is tiny vs at master carton scale (36 bags). Surcharge stays on smaller orders only.
- **Option C — NO, keep current grid.** Rationale: the existing $0.24–$0.25 delta between B2/B3 + B4/B5 already covers freight; doubling that gap risks losing buyer-pays customers entirely.

**Claude's read:** Option A is the cleanest implementation of Rene's logic. It eliminates the marginal-incentive ambiguity (today a buyer with $0.50/bag freight saves money picking buyer-pays; with the surcharge they don't unless their freight is *much* cheaper). It also makes the price card simpler to communicate. Option B is the right answer if Ben prefers to keep B5 attractive as a distributor-only door — but the existing distributor commitments (Inderbitzin, Glacier) are at *delivered* prices anyway (per `/contracts/distributor-pricing-commitments.md`), so they're unaffected. Option C preserves status quo but loses the structural incentive Rene flagged.

**Margin impact** (per `/contracts/proforma-channel-margins.md` §1.9 + §1.11):

| Tier | Today GM/bag | Option A GM/bag | Delta |
|---|---:|---:|---:|
| B3 master carton buyer-pays | $1.48 | $1.73 | +$0.25 |
| B5 pallet buyer-pays | $1.23 | $1.48 | +$0.25 |
| C-PU pickup floor (if grid-resident) | $0.23 | $0.48 | +$0.25 |

Volume impact unknown until we observe buyer behavior post-change — flag for the first 90 days as a watch item.

→ Reply: `Q6: A` / `Q6: B` / `Q6: C`. Ben's call (commercial); Rene already pre-signaled YES (he raised it).

---

## 7. Risk + migration considerations

These are pre-flagged for the Class C `pricing.change` thread so neither approver gets surprised after ratification.

1. **Existing Inderbitzin / Glacier commitments** ([`distributor-pricing-commitments.md`](../distributor-pricing-commitments.md) §3) at $2.10 *delivered* are unaffected by this proposal — `C-DIST` codifies their existing terms unchanged. If §6 leads to retiring `C-DIST` as a formal class (no decision question above asks this), call it out separately; nothing here proposes that.
2. **Mike (Glacier) prior precedent at $2.10 delivered** is the ceiling for any future delivered-distributor offer. New distributor admissions BELOW $2.10 delivered are Class C deal-check + Rene-required + flagged in the deal memo as a new floor.
3. **`pricing-tiers.ts` test `Designator stability invariant`** asserts that B1–B5 do not change their meaning. Q3 Option B (reassigning B5) directly violates this invariant; the test invariant must be edited as part of the v2.3 implementation, with a doctrine version-history entry citing the Class C ratification.
4. **The wholesale onboarding flow** ([`/contracts/wholesale-onboarding-flow.md`](../wholesale-onboarding-flow.md)) currently surfaces only B2/B3/B4/B5 as customer-selectable tiers in the online flow. This proposal's `ONLINE_AVAILABLE = false` for `C-PU` and `C-ANCH` keeps the online flow unchanged; only the manual / 1:1 sales path picks up new options. This is intentional.
5. **QBO Class + Location segmentation** (CF-09 BOTH per `approval-taxonomy.md` Channel-segmentation rule) is unaffected — `C-PU` and `C-ANCH` revenue still posts to existing channel codes; the Class/Location dimension does not split on tier.
6. **Outreach pitch deck** ([`/contracts/outreach-pitch-spec.md`](../outreach-pitch-spec.md)) needs an update on Q5 ratification: if Option A is chosen, the deck's stock pricing language gains the escalation clause inline. This is a follow-up doctrine-amendment, not part of the proposal commit.
7. **Notion sync target:** the `USA Gummies — Business Model & Strategic Framework (Definitive)` page (id `3334c0c4-2c2e-81c9-81db-dd041807ae56`) is the destination for ratified doctrine. This proposal does NOT push to Notion — Notion is updated only after Ben + Rene's `#wholesale` thread ratification, with the resolved decisions and the v2.3 grid attached.

---

## 8. Cross-references

- [`/contracts/pricing-route-governance.md`](../pricing-route-governance.md) v1.0 §11 — the open reconciliations this proposal resolves.
- [`/contracts/wholesale-pricing.md`](../wholesale-pricing.md) v2.2 §2, §3 — the existing SKU/tier grid that this proposal expands or amends.
- [`/contracts/distributor-pricing-commitments.md`](../distributor-pricing-commitments.md) v1.0 §1, §2, §3 — the standing distributor offers that the `C-DIST` class codifies.
- [`/contracts/approval-taxonomy.md`](../approval-taxonomy.md) v1.6 §"Class B", §"Class C" — the `account.tier-upgrade.propose` and `pricing.change` slugs already cross-linked to the deal-check process.
- [`/contracts/outreach-pitch-spec.md`](../outreach-pitch-spec.md) — pitch language; Q5 ratification triggers an amendment.
- `src/lib/wholesale/pricing-tiers.ts` — code mirror; §5.2 deltas queued for post-ratification implementation.
- `src/lib/wholesale/__tests__/pricing-tiers.test.ts` — invariant tests; §5.3 deltas queued for post-ratification implementation.

---

## 9. Version history

- **0.1 PROPOSAL — 2026-04-29** — First draft. Maps the two open reconciliations from `pricing-route-governance.md` §11 into a six-class taxonomy (`C-PU`, `C-DIST`, `C-STD`, `C-ANCH`, `C-FILL`, `C-EXC`); proposes designator placement (`B0-PU` / `B6-ANCH`) preserving B1–B5 stability; lays out deal-check + escalation + Rene-review + outbound-template eligibility per class; surfaces 5 decisions for Ben + Rene with named defaults. No live pricing logic changes; cross-links only.
