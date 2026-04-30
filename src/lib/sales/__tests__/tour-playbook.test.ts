import { describe, expect, it } from "vitest";

import {
  buildSalesTourPlaybookReport,
  parseSalesTourMarkdown,
  summarizeSalesTourProspects,
} from "../tour-playbook";

const MARKDOWN = `
### 🟦 Segment 5 — SLC metro UT
| Prospect | Type | HubSpot Contact | Verified Email | Action |
|---|---|---|---|---|
| **Thanksgiving Point — Mike Hippler** ⭐ | **Reunion warm — CLOSED** | Mike Hippler · Retail Director | mhippler@thanksgivingpoint.org ✅ | **5/11 in-person delivery + invoice** |
| **Lagoon Amusement Park** 🔥 | NEW — major family destination | TBD | TBD | Viktor research |
| (gap to be researched) | | | | scan needed |

### 🟢 Tier 1 — Named buyer confirmed, outreach already sent (2)
| # | Venue | Buyer | Email | Sent |
|---|---|---|---|---|
| V-17 | Park City Museum | Liza Shoell — Retail Mgr | retail@parkcityhistory.org | ✅ 4/29 |
| V-14 | Clark Planetarium | David Ortiz | (385) 468-1226 | ☎ Call task |

### 🟡 Tier 2 — Gift shop confirmed, buyer TBD or generic email
| # | Venue | Contact path | Phone |
|---|---|---|---|
| V-38 | Tlaquepaque Arts & Shopping Village | info@tlaq.com | (928) 282-4838 |
| V-12 | Natural History Museum of Utah | Phone | (801) 581-6927 |

### 🔵 Supplemental routing stops — contact only, no email send
| # | Venue | Notes |
|---|---|---|
| V-28 | Antelope Canyon Gift Shop | Walk-in |
`;

describe("sales tour playbook", () => {
  it("parses supported markdown tables without fabricating gap rows", () => {
    const { prospects, gapsSkipped } = parseSalesTourMarkdown(MARKDOWN);
    expect(gapsSkipped).toBe(1);
    expect(prospects.map((p) => p.prospect)).toEqual([
      "Thanksgiving Point — Mike Hippler ⭐",
      "Lagoon Amusement Park 🔥",
      "Park City Museum",
      "Clark Planetarium",
      "Tlaquepaque Arts & Shopping Village",
      "Natural History Museum of Utah",
      "Antelope Canyon Gift Shop",
    ]);
  });

  it("classifies verified, sent, phone, generic, research, and customer rows", () => {
    const { prospects } = parseSalesTourMarkdown(MARKDOWN);
    const byName = new Map(prospects.map((p) => [p.prospect, p]));

    expect(byName.get("Thanksgiving Point — Mike Hippler ⭐")).toMatchObject({
      contactStatus: "closed_or_customer",
      prioritySignal: "closed",
    });
    expect(byName.get("Lagoon Amusement Park 🔥")).toMatchObject({
      contactStatus: "research_needed",
      prioritySignal: "hot",
    });
    expect(byName.get("Park City Museum")).toMatchObject({
      contactStatus: "sent",
    });
    expect(byName.get("Clark Planetarium")).toMatchObject({
      contactStatus: "phone_or_call",
    });
    expect(byName.get("Tlaquepaque Arts & Shopping Village")).toMatchObject({
      contactStatus: "generic_email",
    });
  });

  it("summarizes counts from real parsed rows only", () => {
    const parsed = parseSalesTourMarkdown(MARKDOWN);
    const summary = summarizeSalesTourProspects(parsed.prospects, parsed.gapsSkipped);

    expect(summary.total).toBe(7);
    expect(summary.routeSegmentRows).toBe(2);
    expect(summary.vicinityRows).toBe(5);
    expect(summary.alreadySent).toBe(1);
    expect(summary.researchNeeded).toBe(2);
    expect(summary.callTasks).toBe(2);
    expect(summary.closedOrCustomer).toBe(1);
    expect(summary.warmOrHot).toBe(1);
    expect(summary.gapsSkipped).toBe(1);
  });

  it("builds a deterministic report envelope", () => {
    const report = buildSalesTourPlaybookReport(MARKDOWN, {
      generatedAt: "2026-04-30T12:00:00.000Z",
      source: "contract.md",
    });

    expect(report.generatedAt).toBe("2026-04-30T12:00:00.000Z");
    expect(report.source).toBe("contract.md");
    expect(report.sections.some((s) => s.group === "route_segment")).toBe(true);
    expect(report.summary.total).toBe(7);
  });

  it("handles empty markdown honestly", () => {
    const report = buildSalesTourPlaybookReport("", {
      generatedAt: "2026-04-30T12:00:00.000Z",
      source: "empty.md",
    });
    expect(report.summary.total).toBe(0);
    expect(report.prospects).toEqual([]);
    expect(report.sections).toEqual([]);
  });
});
