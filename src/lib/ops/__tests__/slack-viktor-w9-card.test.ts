/**
 * Slack Viktor W-9 card renderer coverage.
 *
 * Pins:
 *   - configured=false → "not configured" copy + runbook URL surfaces
 *   - configured=true + readError → red posture + degraded warning
 *   - configured=true + queue empty → green clean copy
 *   - configured=true + queue non-empty → yellow + top rows render
 *   - top rows render vendor / amount / source / suggested category
 *   - read-only context note pinned (no QBO write fires from this card)
 *   - access runbook URL is /contracts/booke-integration-runbook.md
 *   - viktor doctrine URL is /contracts/viktor.md
 */
import { describe, expect, it } from "vitest";

import { renderViktorW9Card } from "../slack-viktor-w9-card";
import type { BookeUnreviewedTransaction } from "../booke-client";

function row(
  overrides: Partial<BookeUnreviewedTransaction> = {},
): BookeUnreviewedTransaction {
  return {
    id: "t-1",
    date: "2026-05-01",
    vendor: "Albanese",
    amount: 100,
    description: "ingredient",
    suggestedCategory: "500015 COGS",
    suggestedConfidence: 0.9,
    source: "BoA",
    ...overrides,
  };
}

describe("renderViktorW9Card", () => {
  it("not configured → posture 'not configured' + runbook URL surfaces", () => {
    const card = renderViktorW9Card({
      configured: false,
      toReviewRows: [],
    });
    expect(card.text).toMatch(/not configured/);
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/⚪️ not configured/);
    expect(blob).toMatch(/Booke has no partner REST API/);
    expect(blob).toContain("/contracts/booke-integration-runbook.md");
  });

  it("configured + read failed → red posture + degraded warning", () => {
    const card = renderViktorW9Card({
      configured: true,
      toReviewRows: [],
      readError: "Booke API 500",
    });
    expect(card.text).toMatch(/read failed/);
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/🔴 read failed/);
    expect(blob).toMatch(/Booke read failed/);
    expect(blob).toContain("Booke API 500");
  });

  it("configured + queue empty → green clean", () => {
    const card = renderViktorW9Card({
      configured: true,
      toReviewRows: [],
    });
    expect(card.text).toMatch(/queue empty/);
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/🟢 clean/);
    expect(blob).toMatch(/Queue is empty/);
  });

  it("configured + queue non-empty → yellow + top rows render", () => {
    const card = renderViktorW9Card({
      configured: true,
      toReviewRows: [
        row({ id: "a", vendor: "Albanese", amount: 100, source: "BoA" }),
        row({ id: "b", vendor: "Belmark", amount: 50, source: "BoA" }),
      ],
    });
    expect(card.text).toMatch(/2 to review/);
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/🟡 work waiting/);
    expect(blob).toMatch(/Albanese/);
    expect(blob).toMatch(/Belmark/);
    expect(blob).toContain("$100.00");
  });

  it("top rows render vendor / amount / source / suggested category", () => {
    const card = renderViktorW9Card({
      configured: true,
      toReviewRows: [
        row({
          id: "x",
          vendor: "Petro Spokane",
          amount: 115.41,
          source: "BoA",
          suggestedCategory: "vehicle maintenance",
        }),
      ],
    });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("Petro Spokane");
    expect(blob).toContain("$115.41");
    expect(blob).toContain("BoA");
    expect(blob).toContain("vehicle maintenance");
  });

  it("rows with no vendor render '(no vendor)'", () => {
    const card = renderViktorW9Card({
      configured: true,
      toReviewRows: [row({ vendor: null })],
    });
    expect(JSON.stringify(card.blocks)).toContain("(no vendor)");
  });

  it("top rows capped at 5", () => {
    const rows: BookeUnreviewedTransaction[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(row({ id: `r-${i}`, vendor: `V${i}` }));
    }
    const card = renderViktorW9Card({ configured: true, toReviewRows: rows });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("Top 5 To Review");
    expect(blob).toContain("V0");
    expect(blob).toContain("V4");
    expect(blob).not.toContain("V5"); // 6th row absent
  });

  it("read-only context note pinned + viktor.md doctrine URL on configured", () => {
    const card = renderViktorW9Card({ configured: true, toReviewRows: [] });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toMatch(/no QBO write fires from this card/i);
    expect(blob).toContain("/contracts/viktor.md");
  });

  it("not configured surfaces runbook button (not viktor doctrine)", () => {
    const card = renderViktorW9Card({ configured: false, toReviewRows: [] });
    const blob = JSON.stringify(card.blocks);
    expect(blob).toContain("/contracts/booke-integration-runbook.md");
    expect(blob).toMatch(/Open access runbook/);
  });

  it("never includes destructive verbs (apply / post / write) in action buttons", () => {
    const card = renderViktorW9Card({ configured: true, toReviewRows: [] });
    const blob = JSON.stringify(card.blocks);
    // No 'Apply category' / 'Post JE' / 'Write to QBO' on the status card
    expect(blob).not.toMatch(/Apply category/i);
    expect(blob).not.toMatch(/Post JE/i);
    expect(blob).not.toMatch(/Write to QBO/i);
  });
});
