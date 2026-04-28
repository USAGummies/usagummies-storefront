# Wholesale Pricing — LOCKED

**Status:** CANONICAL
**Source:** Ben + Rene call recap, 2026-04-27 §2 + §5 + §6
**Version:** 1.0 — 2026-04-27
**Replaces:** any ad hoc pricing scattered across previous outreach scripts. This is the single source of truth.

---

## 1. Atomic inventory model (PERMANENT)

**Inventory is tracked at the SINGLE-BAG level. Period.**

- We do not maintain separate SKUs for case / master carton / pallet as inventory units. Those are commercial / packaging *abstractions* that convert to bag quantities at order time.
- A wholesale order line that says "1 master carton" decrements inventory by **36 bags** (per the canonical case-pack at `/CLAUDE.md` "Packaging spec").
- Existing setup should already reflect this. Some prior invoices (e.g. Glacier) used master-carton descriptions in line text — that's invoice copy, not the inventory model.

**Coding rule:** Claude Code MUST NOT create new "case" / "master carton" / "pallet" inventory SKUs. Order types are pricing/order abstractions; they decrement bag inventory.

---

## 2. The five core pricing line items

There are exactly **5 wholesale pricing concepts**. Anything outside these is a deliberate special, not a default.

| Designator | Unit | Price | Freight | Where it's exposed |
|---|---|---|---|---|
| **B1** | Individual case (6 bags) | $3.49 / bag | Ben delivers locally | INTERNAL ONLY — manual PO + manual delivery. **NOT** in the online wholesale flow. |
| **B2** | Master carton (36 bags) | $3.49 / bag | LANDED — USA Gummies ships, freight built in | Online wholesale dashboard |
| **B3** | Master carton (36 bags) | $3.25 / bag | Buyer pays freight | Online wholesale dashboard |
| **B4** | Pallet | $3.25 / bag | LANDED — USA Gummies ships, freight built in | Online wholesale dashboard |
| **B5** | Pallet | $3.00 / bag | Buyer pays freight | Online wholesale dashboard |

The internal `B1`..`B5` designators (Rene's request, §5) are stable identifiers in code, audit logs, QBO line text, and Slack notifications. The customer-facing label can read "Master carton — landed", but the system identifies the line as `B2`.

### Pallet quantity convention

Pallets are an order-type abstraction; the bag count per pallet is set by the warehouse pallet build (typically 12 master cartons = 432 bags per pallet, per `/CLAUDE.md` Uline reorder spec). When `B4` or `B5` is selected, the order line decrements `<pallet_count> × 432` bags.

---

## 3. Freight / delivery quote logic

Three freight modes, deterministic:

| Mode | When | Logic |
|---|---|---|
| **Landed** (`B2`, `B4`) | Default for online master-carton + 1-2 pallet orders | Higher per-bag price; freight is built in. The order's `freight_quote` is `0` (already in bag price). |
| **Buyer pays freight** (`B3`, `B5`) | Buyer requests their own freight | Lower per-bag price; the order's `freight_quote = "buyer-paid"` and the customer arranges pickup or supplies their account. |
| **Custom quote** | 3+ pallet orders, OR Ben personally delivers | Manual quote based on Ben's fuel + time + opportunistic route value. The order is captured but `freight_quote = "custom-pending"` until Ben provides a number. |

**Hard rule (§3 of recap):** Free freight on sub-pallet quantities is RETIRED. Free freight only at 3+ pallet MOQ. This is already locked in `/contracts/outreach-pitch-spec.md` §4 (commit `4d3e2ed`).

---

## 4. Online vs internal exposure

| Path | What customers see |
|---|---|
| **Online wholesale onboarding flow** (`/wholesale` and the future onboarding portal) | `B2`, `B3`, `B4`, `B5` only. Minimum order = 1 master carton. Individual bags + individual sub-master-carton cases are NOT selectable. |
| **Internal / manual sales** (Ben walks into a store, Renny adds a local PO) | `B1` (local case at $3.49/bag, Ben delivers) is available via manual PO creation — not the online flow. |
| **Custom deals / acquisition specials** | Created manually. Examples: "$3.25 first-order acquisition special" (treated as customer acquisition cost; goal is recurring orders at standard pricing). The system supports manual special pricing per-customer but does NOT auto-generate specials. |

---

## 5. Designator rules (B1-B5 stability)

- **Designators are stable identifiers.** Once `B2` means "master carton landed at $3.49/bag", that mapping doesn't change without a deliberate doctrine update + version bump on this file.
- If pricing or freight mode changes for an existing tier, **rename the designator** (e.g. `B2` retired → `B6` introduced) rather than mutating `B2`'s meaning. Audit trails referencing `B2` must always resolve to the same pricing.
- New designators get the next available letter+number (`B6`, `B7`, …). Special / event pricing gets `S` prefix (`S1`, `S2`).
- Designators surface in: order line items, QBO invoice line text, Slack order notifications, HubSpot deal properties, the wholesale-account portal (when shipped).

---

## 6. Show specials / acquisition pricing (§6 of recap)

- **No recurring special pricing planned right now.**
- Show / event specials may happen ad hoc (e.g. "$3.25 starter for first order" in lieu of $3.49).
- Treated as **customer acquisition cost**. Goal: get into the account, then promote into B2-B5 standard pricing on the next order.
- Coding rule: Claude Code does NOT create random special pricing logic unless explicitly instructed. The system supports manually created special pricing/deals (per-customer overrides), but auto-discount / auto-promo is OFF by default.

---

## 7. Implementation status as of 2026-04-27

| Layer | State | Pointer |
|---|---|---|
| Atomic-bag inventory model | EXISTS — already canonical. Verify no rogue case-SKUs. | `src/lib/ops/inventory-snapshot.ts`, `src/lib/ops/shipping-packaging.ts` |
| Pricing tiers in code | NOT YET ENCODED as `B1-B5` designators. Today's prices are scattered across `/api/booth-order`, `/api/leads`, manual outreach, QBO templates. | Needs a new `src/lib/ops/wholesale-pricing.ts` module. |
| Online wholesale dashboard exposure | Existing `/wholesale` form captures intent → posts to HubSpot via Phase 1.b. Does NOT yet present the B2/B3/B4/B5 selector. | Needs onboarding flow rebuild — see [`/contracts/wholesale-onboarding-flow.md`](./wholesale-onboarding-flow.md) (DRAFT — interviewer pre-build pass pending). |
| QBO invoice line text using designators | Not yet wired. Today's invoices use product-level descriptions. | Wire when Rene's chart-of-accounts mapping is finalized (currently parking the receipt → bill loop too — see Viktor briefing §6). |

---

## 8. Where Viktor cites this from

When Rene asks Viktor "what's the wholesale price for X?", Viktor's answer must:
1. Cite `/contracts/wholesale-pricing.md` v1.0
2. Use the `B1-B5` designators
3. Never quote prices NOT in the table without a "this is a manual special pricing case" caveat
4. For 3+ pallet orders, surface "custom freight quote — Ben prices manually based on route" rather than guess

Per [`/contracts/viktor.md`](./viktor.md) §6 hard rule "every dollar figure needs a source citation."

---

## Version history

- **1.0 — 2026-04-27** — First canonical publication. Locks the 5-line-item pricing model + B1-B5 designators + 3 freight modes + atomic-bag inventory invariant per Ben + Rene call recap §1, §2, §3, §5, §6. Replaces ad-hoc pricing scattered across previous outreach scripts.
