/**
 * Phase 37.4 — Validator tests.
 *
 * Coverage targets per /contracts/email-agents-system.md §2.4:
 *   - Compliance class: kosher / halal / gelatin-source / organic /
 *     non-GMO / vegan / dairy-free / peanut-free all hard-block.
 *   - Pricing class: per-bag $ outside canonical grid hard-blocks;
 *     distributor figures ($2.10, $2.49) hard-block (internal-only).
 *   - Internal-info: Ashford / route-doctrine / B-tier / COGS leakage
 *     all hard-block.
 *   - HOLD-doctrine: whale-domain mention / exclusivity / multi-year /
 *     guaranteed-volume / MNDA / indemnification all hard-block.
 *   - Regulatory-tailwind: TX SB 25 / CA AB 418 / CA AB 2316 / FDA
 *     dye-ban / warning-label all hard-block (§3.6 internal-only).
 *   - Fabricated facts: Layton / wrong flavor count / "apple" alone /
 *     "red white and blue" / resealable / wrong pallet math.
 *   - Expired-offer language: free-freight-on-MC / freight-on-us /
 *     show pricing welcome.
 *   - `tag:hold` explicit marker hard-blocks.
 *   - Cold-outreach with no anchor → warning (not hard-block).
 *   - Clean draft → ok=true with no blockers.
 *   - renderValidationSummary collapses cleanly + lists findings.
 */
import { describe, expect, it } from "vitest";

import {
  CANONICAL_PER_BAG_PRICES,
  renderValidationSummary,
  validateDraft,
} from "../validator";

// ---------------------------------------------------------------------------
// Compliance class
// ---------------------------------------------------------------------------

describe("validator / compliance class", () => {
  it("hard-blocks 'kosher'", () => {
    const r = validateDraft({ body: "Our gummies are kosher-certified." });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => b.ruleId === "compliance.kosher")).toBe(true);
  });

  it("hard-blocks 'halal'", () => {
    const r = validateDraft({ body: "Halal product." });
    expect(r.blockers.some((b) => b.ruleId === "compliance.halal")).toBe(true);
  });

  it("hard-blocks unsourced gelatin-origin claims", () => {
    const r = validateDraft({ body: "Our gummies use beef-derived gelatin." });
    expect(
      r.blockers.some((b) => b.ruleId === "compliance.gelatin-source"),
    ).toBe(true);
  });

  it("hard-blocks 'gelatin from beef' phrasing", () => {
    const r = validateDraft({
      body: "The gelatin is from beef.",
    });
    expect(
      r.blockers.some(
        (b) => b.ruleId === "compliance.gelatin-source-explicit",
      ),
    ).toBe(true);
  });

  it("hard-blocks 'organic'", () => {
    const r = validateDraft({ body: "Certified-organic ingredients." });
    expect(r.blockers.some((b) => b.ruleId === "compliance.organic")).toBe(
      true,
    );
  });

  it("hard-blocks 'Non-GMO'", () => {
    const r = validateDraft({ body: "We are Non-GMO Project verified." });
    expect(r.blockers.some((b) => b.ruleId === "compliance.non-gmo")).toBe(
      true,
    );
  });

  it("hard-blocks 'vegan' (factual error — gelatin)", () => {
    const r = validateDraft({ body: "Vegan-friendly candy." });
    expect(r.blockers.some((b) => b.ruleId === "compliance.vegan")).toBe(true);
  });

  it("hard-blocks 'dairy-free'", () => {
    const r = validateDraft({ body: "Dairy-free formulation." });
    expect(r.blockers.some((b) => b.ruleId === "compliance.dairy-free")).toBe(
      true,
    );
  });

  it("hard-blocks 'peanut-free'", () => {
    const r = validateDraft({ body: "Peanut-free production." });
    expect(r.blockers.some((b) => b.ruleId === "compliance.peanut-free")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Pricing class
// ---------------------------------------------------------------------------

describe("validator / pricing class", () => {
  it("allows canonical grid prices", () => {
    const r = validateDraft({
      body: "All American Gummy Bears 7.5 oz at $3.25/bag wholesale, MSRP $4.99–$5.99.",
    });
    expect(r.pricesFound.length).toBeGreaterThan(0);
    expect(r.blockers.filter((b) => b.class === "pricing")).toHaveLength(0);
  });

  it("hard-blocks $2.10/bag (distributor — internal only)", () => {
    const r = validateDraft({
      body: "We can do $2.10/bag at this volume.",
    });
    expect(
      r.blockers.some(
        (b) => b.ruleId === "pricing.unauthorized-figure" && b.match === "$2.10",
      ),
    ).toBe(true);
  });

  it("hard-blocks $2.49/bag (distributor sell-sheet — internal only)", () => {
    const r = validateDraft({ body: "$2.49 / bag if you can hit volume." });
    expect(
      r.blockers.some(
        (b) => b.ruleId === "pricing.unauthorized-figure" && b.match === "$2.49",
      ),
    ).toBe(true);
  });

  it("hard-blocks any unanticipated dollar figure", () => {
    const r = validateDraft({ body: "How about $3.10/bag?" });
    expect(r.blockers.some((b) => b.match === "$3.10")).toBe(true);
  });

  it("respects allowedPrices override", () => {
    const r = validateDraft({
      body: "Custom $1.99/bag.",
      allowedPrices: ["$1.99"],
    });
    expect(r.blockers.filter((b) => b.class === "pricing")).toHaveLength(0);
  });

  it("CANONICAL_PER_BAG_PRICES exposed for downstream use", () => {
    expect(CANONICAL_PER_BAG_PRICES).toEqual([
      "$3.25",
      "$3.49",
      "$3.00",
      "$4.99",
      "$5.99",
    ]);
  });
});

// ---------------------------------------------------------------------------
// HOLD-doctrine class
// ---------------------------------------------------------------------------

describe("validator / HOLD-doctrine class", () => {
  it("hard-blocks any whale-domain mention in body", () => {
    const r = validateDraft({
      body: "We saw your team at buc-ees.com last week.",
    });
    expect(r.whaleMentions).toContain("buc-ees.com");
    expect(
      r.blockers.some((b) => b.ruleId === "hold.whale-domain-mention"),
    ).toBe(true);
  });

  it("hard-blocks 'exclusive rights'", () => {
    const r = validateDraft({
      body: "We can offer exclusive rights to your category.",
    });
    expect(r.blockers.some((b) => b.ruleId === "hold.exclusivity")).toBe(true);
  });

  it("hard-blocks 'first right of refusal'", () => {
    const r = validateDraft({ body: "First right of refusal on the SKU." });
    expect(r.blockers.some((b) => b.ruleId === "hold.first-right")).toBe(true);
  });

  it("hard-blocks 'multi-year'", () => {
    const r = validateDraft({ body: "A multi-year partnership." });
    expect(r.blockers.some((b) => b.ruleId === "hold.multi-year")).toBe(true);
  });

  it("hard-blocks 'guaranteed volume'", () => {
    const r = validateDraft({ body: "Guaranteed volume for 12 months." });
    expect(
      r.blockers.some((b) => b.ruleId === "hold.guaranteed-volume"),
    ).toBe(true);
  });

  it("hard-blocks MNDA", () => {
    const r = validateDraft({ body: "We'll need to sign an MNDA." });
    expect(r.blockers.some((b) => b.ruleId === "hold.mnda")).toBe(true);
  });

  it("hard-blocks indemnification language", () => {
    const r = validateDraft({ body: "indemnification clause attached." });
    expect(r.blockers.some((b) => b.ruleId === "hold.indemnification")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Regulatory-tailwind class — §3.6 internal-only doctrine
// ---------------------------------------------------------------------------

describe("validator / regulatory-tailwind class", () => {
  it("hard-blocks 'TX SB 25'", () => {
    const r = validateDraft({
      body: "Texas SB 25 effective Jan 1, 2027 will require warning labels.",
    });
    expect(r.blockers.some((b) => b.ruleId === "regulatory.tx-sb-25")).toBe(
      true,
    );
  });

  it("hard-blocks 'CA AB 418'", () => {
    const r = validateDraft({ body: "CA AB 418 already bans Red 3." });
    expect(r.blockers.some((b) => b.ruleId === "regulatory.ca-ab-418")).toBe(
      true,
    );
  });

  it("hard-blocks 'CA AB 2316'", () => {
    const r = validateDraft({ body: "California AB 2316 in schools." });
    expect(r.blockers.some((b) => b.ruleId === "regulatory.ca-ab-2316")).toBe(
      true,
    );
  });

  it("hard-blocks 'FDA dye ban'", () => {
    const r = validateDraft({ body: "The FDA dye ban is coming." });
    expect(r.blockers.some((b) => b.ruleId === "regulatory.fda-dye-ban")).toBe(
      true,
    );
  });

  it("hard-blocks 'warning label by/effective' framing", () => {
    const r = validateDraft({
      body: "Every legacy gummy needs a warning label by 2027.",
    });
    expect(
      r.blockers.some((b) => b.ruleId === "regulatory.warning-label"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Internal-info leakage
// ---------------------------------------------------------------------------

describe("validator / internal-info leakage", () => {
  it("hard-blocks 'Ashford'", () => {
    const r = validateDraft({ body: "Ships from our Ashford warehouse." });
    expect(r.blockers.some((b) => b.ruleId === "internal.ashford")).toBe(true);
  });

  it("hard-blocks warehouse street address", () => {
    const r = validateDraft({ body: "30025 SR 706 E." });
    expect(
      r.blockers.some((b) => b.ruleId === "internal.warehouse-street"),
    ).toBe(true);
  });

  it("hard-blocks 'WA 98304'", () => {
    const r = validateDraft({ body: "Drop ship to WA 98304." });
    expect(
      r.blockers.some((b) => b.ruleId === "internal.warehouse-zip"),
    ).toBe(true);
  });

  it("hard-blocks 'FOB Ashford'", () => {
    const r = validateDraft({ body: "FOB Ashford on the BOL." });
    expect(r.blockers.some((b) => b.ruleId === "internal.fob-ashford")).toBe(
      true,
    );
  });

  it("hard-blocks route-doctrine leakage", () => {
    const r = validateDraft({
      body: "Your order anchors a profitable route run.",
    });
    expect(r.blockers.some((b) => b.ruleId === "internal.route-anchor")).toBe(
      true,
    );
  });

  it("hard-blocks 'B5' tier code in customer copy", () => {
    const r = validateDraft({ body: "Your account qualifies for B5 tier." });
    expect(r.blockers.some((b) => b.ruleId === "internal.b-tier-code")).toBe(
      true,
    );
  });

  it("does NOT false-match 'B vitamin' / 'B12' / 'B complex'", () => {
    const r = validateDraft({
      body: "Our gummies are not a B vitamin. Not a B12 product. Not a B complex.",
    });
    expect(
      r.blockers.filter((b) => b.ruleId === "internal.b-tier-code"),
    ).toHaveLength(0);
  });

  it("hard-blocks COGS disclosure", () => {
    const r = validateDraft({ body: "Our COGS is $1.79 per bag." });
    expect(
      r.blockers.some((b) => b.ruleId === "internal.cogs-disclosure"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fabricated-fact rules
// ---------------------------------------------------------------------------

describe("validator / fabricated-fact rules", () => {
  it("hard-blocks 'Layton'", () => {
    const r = validateDraft({ body: "Manufactured in Layton, UT." });
    expect(r.blockers.some((b) => b.ruleId === "fact.layton")).toBe(true);
  });

  it("hard-blocks wrong flavor counts", () => {
    const r = validateDraft({ body: "Three different flavors per bag." });
    expect(r.blockers.some((b) => b.ruleId === "fact.flavor-count")).toBe(
      true,
    );
  });

  it("hard-blocks 'apple' instead of 'green apple'", () => {
    const r = validateDraft({ body: "Five flavors including apple gummy." });
    expect(
      r.blockers.some((b) => b.ruleId === "fact.apple-not-green-apple"),
    ).toBe(true);
  });

  it("hard-blocks 'resealable'", () => {
    const r = validateDraft({ body: "The bag is resealable." });
    expect(r.blockers.some((b) => b.ruleId === "fact.resealable")).toBe(true);
  });

  it("hard-blocks 'red, white, and blue gummies'", () => {
    const r = validateDraft({
      body: "Red, white, and blue gummies for the holiday.",
    });
    expect(r.blockers.some((b) => b.ruleId === "fact.red-white-blue")).toBe(
      true,
    );
  });

  it("hard-blocks wrong pallet math", () => {
    const r = validateDraft({ body: "100 master cartons / 3,600 bags." });
    expect(r.blockers.some((b) => b.ruleId === "fact.pallet-math")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Expired offer language
// ---------------------------------------------------------------------------

describe("validator / expired-offer language", () => {
  it("hard-blocks 'free freight on master carton'", () => {
    const r = validateDraft({
      body: "Free freight on master carton for first MC.",
    });
    expect(r.blockers.some((b) => b.ruleId === "expired.free-freight-mc")).toBe(
      true,
    );
  });

  it("hard-blocks 'freight on us,'", () => {
    const r = validateDraft({
      body: "Freight on us, you stock the shelf.",
    });
    expect(r.blockers.some((b) => b.ruleId === "expired.freight-on-us")).toBe(
      true,
    );
  });

  it("hard-blocks 'show pricing as a welcome'", () => {
    const r = validateDraft({
      body: "We'll honor show pricing as a welcome offer.",
    });
    expect(
      r.blockers.some((b) => b.ruleId === "expired.show-pricing-welcome"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `tag:hold` explicit marker
// ---------------------------------------------------------------------------

describe("validator / tag:hold marker", () => {
  it("hard-blocks any draft containing tag:hold", () => {
    const r = validateDraft({
      body: "tag:hold Draft for Charmaine, Ben needs to review.",
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => b.ruleId === "tag.hold-marker")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cold-outreach anchor warning
// ---------------------------------------------------------------------------

describe("validator / cold-outreach anchor warning", () => {
  it("warns when cold outreach is missing both anchors", () => {
    const r = validateDraft({
      body: "Hi — would you like to carry our candy line?",
      isColdOutreach: true,
    });
    expect(r.warnings.some((w) => w.ruleId === "anchor.missing")).toBe(true);
    expect(r.ok).toBe(true); // warnings don't fail .ok
  });

  it("does NOT warn when 'All American Gummy Bears' is present", () => {
    const r = validateDraft({
      body: "Our All American Gummy Bears would fit your shelf.",
      isColdOutreach: true,
    });
    expect(r.warnings.filter((w) => w.ruleId === "anchor.missing")).toHaveLength(
      0,
    );
  });

  it("does NOT warn when '7.5 oz' is present", () => {
    const r = validateDraft({
      body: "Our 7.5 oz pouch is a register-strip impulse SKU.",
      isColdOutreach: true,
    });
    expect(r.warnings.filter((w) => w.ruleId === "anchor.missing")).toHaveLength(
      0,
    );
  });

  it("does NOT warn outside cold-outreach mode", () => {
    const r = validateDraft({
      body: "Thanks for the order!",
    });
    expect(r.warnings.filter((w) => w.ruleId === "anchor.missing")).toHaveLength(
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// Clean / happy path
// ---------------------------------------------------------------------------

describe("validator / clean draft", () => {
  it("returns ok=true with zero blockers on a clean draft", () => {
    const r = validateDraft({
      body:
        "Hi Buyer — checking in on the All American Gummy Bears 7.5 oz sample case. " +
        "Price is $3.25/bag landed master carton (MSRP $4.99–$5.99). " +
        "Happy to share the sell sheet if useful.",
      isColdOutreach: true,
    });
    expect(r.ok).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// renderValidationSummary
// ---------------------------------------------------------------------------

describe("validator / renderValidationSummary", () => {
  it("renders a clean-pass summary when nothing fired", () => {
    const r = validateDraft({ body: "All American Gummy Bears 7.5 oz at $3.25/bag." });
    const summary = renderValidationSummary(r);
    expect(summary).toContain("clean");
  });

  it("lists every blocker with rule id and message", () => {
    const r = validateDraft({
      body: "Kosher gummies at $2.10/bag — multi-year deal.",
    });
    const summary = renderValidationSummary(r);
    expect(summary).toContain("compliance/compliance.kosher");
    expect(summary).toContain("pricing/pricing.unauthorized-figure");
    expect(summary).toContain("hold-pattern/hold.multi-year");
  });
});

// ---------------------------------------------------------------------------
// Multi-finding stacking — sanity check
// ---------------------------------------------------------------------------

describe("validator / multi-finding stacking", () => {
  it("collects every blocker class fired by a single draft", () => {
    const r = validateDraft({
      body:
        "Kosher gummies, $2.10/bag, multi-year MNDA, ships from Ashford, " +
        "exclusive rights, TX SB 25 ban, Layton manufacturing, " +
        "tag:hold for Ben.",
    });
    expect(r.ok).toBe(false);
    const classesFound = new Set(r.blockers.map((b) => b.class));
    // Should hit at least these classes (some classes may have multiple
    // findings, but presence of each class is the assertion):
    expect(classesFound.has("compliance")).toBe(true);
    expect(classesFound.has("pricing")).toBe(true);
    expect(classesFound.has("hold-pattern")).toBe(true);
    expect(classesFound.has("regulatory-tailwind")).toBe(true);
    expect(classesFound.has("internal-info")).toBe(true);
    expect(classesFound.has("fabricated-fact")).toBe(true);
    expect(classesFound.has("tag-hold")).toBe(true);
  });
});
