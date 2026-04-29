# Approval Taxonomy — USA Gummies 3.0

**Status:** CANONICAL
**Source:** Notion blueprint §15.3
**Version:** 1.4 — 2026-04-27 (Phase 29 Drew sweep — "drew owns nothing" doctrine)
**Governing file:** Also defined in code at `src/lib/ops/control-plane/taxonomy.ts`. Code and this doc must stay in lockstep.

**Doctrinal correction (Ben 2026-04-27):** Drew is not an approver. All approval slugs that previously named Drew (`qbo.po.draft`, `inventory.commit`, `run.plan.commit`, `inventory.adjustment.large`) have been reassigned. Drew remains a fulfillment node for samples + East Coast destinations per CLAUDE.md, but does not own approval lanes.

---

## Classes

| Class | Name | Meaning | Who approves |
|---|---|---|---|
| `A` | Autonomous | Observe / Prepare. No approval. | N/A |
| `B` | Single approval | Commit after one human approval. | Ben for sales/commercial + operations; Rene for finance |
| `C` | Dual approval | High-impact commit requires two humans. | Ben + Rene for money and supply commitments |
| `D` | Red-Line / prohibited | Never autonomous. Manual only. | Human must initiate and execute |

## Operating shorthand

- `Observe` + `Prepare` → Class A
- `Commit` → Class B or C (business-impact dependent)
- `Red-Line` → Class D

## Class A — Autonomous

No approval gate. Agent executes directly and logs to `#ops-audit`.

| Slug | What |
|---|---|
| `system.read` | Read from any system of record (HubSpot, QBO, Shopify, Plaid, Amazon, Notion, Gmail) |
| `open-brain.capture` | Capture observation/summary to Open Brain with fingerprint+provenance |
| `draft.email` | Draft (no send) |
| `slack.post.audit` | Post informational content to `#ops-audit` or a division channel |
| `internal.note` | Write an internal Notion note or HubSpot internal comment |
| `hubspot.task.create` | Create a HubSpot task (no stage change) |
| `booke.categorize.suggest` | Booke auto-commits categorization at ≥ 0.95 confidence (Rene confidence thresholds per Finance Doctrine 07 §7) |
| `qbo.invoice.partial-payment.apply` | Apply a partial payment to an existing sent invoice |
| `invoice.dispute.flag` | Flag an invoice as disputed (notation; freezes AR aging 30d) |
| `research.post.tagged` | Post a tagged `[R-1]`..`[R-7]` research update to `#research` |
| `brief.publish` | Publish daily or EOD executive brief to `#ops-daily` |
| `audit.sample.score` | Drift-audit runner scores a sampled agent output |
| `coi.expiry-alert` | Post 30-day-pre-expiry alert for a supplier COI |
| `connector.health.post` | Daily connector-health smoke-test post |
| `shipment.tracking-push` | Push carrier tracking back to CRM / Shopify / customer channel |
| `lead.enrichment.write` | Fill HubSpot contact/company fields from Apollo with provenance |

## Class B — Single approval

One approver. Request lands in `#ops-approvals` with tap-to-approve UX.

| Slug | What | Approver |
|---|---|---|
| `gmail.send` | Send outreach email | Ben |
| `hubspot.deal.stage.move` | Move a live deal stage | Ben |
| `qbo.invoice.draft` | Create QBO invoice draft (not send) | Rene |
| `qbo.po.draft` | Create QBO PO draft (not send) | Ben |
| `shipment.create` | Create sample/order shipment | Ben |
| `content.publish` | Publish blog or social post | Ben |
| `division.activate` | Activate a latent division. Downstream automation (flipping `divisions.json`, creating the channel, writing the agent contract) is still manual — see [`activation-triggers.md`](activation-triggers.md) §"What this actually automates." | Ben |
| `division.deactivate` | Deactivate an active division back to latent. Same manual-followup caveat. | Ben |
| `pod.trade-show.activate` | Activate a per-show Trade Shows pod. Channel + per-show agent contract creation still manual. | Ben |
| `pod.trade-show.deactivate` | Deactivate a Trade Shows pod after the 14-day post-show wind-down. Manual follow-up to archive the channel. | Ben |
| `booke.categorize.edit` | Edit a Booke categorization suggestion below the 0.95 auto-commit threshold | Rene |
| `qbo.class.create` | Create a new QBO Class (secondary channel tag per CF-09 BOTH) | Rene |
| `qbo.class.modify` | Modify an existing QBO Class | Rene |
| `qbo.location.create` | Create a new QBO Location | Rene |
| `qbo.location.modify` | Modify an existing QBO Location | Rene |
| `qbo.credit-memo.create` | Create a credit memo against an existing invoice | Rene |
| `qbo.invoice.void` | Void a QBO invoice (pre-send correction) | Rene |
| `qbo.bill.create` | Create a QBO bill from vendor invoice intake | Rene |
| `qbo.bill.approve-for-payment` | Mark a QBO bill approved for the next payment run | Rene |
| `receipt.review.promote` | Acknowledge a captured receipt + OCR suggestion as Rene-reviewed. NOT a QBO write — an eligible packet still flows through a separate Class B `qbo.bill.create` later. Approval transitions the in-repo review packet from `draft` → `rene-approved`; canonical receipt fields and QBO state are untouched. | Rene |
| `vendor.master.create` | Create a new vendor master (QBO vendor + Notion dossier + Drive) | Rene |
| `invoice.write-off.draft` | Draft a bad-debt write-off on overdue invoice under Rene-only threshold | Rene |
| `ar.hold.set` | Set AR-hold flag on a customer/company — blocks new orders across Shopify B2B, Faire, direct | Rene |
| `ar.hold.clear` | Clear the AR-hold flag on a customer/company | Rene |
| `legal.doc.expiry-override` | Short-term override of an expired COI/W-9/etc. while renewal in flight | Ben |
| `shipstation.rule.modify` | Change a ShipStation automation rule (carrier, origin, preset) | Ben |
| `approved-claims.add` | Add a new claim to the Approved Claims list | Ben |
| `approved-claims.retire` | Retire a claim from the Approved Claims list | Ben |
| `faire-direct.invite` | Send a Faire Direct invite email (0% commission route) | Ben |
| `faire-direct.follow-up` | Send a follow-up email to a retailer who already received a Faire Direct invite | Ben |
| `account.tier-upgrade.propose` | Propose a retailer tier upgrade (follow-up `pricing.change` Class C if material) | Ben |
| `retailer.onboard.company-create` | Create Shopify B2B company + HubSpot company + QBO customer in one pass | Ben |
| `claim.counsel-review.request` | Send a proposed claim to Wyoming Attorneys for counsel review | Ben |

## Class C — Dual approval

Two approvers. Request remains pending until both approve; any reject terminates.

| Slug | What | Approvers |
|---|---|---|
| `qbo.invoice.send` | Send invoice (money request) | Ben + Rene |
| `payment.release` | Approve vendor payment / ACH | Ben + Rene |
| `inventory.commit` | Commit inventory buy | Ben + Rene |
| `vendor.financial.commit` | Major vendor financial commitment (new copacker, agency retainer) | Ben + Rene |
| `pricing.change` | Structural pricing change (wholesale tier, MSRP) | Ben + Rene |
| `invoice.write-off.execute` | Execute a bad-debt write-off (above Rene-only threshold) | Ben + Rene |
| `payment.batch.release` | Release the weekly AP payment batch (multiple bills in one batch) | Ben + Rene |
| `credit-limit.expand` | Expand a retailer credit limit above the tier default | Ben + Rene |
| `qbo.period.close.final` | Final monthly period close lock | Ben + Rene |
| `ad.spend.launch` | Launch a paid-media campaign with single-campaign budget > $500 | Ben + Rene |
| `run.plan.commit` | Commit a production run with Powers (cash impact + lot) | Ben + Rene |
| `inventory.adjustment.large` | Cycle-count adjustment > 50 units | Ben + Rene |

## Class D — Red-Line / prohibited

Never autonomous. Agents must refuse and escalate if asked. Humans perform these manually.

| Slug | What |
|---|---|
| `secret.share` | Share or emit a secret |
| `data.delete.prod` | Delete production data |
| `permissions.modify` | Modify permissions / sharing (Notion, Slack admin, Vercel team, repo access) |
| `contract.sign` | Sign a contract |
| `system.destructive` | Destructive system change (drop schema, force-push main, revoke prod key) |
| `pricing.discount.rule.change` | Change pricing/discount rules without explicit project approval |
| `qbo.chart-of-accounts.modify` | Modify the QBO Chart of Accounts (add/remove/rename accounts). CoA is Rene policy; agents never touch. Rene edits manually in QBO UI. |
| `qbo.investor-transfer.recategorize` | Recategorize a Rene-investor transfer to anything other than `Loan from Owner`. CLAUDE.md canonical: any transfer from Rene G. Gonzalez or the Rene G. Gonzalez Trust = liability, never income. |
| `qbo.journal-entry.autonomous` | Post an autonomous journal entry in QBO. Agents never post JEs; Rene posts manually after review. |
| `qbo.period.close.reopen` | Reopen a closed QBO accounting period. Policy event requiring Rene + Ben + audit trail; never automated. |
| `ad.claim.publish-unreviewed` | Publish an ad creative that has not been reviewed against the Approved Claims list. |
| `customer.data.export-external` | Export customer data to an external (non-canonical) system. |

## Rules

1. **Fail-closed on unknown actions.** If an action slug is not in this registry, agents MUST NOT execute it. Register here first.
2. **Escalation:** `pending` → auto-tag Ben at 24h → auto-expire at 72h.
3. **Evidence required:** every Class B/C request includes claim, sources cited with `{system, id, url, retrievedAt}`, confidence (0.0–1.0), and rollback plan.
4. **No nested bypass:** an agent may not create a Class A action that causes a Class B effect (e.g. "autonomous draft" that publishes).
5. **Approver authority:** a Class B request Ben-approved does not grant that agent open authority for the same action class — each instance gets its own request.
6. **Audit trail:** every approved action is logged to `#ops-audit` with the approval id as a back-reference.

## Channel-segmentation rule (CF-09, 2026-04-20)

Channel segmentation lives in BOTH dimensions per CF-09 resolution:

- **Primary:** QBO account-code suffix per the real post-reset Chart of Accounts (e.g. `400010.05` Inderbitzin, `400015.05` Amazon, `400015.10` DTC, `400015.15` Trade Show, `400020.05` Shopify-Faire-B2B; COGS mirror on `500xxx`; Freight Out on `500090.xx`). See Finance Doctrine 01 §2.5.
- **Secondary (cross-cutting):** QBO Classes + Locations, applied on top for questions the account structure can't answer (Meta campaigns, specific trade-show identity, sample programs). Locations = `Ashford WA`, `East Coast (Drew)`.

The `qbo.class.create/modify` and `qbo.location.create/modify` slugs registered in v1.2 support the secondary dimension. The Class D `qbo.chart-of-accounts.modify` protects the primary dimension.

## Version history

- **1.5 — 2026-04-29** — Added `faire-direct.follow-up` (Class B, Ben) to doctrine doc to match taxonomy.ts (slug was already in code, missing from doc — caught by post-P0 architecture audit). No new behavior; lockstep correction so P0-7 lockstep auditor + P0-1 unknown-slug detector stop flagging the gap.
- **1.3 — 2026-04-25** — Added `receipt.review.promote` (Class B, Rene). Phase 9 of the Sales Command receipt lane: acknowledges a Phase 7 OCR-suggested receipt as Rene-reviewed by transitioning the in-repo review packet from `draft` → `rene-approved`. Strictly NOT a QBO write — an eligible packet still flows through a separate Class B `qbo.bill.create` action later. Doc and code in lockstep at `src/lib/ops/control-plane/taxonomy.ts`.
- **1.2 — 2026-04-20** — Finance extraction + Drive retrieval + CF-09 BOTH resolution. Added 44 new slugs across all four classes: 10 Class A (booke.categorize.suggest, qbo.invoice.partial-payment.apply, invoice.dispute.flag, research.post.tagged, brief.publish, audit.sample.score, coi.expiry-alert, connector.health.post, shipment.tracking-push, lead.enrichment.write); 21 Class B (booke.categorize.edit, qbo.class.create/modify, qbo.location.create/modify, qbo.credit-memo.create, qbo.invoice.void, qbo.bill.create, qbo.bill.approve-for-payment, vendor.master.create, invoice.write-off.draft, ar.hold.set/clear, legal.doc.expiry-override, shipstation.rule.modify, approved-claims.add/retire, faire-direct.invite, account.tier-upgrade.propose, retailer.onboard.company-create, claim.counsel-review.request); 7 Class C (invoice.write-off.execute, payment.batch.release, credit-limit.expand, qbo.period.close.final, ad.spend.launch, run.plan.commit, inventory.adjustment.large); 6 Class D (qbo.chart-of-accounts.modify, qbo.investor-transfer.recategorize, qbo.journal-entry.autonomous, qbo.period.close.reopen, ad.claim.publish-unreviewed, customer.data.export-external). Sourced from Finance Doctrine 05 + 22.C taxonomy queue + CF-09 resolution. Code and doc in lockstep at `src/lib/ops/control-plane/taxonomy.ts`.
- **1.1 — 2026-04-18** — Registered the 4 activation slugs (`division.activate`, `division.deactivate`, `pod.trade-show.activate`, `pod.trade-show.deactivate`) so the approval queue can accept them. Downstream flip-the-JSON automation is still manual — see [`activation-triggers.md`](activation-triggers.md) §"What this actually automates."
- **1.0 — 2026-04-17** — First canonical publication. Derived from blueprint §15.3.
