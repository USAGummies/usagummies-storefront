/**
 * Phase 3.1 — HubSpot mirror helpers for Faire Direct invites.
 *
 * Why this file exists
 * --------------------
 * The send closer logs every Faire Direct invite to HubSpot via
 * `logEmail`. That call associates the email engagement to a HubSpot
 * contact when (and only when) `record.hubspotContactId` is set. In
 * practice, most invite candidates arrive at ingest time WITHOUT an
 * operator-pasted contact id — so the existing email engagement lands
 * on HubSpot's global activity feed but is not visible on the
 * retailer's contact record.
 *
 * This module mirrors the safe pattern already used by
 * `src/lib/ops/email-intelligence/approval-executor.ts`:
 *
 *   1. Prefer the operator-curated `hubspotContactId` when present.
 *   2. Otherwise look up the contact by email (read-only search).
 *   3. Otherwise return null and let the caller log an unassociated
 *      engagement — same behavior as today, just without losing the
 *      association when one exists.
 *
 * Hard rules locked by tests:
 *   - **Never creates a HubSpot contact.** Booth-order auto-creates;
 *     this module only ever READs. Auto-creating from the Faire
 *     workflow would inflate the CRM with cold leads.
 *   - **Never touches `lifecyclestage`, deals, properties, or tasks.**
 *     The only existing writer this module hands off to is `logEmail`
 *     (timeline email engagement). Lifecycle stage moves and custom
 *     property writes are intentionally out of scope until a follow-up
 *     change adds them with their own approval gate.
 *   - **Fail-soft.** A HubSpot 401 / 5xx / network timeout returns
 *     null. The Gmail send has already succeeded by the time this
 *     runs, so a HubSpot outage must not block the success path.
 *   - **No fetch / network call when `HUBSPOT_PRIVATE_APP_TOKEN` is
 *     unset.** The underlying client returns `{ ok: false }` and we
 *     translate that to null without hitting the network. This keeps
 *     the test suite fully offline.
 */
import {
  findContactByEmail,
  isHubSpotConfigured,
} from "@/lib/ops/hubspot-client";
import type { FaireInviteRecord } from "./invites";

export interface ResolveContactInput {
  /** The operator-pasted id from the invite record (if any). */
  hubspotContactId?: string;
  /** The validated retailer email — used for the fallback lookup. */
  email: string;
}

/**
 * Resolve the HubSpot contact id for a Faire invite, with a read-only
 * email lookup fallback. Pure with respect to writes — never creates
 * or mutates a HubSpot record.
 *
 * Returns:
 *   - The trimmed `hubspotContactId` when present and non-empty.
 *   - The contact id from `findContactByEmail` when the lookup hits.
 *   - `null` otherwise (no match, or HubSpot unconfigured, or outage).
 *
 * Test seam: pass `findImpl` to substitute a mocked search. Production
 * uses the real `findContactByEmail` from the HubSpot client.
 */
export async function resolveHubSpotContactIdForInvite(
  input: ResolveContactInput,
  options: { findImpl?: typeof findContactByEmail } = {},
): Promise<string | null> {
  const pasted = (input.hubspotContactId ?? "").trim();
  if (pasted.length > 0) return pasted;

  // Skip the network call entirely when HubSpot isn't configured. This
  // keeps the closer test-suite offline and removes a wasted round-trip
  // in dev environments where the token isn't set.
  if (!isHubSpotConfigured()) return null;

  const email = (input.email ?? "").trim();
  if (!email) return null;

  const findImpl = options.findImpl ?? findContactByEmail;
  try {
    const id = await findImpl(email);
    return id ?? null;
  } catch {
    // Fail-soft: any thrown error in the search path becomes "no
    // association." We never want a HubSpot lookup failure to abort
    // the Gmail send mirror.
    return null;
  }
}

/**
 * Convenience overload for callers that already have a `FaireInviteRecord`.
 */
export function resolveHubSpotContactIdForInviteRecord(
  record: Pick<FaireInviteRecord, "hubspotContactId" | "email">,
  options: { findImpl?: typeof findContactByEmail } = {},
): Promise<string | null> {
  return resolveHubSpotContactIdForInvite(
    {
      hubspotContactId: record.hubspotContactId,
      email: record.email,
    },
    options,
  );
}
