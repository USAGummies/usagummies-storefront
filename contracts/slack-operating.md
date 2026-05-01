# Slack Operating Contract — USA Gummies 3.0

**Status:** CANONICAL
**Source:** Notion blueprint §14.5 + §15.2
**Version:** 1.1 — 2026-05-01
**Mirror in code:** `src/lib/ops/control-plane/channels.ts` (+ `contracts/channels.json`).

---

## Purpose

Slack is the **human command surface**: approvals, escalations, decision summaries, audit. Slack is **not** the database, memory layer, or work tracker. That role belongs to the systems of record (HubSpot, QBO, Shopify, Amazon, Open Brain, Notion).

## Active channel map

| Channel | Slack ID | Purpose | Allowed | Not allowed |
|---|---:|---|---|---|
| `#ops-daily` | `C0ATWJDKLTU` | Daily control-tower brief, executive rollup | Morning brief, EOD summary, major decisions, company-wide priorities | Raw firehose alerts, long discussions, duplicate status posts |
| `#ops-approvals` | `C0ATWJDHS74` | Human approval gate (all Class B + C) | Structured approve/reject requests with rationale and disposition | Open-ended brainstorming, unactionable summaries |
| `#ops-audit` | `C0AUQSA66TS` | Permanent audit trail | Agent write logs, drift audit results, policy violations, postmortems | General chat, approvals, duplicate alerts |
| `#ops-alerts` | `C0ATUGGUZL6` | System health and incidents | Connector failures, degraded mode, run failures, threshold breaches | Normal operating updates, celebration posts |
| `#sales` | `C0AQQRXUYF7` | Revenue execution (B2B + DTC + Amazon) | Deal threads, outreach drafts awaiting approval, retailer/distributor movement, marketplace revenue issues | Finance approvals, ops chatter not tied to revenue |
| `#finance` | `C0ATF50QQ1M` | Cash, accounting, reconciliation | AP/AR, invoices, bills, reconciliations, exceptions, finance approvals | Sales chatter, vendor chatter without financial consequence |
| `#operations` | `C0AR75M63Q9` | Production, supply, samples, operations blockers | POs, vendors, freight, inventory, samples, production blockers | Marketing work, finance-only debate |
| `#shipping` | `C0AS4635HFG` | Shipping labels, tracking, packing slips | Label PDFs, packing-slip PDFs, tracking numbers, carrier/void coordination | General ops chatter, finance debate, marketing |
| `#research` | `C08HWA9SRP1` | Research synthesis and intelligence routing | Findings tagged `[R-1]` through `[R-7]`, weekly synthesis, action-worthy intelligence | Unstructured link dumps without synthesis |
| `#receipts-capture` | `C0APYNE9E73` | Receipt intake | Receipt images/files, required metadata | Anything unrelated to receipt capture |
| `#marketing` | `C08J9EER9L5` | Brand + paid marketing | Campaign review, ad performance, creative pipeline | Ops/finance chatter |

## Latent channels (not created until division activates)

- `#trade-shows` — activates per show (pod fires for that show only)
- `#outreach-pr` — activates when Outreach/Partnerships/Press activates (≥ 5 inbound press/mo)
- `#cx` — activates when Customer Experience activates (> 20 DTC tickets/mo for 2 weeks)
- `#product-rd` — activates when Product/Packaging/R&D activates (first new SKU decision)

## Rules

### Thread rule
Whenever possible, **one live object gets one thread**. One deal = one thread. One incident = one thread. One trade show = one thread. One campaign = one thread. One vendor issue = one thread. Chatter cross-references the thread ts, not a new top-level message.

### Research tagging
All `#research` posts begin with `[R-1]` through `[R-7]`:
- `[R-1]` Consumer
- `[R-2]` Market / category
- `[R-3]` Competitive
- `[R-4]` Channel
- `[R-5]` Regulatory
- `[R-6]` Ingredient / supply
- `[R-7]` Press / media

The Research Librarian posts a weekly synthesis (Friday 10 AM PT) with no tag prefix, summarizing cross-cutting findings.

### Severity tiers (every agent post carries one)

| Tier | Emoji | Posts to | Mention policy |
|---|---|---|---|
| `info` | ℹ️ | Thread reply or division channel | No mention |
| `action` | ⚡ | Division channel | Mention owner |
| `warning` | ⚠️ | Division channel + `#ops-alerts` | `@owner` |
| `critical` | 🚨 | `#ops-alerts` + DM to Ben | `@Ben` + iMessage fallback |

### Audit rule
Every autonomous write by every agent gets a one-line mirror in `#ops-audit` with: `{run_id, agent, division, action, entity_ref, approval_id?, source_citations, confidence}`. `#ops-audit` is append-only; humans do not post here.

### Approval-request format
Every Class B/C approval posted to `#ops-approvals` includes:
- **Agent** + **division** + **run_id**
- **Action** (human-readable)
- **Target** (system + entity reference)
- **Payload preview** (short; full payload linked if too large)
- **Evidence** with sources (each `{system, id, url, retrievedAt}`) and confidence
- **Rollback plan**
- **Required approvers** + **escalateAt** + **expiresAt**
- Interactive buttons: `✅ Approve` / `❌ Reject` / `💬 Ask`

### Approval UX standard
Approvals must read like an operator console, not a log dump:
- Top line: action, target, approval class, and owner.
- Summary card: what will happen, why now, and what can go wrong.
- Evidence card: sources and confidence, collapsed/truncated before it becomes a wall of text.
- Payload preview: formatted by workflow type. Email drafts show `To`, `Subject`, and a readable body preview; finance actions show vendor, amount, date, and source document; shipping actions show recipient, carrier, tracking, and artifact links.
- Actions: `Approve`, `Reject`, and `Needs edit` / `Ask`. Editing requests must keep the original approval pending and create a visible thread note.
- Deep link: every approval includes the relevant `/ops/*` dashboard link when one exists.

### Retirement / archival
These channels are migrated and archived on or before Monday 2026-04-20:
- `#abra-control` → traffic split between `#ops-daily` (routines) and division channels (events)
- `#abra-testing` → archive
- `#email-inbox` → fold into `#sales` or `#cx` as appropriate
- `#customer-feedback` → fold into `#sales` (until `#cx` activates)
- `#abandoned-carts` → fold into `#sales`
- `#wholesale-leads` → rename to `#sales` (or archive if routing is clean)

Runtime code must route by live Slack `C...` ID when known. Archived ids `C0ALS6W7VB4` (`#abra-control`), `C0AKG9FSC2J` (`#financials`), `C0AS7UHNGPL` (`#wholesale-leads`), and `C0ARSF61U5D` (`#email-inbox`) are prohibited in production code.

### Rate and dedup
Agents must not post the same payload (by fingerprint) twice within 6 hours to the same channel. Duplicate posts are a policy violation.

## Version history

- **1.1 — 2026-05-01** — Adds live Slack channel IDs, `#shipping`, active `#marketing`, approval UX standard, and explicit archived-channel ID prohibition. Runtime mirrors now prefer channel IDs over names.
- **1.0 — 2026-04-17** — First canonical publication. Derived from blueprint §14.5 and §15.2.
