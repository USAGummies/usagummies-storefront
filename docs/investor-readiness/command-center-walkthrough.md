# Command Center Walkthrough (Investor Narrative)

## 1) What this page is
- `/command-center` is the operational control surface for the agentic GTM engine.
- It shows live system health, queue controls, KPI output, and scheduler/runtime evidence.

## 2) What each major panel means
- **Reply Attention Queue**: human authorization gate for outbound responses; no auto-send without operator approval.
- **System Gate**: critical infrastructure checks (dashboard process, scheduler visibility, Notion health, self-heal freshness, recent activity, config validity).
- **Freshness SLA**: explicit staleness thresholds for heartbeat, self-heal, event stream, queue freshness, and weekly goals sync.
- **Operator Control**: supervision posture (manual oversight cadence, reply lock state, no-resend guard freshness, training profile freshness).
- **Sales KPI Snapshot**: same-day and cumulative pipeline throughput and deliverability risk metrics.
- **Proof Of Life + Scheduler Evidence + Watchdog**: runtime telemetry and process audit evidence.

## 3) Governance protections
- RBAC enforced server-side before command center data is returned.
- Sensitive queue actions restricted to `admin`/`employee` roles.
- Action responses include immutable action IDs and actor identity metadata.
- Status transitions are append-logged for after-action review.

## 4) Human-gated operations
- Reply handling remains explicitly human-approved.
- “Edit and send” path is still role-gated and actor-attributed.
- System state marks unknown verification as degraded instead of silently passing.

## 5) Reliability posture to communicate
- Health states are now truth-preserving (`unknown` is visible, not hidden).
- Freshness SLA makes stale telemetry explicit in red-state behavior.
- Config validation fails visible checks if required operational IDs are missing.
