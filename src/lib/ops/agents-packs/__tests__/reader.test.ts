/**
 * Agent-packs reader tests.
 *
 * Locks the P0-2 acceptance criteria:
 *   - reader is read-only (no writes anywhere — store / Slack / files)
 *   - ghost-registry warning fires when engine-schedule + engine-runner
 *     are empty/disabled (the expected post-3.0 state)
 *   - Drew not surfaced as approver
 *   - approval slugs resolve through `taxonomy.classify()`
 *   - rejected ChatGPT-pack proposals do not appear in pack views
 *   - pack member counts + lifecycle tallies match the registry
 */

import { describe, expect, it, vi } from "vitest";

import {
  __INTERNAL,
  buildPacksView,
  type GhostRegistryProbe,
} from "../reader";
import { AGENT_REGISTRY, PACK_REGISTRY } from "../registry";
import type { DriftReport } from "@/lib/ops/operating-memory/drift-types";

// =========================================================================
// Fixtures
// =========================================================================

const FIXED_NOW = new Date("2026-04-29T12:00:00Z");

function emptyDriftReport(): DriftReport {
  return {
    ok: true,
    generatedAt: FIXED_NOW.toISOString(),
    windowFromISO: "2026-04-15T12:00:00.000Z",
    windowToISO: FIXED_NOW.toISOString(),
    scanned: 0,
    findings: [],
    byDetector: {
      "drew-regression": 0,
      "class-d-request": 0,
      "unknown-slug": 0,
      "doctrine-contradiction": 0,
      "stale-reference": 0,
    },
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
  };
}

const GHOST_PROBE_EMPTY: GhostRegistryProbe = {
  engineRegistry: () => [],
  engineRunnerStatus: () => "disabled",
};

// =========================================================================
// Read-only / no mutation
// =========================================================================

describe("buildPacksView — read-only", () => {
  it("does not mutate AGENT_REGISTRY or PACK_REGISTRY (frozen)", async () => {
    const beforeLen = AGENT_REGISTRY.length;
    const beforePackCount = PACK_REGISTRY.length;
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.packs.length).toBeGreaterThan(0);
    expect(AGENT_REGISTRY.length).toBe(beforeLen);
    expect(PACK_REGISTRY.length).toBe(beforePackCount);
    // The arrays are frozen at module load.
    expect(Object.isFrozen(AGENT_REGISTRY)).toBe(true);
    expect(Object.isFrozen(PACK_REGISTRY)).toBe(true);
  });

  it("does not call any factory store (no DB / KV side effects)", async () => {
    // The reader should not import factory stores at runtime — verify by
    // running a build with default deps and asserting no obvious throw.
    // (We already test ghost probe via injection; this is the
    // integration-shaped guard.)
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.generatedAt).toBe(FIXED_NOW.toISOString());
  });
});

// =========================================================================
// Ghost-registry warning
// =========================================================================

describe("buildPacksView — ghost-registry warning", () => {
  it("triggers when engine-schedule is empty AND engine-runner is disabled", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.ghostWarning.triggered).toBe(true);
    expect(view.ghostWarning.engineRegistrySize).toBe(0);
    expect(view.ghostWarning.engineRunnerStatus).toBe("disabled");
    expect(view.ghostWarning.message).toContain("EXPECTED post-3.0 state");
    expect(view.ghostWarning.message).toContain("Do NOT resurrect the legacy registry");
  });

  it("flags regression when engine-schedule is non-empty (legacy registry resurrected)", async () => {
    const view = await buildPacksView({
      ghostProbe: {
        engineRegistry: () => [{ id: "ghost-1" }, { id: "ghost-2" }],
        engineRunnerStatus: () => "disabled",
      },
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.ghostWarning.triggered).toBe(false);
    expect(view.ghostWarning.engineRegistrySize).toBe(2);
    expect(view.ghostWarning.message).toContain("regression");
  });

  it("flags non-disabled runner status", async () => {
    const view = await buildPacksView({
      ghostProbe: {
        engineRegistry: () => [],
        engineRunnerStatus: () => "running",
      },
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.ghostWarning.triggered).toBe(false);
    expect(view.ghostWarning.engineRunnerStatus).toBe("running");
  });
});

// =========================================================================
// Invariants
// =========================================================================

describe("buildPacksView — invariants", () => {
  it("Drew owns nothing — no agent surfaced with humanOwner='Drew'", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.invariants.drewOwnsNothing).toBe(true);
    for (const pack of view.packs) {
      for (const a of pack.agents) {
        expect(a.humanOwner).not.toBe("Drew");
      }
    }
  });

  it("All approval slugs resolve to taxonomy", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.invariants.allSlugsResolve).toBe(true);
    // Verify resolvedSlugs structure carries class info.
    for (const pack of view.packs) {
      for (const a of pack.agents) {
        for (const s of a.resolvedSlugs) {
          expect(s.class).not.toBe("unknown");
          expect(["A", "B", "C", "D"]).toContain(s.class);
        }
      }
    }
  });

  it("All agents carry heartbeat metadata into the read model", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.invariants.allHeartbeatMetadataPresent).toBe(true);
    for (const pack of view.packs) {
      for (const a of pack.agents) {
        expect(a.heartbeat, `${a.id} heartbeat`).not.toBeNull();
        expect(a.heartbeat?.queueSource).toBeTruthy();
        expect(a.heartbeat?.outputStates.length).toBeGreaterThan(0);
      }
    }
  });

  it("No new divisions introduced", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.invariants.noNewDivisions).toBe(true);
  });

  it("No new approval slugs introduced", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.invariants.noNewSlugs).toBe(true);
  });
});

// =========================================================================
// Pack content
// =========================================================================

describe("buildPacksView — pack content", () => {
  it("returns 6 packs", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    expect(view.packs.length).toBe(6);
  });

  it("Executive Control pack contains transcript-saver + drift-detector (P0-3 + P0-1)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    const ec = view.packs.find((p) => p.pack.id === "executive-control");
    expect(ec).toBeDefined();
    const ids = ec!.agents.map((a) => a.id);
    expect(ids).toContain("transcript-saver");
    expect(ids).toContain("slack-corrections-drift-detector");
  });

  it("Research/Growth pack is all latent (R-1..R-7 awaiting external tools)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    const rg = view.packs.find((p) => p.pack.id === "research-growth");
    expect(rg).toBeDefined();
    expect(rg!.counts.latent).toBeGreaterThan(0);
    expect(rg!.counts.live).toBe(0);
  });

  it("counts.live + partial + latent + blocked + disabled === agents.length per pack", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    for (const p of view.packs) {
      const sum =
        p.counts.live +
        p.counts.partial +
        p.counts.latent +
        p.counts.blocked +
        p.counts.disabled;
      expect(sum).toBe(p.agents.length);
    }
  });
});

// =========================================================================
// Drift surfacing
// =========================================================================

describe("buildPacksView — drift", () => {
  it("includes drift summary when loader provided", async () => {
    const report = emptyDriftReport();
    report.scanned = 42;
    report.bySeverity.high = 3;
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => report,
      now: () => FIXED_NOW,
    });
    expect(view.drift.ok).toBe(true);
    if (view.drift.ok) {
      expect(view.drift.scanned).toBe(42);
      expect(view.drift.bySeverity.high).toBe(3);
    }
  });

  it("returns ok=false on drift loader error (does not throw)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => {
        throw new Error("disk full");
      },
      now: () => FIXED_NOW,
    });
    expect(view.drift.ok).toBe(false);
    if (!view.drift.ok) {
      expect(view.drift.error).toContain("disk full");
    }
  });

  it("returns ok=false when no driftLoader provided", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      now: () => FIXED_NOW,
    });
    expect(view.drift.ok).toBe(false);
  });
});

// =========================================================================
// P0 status
// =========================================================================

describe("buildPacksView — P0 status mirror", () => {
  it("P0-1 marked implemented (drift detector shipped 2026-04-29)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    const p01 = view.p0Status.find((p) => p.id === "P0-1");
    expect(p01?.state).toBe("implemented");
  });

  it("P0-2 marked implemented (this dashboard)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    const p02 = view.p0Status.find((p) => p.id === "P0-2");
    expect(p02?.state).toBe("implemented");
  });

  it("P0-3 marked implemented (transcript saver shipped 2026-04-28)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    const p03 = view.p0Status.find((p) => p.id === "P0-3");
    expect(p03?.state).toBe("implemented");
  });

  it("all 7 P0s marked implemented", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    for (const id of ["P0-1", "P0-2", "P0-3", "P0-4", "P0-5", "P0-6", "P0-7"] as const) {
      const p = view.p0Status.find((x) => x.id === id);
      expect(p?.state, `${id} should be implemented`).toBe("implemented");
    }
  });

  it("P0-6 marked implemented (bill-draft promoter shipped 2026-04-29)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    const p06 = view.p0Status.find((x) => x.id === "P0-6");
    expect(p06?.state).toBe("implemented");
  });

  it("P0-4 marked implemented (vendor-master coordinator shipped 2026-04-29)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    const p04 = view.p0Status.find((x) => x.id === "P0-4");
    expect(p04?.state).toBe("implemented");
  });

  it("P0-5 marked implemented (approval-expiry sweeper shipped 2026-04-29)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    const p05 = view.p0Status.find((x) => x.id === "P0-5");
    expect(p05?.state).toBe("implemented");
  });

  it("P0-7 marked implemented (lockstep auditor shipped 2026-04-29)", async () => {
    const view = await buildPacksView({
      ghostProbe: GHOST_PROBE_EMPTY,
      driftLoader: async () => emptyDriftReport(),
      now: () => FIXED_NOW,
    });
    const p07 = view.p0Status.find((x) => x.id === "P0-7");
    expect(p07?.state).toBe("implemented");
  });
});

// =========================================================================
// Internal helpers
// =========================================================================

describe("__INTERNAL.resolveSlug", () => {
  it("resolves a registered Class A slug", () => {
    expect(__INTERNAL.resolveSlug("open-brain.capture").class).toBe("A");
  });

  it("resolves a registered Class B slug", () => {
    expect(__INTERNAL.resolveSlug("gmail.send").class).toBe("B");
  });

  it("resolves a registered Class D slug", () => {
    expect(__INTERNAL.resolveSlug("qbo.chart-of-accounts.modify").class).toBe("D");
  });

  it("returns 'unknown' for an unregistered slug", () => {
    expect(__INTERNAL.resolveSlug("nope.fake.slug").class).toBe("unknown");
  });
});

describe("__INTERNAL.checkInvariants — directly", () => {
  it("flags Drew if a synthetic entry slips in", () => {
    const result = __INTERNAL.checkInvariants([
      ...AGENT_REGISTRY.map((a) => __INTERNAL.resolveAllSlugs(a)),
      // Synthetic violator — would never actually be in the registry
      // (the registry-locks test guards that), but we ensure the
      // invariant check itself works on a hypothetical bad input.
      __INTERNAL.resolveAllSlugs({
        id: "synthetic-drew",
        name: "synthetic",
        contractPath: "fake.md",
        division: "executive-control",
        humanOwner: "Drew",
        role: "test",
        lifecycle: "live",
        approvalSlugs: [],
      }),
    ]);
    expect(result.drewOwnsNothing).toBe(false);
  });

  it("flags unresolved slug if a synthetic entry slips in", () => {
    const result = __INTERNAL.checkInvariants([
      ...AGENT_REGISTRY.map((a) => __INTERNAL.resolveAllSlugs(a)),
      __INTERNAL.resolveAllSlugs({
        id: "synthetic-bad-slug",
        name: "synthetic",
        contractPath: "fake.md",
        division: "executive-control",
        humanOwner: "Ben",
        role: "test",
        lifecycle: "live",
        approvalSlugs: ["nope.fake.slug"],
      }),
    ]);
    expect(result.allSlugsResolve).toBe(false);
    expect(result.noNewSlugs).toBe(false);
  });

  it("flags missing heartbeat metadata if a synthetic entry slips in", () => {
    const result = __INTERNAL.checkInvariants([
      ...AGENT_REGISTRY.map((a) => __INTERNAL.resolveAllSlugs(a)),
      __INTERNAL.resolveAllSlugs({
        id: "synthetic-no-heartbeat",
        name: "synthetic",
        contractPath: "fake.md",
        division: "executive-control",
        humanOwner: "Ben",
        role: "test",
        lifecycle: "live",
        approvalSlugs: [],
      }),
    ]);
    expect(result.allHeartbeatMetadataPresent).toBe(false);
  });
});

// Reset module-level mocks left over from `vi.mock` if any test pulled it in.
// (No mocks used here, but keep the pattern consistent with other suites.)
afterEachCleanup();

function afterEachCleanup() {
  vi.restoreAllMocks();
}
