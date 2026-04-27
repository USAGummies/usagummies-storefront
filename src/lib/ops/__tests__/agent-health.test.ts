/**
 * Phase 28L.4 — Agent-health doctrine evaluator + manifest.
 *
 * Locks the contract:
 *   - Every manifest entry has the required fields and uses the
 *     closed enums for classification / approvalClass / lifecycle /
 *     owner.
 *   - Manifest contains NO "drew" owner anywhere — Ben 2026-04-27
 *     "drew owns nothing" is enforced as a manifest-level invariant.
 *   - evaluateAgentDoctrine flags: drew-owns, unowned,
 *     job-without-approver, task-without-justification, runtime-broken.
 *   - Health roll-up: empty → green; only soft flag → yellow; any
 *     other flag → red.
 *   - summarizeAgentHealth counts each bucket correctly.
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_MANIFEST,
  buildAgentHealthRows,
  evaluateAgentDoctrine,
  summarizeAgentHealth,
  type AgentManifestEntry,
} from "../agent-health";

const VALID_CLASSIFICATIONS = new Set(["task", "job"]);
const VALID_CLASSES = new Set(["A", "B", "C", "D"]);
const VALID_LIFECYCLES = new Set([
  "proposed",
  "active",
  "graduated",
  "retired",
  "parked",
]);
const VALID_OWNERS = new Set(["ben", "rene", "claude", "drew", "unowned"]);
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

describe("AGENT_MANIFEST — doctrinal invariants", () => {
  it("has unique kebab-case ids", () => {
    const ids = new Set<string>();
    for (const e of AGENT_MANIFEST) {
      expect(e.id).toMatch(KEBAB);
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
  });

  it("uses only the closed enums", () => {
    for (const e of AGENT_MANIFEST) {
      expect(VALID_CLASSIFICATIONS.has(e.classification)).toBe(true);
      expect(VALID_CLASSES.has(e.approvalClass)).toBe(true);
      expect(VALID_LIFECYCLES.has(e.lifecycle)).toBe(true);
      expect(VALID_OWNERS.has(e.owner)).toBe(true);
      if (e.approver !== null) {
        expect(VALID_OWNERS.has(e.approver)).toBe(true);
      }
    }
  });

  it("contains no 'drew' owners — \"drew owns nothing\" is doctrine", () => {
    for (const e of AGENT_MANIFEST) {
      expect(e.owner).not.toBe("drew");
    }
  });

  it("every entry has a non-empty name + purpose", () => {
    for (const e of AGENT_MANIFEST) {
      expect(e.name.trim().length).toBeGreaterThan(0);
      expect(e.purpose.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("evaluateAgentDoctrine — individual flags", () => {
  const baseJob: AgentManifestEntry = {
    id: "x",
    name: "X",
    contract: "/contracts/agents/x.md",
    classification: "job",
    approvalClass: "A",
    owner: "ben",
    approver: null,
    lifecycle: "active",
    purpose: "test",
  };

  it("clean Class A job → green", () => {
    expect(evaluateAgentDoctrine(baseJob).health).toBe("green");
    expect(evaluateAgentDoctrine(baseJob).flags).toEqual([]);
  });

  it("flags drew-owned → red", () => {
    const r = evaluateAgentDoctrine({ ...baseJob, owner: "drew" });
    expect(r.health).toBe("red");
    expect(r.flags.some((f) => f.flag === "drew-owns")).toBe(true);
  });

  it("flags unowned → red", () => {
    const r = evaluateAgentDoctrine({ ...baseJob, owner: "unowned" });
    expect(r.health).toBe("red");
    expect(r.flags.some((f) => f.flag === "unowned")).toBe(true);
  });

  it("Class B job without approver → red", () => {
    const r = evaluateAgentDoctrine({
      ...baseJob,
      approvalClass: "B",
      approver: null,
    });
    expect(r.health).toBe("red");
    expect(r.flags.some((f) => f.flag === "job-without-approver")).toBe(true);
  });

  it("Class B job WITH approver → green", () => {
    const r = evaluateAgentDoctrine({
      ...baseJob,
      approvalClass: "B",
      approver: "ben",
    });
    expect(r.health).toBe("green");
  });

  it("Class A job is exempt from approver requirement", () => {
    const r = evaluateAgentDoctrine({
      ...baseJob,
      approvalClass: "A",
      approver: null,
    });
    expect(r.health).toBe("green");
  });

  it("active task without notes → yellow (soft)", () => {
    const r = evaluateAgentDoctrine({
      ...baseJob,
      classification: "task",
      lifecycle: "active",
      notes: undefined,
    });
    expect(r.health).toBe("yellow");
    expect(r.flags.some((f) => f.flag === "task-without-justification")).toBe(
      true,
    );
  });

  it("active task WITH notes → green", () => {
    const r = evaluateAgentDoctrine({
      ...baseJob,
      classification: "task",
      lifecycle: "active",
      notes: "Task by design — research curation is intentionally human-led.",
    });
    expect(r.health).toBe("green");
  });

  it("proposed task without notes does NOT trip the justification flag", () => {
    const r = evaluateAgentDoctrine({
      ...baseJob,
      classification: "task",
      lifecycle: "proposed",
      notes: undefined,
    });
    expect(
      r.flags.some((f) => f.flag === "task-without-justification"),
    ).toBe(false);
  });

  it("runtimeBroken=true → red regardless of other fields", () => {
    const r = evaluateAgentDoctrine({ ...baseJob, runtimeBroken: true });
    expect(r.health).toBe("red");
    expect(r.flags.some((f) => f.flag === "runtime-broken")).toBe(true);
  });

  it("multiple flags fire together — combined → red even when one is soft", () => {
    const r = evaluateAgentDoctrine({
      ...baseJob,
      classification: "task",
      lifecycle: "active",
      owner: "drew",
      notes: undefined,
    });
    // drew-owns + task-without-justification → red (drew is hard).
    expect(r.health).toBe("red");
    expect(r.flags.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildAgentHealthRows", () => {
  it("returns one row per manifest entry, with flags + health computed", () => {
    const rows = buildAgentHealthRows();
    expect(rows.length).toBe(AGENT_MANIFEST.length);
    for (const r of rows) {
      expect(["green", "yellow", "red"]).toContain(r.health);
      expect(Array.isArray(r.doctrineFlags)).toBe(true);
    }
  });

  it("the live manifest produces no drew-owns flags (manifest is clean)", () => {
    const rows = buildAgentHealthRows();
    for (const r of rows) {
      expect(
        r.doctrineFlags.some((f) => f.flag === "drew-owns"),
      ).toBe(false);
    }
  });

  it("custom manifest is respected", () => {
    const rows = buildAgentHealthRows([
      {
        id: "drew-test",
        name: "Drew Test",
        contract: "",
        classification: "job",
        approvalClass: "B",
        owner: "drew",
        approver: null,
        lifecycle: "active",
        purpose: "test fixture",
      },
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].health).toBe("red");
    // Both drew-owns AND job-without-approver should fire.
    const flagSet = new Set(rows[0].doctrineFlags.map((f) => f.flag));
    expect(flagSet.has("drew-owns")).toBe(true);
    expect(flagSet.has("job-without-approver")).toBe(true);
  });
});

describe("summarizeAgentHealth", () => {
  it("counts reconcile to total + bucket counts match", () => {
    const rows = buildAgentHealthRows();
    const s = summarizeAgentHealth(rows);
    expect(s.total).toBe(rows.length);
    expect(s.green + s.yellow + s.red).toBe(s.total);
    expect(s.jobs + s.tasks).toBe(s.total);
    // Lifecycle sum must equal total too.
    const lifecycleSum =
      s.byLifecycle.proposed +
      s.byLifecycle.active +
      s.byLifecycle.graduated +
      s.byLifecycle.retired +
      s.byLifecycle.parked;
    expect(lifecycleSum).toBe(s.total);
    // Class sum must equal total.
    const classSum =
      s.byApprovalClass.A +
      s.byApprovalClass.B +
      s.byApprovalClass.C +
      s.byApprovalClass.D;
    expect(classSum).toBe(s.total);
  });

  it("drewOwnedCount is 0 on the live (clean) manifest", () => {
    const rows = buildAgentHealthRows();
    expect(summarizeAgentHealth(rows).drewOwnedCount).toBe(0);
  });

  it("drewOwnedCount counts custom drew-owned entries", () => {
    const rows = buildAgentHealthRows([
      {
        id: "x",
        name: "X",
        contract: "",
        classification: "job",
        approvalClass: "B",
        owner: "drew",
        approver: "drew",
        lifecycle: "active",
        purpose: "test",
      },
      {
        id: "y",
        name: "Y",
        contract: "",
        classification: "job",
        approvalClass: "B",
        owner: "ben",
        approver: "ben",
        lifecycle: "active",
        purpose: "test",
      },
    ]);
    expect(summarizeAgentHealth(rows).drewOwnedCount).toBe(1);
  });

  it("zero-len input returns all zeros (no NaN)", () => {
    const s = summarizeAgentHealth([]);
    expect(s.total).toBe(0);
    expect(s.green).toBe(0);
    expect(s.yellow).toBe(0);
    expect(s.red).toBe(0);
    expect(s.jobs).toBe(0);
    expect(s.tasks).toBe(0);
    expect(s.drewOwnedCount).toBe(0);
  });
});
