# Wholesale Onboarding Flow — DRAFT (interviewer pending)

**Status:** DRAFT — pending interviewer pre-build pass per [`/contracts/agents/interviewer.md`](./agents/interviewer.md). DO NOT IMPLEMENT YET.
**Source:** Ben + Rene call recap, 2026-04-27 §3 + §4 + §13
**Version:** 0.1 — 2026-04-27

---

## Why this is DRAFT not CANONICAL

The recap §3 describes the desired flow at a high level, but several decisions are NOT yet specified. Per the interviewer-agent contract (`/contracts/agents/interviewer.md`), the right move is to ask Ben 5 disambiguation questions BEFORE writing code that will end up wrong. This doc captures the desired-state shape + the open questions.

---

## Desired flow (from §3 of recap)

The wholesale onboarding flow should be **unified** across:
- Online wholesale leads (`/wholesale` form)
- Trade show leads
- Manual sales conversations
- Retailers being onboarded by Ben or Renny

**One consistent path. Not separate ad hoc flows.**

### Step sequence

1. Prospect enters basic information (company, contact, email, phone, store type).
2. Prospect selects store / business type.
3. Prospect sees wholesale pricing (the `B2-B5` table from `/contracts/wholesale-pricing.md`).
4. Prospect selects order type:
   - `B2` Master carton landed
   - `B3` Master carton + buyer freight
   - `B4` Pallet landed
   - `B5` Pallet + buyer freight
5. Prospect chooses payment / accounting path:
   - **Pay today by credit card** — checkout, capture payment, ship.
   - **Send to AP / accounts payable** — capture order, send AP packet, ship on AP terms.
6. If AP: prospect either provides AP email/contact OR fills the AP/accounting info themselves. **Order is captured before continuing — they're acknowledging intent to order.**
7. System captures: order, destination, contact info.
8. System sends AP onboarding email (if AP path).
9. System creates / updates customer in QBO.
10. System fills / updates CRM (HubSpot).
11. System follows agreed QBO workflows (per Rene + Viktor prior conversations).

---

## Open questions (interviewer pre-build pass)

Before I implement, Ben needs to answer these 5 questions. Defaults named for any he skips:

1. **Where does the public flow live?** Today there's `/wholesale` (lead capture) and `/api/booth-order` (existing trade-show order route). Should the new flow live at `/wholesale` (replacing the lead capture) or at a new `/wholesale/order` (separate path)? **Default:** new `/wholesale/order` to preserve the existing lead-capture form for top-of-funnel.

2. **Credit-card checkout — Shopify or Stripe?** Today's storefront uses Shopify checkout. Should B2B credit-card payment route through Shopify B2B (existing infrastructure, faster ship) or a separate Stripe integration? **Default:** Shopify B2B (already wired; existing `retailer.onboard.company-create` Class B slug).

3. **AP packet trigger — what packet template?** Today the AP packet system at `/ops/ap-packets` has hand-curated packets per vendor. Should the wholesale-onboarding AP path use the SAME `/api/ops/ap-packets/drafts` flow, or a new "wholesale-AP" template? **Default:** new `wholesale-ap` template that reuses the existing send + audit pipeline.

4. **Order-captured-before-AP-fills semantics — how do I represent it?** §3 says "the order should still be considered placed or captured" once AP is selected. Does that mean:
   - (a) HubSpot deal at stage `pending_ap_approval` (no QBO write yet), OR
   - (b) QBO invoice at status `draft` (committed in QBO but not sent), OR
   - (c) New "captured" KV envelope that promotes to QBO invoice once AP completes?
   **Default:** (a) HubSpot deal at `pending_ap_approval` + a new `wholesale-order-captured` KV record. QBO invoice waits until AP ack.

5. **Who approves the QBO customer create?** §4 says "create the customer in QuickBooks" — that's a `vendor.master.create` Class B (Rene approves). Does the onboarding flow auto-stage the approval card on form submit, or only after AP ack? **Default:** auto-stage on form submit so Rene can review + approve while the AP ack is still pending. (Rene's slug is `vendor.master.create` per `/contracts/approval-taxonomy.md` v1.4.)

---

## Doctrinal hard rules from the call (locked, not interview-able)

These come from §3 + §4 + §5 + §13 and are NOT negotiable in the disambiguation pass:

1. **Atomic bag-level inventory** — order types decrement bag inventory; no case/carton SKUs. (See `/contracts/wholesale-pricing.md` §1.)
2. **Online MOQ = master carton.** No individual bags or sub-master-carton cases via the online flow.
3. **`B1` (local case) is INTERNAL only.** Never selectable in the public flow. Manual PO + manual delivery + manual QBO record.
4. **Designators `B1-B5` are stable.** Order line items, QBO invoices, Slack notifications, and HubSpot deal properties all reference the designator.
5. **Custom freight only at 3+ pallets.** Below that, freight is `B2/B4` (landed) or `B3/B5` (buyer-paid). No custom quote.
6. **Everything traces to a deal/customer/source.** §4: "Avoid anything floating without a source, deal, customer, or pipeline association." Cross-checking between QBO + HubSpot + Slack is the verification mechanism.
7. **Wholesale-account-portal for repeat customers** (§13): once onboarded, customer can log in to see their pricing/deal terms. Custom deals (e.g. Bucky's special pricing) appear in their account. **Marked OUT OF SCOPE for the initial onboarding-flow rebuild — separate downstream lane.**

---

## Implementation plan (after Ben's answers land)

Once the 5 questions are answered:

1. New `src/lib/wholesale/pricing-tiers.ts` — `B1-B5` constants + helpers (`priceForTier`, `bagsForOrderLine`, etc.). Tested.
2. New `src/lib/wholesale/onboarding-flow.ts` — pure state machine for the 11-step sequence. Tested.
3. New page `/wholesale/order` (or chosen path) — server component + client form steps.
4. New routes:
   - `POST /api/wholesale/onboarding/info` — step 1-3 capture
   - `POST /api/wholesale/onboarding/order` — step 4-7 capture
   - `POST /api/wholesale/onboarding/ap-fill` — step 6 AP-self-fill path
   - `POST /api/wholesale/onboarding/checkout` — step 5 CC path → Shopify B2B
5. Wire to existing systems:
   - HubSpot: `upsertContactByEmail` + `createDeal` (already exists — extend with the new stage)
   - QBO: vendor.master.create Class B approval card to Rene (already exists)
   - AP packet: chosen template (per Q3 default: new `wholesale-ap` template)
   - Slack: post to `#financials` per `/contracts/operating-memory.md` rule
6. Tests for each module + each route.
7. Docs update: `/contracts/wholesale-onboarding-flow.md` graduates 0.1 DRAFT → 1.0 CANONICAL with answers locked in.

---

## Version history

- **0.1 — 2026-04-27** — DRAFT. Captures desired flow + 5 disambiguation questions awaiting Ben's interviewer-pass answers per Ben + Rene call recap §3 + §4 + §13.
