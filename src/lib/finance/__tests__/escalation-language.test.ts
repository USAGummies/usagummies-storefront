/**
 * Escalation-language coverage — Phase 36.5.
 *
 * Pins:
 *   - STANDARD_ESCALATION_CLAUSE matches Rene's verbatim 2026-04-29 PM
 *     directive (key phrases). A future tweak that changes the legal
 *     intent breaks the test.
 *   - Each variant key in ESCALATION_CLAUSES has a non-empty string and
 *     mentions reorder/pricing semantics.
 *   - pickEscalationClause dispatches each known case to the right
 *     variant (sample / strategic / anchor / pickup / fill / landed /
 *     sub-mc).
 *   - The booth-quote re-export (escalationClauseFor) returns the same
 *     text as the canonical pickEscalationClause for matching inputs —
 *     no drift between surfaces.
 *   - renderEscalationBlock formats the clause with a leading marker.
 *   - AP-packet template embeds STANDARD_ESCALATION_CLAUSE (Phase 36.5
 *     injection, the missing piece per /contracts/financial-mechanisms-blueprint.md
 *     §6.6).
 */
import { describe, expect, it } from "vitest";

import {
  defaultEscalationClause,
  ESCALATION_CLAUSES,
  pickEscalationClause,
  renderEscalationBlock,
  STANDARD_ESCALATION_CLAUSE,
  type EscalationClauseVariant,
} from "../escalation-language";
import { escalationClauseFor } from "@/lib/sales-tour/escalation-clause";
import {
  buildApPacketDraft,
  getApPacketTemplate,
  listApPacketTemplates,
} from "@/lib/ops/ap-packets/templates";

describe("STANDARD_ESCALATION_CLAUSE — Rene's 2026-04-29 PM directive", () => {
  it("contains the locked-launch phrase", () => {
    expect(STANDARD_ESCALATION_CLAUSE.toLowerCase()).toContain(
      "launch pricing is locked",
    );
  });

  it("names the cost categories that can move (Rene asked for these explicitly)", () => {
    const lower = STANDARD_ESCALATION_CLAUSE.toLowerCase();
    expect(lower).toContain("ingredient");
    expect(lower).toContain("packaging");
    expect(lower).toContain("freight");
  });

  it("promises notice before adjustment (no surprise rugpull)", () => {
    expect(STANDARD_ESCALATION_CLAUSE.toLowerCase()).toContain(
      "notice before adjustment",
    );
  });

  it("is exported as the default via defaultEscalationClause()", () => {
    expect(defaultEscalationClause()).toBe(STANDARD_ESCALATION_CLAUSE);
  });
});

describe("ESCALATION_CLAUSES — every variant non-empty + on-message", () => {
  const variants: EscalationClauseVariant[] = [
    "default",
    "anchor",
    "pickup-floor",
    "fill",
    "landed-standard",
    "sub-mc",
    "sample",
    "strategic-exception",
  ];

  it("every declared variant is present + non-empty", () => {
    for (const v of variants) {
      expect(ESCALATION_CLAUSES[v], `variant ${v}`).toBeTruthy();
      expect(ESCALATION_CLAUSES[v].length).toBeGreaterThan(40);
    }
  });

  it("anchor + pickup-floor mention 90 days (longest exposure)", () => {
    expect(ESCALATION_CLAUSES.anchor).toMatch(/90 days/);
    expect(ESCALATION_CLAUSES["pickup-floor"]).toMatch(/90 days/);
  });

  it("landed-standard mentions 30 days (tighter window since freight is market-exposed)", () => {
    expect(ESCALATION_CLAUSES["landed-standard"]).toMatch(/30 days/);
  });

  it("sample + strategic-exception mention this-order-only (no protection)", () => {
    expect(ESCALATION_CLAUSES.sample.toLowerCase()).toContain("this order only");
    expect(
      ESCALATION_CLAUSES["strategic-exception"].toLowerCase(),
    ).toContain("this order only");
  });
});

describe("pickEscalationClause — dispatch", () => {
  it("C-EXC + ≤6 bags → sample variant", () => {
    expect(pickEscalationClause({ pricingClass: "C-EXC", totalBags: 6 }).variant).toBe(
      "sample",
    );
    expect(pickEscalationClause({ pricingClass: "C-EXC", totalBags: 1 }).variant).toBe(
      "sample",
    );
  });

  it("C-EXC + >6 bags → strategic-exception variant", () => {
    expect(pickEscalationClause({ pricingClass: "C-EXC", totalBags: 36 }).variant).toBe(
      "strategic-exception",
    );
  });

  it("C-ANCH → anchor variant (regardless of bag count)", () => {
    expect(pickEscalationClause({ pricingClass: "C-ANCH", totalBags: 2700 }).variant).toBe(
      "anchor",
    );
    expect(pickEscalationClause({ pricingClass: "C-ANCH", totalBags: 5400 }).variant).toBe(
      "anchor",
    );
  });

  it("C-PU → pickup-floor variant", () => {
    expect(pickEscalationClause({ pricingClass: "C-PU", totalBags: 36 }).variant).toBe(
      "pickup-floor",
    );
  });

  it("C-FILL → fill variant", () => {
    expect(pickEscalationClause({ pricingClass: "C-FILL", totalBags: 900 }).variant).toBe(
      "fill",
    );
  });

  it("C-STD + ≥36 bags → landed-standard variant", () => {
    expect(pickEscalationClause({ pricingClass: "C-STD", totalBags: 36 }).variant).toBe(
      "landed-standard",
    );
    expect(pickEscalationClause({ pricingClass: "C-STD", totalBags: 900 }).variant).toBe(
      "landed-standard",
    );
  });

  it("sub-master-carton (<36 bags, non-exception) → sub-mc variant", () => {
    expect(pickEscalationClause({ pricingClass: "C-STD", totalBags: 6 }).variant).toBe(
      "sub-mc",
    );
  });

  it("returns text that matches the variant in ESCALATION_CLAUSES (no drift)", () => {
    const r = pickEscalationClause({ pricingClass: "C-ANCH", totalBags: 2700 });
    expect(r.text).toBe(ESCALATION_CLAUSES.anchor);
  });
});

describe("Booth-quote escalationClauseFor delegates to canonical (no drift)", () => {
  it("anchor pricing class → same string from both surfaces", () => {
    const canonical = pickEscalationClause({
      pricingClass: "C-ANCH",
      totalBags: 2700,
    }).text;
    const boothExport = escalationClauseFor({
      pricingClass: "C-ANCH",
      approval: "class-c",
      totalBags: 2700,
    });
    expect(boothExport).toBe(canonical);
  });

  it("sample drop → same string from both surfaces", () => {
    const canonical = pickEscalationClause({
      pricingClass: "C-EXC",
      totalBags: 6,
    }).text;
    const boothExport = escalationClauseFor({
      pricingClass: "C-EXC",
      approval: "class-c",
      totalBags: 6,
    });
    expect(boothExport).toBe(canonical);
  });

  it("standard landed master carton → same string from both surfaces", () => {
    const canonical = pickEscalationClause({
      pricingClass: "C-STD",
      totalBags: 36,
    }).text;
    const boothExport = escalationClauseFor({
      pricingClass: "C-STD",
      approval: "none",
      totalBags: 36,
    });
    expect(boothExport).toBe(canonical);
  });
});

describe("renderEscalationBlock — format for AP packet / invoice memo", () => {
  it("default produces a 3-line block with leading marker", () => {
    const block = renderEscalationBlock();
    const lines = block.split("\n");
    expect(lines[0]).toBe("--");
    expect(lines[1]).toBe("Pricing terms:");
    expect(lines[2]).toBe(STANDARD_ESCALATION_CLAUSE);
  });

  it("variant key resolves to the matching ESCALATION_CLAUSES entry", () => {
    const block = renderEscalationBlock("anchor");
    expect(block).toContain(ESCALATION_CLAUSES.anchor);
  });

  it("raw-string passthrough — caller-supplied custom clause renders verbatim", () => {
    const custom = "Custom pricing terms — call for reorder.";
    const block = renderEscalationBlock(custom);
    expect(block).toContain(custom);
  });
});

describe("AP packet template injection (Phase 36.5)", () => {
  it("the canonical USA-Gummies AP-packet base template embeds the escalation clause", () => {
    // Find the template by listing all + matching the canonical body
    // marker. (Slugs are owned by the registry; tests stay slug-agnostic.)
    const all = listApPacketTemplates();
    expect(all.length).toBeGreaterThan(0);
    // At least one template carries the escalation clause in its
    // reply-draft body.
    const withEscalation = all.filter((t) =>
      t.replyDraftSkeleton.bodyTemplate
        .toLowerCase()
        .includes("launch pricing is locked"),
    );
    expect(
      withEscalation.length,
      "no AP-packet template carries the escalation clause — Phase 36.5 regression",
    ).toBeGreaterThan(0);
    for (const t of withEscalation) {
      expect(t.replyDraftSkeleton.bodyTemplate.toLowerCase()).toContain(
        "notice before adjustment",
      );
    }
  });

  it("rendered draft body still carries the escalation clause", () => {
    const all = listApPacketTemplates();
    const tpl = all.find((t) =>
      t.replyDraftSkeleton.bodyTemplate
        .toLowerCase()
        .includes("launch pricing is locked"),
    );
    if (!tpl) {
      // covered by the test above; skip silently if the registry is empty
      return;
    }
    const looked = getApPacketTemplate(tpl.slug);
    expect(looked).toBeTruthy();
    const draft = buildApPacketDraft({
      slug: "test-prep",
      templateSlug: tpl.slug,
      accountName: "Test Retailer",
      apEmail: "ap@test-retailer.example.com",
    });
    expect(draft.replyDraft.body.toLowerCase()).toContain(
      "launch pricing is locked",
    );
  });
});
