import { describe, expect, it } from "vitest";

import { generateDraftReply } from "../draft";
import type { Classification } from "../classifier";
import type { EmailEnvelope } from "@/lib/ops/gmail-reader";

function env(partial: Partial<EmailEnvelope>): EmailEnvelope {
  return {
    id: "msg-id",
    threadId: "thr-id",
    from: "Someone <someone@example.com>",
    to: "ben@usagummies.com",
    subject: "Hello",
    date: "Fri, 24 Apr 2026 12:00:00 -0700",
    snippet: "",
    labelIds: ["INBOX"],
    ...partial,
  };
}

const C = (category: Classification["category"]): Classification => ({
  category,
  confidence: 0.9,
  reason: "test",
  ruleId: "test",
});

describe("email-intelligence/draft generator", () => {
  it("uses the Jungle Jim's packet body verbatim for the JJ AP thread", () => {
    const reply = generateDraftReply(
      env({
        from: "Accounting <accounting@junglejims.com>",
        subject: "Jungle Jim's Market — New Account Setup Forms",
      }),
      C("ap_finance"),
    );
    expect(reply.actionable).toBe(true);
    expect(reply.template).toBe("ap-packet:jungle-jims");
    // Packet body opens with this exact greeting per ap-packets.ts.
    expect(reply.body).toContain("Hi Jungle Jim's Accounting Team,");
    // Re: prefix is preserved from the AP packet's reply subject.
    expect(reply.subject).toMatch(/^Re:/i);
  });

  it("falls back to a generic AP template for non-JJ retailers", () => {
    const reply = generateDraftReply(
      env({
        from: "Sarah AP <sarah@bigboxretailer.com>",
        subject: "Vendor onboarding paperwork",
      }),
      C("ap_finance"),
    );
    expect(reply.actionable).toBe(true);
    expect(reply.template).toBe("ap-packet:generic-retailer");
    expect(reply.body).toContain("Vendor and Contractor Setup Form");
  });

  it("drafts a sample-request reply with shipping info ask", () => {
    const reply = generateDraftReply(
      env({
        from: "Buyer <buyer@store.com>",
        subject: "Could you send a sample pack?",
      }),
      C("sample_request"),
    );
    expect(reply.actionable).toBe(true);
    expect(reply.body).toContain("Shipping address");
  });

  it("returns no draft for receipts / junk / marketing PR", () => {
    for (const cat of ["receipt_document", "junk_fyi", "marketing_pr"] as const) {
      const reply = generateDraftReply(env({}), C(cat));
      expect(reply.actionable).toBe(false);
      expect(reply.drafting).toBe("manual");
      expect(reply.body).toBe("");
    }
  });

  it("never embeds medical or unverified claims (signature only)", () => {
    const replies = [
      generateDraftReply(env({ subject: "shipping issue" }), C("shipping_issue")),
      generateDraftReply(env({ subject: "wholesale" }), C("b2b_sales")),
      generateDraftReply(env({ subject: "support" }), C("customer_support")),
    ];
    for (const r of replies) {
      const body = r.body.toLowerCase();
      expect(body).not.toContain("halal");
      expect(body).not.toContain("kosher");
      expect(body).not.toContain("fda approved");
      expect(body).not.toContain("vitamin");
      expect(body).not.toContain("supplement");
    }
  });
});
