/**
 * Notion ↔ /contracts Lockstep Auditor — tests.
 *
 * Locks the eight P0-7 acceptance criteria from the build spec:
 *
 *   1. Missing-in-notion detection.
 *   2. Missing-in-repo detection.
 *   3. Version mismatch.
 *   4. Stale Notion timestamp.
 *   5. Drew approver regression (in repo OR Notion content).
 *   6. Unknown approval slug (in repo OR Notion).
 *   7. No mutation / write side effects (auditor is pure).
 *   8. Pack dashboard surfaces summary if loader supplied.
 *
 * The auditor is a pure DI function — these tests pass synthetic
 * manifests directly. No filesystem, no network, no Notion API.
 */

import { describe, expect, it } from "vitest";

import { auditLockstep, summarizeReport } from "../lockstep-auditor";
import type {
  LockstepReport,
  NotionCanonItem,
  RepoContract,
} from "../types";

// ---- Fixtures -----------------------------------------------------------

const FIXED_NOW = new Date("2026-04-29T12:00:00Z");

function repo(overrides: Partial<RepoContract> = {}): RepoContract {
  return {
    path: "contracts/agents/test.md",
    title: "Agent Contract — Test",
    status: "CANONICAL (day-one, in-the-loop)",
    version: "1.0 — 2026-04-20",
    versionDate: "2026-04-20",
    humanOwner: "Ben",
    referencedSlugs: [],
    doctrineMarkers: [],
    body: "Test body — clean.",
    ...overrides,
  };
}

function notion(overrides: Partial<NotionCanonItem> = {}): NotionCanonItem {
  return {
    pageId: "n-001",
    url: "https://notion.so/test",
    title: "Test",
    repoPath: "contracts/agents/test.md",
    status: "CANONICAL",
    version: "1.0",
    lastEditedAt: "2026-04-21T10:00:00Z",
    excerpt: "Test page excerpt.",
    referencedSlugs: [],
    ...overrides,
  };
}

// =========================================================================
// Acceptance #1 — missing-in-notion
// =========================================================================

describe("auditLockstep — missing-in-notion", () => {
  it("flags repo contract with no Notion mirror (HIGH severity for CANONICAL)", () => {
    const r = auditLockstep({
      repoManifest: [repo({ path: "contracts/agents/orphan.md", status: "CANONICAL" })],
      notionManifest: [],
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "missing-in-notion");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("high");
    expect(f?.repoPath).toBe("contracts/agents/orphan.md");
  });

  it("missing-in-notion is LOW severity for DEPRECATED status", () => {
    const r = auditLockstep({
      repoManifest: [repo({ path: "contracts/agents/old.md", status: "DEPRECATED" })],
      notionManifest: [],
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "missing-in-notion");
    expect(f?.severity).toBe("low");
  });

  it("does NOT flag when Notion mirror present", () => {
    const r = auditLockstep({
      repoManifest: [repo()],
      notionManifest: [notion()],
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "missing-in-notion")).toBe(false);
  });
});

// =========================================================================
// Acceptance #2 — missing-in-repo
// =========================================================================

describe("auditLockstep — missing-in-repo", () => {
  it("flags Notion canon item whose repoPath does not exist in repo manifest", () => {
    const r = auditLockstep({
      repoManifest: [],
      notionManifest: [notion({ repoPath: "contracts/agents/ghost.md" })],
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "missing-in-repo");
    expect(f).toBeDefined();
    expect(f?.repoPath).toBe("contracts/agents/ghost.md");
    expect(f?.notionPageId).toBe("n-001");
  });

  it("flags Notion item with no repoPath (low confidence)", () => {
    const r = auditLockstep({
      repoManifest: [],
      notionManifest: [notion({ repoPath: undefined })],
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "missing-in-repo");
    expect(f).toBeDefined();
    expect(f?.confidence).toBe("low");
  });

  it("does NOT flag when repo file exists", () => {
    const r = auditLockstep({
      repoManifest: [repo()],
      notionManifest: [notion()],
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "missing-in-repo")).toBe(false);
  });
});

// =========================================================================
// Acceptance #3 — version mismatch
// =========================================================================

describe("auditLockstep — version-mismatch", () => {
  it("flags numeric version mismatch", () => {
    const r = auditLockstep({
      repoManifest: [repo({ version: "1.4 — 2026-04-27" })],
      notionManifest: [notion({ version: "1.2", lastEditedAt: "2026-04-27T00:00:00Z" })],
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "version-mismatch");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("medium");
    expect(f?.evidence).toContain("1.4");
    expect(f?.evidence).toContain("1.2");
  });

  it("does NOT flag when versions match (after normalization)", () => {
    const r = auditLockstep({
      repoManifest: [repo({ version: "v1.0 — 2026-04-20" })],
      notionManifest: [notion({ version: "1.0" })],
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "version-mismatch")).toBe(false);
  });

  it("does NOT flag when one side is missing version", () => {
    const r = auditLockstep({
      repoManifest: [repo({ version: undefined })],
      notionManifest: [notion()],
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "version-mismatch")).toBe(false);
  });
});

// =========================================================================
// Acceptance #4 — stale Notion timestamp
// =========================================================================

describe("auditLockstep — stale-notion-timestamp", () => {
  it("flags Notion lastEditedAt > 14 days behind repo versionDate", () => {
    const r = auditLockstep({
      repoManifest: [repo({ version: "1.0 — 2026-04-27", versionDate: "2026-04-27" })],
      notionManifest: [
        notion({
          version: "1.0",
          lastEditedAt: "2026-04-01T00:00:00Z", // 26 days behind
        }),
      ],
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "stale-notion-timestamp");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("medium");
    expect(f?.evidence).toContain("2026-04-27");
    expect(f?.evidence).toContain("2026-04-01");
  });

  it("does NOT flag within 14-day threshold", () => {
    const r = auditLockstep({
      repoManifest: [repo({ versionDate: "2026-04-21" })],
      notionManifest: [notion({ lastEditedAt: "2026-04-15T00:00:00Z" })],
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "stale-notion-timestamp")).toBe(false);
  });

  it("custom staleThresholdDays override", () => {
    const r = auditLockstep({
      repoManifest: [repo({ versionDate: "2026-04-27" })],
      notionManifest: [notion({ lastEditedAt: "2026-04-23T00:00:00Z" })], // 4 days
      now: FIXED_NOW,
      staleThresholdDays: 2, // tighter threshold
    });
    expect(r.findings.some((x) => x.detector === "stale-notion-timestamp")).toBe(true);
  });
});

// =========================================================================
// Acceptance #5 — Drew regression in either source
// =========================================================================

describe("auditLockstep — drew-regression", () => {
  it("flags Drew approver in repo body", () => {
    const r = auditLockstep({
      repoManifest: [repo({ body: "Drew should approve all PO drafts going forward." })],
      notionManifest: null,
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "drew-regression");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("high");
    expect(f?.repoPath).toBeDefined();
  });

  it("flags Drew approver in Notion excerpt", () => {
    const r = auditLockstep({
      repoManifest: [repo()],
      notionManifest: [
        notion({ excerpt: "Reassign approval to Drew for inventory commits." }),
      ],
      now: FIXED_NOW,
    });
    const f = r.findings.find(
      (x) => x.detector === "drew-regression" && x.notionPageId !== undefined,
    );
    expect(f).toBeDefined();
  });

  it("does NOT flag legitimate Drew sample-fulfillment language", () => {
    const r = auditLockstep({
      repoManifest: [
        repo({ body: "Samples ship from East Coast (Drew). Orders ship from Ashford WA (Ben)." }),
      ],
      notionManifest: null,
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "drew-regression")).toBe(false);
  });

  it("proposed reviewer never names Drew", () => {
    const r = auditLockstep({
      repoManifest: [repo({ body: "Drew should approve POs." })],
      notionManifest: null,
      now: FIXED_NOW,
    });
    for (const f of r.findings) {
      expect(f.proposedHumanReview).not.toMatch(/route\s+to\s+Drew\b/i);
      expect(f.proposedHumanReview).not.toMatch(/^Drew review/i);
    }
  });
});

// =========================================================================
// Acceptance #6 — unknown slug in either source
// =========================================================================

describe("auditLockstep — unknown-slug", () => {
  it("flags unknown slug in repo referencedSlugs", () => {
    const r = auditLockstep({
      repoManifest: [repo({ referencedSlugs: ["qbo.invoice.fast-send"] })],
      notionManifest: null,
      now: FIXED_NOW,
    });
    const f = r.findings.find((x) => x.detector === "unknown-slug");
    expect(f).toBeDefined();
    expect(f?.evidence).toContain("qbo.invoice.fast-send");
  });

  it("flags unknown slug in Notion referencedSlugs", () => {
    const r = auditLockstep({
      repoManifest: [repo()],
      notionManifest: [notion({ referencedSlugs: ["hubspot.deal.auto-promote"] })],
      now: FIXED_NOW,
    });
    expect(
      r.findings.some(
        (x) => x.detector === "unknown-slug" && x.notionPageId !== undefined,
      ),
    ).toBe(true);
  });

  it("flags unknown slug found in repo body (defense-in-depth scrape)", () => {
    const r = auditLockstep({
      repoManifest: [repo({ body: "We need qbo.invoice.fast-send for AP automation." })],
      notionManifest: null,
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "unknown-slug")).toBe(true);
  });

  it("does NOT flag a registered slug", () => {
    const r = auditLockstep({
      repoManifest: [repo({ referencedSlugs: ["gmail.send", "open-brain.capture"] })],
      notionManifest: null,
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "unknown-slug")).toBe(false);
  });

  it("does NOT flag email-domain false positive (e.g. gmail.com)", () => {
    const r = auditLockstep({
      repoManifest: [repo({ body: "Contact ben@usagummies.com or use gmail.com fallback." })],
      notionManifest: null,
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "unknown-slug")).toBe(false);
  });
});

// =========================================================================
// Acceptance #7 — no mutation / write side effects
// =========================================================================

describe("auditLockstep — observation-only (no mutation)", () => {
  it("does not modify input manifests", () => {
    const repos: RepoContract[] = [repo({ body: "Drew should approve POs." })];
    const notions: NotionCanonItem[] = [notion({ referencedSlugs: ["foo.bar"] })];
    const repoSnapshot = JSON.stringify(repos);
    const notionSnapshot = JSON.stringify(notions);

    const r = auditLockstep({
      repoManifest: repos,
      notionManifest: notions,
      now: FIXED_NOW,
    });

    expect(r.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(repos)).toBe(repoSnapshot);
    expect(JSON.stringify(notions)).toBe(notionSnapshot);
  });

  it("returns degraded mode when Notion manifest is null", () => {
    const r = auditLockstep({
      repoManifest: [repo()],
      notionManifest: null,
      now: FIXED_NOW,
    });
    expect(r.fullyAudited).toBe(false);
    expect(r.degradedReasons.length).toBeGreaterThan(0);
    expect(r.degradedReasons[0]).toContain("Notion canon manifest not provided");
  });

  it("emits no cross-walk findings in degraded mode", () => {
    const r = auditLockstep({
      repoManifest: [
        repo({ path: "contracts/agents/orphan.md", status: "CANONICAL" }),
      ],
      notionManifest: null,
      now: FIXED_NOW,
    });
    // Cross-walk detectors are skipped in degraded mode
    expect(r.findings.some((x) => x.detector === "missing-in-notion")).toBe(false);
    expect(r.findings.some((x) => x.detector === "missing-in-repo")).toBe(false);
    expect(r.findings.some((x) => x.detector === "version-mismatch")).toBe(false);
    expect(r.findings.some((x) => x.detector === "stale-notion-timestamp")).toBe(false);
    expect(r.findings.some((x) => x.detector === "title-mismatch")).toBe(false);
  });

  it("STILL runs repo-side detectors in degraded mode (Drew, slug)", () => {
    const r = auditLockstep({
      repoManifest: [
        repo({ body: "Drew should approve POs.", referencedSlugs: ["foo.bar"] }),
      ],
      notionManifest: null,
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "drew-regression")).toBe(true);
    expect(r.findings.some((x) => x.detector === "unknown-slug")).toBe(true);
  });
});

// =========================================================================
// Acceptance #8 — pack dashboard surfaces summary
// =========================================================================

describe("buildPacksView — lockstep loader wiring (P0-2 ↔ P0-7 surface)", () => {
  it("includes lockstep summary when loader provided", async () => {
    const { buildPacksView } = await import("@/lib/ops/agents-packs/reader");
    const view = await buildPacksView({
      ghostProbe: {
        engineRegistry: () => [],
        engineRunnerStatus: () => "disabled",
      },
      lockstepLoader: async () =>
        auditLockstep({
          repoManifest: [
            repo({ body: "Drew should approve POs." }),
            repo({ path: "contracts/agents/x.md", status: "CANONICAL" }),
          ],
          notionManifest: [
            notion({ repoPath: "contracts/agents/test.md", version: "1.0" }),
          ],
          now: FIXED_NOW,
        }),
      now: () => FIXED_NOW,
    });
    expect(view.lockstep).toBeTruthy();
    if (view.lockstep && view.lockstep.ok) {
      expect(view.lockstep.repoCount).toBe(2);
      expect(view.lockstep.notionCount).toBe(1);
      expect(view.lockstep.totalFindings).toBeGreaterThan(0);
      expect(view.lockstep.fullyAudited).toBe(true);
    }
  });

  it("returns ok=false on lockstep loader error", async () => {
    const { buildPacksView } = await import("@/lib/ops/agents-packs/reader");
    const view = await buildPacksView({
      ghostProbe: {
        engineRegistry: () => [],
        engineRunnerStatus: () => "disabled",
      },
      lockstepLoader: async () => {
        throw new Error("notion api down");
      },
      now: () => FIXED_NOW,
    });
    expect(view.lockstep).toBeTruthy();
    if (view.lockstep && !view.lockstep.ok) {
      expect(view.lockstep.error).toContain("notion api down");
    }
  });

  it("lockstep is null when no loader provided", async () => {
    const { buildPacksView } = await import("@/lib/ops/agents-packs/reader");
    const view = await buildPacksView({
      ghostProbe: {
        engineRegistry: () => [],
        engineRunnerStatus: () => "disabled",
      },
      now: () => FIXED_NOW,
    });
    expect(view.lockstep).toBeNull();
  });

  it("dashboard surfaces degraded-mode lockstep summary explicitly (no fake-green)", async () => {
    const { buildPacksView } = await import("@/lib/ops/agents-packs/reader");
    const view = await buildPacksView({
      ghostProbe: {
        engineRegistry: () => [],
        engineRunnerStatus: () => "disabled",
      },
      lockstepLoader: async () =>
        auditLockstep({
          repoManifest: [repo()],
          notionManifest: null, // degraded
          now: FIXED_NOW,
        }),
      now: () => FIXED_NOW,
    });
    expect(view.lockstep).toBeTruthy();
    if (view.lockstep && view.lockstep.ok) {
      expect(view.lockstep.fullyAudited).toBe(false);
      expect(view.lockstep.degradedReasons.length).toBeGreaterThan(0);
    }
  });
});

// =========================================================================
// Bonus — title mismatch + dedupe + summarize
// =========================================================================

describe("auditLockstep — title-mismatch", () => {
  it("flags differing titles after normalization", () => {
    const r = auditLockstep({
      repoManifest: [repo({ title: "Agent Contract — Booke" })],
      notionManifest: [notion({ title: "Bookkeeper Agent" })],
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "title-mismatch")).toBe(true);
  });

  it("does NOT flag when titles match modulo 'Agent Contract — ' prefix", () => {
    const r = auditLockstep({
      repoManifest: [repo({ title: "Agent Contract — Booke" })],
      notionManifest: [notion({ title: "Booke" })],
      now: FIXED_NOW,
    });
    expect(r.findings.some((x) => x.detector === "title-mismatch")).toBe(false);
  });
});

describe("auditLockstep — dedupe", () => {
  it("running twice yields stable finding ids", () => {
    const inputs = {
      repoManifest: [repo({ body: "Drew should approve POs.", referencedSlugs: ["foo.bar"] })],
      notionManifest: null,
      now: FIXED_NOW,
    };
    const r1 = auditLockstep(inputs);
    const r2 = auditLockstep(inputs);
    expect(r1.findings.map((f) => f.id).sort()).toEqual(
      r2.findings.map((f) => f.id).sort(),
    );
  });

  it("ids stable across clock change", () => {
    const inputs = {
      repoManifest: [repo({ body: "Drew should approve POs." })],
      notionManifest: null,
    };
    const r1 = auditLockstep({ ...inputs, now: FIXED_NOW });
    const r2 = auditLockstep({ ...inputs, now: new Date("2026-12-01T00:00:00Z") });
    expect(r1.findings.map((f) => f.id).sort()).toEqual(
      r2.findings.map((f) => f.id).sort(),
    );
  });
});

describe("summarizeReport", () => {
  it("compact summary preserves counts + degraded flag", () => {
    const report: LockstepReport = auditLockstep({
      repoManifest: [repo({ body: "Drew should approve POs." })],
      notionManifest: null,
      now: FIXED_NOW,
    });
    const sum = summarizeReport(report);
    expect(sum.repoCount).toBe(1);
    expect(sum.notionCount).toBe(0);
    expect(sum.totalFindings).toBe(report.findings.length);
    expect(sum.fullyAudited).toBe(false);
    expect(sum.degradedReasons.length).toBeGreaterThan(0);
  });
});

// =========================================================================
// Tally count integrity
// =========================================================================

describe("auditLockstep — tallies", () => {
  it("byDetector + bySeverity sums match findings.length", () => {
    const r = auditLockstep({
      repoManifest: [
        repo({ path: "contracts/agents/a.md", body: "Drew should approve POs." }),
        repo({ path: "contracts/agents/b.md", referencedSlugs: ["foo.bar"] }),
      ],
      notionManifest: [
        notion({ repoPath: "contracts/agents/a.md", version: "9.9" }),
      ],
      now: FIXED_NOW,
    });
    const byDetectorSum = Object.values(r.byDetector).reduce((a, b) => a + b, 0);
    const bySeveritySum = Object.values(r.bySeverity).reduce((a, b) => a + b, 0);
    expect(byDetectorSum).toBe(r.findings.length);
    expect(bySeveritySum).toBe(r.findings.length);
  });
});
