import { describe, expect, it } from "vitest";

import {
  buildProspectPlaybookReport,
  parseWholesaleProspectCsv,
  summarizeProspects,
} from "../prospect-playbook";

const CSV = `firstName,lastName,title,company,email,phone,city,state,category,why_target,priority
Jane,Doe,Buyer,"Comma, Store",jane@example.com,555-1111,Austin,TX,cstore,"Buyer has verified email.",A
,,Category Manager,RaceTrac,,,Atlanta,GA,cstore,"RangeMe outreach is the right path.",A
,,Buyer,Phone Shop,,555-2222,Wall,SD,park,"Phone-only buyer.",B
,,Buyer,Unknown Shop,,,Nowhere,ZZ,museum,"Needs research.",C
`;

describe("wholesale prospect playbook", () => {
  it("parses quoted CSV rows without fabricating fields", () => {
    const rows = parseWholesaleProspectCsv(CSV);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        rowNumber: 2,
        company: "Comma, Store",
        email: "jane@example.com",
        contactMode: "email_ready",
      }),
    );
  });

  it("classifies RangeMe, phone-only, and research-needed records", () => {
    const modes = parseWholesaleProspectCsv(CSV).map((row) => row.contactMode);
    expect(modes).toEqual([
      "email_ready",
      "range_me",
      "phone_only",
      "research_needed",
    ]);
  });

  it("skips blank-company rows instead of inventing a prospect", () => {
    const rows = parseWholesaleProspectCsv(`${CSV},,,,,,,,,,\n`);
    expect(rows.map((r) => r.company)).not.toContain("");
  });

  it("summarizes priority, category, and contact-mode counts", () => {
    const summary = summarizeProspects(parseWholesaleProspectCsv(CSV));
    expect(summary.total).toBe(4);
    expect(summary.priorityCounts).toEqual({ A: 2, B: 1, C: 1 });
    expect(summary.categoryCounts).toEqual({ cstore: 2, park: 1, museum: 1 });
    expect(summary.contactModeCounts.email_ready).toBe(1);
    expect(summary.needsManualResearch).toBe(3);
  });

  it("builds a deterministic report envelope from caller-supplied time/source", () => {
    const report = buildProspectPlaybookReport(CSV, {
      generatedAt: "2026-04-29T12:00:00.000Z",
      source: "test.csv",
    });
    expect(report.generatedAt).toBe("2026-04-29T12:00:00.000Z");
    expect(report.source).toBe("test.csv");
    expect(report.summary.emailReady).toBe(1);
  });

  it("rejects unexpected headers fail-closed", () => {
    expect(() => parseWholesaleProspectCsv("bad,header\nx,y\n")).toThrow(
      "Unexpected wholesale prospect CSV header",
    );
  });
});
