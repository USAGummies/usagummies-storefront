# `/ops` — Operator Documents

Deployable docs for humans running the USA Gummies 3.0 rebuild. Not runtime code.

## Contents

| File | Purpose |
|---|---|
| `go-live-runbook.md` | Step-by-step checklist for taking 3.0 live. Every step is code-done or manual-with-command. Start here on cutover day. |
| `cutover-sequence.md` | Hour-by-hour Monday timeline (T-24h → T+7d). Who does what, when, rollback paths. |
| `smoke-tests.md` | One-pass post-deploy verification. Every test is a curl with an expected response. |
| `make-webhooks.md` | Integration contracts. Exact curl + JSON payloads for every Make.com scenario + every external revenue/cash join. |
| `monday-checklist.md` | Original Mon/Tue/Wed operator checklist aligned to blueprint §15.4. Tick-as-you-go. |
| `blocked-items.md` | Every item requiring Ben/Rene/Drew/manual admin work, with exact commands/URLs/payloads. |

## Canonical spec

[USA GUMMIES 3.0 — RESEARCH BLUEPRINT](https://www.notion.so/3454c0c42c2e81a1b6f4f35e20595c26) §15.

## Quick links

- Code-side control plane: [`src/lib/ops/control-plane/`](../src/lib/ops/control-plane/)
- Admin HTTP routes: [`src/app/api/ops/control-plane/`](../src/app/api/ops/control-plane/)
- Admin CLI scripts: [`scripts/ops/`](../scripts/ops/)
- Canonical contracts: [`/contracts/`](../contracts/)
