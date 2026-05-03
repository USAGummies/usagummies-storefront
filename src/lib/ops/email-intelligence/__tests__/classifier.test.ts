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

  // 2026-05-03 patches — Day 2 audit fixes. AREA15 auto-responder,
  // John Schirano polite decline, Kevin Albert "no need" pass — each
  // had been triggering an outbound draft. New rule-0 catches them.
  describe("auto-responder + polite-decline (2026-05-03 audit fixes)", () => {
    it("flags AREA15-style 'Automatic reply: ...' subject as junk_fyi (no draft)", () => {
      const c = classifyEmail(
        env({
          from: "AREA15 Info <info@area15corp.onmicrosoft.com>",
          subject: "Automatic reply: All American Gummy Bears — wholesale fit",
          snippet: "Thank you for contacting AREA15! This is an unmonitored and no-reply inbox.",
        }),
      );
      expect(c.category).toBe("junk_fyi");
      expect(c.ruleId).toBe("auto-responder");
    });

    it("flags 'Out of Office' subject as junk_fyi", () => {
      const c = classifyEmail(
        env({
          from: "buyer@example.com",
          subject: "Out of Office: Re: USA Gummies",
          snippet: "I'm currently away from the office.",
        }),
      );
      expect(c.category).toBe("junk_fyi");
      expect(c.ruleId).toBe("auto-responder");
    });

    it("flags vacation-responder body as junk_fyi", () => {
      const c = classifyEmail(
        env({
          from: "buyer@retailer.com",
          subject: "Re: Wholesale pricing",
          snippet: "I am out of the office until Monday May 12. Will respond on my return.",
        }),
      );
      expect(c.category).toBe("junk_fyi");
      expect(c.ruleId).toBe("auto-responder");
    });

    it("flags John Schirano-style 'we will not be able to add them' as junk_fyi (polite-decline)", () => {
      const c = classifyEmail(
        env({
          from: "John Schirano <jschirano@delawarenorth.com>",
          subject: "Re: USA Gummies for Yellowstone General Stores",
          snippet:
            "Thank you...yes, we did get the samples. At this time, we will not be able to add them to our set for the season.",
        }),
      );
      expect(c.category).toBe("junk_fyi");
      expect(c.ruleId).toBe("polite-decline");
    });

    it("flags Kevin-Albert-style 'no current need' as polite-decline (was misclassified as shipping_issue)", () => {
      const c = classifyEmail(
        env({
          from: "Kevin Albert <kalbert@ollies.us>",
          subject: "RE: All American Gummy Bears for Ollie's",
          snippet:
            "Thanks Ben item looks great but at this time I would pass just no current need in the gummy space going into summer.",
        }),
      );
      expect(c.category).toBe("junk_fyi");
      expect(c.ruleId).toBe("polite-decline");
    });

    it("flags 'going to pass' / 'not a fit right now' patterns", () => {
      const variants = [
        "Going to pass on this for now, thanks though.",
        "Not a fit right now — maybe revisit Q4.",
        "We'll reach out if anything changes.",
        "Appreciate the offer but won't be moving forward.",
        "Not interested at this time.",
      ];
      for (const snippet of variants) {
        const c = classifyEmail(
          env({
            from: "buyer@retailer.com",
            subject: "Re: USA Gummies",
            snippet,
          }),
        );
        expect(c.ruleId).toBe("polite-decline");
      }
    });

    it("preserves real B2B inquiries even when phrased politely", () => {
      const c = classifyEmail(
        env({
          from: "buyer@grocer.com",
          subject: "Wholesale pricing inquiry",
          snippet: "We're a regional distributor and would love to carry your line.",
        }),
      );
      // "We" / "love" / "would" don't match polite-decline patterns;
      // wholesale + distributor + carry should still hit b2b_sales.
      expect(c.category).toBe("b2b_sales");
    });
  });
});
