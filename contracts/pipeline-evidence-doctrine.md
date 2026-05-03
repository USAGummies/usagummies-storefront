# Pipeline Evidence Doctrine

**Status:** CANONICAL · v1.0 — 2026-05-02
**Owner:** Ben (sales/CRM truth) · Claude Code (build + maintenance)
**Trigger:** Ben's 2026-05-02 directive — *"HubSpot stages cannot be
treated as truth unless they are backed by evidence."*

**Pairs with:**
- `src/lib/sales/pipeline-evidence.ts` — schema (12 stages, 41 evidence types, 5 verification statuses)
- `src/lib/sales/pipeline-verifier.ts` — pure validator + drift detector
- `src/lib/sales/pipeline-evidence-store.ts` — KV I/O
- `src/lib/sales/pipeline-evidence-recorders.ts` — thin one-call recorders for in-process callers
- `/api/ops/sales/pipeline-evidence` (POST) — external systems append evidence
- `/api/ops/sales/pipeline-evidence/[dealId]` (GET) — verified state per deal
- `/api/ops/sales/pipeline-drift` (POST) — bulk drift detector
- `/ops/sales/pipeline-drift` — operator dashboard
- Slack `pipeline drift` command — daily check-in card

---

## 1. The hard rule

**HubSpot stage alone is not evidence.** A deal's stage SHALL NOT be
trusted as truth unless at least one canonical evidence row backs it
up. The verifier silently downgrades any claimed stage that lacks
matching evidence — `revenueStatus` only escalates from "none" when
a real artifact exists.

This protects against the most common failure mode: an operator
clicks "PO Received" / "Paid" / "Shipped" on a deal in HubSpot,
revenue reporting picks up the change, and a week later we discover
no PO / payment / shipment artifact ever existed.

---

## 2. The 12 canonical stages

```
interested → sample_requested → sample_shipped → sample_delivered
→ vendor_setup → quote_sent → po_received → invoice_sent → paid
→ shipped → reorder_due → reordered
```

Each stage's evidence allowlist lives in `EVIDENCE_TYPES_BY_STAGE`.
Adding a HubSpot stage means adding the canonical mapping in
`hubspot-stage-mapping.ts` AND choosing which evidence types support
it.

---

## 3. The verification statuses

| Status | Meaning |
|---|---|
| `unverified` | No claim, no evidence — clean slate. |
| `system_verified` | Claim matches verified stage; evidence recorded by an agent. |
| `human_verified` | Claim matches verified stage; at least one evidence row has a human actor. |
| `needs_review` | Claim runs ahead of evidence — `missingEvidenceForStages` enumerated. |
| `conflicting_evidence` | 2+ authoritative rows of the same type for the same stage with different sources (e.g. two payment records). Operator must reconcile. |

---

## 4. How to wire evidence from an in-process route

The doctrine says: **every system event that produces an artifact
SHALL emit an evidence row.** That's how the trail self-populates
without operator data entry.

For in-process callers, use the recorder helpers:

```ts
import { recordPaymentEvidence } from "@/lib/sales/pipeline-evidence-recorders";

// Inside the QBO payment closer:
await recordPaymentEvidence({
  dealId: hubspotDealId,            // omit when not tied to a deal — recorder no-ops
  source: "qbo",
  sourceId: paymentTxnId,
  url: qboPaymentUrl,
  evidenceType: "qbo_payment_record",
  evidenceAt: paymentRecordedAt,
  actor: "agent:qbo-closer",
  confidence: 0.99,
});
```

Recorders are **best-effort** — they NEVER throw. A KV failure
returns `{ recorded: false, reason }` and the caller's business
operation continues unaffected. The cost of a missing evidence row
is acceptable; the cost of a route failure because evidence
recording broke is not.

### Recommended wire-up sites (next-step refactor work)

| Route / Closer | Recorder | Stage |
|---|---|---|
| `POST /api/ops/agents/sample-dispatch/dispatch` (HubSpot channel branch) | `recordSampleRequestEvidence` | `sample_requested` |
| `executeApprovedShipmentCreate` success → ShipStation order id | `recordShipmentEvidence({kind:"sample"})` | `sample_shipped` |
| ShipStation auto-ship success (`/api/ops/shipping/auto-ship`) | `recordShipmentEvidence({kind:"order"})` | `shipped` |
| QBO invoice creation closer | `recordInvoiceEvidence({evidenceType:"qbo_invoice_sent"})` | `invoice_sent` |
| QBO payment-recorded webhook | `recordPaymentEvidence({evidenceType:"qbo_payment_record"})` | `paid` |
| Shopify wholesale-order webhook | `recordOrderEvidence({evidenceType:"shopify_order"})` | `po_received` |
| Faire wholesale-order webhook | `recordOrderEvidence({evidenceType:"faire_order"})` | `po_received` |
| Vendor-onboarding inbound (W-9 / AP packet) | `recordVendorSetupEvidence` | `vendor_setup` |
| Faire/HubSpot reorder detection | `recordReorderEvidence` | `reordered` |

Each of these is a **one-line addition** with `await` + the recorder.
The recorder is idempotent on `(stage, source, sourceId, evidenceType)`
so re-firing the wire (e.g. retry queue replays) doesn't duplicate.

### External systems (Shopify webhook, Stripe webhook, etc.)

Use the HTTP endpoint:

```bash
curl -X POST https://www.usagummies.com/api/ops/sales/pipeline-evidence \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "dealId": "12345",
    "stage": "paid",
    "evidenceType": "stripe_payment_record",
    "source": "stripe",
    "sourceId": "ch_1Abc...",
    "evidenceAt": "2026-05-02T18:00:00.000Z",
    "actor": "stripe-webhook",
    "confidence": 0.99
  }'
```

The route validates `stage ∈ PIPELINE_STAGES` and
`evidenceType ∈ EVIDENCE_TYPES_BY_STAGE[stage]` — a wrong-type post
is rejected with 400, not silently ignored.

---

## 5. KPI reporting policy

**Stage transitions for KPI reports SHALL come from
`verifiedState.transitions` and `verifiedState.dateEnteredStage`,
not from HubSpot's `dealstage` field directly.**

The 11 conversion timestamps required for May reporting:

| From → To | Field |
|---|---|
| Interested → Sample Requested | `conversionTimestamps.sample_requested` |
| Sample Requested → Sample Shipped | `conversionTimestamps.sample_shipped` |
| Sample Shipped → Sample Delivered | `conversionTimestamps.sample_delivered` |
| Sample Delivered → Vendor Setup | `conversionTimestamps.vendor_setup` |
| Vendor Setup → Quote Sent | `conversionTimestamps.quote_sent` |
| Quote Sent → PO Received | `conversionTimestamps.po_received` |
| PO Received → Invoice Sent | `conversionTimestamps.invoice_sent` |
| Invoice Sent → Paid | `conversionTimestamps.paid` |
| Paid → Shipped | `conversionTimestamps.shipped` |
| Shipped → Reorder Due | `conversionTimestamps.reorder_due` |
| Reorder Due → Reordered | `conversionTimestamps.reordered` |

`dateEnteredStage` always reflects the **earliest** evidence
`evidenceAt` for the verified stage — which is closer to the truth
than HubSpot's audit log (which only records the click timestamp,
not the underlying event).

---

## 6. Stage-promotion approval doctrine

When a deal's HubSpot stage is moved via the canonical Class C
`hubspot.deal.stage.move` approval, the approval payload SHALL cite:

- `verifiedState.verifiedStage` (current verified stage from KV)
- `verifiedState.dateEnteredStage` (when the verified stage was reached)
- The specific `evidenceIds` that support the new stage
- A reason string explaining the move

If the operator tries to move a HubSpot stage **ahead of** the
verified stage, the approval card SHOULD surface the gap as a
warning: "*Promoting deal to PO Received but evidence only
supports Quote Sent. Are you sure?*"

---

## 7. Slack surfacing

The daily `pipeline drift` Slack command (added 2026-05-02) reads
the HubSpot pipeline + the KV evidence trail and posts a Block Kit
card per `/contracts/slack-card-doctrine.md` v1.0:

- 6-field stats: total / clean / drifted / 1-step / 2-step / 3+ /
  no-evidence
- Top 5 drifted deals (no-evidence first, then by drift steps)
- Posture chip: red on no-evidence or 3+ drift, yellow on any drift,
  green clean
- Read-only context: "*no HubSpot stage is moved from this card*"

---

## 8. Version history

- **v1.0 — 2026-05-02** — Initial publication. Schema (12 stages, 41
  evidence types, 5 verification statuses) + verifier + KV store +
  recorders + 3 routes + Slack card + dashboard. Recorder library is
  shipped; in-process wire-up at the routes/closers above is queued
  for the next refactor pass.
