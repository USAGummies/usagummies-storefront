# Approval Taxonomy — USA Gummies 3.0

**Status:** CANONICAL
**Source:** Notion blueprint §15.3
**Version:** 1.1 — 2026-04-18
**Governing file:** Also defined in code at `src/lib/ops/control-plane/taxonomy.ts`. Code and this doc must stay in lockstep.

---

## Classes

| Class | Name | Meaning | Who approves |
|---|---|---|---|
| `A` | Autonomous | Observe / Prepare. No approval. | N/A |
| `B` | Single approval | Commit after one human approval. | Ben for sales/commercial; Rene for finance; Drew for operations |
| `C` | Dual approval | High-impact commit requires two humans. | Ben + Rene for money; Ben + Drew for supply commitments |
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

## Class B — Single approval

One approver. Request lands in `#ops-approvals` with tap-to-approve UX.

| Slug | What | Approver |
|---|---|---|
| `gmail.send` | Send outreach email | Ben |
| `hubspot.deal.stage.move` | Move a live deal stage | Ben |
| `qbo.invoice.draft` | Create QBO invoice draft (not send) | Rene |
| `qbo.po.draft` | Create QBO PO draft (not send) | Drew |
| `shipment.create` | Create sample/order shipment | Ben |
| `content.publish` | Publish blog or social post | Ben |
| `division.activate` | Activate a latent division. Downstream automation (flipping `divisions.json`, creating the channel, writing the agent contract) is still manual — see [`activation-triggers.md`](activation-triggers.md) §"What this actually automates." | Ben |
| `division.deactivate` | Deactivate an active division back to latent. Same manual-followup caveat. | Ben |
| `pod.trade-show.activate` | Activate a per-show Trade Shows pod. Channel + per-show agent contract creation still manual. | Ben |
| `pod.trade-show.deactivate` | Deactivate a Trade Shows pod after the 14-day post-show wind-down. Manual follow-up to archive the channel. | Ben |

## Class C — Dual approval

Two approvers. Request remains pending until both approve; any reject terminates.

| Slug | What | Approvers |
|---|---|---|
| `qbo.invoice.send` | Send invoice (money request) | Ben + Rene |
| `payment.release` | Approve vendor payment / ACH | Ben + Rene |
| `inventory.commit` | Commit inventory buy | Ben + Drew |
| `vendor.financial.commit` | Major vendor financial commitment (new copacker, agency retainer) | Ben + Rene |
| `pricing.change` | Structural pricing change (wholesale tier, MSRP) | Ben + Rene |

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

## Rules

1. **Fail-closed on unknown actions.** If an action slug is not in this registry, agents MUST NOT execute it. Register here first.
2. **Escalation:** `pending` → auto-tag Ben at 24h → auto-expire at 72h.
3. **Evidence required:** every Class B/C request includes claim, sources cited with `{system, id, url, retrievedAt}`, confidence (0.0–1.0), and rollback plan.
4. **No nested bypass:** an agent may not create a Class A action that causes a Class B effect (e.g. "autonomous draft" that publishes).
5. **Approver authority:** a Class B request Ben-approved does not grant that agent open authority for the same action class — each instance gets its own request.
6. **Audit trail:** every approved action is logged to `#ops-audit` with the approval id as a back-reference.

## Version history

- **1.1 — 2026-04-18** — Registered the 4 activation slugs (`division.activate`, `division.deactivate`, `pod.trade-show.activate`, `pod.trade-show.deactivate`) so the approval queue can accept them. Downstream flip-the-JSON automation is still manual — see [`activation-triggers.md`](activation-triggers.md) §"What this actually automates."
- **1.0 — 2026-04-17** — First canonical publication. Derived from blueprint §15.3.
