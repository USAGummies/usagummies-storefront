/**
 * Tests for yesterday-runs aggregator. The brief route reads the
 * audit store, calls summarizeYesterdayRuns(), and renders the
 * one-line synopses at the top of the morning brief.
 */
import { describe, expect, it } from "vitest";

import { summarizeYesterdayRuns } from "../yesterday-runs";
import type { AuditLogEntry } from "../types";

function buildEntry(
  overrides: Partial<AuditLogEntry> & {
    actorId: string;
    after?: Record<string, unknown>;
    createdAt?: string;
  },
): AuditLogEntry {
  return {
    id: `audit-${Math.random().toString(36).slice(2)}`,
    runId: "run-1",
    division: "platform-data-automation",
    actorType: "agent",
    actorId: overrides.actorId,
    action: "brief.publish",
    entityType: "auto-fire-nudges-run",
    entityId: "2026-05-02",
    after: overrides.after ?? {},
    result: "ok",
    sourceCitations: [],
    confidence: 1,
    createdAt: overrides.createdAt ?? "2026-05-03T14:05:00.000Z",
  };
}

describe("summarizeYesterdayRuns — auto-fire-nudges", () => {
  it("renders fired/skipped/failed counts when present", () => {
    const entries = [
      buildEntry({
        actorId: "auto-fire-nudges",
        after: {
          fired: 4,
          skipped: 2,
          failed: 0,
          perDetector: {
            "sample-touch-2": { eligible: 5, fired: 2 },
            "reorder-offer": { eligible: 3, fired: 1 },
            "onboarding-nudge": { eligible: 1, fired: 1 },
          },
          degraded: [],
        },
      }),
    ];
    const r = summarizeYesterdayRuns(entries, "2026-05-03");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain(":zap:");
    expect(r.lines[0]).toContain("Auto-fire nudges");
    expect(r.lines[0]).toContain("fired *4*");
    expect(r.lines[0]).toContain("skipped 2");
    expect(r.lines[0]).toContain("sample-touch-2 2");
    expect(r.lines[0]).toContain("reorder-offer 1");
    expect(r.lines[0]).toContain("onboarding-nudge 1");
  });

  it("renders failure marker + degraded count when present", () => {
    const entries = [
      buildEntry({
        actorId: "auto-fire-nudges",
        after: {
          fired: 1,
          skipped: 0,
          failed: 2,
          perDetector: {},
          degraded: ["listRecentDeals failed: HubSpot 500"],
        },
      }),
    ];
    const r = summarizeYesterdayRuns(entries, "2026-05-03");
    expect(r.lines[0]).toContain(":warning:");
    expect(r.lines[0]).toContain("*failed 2*");
    expect(r.lines[0]).toContain("1 degraded");
  });

  it("omits per-detector breakdown when no detector fired", () => {
    const entries = [
      buildEntry({
        actorId: "auto-fire-nudges",
        after: {
          fired: 0,
          skipped: 5,
          failed: 0,
          perDetector: {
            "sample-touch-2": { eligible: 3, fired: 0 },
            "reorder-offer": { eligible: 2, fired: 0 },
          },
        },
      }),
    ];
    const r = summarizeYesterdayRuns(entries, "2026-05-03");
    expect(r.lines[0]).not.toContain("sample-touch-2 0");
  });
});

describe("summarizeYesterdayRuns — ad-kill-switch", () => {
  it("renders KILL line with platform-blame when severity=kill", () => {
    const entries = [
      buildEntry({
        actorId: "ad-kill-switch",
        after: {
          severity: "kill",
          shouldKill: true,
          totalSpendUsd: 1678,
          totalConversions: 0,
          perPlatform: [
            { platform: "meta", severity: "ok", spendUsd: 0, conversions: 0 },
            {
              platform: "google",
              severity: "kill",
              spendUsd: 1678,
              conversions: 0,
            },
          ],
        },
      }),
    ];
    const r = summarizeYesterdayRuns(entries, "2026-05-03");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain(":rotating_light:");
    expect(r.lines[0]).toContain("*KILL*");
    expect(r.lines[0]).toContain("Google $1678.00 → 0 conv");
  });

  it("renders WARN line when severity=warn", () => {
    const entries = [
      buildEntry({
        actorId: "ad-kill-switch",
        after: {
          severity: "warn",
          shouldKill: false,
          totalSpendUsd: 75,
          totalConversions: 0,
          perPlatform: [
            { platform: "meta", severity: "warn", spendUsd: 75, conversions: 0 },
            { platform: "google", severity: "ok", spendUsd: 0, conversions: 0 },
          ],
        },
      }),
    ];
    const r = summarizeYesterdayRuns(entries, "2026-05-03");
    expect(r.lines[0]).toContain(":warning:");
    expect(r.lines[0]).toContain("warn");
    expect(r.lines[0]).toContain("Meta $75.00 → 0 conv");
  });

  it("quiet-collapses (empty line) when severity=ok", () => {
    const entries = [
      buildEntry({
        actorId: "ad-kill-switch",
        after: {
          severity: "ok",
          shouldKill: false,
          totalSpendUsd: 30,
          totalConversions: 5,
          perPlatform: [],
        },
      }),
    ];
    const r = summarizeYesterdayRuns(entries, "2026-05-03");
    expect(r.lines).toHaveLength(0);
  });
});

describe("summarizeYesterdayRuns — date filtering + ordering", () => {
  it("filters out entries from a different date", () => {
    const entries = [
      buildEntry({
        actorId: "auto-fire-nudges",
        after: { fired: 5, skipped: 0, failed: 0 },
        createdAt: "2026-04-30T14:00:00.000Z", // wrong day
      }),
    ];
    const r = summarizeYesterdayRuns(entries, "2026-05-03");
    expect(r.lines).toHaveLength(0);
  });

  it("picks the MOST RECENT entry when multiple runs fired same day", () => {
    const entries = [
      buildEntry({
        actorId: "auto-fire-nudges",
        after: { fired: 1, skipped: 0, failed: 0 },
        createdAt: "2026-05-03T05:00:00.000Z", // earlier
      }),
      buildEntry({
        actorId: "auto-fire-nudges",
        after: { fired: 8, skipped: 0, failed: 0 },
        createdAt: "2026-05-03T14:00:00.000Z", // later
      }),
    ];
    const r = summarizeYesterdayRuns(entries, "2026-05-03");
    expect(r.lines[0]).toContain("fired *8*");
  });

  it("ad-kill-switch line appears BEFORE auto-fire-nudges (severity-first ordering)", () => {
    const entries = [
      buildEntry({
        actorId: "auto-fire-nudges",
        after: { fired: 4, skipped: 2, failed: 0 },
      }),
      buildEntry({
        actorId: "ad-kill-switch",
        after: {
          severity: "kill",
          shouldKill: true,
          totalSpendUsd: 200,
          totalConversions: 0,
          perPlatform: [
            { platform: "meta", severity: "kill", spendUsd: 200, conversions: 0 },
          ],
        },
      }),
    ];
    const r = summarizeYesterdayRuns(entries, "2026-05-03");
    expect(r.lines).toHaveLength(2);
    // Kill switch line comes first.
    expect(r.lines[0]).toContain("Ad-kill-switch");
    expect(r.lines[1]).toContain("Auto-fire nudges");
  });

  it("returns empty summary when neither agent has audit entries", () => {
    const r = summarizeYesterdayRuns([], "2026-05-03");
    expect(r.forDate).toBe("2026-05-03");
    expect(r.lines).toEqual([]);
  });
});
