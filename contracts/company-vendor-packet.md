# USA Gummies — Company Vendor Packet (Single Source of Truth)

**Status:** CANONICAL — 2026-04-30
**Purpose:** Single source of truth for every field on every vendor / portal / new-account / RangeMe submission form. Operators (Ben, Rene, Claude Code, Claude in Chrome, Viktor) read from this doc and never invent values. Missing fields are flagged `🚩 BEN: fill` — never fabricated.

**Companion to:** [`/contracts/portal-submission-backlog.md`](portal-submission-backlog.md) — the list of portals that need filling out using these values.

---

## 1. Legal entity + corporate identity

| Field | Value | Source / notes |
|---|---|---|
| Legal entity name | **USA Gummies, LLC** | Locked 2026-04-28 PM (`/contracts/wholesale-pricing.md` §13). DBA is just "USA Gummies." |
| Parent / holding company | **Yippy IO LLC** | Wyoming-registered LLC (per USPTO trademark filings). Used on tax forms. |
| State of incorporation | **Wyoming** | Per `/CLAUDE.md` Company Context |
| Registered agent | Wyoming Attorneys LLC | Per `/CLAUDE.md` |
| Founder | **Benjamin Stutman** | Title used on every customer-facing surface: **Founding Father** (NOT "Founder & CEO" — `/contracts/wholesale-pricing.md` §14) |
| Phone (business) | **(307) 209-4928** | Per `/CLAUDE.md` |
| Email (founder) | **ben@usagummies.com** | Primary outbound |
| Email (finance) | **rene@usagummies.com** | Rene Gonzalez, finance lead — CC on AP packets |
| Email (operations) | **andrew@usagummies.com** | Drew Slater — production / supply chain only |
| Website | **www.usagummies.com** | |
| Tax ID / EIN | **`33-4744824`** | Locked 2026-04-30 PM. Required on every AP / W-9 / portal form. |
| DUNS number | **`13-863-5866`** | Locked 2026-04-30 PM. Required on most retail / distributor portals (UNFI, Bass Pro, KeHE, McLane, Core-Mark, etc.). |
| NAICS code | **311340** — Nonchocolate Confectionery Manufacturing | Standard for gummy candy |
| SIC code | **2064** — Candy and Other Confectionery Products | |

---

## 2. Corporate address

**Domicile (registered + USPTO trademark address):**
```
USA Gummies, LLC
1309 Coffeen Ave, Ste 1200
Sheridan, WY 82801-5777
```
Per Ben + Rich Alaniz USPTO confirmation 2026-04-15.

**Operations / fulfillment (ship-from):**
```
USA Gummies
30025 SR 706 E (or 30027 SR 706 E — Ben packs personally; both addresses verified in code)
Ashford, WA 98304
```
Per `src/lib/ops/shipstation-client.ts` `SHIPSTATION_FROM_*` defaults.

**Production (manufactured at):**
```
Powers Confections
Spokane, WA
```
*(Powers' street address is internal — used for our sales sheets to communicate "Made in USA, Spokane WA" but never published as our address.)*

---

## 3. Banking / ACH

| Field | Value |
|---|---|
| Primary bank | **Bank of America** |
| Account type | Business checking |
| Account # | **🚩 NEVER include in any portal submission unless the portal is on our approved-vendor allowlist (Avolta, Jungle Jim's, Thanksgiving Point, etc.) AND the form is encrypted-upload only.** |
| Routing # | Same — never share unless verified secure portal |
| Started | March 2026 |
| Pre-March 2026 | Found Banking (closed Dec 2025) — exclude from current vendor packets |

**Rule (from `/CLAUDE.md`):** Never share bank info on cold outreach. Only on confirmed-buyer AP forms after explicit Ben approval.

---

## 4. Product details (the ONLY product, AAGB)

| Field | Value |
|---|---|
| Product name | **All American Gummy Bears** |
| Variant | **7.5 oz Bag** |
| Full SKU label | "All American Gummy Bears - 7.5 oz Bag" |
| Brand | USA Gummies |
| UPC (12 digits) | **199284624702** |
| UPC (hyphenated, vendor-friendly) | **1-99284-62470-2** |
| Item / Vendor SKU | `UG-AAGB-7.5` |
| Net weight | 7.5 oz / **213 g** |
| Gross weight (single bag) | ~0.34 lb |
| Inner-case pack | **6 bags / case** |
| Inner-case dimensions | 14 × 10 × 8 in (canonical per ShipStation contract §2) |
| Inner-case weight (packed) | ~3.4 lb (canonical sample-shipment box uses 7×7×7 instead of 14×10×8 — both verified, sample-spec at `/contracts/integrations/shipstation.md` §3.5) |
| Inner-case UPC | **199284715530** |
| Inner-case SKU | `UG-AAGB-6CT` |
| Master-carton pack | **6 cases × 6 bags = 36 bags / master carton** |
| Master-carton dimensions | 22 × 14 × 8 in (label spec) / 21 × 14 × 8 in (ShipStation profile — both reference the same packed master-carton) |
| Master-carton weight (packed) | **21 lb 2 oz (= 21.125 lb), measured by Ben 2026-04-20** |
| Master-carton UPC | **199284373242** |
| Master-carton SKU | `UG-AAGB-MC6` |
| Pallet pack | 25 master cartons (Ti×Hi 6×4 + 1 cap) = **900 bags / pallet** |
| Pallet dimensions | 48 × 40 × ~52 in (LTL standard skid) |
| Pallet weight (packed) | ~530 lb gross |
| Strip clip + metal hook | 1 of each per inner case (peg-display retail-ready) |

**Lot / shelf life:**
- Lot 20260414 (currently in market) — MFG 04/14/2026
- Best By 10/14/2027 (18-month shelf life)

---

## 5. Flavors + claims

| Field | Value |
|---|---|
| Flavors | **Cherry, Watermelon, Orange, Green Apple, Lemon** |
| Claims (canonical) | Made in USA · Dye-free · No artificial colors · 100% natural color (paprika, turmeric, beet juice, etc.) · Premium gummy candy · Non-GMO ingredients |
| Allergens | 🚩 **BEN: confirm gelatin source** — the bag's printed ingredient panel (Belmark) and Albanese spec sheet are the primary sources. Until verified by Drew or pulled from the printed panel, the safe statement is: *"Contains gelatin. No major Big-9 allergens (peanut, tree nut, dairy, egg, wheat, soy, fish, shellfish, sesame)."* DO NOT specify "beef-derived" or "pork-derived" without primary-source verification. |
| Gelatin source verification path | (1) Pull printed bag panel from Belmark art file in Drive `Packaging > Belmark`. (2) Cross-check Albanese product spec sheet (Albanese is our raw gummy supplier — see `/CLAUDE.md` Production). (3) Confirm with Drew (Albanese vendor relationship owner). |
| Kosher | **NOT kosher-certified.** *Note:* gelatin source affects this — kosher requires kosher-certified gelatin (typically beef from kosher slaughter, or fish-derived). We do not have a certificate either way. |
| Halal | **NOT halal-certified.** Same caveat as kosher — depends on gelatin source + slaughter certification we don't have. |
| Vegan | **NO** — contains gelatin (animal-derived regardless of source). |
| Gluten | **Gluten-free** (no gluten-containing ingredients). |
| Country of origin | **USA — manufactured at Powers Confections, Spokane WA** |
| Compliance | CA AB 418 compliant (no Red 3, BVO, potassium bromate, propylparaben). CA AB 2316 compliant (no Red 40, Yellow 5/6, Blue 1/2, Green 3 — none in product to begin with). TX SB 25 compliant (no warning label triggers). |

---

## 6. Pricing — wholesale + retail

| Field | Value | Source |
|---|---|---|
| MSRP single bag | **$5.99** | `/scripts/generate-sales-sheet.mjs` v3, locked 2026-04-30 AM |
| MSRP retail range | **$4.99 – $5.99** | Suggested retail per sell sheet |
| Wholesale: Master carton, **Landed** (`B2`) | $3.49/bag · $20.94/case · $125.64/master carton | `/contracts/wholesale-pricing.md` §2 |
| Wholesale: Master carton, **Buyer pays freight** (`B3`) | $3.25/bag · $19.50/case · $117.00/master carton | Same |
| Wholesale: Pallet, **Landed** (`B4`) | $3.25/bag · $2,925/pallet | Same |
| Wholesale: Pallet, **Buyer pays freight** (`B5`) | $3.00/bag · $2,700/pallet | Same |
| Distributor sell-sheet rate (`B5+ Distributor`) | $2.49/bag delivered (90+ pallets) | `/contracts/distributor-pricing-commitments.md` |
| **Operating COGS** | **$1.79/bag** (Albanese $1.037 + Belmark $0.131 + Powers $0.376 + Uline $0.25) | `/contracts/wholesale-pricing.md` §1 (LOCKED 2026-04-30 PM) |
| Free freight tier | At 3+ pallets (75+ MC / 2,700+ bags) | `/contracts/wholesale-pricing.md` §3 |
| Payment terms | **Net 30 standard** · Net 15 with 2% prepay · Prepay full PO available | `/contracts/wholesale-pricing.md` §13 |
| Lead time | **~5 business days from PO** for in-stock orders; 4–6 weeks for custom production runs | |
| MOQ (online wholesale) | **1 master carton (36 bags)** | `/contracts/wholesale-pricing.md` §4 |
| Custom-run / private-label MOQ | ~1,000 bags first run, ~3-week production window | Per Powers Confections quote |

---

## 7. Insurance / certificates / docs (file locations)

| Doc | Status | Where to find |
|---|---|---|
| Sell sheet (PDF) | ✅ Current — v3 with $5.99 MSRP + named flavors | **`/Users/ben/usagummies-storefront/output/assets/sell-sheet.pdf`** + Drive `Sell Sheets` folder |
| Logo (full) | ✅ | `/Users/ben/usagummies-storefront/public/brand/logo-full.png` |
| Signed W-9 (PDF) | ✅ Current | **Google Drive — `04 — Finance > Document Templates`** (per `/contracts/wholesale-onboarding-flow.md` §3). Filename pattern: `USA_Gummies_W-9_signed.pdf` |
| Customer Information Form (CIF-001) | ✅ Pre-filled with our W-9 + ACH info | Drive — same folder |
| New Customer Setup Form (NCS-001 v2) | ✅ For our buyers to fill (not us) | Drive — same folder |
| Vendor Setup Form (VND-001 v4) | ✅ Internal / when we need to onboard a vendor | Drive — same folder |
| Certificate of Analysis (COA) | **🚩 BEN: confirm location / get from Powers** — not in repo. Powers Confections issues per-batch. Currently asking buyers "we'll forward when received" or have Drew pull from Powers portal. |
| Certificate of Insurance (COI) | **🚩 BEN: confirm carrier + Drive location.** General liability + product liability typical asks. |
| Allergen statement | Can generate from §5 above on letterhead | Use the `FORM PROP-001` template (same as Buc-ee's proposal) at `scripts/render-bucees-pdf.mjs` |
| Nutrition facts panel | On packaging — extract from bag art file | Drive `Packaging > Belmark` |
| Ingredient declaration | On packaging — extract from bag art file | Drive `Packaging > Belmark` |
| Distribution capability statement | **Build on demand** using `/contracts/wholesale-pricing.md` §3 freight modes + lead times | |
| Return policy | **🚩 BEN: confirm canonical text** — referenced in MadeInUSA.com correspondence as "ready to go" but not stored in repo |
| Trademark certificate | USPTO Application SN **99518673** | Filed by Lowe Graham Jones (Rich Alaniz). Status: pending |

---

## 8. Distribution / logistics

| Field | Value |
|---|---|
| Ship-from | Ashford, WA 98304 (Ben packs personally) |
| Carriers | UPS Ground (default), USPS Ground Advantage (light/cheap), LTL via Freightos / FreightCenter for pallet+ |
| ShipStation account | Active. Wallet auto-refill: $100 floor / $200 refill on stamps_com, ups_walleted, fedex_walleted |
| Founder-drive lane (when Ben drives) | ~$321/pallet for WA → St. Louis-equivalent 1,500-mile run |
| LTL fallback | ~$475/pallet for the same lane |
| Delivery window | 3-7 business days standard (carrier-dependent) |
| International | **No — domestic US only at this time.** |
| Drop-ship to consumer | **No — wholesale + B2B only.** DTC fulfillment is via our own Shopify storefront, not via the buyer's brand. |

---

## 9. Brand / marketing positioning

| Field | Value |
|---|---|
| Tagline / motto | "Leaner, lighter, meaner, faster." (internal). Customer-facing: "Premium dye-free gummy candy — Made in USA" |
| Story | Founded by Benjamin Stutman ("Founding Father"). American-made gummies designed for the heritage / patriotic / impulse-shelf retail floor. Powers Confections (veteran-owned, Spokane WA) is our co-pack. |
| Target shelves | Strip-clip impulse (peg-hook), gift shop, premium candy, museum / national-park / heritage retail, gateway-community souvenir, convenience-store premium |
| Channels active | Shopify DTC (usagummies.com) · Amazon FBA · Faire Direct (commission-free) · Wholesale B2B direct · Distributor (Inderbitzin, Glacier) |
| Competitive frame | NOT bulk-bag commodity (Albanese, Haribo). Premium impulse-shelf, $4.99–$5.99 retail, 42–50% retailer margin |
| Regulatory tailwind | CA AB 418 (in force) · CA AB 2316 (in force, school foods) · TX SB 25 (effective Jan 2027) — our 100% natural-color gummy needs no reformulation as state dye-restrictions expand |

---

## 10. How to handle ambiguous / unknown form fields

When a portal asks for a field this doc doesn't cover:

1. **Never invent a value.** Use the answer "🚩 BEN: confirm <field>" in the submission log and skip that field if the form allows it.
2. **For required-but-unknown fields,** stop the submission and post an `Ask` request in `#ops-approvals` Slack channel with the portal name + the field + best guess + screenshot if Claude in Chrome.
3. **For fields requiring uploads we don't have** (e.g., COA we haven't received yet), upload what we have + add a note: *"Per-batch COA available on request — most recent batch shipped 2026-04-14, COA forwardable from Powers Confections within 24 hours of buyer ack."*
4. **Pricing fields:** always pull from §6 of this doc. Never quote outside the locked B-tier grid without explicit Class C `pricing.change` Ben + Rene approval.
5. **MOQ fields:** 1 master carton (36 bags) for online wholesale; 3+ pallet for free freight; 1,000 bags for custom private-label. NEVER quote below.

---

## 11. Update protocol

Every change to this doc:
1. Edit the markdown
2. Update the version-history block below
3. Commit + push to main with message `docs(ops): vendor-packet — <field> updated`
4. Slack ping in `#financials` if it's a finance / banking / pricing field

When Ben fills in EIN / DUNS / COA location / COI carrier / return policy:
- Replace the `🚩 BEN: fill` markers
- Bump version to v1.1
- Notify Rene in `#financials`

---

## Version history

- **v1.2 — 2026-04-30 PM (latest)** — Walked back unsourced "gelatin (beef-derived)" claim in §5. The original v1.0 wording asserted a specific source without primary-source verification — ingredient source must be pulled from the Belmark printed bag panel and/or Albanese spec sheet, neither of which I had direct access to. Replaced with a 🚩 BEN-fill flag + verification path. The kosher/halal/vegan rows were also tightened (kosher and halal both depend on the gelatin source we haven't verified; vegan is unambiguously NO regardless). Compliance-class fields now follow the same source-or-stop discipline as the financial fields.
- **v1.1 — 2026-04-30 PM** — EIN (`33-4744824`) + DUNS (`13-863-5866`) locked by Ben. Removes the two highest-priority `🚩 BEN: fill` blockers. 3 remaining: COA location (Powers Confections issues per-batch — Drew can pull from Powers portal on demand), COI carrier (insurance carrier name + cert location), return policy canonical text. None of those gate P0 portal submissions.
- **v1.0 — 2026-04-30 PM** — Initial publication. Built to be the single source of truth for every portal / vendor / RangeMe / new-account submission. 5 fields flagged `🚩 BEN: fill` (EIN, DUNS, COA location, COI carrier, return policy canonical text). All other 80+ fields canonicalized from existing contracts + code.
