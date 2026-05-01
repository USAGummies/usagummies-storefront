# Claude in Chrome — Portal Submission Run Prompt

**Purpose:** Copy-paste this entire prompt into Claude in Chrome to run an autonomous portal-submission session against the USA Gummies backlog. The prompt assumes Claude in Chrome has access to the local filesystem (via Desktop Commander or equivalent MCP) AND a connected browser tab.

**Use:** copy everything below the `---` line. Paste as the FIRST message in a new Claude in Chrome session.

---

# Portal Submission Run — USA Gummies — autonomous mode

You are running a portal-submission session for USA Gummies. Goal: clear the P0 + weekend top-5 portal-submission backlog by Monday end-of-day. You operate autonomously within the rules below.

## Your inputs (read these first, in this order)

1. **The backlog (what to fill out, in priority order):**
   `/Users/ben/usagummies-storefront/contracts/portal-submission-backlog.md`
   - Read sections P0, "open doors not formally entered" (P1), and "Marketplaces" (P1)
   - Skip the "active onboarding" section — those are buyer-driven, not us
   - Weekend top-5 priority order is at the bottom of the doc

2. **The answer source (what values go in form fields):**
   `/Users/ben/usagummies-storefront/contracts/company-vendor-packet.md`
   - Single source of truth for every form field
   - Sections: legal entity (with EIN `33-4744824` + DUNS `13-863-5866`), corporate address, banking, product details, flavors+claims, pricing, file locations, distribution, brand positioning
   - The packet has a §10 "How to handle ambiguous fields" — follow it

3. **Where to log every submission:**
   `/Users/ben/usagummies-storefront/contracts/portal-submission-log.md`
   - Append ONE row to §1 per portal completed
   - Status enum: `submitted` / `partial` / `blocked` / `confirmed`
   - Status `confirmed` requires an actual ack ID or confirmation email from the portal — don't claim confirmed without one

4. **Sell sheet attachment** (use as primary product PDF on every submission):
   `/Users/ben/usagummies-storefront/output/assets/sell-sheet.pdf`
   - This is v3 with $5.99 MSRP + named flavors (Cherry, Watermelon, Orange, Green Apple, Lemon)

## Submission order (work top-down)

### Run 1 — P0 (today, 2026-04-30 PM, before EOD if possible)

1. **CNHA — Canyonlands Natural History Association**
   - URL: `https://cnha.org/product-submissions/`
   - Recipient context: Denise replied 4/30 13:34 PT pointing us to this URL. Ben replied "we'll submit through cnha.org/product-submissions/ this week with full product packet."
   - Required attachments: sell sheet, COA (use placeholder note "per-batch COA from Powers Confections, available within 24h of buyer ack"), allergen statement (build inline from packet §5), distribution capability statement (use packet §8)
   - HubSpot deal: `323289771748`

2. **MadeInUSA.com — vendor application** (10 days overdue, Tanya Hester is friendly + waiting)
   - URL: `https://madeinusa.com/vendor-signup` (locate exact path from Tanya's emails)
   - Recipient context: Tanya pinged us 4/20, Ben replied 4/21 "this week." She's `tanyah@madeinusa.com`
   - Required: vendor account registration first, then product submission
   - Send Tanya a courtesy email after submission (use Gmail draft path: `/api/ops/fulfillment/gmail-draft` if available; otherwise drop draft text into log §3 for Ben to send manually)

3. **UNFI Endless Aisle** (9 days overdue, qualified through RangeMe 4/20)
   - URL: RangeMe portal — UNFI Endless Aisle Campaign. Login at `https://www.rangeme.com` (Ben has Premium credentials — see `~/.config/usa-gummies-mcp/.faire-credentials` or Slack `#financials` for login if Premium issue is settled)
   - Recipient context: UNFI sent Overview + FAQ + Document Submission requirements 4/20. Ben replied 4/21 "full packet this week."
   - Required: complete the Endless Aisle product packet per the Overview doc UNFI sent

### Run 2 — Weekend top-5 (Saturday 5/1 AM)

4. **Museum Store Association — vendor membership**
   - URL: `https://museumstoreassociation.org/membership`
   - Vendor-membership tier needed for buyer discovery across museum gift shops nationwide
   - Highest leverage portal we haven't entered

5. **Eastern National wholesale**
   - URL: research from `wholesale@easternnational.org` outbound — likely `easternnational.org/wholesale` or a vendor-onboarding form
   - 150+ NPS bookstores — biggest credential play

### Run 3 — P1 grind (Saturday 5/1 PM through Monday 5/3)

In order: Glacier NP Conservancy formal NPS-vendor track (window opens Sept 2026 — submit anyway to be in queue), Yellowstone Forever, Yosemite Conservancy, Mount Rushmore Society, Bass Pro Shops / Cabela's, EG America (find correct vendor email — `vendorinquiry@cfrmarketing.com` BOUNCED 4/12 so locate the right path).

## Operating rules (follow strictly)

### Stop-and-ask rules
- **Never invent values.** Every form field's answer must come from `/contracts/company-vendor-packet.md` or be flagged in the log §3.
- **Never submit bank account or routing numbers** on cold/unverified portals. Only on confirmed-allowlist portals (Avolta, Jungle Jim's, Thanksgiving Point) AND only after explicit Ben approval in `#ops-approvals`.
- **Never click "I agree to terms"** without first surfacing the terms text to Ben if it's a multi-year commitment, exclusivity clause, or auto-renew. Quote the relevant clause and stop.
- **Pricing fields:** pull only from packet §6. Never quote below floors:
  - Branded floor (standard pack): $2.12/bag wholesale
  - Branded floor (loose-pack): $1.87/bag wholesale
  - PL floor: $2.04/bag wholesale
  - Distributor sell-sheet: $2.49/bag delivered (90+ pallet MOQ)
  - Below those → stop, post to `#ops-approvals`, await Ben Class C green-light.
- **MOQ fields:** 1 master carton (36 bags) for online wholesale; 3+ pallet for free freight; 1,000 bags for custom private-label runs.
- **Never check "kosher" or "halal"** — we are NOT certified. Check "gluten-free" — we ARE.
- **For Powers Confections facility info,** use packet §2 ("Production: Powers Confections, Spokane WA"). Powers' street address is internal; portals get just "Spokane WA, USA."

### Logging protocol (do this for EVERY portal — no exceptions)

1. After each submission, append ONE row to `/contracts/portal-submission-log.md` §1 with:
   - Date / Time (PT)
   - Portal name (matches backlog doc)
   - URL submitted
   - Operator: "Claude in Chrome (autonomous, run #N)"
   - Status: `submitted` / `partial` / `blocked` / `confirmed`
   - Attachments uploaded (e.g., "sell-sheet.pdf, allergen-statement.txt")
   - Confirmation # / next step (copy verbatim from portal ack page)
   - HubSpot deal ID if known

2. Post a Slack message to `#ops-approvals` channel `C0ATWJDHS74` (use `slack_send_message` MCP) with:
   - Portal name + status
   - Confirmation # if any
   - Permalink to the new log row (use the GitHub URL once committed)

3. If status = `blocked`, also append a row to log §3 with:
   - Missing field name
   - Your best-guess value
   - Then post to `#ops-approvals` thread tagging Ben (`<@U08JY86Q508>`) with the missing-field name + screenshot if you can get one

### Hard NOs (never do these)

- ❌ Submit anything to a portal NOT in the backlog without explicit Ben approval
- ❌ Pay any signup fee without explicit Ben approval (some marketplaces charge $99–$499 vendor fees)
- ❌ Sign electronic contracts (DocuSign, PandaDoc, etc.) without surfacing the contract text first
- ❌ Submit to portals requiring our routing/account numbers on cold-call basis
- ❌ Use `--allow-repeat` or any bypass flag on the email helper without Ben's `#ops-approvals` token

## Stop conditions

End the session when:
- All P0 + weekend top-5 portals show `submitted` or `confirmed` in the log
- OR you hit 3 consecutive `blocked` portals (signal that you need Ben to unblock fields)
- OR Ben tells you to stop in `#ops-approvals`

## Final output

When the session ends, post a summary to `#ops-approvals`:
- Total portals attempted
- Submitted / partial / blocked counts
- List of portals that need Ben's manual unblock
- Time elapsed
- ETA for completing the remaining P1 backlog if any

## Reference numbers (for fast lookup)

| Field | Value |
|---|---|
| Legal entity | USA Gummies, LLC (DBA "USA Gummies") |
| Parent | Yippy IO LLC, Wyoming |
| EIN | `33-4744824` |
| DUNS | `13-863-5866` |
| NAICS | 311340 (Nonchocolate Confectionery Manufacturing) |
| Domicile address | 1309 Coffeen Ave, Ste 1200, Sheridan, WY 82801-5777 |
| Operations / ship-from | 30025 SR 706 E, Ashford, WA 98304 |
| Phone | (307) 209-4928 |
| Email (founder) | ben@usagummies.com |
| Founder + title | Benjamin Stutman, Founding Father |
| Website | www.usagummies.com |
| Product | All American Gummy Bears - 7.5 oz Bag |
| UPC (12-digit) | 199284624702 |
| UPC (hyphenated) | 1-99284-62470-2 |
| MSRP | $5.99 |
| Wholesale (B2 master carton landed) | $3.49/bag · $20.94/case · $125.64/MC |
| MOQ online | 1 master carton (36 bags) |
| Lead time | ~5 business days from PO (in-stock) |

---

# Begin Run 1 — start with CNHA.

Your first action is to:
1. Read the three input docs above.
2. Open `https://cnha.org/product-submissions/` in the browser.
3. Read the page, identify required fields, and start filling using the packet.
4. Stop and ask Ben when you hit any field not in the packet.
5. Log every action to `/contracts/portal-submission-log.md`.

Go.
