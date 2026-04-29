/**
 * Tests for GET /api/ops/operating-memory/recent — backing route for
 * Codex's `ops.operating-memory.search` MCP tool.
 *
 * Verifies:
 *   - 401 on missing/wrong CRON_SECRET
 *   - happy path returns entries from injected store
 *   - kind filter routes through byKind() vs recent()
 *   - limit clamps to MAX_LIMIT
 *   - bodies are NOT included in response (privacy / payload)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryOperatingMemoryStore,
  __resetOperatingMemoryStore,
  __setOperatingMemoryStoreForTest,
} from "@/lib/ops/operating-memory/store";
import type { OperatingMemoryEntry } from "@/lib/ops/operating-memory/types";

const PRIOR_CRON = process.env.CRON_SECRET;
const FAKE_SECRET = "test-cron-secret-12345";

function entry(overrides: Partial<OperatingMemoryEntry> = {}): OperatingMemoryEntry {
  return {
    id: "id-1",
    fingerprint: "f".repeat(64),
    kind: "decision",
    tags: [],
    summary: "test summary",
    body: "the full body which should NOT appear in the route response",
    source: { sourceSystem: "slack", sourceRef: "C1:ts1" },
    actorId: "Ben",
    actorType: "human",
    capturedAt: "2026-04-29T12:00:00Z",
    recordedAt: "2026-04-29T12:00:00Z",
    division: "executive-control",
    threadTag: "transcript:abc12345",
    confidence: 1,
    redactedKinds: [],
    ...overrides,
  };
}

function req(query = ""): Request {
  return new Request(`http://localhost/api/ops/operating-memory/recent${query}`, {
    method: "GET",
    headers: { authorization: `Bearer ${FAKE_SECRET}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = FAKE_SECRET;
});

afterEach(() => {
  if (PRIOR_CRON !== undefined) process.env.CRON_SECRET = PRIOR_CRON;
  else delete process.env.CRON_SECRET;
  __resetOperatingMemoryStore();
});

describe("GET /api/ops/operating-memory/recent", () => {
  it("401s when CRON_SECRET missing", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("401s when bearer doesn't match", async () => {
    const bad = new Request("http://localhost/api/ops/operating-memory/recent", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const { GET } = await import("../route");
    const res = await GET(bad);
    expect(res.status).toBe(401);
  });

  it("returns recent entries (no kind filter)", async () => {
    const store = new InMemoryOperatingMemoryStore();
    await store.put(entry({ fingerprint: "1".repeat(64), kind: "correction" }));
    await store.put(entry({ fingerprint: "2".repeat(64), kind: "decision" }));
    __setOperatingMemoryStoreForTest(store);

    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      filter: { kind: string | null; limit: number };
      count: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(body.ok).toBe(true);
    expect(body.filter.kind).toBeNull();
    expect(body.count).toBe(2);
  });

  it("filters by kind when ?kind= provided", async () => {
    const store = new InMemoryOperatingMemoryStore();
    await store.put(entry({ fingerprint: "a".repeat(64), kind: "correction" }));
    await store.put(entry({ fingerprint: "b".repeat(64), kind: "decision" }));
    await store.put(entry({ fingerprint: "c".repeat(64), kind: "correction" }));
    __setOperatingMemoryStoreForTest(store);

    const { GET } = await import("../route");
    const res = await GET(req("?kind=correction"));
    const body = await res.json() as {
      filter: { kind: string };
      count: number;
      entries: Array<{ kind: string }>;
    };
    expect(body.filter.kind).toBe("correction");
    expect(body.count).toBe(2);
    expect(body.entries.every((e) => e.kind === "correction")).toBe(true);
  });

  it("ignores invalid kind (falls back to all)", async () => {
    const store = new InMemoryOperatingMemoryStore();
    await store.put(entry());
    __setOperatingMemoryStoreForTest(store);

    const { GET } = await import("../route");
    const res = await GET(req("?kind=invalid-kind"));
    const body = await res.json() as { filter: { kind: string | null } };
    expect(body.filter.kind).toBeNull();
  });

  it("clamps limit to MAX_LIMIT (200)", async () => {
    const store = new InMemoryOperatingMemoryStore();
    __setOperatingMemoryStoreForTest(store);

    const { GET } = await import("../route");
    const res = await GET(req("?limit=99999"));
    const body = await res.json() as { filter: { limit: number } };
    expect(body.filter.limit).toBe(200);
  });

  it("entry shape excludes the redacted body (privacy/payload)", async () => {
    const store = new InMemoryOperatingMemoryStore();
    await store.put(
      entry({
        fingerprint: "p".repeat(64),
        body: "REDACTED-BODY-CONTENT-SHOULD-NOT-LEAK",
        summary: "non-leaky summary",
      }),
    );
    __setOperatingMemoryStoreForTest(store);

    const { GET } = await import("../route");
    const res = await GET(req());
    const text = await res.text();
    expect(text).not.toContain("REDACTED-BODY-CONTENT-SHOULD-NOT-LEAK");
    expect(text).toContain("non-leaky summary");
  });
});
