# ABRA TARGET ARCHITECTURE

## Purpose
Abra is USA Gummies' email-first digital operating system.

Abra is not a chatbot. Abra is the company's digital operator: it reads the business from email, Slack, QBO, bank data, ecommerce systems, and structured memory; converts that into state and actions; executes bounded work; and surfaces only what Ben and Rene need to know.

This document is the canonical product and systems blueprint.

## Source of Truth Rules
- Notion is the blueprint, planning, and human-readable storage layer.
- The repository and committed code are the executable truth.
- Supabase is the runtime state truth.
- QBO is the accounting truth.
- Gmail is the communications truth.
- Slack is the human interface.
- Brain entries are searchable working knowledge, not a replacement for runtime state.

If these conflict:
1. QBO/Gmail/Supabase/runtime data win for operational facts.
2. Repo code wins for system behavior.
3. Notion wins for intended design and documented process.

## Product Definition
Abra should do five things continuously:
1. Ingest digital inputs.
2. Understand and structure those inputs.
3. Execute bounded actions deterministically.
4. Coordinate work across departments.
5. Surface concise, actionable summaries to Ben and Rene.

## Core Inputs
### Primary operational inputs
- Gmail
- Slack
- QuickBooks Online
- Plaid / bank feed
- Shopify
- Amazon
- Attachments, PDFs, screenshots, and images
- Teach/correct commands from Ben and Rene

### Secondary organizational inputs
- Notion pages and databases
- Structured internal docs
- Research docs and market notes

## Department Model
Departments are runtime work lanes, not prompt personas.

### Finance
Owns:
- transaction categorization
- AP / AR
- reconciliation
- P&L / balance sheet / cash reporting
- payment matching
- loan and capital tracking

### Sales / Wholesale
Owns:
- distributor pipeline
- broker relationships
- wholesale pricing context
- outbound prospecting state
- retailer/media opportunity tracking

### Operations / Supply Chain
Owns:
- production readiness
- vendor coordination
- packaging / film / freight state
- inventory state
- PO shipping lifecycle

### Executive
Owns:
- morning brief
- meeting prep
- decision synthesis
- daily priorities
- cross-department summarization

### Research (future)
Owns:
- distributor sourcing
- competitor monitoring
- scenario modeling
- strategic recommendations grounded in real company data

## Runtime Architecture
### 1. Intake Layer
All business-relevant events enter through typed intake paths.

#### Email intake
Every important email should be processed exactly once.
For each message/thread:
- dedup by message ID
- classify
- extract facts
- update entities
- update state
- create tasks/approvals where needed
- emit one summary if human attention is required

#### Slack intake
Slack is the command and decision interface.
It must support:
- Ben and Rene queries
- approvals
- teach/correct messages
- screenshots/images
- thread continuity
- driving mode

#### Financial intake
QBO and bank feed events should continuously update:
- categorization state
- deposit/payment matching state
- AP/AR state
- unified revenue/cash state

### 2. Understanding Layer
For every input, Abra should determine:
- what type of object this is
- which department owns it
- which entities are involved
- what facts are durable
- whether this changes runtime state
- whether this requires action, approval, or only storage

This layer may use LLM extraction, but not open-ended decision-making.

### 3. State Layer
There are two memory types.

#### Runtime state (authoritative for operations)
Stored in Supabase:
- operator tasks
- approvals
- purchase orders
- entity states
- learned categorization rules
- last-run state
- notification dedup state
- processed message IDs
- evaluation runs
- reconciliation state

#### Knowledge state (authoritative for searchable context)
Stored as brain entries / structured knowledge:
- vendor facts
- pricing/term history
- meeting notes
- legal/IP notices
- media contacts
- insurance contacts
- production decisions
- policy preferences from Ben/Rene

### 4. Department Workers
Workers should be bounded modules, not improvising agents.

Current/target workers:
- Email Intelligence Worker
- Finance Worker
- PO / Order Worker
- Reconciliation Worker
- Entity / Relationship Worker
- Follow-Up Worker
- Briefing Worker
- Meeting Prep Worker
- Research Worker (future)

Every worker should:
- own a narrow domain
- read/write durable state
- perform deterministic actions where possible
- ask for approval when external or high-risk actions are needed
- be auditable

### 5. Execution Layer
The core rule:
Deterministic code decides and executes. The LLM helps extract, summarize, and draft.

Canonical flow:
`input -> classify -> extract -> update state -> execute action -> verify result -> summarize`

Low-risk internal actions should auto-execute.
Examples:
- categorize known QBO transactions
- create file exports
- create/update runtime records
- create knowledge entries
- update PO status from tracking

Medium/high-risk actions should be approval-gated.
Examples:
- send email
- create or alter financial records above thresholds
- create invoices above policy thresholds
- destructive operations

### 6. Human Interface Layer
#### Ben
Ben needs:
- held morning brief
- driving-safe interaction mode
- meeting prep
- executive summaries
- action priorities
- teach/correct ingestion
- approval queue

#### Rene
Rene needs:
- deterministic finance operations in `#financials`
- accurate QBO answers fast
- exports in the same channel
- categorization and review workflows
- concise, finance-focused responses

## Non-Negotiable Product Behaviors
### Messaging
- Every message to Abra gets a response.
- No silent failures.
- No fake "On it" responses when no action happened.
- Thread continuity must work.

### Email
- Every important email is processed exactly once.
- No repeated spam alerts for the same email.
- Emails can create memory, state changes, tasks, approvals, or direct execution.
- Founder-forwarded emails should be stored as knowledge without noise.

### Finance
- QBO data must be accurate and explained honestly.
- Rene must be able to run finance workflows through Abra.
- Exports must land in the right channel.
- Categorization learning should improve over time.

### Operations
- PO lifecycle must be real, not conceptual.
- Vendor logistics and production readiness must be queryable.
- Inventory position should be grounded in real inputs.

### Approvals
- No outbound email without approval.
- No destructive financial actions without policy checks.
- All approval-required actions should surface clearly and once.

## Key Domain Lifecycles
### Email lifecycle
`received -> classified -> facts extracted -> entity/state updated -> action taken or stored -> optional summary surfaced`

### PO lifecycle
`received -> invoice_draft -> invoice_sent -> production -> packing -> shipped -> delivered -> payment_pending -> paid -> closed`

### Transaction lifecycle
`uncategorized -> suggested -> auto-categorized or review -> learned rule updated -> future auto-categorization improved`

### Follow-up lifecycle
`entity quiet period detected -> follow-up task created -> draft prepared -> approval -> sent -> relationship state updated`

## What Abra Should Know About The Business
Abra should progressively maintain a live operational model of:
- current produced or quoted COGS
- current wholesale pricing and margin constraints
- current production readiness and blockers
- current open POs, bills, invoices, shipments, deposits, and approvals
- current entity relationships and next actions
- current growth/pipeline opportunities

That allows questions like:
- "What delivered price can we offer this distributor?"
- "What does that do to margin if freight is included?"
- "What is still blocking Powers from starting?"
- "What came in today that matters?"
- "What should I ask Greg?"
- "Who should we target next and why?"

## Research Department (Future State)
The research department should be built only after the operational core is trusted.

It should combine:
- historical outreach and response data
- current product economics
- inventory and capacity constraints
- distributor/retailer fit
- market and competitor data
- Ben/Rene strategy preferences

Outputs:
- distributor target lists
- scenario analysis
- channel strategy recommendations
- competitor and pricing intelligence
- margin-aware go-to-market suggestions

## What Completion Looks Like
Abra is complete enough for full company use when:
- Ben and Rene trust it without compensating for it.
- Every important email is processed once and turned into useful state.
- Every core action either executes or fails honestly.
- Rene can independently run finance operations through Abra.
- Ben can independently run operational and executive workflows through Abra.
- Morning brief, meeting prep, and driving mode are trusted.
- PO, invoice, payment, and vendor states are queryable and current.
- Duplicate alert spam is gone.
- Approval gating is reliable.
- System behavior is auditable.

## What Success Looks Like In Practice
Success is boring reliability.

Examples:
- Rene asks for P&L and gets the correct answer fast.
- Ben forwards an important email and Abra stores the right facts without noise.
- A PO arrives and becomes a tracked business object immediately.
- A vendor invoice becomes a QBO bill draft and AP entry.
- A shipment email updates delivery state.
- A deposit triggers payment matching.
- Ben asks what changed while he was driving and gets the right answer.
- Ben asks what to ask Greg and gets context grounded in real history.

## Build Principles
- One authoritative path per class of work.
- Minimize overlapping control planes.
- Prefer deterministic execution over prompt-layer improvisation.
- Use LLMs inside bounded tasks, not as the operating backbone.
- Keep Notion as blueprint and storage, not fragile execution glue.
- Keep the repo and committed code as executable truth.
