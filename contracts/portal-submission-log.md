# Portal Submission Log

**Status:** OPERATIONAL · v1.0 — 2026-04-30 PM
**Owner:** Ben (operator) · Claude in Chrome (autonomous filling) · Claude Code (log maintenance + audit)
**Trigger:** Ben's 2026-04-30 PM directive — autonomous portal-submission run via Claude in Chrome to clear the weekend backlog by Monday.

**Pairs with:**
- [`/contracts/portal-submission-backlog.md`](portal-submission-backlog.md) — the list of portals to enter
- [`/contracts/company-vendor-packet.md`](company-vendor-packet.md) — the answer source for every form field

---

## How this log gets updated

Every portal submission Claude in Chrome (or Ben manually) completes appends ONE row to §1. Logging protocol:

1. Append to the bottom of the table — newest at bottom, chronological.
2. Status enum: `submitted` · `partial` (some fields submitted, others stop-and-asked) · `blocked` (form requires field we don't have) · `confirmed` (portal returned an ack ID or email).
3. Confirmation # / Next-step copy goes in the `Confirmation / next step` column verbatim from the portal response page.
4. Attachments column lists every file uploaded (sell sheet, W-9, COA, COI) so we know what they have.
5. After each row, ALSO post to Slack `#ops-approvals` with the portal name + status + permalink to this log row.
6. If status = `blocked`, ALSO open a thread in `#ops-approvals` tagging Ben with the missing-field name + best-guess + screenshot.

---

## 1. Submission log

| # | Date / Time (PT) | Portal | URL | Operator | Status | Attachments uploaded | Confirmation / next step | HubSpot deal |
|---|---|---|---|---|---|---|---|---|
|   |   |   |   |   |   |   |   |   |

*(Empty — log starts on first Claude-in-Chrome run.)*

---

## 2. Submission run history (per session)

| Run # | Started | Operator | Portals attempted | Submitted | Blocked | Notes |
|---|---|---|---|---|---|---|
|   |   |   |   |   |   |   |

---

## 3. Outstanding decisions / fields-to-resolve

When a portal asks for something the vendor packet doesn't cover, Claude in Chrome stops, logs the missing field here, and surfaces in `#ops-approvals` for Ben.

| Date | Portal | Field | Best guess | Ben answer | Status |
|---|---|---|---|---|---|
|   |   |   |   |   |   |

---

## 4. Hard rules (never skip)

1. **Never submit bank account / routing numbers** unless the portal is on the approved-allowlist (Avolta, Jungle Jim's, Thanksgiving Point, etc.) AND the form is encrypted-upload only.
2. **Never click "I agree to terms"** without first surfacing the full terms text to Ben if it's a multi-year commitment, exclusivity clause, or auto-renew.
3. **Never invent values.** Use only fields from `/contracts/company-vendor-packet.md`. If a field isn't there, stop and surface it.
4. **Always upload the v3 sell sheet** (`output/assets/sell-sheet.pdf` — $5.99 MSRP + named flavors) as the primary product attachment.
5. **Always log the submission HERE before moving to the next portal.** No batching uploads without per-row log entries.
6. **Never submit pricing below the locked floor:** $1.79 + $0.33/bag GP minimum (branded) = $2.12 standard / $1.87 loose-pack. PL minimum: $1.79 + $0.25 = $2.04. Below those = stop and ask Ben.

---

## Version history

- **v1.0 — 2026-04-30 PM** — Initial publication. Empty log + protocol locked. Pairs with portal-submission-backlog v2 + company-vendor-packet v1.1.
