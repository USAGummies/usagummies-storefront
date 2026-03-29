# ABRA REPLATFORM PLAN

## Goal
Get to a working multi-user operating system for USA Gummies as fast as possible.

Users:
- Ben (executive / operations)
- Rene (finance)
- Drew (sales / wholesale)

Primary requirement:
- results over architecture purity
- no more monolithic chatbot orchestration
- keep working backend assets
- add a real control plane and worker model on top

## Final Product Definition
Abra is USA Gummies' email-first digital operating system.

It should:
- ingest company signals from Gmail, Slack, QBO, Plaid, Shopify, Notion, and file uploads
- convert those signals into structured business state
- execute deterministic finance and operations work
- queue approvals for risky actions
- keep Ben, Rene, and Drew informed without spam
- support background research and long-running analysis through bounded workers

## Source of Truth Hierarchy
1. Repo code and committed changes = executable truth
2. Supabase = runtime state truth
3. QBO = accounting truth
4. Gmail = communication truth
5. Notion = blueprint, curated knowledge, playbooks, dossiers
6. Slack = command, approval, and summary interface

## Architecture Decision
Use a hybrid model:
- Paperclip = orchestration and control plane
- Current repo = execution backend and storefront
- Slack = main human interface
- Claude/Codex workers = bounded background workers
- Computer Use = fallback for gaps, not default integration path

## What We Keep
### Backend assets
- Gmail ingestion and email intelligence logic
- QBO integration and finance actions
- Supabase tables and runtime state
- PO pipeline and approvals
- entity state and follow-up logic
- storefront and Shopify-facing app code
- existing deterministic action patterns that already work

### Product surfaces
- Slack channels and user identity model
- Notion as blueprint and curated memory
- current briefs, summaries, and task concepts where they already map to real state

## What We Stop Building On
- monolithic chatbot orchestration
- LLM-first action routing for core workflows
- duplicated runtime paths that can both respond/act
- custom scheduling/orchestration glue when the control plane can own it
- prompt-heavy logic that decides whether a core business action should happen

## What Gets Added
### Control plane
Paperclip should own:
- agent list
- worker ownership
- task visibility
- approval inbox
- routine / heartbeat scheduling
- dashboard of current work and status

### First worker set
- Abra CEO
- Email Intelligence
- Finance
- Operations
- Sales

### First routines
- Email intelligence sweep
- Morning brief
- Finance digest
- PO review

## Build Order
### Phase 1 — Pilot control plane
Goal: prove multi-user orchestration without deleting the current backend.

Deliver:
- local Paperclip company
- first five agents
- first four routines
- Slack/Gmail/Notion wiring
- backend callable from the agents
- visible inbox / tasks / approvals / agent activity

Exit criteria:
- one real email gets processed into state + summary + task/approval
- one real finance request completes through the new control plane
- one PO item appears correctly in the shared task/inbox flow

### Phase 2 — Route core work through the new layer
Goal: use the control plane for daily operations.

Deliver:
- Ben uses Slack + control plane for ops/executive work
- Rene uses Slack + control plane for finance work
- Drew uses Slack + control plane for sales/pipeline work
- old orchestration paths remain only as fallback while parity is proven

Exit criteria:
- no duplicate replies
- no duplicate scheduled notifications
- no silent failures on core user requests
- email/finance/PO flows are stable for at least a full day of real use

### Phase 3 — Retire redundant orchestration
Goal: remove the custom orchestration code that no longer provides value.

Retire incrementally:
- overlapping schedulers
- legacy responder logic
- duplicated decision layers
- dead or redundant task routing glue

Constraint:
- do not remove any path until the control-plane path has passed live use

## Division of Labor
### Codex owns
- backend execution hardening
- deterministic handlers
- state and idempotency
- email / finance / PO / approval execution adapters
- migrations, tests, invariants

### Claude Code owns
- Paperclip setup and orchestration layer
- live Slack behavior validation
- user-facing output quality
- production smoke tests
- Notion blueprint synchronization and reporting polish

## Immediate Workstreams
### Codex now
1. Fix trust bugs in the backend execution layer
2. expose thin stable adapters for control-plane agents
3. keep email, finance, PO, and approval state authoritative

### Claude Code now
1. stand up local Paperclip pilot
2. create USA Gummies company and initial agents
3. wire MCP/connectors and routines
4. mirror the pilot plan into Notion and keep the shared execution log current

## Success Criteria
The pilot is successful when:
- Ben, Rene, and Drew can all use the same system without stepping on each other
- the system has one visible inbox for approvals and exceptions
- email turns into real state/tasks, not repeated alerts
- finance work executes through reliable backend paths
- PO lifecycle is visible and stateful
- Slack is calm, concise, and trustworthy

## Non-Negotiables
- never auto-send email
- keep deterministic state and dedup logic
- prefer APIs/MCP over browser automation when available
- use Computer Use only where APIs/MCP do not cover the workflow
- do not delete working backend assets until the new layer proves itself
