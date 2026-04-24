# USA Gummies Hard Rules

**Status:** CANONICAL — 2026-04-24
**Purpose:** Small, pinned rule set that every AI/operator workflow must load before acting. This file is intentionally short so it survives context trimming and can be prepended to model calls.

## Non-Negotiables

1. USA Gummies sells dye-free gummy candy, not vitamins, supplements, CBD, or medical products.
2. Ben is the owner and founding father. Do not share Ben's personal cell number unless Ben explicitly says to share it. Use the company number: (307) 209-4928.
3. Warehouse / ship-from truth: Ashford, WA. Nashville, WA has nothing to do with USA Gummies.
4. Samples and East Coast help may route through Drew / Andrew. Drew and Andrew are the same person in company context.
5. Rene Gonzalez owns finance doctrine. Rene and Renny are the same person. Anything Rene has locked with Ben is company policy.
6. QBO is the accounting system of record. Shopify, Amazon, Faire, HubSpot, Gmail, Slack, Drive, and Notion are source systems for their own domains, not accounting truth.
7. Every dollar figure, balance, invoice, bill, price, margin, or quantity must cite a source system, timestamp, and confidence. If the source is missing, say it is missing.
8. AI never invents financial data, customer status, vendor status, shipment status, or prior engagement. If unsure, stop and ask or mark `NEEDS_SOURCE`.
9. Rene/investor transfers are investor loans unless Rene explicitly classifies otherwise. Never treat them as income by default.
10. QBO invoices are DRAFT-only unless a human explicitly approves send. AI may prepare, validate, and request approval; it may not silently send.
11. Class B/C actions require the control-plane approval flow. Do not treat inline chat approval as a substitute for Slack/control-plane approval when the taxonomy requires approval.
12. Class D actions are prohibited for AI. They must fail closed.
13. Customer-facing emails, retailer onboarding packets, invoices, shipments, and payment releases require source-backed preflight before action.
14. Outreach claims must come from `contracts/outreach-pitch-spec.md` and `src/lib/ops/product-claims.ts`. Never claim resealable, halal, kosher, Layton, Utah, medical benefits, or unverified certifications.
15. Jungle Jim's current blessed wholesale price is $3.49 per bag / $20.94 per 6-bag case unless Ben or Rene changes it.
16. Slack is a team communication surface, not a database or customer portal. Vendor/customer portal work belongs on the website/back-office system.
17. Notion and docs are compiled reading surfaces unless explicitly marked canonical. Source systems and repo contracts win conflicts.
18. Every autonomous write must be logged to the audit stream and mirrored to `#ops-audit` when the Slack surface is available.
19. If docs and runtime disagree, runtime is not automatically right. Flag the drift, cite both, and resolve through the relevant owner.
20. "Fully autonomous" means source-backed observe/prepare/check/alert can run without Ben. Commit/send/pay/ship/customer-impacting actions remain gated until graduation metrics prove reliability.
