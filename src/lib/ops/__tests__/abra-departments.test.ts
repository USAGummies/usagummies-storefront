import { describe, expect, it } from "vitest";
import {
  DEPARTMENTS,
  getWorkstreamContext,
  matchWorkstreams,
  routeToDepartment,
} from "@/lib/ops/abra-departments";

describe("abra-departments", () => {
  it("routes Rene's email to finance by exact sender", () => {
    const result = routeToDepartment(
      "gonz1rene@outlook.com",
      "Need account detail",
      "Please send books data",
    );
    expect(result.department.id).toBe("finance");
    expect(result.matchReason).toBe("sender:gonz1rene@outlook.com");
  });

  it("routes known domains to sales", () => {
    const result = routeToDepartment(
      "newbuyer@inderbitzin.com",
      "Intro",
      "We carry products for distribution",
    );
    expect(result.department.id).toBe("sales");
    expect(result.matchReason).toBe("domain:inderbitzin.com");
  });

  it("routes invoice keywords to finance", () => {
    const result = routeToDepartment(
      "unknown@example.com",
      "Invoice attached",
      "Please review payment due this week",
    );
    expect(result.department.id).toBe("finance");
    expect(result.matchReason.startsWith("keyword:")).toBe(true);
  });

  it("routes production keywords to operations", () => {
    const result = routeToDepartment(
      "unknown@example.com",
      "Production schedule",
      "Inventory and shipping timing changed",
    );
    expect(result.department.id).toBe("operations");
  });

  it("falls back to executive when nothing matches", () => {
    const result = routeToDepartment(
      "mystery@example.com",
      "Hello there",
      "Just checking in",
    );
    expect(result.department.id).toBe("executive");
    expect(result.matchReason).toBe("fallback");
  });

  it("returns active workstream context for finance", () => {
    const context = getWorkstreamContext(DEPARTMENTS.finance, "gonz1rene@outlook.com");
    expect(context).toContain("ACTIVE WORKSTREAMS FOR FINANCE & ACCOUNTING");
    expect(context).toContain("Books Build");
    expect(context).toContain("Monthly Close");
  });

  it("matches workstreams by owner and keyword-rich content", () => {
    const matches = matchWorkstreams(
      DEPARTMENTS.finance,
      "gonz1rene@outlook.com",
      "Books build request",
      "Rene Gonzalez needs chart of accounts and monthly close support",
    );
    expect(matches.some((ws) => ws.id === "ws-books-build")).toBe(true);
    expect(matches.some((ws) => ws.id === "ws-monthly-close")).toBe(true);
  });

  it("returns no workstreams for executive with no active workstreams", () => {
    const matches = matchWorkstreams(
      DEPARTMENTS.executive,
      "founder@example.com",
      "Strategy",
      "Discuss priorities",
    );
    expect(matches).toHaveLength(0);
  });
});
