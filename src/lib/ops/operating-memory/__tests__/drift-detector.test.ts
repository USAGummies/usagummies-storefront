/**
 * Slack-Corrections Drift Detector — tests.
 *
 * Locks the six P0-1 acceptance criteria from the build spec:
 *
 *   1. Drew approver regression detection.
 *   2. Class D slug detection (verbatim slug + paraphrase patterns).
 *   3. Unknown slug detection (token shaped like a registered slug but
 *      not in the registry).
 *   4. Stale doctrine contradiction (canonical-lock match).
 *   5. No write/mutation side effects (detector is pure observation).
 *   6. Deduped drift reports — same input → same finding ids → dedupe.
 *
 * All tests use the in-memory operating-memory store + a hand-built
 * contract bundle. No filesystem, no network, no Slack.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __INTERNAL,
  detectDrift,
  runDriftDetection,
} from "../drift-detector";
import { InMemoryOperatingMemoryStore } from "../store";
import { captureTranscript } from "../transcript-saver";
import type { ContractSource } from "../drift-types";
import type { OperatingMemoryEntry, TranscriptCaptureInput } from "../types";

// ---- Fixtures -----------------------------------------------------------

let store: InMemoryOperatingMemoryStore;

beforeEach(() => {
  store = new InMemoryOperatingMemoryStore();
});

afterEach(() => {
  store._clear();
});

function baseInput(overrides: Partial<TranscriptCaptureInput> = {}): TranscriptCaptureInput {
  return {
    body: "placeholder body",
    source: { sourceSystem: "slack", sourceRef: "C1:ts1" },
    actorId: "Ben",
    actorType: "human",
    capturedAt: "2026-04-28T10:00:00Z",
    division: "executive-control",
    ...overrides,
  };
}

const FIXED_NOW = new Date("2026-04-29T00:00:00Z");

const CANONICAL_BUNDLE: ContractSource[] = [
  { path: "CLAUDE.md", text: "Drew owns nothing. Orders ship from Ashford WA." },
  { path: "contracts/approval-taxonomy.md", text: "Class D actions are never autonomous." },
  { path: "contracts/operating-memory.md", text: "BCC rene@usagummies.com on every new-customer first email." },
  { path: "contracts/governance.md", text: "Every agent has exactly one job." },
  { path: "contracts/wholesale-pricing.md", text: "Invoice line text uses clean prose, no B-tier prefix." },
];

// Helper: build an entry-shape directly (for unit testing detectors that
// take entries, without going through the saver path).
function entry(
  overrides: Partial<OperatingMemoryEntry> = {},
): OperatingMemoryEntry {
  return {
    id: "om-id-1",
    fingerprint: "f0".repeat(32),
    kind: "correction",
    tags: [],
    summary: "test",
    body: "test body",
    source: { sourceSystem: "slack", sourceRef: "C1:ts1" },
    actorId: "Ben",
    actorType: "human",
    capturedAt: "2026-04-28T10:00:00Z",
    recordedAt: "2026-04-28T10:00:00Z",
    division: "executive-control",
    threadTag: "transcript:abcdef12",
    confidence: 1,
    redactedKinds: [],
    ...overrides,
  };
}

// =========================================================================
// Acceptance #1 — Drew approver regression detection
// =========================================================================

describe("detectDrift — Drew approver regression", () => {
  it("flags 'Drew should approve'", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "a".repeat(64),
          body: "Going forward, Drew should approve all PO drafts.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.length).toBeGreaterThan(0);
    const drewFinding = r.findings.find((f) => f.detector === "drew-regression");
    expect(drewFinding).toBeDefined();
    expect(drewFinding?.severity).toBe("high");
    expect(drewFinding?.conflictedDoc).toBe("CLAUDE.md");
    expect(drewFinding?.proposedHumanReview).toContain("Drew owns nothing");
  });

  it("flags 'reassign approval to Drew'", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "b".repeat(64),
          body: "Reassign approval to Drew for inventory adjustments above 50 units.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.some((f) => f.detector === "drew-regression")).toBe(true);
  });

  it("does NOT flag 'Drew handles East Coast samples' (legitimate fulfillment role)", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "c".repeat(64),
          body: "Drew handles East Coast samples per CLAUDE.md fulfillment doctrine.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    // No drew-regression finding — Drew's sample role is legitimate.
    expect(r.findings.some((f) => f.detector === "drew-regression")).toBe(false);
  });

  it("proposed reviewer never includes Drew", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "d".repeat(64),
          body: "Drew should approve the next vendor master.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    for (const f of r.findings) {
      // proposedHumanReview may MENTION Drew as the doctrine-violator,
      // but the *reviewer* it routes to is never Drew.
      expect(f.proposedHumanReview).not.toMatch(/route\s+to\s+Drew\b/i);
      expect(f.proposedHumanReview).not.toMatch(/^Drew review/i);
    }
  });
});

// =========================================================================
// Acceptance #2 — Class D slug detection
// =========================================================================

describe("detectDrift — Class D red-line action requests", () => {
  it("flags verbatim Class D slug `qbo.chart-of-accounts.modify`", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "e".repeat(64),
          body: "Need to wire up qbo.chart-of-accounts.modify for the agent.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "class-d-request");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("critical");
    expect(f?.conflictedDoc).toBe("contracts/approval-taxonomy.md");
  });

  it("flags paraphrase 'delete production data'", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "f".repeat(64),
          body: "Should we have an agent delete production data when accounts are closed?",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "class-d-request");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("high");
  });

  it("flags 'agent posts journal entry'", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "1".repeat(64),
          body: "Let's have the agent post a journal entry whenever we reconcile.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.some((f) => f.detector === "class-d-request")).toBe(true);
  });

  it("flags 'recategorize Rene's transfer as income' (Class D + doctrine lock)", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "2".repeat(64),
          body: "Recategorize Rene's transfer as income for this period.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    // Both class-d-request + doctrine-contradiction (rene-investor-transfer-is-loan).
    expect(r.findings.some((f) => f.detector === "class-d-request")).toBe(true);
    expect(r.findings.some((f) => f.detector === "doctrine-contradiction")).toBe(true);
  });

  it("does NOT flag clean Class A capture", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "3".repeat(64),
          body: "Captured Rene's confirmation that the AP packet looks good.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.some((f) => f.detector === "class-d-request")).toBe(false);
  });
});

// =========================================================================
// Acceptance #3 — Unknown slug detection
// =========================================================================

describe("detectDrift — unknown approval slug", () => {
  it("flags slug-shaped token not in registry (e.g. `qbo.invoice.fast-send`)", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "4".repeat(64),
          body: "Need to register qbo.invoice.fast-send for the rapid AP flow.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "unknown-slug");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("medium");
    expect(f?.evidenceSnippet).toContain("qbo.invoice.fast-send");
  });

  it("does NOT flag registered slug `gmail.send`", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "5".repeat(64),
          body: "Use gmail.send for the response after Ben approves.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.some((f) => f.detector === "unknown-slug")).toBe(false);
  });

  it("does NOT flag email-domain false positive `gmail.com`", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "6".repeat(64),
          body: "Ben's address is ben@usagummies.com (or gmail.com fallback).",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.some((f) => f.detector === "unknown-slug")).toBe(false);
  });

  it("does NOT flag random domain shapes that don't match a known system prefix", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "7".repeat(64),
          body: "We should test the foo.bar pattern in next.config.js.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.some((f) => f.detector === "unknown-slug")).toBe(false);
  });
});

// =========================================================================
// Acceptance #4 — Stale doctrine contradiction
// =========================================================================

describe("detectDrift — doctrine contradictions", () => {
  it("flags 'remove BCC to Rene' (operating-memory.md BCC-Rene rule)", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "8".repeat(64),
          body: "Let's remove the BCC to Rene on the next batch of customer emails.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    const f = r.findings.find(
      (x) => x.detector === "doctrine-contradiction" && x.conflictedDoc === "contracts/operating-memory.md",
    );
    expect(f).toBeDefined();
    expect(f?.severity).toBe("high");
  });

  it("flags 'use B2 prefix in invoice description' (Rene's lock)", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "9".repeat(64),
          body: "Add the B2 prefix in the invoice description for Mike's order.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(
      r.findings.some(
        (f) =>
          f.detector === "doctrine-contradiction" &&
          f.conflictedDoc === "contracts/wholesale-pricing.md",
      ),
    ).toBe(true);
  });

  it("flags 'agent should modify CoA' (Class D + doctrine)", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "0".repeat(64),
          body: "Let the agent modify the chart of accounts during reconciliation.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    // critical from doctrine lock no-agent-coa-modify
    expect(
      r.findings.some(
        (f) => f.detector === "doctrine-contradiction" && f.severity === "critical",
      ),
    ).toBe(true);
  });

  it("does NOT flag normal capture about BCC compliance", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "ab".repeat(32),
          body: "Confirmed: every Mike email carries BCC: rene@usagummies.com per operating-memory.md.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.some((f) => f.detector === "doctrine-contradiction")).toBe(false);
  });
});

// =========================================================================
// Acceptance #5 — No mutation side effects
// =========================================================================

describe("detectDrift — observation-only", () => {
  it("does not write to the operating-memory store", async () => {
    // Capture two real entries via the saver, then run the detector
    // through `runDriftDetection`. The store size must not change.
    await captureTranscript(
      baseInput({ body: "Drew should approve the next PO." }),
      { store },
    );
    await captureTranscript(
      baseInput({
        source: { sourceSystem: "slack", sourceRef: "C1:ts2" },
        body: "Skip the audit envelope on the daily brief.",
      }),
      { store },
    );
    const sizeBefore = store._size;

    const r = await runDriftDetection({
      store,
      loadContracts: async () => CANONICAL_BUNDLE,
      now: () => FIXED_NOW,
    });

    expect(r.scanned).toBe(2);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(store._size).toBe(sizeBefore); // no writes
  });

  it("does not throw on empty input", () => {
    const r = detectDrift({
      entries: [],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings).toEqual([]);
    expect(r.scanned).toBe(0);
  });

  it("never names Drew as the human reviewer in proposedHumanReview", () => {
    const r = detectDrift({
      entries: [
        entry({ fingerprint: "cd".repeat(32), body: "Drew should approve PO drafts." }),
        entry({ fingerprint: "ef".repeat(32), body: "qbo.chart-of-accounts.modify is needed." }),
        entry({ fingerprint: "12".repeat(32), body: "Use qbo.invoice.fast-send for AP." }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) {
      // The proposed reviewer is "Ben + Rene" or "Rene (CC Ben)" — never Drew.
      expect(f.proposedHumanReview).toMatch(/(Ben \+ Rene|Rene \(CC Ben\))/);
      expect(f.proposedHumanReview).not.toMatch(/Drew\s+review/);
    }
  });
});

// =========================================================================
// Acceptance #6 — Dedupe across repeated runs
// =========================================================================

describe("detectDrift — dedupe", () => {
  it("running detectDrift twice over identical inputs yields identical finding ids", () => {
    const inputs = [
      entry({ fingerprint: "11".repeat(32), body: "Drew should approve the PO." }),
      entry({ fingerprint: "22".repeat(32), body: "Use qbo.invoice.fast-send for AP." }),
    ];
    const r1 = detectDrift({ entries: inputs, contracts: CANONICAL_BUNDLE, now: FIXED_NOW });
    const r2 = detectDrift({ entries: inputs, contracts: CANONICAL_BUNDLE, now: FIXED_NOW });

    const ids1 = r1.findings.map((f) => f.id).sort();
    const ids2 = r2.findings.map((f) => f.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it("dedupes within a single run when the same correction body appears twice (different fingerprints)", () => {
    // Two entries with DIFFERENT fingerprints but same body — the
    // detector still emits ONE finding per (detector, fingerprint, sub),
    // so we get 2 findings, but each has a stable id rooted in its own
    // fingerprint. The finding-id dedupe ensures the SAME entry isn't
    // counted twice within one run.
    const inputs = [
      entry({ fingerprint: "33".repeat(32), body: "Drew should approve POs." }),
      entry({ fingerprint: "44".repeat(32), body: "Drew should approve POs." }),
    ];
    const r = detectDrift({ entries: inputs, contracts: CANONICAL_BUNDLE, now: FIXED_NOW });
    const drewFindings = r.findings.filter((f) => f.detector === "drew-regression");
    // Two distinct entries → two findings (not one merged) — the
    // dedupe key includes fingerprint so each entry is independently
    // surfaced.
    expect(drewFindings.length).toBe(2);
    // But each id is unique.
    const ids = new Set(drewFindings.map((f) => f.id));
    expect(ids.size).toBe(2);
  });

  it("running detector against the same entry twice produces the same finding ids (stable across runs)", () => {
    const e = entry({ fingerprint: "55".repeat(32), body: "Drew should approve the next vendor onboard." });
    const r1 = detectDrift({ entries: [e], contracts: CANONICAL_BUNDLE, now: FIXED_NOW });
    const r2 = detectDrift({
      entries: [e],
      contracts: CANONICAL_BUNDLE,
      now: new Date("2026-05-15T00:00:00Z"), // different clock
    });
    // The body trips both `drew-regression` and the `drew-owns-nothing`
    // doctrine lock — both findings are stable across clock drift.
    expect(r1.findings.length).toBeGreaterThanOrEqual(1);
    expect(r2.findings.length).toBe(r1.findings.length);
    // IDs are clock-independent.
    const ids1 = r1.findings.map((f) => f.id).sort();
    const ids2 = r2.findings.map((f) => f.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it("findings carry the detector clock (`detectedAt`), but ids are clock-independent", () => {
    const e = entry({ fingerprint: "66".repeat(32), body: "Drew should approve POs." });
    const r1 = detectDrift({ entries: [e], contracts: CANONICAL_BUNDLE, now: FIXED_NOW });
    const r2 = detectDrift({
      entries: [e],
      contracts: CANONICAL_BUNDLE,
      now: new Date("2026-12-01T00:00:00Z"),
    });
    expect(r1.findings.length).toBeGreaterThan(0);
    for (const f of r1.findings) {
      expect(f.detectedAt).toBe(FIXED_NOW.toISOString());
    }
    for (const f of r2.findings) {
      expect(f.detectedAt).toBe("2026-12-01T00:00:00.000Z");
    }
    // IDs match across clocks.
    expect(r1.findings.map((f) => f.id).sort()).toEqual(
      r2.findings.map((f) => f.id).sort(),
    );
  });
});

// =========================================================================
// Stale-reference detector
// =========================================================================

describe("detectDrift — stale contract reference", () => {
  it("flags reference to a contract path not in the bundle", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "77".repeat(32),
          body: "Per contracts/some-old-doc.md the rule was X.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "stale-reference");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("low");
    expect(f?.conflictedDoc).toBe("contracts/some-old-doc.md");
  });

  it("does NOT flag a path that IS in the bundle", () => {
    const r = detectDrift({
      entries: [
        entry({
          fingerprint: "88".repeat(32),
          body: "Per contracts/operating-memory.md, BCC is required.",
        }),
      ],
      contracts: CANONICAL_BUNDLE,
      now: FIXED_NOW,
    });
    expect(r.findings.some((f) => f.detector === "stale-reference")).toBe(false);
  });
});

// =========================================================================
// runDriftDetection — windowing
// =========================================================================

describe("runDriftDetection — windowing", () => {
  it("only scans entries within [now - windowDays, now]", async () => {
    // Capture two entries: one in window (yesterday) and one out
    // of window (60 days ago).
    const now = new Date("2026-04-29T00:00:00Z");
    const inWindowAt = new Date(now.getTime() - 24 * 3_600_000).toISOString();
    const outOfWindowAt = new Date(now.getTime() - 60 * 86_400_000).toISOString();

    await captureTranscript(
      baseInput({
        body: "Drew should approve PO drafts.",
        capturedAt: inWindowAt,
        source: { sourceSystem: "slack", sourceRef: "C1:in-window" },
      }),
      { store },
    );
    await captureTranscript(
      baseInput({
        body: "Drew should approve PO drafts (old).",
        capturedAt: outOfWindowAt,
        source: { sourceSystem: "slack", sourceRef: "C1:out-of-window" },
      }),
      { store },
    );

    const r = await runDriftDetection({
      store,
      loadContracts: async () => CANONICAL_BUNDLE,
      windowDays: 14,
      now: () => now,
    });

    // Only the in-window entry was scanned.
    expect(r.scanned).toBe(1);
    // It's flagged.
    expect(r.findings.some((f) => f.detector === "drew-regression")).toBe(true);
  });
});

// =========================================================================
// Tally counts
// =========================================================================

describe("detectDrift — tallies", () => {
  it("byDetector + bySeverity counts match findings array", () => {
    const inputs = [
      entry({ fingerprint: "99".repeat(32), body: "Drew should approve POs." }),
      entry({ fingerprint: "aa".repeat(32), body: "qbo.chart-of-accounts.modify is needed." }),
      entry({ fingerprint: "bb".repeat(32), body: "Use qbo.invoice.fast-send for AP." }),
    ];
    const r = detectDrift({ entries: inputs, contracts: CANONICAL_BUNDLE, now: FIXED_NOW });

    const byDetectorSum = Object.values(r.byDetector).reduce((a, b) => a + b, 0);
    const bySeveritySum = Object.values(r.bySeverity).reduce((a, b) => a + b, 0);
    expect(byDetectorSum).toBe(r.findings.length);
    expect(bySeveritySum).toBe(r.findings.length);
  });
});

// =========================================================================
// __INTERNAL — make-finding-id is stable
// =========================================================================

describe("__INTERNAL.makeFindingId", () => {
  it("same args → same id", () => {
    expect(__INTERNAL.makeFindingId("drew-regression", "abc", "x")).toBe(
      __INTERNAL.makeFindingId("drew-regression", "abc", "x"),
    );
  });

  it("different args → different id", () => {
    const a = __INTERNAL.makeFindingId("drew-regression", "abc", "x");
    const b = __INTERNAL.makeFindingId("drew-regression", "abc", "y");
    expect(a).not.toBe(b);
  });
});
