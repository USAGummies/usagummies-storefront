/**
 * Tests for the Faire Direct follow-up email template.
 *
 * Locked contracts:
 *   - Subject is the exact string FAIRE_FOLLOW_UP_SUBJECT.
 *   - Body contains retailerName, buyerName (when present), and the
 *     directLinkUrl verbatim.
 *   - Body contains NO medical / supplement / vitamin / immune / cure /
 *     treat / FDA / heal / "health benefit" claims.
 *   - Body contains NO pricing / terms / lead-time / payment /
 *     commission / margin promises.
 *   - Body closing carries operator-only contact (ben@usagummies.com)
 *     — never a personal cell phone, never a personal cell area code,
 *     never SMS / "text me" / WhatsApp invitations.
 *   - Body never echoes recipient PII back (HubSpot id, internal id).
 */
import { describe, expect, it } from "vitest";

import {
  FAIRE_FOLLOW_UP_SUBJECT,
  renderFaireFollowUpEmailBody,
} from "../follow-up-template";
import type { FaireInviteRecord } from "../invites";

const NOW = "2026-04-30T12:00:00Z";

function fakeRecord(
  overrides: Partial<FaireInviteRecord> = {},
): FaireInviteRecord {
  return {
    id: "buyer@retailer.com",
    retailerName: "Whole Foods Pacific NW",
    email: "buyer@retailer.com",
    source: "wholesale-page",
    status: "sent",
    queuedAt: NOW,
    updatedAt: NOW,
    sentAt: NOW,
    directLinkUrl: "https://faire.com/direct/usagummies/exact-link-9",
    ...overrides,
  };
}

describe("FAIRE_FOLLOW_UP_SUBJECT — locked subject", () => {
  it("matches the locked string exactly", () => {
    expect(FAIRE_FOLLOW_UP_SUBJECT).toBe(
      "Quick check-in — USA Gummies on Faire Direct",
    );
  });
});

describe("renderFaireFollowUpEmailBody — content invariants", () => {
  it("contains the directLinkUrl verbatim", () => {
    const body = renderFaireFollowUpEmailBody(fakeRecord());
    expect(body).toContain(
      "https://faire.com/direct/usagummies/exact-link-9",
    );
  });

  it("contains the retailerName", () => {
    const body = renderFaireFollowUpEmailBody(
      fakeRecord({ retailerName: "Pioneer General Store" }),
    );
    expect(body).toContain("Pioneer General Store");
  });

  it("uses buyerName for greeting when present, falls back to retailerName otherwise", () => {
    const withBuyer = renderFaireFollowUpEmailBody(
      fakeRecord({ buyerName: "Sarah Smith" }),
    );
    expect(withBuyer.startsWith("Hi Sarah Smith,")).toBe(true);

    const withoutBuyer = renderFaireFollowUpEmailBody(
      fakeRecord({
        buyerName: undefined,
        retailerName: "Pioneer Co",
      }),
    );
    expect(withoutBuyer.startsWith("Hi Pioneer Co,")).toBe(true);
  });

  it("contains NO medical / supplement / vitamin / immune / FDA claims", () => {
    const body = renderFaireFollowUpEmailBody(fakeRecord());
    const banned = [
      /vitamin/i,
      /supplement/i,
      /cure/i,
      /treat\b/i,
      /immune/i,
      /FDA/i,
      /diagnose/i,
      /heal\b/i,
      /\bheal\s/i,
      /health\s+benefit/i,
    ];
    for (const re of banned) {
      expect(body).not.toMatch(re);
    }
  });

  it("contains NO pricing / terms / lead-time / commission / margin promises", () => {
    const body = renderFaireFollowUpEmailBody(fakeRecord());
    const bannedCommercial = [
      /\$\d/, // any dollar amount
      /\d+%\s*off/i,
      /commission/i,
      /\bmargin/i,
      /lead\s*time/i,
      /net\s*\d+/i, // "Net 30" payment terms
      /free\s+shipping/i,
      /MOQ/i,
      /minimum\s+order/i,
      /payment\s+terms/i,
    ];
    for (const re of bannedCommercial) {
      expect(body).not.toMatch(re);
    }
  });

  it("closing carries operator-only contact (ben@usagummies.com)", () => {
    const body = renderFaireFollowUpEmailBody(fakeRecord());
    expect(body).toContain("ben@usagummies.com");
    expect(body).toContain("USA Gummies");
  });

  it("contains NO personal cell phone / SMS / WhatsApp invitations", () => {
    const body = renderFaireFollowUpEmailBody(fakeRecord());
    const personalContact = [
      /text\s+me/i,
      /SMS/i,
      /WhatsApp/i,
      /\bcell\b/i,
      /\bmobile\b/i,
      // No US phone-shaped strings (xxx) xxx-xxxx or xxx-xxx-xxxx — the
      // company contact is email-only by policy in the follow-up.
      /\(\d{3}\)\s*\d{3}-?\d{4}/,
      /\b\d{3}-\d{3}-\d{4}\b/,
    ];
    for (const re of personalContact) {
      expect(body).not.toMatch(re);
    }
  });

  it("does NOT echo recipient PII back (HubSpot id, internal id, recipient email)", () => {
    const body = renderFaireFollowUpEmailBody(
      fakeRecord({
        id: "secret-internal-key-9999",
        hubspotContactId: "hs-12345",
        email: "private-buyer@example.com",
        buyerName: "Sarah",
      }),
    );
    // The id and HubSpot id never appear in the body. (The recipient's
    // email IS the To: header — we don't echo it INSIDE the body copy.)
    expect(body).not.toContain("secret-internal-key-9999");
    expect(body).not.toContain("hs-12345");
    expect(body).not.toContain("private-buyer@example.com");
  });

  it("body is short — under 1500 characters (one-paragraph nudge, not a re-pitch)", () => {
    const body = renderFaireFollowUpEmailBody(fakeRecord());
    expect(body.length).toBeLessThan(1500);
  });
});
