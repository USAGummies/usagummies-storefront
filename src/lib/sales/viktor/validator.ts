/**
 * Phase 37.4 — Outbound Draft Validator (Viktor capability).
 *
 * Per /contracts/email-agents-system.md §2.4:
 *
 *   "Already shipped at scripts/outreach-validate.mjs with BLOCKED phrases.
 *    Extend to:
 *      - Run on every outbound draft (not just cold outreach)
 *      - Add compliance-class BLOCKED phrases (kosher/halal/beef-derived/
 *        pork-derived gelatin source) — block if asserted without source
 *        citation per the gelatin-walk-back doctrine
 *      - Add pricing-class BLOCKED phrases (any per-bag $ figure not in
 *        canonical grid OR in distributor-pricing-commitments.md) —
 *        Phase 36.6 visibility flag at the validator boundary
 *      - Hard-block if the draft contains `tag:hold` or matches a
 *        HOLD-doctrine pattern (whale, exclusivity, multi-year)"
 *
 * This module is the TypeScript runtime version of the legacy .mjs CLI
 * gate. The .mjs script remains as a manual pre-send check; this module
 * is what the email subsystem calls on every drafter output.
 *
 * Doctrine constraints (locked v1.0 2026-04-30 PM):
 *   - PURE function — no I/O, no Apollo / HubSpot / Gmail calls.
 *     Network checks belong in 37.5+37.6 (drafter / approval card).
 *   - Returns a structured ValidationReport — caller (drafter / approval
 *     gate) decides whether `blockers.length > 0` means "do not send"
 *     or "surface for human override."
 *   - Battle-tested regexes from scripts/outreach-validate.mjs are
 *     ported verbatim and tagged with their original incident date so
 *     the audit trail stays intact.
 *   - HOLD-doctrine HARD BLOCKS short-circuit other findings — once a
 *     whale-domain reference / exclusivity clause / multi-year commit
 *     is detected, the report is unambiguously "do not send."
 */
import { WHALE_DOMAINS } from "./classifier";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlockerSeverity = "hard-block" | "warn";

export type BlockerClass =
  | "compliance" // kosher / halal / gelatin-source / organic / vegan / non-GMO
  | "pricing" // unauthorized $/bag figure
  | "internal-info" // Ashford / route-doctrine / B-tier code leakage
  | "hold-pattern" // whale / exclusivity / multi-year / legal
  | "regulatory-tailwind" // unapproved TX SB 25 / CA AB 418 / CA AB 2316 / FDA dye-ban phrasing
  | "fabricated-fact" // hallucinated location / wrong flavor count / etc.
  | "missing-anchor" // no "All American Gummy Bears" / "7.5 oz" reference
  | "tag-hold"; // explicit `tag:hold` marker in the draft

export interface ValidationFinding {
  severity: BlockerSeverity;
  class: BlockerClass;
  /** Identifier for the rule that fired (used for audit + drift tracking). */
  ruleId: string;
  /** Human-readable explanation surfaced on the approval card. */
  message: string;
  /** Snippet of the matched text — empty when match was an absence (anchor missing). */
  match: string;
}

export interface ValidationReport {
  /** True iff zero hard-block findings. */
  ok: boolean;
  /** All hard-block findings — caller MUST refuse to send when populated. */
  blockers: ValidationFinding[];
  /** Soft warnings — surfaced on the approval card but do not block. */
  warnings: ValidationFinding[];
  /** Canonical $/bag prices found in the draft (for audit). */
  pricesFound: string[];
  /** Whale-domain mentions discovered in the body (for audit). */
  whaleMentions: string[];
}

export interface ValidateDraftOpts {
  /** The draft email body (plain-text). */
  body: string;
  /** When true, also enforce the cold-outreach product-anchor requirement. */
  isColdOutreach?: boolean;
  /** Override the canonical-price allow-list (for tests / future tier changes). */
  allowedPrices?: readonly string[];
}

// ---------------------------------------------------------------------------
// Canonical price allow-list — derived from /contracts/wholesale-pricing.md v2.4
// ---------------------------------------------------------------------------

/**
 * Per-bag prices that are safe to render in customer-facing copy.
 *
 * Includes:
 *   - Retail wholesale tiers ($3.25, $3.49, $3.00) — `wholesale-pricing.md` §2
 *   - MSRP range ($4.99, $5.99) — `wholesale-pricing.md` §2
 *
 * Excludes (intentionally hard-blocked):
 *   - $2.10, $2.49 — distributor commitments per `distributor-pricing-
 *     commitments.md`. These are NEVER customer-facing; they're internal
 *     for Inderbitzin / Glacier deals only.
 */
export const CANONICAL_PER_BAG_PRICES: readonly string[] = [
  "$3.25",
  "$3.49",
  "$3.00",
  "$4.99",
  "$5.99",
] as const;

// ---------------------------------------------------------------------------
// Compliance-class BLOCKED — gelatin-walk-back doctrine
// ---------------------------------------------------------------------------

interface PatternRule {
  ruleId: string;
  re: RegExp;
  message: string;
  /** Optional override on findings class — defaults to the section's class. */
  classOverride?: BlockerClass;
}

const COMPLIANCE_RULES: readonly PatternRule[] = [
  {
    ruleId: "compliance.kosher",
    re: /\bkosher(?:[\s-]?certified)?\b/i,
    message:
      "Blocked claim 'kosher' — product is NOT kosher-certified. Compliance Specialist S-14 must register the claim via approved-claims.add Class B Ben before any 'kosher' phrasing leaves the system.",
  },
  {
    ruleId: "compliance.halal",
    re: /\bhalal(?:[\s-]?certified)?\b/i,
    message:
      "Blocked claim 'halal' — product is NOT halal-certified. Same approved-claims gate as kosher.",
  },
  {
    ruleId: "compliance.gelatin-source",
    re: /\b(?:beef|bovine|pork|porcine|fish|piscine)[-\s]?(?:derived|sourced|origin|gelatin|based)\b/i,
    message:
      "Blocked unsourced gelatin-origin claim. Per /contracts/company-vendor-packet.md gelatin walk-back doctrine: do NOT assert beef/pork/fish-derived without supplier C-of-A on file. Use 'Contains gelatin' (canonical phrasing on the bag) and direct buyer to ingredient page.",
  },
  {
    ruleId: "compliance.gelatin-source-explicit",
    re: /\bgelatin\s+(?:(?:is|comes)\s+)?(?:from|derived\s+from)\s+(?:beef|bovine|pork|porcine|fish|piscine)\b/i,
    message:
      "Blocked unsourced gelatin-origin assertion ('gelatin from <species>' / 'gelatin is from <species>'). Same gelatin walk-back doctrine — supplier C-of-A required before this phrasing.",
  },
  {
    ruleId: "compliance.organic",
    re: /\b(?:certified[-\s]?)?organic\b/i,
    message:
      "Blocked 'organic' — product is NOT certified organic. USDA Organic certification gate; never autonomous.",
  },
  {
    ruleId: "compliance.non-gmo",
    re: /\bnon[-\s]?gmo(?:[-\s]project)?(?:[-\s]verified)?\b/i,
    message:
      "Blocked 'Non-GMO' — no Non-GMO Project verification on file. Compliance Specialist gate required.",
  },
  {
    ruleId: "compliance.vegan",
    re: /\bvegan(?:[-\s]friendly)?\b/i,
    message:
      "Blocked 'vegan' — product CONTAINS gelatin (animal-derived). Per /contracts/company-vendor-packet.md §5: 'NOT vegan'. This is a factual error, not just a marketing claim.",
  },
  {
    ruleId: "compliance.dairy-free",
    re: /\bdairy[-\s]?free\b/i,
    message:
      "Blocked 'dairy-free' — outside outreach scope per Ben 2026-04-23 ruling (facility cross-contact concerns).",
  },
  {
    ruleId: "compliance.peanut-free",
    re: /\bpeanut[-\s]?free\b/i,
    message:
      "Blocked 'peanut-free' — facility cross-contact. Compliance gate required.",
  },
];

// ---------------------------------------------------------------------------
// Regulatory-tailwind class — §3.6 internal-only doctrine
// ---------------------------------------------------------------------------

const REGULATORY_RULES: readonly PatternRule[] = [
  {
    ruleId: "regulatory.tx-sb-25",
    re: /\bTX[-\s]?SB[-\s]?25\b|\bTexas\s+SB\s*25\b/i,
    message:
      "Blocked 'TX SB 25' — regulatory tailwind is INTERNAL POSITIONING ONLY per §3.6. Customer-facing copy requires Compliance Specialist S-14 approved-claims.add Class B Ben + counsel review FIRST. PROP-001 / Buc-ee's-class docs may carry an explicit operator override; the validator surfaces this as a hard-block and the operator overrides on the approval card.",
  },
  {
    ruleId: "regulatory.ca-ab-418",
    re: /\bCA[-\s]?AB[-\s]?418\b|\bCalifornia\s+AB[-\s]?418\b/i,
    message:
      "Blocked 'CA AB 418' — same regulatory-tailwind §3.6 internal-only rule.",
  },
  {
    ruleId: "regulatory.ca-ab-2316",
    re: /\bCA[-\s]?AB[-\s]?2316\b|\bCalifornia\s+AB[-\s]?2316\b/i,
    message:
      "Blocked 'CA AB 2316' — same regulatory-tailwind §3.6 internal-only rule.",
  },
  {
    ruleId: "regulatory.fda-dye-ban",
    re: /\bFDA\s+(?:dye[-\s]?ban|action\s+on\s+dyes?)\b/i,
    message:
      "Blocked 'FDA dye ban' / 'FDA action on dyes' — internal-positioning-only language. Counsel-review gate.",
  },
  {
    ruleId: "regulatory.warning-label",
    re: /\bwarning\s+label\s+(?:by|effective|on\s+(?:every|all))\b/i,
    message:
      "Blocked 'warning label by/effective' framing — implies regulatory-tailwind angle. §3.6 internal-only unless approved-claims registered.",
  },
];

// ---------------------------------------------------------------------------
// Internal-info leakage — Ben's 2026-04-27 + 2026-04-30 doctrine
// ---------------------------------------------------------------------------

const INTERNAL_INFO_RULES: readonly PatternRule[] = [
  {
    ruleId: "internal.ashford",
    re: /\bAshford\b/i,
    message:
      "Blocked 'Ashford' — internal warehouse location, never external per Ben 2026-04-27. Use 'our warehouse' / 'we ship from WA' / omit.",
  },
  {
    ruleId: "internal.warehouse-street",
    re: /30025\s+SR\s*706/i,
    message:
      "Blocked '30025 SR 706 E' — internal warehouse street address.",
  },
  {
    ruleId: "internal.warehouse-zip",
    re: /\bWA\s+98304\b/,
    message:
      "Blocked 'WA 98304' — internal warehouse zip.",
  },
  {
    ruleId: "internal.fob-ashford",
    re: /FOB\s+Ashford/i,
    message:
      "Blocked 'FOB Ashford' — never reference Ashford in FOB clause.",
  },
  // Route-doctrine leakage — Ben 2026-04-30 ruling.
  {
    ruleId: "internal.route-anchor",
    re: /anchors?\s+a\s+profitable\s+route\s+run/i,
    message:
      "Blocked 'anchors a profitable route run' — internal route-doctrine, never customer-facing.",
  },
  {
    ruleId: "internal.competitor-leak",
    re: /other\s+accounts\s+we'?ve\s+signed\s+up/i,
    message:
      "Blocked 'other accounts we've signed up' — tells customer we're shipping their competitors on the same truck. Internal-only.",
  },
  {
    ruleId: "internal.region-density",
    re: /every\s+door\s+(?:we\s+already\s+have\s+signed|we'?ve\s+signed)\s+in\s+your\s+region/i,
    message:
      "Blocked 'every door we've signed in your region' — internal route-density language.",
  },
  {
    ruleId: "internal.face-to-face",
    re: /face-to-face\s+restocks/i,
    message:
      "Blocked 'face-to-face restocks' — internal route mechanics.",
  },
  {
    ruleId: "internal.reorder-cycle",
    re: /6-?8\s+week\s+reorder\s+cycle.*restocks?/i,
    message:
      "Blocked '6-8 week reorder cycle face-to-face restocks' — internal route cadence.",
  },
  {
    ruleId: "internal.pallet-math-fill",
    re: /(?:fills?|fill)\s+the\s+(?:remaining|other)\s+(?:14|fourteen)\s+pallets/i,
    message:
      "Blocked '17-pallet truck math' — internal trucking economics.",
  },
  {
    ruleId: "internal.pallet-truck",
    re: /17-?pallet\s+(?:truck|capacity|load)/i,
    message:
      "Blocked '17-pallet truck' — internal trucking economics.",
  },
  // Internal B-tier code leakage.
  {
    ruleId: "internal.b-tier-code",
    re: /\bB[1-9]\b(?!\s*(?:vitamin|complex|cell))/,
    message:
      "Blocked 'B<n>' tier code — internal pricing-tier shorthand. Customers see prose ('master carton landed', 'pallet quantity'), never B1/B2/B3/B4/B5 codes.",
  },
  {
    ruleId: "internal.cogs-disclosure",
    re: /\bCOGS\b\s*(?:is|=|of|at)?\s*\$/i,
    message:
      "Blocked COGS disclosure — never share cost basis with customers. COGS is internal economics only.",
  },
];

// ---------------------------------------------------------------------------
// HOLD-doctrine HARD BLOCK — whale / exclusivity / multi-year / legal
// ---------------------------------------------------------------------------

const HOLD_PATTERN_RULES: readonly PatternRule[] = [
  {
    ruleId: "hold.exclusivity",
    re: /\b(?:exclusive(?:\s+rights?|\s+territory|\s+distributorship)?|exclusivity\s+(?:clause|agreement|term))\b/i,
    message:
      "Blocked exclusivity language — Class D HARD HOLD per /contracts/approval-taxonomy.md. Exclusivity asks require Ben + counsel + Rene; never agent-drafted.",
  },
  {
    ruleId: "hold.first-right",
    re: /\bfirst\s+right\s+of\s+refusal\b|\brofr\b/i,
    message:
      "Blocked 'first right of refusal' / ROFR — Class D HARD HOLD.",
  },
  {
    ruleId: "hold.multi-year",
    re: /\b(?:multi[-\s]?year|annual\s+contract|auto[-\s]?renew(?:al)?|minimum\s+commitment)\b/i,
    message:
      "Blocked multi-year / auto-renew / minimum-commitment language — Class D HARD HOLD.",
  },
  {
    ruleId: "hold.guaranteed-volume",
    re: /\bguaranteed\s+volume\b/i,
    message:
      "Blocked 'guaranteed volume' — supply commitment language is Class D / never autonomous.",
  },
  {
    ruleId: "hold.mnda",
    re: /\b(?:mnda|m\.n\.d\.a\.)\b|\bmutual[-\s]non[-\s]disclosure/i,
    message:
      "Blocked MNDA / mutual NDA — legal language is Class D. Attorney loop required.",
  },
  {
    ruleId: "hold.indemnification",
    re: /\bindemnif(?:y|ies|ication|ies\s+against)\b/i,
    message:
      "Blocked indemnification language — Class D legal.",
  },
];

// ---------------------------------------------------------------------------
// Fabricated-fact rules — drift class from 2026-04-23 incident
// ---------------------------------------------------------------------------

const FABRICATED_FACT_RULES: readonly PatternRule[] = [
  {
    ruleId: "fact.layton",
    re: /\bLayton\b/i,
    message:
      "Blocked 'Layton' — hallucinated location from 2026-04-23 incident.",
  },
  {
    ruleId: "fact.flavor-count",
    re: /\b(?:three|four|six|seven)\s*(?:different\s+)?flavors\b/i,
    message:
      "Wrong flavor count — canonical is 5 flavors (Cherry, Watermelon, Orange, Green Apple, Lemon).",
  },
  {
    ruleId: "fact.apple-not-green-apple",
    re: /\bapple\s+(?:gummy|gummies|flavor)\b/i,
    message:
      "Use 'green apple' not just 'apple' — canonical flavor name.",
  },
  {
    ruleId: "fact.resealable",
    re: /\bresealable\b/i,
    message:
      "Blocked 'resealable' — bag is NOT resealable.",
  },
  {
    ruleId: "fact.red-white-blue",
    re: /\bred,?\s*white,?\s*and\s*blue\s+(?:bears|gummies|gummy)\b/i,
    message:
      "Blocked 'red white and blue' — product is 5 flavors, NOT color-themed. Per Ben's brand-color spec: 5 colors only (pink, dark red, orange, yellow, green) — NO blue gummies, ever.",
  },
  {
    ruleId: "fact.pallet-math",
    re: /100\s*(?:master\s*cartons?|MCs?)\s*(?:\/|per|=)\s*(?:3,?600|3600)\s*bags/i,
    message:
      "Wrong pallet size — canonical is 25 MCs / 900 bags per pallet.",
  },
];

// ---------------------------------------------------------------------------
// Show-deal & freight expired-language rules
// ---------------------------------------------------------------------------

const EXPIRED_OFFER_RULES: readonly PatternRule[] = [
  {
    ruleId: "expired.free-freight-mc",
    re: /free\s+(?:freight|shipping)\s+on\s+(?:any\s+)?(?:master\s+carton|first\s+(?:MC|master)|MC\s+order|your\s+first\s+order)/i,
    message:
      "Blocked 'free freight/shipping on master carton/first MC' — trade-show-only offer, expired. Free freight only at 3+ pallets per canonical spec.",
  },
  {
    ruleId: "expired.freight-on-us",
    re: /freight\s+on\s+us[, ]/i,
    message:
      "Blocked 'freight on us' — trade-show-only language. Use canonical tiers.",
  },
  {
    ruleId: "expired.show-pricing-welcome",
    re: /show\s+pricing\s+(?:as\s+a\s+welcome|locked|extended|honor)/i,
    message:
      "Blocked 'show pricing as welcome offer' — Reunion show pricing was show-only and has expired.",
  },
  {
    ruleId: "expired.welcome-offer-mc",
    re: /welcome\s+offer\s+on\s+your\s+first\s+master\s+carton/i,
    message:
      "Blocked 'welcome offer on first MC' — not a real tier per canonical spec.",
  },
];

// ---------------------------------------------------------------------------
// `tag:hold` explicit marker — drafter convention to force human review
// ---------------------------------------------------------------------------

const TAG_HOLD_REGEX = /\btag:hold\b/i;

// ---------------------------------------------------------------------------
// Required cold-outreach anchors
// ---------------------------------------------------------------------------

const REQUIRED_COLD_ANCHORS: readonly RegExp[] = [
  /All American Gummy Bears/i,
  /7\.5\s*oz/i,
];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function applyRules(
  body: string,
  rules: readonly PatternRule[],
  defaultClass: BlockerClass,
  severity: BlockerSeverity,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const rule of rules) {
    const m = body.match(rule.re);
    if (m) {
      findings.push({
        severity,
        class: rule.classOverride ?? defaultClass,
        ruleId: rule.ruleId,
        message: rule.message,
        match: m[0] ?? "",
      });
    }
  }
  return findings;
}

/** Match every per-bag dollar figure in the body. */
function findPerBagPrices(body: string): string[] {
  const matches = body.matchAll(/\$\d+(?:\.\d{2})?/g);
  return [...matches].map((m) => m[0]);
}

/** Find any whale-domain string mentioned in the body. */
function findWhaleMentions(body: string): string[] {
  const lower = body.toLowerCase();
  const hits: string[] = [];
  for (const w of WHALE_DOMAINS) {
    if (lower.includes(w.toLowerCase())) hits.push(w);
  }
  return hits;
}

/**
 * Validate an outbound draft. Pure function — no I/O.
 *
 * Rule resolution:
 *   1. `tag:hold` explicit marker → hard-block (drafter intent).
 *   2. Whale-domain mention in body → hard-block (HOLD pattern).
 *   3. HOLD-pattern phrases → hard-block.
 *   4. Compliance phrases → hard-block.
 *   5. Regulatory-tailwind phrases → hard-block.
 *   6. Internal-info leakage → hard-block.
 *   7. Fabricated facts → hard-block.
 *   8. Expired offer language → hard-block.
 *   9. Per-bag $ outside canonical grid → hard-block (pricing class).
 *  10. Cold-outreach + missing anchor → warn (NOT hard-block by itself).
 */
export function validateDraft(opts: ValidateDraftOpts): ValidationReport {
  const body = opts.body ?? "";
  const allowedPrices = opts.allowedPrices ?? CANONICAL_PER_BAG_PRICES;

  const blockers: ValidationFinding[] = [];
  const warnings: ValidationFinding[] = [];

  // 1. Explicit tag:hold marker
  if (TAG_HOLD_REGEX.test(body)) {
    blockers.push({
      severity: "hard-block",
      class: "tag-hold",
      ruleId: "tag.hold-marker",
      message:
        "Draft contains `tag:hold` marker — drafter explicitly flagged this for human review.",
      match: "tag:hold",
    });
  }

  // 2. Whale-domain mention → hold-pattern hard-block
  const whaleMentions = findWhaleMentions(body);
  for (const w of whaleMentions) {
    blockers.push({
      severity: "hard-block",
      class: "hold-pattern",
      ruleId: "hold.whale-domain-mention",
      message: `Body mentions whale-class domain '${w}' — HARD HOLD per §3.1.`,
      match: w,
    });
  }

  // 3. HOLD-pattern phrases
  blockers.push(
    ...applyRules(body, HOLD_PATTERN_RULES, "hold-pattern", "hard-block"),
  );

  // 4. Compliance phrases
  blockers.push(
    ...applyRules(body, COMPLIANCE_RULES, "compliance", "hard-block"),
  );

  // 5. Regulatory-tailwind phrases
  blockers.push(
    ...applyRules(body, REGULATORY_RULES, "regulatory-tailwind", "hard-block"),
  );

  // 6. Internal-info leakage
  blockers.push(
    ...applyRules(body, INTERNAL_INFO_RULES, "internal-info", "hard-block"),
  );

  // 7. Fabricated facts
  blockers.push(
    ...applyRules(body, FABRICATED_FACT_RULES, "fabricated-fact", "hard-block"),
  );

  // 8. Expired offer language
  blockers.push(
    ...applyRules(body, EXPIRED_OFFER_RULES, "fabricated-fact", "hard-block"),
  );

  // 9. Per-bag $ canonical-grid check
  const pricesFound = findPerBagPrices(body);
  for (const p of pricesFound) {
    if (!allowedPrices.includes(p)) {
      blockers.push({
        severity: "hard-block",
        class: "pricing",
        ruleId: "pricing.unauthorized-figure",
        message: `Dollar amount ${p} is outside canonical grid {${allowedPrices.join(", ")}}. Distributor commitments ($2.10 / $2.49) are internal-only — never customer-facing per §11.2.`,
        match: p,
      });
    }
  }

  // 10. Cold-outreach anchor warning (soft)
  if (opts.isColdOutreach) {
    const hasAnyAnchor = REQUIRED_COLD_ANCHORS.some((re) => re.test(body));
    if (!hasAnyAnchor) {
      warnings.push({
        severity: "warn",
        class: "missing-anchor",
        ruleId: "anchor.missing",
        message:
          "Cold-outreach draft missing both 'All American Gummy Bears' and '7.5 oz' anchor — pitch may not be recognizable as USA Gummies.",
        match: "",
      });
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    pricesFound,
    whaleMentions,
  };
}

// ---------------------------------------------------------------------------
// Convenience — render a Slack-ready summary of findings
// ---------------------------------------------------------------------------

/**
 * Render a compact, human-readable summary of the validation report —
 * meant for the §2.5a Slack approval card. Empty when no findings.
 */
export function renderValidationSummary(report: ValidationReport): string {
  if (report.ok && report.warnings.length === 0) {
    return "✅ Validator: clean (no blockers, no warnings)";
  }
  const lines: string[] = [];
  if (report.blockers.length > 0) {
    lines.push(`🚫 *${report.blockers.length} hard-block finding(s):*`);
    for (const b of report.blockers) {
      lines.push(`  • [${b.class}/${b.ruleId}] ${b.message}`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push(`⚠️ *${report.warnings.length} warning(s):*`);
    for (const w of report.warnings) {
      lines.push(`  • [${w.class}/${w.ruleId}] ${w.message}`);
    }
  }
  return lines.join("\n");
}
