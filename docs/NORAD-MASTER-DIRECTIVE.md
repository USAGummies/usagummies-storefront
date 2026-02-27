# NORAD Master Directive — USA Gummies War Room

Version: 1.0  
Date: 2026-02-27

## Purpose
This directive is the authoritative implementation contract for the NORAD rebuild. It defines page intent, API contracts, freshness behavior, and reconciliation rules so future agent changes do not drift from the operational model.

## Operating Principles
- Live data first; pro forma is benchmark-only.
- Faire must remain separated from Shopify DTC in channel views.
- Pipeline statuses must represent real stage truth (Committed = PO received).
- Budget model remains dormant until funded (`budget: null` by default).

## Page Contracts
### 1. Command Center (`/ops`)
- KPIs: MTD revenue, cash, units shipped, contribution margin, open deals, days of inventory.
- Includes 30-day channel trend, channel mix, active alerts, and benchmark row.
- Required APIs: `/api/ops/dashboard`, `/api/ops/balances`, `/api/ops/pipeline`, `/api/ops/alerts`, `/api/ops/channels`, `/api/ops/pnl`.

### 2. Revenue by Channel (`/ops/channels`)
- Tabs: All, Shopify DTC, Amazon, Faire, Distributors.
- Must render Faire split from Shopify orders.
- Required APIs: `/api/ops/channels`, `/api/ops/dashboard`, `/api/ops/pnl`.

### 3. P&L / Finance (`/ops/finance`)
- Live contribution P&L (Actual | Plan | Budget | Variance).
- Cash position, burn rate, runway, transaction feed.
- Required APIs: `/api/ops/pnl`, `/api/ops/balances`, `/api/ops/transactions`, `/api/ops/forecast`.

### 4. Pipeline & Deals (`/ops/pipeline`)
- Kanban stages: Lead, Outreach, Sampling, Negotiation, Committed, Shipping.
- Deal cards include email snippet and action controls.
- Required APIs: `/api/ops/pipeline`, `/api/ops/deal-emails`.

### 5. Supply Chain (`/ops/supply-chain`)
- Inventory grid + production + supplier/cost trends + alerts.
- Required APIs: `/api/ops/inventory`, `/api/ops/supply-chain`.

### 6. Marketing & ROAS (`/ops/marketing`)
- GA4 overview, daily traffic, source/medium, top pages, funnel.
- Ad channels remain budget-ready placeholder until connected.
- Required API: `/api/ops/marketing`.

### 7. Alerts & Actions (`/ops/kpis`)
- Unified alert inbox with triage, email drafting, and action log.
- Data freshness panel from audit endpoint.
- Required APIs: `/api/ops/alerts`, `/api/ops/audit`.

## API Surface (Phase 1)
- `/api/ops/channels` — per-channel revenue with Faire split
- `/api/ops/deal-emails` — latest thread per deal contact
- `/api/ops/inventory` — SKU inventory and reorder metrics
- `/api/ops/supply-chain` — suppliers, production, costs, alerts
- `/api/ops/transactions` — Plaid transactions + analysis
- `/api/ops/marketing` — GA4 traffic + funnel
- `/api/ops/alerts` — unified actionable alerts
- `/api/ops/audit` — reconciliation + freshness report

## Audit Rules (must remain active)
- Shopify total == DTC + Faire + Distributor + Other.
- Cash movement is directionally aligned with P&L net.
- Inventory consumption is directionally aligned with shipped proxy.
- Pipeline open value covers committed revenue floor.
- Amazon API orders remain near internal snapshot parity.

## Freshness Rules
- Fresh: <= 60 minutes old.
- Stale: > 60 minutes old.
- Critical: > 6 hours old.
- Missing: no cache/timestamp present.

All NORAD pages should expose a staleness badge at the header level based on their primary data sources.

## Scheduler Integration
- Master scheduler route should warm audit cache on cron runs.
- Audit cache is consumed by alerts page and staleness badges.

## Budget Readiness (Dormant)
- Keep budget fields nullable (`null`) when no budget source exists.
- UI may show budget columns/gauges only when values are populated.
- Future `/api/ops/budgets` should hydrate budget allocations without restructuring existing payloads.

## Change Control
Any future modifications should preserve:
- existing endpoint paths,
- response shape compatibility for current pages,
- Faire split logic,
- staleness semantics,
- audit reconciliation visibility.
