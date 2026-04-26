/**
 * Phase 27 — pure formatter helpers for the auto-ship → #shipping
 * Slack post. Locks the v1.0 SHIPPING PROTOCOL Ben pinned in
 * `#shipping` on 2026-04-10 as the single canonical layout.
 *
 * Why pure / server-safe (no React, no I/O):
 *   - Lockstep formatting between the live route + the Phase 28
 *     backfill route (identical output for the same shipment).
 *   - Trivial unit tests; no Slack mock required.
 *
 * The protocol Ben locked:
 *
 *   SHIPMENT: [Order ID]
 *   To: [Recipient Name] — [Company]
 *   Address: [Full address]
 *   From: [PA or WA Warehouse]
 *   Carrier: [USPS Priority / UPS Ground / etc.]
 *   Tracking: [number]
 *   Cost: $[amount]
 *   Tag: [Sample / Wholesale / FBA / Internal]
 *   Label: [attached PDF]
 *
 * Hard rules locked by tests:
 *   - NEVER fabricates a recipient name / address / tracking / cost.
 *     Missing fields render as the literal string `(unknown)` so the
 *     gap is operator-visible, NOT a silent empty cell.
 *   - Tag derivation is deterministic from `source` + `bags`.
 *   - From-warehouse is a fixed string per known origin; defaults to
 *     "WA Warehouse (Ashford)" since orders ship from Ben.
 */

export type AutoShipTag = "Sample" | "Wholesale" | "FBA" | "Internal";

export interface AutoShipShipmentInput {
  /** Channel order id — e.g. "114-3537957-6941066", "1016". */
  orderNumber: string;
  /** "amazon" / "shopify" / "faire" / "manual" / etc. — see `sourceLabelFor`. */
  source: string;
  /** Total bags in the shipment (used for tag derivation). */
  bags: number;
  /** Recipient + address (any field may be null when ShipStation
   *  hasn't synced yet). */
  shipTo: {
    name: string | null;
    company: string | null;
    street1: string | null;
    street2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
  /** Carrier-side facts from `createLabelForShipStationOrder`. */
  carrier: {
    /** Display name like "USPS First Class", "UPS Ground". */
    service: string;
    trackingNumber: string | null;
    /** Cost in USD, post-discount. */
    costUsd: number;
  };
  /** Optional Drive backup links. Rendered as a separate line. */
  driveLinks?: {
    label?: string | null;
    packingSlip?: string | null;
  };
}

/**
 * Derive the Tag value per Ben's locked enum (Sample / Wholesale /
 * FBA / Internal). Pure mapping based on source + bag count.
 *
 *   - amazon              → FBA   (colloquially what Ben calls Amazon FBM)
 *   - shopify, bags ≥ 36  → Wholesale  (master carton volume)
 *   - shopify, bags ≥ 6   → Wholesale  (case-quantity)
 *   - shopify, bags ≤ 5   → Sample     (mailer-sized small DTC)
 *   - faire               → Wholesale  (always retailer)
 *   - everything else     → Internal
 */
export function deriveAutoShipTag(args: {
  source: string;
  bags: number;
}): AutoShipTag {
  const src = args.source.toLowerCase();
  if (src === "amazon" || src.includes("amazon")) return "FBA";
  if (src === "faire" || src.includes("faire")) return "Wholesale";
  if (src === "shopify" || src.includes("shopify")) {
    if (args.bags >= 6) return "Wholesale";
    return "Sample";
  }
  return "Internal";
}

/**
 * Format the ship-to address as `street1, street2, city, state ZIP`.
 * Empty / null fields are skipped (no double commas) but missing
 * required fields render as `(unknown)` to surface the gap.
 */
export function formatShipToAddress(
  shipTo: AutoShipShipmentInput["shipTo"],
): string {
  const parts: string[] = [];
  if (shipTo.street1?.trim()) parts.push(shipTo.street1.trim());
  if (shipTo.street2?.trim()) parts.push(shipTo.street2.trim());
  const city = shipTo.city?.trim() || "(unknown city)";
  const state = shipTo.state?.trim() || "??";
  const zip = shipTo.postalCode?.trim() || "(no zip)";
  parts.push(`${city}, ${state} ${zip}`);
  return parts.join(", ");
}

/**
 * Format the recipient line: `<Name> — <Company>` when company is
 * present, otherwise just `<Name>`. Missing name → "(unknown)".
 */
export function formatRecipient(
  shipTo: AutoShipShipmentInput["shipTo"],
): string {
  const name = shipTo.name?.trim() || "(unknown)";
  const company = shipTo.company?.trim();
  return company ? `${name} — ${company}` : name;
}

/**
 * Format the ship-from-warehouse line. Today every auto-shipped
 * order goes from Ben's Ashford warehouse per CLAUDE.md
 * "Fulfillment Rules" — orders → Ben, samples → Drew. Hardcoded
 * to "WA Warehouse (Ashford)" until a per-order origin signal
 * exists.
 */
export function formatShipFrom(): string {
  return "WA Warehouse (Ashford)";
}

/**
 * Format the full v1.0 SHIPMENT comment for a Slack label post.
 * This is the EXACT layout Ben pinned in #shipping 2026-04-10.
 */
export function formatShipmentComment(
  input: AutoShipShipmentInput,
): string {
  const tag = deriveAutoShipTag({ source: input.source, bags: input.bags });
  const recipient = formatRecipient(input.shipTo);
  const address = formatShipToAddress(input.shipTo);
  const from = formatShipFrom();
  const tracking = input.carrier.trackingNumber?.trim() || "(no tracking)";
  const costStr = Number.isFinite(input.carrier.costUsd)
    ? `$${input.carrier.costUsd.toFixed(2)}`
    : "(unknown)";

  const lines: string[] = [
    `SHIPMENT: ${input.orderNumber}`,
    `To: ${recipient}`,
    `Address: ${address}`,
    `From: ${from}`,
    `Carrier: ${input.carrier.service}`,
    `Tracking: ${tracking}`,
    `Cost: ${costStr}`,
    `Tag: ${tag}`,
    `Label: (attached PDF)`,
  ];

  // Drive backup links go AFTER the locked v1.0 block, separated by
  // a blank line so the locked layout reads cleanly even when Drive
  // links are absent.
  const driveLines: string[] = [];
  if (input.driveLinks?.label) {
    driveLines.push(`<${input.driveLinks.label}|Drive: label PDF>`);
  }
  if (input.driveLinks?.packingSlip) {
    driveLines.push(`<${input.driveLinks.packingSlip}|Drive: packing slip>`);
  }
  if (driveLines.length > 0) {
    lines.push("", driveLines.join(" · "));
  }

  return lines.join("\n");
}

/**
 * Format the threaded packing-slip follow-up comment. Short — the
 * channel scroll already shows the full SHIPMENT block in the parent
 * post. The packing slip lives as a thread reply so operators can
 * print it separately.
 */
export function formatPackingSlipComment(orderNumber: string): string {
  return `Packing slip — ${orderNumber}`;
}
