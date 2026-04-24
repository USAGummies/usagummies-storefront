# AI Model Routing Canon

**Status:** CANONICAL — 2026-04-24
**Purpose:** Decide which model class may perform each USA Gummies workload. This is a routing policy, not a vendor loyalty document.

## Model Roles

| Workload | Primary | Allowed Fallback | Rule |
|---|---|---|---|
| Repo implementation, code audit, cross-tool execution | GPT-5.5 in Codex / current Codex frontier | GPT-5.4 / GPT-5.3 Codex | Use for build, verification, browser/computer-use, and final reconciliation. |
| Long-horizon critique, difficult reasoning, second opinion | Claude Opus 4.7 | Claude Sonnet 4.6 | Use only with bounded source pack, explicit budget, and independent verification. |
| Routine ops extraction, triage, classify, summarize | Claude Sonnet 4.6 or Haiku class | OpenAI mini class | Must use strict schema and low/zero creativity. |
| Customer-facing drafts | Claude Sonnet 4.6 | OpenAI GPT mini/frontier with claim gate | Draft only. Human/control-plane approval before send. |
| Financial categorization and reconciliation support | Deterministic rules first, Haiku/Sonnet fallback | None for commit | AI can suggest. QBO commits require finance doctrine and approval class. |
| Website customer support chat | OpenAI mini/frontier via `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Must stay product-claims bounded. No medical/financial promises. |
| Ops dashboard chat | OpenAI model via `OPENAI_OPS_CHAT_MODEL` | `gpt-4o-mini` | Read-only/tool-backed answers. No autonomous writes. |
| No-API browser/admin portals | Codex computer-use / browser-use | Human operator | Prefer APIs. GUI agents only for no-API surfaces with screenshots/audit. |

## Opus 4.7 Rules

Anthropic's Opus 4.7 is more literal and uses different API behavior than prior Claude models. Do not drop it into old prompts unchanged.

- Retune prompts before using Opus 4.7 for production work.
- Do not pass non-default `temperature`, `top_p`, or `top_k` when using Opus 4.7.
- Use it for bounded review/reasoning, not broad autonomous company operation.
- Every Opus 4.7 task gets a source pack, stop condition, and verifier.

## Runtime Requirements

Every AI call should record:

- `model`
- `taskProfile`
- `promptVersion`
- `hardRulesVersion`
- `sourceSystems`
- `sourceQuality`
- `confidence`
- `verificationStatus`
- `approvalClass`
- `costEstimate` when available

## Autonomy Boundary

AI may autonomously observe, classify, draft, enrich, alert, and prepare packets when source-backed. AI may not autonomously send customer email, move live money, release payment, modify QBO accounting structure, publish claims, create irreversible shipments, or change core policy unless the taxonomy says the action is Class A and the drift score for that workflow has graduated.
