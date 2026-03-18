# Notion Governance Slide (USA Gummies)

## Target Information Architecture
- **USA Gummies (Operating Hub)**
  - Command Center Operations
  - Sales + Distributor Pipeline
  - Finance + Compliance
  - Product / Fillings & Emulsions (F&E)
- **Non-USA-Gummies projects** (separate top-level hubs)
  - Move unrelated command-center pages out of USA Gummies operating paths.

## Canonicalization Rules
- One canonical F&E Logic Layer page; duplicate pages archived (not deleted).
- One `Platform Users` identity per person (email-unique).
- Every core database includes governance fields:
  - `Owner`
  - `System of Record`
  - `Last Reviewed`
  - `Environment`
  - `Data Steward`
  - `Status`

## Access Model
- `admin`: full edit + schema + permissions.
- `employee`: operational edit on working views.
- `investor`: read-only investor views only.
- `partner/banker`: read-only scoped views.

## Investor Read-Only Views
- KPI summary views only.
- No operational queue controls.
- No internal email body content unless explicitly approved.
- No credential/system-key fields in exposed properties.

## Execution Status (March 5, 2026)
- Workspace entities and duplicate targets were previously identified.
- Direct Notion execution is currently blocked by MCP authentication (`Auth required`).
- Immediate next step after re-auth: apply page moves/archives, dedupe records, add governance fields, and publish access matrix.

## Access Matrix (to finalize post re-auth)
| Area | Admin | Employee | Investor | Partner/Banker |
|---|---|---|---|---|
| Operating command center docs | Edit | Edit | View curated only | View curated only |
| Sales/distributor databases | Edit | Edit | View curated only | View curated only |
| Platform Users database | Edit | Limited update | No access | No access |
| F&E logic layer canon | Edit | Suggest/edit | View curated summary | No access |
