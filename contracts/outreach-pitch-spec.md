# Outreach Pitch Specification

**Status:** CANONICAL — 2026-04-23
**Source:** Ben's ruling 2026-04-23 (chat). Reconciles conflicts across `/src/app/**`, `SalesSheet.tsx`, `product-claims.ts`, `distributor-pricing-commitments.md`, and prior outbound emails.
**Purpose:** Single source of truth for every cold B2B outreach email. Every fact in an outbound must come from this file. No exceptions. No pattern-matching from prior emails.

---

## 1. Product facts (LOCKED)

| Field | Value |
|---|---|
| Official name | **All American Gummy Bears** |
| Bag size | **7.5 oz bag** (NOT resealable — never claim "resealable") |
| Flavors in every bag | **Cherry, Watermelon, Orange, Green Apple, Lemon** (5 — always "green apple", never just "apple") |
| UPC | 199284715530 |
| Shelf life | 18 months |
| Ingredients | Gelatin, cane sugar, corn syrup, citric acid, natural flavors, fruit & vegetable extracts, carnauba wax |

## 2. Manufacturing + origin (LOCKED)

| Field | Value |
|---|---|
| Country of origin | Made in USA |
| Co-packer | **Powers Confections, Spokane WA** (veteran-owned) |
| Manufacturing | 100% US-made end-to-end |

## 3. Verified product claims (USE FREELY)

| Claim | Source |
|---|---|
| Dye-free | `product-claims.ts` verified |
| All-natural flavors | Albanese spec 50270_5 |
| Gluten-free | Albanese spec |
| Fat-free | Albanese spec (0g fat/serving) |
| Made in USA | verified |
| FDA-registered | SalesSheet.tsx |
| cGMP certified | SalesSheet.tsx |
| Veteran-owned co-packer | Ben confirmed 2026-04-09 |

## 4. BLOCKED claims (NEVER USE)

| Blocked claim | Reason |
|---|---|
| Resealable | Bag is NOT resealable (Ben 2026-04-23) |
| Red, white, and blue bears | Product is not color-themed — 5 fruit flavors only |
| Dairy-free | Technically true but outside outreach scope (Ben 2026-04-23) |
| Peanut-free | Same — produced in facility processing other products |
| Halal | Gelatin source unspecified, not certified |
| Kosher | Not certified |
| Layton Utah | Hallucinated location — never use |
| Free freight / free shipping on a master carton (1 MC) | **Trade-show-only offer. Expired after Reunion 2026 closed.** Never re-extend in cold outreach. Free freight only at 3+ pallet MOQ per §6 (Ben ruling 2026-04-27). |
| "Show pricing as a welcome offer" / "honor the show pricing" | Same — show pricing was show-only. Don't re-extend. |
| "Freight on us" on any sub-pallet quantity | Same — only at 3+ pallets. |
| "Ashford" / "Ashford WA" / specific warehouse city or street address | **Internal location. NEVER reference in any outbound email.** Use "our warehouse" / "we ship from WA" / "FOB origin" — but never name the city or street (Ben ruling 2026-04-27). |
| "30025 SR 706 E" / "98304" | Same — internal warehouse street + zip, never appear in outbound copy. |

## 5. Case pack (LOCKED)

| Unit | Spec |
|---|---|
| Inner case | 6 bags (7.5 oz), ~6 lb packed |
| Master carton | 6 inner cases · **36 bags** · **21 lb packed** |
| Pallet | **25 master cartons** (900 bags) |
| Dimensions | Master 21×14×8 in · Inner 14×10×8 in |

## 6. Pricing tiers (LOCKED — direct retail / operator buyers)

| Tier | Unit price | Ships |
|---|---|---|
| **Master carton (1+ MC)** | **$3.25/bag** + UPS Ground shipping | from Ashford WA |
| **Master carton — landed** | **$3.49/bag** | freight included |
| **Pallet (25 MCs / 900 bags)** | **$3.00/bag** | buyer freight OR negotiate |
| **Free shipping pallet tier** | $3.00/bag | **3+ pallet MOQ** (75 MCs / 2,700 bags) |

**MSRP suggested retail:** $4.99–$5.99

## 7. Distributor pricing (DIFFERENT — do NOT use in direct retail outreach)

See `/contracts/distributor-pricing-commitments.md`. Summary:
- Sell Sheet v3 (distributors): $2.49/bag delivered
- Option B (Inderbitzin, Glacier): $2.10/bag delivered, loose bags
- Reunion 2026 trade-show special: $3.25/bag + free shipping

**Distributor ≠ retailer.** If the company buys for resale to other retailers, they're a distributor. If they sell direct to consumers in their own stores / operated venues, they're direct retail.

## 8. MOQ + lead time (LOCKED)

- **MOQ:** 1 master carton
- **In-stock lead time:** 2–3 business days
- **Pallet lead time:** 5–7 business days
- **Ship from:** Ashford WA (primary) or East Coast partner

## 9. Military / specialty tier (AAFES, Exchange, NEXCOM, etc.)

- Standard pitch: "Military/specialty program tier open to structure around your volume + packaging needs."
- Do NOT quote sub-$3.25 pricing in a first email. Reserve for negotiation.
- Domestic-sourcing + veteran-owned co-packer are the two levers.

---

## 10. Canonical email skeleton

Every cold outreach email MUST include:
1. First-name greeting
2. Opening line with single-sentence context (why this company)
3. Bullet block with product + pricing facts from THIS file
4. CTA (sample offer or 15-min call)
5. Signature block: "Ben Stutman · Founder & CEO · USA Gummies · ben@usagummies.com · (307) 209-4928"

---

## 11. Pre-send gate (MANDATORY — every email)

Before any outbound send OR before suggesting an outbound action, run `scripts/outreach-validate.mjs <email_body.txt>`. It checks:

- [ ] **Product claim scan** — every claim matches verified set in `product-claims.ts`. BLOCKED claims fail.
- [ ] **Pricing regex scan** — prices match {$3.25, $3.49, $3.00} only. $2.49, $4.99-as-wholesale, $5.99 range-boundary values fail.
- [ ] **Format scan** — "resealable" / "red white and blue" / "layton" / "utah" / "halal" / "kosher" blocked.
- [ ] **Apollo email verification** — target email must return `email_status: verified` AND be unlocked (not `email_not_unlocked@domain.com`). Bare `/people/match?email=` lookups DO NOT count — must use `/mixed_people/search` with real person match.
- [ ] **HubSpot dedup** — no active deal with prior email engagement on this address.
- [ ] **Gmail sent folder dedup** — `search_threads(to:{email} OR from:{email})` returns zero hits in last 90 days.

If ANY gate fails → HARD BLOCK. Do not send. Report to Ben.

## 11a. Pre-ACTION gate (when responding to an inbound or suggesting a next step)

Before telling Ben "we should send X to Y" or "next step is X", run the sent-folder check:

1. **Inbound received?** Check Gmail SENT to `{sender_email}` for the last 7 days.
   - If any outbound EXISTS in SENT folder since the inbound timestamp → **DO NOT suggest sending**. Summarize the thread state. The ball is with the counterparty.
2. **Inbound references a deal/action we pre-drafted?** Check HubSpot engagements on the contact for that deal — if we already sent the draft, the state is "awaiting their reply".
3. **Summary context (conversation summary, memory, or "per the plan")** is NEVER the source of truth for whether an outbound already went out. The ONLY source of truth is the Gmail SENT folder + HubSpot engagements API.

Violation of this rule = drift. Same severity as the 2026-04-23 pitch drift incident.

## 12. Fact-source rule (THE BIG ONE)

**Never pattern-match facts from prior emails, memory, or what feels right.** Every fact must have a citation path:
- Product facts → THIS file (§1-8)
- Pricing → THIS file (§6)
- Company/contact facts → HubSpot + Apollo `/mixed_people/search` cross-verified
- Prior engagement → HubSpot engagements API + Gmail MCP

If a fact can't be cited to one of those sources, the draft is NOT READY.

---

## Version history

- **1.0 — 2026-04-23** — Initial canonical publication after drift incident (resealable bag, $2.49 Exchange pricing, 100-MC pallet all flagged by Ben). Locks pitch spec; introduces §11 pre-send gate and §12 fact-source rule.
