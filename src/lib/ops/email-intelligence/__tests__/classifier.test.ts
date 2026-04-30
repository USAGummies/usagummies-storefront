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

  // 2026-04-30 incident regression tests. The prior classifier matched the
  // bare word "samples" anywhere in the email — an inbound reply saying
  // "samples arrived, actively reviewing" misclassified as sample_request
  // and triggered a "happy to send samples" outbound (Eric Miller / Event
  // Network). The SAMPLE_RECEIVED_REGEX exclusion is the structural fix.
  // Each phrase below was observed in real-world inbound replies; they all
  // mean the buyer ALREADY has the samples and a "happy to send" reply
  // would be wrong.
  describe("samples-already-received exclusion (incident regression)", () => {
    const RECEIVED_PHRASES = [
      "Samples arrived, my team is actively reviewing",
      "We received the samples. Will share thoughts soon.",
      "Got the samples — sharing with the team this week",
      "Package arrived this morning, currently reviewing",
      "Received the box, thanks!",
      "We received your shipment yesterday",
      "Still tasting the samples",
      "Trying them out now",
      "Sharing with the team for a tasting next week",
      "Team is reviewing the samples now",
      "Currently reviewing your samples",
      "Crew is reviewing — feedback soon",
      "Samples are here. Loved the lemon.",
      "Samples landed yesterday",
      "Samples came in today",
      "Samples delivered to the office",
    ];

    for (const phrase of RECEIVED_PHRASES) {
      it(`does NOT classify "${phrase}" as sample_request`, () => {
        const c = classifyEmail(
          env({
            from: "buyer@retailer.com",
            subject: "Re: USA Gummies samples",
            snippet: phrase,
          }),
        );
        expect(c.category).not.toBe("sample_request");
      });
    }

    it("real-world Eric-Miller-shaped phrasing does NOT classify as sample_request", () => {
      const c = classifyEmail(
        env({
          from: "Eric Miller <eric@eventnetwork.com>",
          subject: "Re: USA Gummies sample request — Event Network",
          snippet:
            "Hi Ben — confirming the samples arrived at 9645 Granite Ridge yesterday. " +
            "My team is actively reviewing. Will circle back next week.",
        }),
      );
      expect(c.category).not.toBe("sample_request");
    });

    it("still classifies an actual sample REQUEST correctly when received-phrasing is absent", () => {
      const c = classifyEmail(
        env({
          from: "newbuyer@retailer.com",
          subject: "Sample request",
          snippet: "Could you send a sample pack our way?",
        }),
      );
      expect(c.category).toBe("sample_request");
    });
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
