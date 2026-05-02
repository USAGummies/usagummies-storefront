/**
 * Workpack prompt-pack registry coverage — Build 6 finish.
 *
 * Pins:
 *   - Every department has at most one pack (no duplicates).
 *   - All 5 expected packs are registered (sales / finance / email /
 *     shipping / marketing).
 *   - Every pack's readTools start with /api/ops/ (no third-party URLs).
 *   - Every pack has at least one department-specific prohibition not
 *     covered by the global list.
 *   - PROHIBITED_GLOBAL is non-empty + contains the canonical bans.
 *   - Per-pack: dailyChecklist is non-trivial (≥ 100 chars).
 *   - Per-pack: humanHandoff.slug + humanHandoff.fields are non-empty.
 */
import { describe, expect, it } from "vitest";

import {
  PROHIBITED_GLOBAL,
  WORKPACK_PROMPT_PACKS,
  WORKPACK_PROMPT_PACK_BY_DEPARTMENT,
  packReadToolsAreLocal,
  packsHaveDeptSpecificProhibitions,
  packsHaveUniqueDepartments,
} from "..";

describe("WORKPACK_PROMPT_PACKS — registry shape", () => {
  it("ships all 5 expected department packs", () => {
    const departments = WORKPACK_PROMPT_PACKS.map((p) => p.department).sort();
    expect(departments).toEqual([
      "email",
      "finance",
      "marketing",
      "sales",
      "shipping",
    ]);
  });

  it("each department appears at most once", () => {
    expect(packsHaveUniqueDepartments()).toBe(true);
  });

  it("WORKPACK_PROMPT_PACK_BY_DEPARTMENT looks up each pack", () => {
    expect(
      WORKPACK_PROMPT_PACK_BY_DEPARTMENT.sales?.department,
    ).toBe("sales");
    expect(
      WORKPACK_PROMPT_PACK_BY_DEPARTMENT.finance?.department,
    ).toBe("finance");
    expect(
      WORKPACK_PROMPT_PACK_BY_DEPARTMENT.email?.department,
    ).toBe("email");
    expect(
      WORKPACK_PROMPT_PACK_BY_DEPARTMENT.shipping?.department,
    ).toBe("shipping");
    expect(
      WORKPACK_PROMPT_PACK_BY_DEPARTMENT.marketing?.department,
    ).toBe("marketing");
  });
});

describe("PROHIBITED_GLOBAL — canonical bans", () => {
  it("is non-empty + lists the global rules", () => {
    expect(PROHIBITED_GLOBAL.length).toBeGreaterThan(5);
    const joined = PROHIBITED_GLOBAL.join("\n").toLowerCase();
    expect(joined).toMatch(/gmail/);
    expect(joined).toMatch(/qbo/);
    expect(joined).toMatch(/shopify/);
    expect(joined).toMatch(/shipstation/);
    expect(joined).toMatch(/ad spend/);
    expect(joined).toMatch(/charge a card|payment/);
  });
});

describe("Per-pack invariants", () => {
  it.each(WORKPACK_PROMPT_PACKS.map((p) => [p.department, p]))(
    "%s pack: readTools all /api/ops/* paths",
    (_dept, pack) => {
      for (const url of pack.readTools) {
        expect(url.startsWith("/api/ops/")).toBe(true);
      }
    },
  );

  it.each(WORKPACK_PROMPT_PACKS.map((p) => [p.department, p]))(
    "%s pack: has ≥ 1 prohibited action",
    (_dept, pack) => {
      expect(pack.prohibitedActions.length).toBeGreaterThan(0);
    },
  );

  it.each(WORKPACK_PROMPT_PACKS.map((p) => [p.department, p]))(
    "%s pack: dailyChecklist is non-trivial (≥ 100 chars)",
    (_dept, pack) => {
      expect(pack.dailyChecklist.length).toBeGreaterThan(100);
    },
  );

  it.each(WORKPACK_PROMPT_PACKS.map((p) => [p.department, p]))(
    "%s pack: humanHandoff slug + fields populated",
    (_dept, pack) => {
      expect(pack.humanHandoff.slug.length).toBeGreaterThan(0);
      expect(pack.humanHandoff.fields.length).toBeGreaterThan(0);
    },
  );

  it("packReadToolsAreLocal returns true for the registry", () => {
    expect(packReadToolsAreLocal()).toBe(true);
  });

  it("packsHaveDeptSpecificProhibitions returns true for the registry", () => {
    expect(packsHaveDeptSpecificProhibitions()).toBe(true);
  });

  it.each(WORKPACK_PROMPT_PACKS.map((p) => [p.department, p]))(
    "%s pack: role is non-empty + ≥ 30 chars",
    (_dept, pack) => {
      expect(pack.role.length).toBeGreaterThan(30);
    },
  );

  it.each(WORKPACK_PROMPT_PACKS.map((p) => [p.department, p]))(
    "%s pack: at least one allowedOutput",
    (_dept, pack) => {
      expect(pack.allowedOutputs.length).toBeGreaterThan(0);
    },
  );
});

describe("Department-specific doctrine", () => {
  it("email pack hard-stops on whale-class records", () => {
    const pack = WORKPACK_PROMPT_PACK_BY_DEPARTMENT.email!;
    const blob = pack.prohibitedActions.join("\n").toLowerCase();
    expect(blob).toMatch(/whale/);
  });

  it("shipping pack refuses Drew-routing (Ben 2026-04-27 doctrine)", () => {
    const pack = WORKPACK_PROMPT_PACK_BY_DEPARTMENT.shipping!;
    const blob = pack.prohibitedActions.join("\n").toLowerCase();
    expect(blob).toMatch(/drew/);
  });

  it("finance pack forbids QBO chart-of-accounts mutation (Rene-only)", () => {
    const pack = WORKPACK_PROMPT_PACK_BY_DEPARTMENT.finance!;
    const blob = pack.prohibitedActions.join("\n").toLowerCase();
    expect(blob).toMatch(/chart of accounts/);
  });

  it("marketing pack forbids spend launch + claim mutations", () => {
    const pack = WORKPACK_PROMPT_PACK_BY_DEPARTMENT.marketing!;
    const blob = pack.prohibitedActions.join("\n").toLowerCase();
    expect(blob).toMatch(/launch/);
    expect(blob).toMatch(/fda|claim/);
  });

  it("sales pack treats stage moves as proposal-only", () => {
    const pack = WORKPACK_PROMPT_PACK_BY_DEPARTMENT.sales!;
    const blob = pack.prohibitedActions.join("\n").toLowerCase();
    expect(blob).toMatch(/stage/);
  });
});
