# Research Methodology — Named Buyer + Verified Email Playbook

**Status:** LOCKED 2026-04-29 PM (per Viktor share-out)
**Purpose:** This is the canonical sequence for finding named, role-verified buyers with high-confidence verified emails for B2B prospect outreach. Goal: ≥75% confidence email with named buyer per prospect, OR surface the correct intake path if no buyer exists publicly.

This methodology replaces "shots in the dark" cold outreach. Every prospect on the master list (`/contracts/sales-tour-may-2026-prospect-list.md`) and every distributor follow-up runs this sequence before send.

---

## Step 1 — Company-first recon (2-3 min per prospect)

Before touching any enrichment tool, build context on the org itself:
- What type of entity is it? (NPS concessionaire, tribal enterprise, nonprofit museum, for-profit attraction, hotel retail)
- What's the org structure? (single-site vs. multi-property — affects whether there's a centralized buyer or site-level buyer)
- Does it have a gift shop? (confirm via website, TripAdvisor photos, Google Maps interior photos)
- What category of product do they carry? (food/candy specifically, or only branded merch/books)

**This step alone eliminates ~30% of prospects before any enrichment spend.**

---

## Step 2 — Direct website + NPS / government filings

**For NPS sites specifically:** go to `nps.gov/[park code]/` and look for the "Cooperating Association" or "Concessioner" link. Every NPS park discloses its retail partner publicly. This surfaces whether it's:
- A cooperating association (e.g., Bryce Canyon Association, Grand Canyon Conservancy, WNPA)
- An ARAMARK contract (Lake Powell, Davis Dam, Lake Mead)
- A Xanterra contract (Bryce Canyon Lodge, Grand Canyon South Rim)
- NPS-operated directly (rare)

**For tribal enterprises:** search "[tribe name] enterprise gift shop wholesale" — most have a dedicated enterprise arm separate from the government council.

**For state parks:** state park systems usually have a centralized retail buyer or the park manager handles merch purchasing — call the visitor center directly and ask "who handles gift shop purchasing?"

---

## Step 3 — LinkedIn (free, first pass)

Search: `[organization name] site:linkedin.com`
Look for titles: Retail Manager, Gift Shop Manager, Merchandise Manager, Buyer, Store Manager, Museum Shop, Director of Retail Operations.

For smaller orgs, also check: Assistant Director, Operations Manager (they often double as buyer).

Note the **exact title** — this matters for email confidence. If LinkedIn shows "Retail Buyer" that's a named-buyer confirmation, not just an educated guess.

---

## Step 4 — Email pattern triangulation

Once you have a name, you need an email. Steps:

1. **Check the org website contact page** — look for any staff emails in the visible format. Even one data point locks the pattern (e.g., `jsmith@org.com` → `first initial + last`).
2. **Hunter.io / Prospeo pattern lookup** — free tier gives email format confidence + verify. Use this to confirm the dominant pattern.
3. **Direct email pattern test:** For government/NPS orgs, `first.last@nps.gov` or `first_last@nps.gov` are standard. State agencies follow agency-specific formats (e.g., Salt Lake County = `saltlakecounty.gov` domain).
4. **SignalHire / RocketReach** — used sparingly for high-value targets when pattern can't be confirmed. Expensive per lookup, so reserved for ⭐⭐ prospects.
5. **LinkedIn InMail fallback** — if email can't be confirmed, LinkedIn message is the path, NOT cold email with guessed address.

---

## Step 5 — Cross-reference for title verification

Once you have a name + email, verify role:
- Search `"[name]" "[organization]"` on Google — press releases, event speaker lists, fundraiser programs, and local business journal features frequently list the actual buyer title
- Check the org's annual report (museums publish these) — board/staff lists confirm role
- For parks: check local newspaper coverage (Moab Times, Prescott Daily Courier, etc.) — rangers and gift shop managers get quoted in feature stories
- GetYourGuide / Viator vendor pages — activity operators list a booking contact which is often the same person managing gift shop wholesale

---

## Confidence % Scoring Rubric

```
95%   Named buyer confirmed + email on official website
85%   Named buyer confirmed via LinkedIn / press + email pattern matches 2+ data points
75%   Named buyer confirmed, email pattern derived from 1 data point + gov domain
65%   Org / role confirmed but email unverified (general contact used)
50%   Fit confirmed, no named buyer, intake path known (info@ or call)
<50%  Skip or flag for walk-in only
```

Send rule: ≥75% confidence triggers personalized cold email. Below that, default to phone-call task or LinkedIn InMail.

---

## Tool Usage Matrix — What Works, What Doesn't

### USE (in this order):
1. **NPS.gov filings + concessioner disclosure** (free, authoritative)
2. **Direct website email scraping + pattern lock**
3. **LinkedIn title verification**
4. **State / county government domain patterns** (highly predictable)
5. **Local press + fundraiser programs** (surprisingly reliable for named-buyer confirmation)
6. **GetYourGuide / Viator vendor pages** for activity operators
7. **Walk-in** as the final path when no digital surface exists (Oatman, Jerome, small independents)

### DON'T USE (and why):
- **ZoomInfo** — expensive, overkill for SMB / attraction orgs that are too small to be in their database reliably
- **LeadIQ / Wiza** — useful for B2B SaaS, rarely has accurate data for museum retail buyers
- **Datanyze** — tech company focus, not useful for hospitality / attraction
- **BBB** — good for verifying org is real + getting main phone, not useful for named buyer
- **Apollo** — for attraction / museum data is often stale (saw this with Xanterra where Apollo had the wrong contact)

---

## The Key Insight

**Paid tools (SignalHire, RocketReach) are useful as a *last resort* for hard targets.** For 80% of the prospects on the USA Gummies B2B list, the information is public — it just requires knowing where gift shop buyers actually show up:
- Local press
- Park association websites
- Government staff directories
- NPS concessioner filings

…vs. where people *expect* to find them (LinkedIn, ZoomInfo).

---

## "Company-first" Discipline

This is what prevents the generic `info@` trap. If you understand the org structure first, you know whether to look for:
- A central retail buyer (multi-property)
- A park association director (NPS)
- A tribal enterprise manager (tribal)
- Or just call the front desk and ask who orders product for the gift shop

---

## Anti-Patterns to Avoid

1. **Going to LinkedIn first** — wastes time on orgs where the buyer isn't on LinkedIn (small attractions, state parks, NPS concessionaires)
2. **Cold-emailing `info@`** — bounces hard or routes to nobody. Always identify the real buyer first.
3. **Trusting Apollo for attractions / museums** — data is often 2-3 years stale
4. **Sending without verifying email pattern** — burns sender reputation. Always lock pattern with at least one confirmed data point before sending.
5. **Treating multi-property orgs as single-buyer** — most multi-property retail orgs (POWDR, Vail, Xanterra, ARAMARK, NACE) have centralized buying. One pitch = many doors. Conversely, NPS independent concessioners are site-level.

---

*Locked 2026-04-29 PM. Source of truth: Viktor research methodology share-out. Every B2B prospect outreach references this playbook before send. Update only via shared review with the team.*
