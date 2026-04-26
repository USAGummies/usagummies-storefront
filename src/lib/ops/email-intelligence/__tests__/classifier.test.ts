import { describe, expect, it } from "vitest";

import { classifyEmail, shouldUseLlmFallback } from "../classifier";
import type { EmailEnvelope } from "@/lib/ops/gmail-reader";

function env(partial: Partial<EmailEnvelope>): EmailEnvelope {
  return {
    id: "msg-id",
    threadId: "thread-id",
    from: "Someone <someone@example.com>",
    to: "ben@usagummies.com",
    subject: "",
    date: "Fri, 24 Apr 2026 12:00:00 -0700",
    snippet: "",
    labelIds: ["INBOX"],
    ...partial,
  };
}

describe("email-intelligence/classifier", () => {
  it("flags vendor-domain senders as vendor_supply", () => {
    const c = classifyEmail(
      env({
        from: "Greg <greg@powersconfections.com>",
        subject: "Production update",
        snippet: "Run is on track for Friday.",
      }),
    );
    expect(c.category).toBe("vendor_supply");
    expect(c.confidence).toBeGreaterThanOrEqual(0.85);
    expect(c.ruleId).toBe("vendor-domain");
  });

  it("flags ShipStation/Stamps emails as receipt_document", () => {
    const c = classifyEmail(
      env({
        from: "billing@shipstation.com",
        subject: "Your invoice is ready",
      }),
    );
    expect(c.category).toBe("receipt_document");
    expect(c.confidence).toBeGreaterThan(0.8);
  });

  it("classifies Jungle-Jim's-style AP setup as ap_finance", () => {
    const c = classifyEmail(
      env({
        from: "Accounting <accounting@junglejims.com>",
        subject: "Jungle Jim's Market — New Account Setup Forms",
        snippet:
          "Please complete the W-9 and ACH enrollment so we can set up payment terms.",
      }),
    );
    expect(c.category).toBe("ap_finance");
    expect(c.confidence).toBeGreaterThan(0.85);
  });

  it("detects shipping issues", () => {
    const c = classifyEmail(
      env({
        from: "buyer@example.com",
        subject: "Order arrived damaged",
        snippet: "Hi — the bag was crushed when it got here.",
      }),
    );
    expect(c.category).toBe("shipping_issue");
  });

  it("detects sample requests but ignores decline phrases", () => {
    const wanted = classifyEmail(
      env({
        from: "buyer@retailer.com",
        subject: "Could you send a sample pack?",
        snippet: "Curious about your line.",
      }),
    );
    expect(wanted.category).toBe("sample_request");

    const declined = classifyEmail(
      env({
        from: "buyer@retailer.com",
        subject: "Re: Sample pack",
        snippet: "No thanks, not interested for our store right now.",
      }),
    );
    expect(declined.category).not.toBe("sample_request");
  });

  it("classifies wholesale/retailer pitches as b2b_sales", () => {
    const c = classifyEmail(
      env({
        from: "buyer@grocer.com",
        subject: "Wholesale pricing inquiry",
        snippet: "We're a regional distributor interested in carrying your product.",
      }),
    );
    expect(c.category).toBe("b2b_sales");
  });

  it("flags no-reply newsletters as junk_fyi", () => {
    const c = classifyEmail(
      env({
        from: "newsletter@somesite.com",
        subject: "Don't miss our weekly update",
      }),
    );
    expect(c.category).toBe("junk_fyi");
  });

  it("falls back to junk_fyi at low confidence when no rule matches", () => {
    const c = classifyEmail(
      env({
        from: "stranger@unknown.com",
        subject: "Hello",
        snippet: "Just saying hi",
      }),
    );
    expect(c.category).toBe("junk_fyi");
    expect(c.confidence).toBeLessThan(0.5);
    expect(shouldUseLlmFallback(c)).toBe(true);
  });

  it("does not invoke LLM fallback for confidently-junk newsletters", () => {
    const c = classifyEmail(
      env({
        from: "noreply@example.com",
        subject: "Don't miss our deal of the week",
      }),
    );
    expect(c.ruleId).toBe("noreply-newsletter");
    expect(shouldUseLlmFallback(c)).toBe(false);
  });
});
