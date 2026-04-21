/**
 * HubSpot deal → OrderIntent normalizer for S-08.
 *
 * Consumed by the HubSpot `deal.propertyChange` webhook adapter. Pure
 * function — takes a `DealWithContact` (fetched from hubspot-client),
 * returns an OrderIntent the dispatch classifier can eat.
 *
 * Scope:
 *   - Only processes deals in STAGE_CLOSED_WON or STAGE_PO_RECEIVED.
 *     Other stages are skipped (returned as `{ ok: false, skipped }`).
 *   - Payment-received gate: if `wholesale_payment_received` is not
 *     "true" AND payment_method is "pay_now" (vs "invoice_me"), we
 *     skip the dispatch proposal — Ben doesn't ship pay-now before
 *     payment lands.
 *   - AR-hold gate passes through to the classifier via
 *     `hubspot.arHold` (not a HubSpot property yet; wired so we can
 *     flip when the custom property lands).
 *   - Packaging defaults to `master_carton` because wholesale orders
 *     are always cartons (vs Shopify DTC samples which default to case).
 */

import type { DealWithContact } from "./hubspot-client";
import type { OrderIntent } from "./sample-order-dispatch";
import { HUBSPOT } from "./hubspot-client";

export interface HubSpotNormalizeResult {
  ok: true;
  intent: OrderIntent;
  skipped?: never;
}
export interface HubSpotNormalizeSkip {
  ok: false;
  skipped: true;
  reason: string;
}
export interface HubSpotNormalizeError {
  ok: false;
  skipped?: false;
  error: string;
}

export function normalizeHubSpotDeal(
  deal: DealWithContact,
): HubSpotNormalizeResult | HubSpotNormalizeSkip | HubSpotNormalizeError {
  // Stage gate — only process PO Received / Closed Won.
  const stage = deal.dealstage;
  if (
    stage !== HUBSPOT.STAGE_PO_RECEIVED &&
    stage !== HUBSPOT.STAGE_CLOSED_WON
  ) {
    return {
      ok: false,
      skipped: true,
      reason: `dealstage=${stage ?? "(null)"} — not a ship-trigger stage`,
    };
  }

  // Payment gate — pay-now deals ship only after payment lands.
  const paymentMethod = (deal.wholesale_payment_method ?? "").toLowerCase();
  const paymentReceived =
    (deal.wholesale_payment_received ?? "").toLowerCase() === "true";
  if (paymentMethod === "pay_now" && !paymentReceived) {
    return {
      ok: false,
      skipped: true,
      reason: "pay-now deal without payment_received=true — hold until paid",
    };
  }

  // Contact + address required for ship-to.
  const c = deal.contact;
  if (!c) {
    return {
      ok: false,
      error: `deal ${deal.dealId} has no associated contact — cannot resolve ship-to`,
    };
  }
  const missing: string[] = [];
  if (!c.address) missing.push("address");
  if (!c.city) missing.push("city");
  if (!c.state) missing.push("state");
  if (!c.zip) missing.push("zip");
  if (missing.length > 0) {
    return {
      ok: false,
      error: `contact ${deal.contactId} missing ${missing.join(", ")} — cannot build ship-to`,
    };
  }

  const shipToName =
    [c.firstname, c.lastname].filter(Boolean).join(" ").trim() ||
    deal.dealname ||
    "Wholesale customer";

  // Scan free-form fields for the canonical sample markers the
  // classifier recognizes. The deal description + name are the most
  // common places Ben types "sample" when composing a booth follow-up.
  const tagText = [deal.dealname, deal.description]
    .filter((x): x is string => Boolean(x))
    .join(" ");
  const tags: string[] = [];
  if (/\bsample\b/i.test(tagText)) tags.push("sample");

  const intent: OrderIntent = {
    channel: "hubspot",
    sourceId: deal.dealId,
    orderNumber: deal.dealname || deal.dealId,
    valueUsd: deal.amount ?? undefined,
    tags,
    note: deal.description ?? undefined,
    shipTo: {
      name: shipToName,
      company: c.company ?? undefined,
      street1: c.address!,
      street2: c.address2 ?? undefined,
      city: c.city!,
      state: c.state!.toUpperCase(),
      postalCode: c.zip!,
      country: c.country ?? "US",
      phone: c.phone ?? undefined,
      residential: false, // wholesale = commercial ship-to
    },
    packagingType: "master_carton",
    // Cartons can't be inferred from the deal. Classifier defaults to 1
    // and Ben overrides in the approval if needed.
    cartons: 1,
    hubspot: {
      dealId: deal.dealId,
      arHold: false, // no custom property wired yet
    },
  };

  return { ok: true, intent };
}
