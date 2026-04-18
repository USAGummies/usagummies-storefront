# `src/lib/ops/control-plane/stores`

Storage adapters for the 3.0 control plane.

## Files

| File | Role |
|---|---|
| `memory-stores.ts` | `InMemoryApprovalStore` + `InMemoryAuditStore`. Single-process fixtures for tests and local dev. Reference semantics that KV adapters must match. |
| `kv-stores.ts` | `KvApprovalStore` + `KvAuditStore`. Redis-backed (@upstash/redis), namespaced under `3.0:` to isolate from legacy keys. Throws fail-closed if KV env is missing. |
| `index.ts` | Factory: `approvalStore()` and `auditStore()` return the right backend based on `process.env.VERCEL`. Call these in production code instead of instantiating adapters directly. |

## Keyspace (KV)

```
3.0:approval:<id>                 hash-as-JSON of one ApprovalRequest
3.0:approvals:pending             SET of approval ids currently pending
3.0:approvals:agent:<agentId>     LIST of approval ids, newest-first, cap 500

3.0:audit:<id>                    hash-as-JSON of one AuditLogEntry
3.0:audit:recent                  LIST newest-first, cap 10000
3.0:audit:run:<runId>             LIST of audit ids for a single run
3.0:audit:agent:<agentId>         ZSET of audit ids scored by createdAt ms
```

All secondary indices are maintained inside a single Redis transaction with the primary write so indices cannot drift from the canonical record.

## Reference-implementation rule

Any change to the semantics of `put/get/listPending/listByAgent/append/recent/byRun/byAgent` must pass the shared test suite at `__tests__/memory-stores.test.ts` against both the in-memory and KV adapters. Tests run against the in-memory implementation on CI (no KV required); manual smoke-tests against a staging Upstash instance gate the KV path before first production use.

## Canonical spec

[USA GUMMIES 3.0 — RESEARCH BLUEPRINT](https://www.notion.so/3454c0c42c2e81a1b6f4f35e20595c26) §15.4 T5a/T5b.
