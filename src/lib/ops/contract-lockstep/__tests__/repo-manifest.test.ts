/**
 * Repo-manifest reader tests — pure parsers, no fs in test mode.
 */
import { describe, expect, it } from "vitest";

import { __INTERNAL, parseRepoContract } from "../repo-manifest";

const SAMPLE = `# Agent Contract — Booke

**Status:** CANONICAL (day-one, in-the-loop)
**Version:** 1.0 — 2026-04-18
**Division:** \`financials\`
**Human owner:** Rene
**Schema:** [governance.md](../governance.md) §3

---

## Identity

The agent emits gmail.send when Ben approves and qbo.invoice.draft for Rene.
We never touch qbo.chart-of-accounts.modify (Class D).
`;

describe("parseRepoContract", () => {
  it("extracts title, status, version, owner from front-matter", () => {
    const r = parseRepoContract("contracts/agents/booke.md", SAMPLE);
    expect(r.title).toBe("Agent Contract — Booke");
    expect(r.status).toContain("CANONICAL");
    expect(r.version).toBe("1.0 — 2026-04-18");
    expect(r.versionDate).toBe("2026-04-18");
    expect(r.humanOwner).toBe("Rene");
  });

  it("scrapes referenced slugs from body", () => {
    const r = parseRepoContract("contracts/agents/booke.md", SAMPLE);
    expect(r.referencedSlugs).toContain("gmail.send");
    expect(r.referencedSlugs).toContain("qbo.invoice.draft");
    expect(r.referencedSlugs).toContain("qbo.chart-of-accounts.modify");
  });

  it("path defaults to file basename when no H1", () => {
    const r = parseRepoContract("contracts/agents/no-title.md", "Body without heading.");
    expect(r.title).toBe("no-title");
  });

  it("doctrineMarkers populated when body trips a lock pattern", () => {
    const r = parseRepoContract(
      "contracts/agents/regress.md",
      "# Test\n\nDrew should approve all PO drafts going forward.",
    );
    // The 'drew-owns-nothing' lock pattern should match.
    expect(r.doctrineMarkers).toContain("drew-owns-nothing");
  });

  it("body trimmed to MAX_BODY_LEN", () => {
    const huge = "x".repeat(60_000);
    const r = parseRepoContract("contracts/agents/huge.md", `# H\n\n${huge}`);
    expect(r.body.length).toBeLessThanOrEqual(__INTERNAL.MAX_BODY_LEN);
  });

  it("empty referencedSlugs on slug-free body", () => {
    const r = parseRepoContract(
      "contracts/agents/clean.md",
      "# Clean\n\nNo slug references in body.",
    );
    expect(r.referencedSlugs).toEqual([]);
  });

  it("filters domain-shaped false positives (gmail.com, vercel.app)", () => {
    const r = parseRepoContract(
      "contracts/agents/x.md",
      "# X\n\nEmail ben@usagummies.com or visit vercel.app.",
    );
    expect(r.referencedSlugs).not.toContain("gmail.com");
    expect(r.referencedSlugs).not.toContain("vercel.app");
    expect(r.referencedSlugs).not.toContain("usagummies.com");
  });
});

describe("__INTERNAL helpers", () => {
  it("extractVersionDate finds ISO date in version string", () => {
    expect(__INTERNAL.extractVersionDate("1.4 — 2026-04-27")).toBe("2026-04-27");
    expect(__INTERNAL.extractVersionDate("1.0")).toBeUndefined();
    expect(__INTERNAL.extractVersionDate(undefined)).toBeUndefined();
  });

  it("scanDoctrineMarkers returns matching lock ids", () => {
    expect(
      __INTERNAL.scanDoctrineMarkers("Drew should approve POs."),
    ).toContain("drew-owns-nothing");
    expect(__INTERNAL.scanDoctrineMarkers("Clean body, no doctrine triggers.")).toEqual([]);
  });
});
