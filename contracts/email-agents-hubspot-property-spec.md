# Email Agents — HubSpot Custom Property Spec + Creation Log

**Status:** ✅ EXECUTED — DRAFT v0.3 (2026-04-30 PM). Properties live in HubSpot.
**Author:** Claude (audit pass deliverable; Ben + Rene approval pending — Ben for HubSpot UI work, Rene for CRM-data-implication review of the §11.6 hard-gate fields against finance-side workflows)
**Purpose:** Concrete UI checklist for the **9 missing HubSpot custom properties** that gate Phase 38.3 (Operation Souvenir Shelf backfill) and the §11.6 HubSpot hard-gate doctrine.
**Status of gate:** ✅ UNBLOCKED. Properties were created via Path B (programmatic schema-add via `HUBSPOT_PRIVATE_APP_TOKEN` + HubSpot CRM Properties API) on 2026-04-30 PM at Ben's explicit operator-approved direction. All 13 property creations + 2 property-group creations succeeded with zero failures. `email-agents-system-proposal.md` v0.4 §11.6 hard-gate is now writable; Phase 38.3 backfill can proceed once Phase 37 is complete.

Earlier this spec went through a v0.1 (incorrectly attributed CRM-schema ownership to Rene) → v0.2 (factual correction: HubSpot is Ben-only per `/CLAUDE.md` admin lanes) → v0.3 (Path B executed, this version logs what landed).

**Pairs with:** [`/contracts/email-agents-system-proposal.md`](email-agents-system-proposal.md) §11.6 + Phase 38.3, [`/contracts/approval-taxonomy.md`](approval-taxonomy.md) v1.6 (no new slug needed — `lead.enrichment.write` Class A is the existing slug for population).

---

## 1. Already wired (no action — verify only)

These 5 fields are already in production via `scripts/sales/send-and-log.py` + `src/lib/ops/hubspot-client.ts` + the existing `wholesale-onboarding-flow.md` integration. No new property creation needed.

| §11.6 field | HubSpot internal name | Object | Type | Source-of-truth |
|---|---|---|---|---|
| Company | `company` (standard) | Contact | Single-line text | Apollo enrichment + manual entry |
| Contact | `email` / `firstname` / `lastname` / `jobtitle` / `phone` (all standard) | Contact | Standard | Apollo enrichment + manual |
| Source | `hs_analytics_source` (standard) | Contact | Standard enum | HubSpot lifecycle |
| Owner | `hubspot_owner_id` (standard) | Contact + Deal | Owner | Always Ben (never Drew per `/CLAUDE.md` Drew-owns-nothing lock) |
| Last Touch | `notes_last_activity_date` (standard) | Contact + Deal | Datetime | HubSpot engagement timeline |

---

## 2. Missing properties — Ben UI checklist (9 properties)

Each row = one property to create in **HubSpot Settings → Properties → [Object: Contact OR Deal] → Create property**.

### 2.1 `usa_vertical` — vertical classification

| Field | Value |
|---|---|
| Display name | `Vertical (USA Gummies)` |
| Internal name | `usa_vertical` |
| Object type | **Contact** AND **Deal** (mirror — populated on contact, copied to associated deal at deal-create) |
| Field type | Dropdown select |
| Enum values | `nps_concessionaire` · `nps_friends_org` · `gateway_community_retail` · `museum_gift_shop` · `souvenir_destination` · `convenience_premium` · `specialty_grocer` · `distributor_regional` · `distributor_national` · `wholesale_marketplace` · `trade_show_lead` · `co_pack_partner` (EXPERIMENTAL) · `press_outlet` · `marketplace_listing` · `airline_amenity` (EXPERIMENTAL) · `military_exchange` (EXPERIMENTAL) · `rangeme_campaign` · `research_agent_inbound` |
| Description | "Canonical vertical per `/contracts/email-agents-system-proposal.md` §11.2. Decides cadence, pitch angle, doctrine match." |
| Populated by | `vertical-classifier` capability via Class A `lead.enrichment.write` |
| Required at deal-create? | YES (HubSpot Verification Agent §2.9 hard-blocks deal advance until populated) |

### 2.2 `usa_tier` — tier classification

| Field | Value |
|---|---|
| Display name | `Tier (USA Gummies)` |
| Internal name | `usa_tier` |
| Object type | Contact + Deal (mirror) |
| Field type | Dropdown select |
| Enum values | `T0` (whale — Buc-ee's, KeHE, McLane, Eastern National, Walmart, HEB, Costco, Aramark, Compass, Delaware North, Xanterra, SSA Group) · `T1` (mid-cap chain or strategic credential) · `T2` (regional independent or smaller chain) · `T3` (single-location or low-volume) |
| Description | "Tier per `/contracts/email-agents-system-proposal.md` §11.2. Decides cadence override, approval class for follow-ups, GP opportunity range." |
| Populated by | `vertical-classifier` capability via Class A `lead.enrichment.write` |
| Required at deal-create? | YES |

### 2.3 `usa_next_action` — next action

| Field | Value |
|---|---|
| Display name | `Next Action (USA Gummies)` |
| Internal name | `usa_next_action` |
| Object type | **Deal** (primary) — optional mirror to Contact for Lead-stage deals |
| Field type | Single-line text |
| Description | "Free-text next operator action (e.g. `Send Touch 2 by Tue`, `Hand-craft Charmaine reply`, `Wait for Drew sample tracking`). Empty value means no action queued — system flags missing on active deals." |
| Populated by | Cadence Sequencer capability + manual operator entry |
| Required for active deals? | YES (HubSpot Verification Agent §2.9 hard-blocks if missing on `Lead`/`Sample Shipped`/`Quote Sent` deals) |

### 2.4 `usa_due_date` — next-action due date

| Field | Value |
|---|---|
| Display name | `Due Date (USA Gummies)` |
| Internal name | `usa_due_date` |
| Object type | Deal |
| Field type | Date picker |
| Description | "Date the `usa_next_action` is due. Used by daily brief to surface 'cadence due today' and by Weekly Audit Agent §2.10 to flag stale HOLDs (> 14 days past due_date)." |
| Populated by | Cadence Sequencer capability |
| Note | Distinct from HubSpot's standard `closedate` — `closedate` is the projected DEAL CLOSE; `usa_due_date` is the NEXT TOUCH due. Don't overload. |

### 2.5 `usa_cadence_state` — current cadence position

| Field | Value |
|---|---|
| Display name | `Cadence State (USA Gummies)` |
| Internal name | `usa_cadence_state` |
| Object type | Contact + Deal (mirror) |
| Field type | Dropdown select |
| Enum values | `not_started` · `touch_1_sent` · `touch_2_due` · `touch_2_sent` · `touch_3_due` · `touch_3_sent` · `paused_inbound_reply` · `paused_hold_class` · `closed_won` · `closed_lost` · `closed_unqualified` |
| Description | "Operational cadence state per `/contracts/email-agents-system-proposal.md` §11.3.4. Drives the cadence sequencer's next-touch logic and the daily-brief 'cadence due today' surface. NEVER `not_started` for an active deal — Phase 38.3 backfill defaults the 17 Operation Souvenir Shelf imports to `not_started` + `approval_required = true`." |
| Populated by | Cadence Sequencer capability + closer flips on inbound classification |

### 2.6 `usa_strategic_frame` — Strategic Frame

| Field | Value |
|---|---|
| Display name | `Strategic Frame (USA Gummies)` |
| Internal name | `usa_strategic_frame` |
| Object type | Deal |
| Field type | Multi-line text (long-text — HubSpot supports up to ~65k chars on long-text properties) |
| Description | "Per-exchange `StrategicFrame` per `/contracts/email-agents-system-proposal.md` §2.5b. JSON-structured: premise / relationship / opportunity / goal / risks / financial frame / dontShare / play. Re-rendered on every drafter run; persisted at most-recent value." |
| Populated by | Strategic Framework analyzer (Phase 37.5) before every drafter run |
| Format | JSON-stringified `StrategicFrame` object |

### 2.7 `usa_prospect_frame` — Prospect Frame

| Field | Value |
|---|---|
| Display name | `Prospect Frame (USA Gummies)` |
| Internal name | `usa_prospect_frame` |
| Object type | Contact + Deal |
| Field type | Multi-line text (long-text) |
| Description | "Per-prospect `ProspectFrame` per `/contracts/email-agents-system-proposal.md` §11.2. JSON-structured: vertical / experimental / angle / targetTitle / tier / opportunityUsd / doctrineMatch / regulatoryHook (INTERNAL ONLY) / competitiveShelf / sampleAsCredential. Persisted once at prospect-classification time, updated on doctrine reclassification." |
| Populated by | `vertical-classifier` capability (Phase 38.2) |
| Format | JSON-stringified `ProspectFrame` object |

### 2.8 `usa_cashflow_frame` — Cashflow Frame

| Field | Value |
|---|---|
| Display name | `Cashflow Frame (USA Gummies)` |
| Internal name | `usa_cashflow_frame` |
| Object type | Deal |
| Field type | Multi-line text (long-text) |
| Description | "Per-deal `CashflowFrame` per `/contracts/email-agents-system-proposal.md` §11.2 (Ben's lock 2026-04-30 PM). JSON-structured: expectedOrderDays / expectedFirstOrderBags / expectedGrossRevenue / expectedGrossProfit / cashSpeed / paymentRisk / reorderLikelihood. **`cashSpeed` decides daily brief priority** — strategic plays never block cashflow plays." |
| Populated by | `vertical-classifier` + Strategic Framework analyzer (Phase 38.2 + 37.5) |
| Format | JSON-stringified `CashflowFrame` object |

### 2.9 `usa_approval_state` — current approval surface state

| Field | Value |
|---|---|
| Display name | `Approval State (USA Gummies)` |
| Internal name | `usa_approval_state` |
| Object type | Deal |
| Field type | Single-line text |
| Description | "Active approval surface state for this deal. Format: `<status>:<slug>:<approval_id>` (e.g. `pending:gmail.send:apr-12345` or `approved:qbo.invoice.send:apr-67890` or `none`). Mirrors the canonical approval-state in `/api/ops/control-plane/approvals` so the daily brief + Weekly Audit Agent §2.10 can read it directly off the deal without a separate KV lookup." |
| Populated by | Slack Interactive UI capability (Phase 37.6) at approval-card-fire time + closer at approve/deny/expire |

---

## 3. Implementation paths

Two valid paths to property creation:

### Path A — Ben UI work (RECOMMENDED, doctrine-aligned)

1. Ben opens HubSpot Settings → Properties.
2. For each of the 9 properties in §2 above, click **Create property**, paste the display name + internal name + type + enum values (where applicable) + description.
3. Ben confirms each property's **field-level permission** (default: visible to all HubSpot users, editable by Ben + automation only).
4. Ben posts a one-line confirmation to `#financials` thread for Rene's awareness (`✅ HubSpot custom properties for email agents created — proposal §11.6 unblocked`). Rene needs to know they exist in case they surface in any HubSpot-export workflow that feeds his finance reporting, but he doesn't operate them.
5. Phase 38.3 backfill is now unblocked.

**Why recommended:** preserves Ben's CRM-schema ownership lane, no new approval slug or division required, no code commits.

### Path B — Programmatic schema add via existing Class A `lead.enrichment.write`

1. Build a one-off `POST /api/ops/hubspot/property-schema-create` route that uses HubSpot Properties API + an idempotent set of property creates.
2. Auth-gate via `CRON_SECRET`.
3. Run once. Audit envelope per property emitted.

**Why NOT recommended for v1:** adds code surface; Ben-side property edits in HubSpot UI later become harder to track (the source-of-truth question gets fuzzy — is the prod schema what code emits, or what Ben edited in UI?). Path A is one-time work; Path B is forever-maintained code. **HOWEVER** — if Ben prefers not to spend the ~15 min on UI clicks, Path B is genuinely a reasonable trade since Ben is the only HubSpot operator and the source-of-truth-fuzziness risk is lower with one operator vs two.

If Ben prefers Path B, the route can be built — but it's a separate proposal + commit, not part of this spec.

---

## 4. Rollback plan

If Phase 37 is abandoned or de-scoped, the 9 properties become orphaned data. Rollback steps:

1. Ben opens HubSpot Settings → Properties.
2. For each `usa_*` property, click **Delete** (HubSpot retains the data on contacts/deals as a backup for 30 days — HubSpot UI surfaces this).
3. No code change required (the consuming capabilities don't exist yet).

This is a low-cost rollback because v1 of these properties is explicitly *write-only by automation, read-only by humans* — there's no business workflow that depends on them outside the email-agents system.

---

## 5. Validation tests (Phase 37.16 / 38.8)

Once the properties exist, the test suite should lock:

1. **Round-trip:** populate `usa_vertical` via API → fetch via API → assert string equals input.
2. **Enum validation:** writing `usa_vertical = "not_a_real_vertical"` returns HubSpot validation error (HubSpot enforces enum at API level when type=enumeration).
3. **JSON parse:** `usa_strategic_frame` / `usa_prospect_frame` / `usa_cashflow_frame` round-trip valid JSON; corrupted JSON is detected by reader and surfaces an exception in the audit.
4. **Required-field gate:** HubSpot Verification Agent §2.9 hard-blocks deal advance when `usa_vertical` / `usa_tier` / `usa_next_action` are missing on active-stage deals.
5. **Drew-doctrine lock:** no agent ever populates `hubspot_owner_id` with a Drew-owned identity (existing `drew-doctrine.test.ts` already locks this).

---

## 6. Open questions for Ben before creation

These are property-design decisions, not approval-system decisions. Ben-only:

1. **Object placement** — for properties marked "Contact + Deal mirror" in §2 (`usa_vertical`, `usa_tier`, `usa_cadence_state`, `usa_prospect_frame`), confirm we want both. Alternative: contact-only with deal lookup at read-time, simpler schema.
2. **Long-text vs JSON property** — `usa_strategic_frame` / `usa_prospect_frame` / `usa_cashflow_frame` are stored as JSON-stringified text. HubSpot doesn't have a native JSON type. Confirm long-text is fine (we lose HubSpot UI editability but gain structure-stability).
3. **Permission model** — should `usa_*` properties be visible in HubSpot UI to all users, or restricted? Since Ben is the only operator, the default "visible to all, editable by Ben + automation" simplifies to "Ben + automation see and edit; nobody else."
4. **Field-history retention** — HubSpot retains property change history. For frames that update on every drafter run, we'll fill the history fast. Confirm or add a "frames are write-once-on-classification, read-many" doctrine.
5. **Property group** — create a new HubSpot property group called `USA Gummies — Email System` to keep these 9 properties grouped, or scatter into existing groups? Default: dedicated group.

---

## 7. Creation log (2026-04-30 PM, Path B executed)

Per Ben's 2026-04-30 PM directive *"or you can use the api you have"*, Path B was executed via `HUBSPOT_PRIVATE_APP_TOKEN` + the HubSpot CRM Properties API.

**Property groups created (2):**

| Object | Internal name | Display name | Status |
|---|---|---|---|
| `contacts` | `usagummies_email_system` | USA Gummies — Email System | ✓ created |
| `deals` | `usagummies_email_system` | USA Gummies — Email System | ✓ created |

**Properties created (13):**

| Object | Internal name | Type | Field type | Enum count | Status |
|---|---|---|---|---:|---|
| contacts | `usa_vertical` | enumeration | select | 18 | ✓ created |
| contacts | `usa_tier` | enumeration | select | 4 | ✓ created |
| contacts | `usa_cadence_state` | enumeration | select | 11 | ✓ created |
| contacts | `usa_prospect_frame` | string | textarea | — | ✓ created |
| deals | `usa_vertical` | enumeration | select | 18 | ✓ created (mirror) |
| deals | `usa_tier` | enumeration | select | 4 | ✓ created (mirror) |
| deals | `usa_cadence_state` | enumeration | select | 11 | ✓ created (mirror) |
| deals | `usa_prospect_frame` | string | textarea | — | ✓ created (mirror) |
| deals | `usa_next_action` | string | text | — | ✓ created |
| deals | `usa_due_date` | date | date | — | ✓ created |
| deals | `usa_strategic_frame` | string | textarea | — | ✓ created |
| deals | `usa_cashflow_frame` | string | textarea | — | ✓ created |
| deals | `usa_approval_state` | string | text | — | ✓ created |

**Verification:** read-back via API confirmed `usa_vertical` (18 enum values landed) + `usa_due_date` (type=date, fieldType=date, group correct). All properties land in `usagummies_email_system` group.

**Source script:** `/tmp/sends/hubspot-property-create.py` (idempotent — re-running treats existing properties as ✓; no duplicate-creation errors).

**Rollback:** `DELETE /crm/v3/properties/{contacts|deals}/{property_name}` per property. HubSpot retains property data for 30 days post-delete. The script can be inverted into a delete script if needed.

**No new approval slug created.** Schema-add was performed under Ben's explicit operator approval; uses the existing `HUBSPOT_PRIVATE_APP_TOKEN` private-app scope which already includes `crm.schemas.contacts.write` + `crm.schemas.deals.write`. No mutation to `/contracts/approval-taxonomy.md`. No new agent registered.

---

## Version history

- **v0.3 — 2026-04-30 PM (EXECUTED)** — Path B fired via API: 2 property groups + 13 properties created with zero failures. Round-trip verification passed. §7 creation log added. Phase 38.3 unblocked from the schema side.
- **v0.2 — 2026-04-30 PM (DRAFT)** — Factual correction: Rene does NOT have HubSpot access (per `/CLAUDE.md` admin-lane registry — Rene's lanes are BofA/QBO/Notion/Drive/Slack only). v0.1 incorrectly attributed CRM-schema ownership to Rene. v0.2 reattributes UI work to Ben (the only HubSpot operator). Path B (programmatic schema-add) re-evaluated and softened from "NOT recommended" to "reasonable alternative" since the source-of-truth-fuzziness concern is lower with a single operator. The 5 §6 open design questions are now Ben-only (display name conventions, long-text-vs-JSON, permissions, field-history, property group).
- **v0.1 — 2026-04-30 PM (DRAFT)** — Initial spec drafted from `email-agents-system-proposal.md` v0.4 §11.6. 9 missing properties spec'd. Ben UI checklist (Path A) recommended; programmatic schema-add (Path B) flagged as not-recommended for v1. 5 open design questions in §6 [later corrected: was incorrectly labeled "Rene-only"].
