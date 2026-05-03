/**
 * Buyer-email resolver — single source of truth for "what's this
 * buyer's email + first name?" across the auto-fire-nudges paths.
 *
 * The 3 nudge propose endpoints (reorder-offer, sample-touch-2,
 * onboarding-nudge) all need {email, firstName, displayName}. This
 * module hides the per-source lookup so the orchestrator stays clean.
 *
 * Sources:
 *   • HubSpot deal (sample-touch-2 + wholesale reorder)
 *       → getDealWithContact(dealId) → contact.email / firstname
 *   • Shopify customer numeric id (DTC reorder)
 *       → listShopifyCustomersWithLastOrder() returns the lookup table;
 *         caller resolves once per run and re-uses
 *   • Wholesale onboarding flow (onboarding-nudge)
 *       → loadOnboardingState(flowId).prospect.contactEmail / .contactName
 *
 * Hard rules:
 *   • Returns null when email is missing or invalid (never invents).
 *   • Never logs PII; the caller decides what to surface.
 *   • Fail-soft on every external call — orchestrator continues to
 *     the next candidate if one resolver returns null.
 */
import { getDealWithContact } from "@/lib/ops/hubspot-client";
import {
  listShopifyCustomersWithLastOrder,
  numericIdFromGid,
  type ShopifyCustomerWithLastOrder,
} from "@/lib/shopify/customers-with-last-order";
import { loadOnboardingState } from "@/lib/wholesale/onboarding-store";

export interface ResolvedBuyer {
  email: string;
  firstName?: string;
  displayName: string;
}

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function firstNameFromContactName(name?: string | null): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const first = trimmed.split(/\s+/)[0];
  return first.length > 0 ? first : undefined;
}

/**
 * Resolve the buyer for a HubSpot deal candidate.
 * Used by sample-touch-2 + wholesale reorder paths.
 * Returns null when deal/contact is missing or email isn't valid.
 */
export async function resolveHubSpotDealBuyer(
  dealId: string,
): Promise<ResolvedBuyer | null> {
  const deal = await getDealWithContact(dealId);
  if (!deal || !deal.contact) return null;
  const email = deal.contact.email?.trim();
  if (!email || !EMAIL_REGEX.test(email)) return null;

  const company = deal.contact.company?.trim();
  const dealname = deal.dealname?.trim();
  // Display preference: deal name (already includes "USA Gummies — X")
  // → company → email-localpart fallback.
  const displayName =
    dealname && dealname.length > 0
      ? dealname
      : company && company.length > 0
        ? company
        : email.split("@")[0];

  return {
    email,
    firstName: deal.contact.firstname?.trim() || undefined,
    displayName,
  };
}

/**
 * Bulk-load Shopify customers for the run. The orchestrator calls this
 * once and reuses the returned lookup table for every Shopify candidate
 * — avoiding N round-trips to the Shopify Admin GraphQL API.
 */
export async function loadShopifyCustomerLookup(): Promise<
  Map<string, ShopifyCustomerWithLastOrder>
> {
  const customers = await listShopifyCustomersWithLastOrder({ limit: 500 });
  const out = new Map<string, ShopifyCustomerWithLastOrder>();
  for (const c of customers) {
    if (c.email) out.set(c.id, c);
    out.set(c.numericId, c);
  }
  return out;
}

/**
 * Resolve a Shopify customer using the pre-loaded lookup table from
 * `loadShopifyCustomerLookup()`. Accepts either the gid form
 * (`gid://shopify/Customer/123`) or the numeric id.
 */
export function resolveShopifyCustomerBuyer(
  customerKey: string,
  lookup: Map<string, ShopifyCustomerWithLastOrder>,
): ResolvedBuyer | null {
  const numericId = numericIdFromGid(customerKey);
  const cust = lookup.get(customerKey) ?? lookup.get(numericId);
  if (!cust) return null;
  const email = cust.email?.trim();
  if (!email || !EMAIL_REGEX.test(email)) return null;
  const firstName = cust.firstName?.trim() || undefined;
  const lastName = cust.lastName?.trim() || undefined;
  const displayName =
    firstName && lastName
      ? `${firstName} ${lastName}`
      : firstName || email.split("@")[0];
  return {
    email,
    firstName,
    displayName,
  };
}

/**
 * Resolve the buyer for a wholesale-onboarding flow candidate.
 * Reads prospect.contactEmail + prospect.contactName from the KV-stored
 * onboarding state. Returns null when the flow is missing or the
 * prospect block hasn't been populated yet (the buyer can't have stalled
 * past the `info` step without an email — but be defensive).
 */
export async function resolveOnboardingFlowBuyer(
  flowId: string,
): Promise<ResolvedBuyer | null> {
  const state = await loadOnboardingState(flowId);
  if (!state) return null;
  const prospect = state.prospect;
  if (!prospect) return null;
  const email = prospect.contactEmail?.trim();
  if (!email || !EMAIL_REGEX.test(email)) return null;
  const firstName = firstNameFromContactName(prospect.contactName);
  const displayName =
    prospect.companyName?.trim() ||
    prospect.contactName?.trim() ||
    email.split("@")[0];
  return {
    email,
    firstName,
    displayName,
  };
}
