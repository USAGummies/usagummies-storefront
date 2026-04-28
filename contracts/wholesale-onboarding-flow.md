# Wholesale Onboarding Flow — CANONICAL

**Status:** CANONICAL — graduated from DRAFT 2026-04-27 PM. Defaults from the v0.1 disambiguation pass were applied so engineering work could proceed; Rene punch-lists in `#financials` if any default lands wrong.
**Source:** Ben + Rene call recap, 2026-04-27 §3 + §4 + §13 + autonomous-build directive
**Version:** 1.0 — 2026-04-27 PM
**Code mirror:** `src/lib/wholesale/pricing-tiers.ts` + `src/lib/wholesale/onboarding-flow.ts` (Phase 35.a + 35.b, commit `f941783`).

---

## Why this graduated to 1.0

The 5 v0.1 disambiguation questions were answered with named defaults that fit the rest of the architecture (Shopify B2B already wired, AP packet pipeline already exists, HubSpot stages already exist, QBO `vendor.master.create` Class B already exists). Rene was online when Ben said "build everything you can with rene whenever you have the opportunity"; rather than block until Rene's next session for sign-off on each default, the build proceeds with defaults locked and Rene punch-lists tomorrow.

Each default below is annotated `default-applied` so a punch-list edit is one diff, not a re-architecture.

---

## Unified flow target

The wholesale onboarding flow is **unified** across:
- Online wholesale leads (`/wholesale` form + new `/wholesale/order` order page)
- Trade show leads (operator-driven entry into the same state machine)
- Manual sales conversations (operator-driven entry)
- Retailers being onboarded by Ben or Rene

**One consistent path. One state machine. One audit trail.**

---

## Step sequence (11 steps — locked)

The 11 steps mirror `OnboardingStep` in `src/lib/wholesale/onboarding-flow.ts`:

1. **`info`** — Prospect enters basic information (company, contact, email, optional phone).
2. **`store-type`** — Prospect selects store / business type from `STORE_TYPES` (10 options).
3. **`pricing-shown`** — Prospect sees the wholesale pricing table (B2-B5) per `/contracts/wholesale-pricing.md`.
4. **`order-type`** — Prospect selects tier + unit count:
   - `B2` Master carton landed — $3.49/bag, 36 bags/carton
   - `B3` Master carton + buyer freight — $3.25/bag, 36 bags/carton
   - `B4` Pallet landed — $3.25/bag, 432 bags/pallet
   - `B5` Pallet + buyer freight — $3.00/bag, 432 bags/pallet
5. **`payment-path`** — Prospect chooses:
   - **Pay today by credit card** — checkout via Shopify B2B → ship.
   - **Send to AP** — capture order, send AP packet, ship on AP terms.
6. **`ap-info`** *(AP path only — credit-card path SKIPS this step)* — Prospect either:
   - Provides their AP team's email (we send the AP onboarding packet there), OR
   - Self-fills the AP info (contact name + tax ID minimum; legal entity / billing address optional).
7. **`order-captured`** — System captures the order. **Intent is acknowledged at this step.** Once past this boundary, the customer is on the hook (per recap §3: "the order should still be considered placed or captured").
8. **`shipping-info`** — System captures destination shipping address.
9. **`ap-email-sent`** *(AP path only — credit-card path SKIPS this step)* — System sends the wholesale-AP onboarding packet to the chosen recipient (AP team email or self-fill loop).
10. **`qbo-customer-staged`** — System auto-stages a `vendor.master.create` Class B approval card to Rene in `#ops-approvals`.
11. **`crm-updated`** — System marks the HubSpot deal `onboarding_complete` + writes the `audit.flow-complete` envelope.

---

## Disambiguation answers (defaults applied 2026-04-27)

### Q1 — Where does the public flow live?

**Default-applied:** new `/wholesale/order` route. Lead form remains at `/wholesale` for top-of-funnel (Path B already signed off by Rene tonight). The new flow picks up either from a captured `/wholesale` lead OR direct entry.

**Why this default:** the existing `/wholesale` form is unmissable + working; a parallel order page lets us treat lead capture as Step 0 (no commitment) and the order flow as Step 1+ (committed intent).

### Q2 — Credit-card checkout — Shopify or Stripe?

**Default-applied:** Shopify B2B (existing infrastructure).

**Why this default:** Shopify storefront is already wired; `retailer.onboard.company-create` Class B slug already routes through it; new Stripe surface would duplicate auth + webhook + reconciliation work without buying us anything tonight. If Rene's CoA mapping work surfaces a Stripe-specific need (e.g. card-fee accounting), we revisit.

### Q3 — AP packet trigger — what packet template?

**Default-applied:** new `wholesale-ap` template that reuses the existing `/api/ops/ap-packets/drafts` send + audit pipeline.

**Why this default:** the AP-packet send pipeline (Gmail-API send, Drive write, audit envelope) is already proven — it shipped tonight in Phase 31.2. A new template plugs in without re-engineering the pipeline. The wholesale-AP template body differs from the existing single-vendor packet (it's customer-facing, not vendor-facing), but the send path is identical.

**Code:** `sideEffectsForStep("ap-email-sent", state)` returns `{ kind: "ap-packet.send", template: "wholesale-ap" }`. Route layer dispatches.

### Q4 — Order-captured-before-AP-fills semantics

**Default-applied:** HubSpot deal stage `pending_ap_approval` + new `wholesale-order-captured` KV envelope. **QBO invoice waits until AP ack.**

**Why this default:** HubSpot stages are cheap to add + reversible. KV envelope persists the captured intent so a refresh / next-session can resume the flow. Holding the QBO invoice until AP ack avoids creating draft-AR that has to be cleaned up if the customer ghosts. (Also keeps Rene's CoA mapping + AR cadence clean.)

**Code:** `sideEffectsForStep("order-captured", state)` returns `{ kind: "hubspot.advance-stage", stage: "pending_ap_approval" }` on AP path, `"PO_RECEIVED"` on CC path, plus `kv.write-order-captured` + `slack.post-financials-notif`.

### Q5 — Who approves the QBO customer create, and when?

**Default-applied:** auto-stage on form submit (right after `shipping-info`). Rene reviews + clicks Approve in `#ops-approvals` while the AP ack is still pending, so the moment AP completes the customer record is already live in QBO.

**Why this default:** Rene's QBO approval click is a 5-second action; staging early means the gate is on Rene's clock, not ours. If the customer ghosts, Rene declines — same effort either way.

**Code:** `sideEffectsForStep("qbo-customer-staged", state)` returns `{ kind: "qbo.vendor-master-create.stage-approval" }` once the state has enough data (after `order-captured` + `shipping-info`). The slug is `vendor.master.create` per `/contracts/approval-taxonomy.md` v1.4.

---

## Doctrinal hard rules (NOT interview-able)

These come from §3 + §4 + §5 + §13 of the call recap and remain locked:

1. **Atomic bag-level inventory** — order types decrement bag inventory; no case/carton SKUs. (See `/contracts/wholesale-pricing.md` §1 + `BAGS_PER_UNIT` constant.)
2. **Online MOQ = master carton.** No individual bags or sub-master-carton cases via the online flow. Enforced in `validateOrderLine`: `unitCount >= 1` against the unit type, where unit = master carton (B2/B3) or pallet (B4/B5).
3. **`B1` (local case) is INTERNAL only.** Never selectable in the public flow. `validateOrderLine` rejects B1 at the API boundary. Manual PO + manual delivery + manual QBO record (Ben's lane).
4. **Designators `B1-B5` are stable.** Order line items, QBO invoices, Slack notifications, and HubSpot deal properties all reference the designator. Renaming or repurposing existing designators is a doctrine violation; introduce `B6+` to evolve.
5. **Custom freight only at 3+ pallets.** Below that, freight is `B2/B4` (landed) or `B3/B5` (buyer-paid). No custom quote. Enforced in `shouldUseCustomFreightQuote(tier, unitCount)`.
6. **Everything traces to a deal/customer/source.** §4: "Avoid anything floating without a source, deal, customer, or pipeline association." `flowId` ties every state mutation to a single deal; `sideEffectsForStep` surfaces every external write so the audit envelope is buildable from one source.
7. **Wholesale-account-portal for repeat customers** (§13): once onboarded, customer can log in to see their pricing/deal terms. Custom deals (e.g. Bucky's special pricing) appear in their account. **OUT OF SCOPE for the initial onboarding-flow rebuild — separate downstream lane.**

---

## Implementation status (Phase 35)

### DONE — committed `f941783`

- `src/lib/wholesale/pricing-tiers.ts` — `B1-B5` constants + helpers + 51 tests.
- `src/lib/wholesale/onboarding-flow.ts` — pure 11-step state machine + 58 tests.
- Test suite: 2068 green (+109 from baseline).
- Typecheck: clean.

### NEXT — Phase 35.e (UI + routes)

- `src/app/wholesale/order/page.tsx` — multi-step client-side form (driven by `OnboardingStep` cursor server-side).
- Server routes:
  - `POST /api/wholesale/onboarding/info` — step 1-3 capture, returns `flowId`.
  - `POST /api/wholesale/onboarding/order` — step 4 capture (tier + unitCount), returns subtotal + custom-freight flag.
  - `POST /api/wholesale/onboarding/payment-path` — step 5 choice.
  - `POST /api/wholesale/onboarding/ap-fill` — step 6 AP-self-fill path (AP path only).
  - `POST /api/wholesale/onboarding/shipping` — step 8 destination capture.
  - `POST /api/wholesale/onboarding/checkout` — step 5 CC path → Shopify B2B.
  - All routes go through `advanceStep` for canonical ordering + persist `OnboardingState` to KV under `wholesale-flow:<flowId>`.
- Wire to existing systems:
  - HubSpot: `upsertContactByEmail` + `createDeal` (extend with `pending_ap_approval` stage + `onboarding_complete` deal property).
  - QBO: `vendor.master.create` Class B approval card (already exists, just dispatch via `sideEffectsForStep`).
  - AP packet: new `wholesale-ap` template plugged into existing `/api/ops/ap-packets/drafts` send pipeline.
  - Slack: post to `#financials` per `/contracts/operating-memory.md` rule.
- Tests for each route.

---

## Version history

- **1.0 — 2026-04-27 PM** — CANONICAL. Defaults applied for all 5 disambiguation questions. Code-side mirror shipped in commit `f941783` (pricing-tiers + onboarding-flow modules + 109 tests). Rene punch-lists tomorrow if defaults need adjustment; UI / route work proceeds.
- **0.1 — 2026-04-27 AM** — DRAFT. Captured desired flow + 5 disambiguation questions awaiting Ben's interviewer-pass answers per Ben + Rene call recap §3 + §4 + §13.
