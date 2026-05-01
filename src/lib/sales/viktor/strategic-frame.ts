/**
 * Phase 37.5 — Strategic Framework analyzer (Viktor capability).
 *
 * Per /contracts/email-agents-system.md §2.5b (BEN'S DIRECTIVE 2026-04-30 PM):
 *
 *   "there needs to be full strategy thought out around each response, so it
 *    is thorough, and we don't give away company info / internal info, and we
 *    always approach every email from the perspective of what is the play
 *    here, are we selling, are we closing a deal, what is the full concept,
 *    what is the premise, what is the goal, what is the relationship, what is
 *    the opportunity, what is the risk, and of course financials etc, and
 *    then we craft a response based with what is our strategy in this
 *    conversation."
 *
 * HARD RULE (per spec): every drafter MUST run the inbound through the 8-
 * question Strategic Framework BEFORE generating a draft. The 8-question
 * analysis appears at the top of every approval card so Ben/Rene can see
 * the strategic logic AND the draft together. If the frame is missing or
 * any of the 8 fields is empty, the system rejects the draft and forces
 * re-analysis.
 *
 * This module ships:
 *   - The canonical `StrategicFrame` typed struct (verbatim from §2.5b)
 *   - A `buildStrategicFrame(input)` factory — pure derivation from
 *     classifier + HubSpot + ProspectFrame inputs.
 *   - `validateStrategicFrame(frame)` — guarantees every field non-empty;
 *     drafter calls this before rendering and refuses if invalid.
 *   - `renderStrategicFrameForCard(frame)` — Slack-formatted summary
 *     for the §2.5a approval card top-of-message section.
 *
 * Doctrine constraints (locked v1.0 2026-04-30 PM):
 *   - Pure function, no I/O.
 *   - Frame composes from THREE inputs (per §11.2 + §11.7 lock):
 *     ProspectFrame (vertical/tier) + CashflowFrame (cashSpeed) +
 *     classifier outputs (category + record context). LLM-driven nuance
 *     in fields like `play`, `risks`, `dontShare` is added by the drafter
 *     stage; this module sets the deterministic skeleton.
 *   - Whale-class records always elevate to relationship="whale" + goal
 *     ="hold" regardless of inputs.
 */
import type { ClassifiedRecord, EmailCategoryV1 } from "./classifier";
import type { VerificationMetadata } from "./hubspot-verification";

// ---------------------------------------------------------------------------
// Canonical StrategicFrame type — verbatim per §2.5b
// ---------------------------------------------------------------------------

export type RelationshipKind =
  | "cold"
  | "warm"
  | "established"
  | "repeat"
  | "distributor"
  | "whale";

export type StrategicGoal =
  | "sale"
  | "close"
  | "qualify"
  | "nurture"
  | "deflect"
  | "hold"
  | "redirect"
  | "info-gather";

export interface OpportunityRange {
  lowUsd: number;
  highUsd: number;
  rationale: string;
}

export interface FinancialFrame {
  marginBand: string;
  arExposure: string | null;
  requiresClassC: boolean;
  escalationClauseRequired: boolean;
}

/**
 * The canonical struct emitted before any draft. The drafter (37.6 /
 * 37.11) consumes this and renders the answer; the §2.5a approval card
 * displays it at the top of the Slack message so Ben/Rene see strategy
 * before draft.
 */
export interface StrategicFrame {
  /** 8.1 — Why is this person writing? */
  premise: string;
  /** 8.2 — Cold / warm / established / repeat / distributor / whale. */
  relationship: RelationshipKind;
  /** 8.3 — Volume × tier × LTV at full upside, with rationale. */
  opportunity: OpportunityRange;
  /** 8.4 — In THIS specific exchange, what are we trying to achieve? */
  goal: StrategicGoal;
  /** 8.5 — What could go wrong? Each risk a separate string. */
  risks: string[];
  /** 8.6 — Margin band, AR exposure, Class C / escalation requirements. */
  financialFrame: FinancialFrame;
  /** 8.7 — What MUST stay out of the reply? Spottswood doctrine. */
  dontShare: string[];
  /** 8.8 — Single strategic objective for THIS exchange. */
  play: string;
}

// ---------------------------------------------------------------------------
// Inputs the factory accepts — keeps every dependency typed + injectable
// ---------------------------------------------------------------------------

export interface ProspectFrameInput {
  vertical?: string; // e.g. "souvenir_destination" — usa_vertical
  tier?: "T0" | "T1" | "T2" | "T3" | "" | string; // usa_tier
  cadenceState?: string; // usa_cadence_state
}

export interface CashflowFrameInput {
  /** Per §11.5 + §11.7 lock — drives daily-brief priority. */
  cashSpeed?: "today" | "this_week" | "this_month" | "this_quarter" | "strategic";
  expectedFirstOrderBags?: number;
  expectedGrossRevenue?: number;
  expectedGrossProfit?: number;
}

export interface BuildStrategicFrameOpts {
  record: ClassifiedRecord;
  /** Optional verification metadata — drives relationship lookup. */
  verification?: VerificationMetadata | null;
  prospect?: ProspectFrameInput;
  cashflow?: CashflowFrameInput;
}

// ---------------------------------------------------------------------------
// Per-category default playbook
// ---------------------------------------------------------------------------

interface CategoryDefaults {
  goal: StrategicGoal;
  risks: string[];
  /** A short, generic play — drafter overrides with a specific play. */
  playSeed: string;
  /** Dollar opportunity defaults — overridden by ProspectFrame.tier when present. */
  opportunity: OpportunityRange;
  /** Optional financial-frame requirements per category. */
  financial: Partial<FinancialFrame>;
  /** Per-category dontShare additions on top of the universal floor. */
  dontShare: string[];
}

/**
 * Universal don't-share floor per /contracts/email-agents-system.md §2.5c +
 * §3.6 + Spottswood / Vahag / gelatin-walk-back lessons. Every frame
 * starts with this list and adds category-specific entries.
 */
const UNIVERSAL_DONT_SHARE: readonly string[] = [
  "route doctrine (anchor / fill / density / 17-pallet truck math)",
  "COGS breakdown ($1.79 / $1.77 / $1.52 / Albanese / Belmark / Powers / Uline line items)",
  "custom-quote formula details (min_margin_floor / wiggle / tier_classification)",
  "per-vendor margin ledger numbers",
  "internal warehouse address (Ashford / 30025 SR 706 / WA 98304)",
  "B-tier internal codes (B1/B2/B3/B4/B5 / B6-ANCH / B6-FILL / B6-EXC / B6-PU)",
  "regulatory tailwind framing (TX SB 25 / CA AB 418 / CA AB 2316 / FDA dye-ban) unless approved-claims registered",
  "supplier names (Powers Confections / Belmark / Albanese) — operator whitelist required for proposals",
  "approval-taxonomy / Class A/B/C/D vocabulary",
];

const CATEGORY_DEFAULTS: Partial<Record<EmailCategoryV1, CategoryDefaults>> = {
  A_sample_request: {
    goal: "qualify",
    risks: [
      "Sample sent without buyer follow-through (cost sunk on cold sample)",
      "Sample addressed to wrong contact (routing-update miss)",
    ],
    playSeed: "Ship sample case (S-08), gather ship-to + tier signals, queue Touch 2 for UPS-scan trigger",
    opportunity: {
      lowUsd: 250,
      highUsd: 5_000,
      rationale: "First-PO range for a typical souvenir / gift-shop tier (T2/T3)",
    },
    financial: { marginBand: "B-tier wholesale 35–55% retailer margin", requiresClassC: false, escalationClauseRequired: false },
    dontShare: ["sample COGS / freight cost"],
  },
  B_qualifying_question: {
    goal: "qualify",
    risks: [
      "Over-explaining (Vahag rule — answer the question + ONE fishing pivot, no strategic side-deals)",
      "Compliance-class fabrication (gelatin source / kosher / vegan)",
    ],
    playSeed:
      "Answer the asked factual question only, then ONE fishing question to gather buyer context. No expansion.",
    opportunity: {
      lowUsd: 0,
      highUsd: 2_000,
      rationale: "Pre-qualification — opportunity unknown until buyer answers the fishing question",
    },
    financial: { marginBand: "unknown — qualifying", requiresClassC: false, escalationClauseRequired: false },
    dontShare: ["product roadmap / future SKUs / vitamin line / side-pitches"],
  },
  C_polite_no: {
    goal: "deflect",
    risks: ["Over-apologizing", "Tone mismatch (don't ask for a yes a second time)"],
    playSeed:
      "One-sentence acknowledge + thanks. Mark contact UNQUALIFIED in HubSpot. Close loop without further outreach.",
    opportunity: {
      lowUsd: 0,
      highUsd: 0,
      rationale: "Buyer declined — opportunity closed; preserve relationship for future re-engagement",
    },
    financial: { marginBand: "n/a — declined", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  D_pricing_pushback: {
    goal: "hold",
    risks: [
      "Locking pricing without Rene approval",
      "Volume-commit trap (multi-batch escalation clause required if reorder discussed)",
      "Leaking COGS to defend the price",
    ],
    playSeed:
      "HARD HOLD — surface to Ben + Rene in #financials. Never autonomous reply. Formal proposal track if buyer is whale-class.",
    opportunity: {
      lowUsd: 5_000,
      highUsd: 50_000,
      rationale: "Pricing pushback usually means real volume is on the table — needs Class C analysis",
    },
    financial: {
      marginBand: "depends — needs custom-quote formula run",
      requiresClassC: true,
      escalationClauseRequired: true,
    },
    dontShare: ["distributor commitments ($2.10 / $2.49)", "off-grid pricing visibility flag"],
  },
  E_vendor_portal_step: {
    goal: "redirect",
    risks: ["Portal submission stalls (no operator follow-through)"],
    playSeed:
      "Hand off to Claude in Chrome via /contracts/portal-submission-backlog.md. Acknowledge + commit a date.",
    opportunity: {
      lowUsd: 1_000,
      highUsd: 25_000,
      rationale: "Portal-submission paths usually feed retailer onboarding — moderate first-PO if accepted",
    },
    financial: { marginBand: "TBD — portal terms determine", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  F_thread_continuity_issue: {
    goal: "redirect",
    risks: ["Re-firing into a new thread (Cindy/Redstone fix)"],
    playSeed:
      "Reply IN-THREAD via existing engagement. Preserve In-Reply-To header. Acknowledge thread continuity if buyer flagged it.",
    opportunity: {
      lowUsd: 0,
      highUsd: 5_000,
      rationale: "Continuation of an existing engagement — opportunity flat",
    },
    financial: { marginBand: "preserves prior frame", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  G_status_check_urgency: {
    goal: "info-gather",
    risks: ["Surfacing late on an urgent ask"],
    playSeed:
      "Verify state (was the auto-responder actually sent? did the sample land?), answer with facts, log to HubSpot.",
    opportunity: {
      lowUsd: 0,
      highUsd: 5_000,
      rationale: "Urgency check — exists to preserve relationship; opportunity depends on what's behind it",
    },
    financial: { marginBand: "n/a — preservation play", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  H_ap_vendor_setup: {
    goal: "redirect",
    risks: [
      "AP packet sent without NCS-001 / W-9 / COI / banking trio complete",
      "Treating this as auto when it's actually a real PO trigger",
    ],
    playSeed:
      "Hand off to Phase 35.f wholesale-onboarding flow. Don't auto-fill financial fields.",
    opportunity: {
      lowUsd: 1_000,
      highUsd: 50_000,
      rationale: "Vendor onboarding often precedes first PO — opportunity depends on retailer scale",
    },
    financial: { marginBand: "preserved per pricing tier", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  I_ooo_with_return_date: {
    goal: "nurture",
    risks: ["Re-poking before return date (looks pushy)"],
    playSeed:
      "Set 14-day re-poke reminder via hubspot.task.create. No outbound until return date. Quiet-collapse the auto-reply.",
    opportunity: {
      lowUsd: 0,
      highUsd: 2_000,
      rationale: "OOO — opportunity preserved at original frame",
    },
    financial: { marginBand: "preserved", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  J_ooo_with_alternate_contact: {
    goal: "redirect",
    risks: ["Doubling up — both old and new contact getting outreach"],
    playSeed:
      "Mark old contact UNQUALIFIED + note. Create new contact at alternate email. Queue re-outreach for new contact.",
    opportunity: {
      lowUsd: 0,
      highUsd: 3_000,
      rationale: "Routing fix — opportunity preserved if alternate is real",
    },
    financial: { marginBand: "preserved", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  N_hard_bounce: {
    goal: "redirect",
    risks: ["Treating a temporary 5xx as a hard bounce"],
    playSeed:
      "Mark UNQUALIFIED + bounce-note. If a research path exists, queue alternate-email lookup.",
    opportunity: {
      lowUsd: 0,
      highUsd: 2_000,
      rationale: "Bounce — opportunity preserved if alt-email research succeeds",
    },
    financial: { marginBand: "n/a — bounce", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  S_whale_class: {
    goal: "hold",
    risks: [
      "Autonomous reply (NEVER — every whale touch is human-only per §3.1)",
      "Pricing leak under whale pressure",
      "Exclusivity / multi-year trap",
    ],
    playSeed:
      "HARD HOLD — surface to Ben + Rene in #financials thread. Never autonomous reply. Formal PDF proposal track only.",
    opportunity: {
      lowUsd: 50_000,
      highUsd: 5_000_000,
      rationale: "Whale-class touch — full upside is national distribution; downside is existential brand-dilution risk",
    },
    financial: {
      marginBand: "Class C minimum — custom-quote formula run + Rene approval",
      arExposure: "potentially significant — net-30 to net-90 typical",
      requiresClassC: true,
      escalationClauseRequired: true,
    },
    dontShare: [
      "any pricing without Rene+Ben approval",
      "current customer roster / route density",
      "competitor wins or losses",
    ],
  },
  T_executive_inbound: {
    goal: "qualify",
    risks: [
      "Tone mismatch (executives expect concise + decisive, not chatty)",
      "Class B minimum — never Class A",
    ],
    playSeed:
      "Class B minimum — Ben single-approve required. Concise reply with one specific next-step ask.",
    opportunity: {
      lowUsd: 10_000,
      highUsd: 500_000,
      rationale: "Executive title typically means real decision-making authority — moderate-to-large opportunity",
    },
    financial: { marginBand: "preserved", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  U_legal_language: {
    goal: "hold",
    risks: ["Agreeing to terms without counsel review", "Indemnification trap"],
    playSeed:
      "Class D — human only, attorney loop. NEVER agent-drafted. Surface to Ben + counsel.",
    opportunity: {
      lowUsd: 0,
      highUsd: 0,
      rationale: "Legal-class touch — opportunity is contingent on terms, not measurable here",
    },
    financial: {
      marginBand: "n/a — legal class",
      arExposure: "potentially material",
      requiresClassC: true,
      escalationClauseRequired: true,
    },
    dontShare: ["our prior contract terms", "supplier agreements"],
  },
  V_volume_commitment: {
    goal: "hold",
    risks: [
      "Locked pricing without volume guarantee",
      "Multi-batch escalation clause missing",
      "AR exposure at scale",
    ],
    playSeed:
      "Class C — Ben + Rene + escalation clause + custom-quote formula run before reply.",
    opportunity: {
      lowUsd: 25_000,
      highUsd: 1_000_000,
      rationale: "Multi-pallet / multi-thousand-bag commitment — needs full economics analysis",
    },
    financial: {
      marginBand: "depends — custom-quote formula required",
      arExposure: "material — net terms TBD",
      requiresClassC: true,
      escalationClauseRequired: true,
    },
    dontShare: ["distributor commitments", "off-grid quote flag", "current capacity utilization"],
  },
  W_vendor_invoice_inbound: {
    goal: "redirect",
    risks: ["Auto-posting to QBO without Rene approval"],
    playSeed:
      "Extract bill data, attach PDF to QBO bill DRAFT, post to #financials for Rene Class C approval. NEVER auto-post.",
    opportunity: {
      lowUsd: 0,
      highUsd: 0,
      rationale: "Vendor invoice — finance ops, no upside",
    },
    financial: {
      marginBand: "n/a — bill",
      arExposure: null,
      requiresClassC: true,
      escalationClauseRequired: false,
    },
    dontShare: [],
  },
  X_receipt_cc_ach: {
    goal: "redirect",
    risks: ["Mis-categorization in QBO Chart of Accounts"],
    playSeed:
      "Post extracted fields to #receipts-capture for Rene categorization (Class B).",
    opportunity: {
      lowUsd: 0,
      highUsd: 0,
      rationale: "Receipt — finance ops, no upside",
    },
    financial: { marginBand: "n/a", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  Y_customer_payment_inbound: {
    goal: "redirect",
    risks: ["Mismatching to wrong invoice"],
    playSeed:
      "Match payment to outstanding invoice in QBO. Class B mark-paid if exact match; Class C #financials if no match.",
    opportunity: {
      lowUsd: 0,
      highUsd: 0,
      rationale: "Payment confirmation — AR close, no new opportunity",
    },
    financial: { marginBand: "preserves invoiced", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
  Z_obvious_spam: {
    goal: "deflect",
    risks: ["Trashing a real human reply that landed in a denylist domain"],
    playSeed:
      "Spam Cleaner §2.8 handles. Class A-d delete, daily digest only.",
    opportunity: {
      lowUsd: 0,
      highUsd: 0,
      rationale: "Spam — no opportunity",
    },
    financial: { marginBand: "n/a", requiresClassC: false, escalationClauseRequired: false },
    dontShare: [],
  },
};

// Fallback used when no per-category default exists.
const FALLBACK_DEFAULTS: CategoryDefaults = {
  goal: "info-gather",
  risks: ["Category fell to fallback — strategic context likely incomplete"],
  playSeed: "Surface to operator for human triage; no autonomous draft.",
  opportunity: {
    lowUsd: 0,
    highUsd: 1_000,
    rationale: "Unmapped category — opportunity unknown",
  },
  financial: { marginBand: "unknown", requiresClassC: false, escalationClauseRequired: false },
  dontShare: [],
};

// ---------------------------------------------------------------------------
// Tier-based opportunity scaling (when ProspectFrame provides a tier)
// ---------------------------------------------------------------------------

/**
 * Per /contracts/email-agents-system.md §11.2: tier scaling for opportunity
 * estimates. Multipliers are conservative — drafter / human can refine.
 */
const TIER_MULTIPLIERS: Record<string, number> = {
  T0: 50, // whale-class — 50× base
  T1: 10, // mid-cap chains
  T2: 3, // regional / small-chain
  T3: 1, // single-location
};

function scaleOpportunityForTier(
  base: OpportunityRange,
  tier: string | undefined,
): OpportunityRange {
  if (!tier) return base;
  const mult = TIER_MULTIPLIERS[tier];
  if (!mult) return base;
  return {
    lowUsd: Math.round(base.lowUsd * mult),
    highUsd: Math.round(base.highUsd * mult),
    rationale: `${base.rationale} (scaled ×${mult} for tier ${tier})`,
  };
}

// ---------------------------------------------------------------------------
// Relationship lookup
// ---------------------------------------------------------------------------

function deriveRelationship(
  record: ClassifiedRecord,
  verification?: VerificationMetadata | null,
  prospect?: ProspectFrameInput,
): RelationshipKind {
  // Whale always wins (defense-in-depth — classifier may have missed it,
  // but the verification layer catches whale-domain matches).
  if (record.category === "S_whale_class") return "whale";
  if (verification?.whaleDomainMatch) return "whale";

  // Distributor vertical signal.
  if (
    prospect?.vertical &&
    /^distributor_/.test(prospect.vertical)
  ) {
    return "distributor";
  }

  if (verification?.contact?.lifecycleStage) {
    const ls = verification.contact.lifecycleStage.toLowerCase();
    if (ls === "customer") return "established";
    if (ls === "opportunity" || ls === "salesqualifiedlead") return "warm";
    if (ls === "lead" || ls === "subscriber") return "cold";
  }

  if (verification?.contact?.contactId) {
    // Contact exists in HubSpot but no lifecycle signal — treat as warm.
    return "warm";
  }

  // Default: cold.
  return "cold";
}

// ---------------------------------------------------------------------------
// Premise derivation
// ---------------------------------------------------------------------------

function derivePremise(record: ClassifiedRecord): string {
  const subject = (record.subject || "").trim();
  const reason = record.classificationReason || "";
  const fromName =
    record.fromHeader.match(/^([^<]+)</)?.[1].trim() || record.fromEmail;
  const subjectFragment = subject.length > 60 ? `${subject.slice(0, 57)}...` : subject;
  return `Inbound from ${fromName} (${record.fromEmail}) — subject: "${subjectFragment}". Classifier: ${record.category} (${reason}).`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a `StrategicFrame` from structured inputs. Pure function — every
 * input is explicit, no env / network / KV access.
 *
 * The result populates the deterministic skeleton; the drafter (37.6 /
 * 37.11) layers LLM-driven nuance on top of it (specifically: refining
 * `play` from `playSeed`, and adding draft-specific risks beyond the
 * category defaults).
 */
export function buildStrategicFrame(opts: BuildStrategicFrameOpts): StrategicFrame {
  const { record, verification, prospect, cashflow } = opts;
  const defaults =
    CATEGORY_DEFAULTS[record.category] ?? FALLBACK_DEFAULTS;

  const relationship = deriveRelationship(record, verification, prospect);
  // Whale relationship always elevates goal to hold regardless of category default.
  const goal: StrategicGoal = relationship === "whale" ? "hold" : defaults.goal;

  const opportunity = scaleOpportunityForTier(
    defaults.opportunity,
    prospect?.tier,
  );

  // Cashflow signal can elevate Class-C requirement (today/this_week with
  // a high opportunity → operator needs explicit pricing approval).
  const cashflowElevatesClassC =
    cashflow?.cashSpeed === "today" || cashflow?.cashSpeed === "this_week"
      ? opportunity.highUsd >= 10_000
      : false;

  const financialFrame: FinancialFrame = {
    marginBand: defaults.financial.marginBand ?? "preserved per pricing tier",
    arExposure: defaults.financial.arExposure ?? null,
    requiresClassC:
      Boolean(defaults.financial.requiresClassC) ||
      relationship === "whale" ||
      cashflowElevatesClassC,
    escalationClauseRequired:
      Boolean(defaults.financial.escalationClauseRequired) ||
      relationship === "whale",
  };

  // dontShare composition: universal floor + category additions + ad-hoc
  // tier additions (whale tier always adds the pricing-leak guard).
  const dontShare: string[] = [
    ...UNIVERSAL_DONT_SHARE,
    ...defaults.dontShare,
  ];
  if (relationship === "whale") {
    dontShare.push("any pricing without Rene+Ben approval — whale-class lock");
  }
  if (prospect?.tier === "T0" || prospect?.tier === "T1") {
    dontShare.push("competitor account names + delivered pricing");
  }

  return {
    premise: derivePremise(record),
    relationship,
    opportunity,
    goal,
    risks: [...defaults.risks],
    financialFrame,
    dontShare,
    play: defaults.playSeed,
  };
}

// ---------------------------------------------------------------------------
// Validation — the pre-draft gate
// ---------------------------------------------------------------------------

export interface FrameValidationResult {
  ok: boolean;
  missingFields: string[];
  reason: string;
}

/**
 * Per §2.5b hard rule: "If the frame is missing or any of the 8 fields
 * is empty, the system rejects the draft and forces re-analysis."
 *
 * Returns ok=true when all 8 required fields are present + non-empty.
 */
export function validateStrategicFrame(
  frame: StrategicFrame | null | undefined,
): FrameValidationResult {
  if (!frame) {
    return {
      ok: false,
      missingFields: [
        "premise",
        "relationship",
        "opportunity",
        "goal",
        "risks",
        "financialFrame",
        "dontShare",
        "play",
      ],
      reason: "StrategicFrame is null/undefined — drafter cannot proceed without analysis",
    };
  }

  const missing: string[] = [];
  if (!frame.premise || !frame.premise.trim()) missing.push("premise");
  if (!frame.relationship) missing.push("relationship");
  if (
    !frame.opportunity ||
    typeof frame.opportunity.lowUsd !== "number" ||
    typeof frame.opportunity.highUsd !== "number" ||
    !frame.opportunity.rationale ||
    !frame.opportunity.rationale.trim()
  ) {
    missing.push("opportunity");
  }
  if (!frame.goal) missing.push("goal");
  if (!Array.isArray(frame.risks) || frame.risks.length === 0) missing.push("risks");
  if (
    !frame.financialFrame ||
    !frame.financialFrame.marginBand ||
    !frame.financialFrame.marginBand.trim()
  ) {
    missing.push("financialFrame");
  }
  if (!Array.isArray(frame.dontShare) || frame.dontShare.length === 0) {
    missing.push("dontShare");
  }
  if (!frame.play || !frame.play.trim()) missing.push("play");

  if (missing.length === 0) {
    return { ok: true, missingFields: [], reason: "All 8 fields populated" };
  }
  return {
    ok: false,
    missingFields: missing,
    reason: `Missing or empty fields: ${missing.join(", ")} — re-analysis required per §2.5b`,
  };
}

// ---------------------------------------------------------------------------
// Slack approval-card renderer
// ---------------------------------------------------------------------------

/**
 * Render the StrategicFrame as a compact Slack-flavored markdown block
 * for the §2.5a approval-card top-of-message. Empty when frame is invalid.
 */
export function renderStrategicFrameForCard(frame: StrategicFrame): string {
  const lines: string[] = [
    "*🎯 STRATEGIC FRAMEWORK*",
    `• *Premise:* ${frame.premise}`,
    `• *Relationship:* ${frame.relationship}`,
    `• *Opportunity:* $${frame.opportunity.lowUsd.toLocaleString()}–$${frame.opportunity.highUsd.toLocaleString()} — ${frame.opportunity.rationale}`,
    `• *Goal:* ${frame.goal}`,
    `• *Risks:*`,
  ];
  for (const r of frame.risks) lines.push(`    – ${r}`);
  const fin = frame.financialFrame;
  lines.push(
    `• *Financial frame:* ${fin.marginBand}` +
      (fin.arExposure ? ` · AR: ${fin.arExposure}` : "") +
      (fin.requiresClassC ? " · *requires Class C*" : "") +
      (fin.escalationClauseRequired ? " · *escalation clause required*" : ""),
  );
  lines.push(`• *Don't-share:*`);
  for (const d of frame.dontShare) lines.push(`    – ${d}`);
  lines.push(`• *Play:* ${frame.play}`);
  return lines.join("\n");
}
