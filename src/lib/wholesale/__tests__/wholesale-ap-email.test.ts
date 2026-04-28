/**
 * Phase 35.f.3.c — wholesale-AP onboarding packet email body tests.
 *
 * Locked contracts:
 *   - Subject: ASCII-only, embeds company + invoice number when present
 *   - Body greeting uses first-name extraction from contactName
 *   - Order block enumerates each line with B-tier designator + qty + bags + $
 *   - Pluralization correct (1 master carton vs 3 master cartons)
 *   - totalUsdOverride embedded when provided (for credit-line scenarios)
 *   - Net terms default to "Net 10 / Due on Receipt" (Apr 13 Rene-lock)
 *   - Upload URL defaults to /upload/ncs (canonical)
 *   - Sender footer hardcodes Ben's phone + email per Apr 13 CIF-001 lock
 *   - Personal note prepended above greeting when provided
 *   - Attachments enumeration matches the labels passed in
 *   - Throws on missing prospect or empty orderLines (defensive)
 *   - Custom freight required → flagged in the line block
 */
import { describe, expect, it } from "vitest";

import {
  __INTERNAL,
  buildApPacketEmail,
} from "../wholesale-ap-email";
import { summarizeOrderLine } from "../pricing-tiers";
import type { OnboardingState } from "../onboarding-flow";

function buildState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    flowId: "wf_ap_001",
    currentStep: "ap-email-sent",
    stepsCompleted: ["info", "store-type", "pricing-shown", "order-type"],
    orderLines: [summarizeOrderLine("B3", 15)], // Mike's order: 15 MC × $3.25
    timestamps: {},
    prospect: {
      companyName: "Thanksgiving Point",
      contactName: "Mike Hippler",
      contactEmail: "mhippler@thanksgivingpoint.org",
    },
    paymentPath: "accounts-payable",
    ...overrides,
  };
}

const BASIC_CTX = {
  attachmentLabels: [
    "New_Customer_Setup_Form_USA_Gummies.pdf (please complete + return)",
    "Customer_Information_Form_USA_Gummies.pdf (our W-9 + ACH info — for your records)",
  ],
};

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

describe("buildApPacketEmail — subject", () => {
  it("embeds company name", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.subject).toContain("Thanksgiving Point");
  });

  it("embeds invoice number when provided", () => {
    const r = buildApPacketEmail(buildState(), {
      ...BASIC_CTX,
      invoiceNumber: "1755",
    });
    expect(r.subject).toContain("Invoice 1755");
  });

  it("omits invoice fragment when not provided", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.subject).not.toMatch(/Invoice/);
  });

  it("is ASCII-only (no em-dash, per Apr 27 spam-fix doctrine)", () => {
    const r = buildApPacketEmail(buildState(), {
      ...BASIC_CTX,
      invoiceNumber: "1755",
    });
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7E]*$/.test(r.subject)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Greeting + body structure
// ---------------------------------------------------------------------------

describe("buildApPacketEmail — greeting", () => {
  it("uses first-name extraction (Mike Hippler → Hi Mike)", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.body).toMatch(/^Hi Mike,/m);
  });

  it("falls back to full name when single token", () => {
    const r = buildApPacketEmail(
      buildState({
        prospect: {
          companyName: "Acme",
          contactName: "Cher",
          contactEmail: "c@y.com",
        },
      }),
      BASIC_CTX,
    );
    expect(r.body).toMatch(/^Hi Cher,/m);
  });

  it("falls back to 'there' on empty contactName", () => {
    const r = buildApPacketEmail(
      buildState({
        prospect: {
          companyName: "Acme",
          contactName: "  ",
          contactEmail: "c@y.com",
        },
      }),
      BASIC_CTX,
    );
    expect(r.body).toMatch(/^Hi there,/m);
  });
});

// ---------------------------------------------------------------------------
// Order block
// ---------------------------------------------------------------------------

describe("buildApPacketEmail — order block", () => {
  it("enumerates each order line with B-tier designator", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.body).toMatch(/B3/);
    expect(r.body).toMatch(/15 master cartons/);
    expect(r.body).toMatch(/540 bags/);
  });

  it("singular noun for 1-unit order (1 master carton not 1 master cartons)", () => {
    const r = buildApPacketEmail(
      buildState({ orderLines: [summarizeOrderLine("B2", 1)] }),
      BASIC_CTX,
    );
    expect(r.body).toMatch(/1 master carton /);
    expect(r.body).not.toMatch(/1 master cartons/);
  });

  it("plural noun for multi-unit order", () => {
    const r = buildApPacketEmail(
      buildState({ orderLines: [summarizeOrderLine("B5", 4)] }),
      BASIC_CTX,
    );
    expect(r.body).toMatch(/4 pallets/);
  });

  it("computes total from line subtotals", () => {
    const r = buildApPacketEmail(
      buildState({ orderLines: [summarizeOrderLine("B3", 15)] }),
      BASIC_CTX,
    );
    // 15 × 36 × $3.25 = $1,755.00
    expect(r.body).toMatch(/Total: \$1755\.00/);
  });

  it("respects totalUsdOverride for credit-line scenarios", () => {
    const r = buildApPacketEmail(
      buildState({ orderLines: [summarizeOrderLine("B3", 15)] }),
      { ...BASIC_CTX, totalUsdOverride: 1755.0 }, // landed-freight comp included; total stays $1,755
    );
    expect(r.body).toMatch(/Total: \$1755\.00/);
  });

  it("flags custom-freight requirement when ANY line crosses 3+ pallet threshold", () => {
    const r = buildApPacketEmail(
      buildState({ orderLines: [summarizeOrderLine("B5", 5)] }),
      BASIC_CTX,
    );
    expect(r.body).toMatch(/Custom freight quote required at 3\+ pallets/);
  });
});

// ---------------------------------------------------------------------------
// Net terms + upload URL
// ---------------------------------------------------------------------------

describe("buildApPacketEmail — terms + upload", () => {
  it("default net terms = 'Net 10 / Due on Receipt' per Apr 13 CIF-001 lock", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.body).toMatch(/Net 10/);
    expect(r.body).toMatch(/Due on Receipt/);
  });

  it("netTermsLabel override respected", () => {
    const r = buildApPacketEmail(buildState(), {
      ...BASIC_CTX,
      netTermsLabel: "Net 30",
    });
    expect(r.body).toContain("Payment terms: Net 30");
  });

  it("default upload URL = /upload/ncs", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.body).toContain("https://www.usagummies.com/upload/ncs");
  });

  it("uploadNcsUrl override respected", () => {
    const r = buildApPacketEmail(buildState(), {
      ...BASIC_CTX,
      uploadNcsUrl: "https://staging.example.com/upload/ncs",
    });
    expect(r.body).toContain("https://staging.example.com/upload/ncs");
  });
});

// ---------------------------------------------------------------------------
// Personal note + attachments enumeration
// ---------------------------------------------------------------------------

describe("buildApPacketEmail — personal note", () => {
  it("prepends personal note above greeting when provided", () => {
    const r = buildApPacketEmail(buildState(), {
      ...BASIC_CTX,
      personalNote: "Per our call today.",
    });
    const personalIdx = r.body.indexOf("Per our call today.");
    const greetingIdx = r.body.indexOf("Hi Mike,");
    expect(personalIdx).toBeGreaterThanOrEqual(0);
    expect(greetingIdx).toBeGreaterThan(personalIdx);
  });

  it("omits personal note section when not provided", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.body.split("Hi Mike,")[0].trim()).toBe("");
  });
});

describe("buildApPacketEmail — attachments enumeration", () => {
  it("lists each attachment label with bullet", () => {
    const r = buildApPacketEmail(buildState(), {
      attachmentLabels: ["a.pdf", "b.pdf", "c.pdf"],
    });
    expect(r.body).toMatch(/3 documents attached:/);
    expect(r.body).toContain("- a.pdf");
    expect(r.body).toContain("- b.pdf");
    expect(r.body).toContain("- c.pdf");
  });

  it("singular when only 1 attachment", () => {
    const r = buildApPacketEmail(buildState(), {
      attachmentLabels: ["only.pdf"],
    });
    expect(r.body).toMatch(/1 document attached:/);
  });

  it("flags zero-attachment as a packet error (defense-in-depth body content)", () => {
    const r = buildApPacketEmail(buildState(), { attachmentLabels: [] });
    expect(r.body).toMatch(/none/);
    expect(r.body).toMatch(/flag this/);
  });
});

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

describe("buildApPacketEmail — footer", () => {
  it("includes Ben's phone (Apr 13 CIF-001 lock: 307-209-4928)", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.body).toContain("(307) 209-4928");
  });

  it("includes ben@usagummies.com (only authorized sender per Rene Apr 12 lock)", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.body).toContain("ben@usagummies.com");
  });

  it("never includes rennie@usagummies.com (explicitly removed by Rene Apr 12)", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.body).not.toMatch(/rennie@usagummies\.com/);
  });

  it("never includes rene@usagummies.com (BCC only — never in body)", () => {
    const r = buildApPacketEmail(buildState(), BASIC_CTX);
    expect(r.body).not.toMatch(/rene@usagummies\.com/);
  });
});

// ---------------------------------------------------------------------------
// Defensive errors
// ---------------------------------------------------------------------------

describe("buildApPacketEmail — defensive errors", () => {
  it("throws when prospect missing", () => {
    expect(() =>
      buildApPacketEmail(buildState({ prospect: undefined }), BASIC_CTX),
    ).toThrow(/prospect missing/);
  });

  it("throws when orderLines is empty", () => {
    expect(() =>
      buildApPacketEmail(buildState({ orderLines: [] }), BASIC_CTX),
    ).toThrow(/orderLines is empty/);
  });
});

// ---------------------------------------------------------------------------
// Internal constants (sanity)
// ---------------------------------------------------------------------------

describe("__INTERNAL constants", () => {
  it("default net terms match Apr 13 Rene-locked CIF-001 v3", () => {
    expect(__INTERNAL.DEFAULT_NET_TERMS).toMatch(/Net 10/);
    expect(__INTERNAL.DEFAULT_NET_TERMS).toMatch(/Due on Receipt/);
  });

  it("sender phone matches Ben's published number", () => {
    expect(__INTERNAL.SENDER_PHONE).toBe("(307) 209-4928");
  });

  it("sender email is ben@usagummies.com (Rene Apr 12 single-recipient lock)", () => {
    expect(__INTERNAL.SENDER_EMAIL).toBe("ben@usagummies.com");
  });
});
