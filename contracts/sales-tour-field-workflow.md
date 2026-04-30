# Sales-Tour Field Workflow

**Status:** CANONICAL (v0.1) — graduates as versions ship.
**Version:** 0.1 — 2026-04-29
**Trigger:** Ben + Rene call recap 2026-04-29 PM. May 11–17 Ashford → Grand Canyon trip is 12 days out.
**Code mirror:** `src/lib/sales-tour/*` + `/api/ops/sales-tour/*`. Pairs with Codex's existing `scripts/sales/send-and-log.py` (canonical HubSpot find-or-create) and `src/lib/sales/prospect-playbook.ts` (81-prospect playbook).
**Source-of-truth for every prospect:** [`/contracts/sales-tour-may-2026-prospect-list.md`](sales-tour-may-2026-prospect-list.md).

> **Why this exists:** when Ben walks into a prospect (gift shop, NPS concessionaire, Thanksgiving Point retail) on the May 11–17 trip, the time between "buyer says X cases" and "Ben hands over a quoted offer + NCS-001 link" is currently a paper-and-phone exercise. This doctrine + the implementation it gates lets Ben trigger a structured quote flow from his phone in 5–10 seconds, get a tier-aware quote back in Slack within 3–5 seconds, and walk the buyer through next steps without thumbing through PDFs.

---

## 1. Hard-rule preserved (do not break in any version)

- **Pricing comes from the canonical grid** in [`wholesale-pricing.md`](wholesale-pricing.md) v2.2 + the route-economics governance in [`pricing-route-governance.md`](pricing-route-governance.md). The booth-quote helper MUST emit the deal-check trigger for any non-grid offer per `pricing-route-governance.md` §7.1; never autonomously quote a non-standard price.
- **Escalation language ships on every booth quote** per `pricing-route-governance.md` §6 + `R7`. The default template variant is "Reorder protection (anchor account)" for ≥ 3 pallet quotes, "Landed delivery offer" for landed sub-3-pallet quotes, "this order only" for `C-EXC` strategic exceptions.
- **Outbound-template eligibility per class** is honored. `C-PU` and `C-ANCH` are NEVER offered without a deal-check entry in `#wholesale`. Booth helper composes the deal-check post automatically.
- **No fabrication.** Freight estimates cite the source ("regional table v0.1") with the lookup row; live LTL bid (when added) cites the broker + quote ID. "Approximately" is not a license to fabricate.
- **Pre-send gate is bypassable for booth quotes** because the gate (`scripts/outreach-validate.mjs`) is for cold outreach. Booth quotes are warm conversations Ben is having in person — no email-validation step. But the canonical product/pricing facts come from `outreach-pitch-spec.md` + `wholesale-pricing.md` regardless.
- **Public-copy rules apply.** Even in a buyer-facing quote, never name the warehouse city or Ben's full name (`/CLAUDE.md` §"Public-Facing Copy Rules"). Use "we ship from WA" / "USA Gummies" / "we" instead.

---

## 2. Capture surfaces (Q1 default + future)

| Version | Channel | Friction | Status |
|---|---|---|---|
| **v0.1** | Slack DM or channel post — Ben types a structured one-liner | ~10 sec | **shipping** |
| **v0.2** | Slack DM voice memo → Whisper transcription → same parser | ~5 sec | next |
| **v0.3** | iMessage / SMS to a Twilio number → same parser | ~5 sec | follow-on |

The capture surface is *plural by design* — the parser is the same regardless of channel. The Slack one-liner format is the canonical *input grammar*; voice and SMS in later versions both transcribe down into that grammar.

### 2.1 Canonical input grammar (v0.1)

A booth visit is captured as a **single Slack message** that names a prospect + a request. Any of these are valid:

```
/booth 36 to Bryce Glamp and Camp UT, landed, contact Sarah 555-1212
/booth 3 pallets to Indian Pueblo Stores NM, anchor, Mike 505-555-0100
/booth 1 case sample drop at Verde Canyon RR AZ, contact Tess
/booth 8 cases to Brian Head Resort UT, pickup, Jenny jenny@brianhead.com
```

Required tokens (parser is tolerant — can be rearranged):
- **Quantity** (e.g. `36`, `3 pallets`, `8 cases`, `1 sample`)
- **Prospect name + state** (e.g. `Bryce Glamp and Camp UT`)
- **Freight ask**: one of `landed`, `pickup`, `anchor`, `fill`, `unsure` — defaults to `unsure` if absent
- **Buyer contact**: name + phone OR email (optional in v0.1, REQUIRED for v0.2 SMS path)
- **Free-text notes**: anything trailing after the structured fields

Parser: LLM-based extractor (Claude Sonnet) → strict JSON conforming to `BoothVisitIntent` schema in `src/lib/sales-tour/booth-visit-types.ts`.

---

## 3. Quote engine (Q3 default — regional table)

**v0.1 freight source:** `src/lib/sales-tour/freight-corridor-table.ts` — a static TypeScript const keyed by `{stateCode, palletCount}`. Returns the per-pallet drive cost (founder-drive economics from `pricing-route-governance.md` §3) plus the inferred LTL fallback.

Trip corridor (May 11–17): WA → OR → ID → UT → NV → AZ. The table covers all 6 states at 1, 2, 3, 5, 8 pallet counts. Sub-pallet (master-carton-only) orders fall back to USPS/UPS rates from `pickServiceForWeight` in the existing auto-ship pipeline.

**v0.2+ freight source:** live LTL bid via FreightCenter or Freightos. v0.1 is intentionally simpler — the regional table is more than accurate enough for the corridor + it's instant.

### 3.1 Tier classification

The quote engine maps `BoothVisitIntent` → canonical class per [`pricing-route-governance.md`](pricing-route-governance.md) §1:

| Quantity | Freight ask | Class |
|---|---|---|
| ≥ 3 pallets | `landed` or `anchor` | `C-ANCH` ($3.00 landed route-anchor) — Class C deal-check required |
| ≥ 3 pallets | `pickup` | `C-STD` (`B5` $3.00 pallet buyer-pays) — Class A at grid |
| 1–2 pallets | `landed` | `C-STD` (`B4` $3.25 landed pallet) — Class A at grid |
| 1–2 pallets | `pickup` | `C-STD` (`B5` $3.00 pallet buyer-pays) — Class A at grid |
| Master cartons | `landed` | `C-STD` (`B2` $3.49 landed master carton) — Class A at grid |
| Master cartons | `pickup` | `C-STD` (`B3` $3.25 master carton buyer-pays) — Class A at grid |
| 1 case sample | (any) | `C-EXC` strategic credential / sample drop — Class C for paid samples; Class A for free sample drops up to 6 bags |
| ≥ 1 master carton | `unsure` | Quote includes BOTH `B2` landed and `B3` buyer-pays so Ben can answer based on the buyer's preference at the booth |

Edge case: `fill` ask resolves to `C-FILL` ($3.25–$3.49 landed master carton or pallet) **only when** the prospect's state matches an in-flight anchor route on the trip; otherwise treats as `landed` ambiguous and asks the buyer their preference.

---

## 4. Output channel (Q4 default)

**v0.1:** Slack thread reply only. Format:

```
:dart: Booth quote — Bryce Glamp and Camp (UT)
Class: C-STD (master carton landed)
36 bags · 1 master carton · $3.49/bag landed = $125.64

Freight: included (USA Gummies absorbs)
Lead time: 2-3 business days from PO
Escalation clause: pricing held for the next 3 cases / 30 days, then subject
to repricing per pricing-route-governance.md §6

NCS-001 vendor form: <link>
Next step: confirm + buyer fills NCS-001 → Mike Hippler ledger creates QBO invoice
```

**v0.2:** Same Slack reply + SMS to Ben's phone (Twilio) so he can hand-show the buyer at the booth.

**v0.3:** Same + SMS to the buyer's phone with the NCS-001 deeplink prefilled with company name + tour referral code.

---

## 5. Pipeline state of record (Q5 default)

**v0.1:** Slack-only audit trail. Booth-visit Slack message persisted to KV under `sales-tour:booth-visits:{tour-id}:{visit-id}`, indexed for replay. **No HubSpot autosync in v0.1** — Ben drains the queue at end-of-day from a `/sales-tour/replay` endpoint that batches the day's visits into HubSpot deals via the existing canonical helper.

**v0.2:** Real-time HubSpot deal creation via `scripts/sales/send-and-log.py` (Codex's canonical helper). Custom property `tour_visit_id = "may-2026-{prospect-token}"`.

**v0.3:** HubSpot deal stage auto-promotes on NCS-001 return (existing webhook).

---

## 6. Class-A / B / C approval taxonomy

Booth quotes never autonomously commit money. Mapping per [`approval-taxonomy.md`](approval-taxonomy.md) v1.6:

| Booth case | Slug | Class | Approver |
|---|---|---|---|
| Quote at published B-grid (`B2`/`B3`/`B4`/`B5`) | `slack.post.audit` | A | (none) |
| Tier upgrade for a returning buyer | `account.tier-upgrade.propose` | B | Ben |
| Non-grid offer (`C-PU`, `C-ANCH` first-time, `C-FILL` > $3.49 / off-route, `C-EXC`) | `pricing.change` | C | Ben + Rene |
| Free sample drop ≤ 6 bags | `slack.post.audit` + `shipment.create` (when shipped from Ashford) | A + B | (audit) + Ben |
| Promise "forever pricing" | `pricing.discount.rule.change` | D (red-line) | manual only — never autonomous |

The booth helper emits the appropriate Class C deal-check post in `#wholesale` automatically when triggers from `pricing-route-governance.md` §7.1 fire.

---

## 7. Architecture (v0.1)

```
Slack DM / channel post
        ↓
Slack events webhook OR /api/ops/sales-tour/booth route (POST {message, user})
        ↓
Parser: parseBoothVisitMessage(text) → BoothVisitIntent
        ↓
Quote engine: composeBoothQuote(intent) → BoothQuote
        ↓
Freight lookup: freightForCorridor(state, palletCount) → FreightQuote
        ↓
Tier classifier: classifyBoothTier(intent) → PricingClass
        ↓
Escalation clause: escalationClauseFor(class, freight) → string
        ↓
Slack reply: postBoothQuoteReply(channel, threadTs, quote)
        ↓
KV persist: kv.set(`sales-tour:booth-visits:{tour-id}:{visit-id}`, payload)
        ↓
Audit: append to #ops-audit with full envelope
```

### 7.1 File map

```
src/lib/sales-tour/
├── booth-visit-types.ts       # TypeScript types: BoothVisitIntent, BoothQuote, PricingClass
├── parse-booth-message.ts     # LLM-based extractor (Claude Sonnet via @anthropic-ai/sdk)
├── freight-corridor-table.ts  # Static regional freight table (WA/OR/ID/UT/NV/AZ × pallet counts)
├── classify-booth-tier.ts     # Pure tier classifier (input: intent → class + B-grid line)
├── compose-booth-quote.ts     # Pure quote composer (input: intent → BoothQuote)
├── escalation-clause.ts       # Pure escalation clause variants
├── format-booth-reply.ts      # Pure Slack reply formatter (no Slack client deps)
└── __tests__/                 # Vitest

src/app/api/ops/sales-tour/
├── booth/
│   └── route.ts               # POST entry — parses + posts Slack reply + persists KV
└── replay/
    └── route.ts               # GET — list a day's booth visits for end-of-day HubSpot drain (v0.2)
```

---

## 8. Versioning + graduation criteria

| Version | Adds | Criteria to graduate |
|---|---|---|
| **v0.1** | Typed Slack input → quote reply | First booth visit on May 11 succeeds end-to-end + Ben confirms readability |
| **v0.2** | Voice memo → Whisper → same parser; Twilio SMS to Ben | 3+ booth visits across ≥ 2 days where voice was used and quote was correct |
| **v0.3** | SMS to buyer with NCS-001 deeplink; real-time HubSpot deal create | Trip ends with all booth visits in HubSpot + audit trail clean |

---

## 9. Cross-references

- [`/contracts/wholesale-pricing.md`](wholesale-pricing.md) v2.2 — the SKU/tier grid the booth helper quotes from.
- [`/contracts/pricing-route-governance.md`](pricing-route-governance.md) v1.0 — anchor / fill / pickup classification + escalation clauses.
- [`/contracts/distributor-pricing-commitments.md`](distributor-pricing-commitments.md) — Sell-Sheet-v3 standing distributor commitments (off-grid, not in booth helper).
- [`/contracts/approval-taxonomy.md`](approval-taxonomy.md) v1.6 — `account.tier-upgrade.propose` / `pricing.change` / `pricing.discount.rule.change` slugs.
- [`/contracts/sales-tour-may-2026-prospect-list.md`](sales-tour-may-2026-prospect-list.md) — the 81-prospect roster with profiles.
- [`/contracts/outreach-pitch-spec.md`](outreach-pitch-spec.md) — locked product facts + pricing tiers + blocked claims.
- `scripts/sales/send-and-log.py` — Codex's canonical HubSpot find-or-create helper (used in v0.2+).
- `src/lib/sales/prospect-playbook.ts` — Codex's prospect playbook structure.
- `src/lib/wholesale/pricing-tiers.ts` — `BAG_PRICE_USD`, `BAGS_PER_UNIT`, tier-classification primitives.

---

## 10. Version history

- **0.2 — 2026-04-29** — Voice memo transcription via OpenAI Whisper (`src/lib/sales-tour/transcribe-voice.ts`) + Twilio SMS-to-Ben companion (`src/lib/sales-tour/sms-quote.ts`). Booth route gains `slackFileId` + `noSms` body fields. Fail-soft on every error path (Twilio env-missing returns `{ skipped: true }`; Whisper errors return `{ ok: false, error }` and the route requires either `message` or a successful transcription). v0.3 (SMS to buyer with NCS-001 deeplink + real-time HubSpot deal create via `scripts/sales/send-and-log.py`) scoped as follow-on. Required env (additive): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SALES_TOUR_BEN_SMS_TO`, `OPENAI_API_KEY` (existing), `SLACK_BOT_TOKEN` with `files:read` scope (one-time scope add at api.slack.com/apps).
- **0.1 — 2026-04-29** — First publication. Defines v0.1 (typed Slack input → Slack quote reply with tier classification + corridor freight + escalation clause). v0.2 (voice + SMS to Ben) and v0.3 (SMS to buyer + HubSpot autosync) scoped as follow-on. Implementation + tests + Slack route shipping in the companion commit.
