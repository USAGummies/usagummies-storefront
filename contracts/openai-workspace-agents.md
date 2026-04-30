# OpenAI ChatGPT Workspace Agents Integration

**Status:** Phase 3 shipped — MCP search/fetch + approval-request tools + ops cockpit
**Owner:** Ben  
**Last updated:** 2026-04-29

## 1. Decision

Do **not** build a second agent stack inside ChatGPT.

Use ChatGPT workspace agents as a **workspace surface** over the existing USA Gummies control-plane:

- ChatGPT can read approved ops surfaces and synthesize answers.
- ChatGPT can prepare or request registered Slack approvals.
- ChatGPT cannot directly execute QBO, Gmail, ShipStation, Shopify checkout, HubSpot stage/property, Faire API, pricing, cart, bundle, or inventory writes.
- Slack remains the command / approval / audit surface.
- Existing closers remain the only execution layer after human approval.

This preserves the current doctrine: one source of truth per domain, fail-closed unknown approval slugs, and no silent autonomous writes.

## 2. Why This Fits OpenAI's Current Surface

OpenAI's current ChatGPT connector path supports custom connectors using MCP. The relevant docs say custom connectors bring internal systems into ChatGPT via MCP, and Business / Enterprise / Edu admins can publish connectors for workspace users. The MCP guide requires a connector to expose `search` and `fetch` for ChatGPT connector / deep research compatibility. The Responses API and Agents SDK are better for building standalone agentic applications; they are **not** the first choice for this workspace UX because our approval/control-plane already exists.

Official references:

- [Connectors in ChatGPT](https://help.openai.com/en/articles/11487775-connectors-in-chatgpt)
- [Building MCP servers for ChatGPT and API integrations](https://platform.openai.com/docs/mcp/)
- [ChatGPT Developer mode](https://platform.openai.com/docs/developer-mode)
- [Responses API migration guide](https://platform.openai.com/docs/guides/migrate-to-responses)
- [Agents SDK guide](https://platform.openai.com/docs/guides/agents-sdk/)

## 3. Integration Shape

```mermaid
flowchart LR
  ChatGPT["ChatGPT workspace connector"] --> MCP["USA Gummies MCP server"]
  MCP --> Registry["OpenAI workspace tool registry"]
  Registry --> ReadRoutes["Existing read-only ops routes"]
  Registry --> ApprovalRoutes["Existing request-approval routes"]
  ApprovalRoutes --> Slack["Slack #ops-approvals"]
  Slack --> Closers["Existing approval closers"]
  Closers --> Audit["#ops-audit + KV/audit stores"]
```

Phase 0 created the typed allowlist:

- `src/lib/ops/openai-workspace-tools/registry.ts`
- `GET /api/ops/openai-workspace-tools`

The route is diagnostic and auth-gated. It exposes tool metadata only. It does not execute any tool.

Phase 1 adds the read-only MCP-compatible endpoint:

- `src/lib/ops/openai-workspace-tools/auth.ts`
- `src/lib/ops/openai-workspace-tools/mcp.ts`
- `GET /api/ops/openai-workspace-tools/mcp`
- `POST /api/ops/openai-workspace-tools/mcp`

The MCP endpoint supports `initialize`, `tools/list`, and `tools/call` for `search`, `fetch`, and the approved request-approval tools. It has no direct execution tools.
External ChatGPT connector auth uses `OPENAI_WORKSPACE_CONNECTOR_SECRET` as a dedicated bearer token. Existing internal ops auth remains supported.

Phase 3 adds the operator cockpit:

- `/ops/openai-workspace-tools`

The cockpit summarizes the allowlist, connector readiness, blocked/prohibited doctrine, and runs a browser-session discovery probe against the MCP endpoint. It never exposes raw secret values and never calls write clients.

## 4. Tool Classes

### Read Tools

Allowed:

- `/api/ops/sales`
- `/api/ops/sales/prospects/day1`
- `/api/ops/readiness`
- `/ops/finance/review`
- `/api/ops/docs/receipt-review-packets`
- `/api/ops/faire/direct-invites`

Rules:

- Read-only.
- Never convert degraded / not-wired state into `0`.
- Always cite the backing route or surface.
- No raw secret values.

### Approval-Request Tools

Allowed:

- Faire Direct invite approval request.
- Faire Direct follow-up approval request.
- Receipt review approval request.

Rules:

- ChatGPT may only call a route whose purpose is to open an existing Slack approval.
- The action slug must already exist in the approval taxonomy.
- The Slack approval closer remains the execution path.
- A denied / expired / missing approval means no action.

### Prohibited Tools

Blocked:

- Direct QBO bill creation from receipt.
- Direct ShipStation label purchase.
- Direct Gmail sends.
- Direct HubSpot stage/property updates.
- Direct Shopify cart / pricing / checkout / bundle changes.
- Direct Faire API invite sends.

These stay blocked until a registered approval slug, tested closer, and audit path exist.

## 5. What We Already Have

The repo is already close to a ChatGPT workspace-agent architecture:

- Agent contracts and packs define who owns what.
- `/ops/sales`, `/ops/readiness`, `/ops/finance/review`, `/ops/faire-direct`, and receipt review-packet routes are already curated read surfaces.
- `/ops/sales/prospects/day1` exposes the checked-in Day 1 wholesale prospect playbook as read-only context; sends still require the canonical validator + Class B approval path.
- `/ops/sales/tour` exposes the checked-in May 2026 sales-tour contract as read-only context; it classifies route prospects, verified/generic contacts, research gaps, and call tasks without sending outreach or writing HubSpot.
- Slack approval cards and closers already enforce Class B / Class C boundaries.
- Operating-memory and agent-pack work is present in the active worktree and should become the second phase once stabilized.

The missing piece is a thin MCP adapter that maps ChatGPT's `search` / `fetch` requirements onto the registry documents and, later, selected approval-request tools.

## 6. Phased Build Plan

### Phase 0 — Allowlist And Doctrine

Shipped in this change:

- Typed registry of allowed ChatGPT workspace tools.
- Auth-gated route exposing the registry.
- Tests locking read/write/prohibited boundaries.

### Phase 1 — Read-Only MCP Connector

Shipped in this change:

- `search(query)` over registry connector documents.
- `fetch(id)` for one connector document with metadata.
- Live read-model enrichment for read tools with `backingRoute` under `/api/ops/*`.
- JSON-RPC-style `initialize`, `tools/list`, and `tools/call` handling.
- Auth gate via existing ops auth OR `Authorization: Bearer <OPENAI_WORKSPACE_CONNECTOR_SECRET>`.
- No write imports, no env value reads, no approval opening.

The endpoint exposes:

- `GET /api/ops/openai-workspace-tools/mcp` for read-only discovery.
- `POST /api/ops/openai-workspace-tools/mcp` for MCP tool calls.

Current scope:

- `search(query)` over registry documents.
- `fetch(id)` for full registry-document details.
- `fetch(id)` includes a live read-model snapshot when the tool is read-only and has a safe `/api/ops/*` backing route.
- No write tools.
- No raw env values.
- Session or bearer auth through the existing ops `isAuthorized()` path.
- Dedicated connector bearer auth through `OPENAI_WORKSPACE_CONNECTOR_SECRET`.

Acceptance:

- ChatGPT can search approved tool inventory.
- ChatGPT can fetch the backing route/surface and safety notes for an approved tool.
- ChatGPT cannot call approval-request or execution tools through MCP.

### Phase 2 — Approval Request Tools

Shipped in this change:

- `request_faire_direct_invite_approval(id, requestedBy?)`
- `request_faire_follow_up_approval(id, requestedBy?)`
- `request_receipt_review_approval(receiptId)`

Implementation:

- The MCP layer proxies to the existing request-approval routes.
- It authenticates those internal calls with `CRON_SECRET`.
- If `CRON_SECRET` is missing, tools fail closed with `cron_secret_missing`.
- Returned payloads contain the route response (`approvalId`, Slack thread/permalink when the underlying route provides it).
- The MCP layer never calls closers or direct write clients.

Smoke test:

```bash
OPENAI_WORKSPACE_BASE_URL=https://www.usagummies.com \
OPENAI_WORKSPACE_CONNECTOR_SECRET=<same value as Vercel> \
node scripts/ops/smoke-openai-workspace-connector.mjs
```

The smoke is read-only unless `OPENAI_WORKSPACE_SMOKE_APPROVAL_TOOL` and
`OPENAI_WORKSPACE_SMOKE_APPROVAL_ARG` are both set. Those optional vars
open a real Slack approval and should only be used intentionally.

Exposed request-approval tools:

- `request_faire_direct_invite_approval`
- `request_faire_follow_up_approval`
- `request_receipt_review_approval`

Acceptance:

- Tool result is an approval id / Slack permalink.
- No downstream action occurs until Slack approval.
- Unknown or missing slug fails closed.

### Phase 3 — Operator Cockpit + Operating Memory

Shipped in this change:

- `/ops/openai-workspace-tools` cockpit.
- Boolean-only connector readiness (`ready`, `missing_secret`, `no_tools`).
- Grouped cards for read tools, approval-request tools, and prohibited tools.
- Browser-session probe of `GET /api/ops/openai-workspace-tools/mcp`.
- `ops.agent.packs` and `ops.operating-memory.search` are ready registry entries with backing routes.

Acceptance:

- Ben can inspect exactly what ChatGPT workspace agents may read or request.
- Blocked/prohibited actions remain visible as doctrine, not hidden.
- ChatGPT can find current doctrine / operating-memory records through the allowlisted surfaces.
- Corrections never silently mutate doctrine; they produce reviewable records.
- The cockpit is read-only and imports no money/customer/shipping write clients.

## 7. Claude / Codex Continuation Prompt

```text
You are working in /Users/ben/usagummies-storefront on main.

Goal: build Phase 1 of the OpenAI ChatGPT workspace connector.

Context:
- Phase 0 shipped `contracts/openai-workspace-agents.md`.
- Tool allowlist lives at `src/lib/ops/openai-workspace-tools/registry.ts`.
- Diagnostic route is `GET /api/ops/openai-workspace-tools`.
- ChatGPT custom connectors use MCP. For connector/deep-research compatibility,
  implement `search` and `fetch` first. Do NOT expose write tools yet.
- The worktree may contain active Claude changes around agent-packs and
  operating-memory. Do not overwrite them. If they are still uncommitted,
  keep this phase disjoint.

Build:
1. Add a minimal MCP-compatible route for read-only connector docs.
   Suggested path: `/api/ops/openai-workspace-tools/mcp`.
2. Implement POST handling for MCP tool calls or the repo's preferred MCP
   adapter pattern, but only expose:
   - `search(query)`
   - `fetch(id)`
3. Back the tools with `connectorSearchDocuments()` from the registry.
4. Auth-gate with `isAuthorized()` or a dedicated connector bearer secret if
   the existing auth path cannot work with ChatGPT custom connectors. If a new
   env var is needed, add it to readiness docs but never expose its value.
5. Tests:
   - unauthenticated requests 401
   - search returns `{ results: [{ id, title, url }] }`
   - fetch returns `{ id, title, text, url, metadata }`
   - unknown id 404 / structured MCP error
   - no route exports write behavior
   - no secret-shaped strings appear in output
   - no QBO/Gmail/ShipStation/Shopify/Faire write imports
6. Update `contracts/openai-workspace-agents.md` Phase 1 status.

Run targeted tests, `npx tsc --noEmit`, and `npm run lint`.
Commit and push only the files you changed.

Acceptance:
- ChatGPT can read/search/fetch the approved USA Gummies ops tool inventory.
- No mutations.
- No direct money/customer/shipping writes.
- Tests/typecheck/lint pass or unrelated pre-existing failures are documented.
```
