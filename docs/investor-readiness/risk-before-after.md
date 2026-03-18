# Risk Before vs After

| Severity | Area | Before | After | Status |
|---|---|---|---|---|
| High | Admin auth fallback | Hardcoded fallback admin path in adapter | Env-based break-glass credentials only (`BREAK_GLASS_*`) | Closed |
| High | Sensitive API authz | Inconsistent role checks across ops/agentic APIs | Middleware and route-level RBAC gates, fail-closed on unauthorized roles | Closed |
| High | Reply approval attribution | Static approver labels | Session-bound actor metadata + immutable `actionId` audit records | Closed |
| High | Command center truthfulness | Cloud checks could report healthy despite unverifiable state | Tri-state checks (`pass/fail/unknown`) + degraded fallback on unknown | Closed |
| High | Command center config integrity | Business IDs/thresholds hardcoded in route logic | Centralized config registry with validation errors surfaced | Closed |
| Medium | Browser security policy | Missing enterprise header baseline | CSP + frame/type/referrer/permissions protections in global headers | Closed |
| Medium | SEO parser correctness | `robots.txt` host field used full URL | Host now emits hostname only | Closed |
| Medium | Deployment alias drift | Alias state appeared ambiguous across recent deployments | Canonical production deployment documented and system aliases rebound | Closed (custom-domain writes blocked by permissions) |
| Medium | Command center freshness confidence | No explicit stale thresholds in UI | Freshness SLA table with stale/unknown state and thresholds | Closed |
| Medium | Notion workspace governance | Duplicate logic pages/user records, mixed operational paths | Reorg design documented; execution blocked pending Notion re-auth | In progress |
