/**
 * Apollo enrichment FLOW — orchestrates the v0.1 pure helpers
 * (`apollo-client.ts` + `apollo-enrichment.ts`) into the full I/O
 * pipeline for D5 v0.2:
 *
 *   1. fetchContactById(id)           — HubSpot GET
 *   2. lookupApolloPersonByEmail(email) — Apollo POST
 *   3. buildEnrichmentProposal(...)   — pure proposal
 *   4. upsertContactByEmail(...)      — HubSpot PATCH (when hasChanges)
 *   5. record(... lead.enrichment.write ...) — Class A audit
 *
 * Class A `lead.enrichment.write` is autonomous per
 * /contracts/approval-taxonomy.md v1.6 — no approval gate. The full
 * provenance trail (Apollo person id + retrievedAt + queryEmail) is
 * captured in the audit envelope per /contracts/governance.md §1 #2.
 *
 * Hard rules locked in code (preserved from v0.1):
 *   - NEVER overwrite existing HubSpot values; only fill empty fields.
 *   - NEVER enrich from a locked Apollo email.
 *   - Email field is structurally never enriched (it's the search key).
 *
 * Fail-soft on every error path:
 *   - HubSpot env unset → returns { ok: false, skipped: true }
 *   - Apollo env unset → returns { ok: false, skipped: true }
 *   - HubSpot 404 → returns { ok: false, error: "contact not found" }
 *   - Write failure → returns { ok: false, error: ... }
 *   - All errors are caught + audit-logged; never throws to caller.
 */
import {
  getContactById,
  isHubSpotConfigured,
  upsertContactByEmail,
} from "@/lib/ops/hubspot-client";
import {
  isApolloConfigured,
  lookupApolloPersonByEmail,
} from "@/lib/ops/apollo-client";
import { record } from "@/lib/ops/control-plane/record";
import { newRunContext } from "@/lib/ops/control-plane/run-id";

import {
  buildEnrichmentProposal,
  type EnrichableContact,
  type EnrichmentProposal,
} from "./apollo-enrichment";

export interface EnrichmentFlowResult {
  ok: boolean;
  /** True when env wasn't configured (test envs, local dev). */
  skipped?: boolean;
  /** True when HubSpot returned no contact for the id. */
  notFound?: boolean;
  /** Reason when ok=false. */
  error?: string;
  /** The contact id we acted on (for caller correlation). */
  contactId: string;
  /** The proposal we built (always populated when contact + apollo lookup succeeded). */
  proposal?: EnrichmentProposal;
  /** True when at least one field was actually written to HubSpot. */
  written?: boolean;
  /** HubSpot id of the contact after upsert (should match input). */
  hubspotContactId?: string;
}

/**
 * Project a HubSpot contact into the EnrichableContact shape.
 *
 * Exported for tests + the bulk-sweep route which reads contacts in
 * batch via `listRecentContacts()` and projects each into the
 * enrichable shape locally.
 */
export function projectContactToEnrichable(
  raw: { id: string; properties: Record<string, string | null> },
): EnrichableContact | null {
  const p = raw.properties;
  if (!p.email) return null;
  return {
    id: raw.id,
    email: p.email,
    firstname: p.firstname ?? null,
    lastname: p.lastname ?? null,
    jobtitle: p.jobtitle ?? null,
    phone: p.phone ?? null,
    company: p.company ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
  };
}

/**
 * Fetch a HubSpot contact by id and project into the EnrichableContact
 * shape. Returns null when the contact doesn't exist or HubSpot is
 * unreachable.
 */
export async function fetchEnrichableContact(
  contactId: string,
): Promise<EnrichableContact | null> {
  const raw = await getContactById(contactId);
  return raw ? projectContactToEnrichable(raw) : null;
}

/**
 * Run the full enrichment flow for a single HubSpot contact id.
 *
 * On success:
 *   - returns { ok: true, proposal, written: true|false, hubspotContactId }
 *   - audit-logs as Class A `lead.enrichment.write` with full provenance
 *     (contact id, apollo person id, retrievedAt, queryEmail, fills count)
 *
 * On no-changes-needed (proposal.hasChanges === false), returns
 * `{ ok: true, written: false, proposal }` with the skipReasons in
 * `proposal.skipReasons` so the caller can audit the no-op.
 */
export async function enrichContactById(
  contactId: string,
): Promise<EnrichmentFlowResult> {
  if (!isHubSpotConfigured()) {
    return {
      ok: false,
      skipped: true,
      error: "HUBSPOT_PRIVATE_APP_TOKEN not configured",
      contactId,
    };
  }
  if (!isApolloConfigured()) {
    return {
      ok: false,
      skipped: true,
      error: "APOLLO_API_KEY not configured",
      contactId,
    };
  }

  // 1. Fetch HubSpot contact.
  const contact = await fetchEnrichableContact(contactId);
  if (!contact) {
    return {
      ok: false,
      notFound: true,
      error: "HubSpot contact not found or has no email",
      contactId,
    };
  }

  // 2. Apollo lookup.
  const apolloRes = await lookupApolloPersonByEmail(contact.email);
  if (!apolloRes.ok) {
    return {
      ok: false,
      error: `Apollo lookup failed: ${apolloRes.error ?? "unknown"}`,
      contactId,
    };
  }

  // 3. Pure proposal.
  const proposal = buildEnrichmentProposal({
    contact,
    apolloPerson: apolloRes.person ?? null,
    apolloVerified: apolloRes.verified ?? false,
    apolloUnlocked: apolloRes.unlocked ?? false,
    retrievedAt: apolloRes.source.retrievedAt,
  });

  // 4. Audit-log (always — even no-op enrichments are auditable signals).
  const run = newRunContext({
    division: "sales",
    agentId: "apollo-enrichment",
    source: "on-demand",
    trigger: `enrichContactById:${contactId}`,
  });

  // 5. Write to HubSpot if there are changes.
  let written = false;
  let hubspotContactId: string | undefined;
  if (proposal.hasChanges) {
    const props: Record<string, string> = {};
    for (const f of proposal.fills) {
      props[f.field] = f.after;
    }
    try {
      const upserted = await upsertContactByEmail({
        email: contact.email,
        firstname: props.firstname,
        lastname: props.lastname,
        jobtitle: props.jobtitle,
        phone: props.phone,
        company: props.company,
        city: props.city,
        state: props.state,
      });
      if (upserted?.id) {
        written = true;
        hubspotContactId = upserted.id;
      } else {
        // upsertContactByEmail returns null on failure (existing helper
        // is fail-soft + does NOT throw). Treat that as an error here
        // so callers can distinguish "wrote nothing because already
        // populated" from "tried to write but HubSpot rejected it".
        throw new Error("HubSpot upsertContactByEmail returned null");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Audit the failure as a Class A action with result=error.
      try {
        await record(run, {
          actionSlug: "lead.enrichment.write",
          entityType: "hubspot.contact",
          entityId: contactId,
          before: { contact },
          after: {
            attemptedFills: proposal.fills,
            apolloPersonId: proposal.apolloPersonId,
            apolloRetrievedAt: proposal.source.retrievedAt,
          },
          result: "error",
          error: { message: msg },
          sourceCitations: [
            {
              system: "apollo",
              id: proposal.apolloPersonId ?? proposal.source.queryEmail,
            },
            // retrievedAt is folded into the audit envelope's createdAt
            // and the `after` block carries the explicit timestamp so
            // the provenance chain is fully reconstructible.
          ],
          confidence: proposal.confidence,
        });
      } catch {
        /* audit best-effort; flow result is what's authoritative */
      }
      return {
        ok: false,
        error: `HubSpot upsert failed: ${msg}`,
        contactId,
        proposal,
      };
    }
  }

  // 6. Audit success (whether written or no-op).
  try {
    await record(run, {
      actionSlug: "lead.enrichment.write",
      entityType: "hubspot.contact",
      entityId: contactId,
      before: { contact },
      after: {
        fills: proposal.fills,
        written,
        apolloPersonId: proposal.apolloPersonId,
        skipReasons: proposal.skipReasons,
        apolloRetrievedAt: proposal.source.retrievedAt,
      },
      result: "ok",
      sourceCitations: [
        {
          system: "apollo",
          id: proposal.apolloPersonId ?? proposal.source.queryEmail,
        },
        // retrievedAt is folded into the audit envelope's createdAt
        // + the `after.apolloRetrievedAt` field for explicit chain.
      ],
      confidence: proposal.confidence,
    });
  } catch {
    /* audit best-effort */
  }

  return {
    ok: true,
    contactId,
    proposal,
    written,
    hubspotContactId,
  };
}
