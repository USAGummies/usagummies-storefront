# Codex Prompt 65: Chat Endpoint Hardening — Cost, Sources, Confidence

## Objective

Harden the chat endpoint (`/api/ops/abra/chat/route.ts`) with six targeted fixes: department-tagged cost logging, budget alert triggering, source deduplication, confidence-gated early returns, cost context enrichment, and max_tokens model adaptation.

## Background

The chat endpoint compiles and runs. The smoke test passes auth (7/8 endpoints green — the chat 500 is an Anthropic billing issue, not a code bug). But runtime analysis found these gaps:

1. `logAICost()` is called WITHOUT a `department` parameter — breaking per-department cost rollups
2. `checkBudgetAndAlert()` is never called after logging — budget alerts never fire
3. Sources returned to the client include duplicates (same brain entry appearing in hot+warm+cold tiers)
4. Low-confidence queries (sparse/old sources) still trigger a full Claude call instead of asking the user to teach Abra
5. Cost context in the system prompt only shows totals, not provider/endpoint breakdown
6. `max_tokens` is hardcoded to 900 regardless of whether Haiku or Sonnet is selected

## Task 1: Add department to cost logging

In `src/app/api/ops/abra/chat/route.ts`, find the `logAICost()` call inside `generateClaudeReply()` (around line 818). It currently looks like:

```typescript
void logAICost({
  model: selectedModel,
  provider: "anthropic",
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  endpoint: "chat",
});
```

Change it to include `department`:

```typescript
void logAICost({
  model: selectedModel,
  provider: "anthropic",
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  endpoint: "chat",
  department: detectedDepartment || undefined,
});
```

To make `detectedDepartment` available inside `generateClaudeReply`, either:
- Pass it as a parameter to the function, OR
- Detect it at the top of the POST handler using `detectDepartment(message)` from `@/lib/ops/department-playbooks` (already imported) and thread it through

The `detectDepartment()` function already exists and returns a department string or null based on keywords in the message.

## Task 2: Call checkBudgetAndAlert after cost logging

In `src/lib/ops/abra-cost-tracker.ts`, there's a `checkBudgetAndAlert()` function that checks monthly spend against the $1K budget and posts Slack alerts at 50%/80%/95% thresholds.

After the `logAICost()` call in the chat route, add a fire-and-forget call:

```typescript
void logAICost({ ... });
void checkBudgetAndAlert().catch(() => {}); // fire-and-forget budget check
```

If `checkBudgetAndAlert` is not exported from `abra-cost-tracker.ts`, export it.

## Task 3: Deduplicate sources in the response

The chat route returns `sources` to the client by mapping `tieredResults.all`. If the same brain entry appears in multiple tiers (hot + warm, or warm + cold), it shows up multiple times.

Find where sources are built for the response (look for `tieredResults.all.map(` or similar). Add deduplication:

```typescript
// Deduplicate sources by ID
const seenIds = new Set<string>();
const uniqueSources = tieredResults.all.filter((r) => {
  const id = r.id || r.content?.substring(0, 50);
  if (seenIds.has(id)) return false;
  seenIds.add(id);
  return true;
});
```

Use `uniqueSources` instead of `tieredResults.all` when building the response sources array.

Also in `src/lib/ops/abra-source-provenance.ts`, the `extractProvenance()` function deduplicates `source_tables` via Set but NOT `source_ids`. Fix:

```typescript
// Before:
source_ids: results.map((r) => r.id).filter(Boolean),

// After:
source_ids: [...new Set(results.map((r) => r.id).filter(Boolean))],
```

## Task 4: Confidence-gated early return

Currently, `computeConfidence()` is called inside `generateClaudeReply` but the result is only used to add a hint to the user prompt. Low-confidence queries still generate a full Claude response.

Add an early return check BEFORE the Claude API call. Find where confidence is computed (inside `generateClaudeReply`). After computing confidence, add:

```typescript
const confidence = computeConfidence(tieredResults.all, message);

// If confidence is very low and we have almost no sources, don't waste a Claude call
if (confidence < 0.2 && tieredResults.all.length < 2) {
  return {
    reply: "I don't have enough information to answer that confidently. Could you teach me? Use the format: `teach: [topic] — [what I should know]`",
    sources: [],
    confidence,
    model: selectedModel,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
```

**Important**: Only gate on VERY low confidence (< 0.2) AND sparse results (< 2 sources). Normal low-confidence (0.2-0.5) should still call Claude but include the "ask user" hint.

Make sure the return type matches what the caller expects. The `generateClaudeReply` function should return an object with at minimum `{ reply, sources, confidence }`. Check the existing return type and match it.

## Task 5: Enrich cost context in system prompt

In `src/app/api/ops/abra/chat/route.ts`, find `fetchCostSummary()` (around line 397). It calls `getMonthlySpend()` which returns `{ total, budget, remaining, pctUsed, byProvider, byEndpoint }`.

Currently only `total`, `budget`, `remaining`, and `pctUsed` are passed to the system prompt builder. Add the breakdowns:

In `src/lib/ops/abra-system-prompt.ts`, find the `AbraCostContext` type. Add optional fields:

```typescript
export type AbraCostContext = {
  total: number;
  budget: number;
  remaining: number;
  pctUsed: number;
  byProvider?: Record<string, number>;
  byEndpoint?: Record<string, number>;
};
```

In `buildAbraSystemPrompt`, if `costSummary.byProvider` or `costSummary.byEndpoint` exist, include a brief breakdown in the cost section of the prompt:

```
## AI Cost This Month
- Total: $X.XX / $1,000 budget (X% used)
- By provider: Anthropic $X.XX, OpenAI $X.XX
- By endpoint: chat $X.XX, research $X.XX, embedding $X.XX
```

Back in the chat route's `fetchCostSummary()`, pass `byProvider` and `byEndpoint` from the `getMonthlySpend()` result into the context object.

## Task 6: Adapt max_tokens based on model

In `generateClaudeReply()`, find the Claude API call (the `fetch` to `https://api.anthropic.com/v1/messages`). The `max_tokens` is hardcoded to 900.

Change it to adapt based on model:

```typescript
const maxTokens = selectedModel.includes("haiku") ? 500 : 900;
```

Use `maxTokens` in the request body instead of the hardcoded 900.

## Files to modify

- `src/app/api/ops/abra/chat/route.ts` — Tasks 1, 2, 3, 4, 5, 6
- `src/lib/ops/abra-system-prompt.ts` — Task 5 (AbraCostContext type + prompt section)
- `src/lib/ops/abra-source-provenance.ts` — Task 3 (deduplicate source_ids)
- `src/lib/ops/abra-cost-tracker.ts` — Task 2 (export checkBudgetAndAlert if needed)

## Verification

1. `npm run build` — must pass with 0 errors
2. Search for `logAICost` calls — all should include `department` when available
3. Search for `checkBudgetAndAlert` — should be called after cost logging
4. Search for source deduplication — `seenIds` Set or equivalent must exist
5. Search for confidence threshold — `confidence < 0.2` gate before Claude call
6. Search for `max_tokens` — should reference `maxTokens` variable, not hardcoded 900

## Commit message

```
Abra Prompt 65: chat endpoint hardening — cost, sources, confidence

- Add department parameter to logAICost calls for per-dept cost rollups
- Call checkBudgetAndAlert() fire-and-forget after cost logging
- Deduplicate sources in response and provenance logging
- Add confidence-gated early return for very low confidence (<0.2) queries
- Enrich cost context in system prompt with provider/endpoint breakdown
- Adapt max_tokens based on model selection (Haiku: 500, Sonnet: 900)
```
