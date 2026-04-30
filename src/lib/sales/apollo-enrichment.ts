/**
 * Apollo enrichment with provenance — Phase D5 of the B2B Revenue Loop.
 *
 * Doctrine: `/contracts/session-handoff.md` "Active build directive"
 * Phase D — D5 = "Apollo enrichment with provenance".
 * Approval class: `lead.enrichment.write` (Class A, autonomous) per
 * `/contracts/approval-taxonomy.md` v1.6.
 *
 * Pure-functions module. No I/O. The Apollo lookup happens via
 * `src/lib/ops/apollo-client.ts`; the HubSpot write happens via
 * `upsertContactByEmail()`. This module:
 *   1. Compares the existing HubSpot contact fields vs the Apollo
 *      person record.
 *   2. Builds an `EnrichmentProposal` that lists exactly which fields
 *      will be filled (and the source citation per /contracts/governance.md §1 #2).
 *   3. Surfaces the diff so the caller can audit + persist.
 *
 * **Doctrinal rule:** D5 only FILLS empty/missing fields. It NEVER
 * overwrites an existing HubSpot value with an Apollo value, even
 * when Apollo's looks "better." HubSpot is a system of record;
 * Apollo is a discovery source. Overwrites would be a Class B
 * `pricing.change`-equivalent decision and live outside D5's scope.
 */
import type { ApolloPerson } from "@/lib/ops/apollo-client";
import { pickPhoneFromApolloPerson } from "@/lib/ops/apollo-client";

/** Subset of HubSpot contact properties D5 can enrich. */
export interface EnrichableContact {
  /** HubSpot contact id (audit primary key). */
  id: string;
  email: string;
  firstname?: string | null;
  lastname?: string | null;
  jobtitle?: string | null;
  phone?: string | null;
  company?: string | null;
  city?: string | null;
  state?: string | null;
}

/** Per-field enrichment record. */
export interface FieldFill {
  field: keyof EnrichableContact;
  before: string | null;
  after: string;
  /** Why we chose this value (for audit). */
  reason: string;
}

/** Full proposal: which fields to fill + source. */
export interface EnrichmentProposal {
  /** True when at least one field will be filled. */
  hasChanges: boolean;
  /** HubSpot contact id. */
  contactId: string;
  /** Proposed fills (only fields where before=empty AND after=non-empty). */
  fills: FieldFill[];
  /** Apollo person id (when available — primary cross-reference for audit). */
  apolloPersonId: string | null;
  /** Source citation per /contracts/governance.md §1 #2. */
  source: { system: "apollo"; personId: string | null; retrievedAt: string; queryEmail: string };
  /** Reasons we chose NOT to enrich anything (when hasChanges=false). */
  skipReasons: string[];
  /** Confidence ∈ [0,1] — how confident the Apollo match is. */
  confidence: number;
}

/** Truthy-but-empty check for HubSpot string fields. */
function isEmpty(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === "";
}

/**
 * Compute the per-field fills from a HubSpot contact + Apollo person.
 *
 * Rules:
 *   • firstname  ← apollo.first_name    (only if HubSpot is empty)
 *   • lastname   ← apollo.last_name     (only if HubSpot is empty)
 *   • jobtitle   ← apollo.title         (only if HubSpot is empty)
 *   • phone      ← pickPhoneFromApolloPerson() (only if HubSpot is empty)
 *   • company    ← apollo.organization.name (only if HubSpot is empty)
 *   • city       ← apollo.city          (only if HubSpot is empty)
 *   • state      ← apollo.state         (only if HubSpot is empty)
 *
 * Skipped categories:
 *   - Email is never overwritten (it's the search key + the only stable id).
 *   - Existing HubSpot values are never overwritten.
 *   - Apollo fields that are themselves empty are not used as fills.
 */
export function buildEnrichmentFills(
  contact: EnrichableContact,
  person: ApolloPerson,
): FieldFill[] {
  const fills: FieldFill[] = [];

  if (isEmpty(contact.firstname) && person.first_name?.trim()) {
    fills.push({
      field: "firstname",
      before: contact.firstname ?? null,
      after: person.first_name.trim(),
      reason: "apollo.first_name",
    });
  }
  if (isEmpty(contact.lastname) && person.last_name?.trim()) {
    fills.push({
      field: "lastname",
      before: contact.lastname ?? null,
      after: person.last_name.trim(),
      reason: "apollo.last_name",
    });
  }
  if (isEmpty(contact.jobtitle) && person.title?.trim()) {
    fills.push({
      field: "jobtitle",
      before: contact.jobtitle ?? null,
      after: person.title.trim(),
      reason: "apollo.title",
    });
  }
  if (isEmpty(contact.phone)) {
    const phone = pickPhoneFromApolloPerson(person);
    if (phone) {
      fills.push({
        field: "phone",
        before: contact.phone ?? null,
        after: phone,
        reason: "apollo.mobile_phone_number || phone_numbers[0] || organization.primary_phone",
      });
    }
  }
  if (isEmpty(contact.company) && person.organization?.name?.trim()) {
    fills.push({
      field: "company",
      before: contact.company ?? null,
      after: person.organization.name.trim(),
      reason: "apollo.organization.name",
    });
  }
  if (isEmpty(contact.city) && person.city?.trim()) {
    fills.push({
      field: "city",
      before: contact.city ?? null,
      after: person.city.trim(),
      reason: "apollo.city",
    });
  }
  if (isEmpty(contact.state) && person.state?.trim()) {
    fills.push({
      field: "state",
      before: contact.state ?? null,
      after: person.state.trim(),
      reason: "apollo.state",
    });
  }

  return fills;
}

/** Heuristic confidence score for an Apollo match. */
export function computeApolloMatchConfidence(args: {
  verified: boolean;
  unlocked: boolean;
  hasOrg: boolean;
  hasTitle: boolean;
}): number {
  let conf = 0.5;
  if (args.verified) conf += 0.2;
  if (args.unlocked) conf += 0.1;
  if (args.hasOrg) conf += 0.1;
  if (args.hasTitle) conf += 0.1;
  return Math.min(1, Math.max(0, conf));
}

/**
 * Build the complete enrichment proposal for a contact + Apollo
 * lookup result.
 *
 * `hasChanges = false` when:
 *   - Apollo returned no person match (skipReasons = ["no apollo match"])
 *   - Apollo person is empty for every field we'd fill
 *   - Every HubSpot field is already populated (skipReasons = ["all fields already populated"])
 *   - Apollo's email is locked (we don't enrich from a locked record per
 *     governance §7 — surface for human action)
 */
export function buildEnrichmentProposal(args: {
  contact: EnrichableContact;
  apolloPerson: ApolloPerson | null;
  apolloVerified: boolean;
  apolloUnlocked: boolean;
  retrievedAt: string;
}): EnrichmentProposal {
  const { contact, apolloPerson, apolloVerified, apolloUnlocked, retrievedAt } = args;
  const skipReasons: string[] = [];
  const source = {
    system: "apollo" as const,
    personId: apolloPerson?.id ?? null,
    retrievedAt,
    queryEmail: contact.email.toLowerCase(),
  };

  if (!apolloPerson) {
    skipReasons.push("no apollo match");
    return {
      hasChanges: false,
      contactId: contact.id,
      fills: [],
      apolloPersonId: null,
      source,
      skipReasons,
      confidence: 0,
    };
  }
  if (!apolloUnlocked) {
    skipReasons.push("apollo email is locked — refusing to enrich from a locked record");
    return {
      hasChanges: false,
      contactId: contact.id,
      fills: [],
      apolloPersonId: apolloPerson.id ?? null,
      source,
      skipReasons,
      confidence: 0,
    };
  }

  const fills = buildEnrichmentFills(contact, apolloPerson);
  const confidence = computeApolloMatchConfidence({
    verified: apolloVerified,
    unlocked: apolloUnlocked,
    hasOrg: Boolean(apolloPerson.organization?.name),
    hasTitle: Boolean(apolloPerson.title),
  });

  if (fills.length === 0) {
    skipReasons.push("all enrichable fields already populated, or apollo person had nothing new");
  }

  return {
    hasChanges: fills.length > 0,
    contactId: contact.id,
    fills,
    apolloPersonId: apolloPerson.id ?? null,
    source,
    skipReasons,
    confidence,
  };
}

/**
 * Project an EnrichmentProposal into the partial ContactInput payload
 * the HubSpot write helper expects.
 */
export function fillsToContactInput(
  proposal: EnrichmentProposal,
  email: string,
): {
  email: string;
  firstname?: string;
  lastname?: string;
  jobtitle?: string;
  phone?: string;
  company?: string;
  city?: string;
  state?: string;
} {
  const out: Record<string, string> = { email };
  for (const f of proposal.fills) {
    out[f.field] = f.after;
  }
  return out as {
    email: string;
    firstname?: string;
    lastname?: string;
    jobtitle?: string;
    phone?: string;
    company?: string;
    city?: string;
    state?: string;
  };
}
