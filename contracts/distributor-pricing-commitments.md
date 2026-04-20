# Distributor Pricing Commitments

**Status:** CANONICAL — 2026-04-20
**Source:** Sell Sheet v3 (`USA_Gummies_Distributor_Sell_Sheet_v3.pdf`, shipped with cold-outreach Feb 2026) + negotiated Option-B pricing with Inderbitzin (Feb 20, 2026) + Reunion 2026 trade-show promos.
**Purpose:** Lock the pricing + freight promises we made to distributors so no future agent — human or otherwise — charges freight on a "delivered" order or otherwise walks back a commitment.

---

## 1. The standing offer (sell sheet v3)

Every distributor who received our cold-outreach sell sheet saw:

| Term | Value |
|---|---|
| Your Cost | **$2.49/bag delivered** |
| Suggested Retail | $4.99/bag |
| Retailer Margin | ~50% at $4.99 SRP |
| Terms | Net 30 |
| Buyback | 100% credit on unsold product |
| New-door incentive | 1 free case credit per new door in first 60 days |

**"Delivered"** = freight is included. We eat the shipping cost.

Distributors who responded to this sell sheet:
- **Inderbitzin Distributors** (Brent Overman, Puyallup WA) — negotiated down to Option B
- **Glacier Wholesalers** (Mike Arlint, Kalispell MT) — PO 140812, quoted at $2.10/bag; sell sheet was attached to the outreach that landed the deal

## 2. Option-A / Option-B pricing (Inderbitzin negotiation, 2026-02-20)

Ben's email to Brent Overman offered two alternatives alongside the $2.49/bag sell-sheet rate:

| Option | Per-bag | Format | Retail |
|---|---|---|---|
| **Option A — With Counter Display** | $2.50 delivered | Clip-strip counter display | $5.99 |
| **Option B — Loose Bags, No Display** | **$2.10 delivered** | Master carton only, no display | $4.99 |

Both options are explicitly **delivered.** Freight is ours.

**Applied to:**
- **Inderbitzin PO #009180** — Option B, $2.10/bag, 28 cartons committed (23 shipped via QBO Invoice #1205, 5-carton remainder cancelled 2026-04-20 per Ben).
- **Glacier Wholesalers PO 140812 / QBO Invoice #1206** — Option B, $2.10/bag, 2 master cartons. Invoice stays at $151.20 product-only; freight absorbed.

## 3. Reunion 2026 trade-show commitments

Trade-show leads captured at The Reunion 2026 (Las Vegas, Apr 14-16) signed the booth quick-capture form under a show-special promo.

**Standing promo (per the booth packet):**
- $3.25/bag (show special, below sell-sheet + below Option B)
- **FREE shipping** (100% freight discount)
- No counter display required

**Applied to:**
- **Bryce Glamp & Camp QBO Invoice #1207** — 1 master carton, $117 product, memo already cites "Show Special applied: $3.25/bag with FREE shipping (100% freight discount)."

Any Reunion lead who later converts to a deal carries the same free-shipping clause unless explicitly renegotiated in writing.

## 4. DTC pricing (Shopify)

Shopify DTC checkout price is final — shipping is whatever the cart calculated at checkout, baked into `totalAmount` on the Shopify order. No after-the-fact adjustment.

**Applied to:**
- **Red Dog Saloon Shopify #1016** (Juneau AK, 4 master cartons, $444.96) — whatever Shopify charged is what they paid. For internal P&L visibility a mirroring QBO sales receipt is created with the freight line shown + a matching freight-comp contra-revenue line if we decide to absorb on a per-order basis.

## 5. Accounting treatment for absorbed freight

Per CF-09 channel segmentation:

| Account | Role |
|---|---|
| `500050 Freight Out — Distributors:<Channel>` | Actual label cost (expense). Hit when we buy the label. |
| `499010 Promotional / Show Freight Comp` | Contra-revenue line equal to the freight expense. Keeps the revenue figure honest — customers paid the delivered price, but our "gift" of freight surfaces in P&L rather than hiding in COGS. |

**Rule:** Every absorbed-freight shipment writes both entries. Agents draft the QBO journal entry at label-buy time as a Class B approval for Rene to post. The Reconciliation Specialist Thursday digest surfaces the pair so Rene can reconcile against the label invoice.

## 6. What NOT to do (prohibited)

- **Do NOT add a freight line to a "delivered" distributor's invoice.** Inderbitzin and Glacier were quoted delivered. Adding freight retroactively breaches the quote.
- **Do NOT bill freight to Reunion 2026 leads.** Booth packet promo binds us.
- **Do NOT autonomously change a price on an existing invoice.** Pricing adjustments are Class C (Ben + Rene) per approval-taxonomy.
- **Do NOT fabricate shipping costs on customer-facing documents.** Every freight $ on a customer invoice must be a real label purchase, cited with ShipStation shipment ID + tracking.

## 7. Future pricing changes

Any new pricing promise (new sell sheet, new distributor terms, new show-special) must:
1. Be committed in writing (email or signed doc)
2. Be logged here with the date + counterparty + terms
3. Update the seed list in `/contracts/distributor-pricing-commitments.md` (this file)

## Version history

- **1.0 — 2026-04-20** — First canonical publication. Codifies the sell sheet v3 "delivered" clause, Inderbitzin/Glacier Option B, Reunion 2026 show-special, and the CF-09 freight-comp accounting treatment.
