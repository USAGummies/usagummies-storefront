/**
 * Phase 37.1 — Inbox Scanner tests.
 *
 * Coverage targets per /contracts/email-agents-system.md §2.1:
 *   - Pure helpers (parseFromAddress, fromEmailDomain, matchSenderDenylist,
 *     parseRfc2822Date) behave deterministically.
 *   - Denylist matches both exact domain (`linkedin.com`) and subdomain
 *     (`mail.linkedin.com`).
 *   - The scanner writes one record per message id, marking denylist
 *     senders `received_noise` and everyone else `received`.
 *   - Re-scanning the same window does NOT re-write records (idempotent).
 *   - Cursor advances to the max observed message date on success.
 *   - Dry-run mode does NOT mutate the store or the cursor.
 *   - Gmail / KV failures degrade-soft instead of throwing.
 *   - The maxEmails cap is respected and reported.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { EmailEnvelope } from "@/lib/ops/gmail-reader";
import {
  DEFAULT_SENDER_DENYLIST,
  fromEmailDomain,
  matchSenderDenylist,
  parseFromAddress,
  parseRfc2822Date,
  runInboxScanner,
  type ScannedRecord,
} from "../inbox-scanner";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function envelope(partial: Partial<EmailEnvelope>): EmailEnvelope {
  return {
    id: "msg-1",
    threadId: "thr-1",
    from: "Buyer <buyer@store.com>",
    to: "ben@usagummies.com",
    subject: "Sample request",
    date: "Fri, 24 Apr 2026 12:00:00 -0700",
    snippet: "Can you send a sample pack?",
    labelIds: ["INBOX"],
    ...partial,
  };
}

interface FakeStore {
  data: Map<string, unknown>;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
  failSetForId?: string;
  failGetForId?: string;
}

function fakeStore(): FakeStore {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string): Promise<T | null> {
      if (this.failGetForId && key.endsWith(this.failGetForId)) {
        throw new Error("kv get failure (simulated)");
      }
      return (data.get(key) as T) ?? null;
    },
    async set(key: string, value: unknown): Promise<unknown> {
      if (this.failSetForId && key.endsWith(this.failSetForId)) {
        throw new Error("kv set failure (simulated)");
      }
      data.set(key, value);
      return value;
    },
  };
}

function fakeCursor(initial: number) {
  let value = initial;
  return {
    read: async () => value,
    write: async (next: number) => {
      value = next;
    },
    current: () => value,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("inbox-scanner / parseFromAddress", () => {
  it("extracts the bare email from a Name <addr@host> header", () => {
    expect(parseFromAddress("Acme Buyer <buyer@store.com>")).toBe(
      "buyer@store.com",
    );
  });

  it("lowercases and trims the address", () => {
    expect(parseFromAddress("  Buyer <Buyer@Store.COM>  ")).toBe(
      "buyer@store.com",
    );
  });

  it("returns the raw address when no angle brackets are present", () => {
    expect(parseFromAddress("buyer@store.com")).toBe("buyer@store.com");
  });

  it("returns empty for empty input", () => {
    expect(parseFromAddress("")).toBe("");
  });
});

describe("inbox-scanner / fromEmailDomain", () => {
  it("extracts the lowercased domain", () => {
    expect(fromEmailDomain("Buyer@Store.COM")).toBe("store.com");
  });

  it("handles subdomains correctly", () => {
    expect(fromEmailDomain("noreply@mail.linkedin.com")).toBe(
      "mail.linkedin.com",
    );
  });

  it("returns empty when @ missing", () => {
    expect(fromEmailDomain("not-an-email")).toBe("");
  });
});

describe("inbox-scanner / matchSenderDenylist", () => {
  it("hits on exact domain match", () => {
    expect(matchSenderDenylist("noise@apollo.io")).toBe("apollo.io");
  });

  it("hits on subdomain match", () => {
    expect(matchSenderDenylist("noreply@mail.linkedin.com")).toBe(
      "linkedin.com",
    );
  });

  it("returns empty for a non-denylisted sender", () => {
    expect(matchSenderDenylist("buyer@store.com")).toBe("");
  });

  it("does NOT match a domain that merely contains a denylist term", () => {
    // "linkedin" in path-like position only — not a real subdomain.
    expect(matchSenderDenylist("buyer@thelinkedinclone.com")).toBe("");
  });

  it("supports denylist override", () => {
    expect(matchSenderDenylist("buyer@store.com", ["store.com"])).toBe(
      "store.com",
    );
  });
});

describe("inbox-scanner / parseRfc2822Date", () => {
  it("parses a standard RFC 2822 date to epoch seconds", () => {
    const sec = parseRfc2822Date("Fri, 24 Apr 2026 19:00:00 +0000");
    expect(sec).toBe(Date.UTC(2026, 3, 24, 19, 0, 0) / 1000);
  });

  it("returns 0 for an unparseable date", () => {
    expect(parseRfc2822Date("not a date")).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(parseRfc2822Date("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scanner — happy path
// ---------------------------------------------------------------------------

describe("inbox-scanner / runInboxScanner happy path", () => {
  let store: FakeStore;
  let cursor: ReturnType<typeof fakeCursor>;

  beforeEach(() => {
    store = fakeStore();
    cursor = fakeCursor(Date.UTC(2026, 3, 23, 0, 0, 0) / 1000);
  });

  it("writes one record per message and tags denylist senders as noise", async () => {
    const envs = [
      envelope({
        id: "msg-001",
        from: "Buyer <buyer@store.com>",
        date: "Fri, 24 Apr 2026 19:00:00 +0000",
      }),
      envelope({
        id: "msg-002",
        from: "Apollo <noreply@apollo.io>",
        subject: "New leads available",
        date: "Fri, 24 Apr 2026 20:00:00 +0000",
      }),
      envelope({
        id: "msg-003",
        from: "Acme PR <press@acme.com>",
        subject: "Press inquiry",
        date: "Fri, 24 Apr 2026 21:00:00 +0000",
      }),
    ];

    const report = await runInboxScanner({
      cursor,
      store,
      listEmailsFn: async () => envs,
      nowEpochMs: Date.UTC(2026, 3, 24, 22, 0, 0),
    });

    expect(report.envelopesFetched).toBe(3);
    expect(report.recordsWritten).toBe(3);
    expect(report.byStatus).toEqual({ received: 2, received_noise: 1 });
    expect(report.alreadyKnown).toBe(0);
    expect(report.degraded).toBe(false);
    expect(report.cursorAdvanced).toBe(true);

    const noise = report.newRecords.find((r) => r.status === "received_noise");
    expect(noise?.noiseReason).toBe("denylist:apollo.io");

    // KV contains exactly three records under inbox:scan:*.
    const keys = Array.from(store.data.keys());
    expect(keys.sort()).toEqual([
      "inbox:scan:msg-001",
      "inbox:scan:msg-002",
      "inbox:scan:msg-003",
    ]);

    const persisted = store.data.get("inbox:scan:msg-002") as ScannedRecord;
    expect(persisted.fromEmail).toBe("noreply@apollo.io");
    expect(persisted.status).toBe("received_noise");
  });

  it("advances the cursor to the max observed RFC 2822 date", async () => {
    const envs = [
      envelope({
        id: "msg-001",
        date: "Fri, 24 Apr 2026 19:00:00 +0000",
      }),
      envelope({
        id: "msg-002",
        date: "Fri, 24 Apr 2026 22:30:00 +0000",
      }),
    ];

    await runInboxScanner({
      cursor,
      store,
      listEmailsFn: async () => envs,
      nowEpochMs: Date.UTC(2026, 3, 25, 0, 0, 0),
    });

    expect(cursor.current()).toBe(Date.UTC(2026, 3, 24, 22, 30, 0) / 1000);
  });
});

// ---------------------------------------------------------------------------
// Scanner — idempotency + dry-run
// ---------------------------------------------------------------------------

describe("inbox-scanner / runInboxScanner idempotency", () => {
  it("does NOT re-write records on a second pass over the same window", async () => {
    const store = fakeStore();
    const cursor = fakeCursor(Date.UTC(2026, 3, 23, 0, 0, 0) / 1000);
    const envs = [envelope({ id: "msg-001" })];

    const first = await runInboxScanner({
      cursor,
      store,
      listEmailsFn: async () => envs,
    });
    expect(first.recordsWritten).toBe(1);
    expect(first.alreadyKnown).toBe(0);

    const second = await runInboxScanner({
      cursor,
      store,
      listEmailsFn: async () => envs,
    });
    expect(second.recordsWritten).toBe(0);
    expect(second.alreadyKnown).toBe(1);

    // Still exactly one record persisted.
    expect(store.data.size).toBe(1);
  });

  it("dry-run does not mutate KV or advance the cursor", async () => {
    const store = fakeStore();
    const initialCursor = Date.UTC(2026, 3, 23, 0, 0, 0) / 1000;
    const cursor = fakeCursor(initialCursor);
    const envs = [
      envelope({
        id: "msg-001",
        date: "Fri, 24 Apr 2026 19:00:00 +0000",
      }),
    ];

    const report = await runInboxScanner({
      cursor,
      store,
      listEmailsFn: async () => envs,
      dryRun: true,
    });

    expect(report.recordsWritten).toBe(1);
    // newRecords still populated even in dry-run, for diagnostics.
    expect(report.newRecords).toHaveLength(1);
    // KV untouched.
    expect(store.data.size).toBe(0);
    // Cursor frozen at its initial value.
    expect(cursor.current()).toBe(initialCursor);
    expect(report.cursorAdvanced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scanner — degradation paths
// ---------------------------------------------------------------------------

describe("inbox-scanner / runInboxScanner degradation", () => {
  it("captures Gmail list failure as degraded note instead of throwing", async () => {
    const store = fakeStore();
    const cursor = fakeCursor(0);

    const report = await runInboxScanner({
      cursor,
      store,
      listEmailsFn: async () => {
        throw new Error("Gmail API 503");
      },
    });

    expect(report.degraded).toBe(true);
    expect(report.degradedNotes.some((n) => n.startsWith("gmail-list"))).toBe(
      true,
    );
    expect(report.recordsWritten).toBe(0);
    expect(report.cursorAdvanced).toBe(false);
  });

  it("captures KV set failure as degraded note + skips that record", async () => {
    const store = fakeStore();
    store.failSetForId = "msg-001";
    const cursor = fakeCursor(0);
    const envs = [
      envelope({ id: "msg-001" }),
      envelope({ id: "msg-002" }),
    ];

    const report = await runInboxScanner({
      cursor,
      store,
      listEmailsFn: async () => envs,
    });

    expect(report.degraded).toBe(true);
    expect(report.degradedNotes.some((n) => n.startsWith("kv-set"))).toBe(true);
    expect(report.recordsWritten).toBe(1);
    expect(store.data.has("inbox:scan:msg-002")).toBe(true);
    expect(store.data.has("inbox:scan:msg-001")).toBe(false);
  });

  it("respects the maxEmails cap and reports the overflow", async () => {
    const store = fakeStore();
    const cursor = fakeCursor(0);
    const envs = Array.from({ length: 7 }, (_, i) =>
      envelope({
        id: `msg-${String(i).padStart(3, "0")}`,
        date: `Fri, 24 Apr 2026 ${String(10 + i).padStart(2, "0")}:00:00 +0000`,
      }),
    );

    const report = await runInboxScanner({
      cursor,
      store,
      listEmailsFn: async () => envs,
      maxEmails: 3,
    });

    expect(report.envelopesFetched).toBe(7);
    expect(report.recordsWritten).toBe(3);
    expect(report.capExceeded).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Sanity — denylist hasn't drifted from the canonical contract
// ---------------------------------------------------------------------------

describe("inbox-scanner / DEFAULT_SENDER_DENYLIST", () => {
  it("contains every domain canonicalized in §2.1", () => {
    // Adding/removing a domain here MUST be paired with an audit of
    // /contracts/email-agents-system.md §2.1 (the canonical list).
    const required = [
      "semrush.com",
      "linkedin.com",
      "helpareporter.com",
      "apollo.io",
      "helium10.com",
      "make.com",
      "roku.com",
      "america250.org",
      "substack.com",
      "rushordertees.com",
      "ecommerceequation.com",
      "firecrawl.dev",
      "puzzle.io",
      "euna.com",
      "lendzi.com",
      "americanexpress.com",
      "rangeme.com",
      "alibaba.com",
    ];
    for (const r of required) {
      expect(DEFAULT_SENDER_DENYLIST).toContain(r);
    }
  });
});
