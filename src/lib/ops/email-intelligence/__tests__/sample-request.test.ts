import { describe, expect, it } from "vitest";

import { classifyEmail } from "../classifier";
import { generateDraftReply } from "../draft";
import {
  evaluateSampleRequest,
  parseShipToFromEmail,
} from "../sample-request";
import type { EmailEnvelope } from "@/lib/ops/gmail-reader";

function env(partial: Partial<EmailEnvelope>): EmailEnvelope {
  return {
    id: "msg-id",
    threadId: "thr-id",
    from: "Buyer <buyer@store.com>",
    to: "ben@usagummies.com",
    subject: "Sample request",
    date: "Fri, 24 Apr 2026 12:00:00 -0700",
    snippet: "",
    labelIds: ["INBOX"],
    ...partial,
  };
}

describe("email-intelligence/sample-request", () => {
  describe("classifier integration", () => {
    it("classifies emails asking for samples as sample_request", () => {
      const c = classifyEmail(
        env({
          subject: "Could you send a sample pack?",
          snippet: "We're a regional grocer interested in carrying your line.",
        }),
      );
      expect(c.category).toBe("sample_request");
      expect(c.confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe("ship-to extraction", () => {
    it("extracts a complete US ship-to from a clean email body", () => {
      const parsed = parseShipToFromEmail(
        env({
          from: "Sarah Smith <sarah@bigboxretailer.com>",
          subject: "Sample request — Sarah Smith / 5972 CHICKNEY DR / NOBLESVILLE, IN 46062",
          snippet:
            "Please ship to 5972 CHICKNEY DR. NOBLESVILLE, IN 46062-5525. Thanks!",
        }),
      );
      expect(parsed.confidence).toBe("high");
      expect(parsed.name).toContain("Sarah");
      expect(parsed.street1).toContain("5972");
      expect(parsed.city?.toUpperCase()).toBe("NOBLESVILLE");
      expect(parsed.state).toBe("IN");
      expect(parsed.postalCode).toMatch(/^46062/);
    });

    it("flags missing fields when address is incomplete", () => {
      const e = evaluateSampleRequest(
        env({
          subject: "Could you send samples?",
          snippet: "Hi — would love to try the gummies. Reply with details.",
        }),
      );
      expect(e.ready).toBe(false);
      expect(e.missing).toContain("street1");
      expect(e.missing).toContain("city");
      expect(e.missing).toContain("state");
      expect(e.missing).toContain("postalCode");
      // Sender's display name still picked up from From header.
      expect(e.parsed.name).toBeTruthy();
    });

    it("rejects fake state codes (XX, ZZ) and accepts only US 2-letter", () => {
      const parsed = parseShipToFromEmail(
        env({
          subject: "test",
          snippet: "Ship to 1 Fake St Nowhere, ZZ 99999",
        }),
      );
      expect(parsed.state).toBeUndefined();
      expect(parsed.city).toBeUndefined();
      expect(parsed.postalCode).toBeUndefined();
    });
  });

  describe("dispatch hand-off", () => {
    it("builds a manual-channel sample OrderIntent when address is complete", () => {
      const e = evaluateSampleRequest(
        env({
          id: "abc123def456",
          from: "Sarah Smith <sarah@retailer.com>",
          subject: "Send a sample pack",
          snippet:
            "Address: 5972 CHICKNEY DR. NOBLESVILLE, IN 46062. Thanks!",
        }),
      );
      expect(e.ready).toBe(true);
      expect(e.intent).toBeDefined();
      expect(e.intent!.channel).toBe("manual");
      expect(e.intent!.tags).toContain("sample");
      expect(e.intent!.packagingType).toBe("case");
      expect(e.intent!.cartons).toBe(1);
      expect(e.intent!.shipTo.state).toBe("IN");
      expect(e.intent!.sourceId).toBe("email:abc123def456");
      expect(e.intent!.orderNumber).toMatch(/^SAMPLE-/);
    });

    it("does not invent missing fields — incomplete address yields no intent", () => {
      const e = evaluateSampleRequest(
        env({
          subject: "samples please",
          snippet: "interested",
        }),
      );
      expect(e.ready).toBe(false);
      expect(e.intent).toBeUndefined();
    });
  });

  describe("draft template (asks for missing details)", () => {
    it("sample-request draft asks for shipping address when missing", () => {
      const reply = generateDraftReply(
        env({
          subject: "samples please",
          snippet: "Curious about your gummies",
        }),
        {
          category: "sample_request",
          confidence: 0.9,
          reason: "test",
          ruleId: "sample-request",
        },
      );
      expect(reply.actionable).toBe(true);
      expect(reply.body.toLowerCase()).toContain("shipping address");
      expect(reply.body.toLowerCase()).toContain("phone number");
    });
  });

  describe("approval safety (no label without approval)", () => {
    it("does not contain language that promises shipping without confirmation", () => {
      const reply = generateDraftReply(
        env({ subject: "send samples" }),
        {
          category: "sample_request",
          confidence: 0.9,
          reason: "test",
          ruleId: "sample-request",
        },
      );
      const body = reply.body.toLowerCase();
      // Must not promise dates / tracking / a shipment without ack.
      expect(body).not.toContain("shipped today");
      expect(body).not.toContain("tracking number");
      expect(body).not.toContain("here's your tracking");
      expect(body).not.toContain("on its way");
    });

    it("intent uses channel=manual so it routes through approval gate, not auto-ship", () => {
      const e = evaluateSampleRequest(
        env({
          subject: "sample",
          snippet: "5972 CHICKNEY DR. NOBLESVILLE, IN 46062",
          from: "Sarah <s@s.com>",
        }),
      );
      // Auto-ship operates on Amazon FBM + Shopify orders only. channel="manual"
      // forces the dispatch route to open a Class B approval, not buy a label.
      expect(e.intent?.channel).toBe("manual");
    });
  });
});
