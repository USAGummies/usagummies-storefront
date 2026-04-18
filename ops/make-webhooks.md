# Make.com Webhooks + Integration Contracts — USA Gummies 3.0

Canonical spec: Notion blueprint §15 + [`/contracts/slack-operating.md`](../contracts/slack-operating.md).
Repo-side implementation under `src/app/api/ops/control-plane/*` and `src/app/api/ops/daily-brief/`.

This doc is the exact contract Make.com (or any scheduler) should follow. Every endpoint is bearer-`CRON_SECRET`, timing-safe, fail-closed when the secret is missing. No endpoint on this page invokes autonomous send/pay/ship.

## Environment prerequisites (Vercel)

Before any scenario is activated:

```
CRON_SECRET                  ← required for every endpoint below
PLAID_CLIENT_ID              ← daily brief cash position (optional; route degrades if missing)
PLAID_SECRET                 ← same
SLACK_BOT_TOKEN              ← outbound Slack posts (optional; degraded mode otherwise)
SLACK_SIGNING_SECRET         ← approval route verification (required before wiring approvals)
SLACK_USER_BEN / _RENE / _DREW  ← override paperclip-era defaults (optional)
KV_REST_API_URL              ← KV-backed stores (production)
KV_REST_API_TOKEN            ← same
CONTROL_PLANE_ADMIN_SECRET   ← REQUIRED for admin-tier routes (unpause). MUST differ from CRON_SECRET.
```

Check readiness first:

```bash
curl -sH "Authorization: Bearer $CRON_SECRET" \
  https://www.usagummies.com/api/ops/control-plane/health | jq .
```

Green when `ok:true` + `degraded:false`. Otherwise every `components.*` entry has an operator-actionable `detail` string.

---

## 1. Scheduled scenarios (Make.com cron)

### 1.1 Morning brief — 7:00 AM PT (15:00 UTC) weekdays

**Trigger:** Make.com Schedule module, `TZ=America/Los_Angeles`, weekdays at 07:00.

**Request:**
```
POST https://www.usagummies.com/api/ops/daily-brief?kind=morning
Authorization: Bearer <CRON_SECRET>
Content-Type: application/json

(no body required — Plaid cash position is fetched server-side)
```

**Optional body (when Make.com pre-fetches revenue):**
```json
{
  "revenueYesterday": [
    {
      "channel": "Shopify DTC",
      "amountUsd": 444.96,
      "source": {
        "system": "shopify",
        "id": "order-1016",
        "retrievedAt": "2026-04-20T06:00:00Z"
      }
    },
    {
      "channel": "Amazon",
      "amountUsd": 123.45,
      "source": {
        "system": "amazon-sp-api",
        "id": "settlement-group-xyz",
        "retrievedAt": "2026-04-20T06:00:00Z"
      }
    },
    {
      "channel": "Faire",
      "amountUsd": 0,
      "source": {
        "system": "faire",
        "retrievedAt": "2026-04-20T06:00:00Z"
      }
    }
  ],
  "cashPosition": {
    "amountUsd": 12345.67,
    "source": {
      "system": "plaid",
      "retrievedAt": "2026-04-20T06:00:00Z"
    }
  }
}
```

**Success:** `200 { ok: true, degraded: false, brief: { meta, text, blocks }, post: { ok: true, ts: "1729..." } }`.
**Degraded (expected until Slack + stores are seeded):** `200 { ok: true, degraded: true, degradedReasons: [...] }`. **Alarm only when `ok:false`.**

### 1.2 End-of-day wrap — 6:00 PM PT (02:00 UTC next day) weekdays

Same as morning brief, kind parameter flipped:
```
POST https://www.usagummies.com/api/ops/daily-brief?kind=eod
```

### 1.3 Weekly drift audit — Sunday 8:00 PM PT (Mon 04:00 UTC)

```
POST https://www.usagummies.com/api/ops/control-plane/drift-audit
Authorization: Bearer <CRON_SECRET>
```

Optional query: `?sampleSize=10&windowDays=7`.

**Success:** `200 { ok, degraded, enforcement: { violationStore, correctionStore, pauseSink }, scorecard: { ... } }`. Scorecard is also persisted to the audit store (the daily brief picks up the summary automatically). Alarm on `ok:false` or when `scorecard.enforcement.mode === "partial"` (some pauses failed to persist).

---

## 2. Event-driven endpoints (Make.com can call these as needed)

### 2.1 Append a violation

Typical triggers: Viktor's self-check fires, a drift audit validator returns "wrong", or a human reviewer tags a Slack message.

```
POST https://www.usagummies.com/api/ops/control-plane/violations
Authorization: Bearer <CRON_SECRET>
Content-Type: application/json

{
  "agentId": "viktor",
  "division": "sales",
  "kind": "missing_citation",
  "detail": "Weekly digest claimed pipeline $14K without a HubSpot retrievedAt",
  "detectedBy": "self-check",
  "remediation": "Updated Viktor boot ritual"
}
```

Allowed `kind`: `fabricated_data`, `unapproved_write`, `prohibited_action`, `stale_data`, `missing_citation`, `duplicate_output`, `wrong_channel`.
Allowed `detectedBy`: `self-check`, `drift-audit`, `human-correction`.

### 2.2 Append a correction

Triggers: Ben, Rene, or Drew clicks a "correct" action in Slack or submits via a form.

```
POST https://www.usagummies.com/api/ops/control-plane/corrections
{
  "agentId": "viktor",
  "division": "sales",
  "correctedBy": "Ben",
  "field": "deal_stage",
  "wrongValue": "Sample Requested",
  "correctValue": "Sample Shipped",
  "note": "Tracking in thread was missed"
}
```

Allowed `correctedBy`: `Ben`, `Rene`, `Drew`.

### 2.3 Unpause an agent — ADMIN-TIER auth

Unpause is governance-critical (blueprint §6.2 — "Ben is the only human who may unpause"). This route does NOT accept `CRON_SECRET`. It requires a **separate** admin secret sent on a **different** header, and ignores any caller-supplied `actor` — the audit entry always records actorId = "Ben".

```
POST https://www.usagummies.com/api/ops/control-plane/unpause
X-Admin-Authorization: Bearer <CONTROL_PLANE_ADMIN_SECRET>
Content-Type: application/json

{
  "agentId": "viktor",
  "reason": "Reviewed drift-audit sc-xxx; prompts tightened"
}
```

- 401 if `X-Admin-Authorization` is missing or wrong OR if `CONTROL_PLANE_ADMIN_SECRET` is unset server-side.
- 401 if the caller sends only `Authorization: Bearer <CRON_SECRET>` — cron-tier callers cannot unpause.
- 409 if the agent isn't paused.
- 200 + `actor: "Ben"` on success. A `runtime.agent-unpaused` human audit entry is written regardless of what the body contained.

**Do not wire this into a scheduled Make.com scenario.** Unpause is a manual, audited human action.

---

## 3. Read-only inspection (cron status panels, dashboards)

| Purpose | Call |
|---|---|
| Health + readiness | `GET /api/ops/control-plane/health` |
| Currently paused agents | `GET /api/ops/control-plane/paused` |
| Recent drift audits | `GET /api/ops/control-plane/scorecards?limit=5` |
| Pending approvals | `GET /api/ops/control-plane/approvals?mode=pending` |
| Approvals by agent | `GET /api/ops/control-plane/approvals?mode=by-agent&agentId=viktor` |
| Recent audit stream | `GET /api/ops/control-plane/audit?mode=recent&limit=50` |
| Audit by run id | `GET /api/ops/control-plane/audit?mode=by-run&runId=...` |
| Audit by agent | `GET /api/ops/control-plane/audit?mode=by-agent&agentId=viktor&sinceDays=7` |
| Violations window | `GET /api/ops/control-plane/violations?windowDays=7&agentId=viktor` |
| Corrections count | `GET /api/ops/control-plane/corrections?windowDays=7` |

---

## 4. Integration contracts for external joins the route does NOT yet fetch

These are called out explicitly so nobody assumes a silent green. The daily brief composer renders "External revenue integrations not wired" when no `revenueYesterday` body is supplied — that is the correct contract until Make.com starts posting pre-fetched data.

### 4.1 Shopify DTC revenue (yesterday)

**Decision:** Make.com owns this fetch.
**How:** Shopify → "Search Orders" module scoped to yesterday in `America/Los_Angeles`, `financial_status=paid`. Sum `total_price_usd`.
**Emit in the daily-brief POST body:**
```json
{ "channel": "Shopify DTC", "amountUsd": <sum>, "source": { "system": "shopify", "id": "orders-<date>", "retrievedAt": "<iso>" } }
```
**Faire sub-stream:** detect order emails containing `@relay.faire.com` and emit as a separate `{ "channel": "Faire", ... }` entry. Shopify returns these as normal orders — it's the email pattern that segments them.

### 4.2 Amazon SP-API settlements (yesterday)

**Decision:** Make.com calls the existing storefront route (it already decomposes settlements).
**How:** `GET https://www.usagummies.com/api/ops/amazon/settlements?action=revenue&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` with `Authorization: Bearer <CRON_SECRET>`. Takes 30–120s to complete — set Make's timeout accordingly.
**Emit:**
```json
{ "channel": "Amazon", "amountUsd": <revenue_total>, "source": { "system": "amazon-sp-api", "id": "<financialEventGroupId>", "retrievedAt": "<iso>" } }
```
If the settlement window isn't closed yet: emit `{ "channel": "Amazon", "amountUsd": null, "unavailableReason": "Settlement window not yet closed" }` — do not estimate.

### 4.3 Plaid cash (BoA checking 7020)

**Decision:** **Already wired server-side.** Do NOT pre-fetch in Make.com unless you need to override.
**Route behavior:** when no `cashPosition` body override is supplied, the daily-brief route calls `getBalances()` directly and picks the account whose `name` or `officialName` contains "checking" (falls back to the first depository account).
**Override path (for rotation / testing):** pass `cashPosition: { amountUsd, source }` in the POST body.

### 4.4 HubSpot pipeline (for future "deals moved" line)

**Decision:** Make.com owns. Not yet surfaced by the composer. When it is, the expected payload extension will be:
```json
{ "pipelineYesterday": { "newDeals": 3, "stageMoves": 5, "closedWon": 0, "source": { "system": "hubspot", "retrievedAt": "<iso>" } } }
```
Not accepted by the current endpoint — no-op if supplied. Tracked for a future commit when volume justifies the display.

---

## 5. Contract rules (all scenarios)

1. Every call uses `Authorization: Bearer <CRON_SECRET>`. No alternative auth accepted.
2. Every `amountUsd` in the body either has a `source` with `retrievedAt` or `amountUsd: null` with an `unavailableReason`. Never a naked number. This is enforced by the composer: an entry with `amountUsd` set but no `source` will render without attribution and violate governance §1 non-negotiable #2.
3. Retries: Make scenarios should retry on 5xx. Retry should NOT re-fetch the upstream source — re-send the same body so idempotency is preserved.
4. Timeouts: set Make scenario timeouts ≥ 30s for daily brief (Plaid call + composition); ≥ 180s for Amazon settlements pre-fetch; ≥ 120s for drift audit (sampling + Slack mirror).
5. Alerting: alarm only on HTTP `5xx` or `!body.ok`. `degraded: true` is a normal operational state until all P0 manual items are complete.
