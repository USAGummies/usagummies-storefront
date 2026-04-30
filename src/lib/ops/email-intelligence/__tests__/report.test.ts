import { describe, expect, it } from "vitest";

import {
  renderApprovalCard,
  renderEmailReport,
  type ScannedEmail,
} from "../report";
import type { EmailEnvelope } from "@/lib/ops/gmail-reader";

function makeScanned(overrides: {
  id: string;
  from: string;
  subject: string;
  snippet?: string;
  category: ScannedEmail["classification"]["category"];
  confidence?: number;
  hasDraft?: boolean;
  hasApproval?: boolean;
  alreadyEngaged?: boolean;
}): ScannedEmail {
  const env: EmailEnvelope = {
    id: overrides.id,
    threadId: `thr-${overrides.id}`,
    from: overrides.from,
    to: "ben@usagummies.com",
    subject: overrides.subject,
    date: "Fri, 24 Apr 2026 12:00:00 -0700",
    snippet: overrides.snippet ?? "",
    labelIds: ["INBOX"],
  };
  return {
    envelope: env,
    classification: {
      category: overrides.category,
      confidence: overrides.confidence ?? 0.9,
      reason: "test",
      ruleId: "test",
    },
    alreadyEngaged: overrides.alreadyEngaged ?? false,
    hasDraft: overrides.hasDraft ?? false,
    hasApproval: overrides.hasApproval ?? false,
    draftId: overrides.hasDraft ? `draft-${overrides.id}` : null,
    approvalId: overrides.hasApproval ? `appr-${overrides.id}` : null,
  };
}

describe("email-intelligence/report renderer", () => {
  it("renders 'nothing actionable' for an empty window", () => {
    const out = renderEmailReport({
      scanned: [],
      rollup: {
        scanned: 0,
        classified: 0,
        skipped: 0,
        byCategory: {} as Record<ScannedEmail["classification"]["category"], number>,
      },
      windowDescription: "last 3.0h",
    });
    expect(out).toContain("INBOX SWEEP");
    expect(out).toContain("Inbox is quiet");
  });

  it("groups by category in priority order (critical first)", () => {
    const scanned: ScannedEmail[] = [
      makeScanned({
        id: "m1",
        from: "Buyer <b@example.com>",
        subject: "Order arrived damaged",
        category: "shipping_issue",
      }),
      makeScanned({
        id: "m2",
        from: "Buyer <b@retailer.com>",
        subject: "Wholesale inquiry",
        category: "b2b_sales",
      }),
      makeScanned({
        id: "m3",
        from: "noreply@thing.com",
        subject: "Newsletter",
        category: "junk_fyi",
      }),
    ];
    const out = renderEmailReport({
      scanned,
      rollup: {
        scanned: 3,
        classified: 3,
        skipped: 0,
        byCategory: {
          shipping_issue: 1,
          b2b_sales: 1,
          junk_fyi: 1,
        } as Record<ScannedEmail["classification"]["category"], number>,
      },
      windowDescription: "last 3.0h",
    });
    const criticalIdx = out.indexOf("CRITICAL");
    const b2bIdx = out.indexOf("B2B WHOLESALE");
    const junkIdx = out.indexOf("Filed under noise");
    expect(criticalIdx).toBeGreaterThan(-1);
    expect(b2bIdx).toBeGreaterThan(criticalIdx);
    expect(junkIdx).toBeGreaterThan(b2bIdx);
  });

  it("flags 'needs approval' section when approvals are open", () => {
    const out = renderEmailReport({
      scanned: [
        makeScanned({
          id: "m1",
          from: "Buyer <b@retailer.com>",
          subject: "Wholesale inquiry",
          category: "b2b_sales",
          hasDraft: true,
          hasApproval: true,
        }),
      ],
      rollup: {
        scanned: 1,
        classified: 1,
        skipped: 0,
        byCategory: { b2b_sales: 1 } as Record<
          ScannedEmail["classification"]["category"],
          number
        >,
      },
      windowDescription: "last 3.0h",
    });
    expect(out).toContain("AWAITING YOUR CALL");
    expect(out).toContain("approvals card posted");
  });

  it("approval card preview includes truncated body + category + confidence", () => {
    const card = renderApprovalCard({
      scanned: makeScanned({
        id: "m1",
        from: "Buyer <b@retailer.com>",
        subject: "Wholesale inquiry",
        category: "b2b_sales",
        confidence: 0.85,
      }),
      draftBodyPreview: "Hi there,\n\nThanks for reaching out. " + "x".repeat(900),
    });
    expect(card).toContain("b2b_sales");
    expect(card).toContain("0.85");
    expect(card).toContain("[truncated]");
  });
});
