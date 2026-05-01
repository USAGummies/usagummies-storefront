# Per-Vendor Margin Ledger

**Status:** CANONICAL · v0.1 — 2026-04-30 PM
**Owner:** Rene (margin reconciliation) · Ben (pricing decisions) · Claude Code (ledger maintenance)
**Trigger:** Rene's 2026-04-30 PM directive in `#financials` DM: *"it would be nice per customer or channel to break each down that follow our Revenue, COG, Freight with bottom line gross margin per our sales channels and pricing - this should be in one spot for easy reference and can be updated - our margin and pricing per vendor - and granular to bag cost per line item."*

**Companion to:** [`/contracts/proforma-channel-margins.md`](proforma-channel-margins.md) (channel-level math) + [`/contracts/wholesale-pricing.md`](wholesale-pricing.md) (B-tier pricing grid + $1.79 COGS lock).

---

## 0. Hard rules

1. **One row per vendor with committed pricing.** Sample-stage prospects live in §3 (Pending) and graduate to §1 (Committed) when a price is agreed AND a PO or invoice is in flight.
2. **Every $ figure cites a source.** Per `/CLAUDE.md` Financial Data Integrity. Cells without a citation are flagged `[needs QBO actual]` rather than fabricated.
3. **Operating COGS is locked at $1.79/bag** (Albanese $1.037 + Belmark $0.131 + Powers $0.376 + Uline $0.25 — `/contracts/wholesale-pricing.md` §1). Per-row freight estimate is the source of variance vs the channel-level proforma.
4. **GP/bag formula:** `Revenue/bag − $1.79 COGS − Freight/bag = GP/bag`. GP% = GP/bag ÷ Revenue/bag.

---

## 1. Committed vendors (live pricing + PO or invoice in flight)

### 1.1 Inderbitzin (regional distributor, WA)

| Field | Value | Source |
|---|---|---|
| Tier / route | Distributor — Option B (delivered) | `/contracts/distributor-pricing-commitments.md` §2 |
| $/bag (wholesale) | **$2.10** | Same |
| Freight model | Delivered (we ship) | Same |
| Operating COGS | $1.79 | `wholesale-pricing.md` §1 |
| Per-bag freight (allocated) | $0.20–$0.40 | Drive-economics range, WA → WA in-state shorter end |
| **GP / bag** | **−$0.07 to $0.13** | **−3% to 6% GP — *thin margin floor*** |
| Volume commit | TBD per agreement | |
| Notes | Strategic-credential play (WA distributor footprint). Not scalable to non-credential accounts at this price. | |

### 1.2 Glacier Distributing (regional distributor, MT)

Same structure as Inderbitzin — Option B distributor at $2.10/bag delivered. MT exposure.

| Field | Value |
|---|---|
| $/bag | $2.10 |
| Freight | Delivered |
| COGS | $1.79 |
| Per-bag freight | $0.20–$0.40 |
| **GP/bag** | **−$0.07 to $0.13 (−3% to 6%)** |

### 1.3 Mike Hippler / Thanksgiving Point (Lehi, UT — Reunion lead, May 11 hand-deliver)

| Field | Value | Source |
|---|---|---|
| Tier | `B2` master carton landed | `wholesale-pricing.md` §2 |
| $/bag | **$3.49** | Same |
| Freight model | Landed (founder-drive — Ben hand-delivers May 11) | `wholesale-pricing.md` §3 |
| Volume | 15 master cartons × 36 bags = **540 bags** (Invoice 1539, $1,755) | Email + HubSpot deal `321017225936` |
| Per-bag freight (allocated) | ~$0.10–$0.30 | Drive amortized — booth materials trip already in budget |
| **GP / bag** | **~$1.40** | **~40% GP** |
| Payment terms | Net 10 from invoice date (= shipment date May 8 or 9) | `/contracts/wholesale-pricing.md` §15 |
| Status | ✅ Active — invoice fires on departure day | |
| Notes | First-customer through new wholesale onboarding flow. Show-deal: freight covered per Reunion 2026 terms. | |

### 1.4 Eric Forst / Red Dog Saloon (Juneau, AK — Reunion show order)

| Field | Value | Source |
|---|---|---|
| Tier | TBD (Reunion-show special — `wholesale-pricing.md` §12 Scenario 1) | |
| Order total | $444.96 | Shopify order #1016 (per Viktor 4/19 standup) |
| $/bag effective | TBD — depends on units shipped | [needs QBO actual once invoice fires] |
| Freight | Trade-show special (we absorb at MC MOQ) | `wholesale-pricing.md` §12 |
| COGS | $1.79 | |
| Status | ✅ Active — vendor form sent 4/30, tracking sent 4/29 | |

### 1.5 Bryce / Bryce Glamp & Camp (Reunion show order)

| Field | Value | Source |
|---|---|---|
| Status | New wholesale account — vendor form sent 4/30 | Email |
| $/bag | TBD — depends on PO size | |
| Volume | TBD | |
| Notes | Place-holder — graduates from §3 to §1 when PO confirms. | |

### 1.6 Sell-sheet base rate (distributor / chain volume)

Not a single-vendor row but worth tracking as a *route* — anyone we quote at the public 90+ pallet sell-sheet rate.

| Field | Value | Source |
|---|---|---|
| $/bag | $2.49 delivered | `/contracts/distributor-pricing-commitments.md` §1 |
| MOQ | 90+ pallets (~81,000 bags) | Same |
| COGS | $1.79 | |
| Per-bag freight | $0.20–$0.40 | |
| **GP/bag** | **$0.30–$0.50 (12–20% GP)** | |
| Notes | Class C `pricing.change` required to deviate. Aggressive at low end of range. | |

---

## 2. Internal flow / channel-level (cross-link to proforma)

These don't get per-vendor rows because the vendor IS the channel.

| Channel | $/bag (avg) | Effective COGS | Freight | GP/bag | GP% | See |
|---|---:|---:|---:|---:|---:|---|
| Amazon FBA | $5.99 | $1.79 + ~$3.89 fees | inbound $0.30 | $0.01 | ~0% | `proforma-channel-margins.md` §1.1 |
| Amazon FBM single-bag | $5.99 | $1.79 | $6.74–$6.95 USPS label | **NEG** | **NEG** | `proforma-channel-margins.md` §1.2 — **flagged** |
| Shopify DTC single-bag | $5.99 | $1.79 + $0.47 fees | $6.74–$6.95 USPS label | **NEG** | **NEG** | `proforma-channel-margins.md` §1.3 — **flagged** |
| Shopify DTC 5-bag bundle | $25.00 | $8.85 + $1.03 fees | $8–$10 label | $5.12–$7.12 | 20–28% | `proforma-channel-margins.md` §1.4 |
| Shopify DTC 10-bag bundle | $50.00 | $17.70 + $1.75 fees | $10–$13 label | $17.55–$20.55 | 35–41% | `proforma-channel-margins.md` §1.5 |
| Faire Direct (commission-free) | $2.49 | $1.79 | $0.20–$0.40 | $0.30–$0.50 | 12–20% | `proforma-channel-margins.md` §1.6 |
| Wholesale `B2` (master carton landed) | $3.49 | $1.79 | $0.10–$0.30 | $1.40–$1.60 | 40–46% | `proforma-channel-margins.md` §1.8 |
| Wholesale `B3` (master carton buyer-pays) | $3.25 (→$3.50 if Q3 ratifies) | $1.79 | $0 | $1.46–$1.71 | 45–49% | §1.9 |
| Wholesale `B4` (pallet landed) | $3.25 | $1.79 | $0.07–$0.50 | $0.96–$1.39 | 30–43% | §1.10 |
| Wholesale `B5` (pallet buyer-pays) | $3.00 (→$3.25 if Q3 ratifies) | $1.79 | $0 | $1.21–$1.46 | 40–49% | §1.11 |
| `B6-ANCH` (route-anchor 3+ pallet landed, PROPOSED) | $3.00 | $1.79 | $0.05–$0.35 | $0.86–$1.16 | 29–39% | §1.12 |

---

## 3. Pending vendors (sample / submission stage — graduate to §1 when committed)

| Vendor | Stage | Last touch | HubSpot deal | Likely tier on commit |
|---|---|---|---|---|
| **Buc-ee's** (Charmaine Davis / Kevin McNabb / Sandra Morales) | Pricing pushback — held | 4/30 PM (Charmaine reply held; analysis in `#financials` thread `1777568200.027019`) | `320433733326` master | TBD — Path A/B/C decision pending |
| **Christmas Mouse** (Rob Marshall) | Sample shipping today | 4/30 (UPS `1ZJ74F69YW55313551`) | `323411625658` | Likely B3 if they take |
| **Bronner's Christmas Wonderland** | Sample shipped 4/10 | Awaiting category-review | `320368687814` | Likely B3/B4 if they take |
| **Avolta / Hudson** (Tom Lipski + Harold + Brian) | Both samples landed 4/28-29 | Awaiting category-review | TBD | Likely distributor delivered |
| **Old Mill General Store** (Kelly Cross, Pigeon Forge TN) | 2-option deal sent 4/27, voicemail 4/29 | Awaiting yes/no | TBD | B2 / B3 |
| **Glacier NP Conservancy** (Kaylee Eldredge) | Sample shipping today (USPS `9434650106151068541205`) | NPS Sept review window | `323308070608` | Strategic credential — B5 / route-anchor likely |
| **KeHE Naperville** (Shannon Rosiak) | Sample 3/22 | Awaiting category-review | TBD | Distributor sell-sheet |
| **McLane (Merced + S Bernardino)** (Christina Carranza) | Samples 3/22 | Awaiting category-review | TBD | Distributor sell-sheet |
| **Core-Mark S San Francisco** (Jim Hachtel) | Sample 3/22 | Awaiting category-review | TBD | Distributor sell-sheet |
| **Dot Foods Mt Sterling** | Sample 3/22 | Awaiting new-item team | TBD | Distributor sell-sheet |
| **CNHA** (Denise — `cnha.org/product-submissions/`) | Portal submission promised "this week" 4/30 | Due Sun 5/3 | `323289771748` | B5 / route-anchor likely |
| **Yellowstone Forever** | Cold intro 4/29 | Awaiting reply | TBD | Strategic credential — B5 likely |
| **Eastern National** (150+ NPS bookstores) | Cold intro 4/29 | Awaiting reply | TBD | **🌟 highest-leverage credential play** — distributor sell-sheet at chain scale |
| **Yosemite Conservancy** | Cold intro 4/29 | Awaiting reply | TBD | B5 / route-anchor |
| **Mount Rushmore Society** | Cold intro 4/29 | Awaiting reply | TBD | B5 / route-anchor |
| **MadeInUSA.com** (Tanya Hester) | Vendor application 10 days overdue | Promised "this week" 4/21 | TBD | DTC marketplace — affiliate model |
| **UNFI Endless Aisle** | Packet 9 days overdue | Qualified through RangeMe 4/20 | TBD | Distributor sell-sheet |
| **Jungle Jim's Market** (Jeffrey Williams) | AP setup confirmed 4/30 | DONE — awaiting first PO | TBD | B2 / B3 likely |
| **Thanksgiving Point — Vicki AP** | AP packet sent 4/29, awaiting filing | DONE — Mike order INV-1539 already invoiced | (linked to 1.3 above) | (committed via Mike) |
| **King Henry's** (Patrick Davidian — co-pack) | Co-pack quote stale since 4/16 | Ben said "ignore" 4/30 PM | `320851856085` | N/A — co-pack lead, not sales vendor |

---

## 4. Update protocol

When a vendor commits to pricing (PO confirmed, terms agreed, or invoice fires for the first time):

1. Move row from §3 (Pending) → §1 (Committed) with full per-bag economics filled in.
2. Cite source: HubSpot deal id + email date + invoice number where applicable.
3. Commit message: `docs(finance): vendor-margin-ledger — <vendor> committed at <$/bag>`.
4. Slack ping in `#financials` if the locked GP% is below the per-tier floor (Rene escalation gate).

When a Class C `pricing.change` ratifies (e.g. Q3 buyer-pays surcharge if Ben approves):

1. Update affected rows (B3, B5 numbers — see §2 column "if Q3 ratifies").
2. Bump version to v0.2.
3. Re-link to the committed `wholesale-pricing.md` v2.4 commit.

---

## 5. Code-side surface (Phase 36 build target)

This doc is the *source of truth*. The morning brief reads from it. Roadmap to wire it into code:

| Phase | Surface | Status |
|---|---|---|
| 36.1 | `src/lib/finance/per-vendor-margin.ts` parser — read this markdown into a TS struct | TODO |
| 36.2 | `/api/ops/finance/vendor-margin?vendor=X` — return vendor row JSON for the daily brief | TODO |
| 36.3 | Morning brief surface — show top-3 vendors with margin alerts (below-floor, escalation due, AR aging) | TODO |
| 36.4 | HubSpot deal ↔ vendor-row two-way reconcile — when a deal stage advances to `Shipped`, post the GP/bag to the deal note | TODO |

These are queued in the `/contracts/financial-mechanisms-blueprint.md` build registry — see Phase 36 there.

---

## Version history

- **v0.1 — 2026-04-30 PM** — Initial publication. 6 committed vendor rows + 11 channel rows + 18 pending rows. Cross-references to proforma-channel-margins, wholesale-pricing, distributor-pricing-commitments. Code-side wire-up queued as Phase 36 in `/contracts/financial-mechanisms-blueprint.md`.
