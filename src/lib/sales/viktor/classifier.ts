/**
 * Phase 37.2 — Classifier (Viktor capability).
 *
 * Per /contracts/email-agents-system.md §1 + §2.2 + §3.1: tag every
 * `received` inbox-scan record with one of the 22 canonical categories
 * A–AA. HARD STOPS first (whale-domain detection runs before everything
 * else and short-circuits all subsequent rules).
 *
 * This is a CAPABILITY inside the Viktor runtime, NOT a new top-level
 * agent. Promotion gate §15 still applies before this becomes its own
 * runtime entry.
 *
 * Doctrine constraints (locked v1.0 2026-04-30 PM):
 *   - Class A `system.read` only. No outbound, no HubSpot write, no
 *     spam-cleaner delete (37.7 owns that).
 *   - Whale-domain match is a HARD STOP — no LLM, no fallback rule.
 *     21-domain canonical list per §3.1.
 *   - Deterministic rule layer FIRST (postmaster bounces, Automatic
 *     reply OOO, "no longer with"-style contact-left, Re: thread-
 *     continuity hint). LLM fallback is Phase 37.2.b — out of scope here.
 *   - Reuses the legacy email-intelligence classifier as a fallback for
 *     A-AA categories the deterministic rules don't cover (sample,
 *     b2b, ap, vendor, receipt). Legacy 9-category enum is mapped into
 *     v1 A-AA below.
 *   - KV record status transitions: `received` → `classified` (or
 *     `classified_whale` when the HARD STOP fires; the elevated suffix
 *     is so downstream agents can refuse to draft on whale-class records
 *     even if they don't read the category field).
 *   - Idempotent: re-classifying an already-classified record is a
 *     no-op unless `force` is set.
 */
import { kv } from "@vercel/kv";

import {
  classifyEmail as legacyClassify,
  type Classification as LegacyClassification,
  type EmailCategory as LegacyCategory,
} from "@/lib/ops/email-intelligence/classifier";
import type { EmailEnvelope } from "@/lib/ops/gmail-reader";
import {
  fromEmailDomain,
  type ScanStatus,
  type ScannedRecord,
} from "./inbox-scanner";

// ---------------------------------------------------------------------------
// Categories — v1 22-class taxonomy per /contracts/email-agents-system.md §1
// ---------------------------------------------------------------------------

/**
 * 22 canonical inbound categories (v1.0). Letters A–AA per §1 of the
 * email-agents-system contract; suffixes are the proposal's letter
 * codes preserved verbatim for traceability.
 */
export type EmailCategoryV1 =
  // §1.1 inbound replies on outbound outreach
  | "A_sample_request"
  | "B_qualifying_question"
  | "C_polite_no"
  | "D_pricing_pushback"
  | "E_vendor_portal_step"
  | "F_thread_continuity_issue"
  | "G_status_check_urgency"
  | "H_ap_vendor_setup"
  // §1.2 auto-replies / OOO
  | "I_ooo_with_return_date"
  | "J_ooo_with_alternate_contact"
  | "K_domain_redirect"
  | "L_bot_no_reply"
  | "M_generic_received_ack"
  // §1.3 bounces / delivery failures
  | "N_hard_bounce"
  | "O_group_restricted"
  | "P_soft_bounce"
  // §1.4a inbound vendor / financial
  | "W_vendor_invoice_inbound"
  | "X_receipt_cc_ach"
  | "Y_customer_payment_inbound"
  | "Z_obvious_spam"
  | "AA_statement_artifact"
  // §1.5 strategic / whale (HUMAN ONLY)
  | "S_whale_class"
  | "T_executive_inbound"
  | "U_legal_language"
  | "V_volume_commitment"
  // sentinel — no rule fired; needs LLM fallback (Phase 37.2.b) or human triage
  | "_unclassified";

export interface ClassifiedRecord extends ScannedRecord {
  category: EmailCategoryV1;
  confidence: number;
  /** Identifier of the rule that fired (or `legacy:<ruleId>`/`unclassified`). */
  ruleId: string;
  /** Human-readable reason — surfaced in the Slack approval card. */
  classificationReason: string;
  /** ISO timestamp when the classifier ran. */
  classifiedAt: string;
}

export type ClassifiedScanStatus =
  | ScanStatus
  | "classified"
  | "classified_whale";

// ---------------------------------------------------------------------------
// Whale-domain canonical list — §3.1 (21 domains)
// ---------------------------------------------------------------------------

/**
 * Whale-class domains. ANY inbound from these triggers an instant
 * `S_whale_class` classification — no LLM second-guess, no other rule
 * runs after this. Drafting on a whale-class record is HARD-blocked at
 * the §2.5 approval gate (Class C / D minimum).
 *
 * Adding to / removing from this list is a Class B doctrine edit per
 * OQ-2 (Ben's lock 2026-04-30 PM).
 */
export const WHALE_DOMAINS: readonly string[] = [
  "buc-ees.com",
  "kehe.com",
  "mclaneco.com",
  "walmart.com",
  "samsclub.com",
  "heb.com",
  "costco.com",
  "aramark.com",
  "compass-usa.com",
  "delawarenorth.com",
  "delawarenorth.onmicrosoft.com",
  "xanterra.com",
  "ssagroup.com",
  "nationalgeographic.com",
  "evelynhill.com",
  "easternnational.org",
  "kroger.com",
  "wholefoods.com",
  "unfi.com",
  "dotfoods.com",
  "core-mark.com",
  "bp.com",
  "7-eleven.com",
  "wawa.com",
  "sheetz.com",
  "ta-petro.com",
  "cfrmarketing.com",
  "eg.com",
] as const;

/** Returns the matched whale domain entry, or empty string when none. */
export function matchWhaleDomain(
  fromEmail: string,
  whaleDomains: readonly string[] = WHALE_DOMAINS,
): string {
  const domain = fromEmailDomain(fromEmail);
  if (!domain) return "";
  for (const w of whaleDomains) {
    const needle = w.toLowerCase();
    if (domain === needle || domain.endsWith(`.${needle}`)) return w;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Deterministic rule patterns (per §2.2)
// ---------------------------------------------------------------------------

const POSTMASTER_REGEX = /^postmaster@|^mailer-daemon@|<postmaster@|<mailer-daemon@/i;
const HARD_BOUNCE_BODY_REGEX =
  /\b(address not found|mailbox unavailable|user unknown|no such user|recipient address rejected|550[ -]|554[ -]|domain (?:not found|does not exist))\b/i;
const SOFT_BOUNCE_BODY_REGEX =
  /\b(temporary problem|gmail will retry|will retry|451[ -]|421[ -]|message delayed|delivery delay|deferred)\b/i;
const GROUP_RESTRICTED_REGEX =
  /\b(group accept(?:s)? mail only|distribution list|not authorized to (?:send|post)|550[ -].*group)\b/i;

const OOO_SUBJECT_REGEX = /\b(automatic reply|out[- ]of[- ]office|auto[- ]reply|on (?:vacation|leave))\b/i;
const OOO_BODY_REGEX =
  /\b(out of (?:the )?office|return on|i('|')?ll be (?:back|out)|away (?:from|until)|on (?:vacation|leave|holiday)|back (?:on|in) [A-Z][a-z]+|will return)\b/i;
const ALTERNATE_CONTACT_REGEX =
  /\b(please contact|please email|in my absence|reach out to|alternate contact|for urgent matters|in the meantime)\b/i;

const CONTACT_LEFT_REGEX =
  /\b(no longer (?:with|at|employed)|has left|is no longer|out of (?:the )?company|no longer (?:work|employed))\b/i;

const RECEIVED_ACK_REGEX =
  /\b(thank you for (?:reaching out|your email|contacting)|we(?:'|')?ve received your (?:email|message|inquiry)|thank you for your (?:interest|message)|automated (?:response|acknowledgment)|this is an? auto(?:matic|mated) (?:reply|response))\b/i;

// Strategic detection — categories D, T, U, V (§3.2 / §3.3 + §1.5)
const PRICING_PUSHBACK_REGEX =
  /\b(per[- ]bag|per[- ]oz|per[- ]ounce|premium over|albanese|wholesale rate|case cost|moq|lower price|too expensive|price comparison|pricing comparison|haribo (?:price|cost)|mfg suggested)\b/i;
const LEGAL_LANGUAGE_REGEX =
  /\b(mnda|nda |non[- ]disclosure|indemnif|exclusivity|exclusive (?:rights|territory|distributorship)|terms of (?:service|use|sale)|master (?:agreement|service)|legal counsel|attorney|jurisdiction|governing law|breach of contract)\b/i;
const VOLUME_COMMITMENT_REGEX =
  /\b(\d{1,3}\s*(?:pallet|case)s?|\d{2,5}\s*bags?|guaranteed (?:volume|quantity)|minimum (?:order|commitment)|annual volume|forecast(?:ed)? \d|2[5-9]00\s*bag|3[0-9]00\s*bag|[4-9][0-9]00\s*bag|[1-9]\d{4,}\s*unit)\b/i;
const EXECUTIVE_TITLE_REGEX =
  /\b(chief (?:executive|operating|financial|marketing|merchandising) officer|^ceo\b|^coo\b|^cfo\b|^cmo\b|svp |senior vice president|vp of |vice president|chairman|chairwoman|founder & ceo|^director,?\s+|head of (?:merchandising|category|buying|sourcing|supply))\b/i;

// Vendor-portal / submission step (§E)
const VENDOR_PORTAL_REGEX =
  /\b(product submissions?|submit your product|new vendor (?:application|registration)|vendor portal|onboarding portal|please complete (?:our|the) (?:form|application)|line review submission|category (?:review|submission))\b/i;

// ---------------------------------------------------------------------------
// Mapping legacy 9-category → v1 22-category
// ---------------------------------------------------------------------------

/**
 * Project the legacy `EmailCategory` from src/lib/ops/email-intelligence
 * into the v1 22-category enum. The legacy classifier is reused as a
 * fallback for categories the deterministic v1 rules don't cover.
 *
 * Legacy categories that have no clean v1 home (e.g. legacy
 * `marketing_pr`) collapse into `Z_obvious_spam` only when the legacy
 * confidence is high enough — otherwise they fall through to
 * `_unclassified` for human triage.
 */
export function mapLegacyCategory(
  legacy: LegacyCategory,
): EmailCategoryV1 | null {
  switch (legacy) {
    case "sample_request":
      return "A_sample_request";
    case "b2b_sales":
      return "B_qualifying_question";
    case "ap_finance":
      return "H_ap_vendor_setup";
    case "vendor_supply":
      return "W_vendor_invoice_inbound";
    case "receipt_document":
      return "X_receipt_cc_ach";
    case "junk_fyi":
      return "Z_obvious_spam";
    case "shipping_issue":
      // Shipping issue from a customer is functionally a qualifying-question
      // / customer-support bucket — there's no dedicated v1 letter for
      // shipping-issue inbound, so we keep it in B for now.
      return "B_qualifying_question";
    case "customer_support":
      return "B_qualifying_question";
    case "marketing_pr":
      // No clean v1 home; surface for human triage rather than auto-spam.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Rule evaluator
// ---------------------------------------------------------------------------

interface RuleHit {
  category: EmailCategoryV1;
  confidence: number;
  ruleId: string;
  reason: string;
}

function buildLegacyEnvelope(record: ScannedRecord): EmailEnvelope {
  return {
    id: record.messageId,
    threadId: record.threadId,
    from: record.fromHeader,
    to: "",
    subject: record.subject,
    date: record.date,
    snippet: record.snippet,
    labelIds: record.labelIds,
  };
}

/**
 * Run the deterministic rule layer (no LLM, no network). Returns the first
 * matching rule, or null when none fired. Whale-domain detection runs
 * BEFORE this function — it is a HARD STOP and not part of the rule chain.
 */
export function applyDeterministicRules(record: ScannedRecord): RuleHit | null {
  const subject = (record.subject || "").trim();
  const fromRaw = (record.fromHeader || "").trim();
  const fromEmail = record.fromEmail || "";
  const snippet = (record.snippet || "").trim();
  const text = `${subject}\n${snippet}`;

  // 1. Postmaster / mailer-daemon → bounce family.
  if (POSTMASTER_REGEX.test(fromRaw)) {
    if (HARD_BOUNCE_BODY_REGEX.test(text)) {
      // Group-restricted bounce is a sub-flavor of hard bounce.
      if (GROUP_RESTRICTED_REGEX.test(text)) {
        return {
          category: "O_group_restricted",
          confidence: 0.92,
          ruleId: "postmaster-group-restricted",
          reason:
            "Postmaster sender + group-only / distribution-list rejection language",
        };
      }
      return {
        category: "N_hard_bounce",
        confidence: 0.95,
        ruleId: "postmaster-hard-bounce",
        reason: "Postmaster sender + hard-bounce body phrasing",
      };
    }
    if (SOFT_BOUNCE_BODY_REGEX.test(text)) {
      return {
        category: "P_soft_bounce",
        confidence: 0.9,
        ruleId: "postmaster-soft-bounce",
        reason: "Postmaster sender + temporary-delay / will-retry phrasing",
      };
    }
    // Postmaster but no recognized body — still treat as bounce family
    // at low confidence so the orchestrator surfaces for human eyes.
    return {
      category: "N_hard_bounce",
      confidence: 0.7,
      ruleId: "postmaster-unknown-body",
      reason: "Postmaster sender with unrecognized body — assume bounce",
    };
  }

  // 2. OOO autoreply (subject signal first, then body confirms).
  if (OOO_SUBJECT_REGEX.test(subject) || OOO_BODY_REGEX.test(text)) {
    if (CONTACT_LEFT_REGEX.test(text)) {
      // Contact left org — handled by §J/K routing-updater.
      return {
        category: "J_ooo_with_alternate_contact",
        confidence: 0.9,
        ruleId: "ooo-contact-left",
        reason: "Auto-reply naming an alternate contact / contact-left org",
      };
    }
    if (ALTERNATE_CONTACT_REGEX.test(text)) {
      return {
        category: "J_ooo_with_alternate_contact",
        confidence: 0.85,
        ruleId: "ooo-alternate-contact",
        reason: "OOO autoreply names an alternate contact / 'please contact' phrase",
      };
    }
    return {
      category: "I_ooo_with_return_date",
      confidence: 0.88,
      ruleId: "ooo-return-date",
      reason: "Automatic-reply / OOO subject or body without alternate contact",
    };
  }

  // 3. Standalone "no longer with" — sometimes from a reply-all, not OOO.
  if (CONTACT_LEFT_REGEX.test(text)) {
    return {
      category: "J_ooo_with_alternate_contact",
      confidence: 0.85,
      ruleId: "contact-left-org",
      reason: "Body matches 'no longer with/at' contact-left phrasing",
    };
  }

  // 4. Generic received-ack ("we'll get back to you") → M.
  if (RECEIVED_ACK_REGEX.test(text)) {
    return {
      category: "M_generic_received_ack",
      confidence: 0.82,
      ruleId: "received-ack",
      reason: "Auto-acknowledgment ('we received your email' / 'thank you for...')",
    };
  }

  // 5. Strategic detection — these can override later legacy classifications.
  if (LEGAL_LANGUAGE_REGEX.test(text)) {
    return {
      category: "U_legal_language",
      confidence: 0.9,
      ruleId: "legal-language",
      reason:
        "Body contains legal phrasing (NDA, indemnif, exclusivity, MNDA, terms of service)",
    };
  }
  if (VOLUME_COMMITMENT_REGEX.test(text)) {
    return {
      category: "V_volume_commitment",
      confidence: 0.85,
      ruleId: "volume-commitment",
      reason: "Body references multi-pallet / multi-thousand-bag volume commit",
    };
  }
  if (PRICING_PUSHBACK_REGEX.test(text)) {
    return {
      category: "D_pricing_pushback",
      confidence: 0.82,
      ruleId: "pricing-pushback",
      reason: "Body contains explicit pricing / per-bag / Albanese-comp pushback language",
    };
  }
  if (EXECUTIVE_TITLE_REGEX.test(text)) {
    return {
      category: "T_executive_inbound",
      confidence: 0.78,
      ruleId: "executive-title",
      reason: "Body / subject mentions executive-grade title (CEO/COO/VP/Director)",
    };
  }

  // 6. Vendor portal / product-submission step → E.
  if (VENDOR_PORTAL_REGEX.test(text)) {
    return {
      category: "E_vendor_portal_step",
      confidence: 0.85,
      ruleId: "vendor-portal-step",
      reason: "Body references portal / product-submission / vendor-application step",
    };
  }

  return null;
}

/**
 * Top-level deterministic + legacy classifier. Returns one of the 22
 * v1 categories (or `_unclassified` when nothing fires).
 *
 * Resolution order:
 *   1. Whale domain HARD STOP — short-circuits everything.
 *   2. Deterministic v1 rules (postmaster, OOO, contact-left, legal,
 *      volume, pricing pushback, executive title, vendor portal).
 *   3. Legacy classifier mapped into v1 enum.
 *   4. Fallback to `_unclassified` for human / LLM review.
 */
export function classifyScannedRecord(record: ScannedRecord): {
  category: EmailCategoryV1;
  confidence: number;
  ruleId: string;
  reason: string;
} {
  // Noise from the scanner stays Z (obvious spam) at low confidence —
  // the spam-cleaner (Phase 37.7) decides whether to delete.
  if (record.status === "received_noise") {
    return {
      category: "Z_obvious_spam",
      confidence: 0.6,
      ruleId: "scanner-noise",
      reason: `Scanner flagged ${record.noiseReason || "denylist sender"}`,
    };
  }

  // 1. Whale domain HARD STOP.
  const whale = matchWhaleDomain(record.fromEmail);
  if (whale) {
    return {
      category: "S_whale_class",
      confidence: 0.99,
      ruleId: "whale-domain",
      reason: `Sender domain matches whale list (${whale}) — HARD STOP, no autonomous reply ever`,
    };
  }

  // 2. Deterministic v1 rules.
  const ruleHit = applyDeterministicRules(record);
  if (ruleHit) {
    return {
      category: ruleHit.category,
      confidence: ruleHit.confidence,
      ruleId: ruleHit.ruleId,
      reason: ruleHit.reason,
    };
  }

  // 3. Legacy classifier fallback — projects through mapLegacyCategory.
  const legacyEnv = buildLegacyEnvelope(record);
  const legacy: LegacyClassification = legacyClassify(legacyEnv);
  const mapped = mapLegacyCategory(legacy.category);
  if (mapped) {
    return {
      category: mapped,
      // Legacy confidence is preserved but capped at 0.85 since the
      // mapping is opinionated and should be revisitable.
      confidence: Math.min(legacy.confidence, 0.85),
      ruleId: `legacy:${legacy.ruleId}`,
      reason: `Legacy classifier mapped ${legacy.category} → ${mapped}: ${legacy.reason}`,
    };
  }

  // 4. Unclassified — Phase 37.2.b LLM fallback or human triage.
  return {
    category: "_unclassified",
    confidence: 0.2,
    ruleId: "no-rule-match",
    reason: "No deterministic rule and no legacy mapping — needs LLM or human triage",
  };
}

// ---------------------------------------------------------------------------
// Persistence + runner
// ---------------------------------------------------------------------------

const KV_RECORD_PREFIX = "inbox:scan:";
const RECORD_TTL_SECONDS = 60 * 24 * 3600; // 60 days — matches scanner

/** Whale categories elevate the record's status field for downstream filtering. */
function statusForCategory(
  current: ScanStatus,
  category: EmailCategoryV1,
): ClassifiedScanStatus {
  if (current === "received_noise") return current; // preserve noise marker
  if (category === "S_whale_class") return "classified_whale";
  return "classified";
}

export interface ClassifierReport {
  examined: number;
  classified: number;
  skippedAlreadyClassified: number;
  skippedNoise: number;
  byCategory: Partial<Record<EmailCategoryV1, number>>;
  whaleHits: number;
  unclassified: number;
  degraded: boolean;
  degradedNotes: string[];
  classifiedRecords: ClassifiedRecord[];
}

export interface RunClassifierOpts {
  /** Records to classify (typically `report.newRecords` from runInboxScanner). */
  records: ScannedRecord[];
  /** When true, force re-classification of records that already have a category. */
  force?: boolean;
  /** When true, do not persist back to KV. */
  dryRun?: boolean;
  /** Override Date.now() for tests. */
  nowEpochMs?: number;
  /** Inject KV store for tests. */
  store?: {
    get: <T>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<unknown>;
  };
}

/**
 * Classify a batch of scanned records. Persists each updated record back
 * to KV under the same `inbox:scan:<msgId>` key with an elevated status
 * (`classified` / `classified_whale`) and the new fields (`category`,
 * `confidence`, `ruleId`, `classificationReason`, `classifiedAt`).
 *
 * Idempotent: records that already carry a `category` field are skipped
 * unless `force` is set.
 */
export async function runClassifier(
  opts: RunClassifierOpts,
): Promise<ClassifierReport> {
  const nowMs = opts.nowEpochMs ?? Date.now();
  const store = opts.store ?? {
    get: async <T>(key: string) => (await kv.get<T>(key)) ?? null,
    set: async (key: string, value: unknown) =>
      kv.set(key, value, { ex: RECORD_TTL_SECONDS }),
  };

  const report: ClassifierReport = {
    examined: 0,
    classified: 0,
    skippedAlreadyClassified: 0,
    skippedNoise: 0,
    byCategory: {},
    whaleHits: 0,
    unclassified: 0,
    degraded: false,
    degradedNotes: [],
    classifiedRecords: [],
  };

  for (const record of opts.records) {
    report.examined += 1;

    // If the record was already classified (carries the v1 fields),
    // skip unless force is on — preserves idempotence.
    const maybeClassified = record as Partial<ClassifiedRecord>;
    if (maybeClassified.category && !opts.force) {
      report.skippedAlreadyClassified += 1;
      continue;
    }

    const decision = classifyScannedRecord(record);

    const updated: ClassifiedRecord = {
      ...record,
      status: statusForCategory(record.status, decision.category) as ScanStatus,
      category: decision.category,
      confidence: decision.confidence,
      ruleId: decision.ruleId,
      classificationReason: decision.reason,
      classifiedAt: new Date(nowMs).toISOString(),
    };

    if (!opts.dryRun) {
      try {
        await store.set(`${KV_RECORD_PREFIX}${record.messageId}`, updated);
      } catch (err) {
        report.degraded = true;
        report.degradedNotes.push(
          `kv-set(${record.messageId}): ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
    }

    report.classified += 1;
    report.classifiedRecords.push(updated);
    report.byCategory[decision.category] =
      (report.byCategory[decision.category] ?? 0) + 1;
    if (decision.category === "S_whale_class") report.whaleHits += 1;
    if (decision.category === "_unclassified") report.unclassified += 1;
    if (record.status === "received_noise") report.skippedNoise += 1;
  }

  return report;
}
