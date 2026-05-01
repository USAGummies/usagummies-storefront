/**
 * Phase 37.7 — Spam Cleaner tests.
 *
 * Coverage targets per /contracts/email-agents-system.md §2.5d + §2.8:
 *   - Subject pattern detection (positive + negative).
 *   - Safety pattern detection (invoice / W-9 / sample request / PO
 *     / order confirmation / quote — never trash regardless).
 *   - HARD STOPS:
 *       a. Whale-domain match → never trash (defense-in-depth).
 *       b. HubSpot prior engagement → never trash (§7.13 permanent).
 *       c. Subject safety pattern → never trash.
 *       d. Has attachment → never trash.
 *   - Eligibility: denylist + noise subject + no engagement + no
 *     attachment → eligible (single happy path + multiple denylist
 *     domains).
 *   - dryRun honored (default behavior — eligible records get
 *     `deleted_dry_run`, no trashFn called).
 *   - SPAM_CLEANER_AUTO_DELETE env disables dry-run when true AND
 *     dryRun is undefined.
 *   - Real trash path: trashFn returns ok → outcome=deleted; returns
 *     error → outcome=delete_failed + degraded.
 *   - Per-domain digest counts.
 *   - Daily KV log written to spam-cleaner:log:<YYYY-MM-DD>.
 *   - renderSpamCleanerDigest collapses cleanly + lists per-domain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  evaluateSpamDelete,
  matchSafetyPattern,
  matchSubjectPattern,
  renderSpamCleanerDigest,
  runSpamCleaner,
  SPAM_SAFETY_PATTERNS,
  SPAM_SUBJECT_PATTERNS,
  type SpamCleanerReport,
} from "../spam-cleaner";
import type { ClassifiedRecord } from "../classifier";
import type { ScanStatus } from "../inbox-scanner";

type Record = ClassifiedRecord & {
  hasAttachment?: boolean;
  hubspotHasEngagement?: boolean;
};

function rec(partial: Partial<Record> = {}): Record {
  return {
    messageId: "msg-1",
    threadId: "thr-1",
    fromEmail: "promo@semrush.com",
    fromHeader: "Semrush <promo@semrush.com>",
    subject: "Last call: 25% off your subscription",
    date: "Fri, 24 Apr 2026 12:00:00 -0700",
    snippet: "",
    labelIds: ["INBOX"],
    status: "classified" as ScanStatus,
    noiseReason: "",
    observedAt: "2026-04-30T20:00:00.000Z",
    category: "Z_obvious_spam",
    confidence: 0.6,
    ruleId: "scanner-noise",
    classificationReason: "Denylist sender",
    classifiedAt: "2026-04-30T20:01:00.000Z",
    ...partial,
  };
}

interface FakeStore {
  data: Map<string, unknown>;
  set(key: string, value: unknown): Promise<unknown>;
}
function fakeStore(): FakeStore {
  const data = new Map<string, unknown>();
  return {
    data,
    async set(key: string, value: unknown) {
      data.set(key, value);
      return value;
    },
  };
}

describe("spam-cleaner / matchSubjectPattern", () => {
  it.each([
    ["Last call: 25% off!", true],
    ["Unsubscribe instructions", true],
    ["3-day sale event", true],
    ["View this email online", true],
    ["Customers often buy these", true],
    ["Earn rewards on your next order", true],
    ["Dinner with the team Friday?", false],
    ["Re: your sample request", false],
  ])('"%s" → %s', (subject, expected) => {
    const m = matchSubjectPattern(subject);
    expect(Boolean(m)).toBe(expected);
  });
});

describe("spam-cleaner / matchSafetyPattern", () => {
  it.each([
    ["Invoice INV-001 attached", true],
    ["Sample request from Christmas Mouse", true],
    ["W-9 form for vendor setup", true],
    ["Purchase Order #4521", true],
    ["PO-002 follow-up", true],
    ["Quote for next month", true],
    ["Random promo email", false],
    ["Last call sale", false],
  ])('"%s" → %s', (subject, expected) => {
    const m = matchSafetyPattern(subject);
    expect(Boolean(m)).toBe(expected);
  });
});

describe("spam-cleaner / evaluateSpamDelete HARD STOPS", () => {
  it("never trashes whale-domain senders", () => {
    const r = rec({
      fromEmail: "promo@buc-ees.com",
      subject: "Unsubscribe to save",
    });
    const d = evaluateSpamDelete(r);
    expect(d.eligible).toBe(false);
    expect(d.outcome).toBe("skipped_whale");
  });

  it("never trashes when HubSpot has engagement", () => {
    const r = rec({ hubspotHasEngagement: true });
    const d = evaluateSpamDelete(r);
    expect(d.eligible).toBe(false);
    expect(d.outcome).toBe("skipped_engagement");
  });

  it("never trashes when subject contains a SAFETY phrase", () => {
    const r = rec({ subject: "Your invoice INV-001 is attached" });
    const d = evaluateSpamDelete(r);
    expect(d.eligible).toBe(false);
    expect(d.outcome).toBe("skipped_safety");
  });

  it("never trashes when message has an attachment", () => {
    const r = rec({ hasAttachment: true });
    const d = evaluateSpamDelete(r);
    expect(d.eligible).toBe(false);
    expect(d.outcome).toBe("skipped_attachment");
  });
});

describe("spam-cleaner / evaluateSpamDelete eligibility", () => {
  it("eligible when denylist + noise subject + no engagement + no attachment", () => {
    const r = rec({
      fromEmail: "promo@semrush.com",
      subject: "Last call: 25% off",
    });
    const d = evaluateSpamDelete(r);
    expect(d.eligible).toBe(true);
    expect(d.denylistMatch).toBe("semrush.com");
  });

  it("not eligible when from-domain not on denylist", () => {
    const r = rec({
      fromEmail: "buyer@christmasmouse.com",
      subject: "Last call: 25% off",
    });
    const d = evaluateSpamDelete(r);
    expect(d.eligible).toBe(false);
    expect(d.outcome).toBe("skipped_not_eligible");
  });

  it("not eligible when subject doesn't match noise pattern", () => {
    const r = rec({
      fromEmail: "team@apollo.io",
      subject: "Quick question about your B2B campaign",
    });
    const d = evaluateSpamDelete(r);
    expect(d.eligible).toBe(false);
    expect(d.denylistMatch).toBe("apollo.io");
  });
});

describe("spam-cleaner / runSpamCleaner dry-run behavior", () => {
  beforeEach(() => {
    delete process.env.SPAM_CLEANER_AUTO_DELETE;
  });
  afterEach(() => {
    delete process.env.SPAM_CLEANER_AUTO_DELETE;
  });

  it("default behavior: dryRun=true (no trashFn invoked)", async () => {
    const store = fakeStore();
    const trashFn = vi.fn().mockResolvedValue({ ok: true, id: "msg-1" });
    const records = [rec({ messageId: "msg-001" })];

    const report = await runSpamCleaner({
      records,
      trashFn,
      store,
    });

    expect(report.examined).toBe(1);
    expect(report.deletedDryRun).toBe(1);
    expect(report.deleted).toBe(0);
    expect(trashFn).not.toHaveBeenCalled();
    // Result outcome reflects the dry-run downgrade.
    expect(report.results[0].decision.outcome).toBe("deleted_dry_run");
  });

  it("explicit dryRun=true blocks trash even when env enables auto-delete", async () => {
    process.env.SPAM_CLEANER_AUTO_DELETE = "true";
    const store = fakeStore();
    const trashFn = vi.fn().mockResolvedValue({ ok: true, id: "msg-1" });

    const report = await runSpamCleaner({
      records: [rec({ messageId: "msg-001" })],
      trashFn,
      store,
      dryRun: true, // explicit beats env
    });

    expect(report.deletedDryRun).toBe(1);
    expect(report.deleted).toBe(0);
    expect(trashFn).not.toHaveBeenCalled();
  });

  it("dryRun resolves to true when env not set (default safe)", async () => {
    const store = fakeStore();
    const trashFn = vi.fn().mockResolvedValue({ ok: true, id: "msg-1" });

    const report = await runSpamCleaner({
      records: [rec({ messageId: "msg-001" })],
      trashFn,
      store,
    });

    expect(trashFn).not.toHaveBeenCalled();
    expect(report.deletedDryRun).toBe(1);
  });

  it("env=true + dryRun unset → real trash call", async () => {
    process.env.SPAM_CLEANER_AUTO_DELETE = "true";
    const store = fakeStore();
    const trashFn = vi.fn().mockResolvedValue({ ok: true, id: "msg-001" });

    const report = await runSpamCleaner({
      records: [rec({ messageId: "msg-001" })],
      trashFn,
      store,
    });

    expect(trashFn).toHaveBeenCalledWith("msg-001");
    expect(report.deleted).toBe(1);
    expect(report.deletedDryRun).toBe(0);
    expect(report.results[0].decision.outcome).toBe("deleted");
  });
});

describe("spam-cleaner / runSpamCleaner real trash path", () => {
  beforeEach(() => {
    process.env.SPAM_CLEANER_AUTO_DELETE = "true";
  });
  afterEach(() => {
    delete process.env.SPAM_CLEANER_AUTO_DELETE;
  });

  it("trashFn returns error → outcome=delete_failed + degraded", async () => {
    const store = fakeStore();
    const trashFn = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "gmail 403 forbidden" });

    const report = await runSpamCleaner({
      records: [rec({ messageId: "msg-001" })],
      trashFn,
      store,
    });

    expect(report.deleteFailed).toBe(1);
    expect(report.deleted).toBe(0);
    expect(report.degraded).toBe(true);
    expect(report.degradedNotes[0]).toContain("trash(msg-001)");
    expect(report.results[0].decision.outcome).toBe("delete_failed");
  });

  it("counts byDomain for the daily digest", async () => {
    const store = fakeStore();
    const trashFn = vi.fn().mockResolvedValue({ ok: true, id: "trashed" });

    const records: Record[] = [
      rec({ messageId: "m1", fromEmail: "a@semrush.com", fromHeader: "a@semrush.com" }),
      rec({ messageId: "m2", fromEmail: "b@semrush.com", fromHeader: "b@semrush.com" }),
      rec({ messageId: "m3", fromEmail: "c@apollo.io", fromHeader: "c@apollo.io" }),
    ];

    const report = await runSpamCleaner({ records, trashFn, store });

    expect(report.byDomain["semrush.com"]).toBe(2);
    expect(report.byDomain["apollo.io"]).toBe(1);
    expect(report.deleted).toBe(3);
  });

  it("persists daily log to KV under spam-cleaner:log:<YYYY-MM-DD>", async () => {
    const store = fakeStore();
    const trashFn = vi.fn().mockResolvedValue({ ok: true, id: "trashed" });
    const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0); // 2026-05-01

    await runSpamCleaner({
      records: [rec()],
      trashFn,
      store,
      nowEpochMs: nowMs,
    });

    expect(store.data.has("spam-cleaner:log:2026-05-01")).toBe(true);
    const log = store.data.get("spam-cleaner:log:2026-05-01") as {
      date: string;
      examined: number;
      deleted: number;
    };
    expect(log.date).toBe("2026-05-01");
    expect(log.examined).toBe(1);
    expect(log.deleted).toBe(1);
  });
});

describe("spam-cleaner / runSpamCleaner skip tally", () => {
  it("counts each skip outcome cleanly", async () => {
    const store = fakeStore();
    const records: Record[] = [
      rec({
        messageId: "whale",
        fromEmail: "x@buc-ees.com",
        fromHeader: "x@buc-ees.com",
      }),
      rec({ messageId: "engaged", hubspotHasEngagement: true }),
      rec({
        messageId: "safety",
        subject: "Invoice INV-001 attached",
      }),
      rec({ messageId: "attached", hasAttachment: true }),
      rec({
        messageId: "not-eligible",
        fromEmail: "buyer@christmasmouse.com",
        fromHeader: "buyer@christmasmouse.com",
      }),
    ];
    const report = await runSpamCleaner({ records, store, dryRun: true });

    expect(report.examined).toBe(5);
    expect(report.skippedWhale).toBe(1);
    expect(report.skippedEngagement).toBe(1);
    expect(report.skippedSafety).toBe(1);
    expect(report.skippedAttachment).toBe(1);
    expect(report.skippedNotEligible).toBe(1);
    expect(report.deletedDryRun).toBe(0);
    expect(report.deleted).toBe(0);
  });
});

describe("spam-cleaner / renderSpamCleanerDigest", () => {
  it("collapses to a one-liner when nothing fired", () => {
    const empty: SpamCleanerReport = {
      examined: 0,
      deleted: 0,
      deletedDryRun: 0,
      skippedNotEligible: 0,
      skippedEngagement: 0,
      skippedWhale: 0,
      skippedAttachment: 0,
      skippedSafety: 0,
      deleteFailed: 0,
      byDomain: {},
      results: [],
      degraded: false,
      degradedNotes: [],
    };
    const out = renderSpamCleanerDigest(empty);
    expect(out).toContain("No spam to clean today");
  });

  it("lists per-domain counts when non-empty", () => {
    const r: SpamCleanerReport = {
      examined: 3,
      deleted: 3,
      deletedDryRun: 0,
      skippedNotEligible: 0,
      skippedEngagement: 0,
      skippedWhale: 0,
      skippedAttachment: 0,
      skippedSafety: 0,
      deleteFailed: 0,
      byDomain: { "semrush.com": 2, "apollo.io": 1 },
      results: [],
      degraded: false,
      degradedNotes: [],
    };
    const out = renderSpamCleanerDigest(r);
    expect(out).toContain("semrush.com ×2");
    expect(out).toContain("apollo.io ×1");
  });

  it("flags dry-run mode in the header", () => {
    const r: SpamCleanerReport = {
      examined: 1,
      deleted: 0,
      deletedDryRun: 1,
      skippedNotEligible: 0,
      skippedEngagement: 0,
      skippedWhale: 0,
      skippedAttachment: 0,
      skippedSafety: 0,
      deleteFailed: 0,
      byDomain: { "semrush.com": 1 },
      results: [],
      degraded: false,
      degradedNotes: [],
    };
    const out = renderSpamCleanerDigest(r);
    expect(out).toContain("DRY RUN");
  });

  it("flags delete-failures in the footer", () => {
    const r: SpamCleanerReport = {
      examined: 2,
      deleted: 1,
      deletedDryRun: 0,
      skippedNotEligible: 0,
      skippedEngagement: 0,
      skippedWhale: 0,
      skippedAttachment: 0,
      skippedSafety: 0,
      deleteFailed: 1,
      byDomain: { "semrush.com": 2 },
      results: [],
      degraded: true,
      degradedNotes: ["trash failed"],
    };
    const out = renderSpamCleanerDigest(r);
    expect(out).toContain("delete-failure");
  });
});

describe("spam-cleaner / pattern table sanity", () => {
  it("SPAM_SUBJECT_PATTERNS is non-empty + every entry is a RegExp", () => {
    expect(SPAM_SUBJECT_PATTERNS.length).toBeGreaterThan(0);
    for (const p of SPAM_SUBJECT_PATTERNS) expect(p).toBeInstanceOf(RegExp);
  });
  it("SPAM_SAFETY_PATTERNS contains the canonical financial / vendor signals", () => {
    // Test by behavior rather than source-text containment — the regex
    // sources include `\b` and other escapes that don't survive a string
    // join. Behavior is what we actually care about anyway.
    expect(matchSafetyPattern("Invoice INV-001")).not.toBe("");
    expect(matchSafetyPattern("W-9 form attached")).not.toBe("");
    expect(matchSafetyPattern("Sample request")).not.toBe("");
    expect(matchSafetyPattern("Purchase order #4521")).not.toBe("");
  });
});
