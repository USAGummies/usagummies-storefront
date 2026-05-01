/**
 * Phase 37.3 — HubSpot Verification (Viktor capability).
 *
 * Per /contracts/email-agents-system.md §2.9 (BEN'S ADDITION 2026-04-30 PM):
 *
 *   "when it comes to customers/people we actually engage with, everything
 *    gets logged to HubSpot, everything is verified and queried against
 *    HubSpot."
 *
 * Cross-cutting helper that runs at three touch points:
 *   1. Pre-classify enrichment   ← THIS PHASE (37.3) ships this lane.
 *   2. Pre-send check             ← Phase 37.5 + 37.6 will call us.
 *   3. Daily reconciliation       ← Phase 37.15 (weekly audit) will call us.
 *
 * Doctrine constraints (locked v1.0 2026-04-30 PM):
 *   - Class A `system.read` for the lookups themselves.
 *   - NO auto-creation of contacts on first cut. The v0 spec line "or
 *     creates it" is held until the operator opts in explicitly. Auto-
 *     creation would be Class A `lead.enrichment.write` and we want a
 *     human-reviewed first send before we let it run unattended.
 *   - HARD BLOCK when `hs_lead_status === "UNQUALIFIED"` — the §7.8
 *     guardrail in the doctrine ("No outbound to UNQUALIFIED contacts
 *     without explicit operator override").
 *   - HubSpot 11.6 hard gate: `usa_vertical`, `usa_tier`, `usa_cadence_state`
 *     on the CONTACT must be present for the contact to be "live" per
 *     Ben's lock 2026-04-30 PM. Missing → `verification_incomplete` flag.
 *   - Idempotent and degrade-soft on every HubSpot call. A HubSpot 5xx
 *     does NOT fail the run — it surfaces as `verification_degraded` and
 *     the downstream classifier-output remains the source of truth.
 */
import { kv } from "@vercel/kv";

import {
  findContactByEmail,
  getContactById,
  isHubSpotConfigured,
} from "@/lib/ops/hubspot-client";
import { fromEmailDomain } from "./inbox-scanner";
import { matchWhaleDomain } from "./classifier";
import type { ClassifiedRecord } from "./classifier";
import type { ScannedRecord } from "./inbox-scanner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The verification status field — appended to the inbox:scan record.
 * Distinct from the scanner / classifier status fields so each layer is
 * independently auditable.
 */
export type VerificationStatus =
  | "verified"
  | "verification_unqualified" // hs_lead_status === UNQUALIFIED (HARD BLOCK on send)
  | "verification_missing_contact" // no HubSpot contact for this sender
  | "verification_incomplete" // contact exists but §11.6 fields not all populated
  | "verification_degraded" // HubSpot returned an error / degraded response
  | "verification_skipped"; // skipped (e.g. noise / classifier elected to short-circuit)

/**
 * Contact-side enrichment payload — the small structured slice we want
 * downstream agents (drafter / approval card) to be able to read off the
 * inbox:scan record without having to re-hit HubSpot.
 */
export interface HubSpotContactEnrichment {
  contactId: string;
  email: string;
  firstname: string;
  lastname: string;
  fullName: string;
  company: string;
  jobtitle: string;
  lifecycleStage: string;
  /** Most-relevant block: `UNQUALIFIED` is the doctrine hard-stop. */
  leadStatus: string;
  /** §11.6 USA Gummies custom properties (created via Path B 2026-04-30 PM). */
  usaVertical: string;
  usaTier: string;
  usaCadenceState: string;
  /** Indicates whether all three §11.6-required custom props are populated. */
  hubspotGateComplete: boolean;
}

/**
 * Verification metadata appended to the inbox:scan record. Embedded under
 * the `hubspot` key so we don't pollute the top-level shape with HubSpot-
 * specific fields.
 */
export interface VerificationMetadata {
  status: VerificationStatus;
  reason: string;
  /** When true, downstream drafter/sender MUST hard-block until override. */
  hardBlock: boolean;
  contact: HubSpotContactEnrichment | null;
  /** Whale-domain match for traceability — even when contact is missing. */
  whaleDomainMatch: string;
  /** ISO timestamp of the verification run. */
  verifiedAt: string;
  /** Diagnostic notes — non-fatal HubSpot warnings, etc. */
  notes: string[];
}

export interface VerifiedRecord extends ClassifiedRecord {
  hubspot: VerificationMetadata;
}

export interface VerificationReport {
  examined: number;
  verified: number;
  hardBlocked: number;
  missingContact: number;
  incomplete: number;
  degraded: number;
  skipped: number;
  /** Total HubSpot lookups attempted (helps cap rate-limit blast). */
  hubspotLookups: number;
  degradedNotes: string[];
  verifiedRecords: VerifiedRecord[];
}

export interface RunHubSpotVerificationOpts {
  /** Records to verify — typically `report.classifiedRecords` from runClassifier. */
  records: ClassifiedRecord[];
  /** Skip persistence + cap HubSpot lookups (still issues the lookups). */
  dryRun?: boolean;
  /** Override Date.now() for tests. */
  nowEpochMs?: number;
  /** Cap HubSpot lookups per run to prevent rate-limit blowups (default 30). */
  maxLookups?: number;
  /** Inject KV store for tests. */
  store?: {
    get: <T>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<unknown>;
  };
  /** Inject HubSpot lookup fns for tests (default = production hubspot-client). */
  hubspotLookups?: {
    findContactByEmail: (email: string) => Promise<string | null>;
    getContactById: (
      contactId: string,
      properties?: readonly string[],
    ) => Promise<{
      id: string;
      properties: Record<string, string | null>;
    } | null>;
    isConfigured: () => boolean;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KV_RECORD_PREFIX = "inbox:scan:";
const RECORD_TTL_SECONDS = 60 * 24 * 3600; // 60 days — matches scanner

/**
 * Property set we read off the contact for verification + downstream
 * drafter context. Keep narrow — every property adds a HubSpot API
 * surface area that has to be kept in sync if the schema drifts.
 */
const VERIFICATION_PROPERTIES = [
  "email",
  "firstname",
  "lastname",
  "company",
  "jobtitle",
  "lifecyclestage",
  "hs_lead_status",
  "usa_vertical",
  "usa_tier",
  "usa_cadence_state",
] as const;

/**
 * Categories where verification is intentionally skipped. Spam (Z),
 * postmaster bounces (N/O/P), and the unclassified sentinel don't need
 * a HubSpot lookup — they either have no human at the other end or
 * they're going to a dedicated downstream lane (bounce-cleaner /
 * spam-cleaner / human triage).
 */
const SKIPPED_CATEGORIES = new Set([
  "Z_obvious_spam",
  "N_hard_bounce",
  "O_group_restricted",
  "P_soft_bounce",
  "_unclassified",
]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function val(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * Project the HubSpot properties bag into the `HubSpotContactEnrichment`
 * shape. Pure function — deterministic, no I/O.
 */
export function buildContactEnrichment(
  contactId: string,
  properties: Record<string, string | null>,
): HubSpotContactEnrichment {
  const firstname = val(properties.firstname);
  const lastname = val(properties.lastname);
  const fullName = [firstname, lastname].filter(Boolean).join(" ");
  const usaVertical = val(properties.usa_vertical);
  const usaTier = val(properties.usa_tier);
  const usaCadenceState = val(properties.usa_cadence_state);
  return {
    contactId,
    email: val(properties.email).toLowerCase(),
    firstname,
    lastname,
    fullName,
    company: val(properties.company),
    jobtitle: val(properties.jobtitle),
    lifecycleStage: val(properties.lifecyclestage),
    leadStatus: val(properties.hs_lead_status).toUpperCase(),
    usaVertical,
    usaTier,
    usaCadenceState,
    hubspotGateComplete: Boolean(usaVertical && usaTier && usaCadenceState),
  };
}

/**
 * Pure decision function: given a contact enrichment + classified record,
 * compute the verification status. Whale-domain hard-blocks always win,
 * even if the contact otherwise looks complete (because the classifier
 * already elevated the record to `classified_whale`).
 */
export function decideVerificationStatus(
  enrichment: HubSpotContactEnrichment | null,
  whaleDomainMatch: string,
): { status: VerificationStatus; hardBlock: boolean; reason: string } {
  if (whaleDomainMatch) {
    return {
      status: "verification_unqualified", // re-using the hard-block status semantically
      hardBlock: true,
      reason: `Whale-class domain match (${whaleDomainMatch}) — HARD BLOCK on autonomous send per §3.1`,
    };
  }
  if (!enrichment) {
    return {
      status: "verification_missing_contact",
      hardBlock: false, // missing contact is NOT a hard block — drafter can opt in to create
      reason: "No HubSpot contact for this sender — drafter must create or escalate",
    };
  }
  if (enrichment.leadStatus === "UNQUALIFIED") {
    return {
      status: "verification_unqualified",
      hardBlock: true,
      reason: "Contact is marked UNQUALIFIED in HubSpot — send blocked per doctrine §7.8",
    };
  }
  if (!enrichment.hubspotGateComplete) {
    const missing: string[] = [];
    if (!enrichment.usaVertical) missing.push("usa_vertical");
    if (!enrichment.usaTier) missing.push("usa_tier");
    if (!enrichment.usaCadenceState) missing.push("usa_cadence_state");
    return {
      status: "verification_incomplete",
      hardBlock: false,
      reason: `Contact missing required §11.6 fields: ${missing.join(", ")}`,
    };
  }
  return {
    status: "verified",
    hardBlock: false,
    reason: "Contact present, §11.6 fields populated, lead status not UNQUALIFIED",
  };
}

// ---------------------------------------------------------------------------
// Per-record verification
// ---------------------------------------------------------------------------

interface PerRecordDeps {
  findContactByEmail: (email: string) => Promise<string | null>;
  getContactById: (
    contactId: string,
    properties?: readonly string[],
  ) => Promise<{
    id: string;
    properties: Record<string, string | null>;
  } | null>;
  nowEpochMs: number;
}

/**
 * Run verification for a single record. Returns the metadata payload —
 * caller is responsible for persistence.
 *
 * Behaviors:
 *   - If `record.fromEmail` is empty, returns `verification_skipped`.
 *   - If `record.category` is in SKIPPED_CATEGORIES, returns
 *     `verification_skipped` (no HubSpot call made).
 *   - Whale-domain match short-circuits to a hard-block before any
 *     HubSpot call.
 *   - Otherwise: findContactByEmail → getContactById → decide.
 *   - Any HubSpot throw → `verification_degraded` with the error captured
 *     in `notes`. Never re-throws.
 */
export async function verifyRecord(
  record: ClassifiedRecord | (ScannedRecord & { category?: string }),
  deps: PerRecordDeps,
): Promise<VerificationMetadata> {
  const verifiedAt = new Date(deps.nowEpochMs).toISOString();
  const notes: string[] = [];

  const category = (record as ClassifiedRecord).category;
  if (category && SKIPPED_CATEGORIES.has(category)) {
    return {
      status: "verification_skipped",
      reason: `Category ${category} is in SKIPPED_CATEGORIES — no HubSpot lookup`,
      hardBlock: false,
      contact: null,
      whaleDomainMatch: "",
      verifiedAt,
      notes,
    };
  }

  if (!record.fromEmail) {
    return {
      status: "verification_skipped",
      reason: "Record has no fromEmail — cannot verify",
      hardBlock: false,
      contact: null,
      whaleDomainMatch: "",
      verifiedAt,
      notes,
    };
  }

  const whale = matchWhaleDomain(record.fromEmail);
  if (whale) {
    // Whale match short-circuits — even if the contact happens to exist
    // and look complete, the doctrine HARD STOP applies.
    notes.push(`Whale-domain HARD STOP fired before HubSpot lookup`);
    const decision = decideVerificationStatus(null, whale);
    return {
      status: decision.status,
      reason: decision.reason,
      hardBlock: decision.hardBlock,
      contact: null,
      whaleDomainMatch: whale,
      verifiedAt,
      notes,
    };
  }

  // Look up contact by email.
  let contactId: string | null = null;
  try {
    contactId = await deps.findContactByEmail(record.fromEmail);
  } catch (err) {
    notes.push(
      `findContactByEmail failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      status: "verification_degraded",
      reason: "HubSpot contact-lookup failed — falling back to no-contact behavior downstream",
      hardBlock: false,
      contact: null,
      whaleDomainMatch: "",
      verifiedAt,
      notes,
    };
  }

  if (!contactId) {
    const decision = decideVerificationStatus(null, "");
    return {
      status: decision.status,
      reason: decision.reason,
      hardBlock: decision.hardBlock,
      contact: null,
      whaleDomainMatch: "",
      verifiedAt,
      notes,
    };
  }

  // Pull contact properties.
  let contactDetail: {
    id: string;
    properties: Record<string, string | null>;
  } | null = null;
  try {
    contactDetail = await deps.getContactById(
      contactId,
      VERIFICATION_PROPERTIES,
    );
  } catch (err) {
    notes.push(
      `getContactById(${contactId}) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      status: "verification_degraded",
      reason: "HubSpot contact-detail fetch failed — drafter should re-verify before send",
      hardBlock: false,
      contact: null,
      whaleDomainMatch: "",
      verifiedAt,
      notes,
    };
  }

  if (!contactDetail) {
    notes.push(
      `Contact id ${contactId} returned null on getContactById — race condition or deletion`,
    );
    const decision = decideVerificationStatus(null, "");
    return {
      status: decision.status,
      reason: decision.reason,
      hardBlock: decision.hardBlock,
      contact: null,
      whaleDomainMatch: "",
      verifiedAt,
      notes,
    };
  }

  const enrichment = buildContactEnrichment(
    contactDetail.id,
    contactDetail.properties,
  );
  const decision = decideVerificationStatus(enrichment, "");
  return {
    status: decision.status,
    reason: decision.reason,
    hardBlock: decision.hardBlock,
    contact: enrichment,
    whaleDomainMatch: "",
    verifiedAt,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Batch runner
// ---------------------------------------------------------------------------

/**
 * Run verification across a batch of classified records. Persists each
 * verified record back to the inbox:scan key (idempotent — same record
 * re-runs into the same KV slot).
 *
 * Caps HubSpot lookups at `maxLookups` per run to prevent a misconfigured
 * scanner window from blowing the HubSpot rate limit.
 */
export async function runHubSpotVerification(
  opts: RunHubSpotVerificationOpts,
): Promise<VerificationReport> {
  const nowMs = opts.nowEpochMs ?? Date.now();
  const maxLookups = opts.maxLookups ?? 30;

  const store = opts.store ?? {
    get: async <T>(key: string) => (await kv.get<T>(key)) ?? null,
    set: async (key: string, value: unknown) =>
      kv.set(key, value, { ex: RECORD_TTL_SECONDS }),
  };

  const lookups = opts.hubspotLookups ?? {
    findContactByEmail,
    getContactById: (id, props) =>
      getContactById(
        id,
        (props ?? VERIFICATION_PROPERTIES) as readonly string[],
      ),
    isConfigured: isHubSpotConfigured,
  };

  const report: VerificationReport = {
    examined: 0,
    verified: 0,
    hardBlocked: 0,
    missingContact: 0,
    incomplete: 0,
    degraded: 0,
    skipped: 0,
    hubspotLookups: 0,
    degradedNotes: [],
    verifiedRecords: [],
  };

  // Hard-stop: if HubSpot isn't configured at all (env vars missing),
  // skip everything quietly. Don't pretend to verify what we can't read.
  if (!lookups.isConfigured()) {
    report.degradedNotes.push(
      "HubSpot not configured — verification skipped wholesale",
    );
    report.degraded = opts.records.length;
    for (const record of opts.records) {
      const meta: VerificationMetadata = {
        status: "verification_degraded",
        reason: "HubSpot not configured — env vars missing",
        hardBlock: false,
        contact: null,
        whaleDomainMatch: matchWhaleDomain(record.fromEmail) || "",
        verifiedAt: new Date(nowMs).toISOString(),
        notes: [],
      };
      report.examined += 1;
      report.verifiedRecords.push({ ...record, hubspot: meta });
    }
    return report;
  }

  for (const record of opts.records) {
    report.examined += 1;

    // Cap lookups — overage records are reported as degraded so caller can
    // see the cap fired.
    if (report.hubspotLookups >= maxLookups) {
      const meta: VerificationMetadata = {
        status: "verification_degraded",
        reason: `Hit per-run lookup cap (${maxLookups}); skipped to prevent rate-limit blowup`,
        hardBlock: false,
        contact: null,
        whaleDomainMatch: matchWhaleDomain(record.fromEmail) || "",
        verifiedAt: new Date(nowMs).toISOString(),
        notes: [],
      };
      report.degraded += 1;
      const merged: VerifiedRecord = { ...record, hubspot: meta };
      report.verifiedRecords.push(merged);
      continue;
    }

    const meta = await verifyRecord(record, {
      ...lookups,
      nowEpochMs: nowMs,
    });

    // Tally lookups for the cap — only when an actual HubSpot call ran.
    // Skipped + whale-short-circuit don't count.
    if (
      meta.status !== "verification_skipped" &&
      meta.whaleDomainMatch === "" &&
      record.fromEmail &&
      // Whale match path returns hardBlock=true with whaleDomainMatch
      // populated — that path didn't hit HubSpot. Other paths did.
      true
    ) {
      // Whale-match path is already excluded above by whaleDomainMatch !== ""
      report.hubspotLookups += 1;
    }

    // Tally outcomes.
    switch (meta.status) {
      case "verified":
        report.verified += 1;
        break;
      case "verification_unqualified":
        report.hardBlocked += 1;
        break;
      case "verification_missing_contact":
        report.missingContact += 1;
        break;
      case "verification_incomplete":
        report.incomplete += 1;
        break;
      case "verification_degraded":
        report.degraded += 1;
        break;
      case "verification_skipped":
        report.skipped += 1;
        break;
    }

    const merged: VerifiedRecord = { ...record, hubspot: meta };

    if (!opts.dryRun) {
      try {
        await store.set(`${KV_RECORD_PREFIX}${record.messageId}`, merged);
      } catch (err) {
        report.degradedNotes.push(
          `kv-set(${record.messageId}): ${err instanceof Error ? err.message : String(err)}`,
        );
        // Still surface the record in the in-memory report — caller can
        // retry the persist downstream.
      }
    }

    report.verifiedRecords.push(merged);
  }

  return report;
}
