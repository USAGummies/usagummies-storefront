/**
 * Dispatch board projection — pure helper backing /ops/shipping/dispatch.
 *
 * Joins ShipStation recent-shipments (label-buy state) with shipping
 * artifact records (`dispatchedAt`, `slackPermalink`) to produce a
 * single typed row per shipment. The dashboard surfaces these rows
 * with an "open" / "dispatched" pill so Ben can see at a glance which
 * packages have left the warehouse vs. which are still sitting on
 * the cart.
 *
 * Why a pure helper (not a route): tests can lock the projection
 * contract without spinning up Next.js handlers. The route + client
 * become thin readers around `buildDispatchBoardRows` + counts.
 *
 * Hard rules:
 *   - NEVER fabricates a `dispatchedAt`. A row whose artifact has no
 *     stamp surfaces as `state: "open"`.
 *   - Voided labels are excluded by default (they're not dispatchable).
 *   - Sort: open rows first (most actionable), each group by
 *     `shipDate DESC`. Within same shipDate, tracking number ASC for
 *     stability.
 *   - Counts are computed on the FILTERED set (after voided-exclusion),
 *     so the strip the dashboard shows always sums to `rows.length`.
 */
import type { ShipStationShipment } from "@/lib/ops/shipstation-client";
import type { ShippingArtifactRecord } from "@/lib/ops/shipping-artifacts";

/** Single row on the dispatch board. */
export interface DispatchBoardRow {
  /** Marketplace order number. May be null when ShipStation didn't sync one. */
  orderNumber: string | null;
  /** Source channel ("amazon", "shopify", "manual", "faire"). null when unknown. */
  source: string | null;
  /** Ship-to name surface (e.g. "Donald D'Amadio"). null when missing. */
  recipient: string | null;
  /** Postal code — used as the address surface on the row. */
  shipToPostalCode: string | null;
  /** Carrier service label (e.g. "ups_ground_saver"). */
  carrierService: string | null;
  /** Tracking number — null if ShipStation hadn't issued one yet. */
  trackingNumber: string | null;
  /** USD cost of the label. null when ShipStation reported no cost. */
  shipmentCost: number | null;
  /** ISO date of the ship date (YYYY-MM-DD). */
  shipDate: string | null;
  /** Slack permalink to the label post in `#shipping`. null if upload failed. */
  slackPermalink: string | null;
  /** Dispatch state: "open" (not yet marked) | "dispatched" (✅ reaction or POST hit). */
  state: "open" | "dispatched";
  /** ISO timestamp the package physically left the warehouse. null when open. */
  dispatchedAt: string | null;
  /** Slack user id who marked it. null when open. */
  dispatchedBy: string | null;
}

export interface DispatchBoardCounts {
  /** Total rows after voided-exclusion. */
  total: number;
  /** Rows with state="open" — packages still sitting on the cart. */
  open: number;
  /** Rows with state="dispatched" — physically left the warehouse. */
  dispatched: number;
}

export interface DispatchBoardView {
  rows: DispatchBoardRow[];
  counts: DispatchBoardCounts;
}

/**
 * Heuristic source-of-tracking-number → channel mapping.
 *
 * ShipStation's `getRecentShipments` doesn't carry `source` — the
 * channel info is on the parent ORDER, not the shipment. We can't
 * cheaply look up every order, so we infer source from the order
 * number shape:
 *   - "XXX-XXXXXXX-XXXXXXX" → Amazon (FBM/MFN)
 *   - "#?\d+" → Shopify
 *   - anything else → null (caller's artifact lookup might still
 *     resolve it via `bulkLookupArtifacts`)
 *
 * This is a fallback ONLY for rows where the artifact lookup didn't
 * already resolve the source.
 */
export function inferSourceFromOrderNumber(
  orderNumber: string | null | undefined,
): string | null {
  if (!orderNumber) return null;
  const trimmed = orderNumber.trim();
  if (!trimmed) return null;
  if (/^\d{3}-\d{7}-\d{7}$/.test(trimmed)) return "amazon";
  if (/^#?\d+$/.test(trimmed)) return "shopify";
  return null;
}

export interface BuildDispatchBoardOptions {
  /** Skip voided shipments. Default true — they're not dispatchable. */
  excludeVoided?: boolean;
}

/**
 * Project ShipStation shipments + artifact lookup into typed rows.
 *
 * `artifactsByKey` is keyed by `${source}:${orderNumber}` for explicit
 * lookups, AND by bare `orderNumber` for the fallback path when source
 * isn't known up-front. Callers should populate both — the pure helper
 * accepts whichever it finds.
 */
export function buildDispatchBoardRows(
  shipments: readonly ShipStationShipment[],
  artifactsByKey: ReadonlyMap<string, ShippingArtifactRecord>,
  opts: BuildDispatchBoardOptions = {},
): DispatchBoardView {
  const excludeVoided = opts.excludeVoided ?? true;

  const filtered = excludeVoided
    ? shipments.filter((s) => !s.voided)
    : [...shipments];

  const rows: DispatchBoardRow[] = filtered.map((s) => {
    // Artifact lookup chain: try each plausible key.
    const orderNumber = s.orderNumber ?? null;
    const inferredSource = inferSourceFromOrderNumber(orderNumber);
    const lookupKeys: string[] = [];
    if (orderNumber && inferredSource) {
      lookupKeys.push(`${inferredSource}:${orderNumber}`);
    }
    if (orderNumber) {
      // Try other known sources too — order numbers don't collide
      // across channels in practice.
      for (const src of ["amazon", "shopify", "manual", "faire"]) {
        if (src === inferredSource) continue;
        lookupKeys.push(`${src}:${orderNumber}`);
      }
      lookupKeys.push(orderNumber); // bare-number fallback
    }
    let artifact: ShippingArtifactRecord | null = null;
    for (const key of lookupKeys) {
      const found = artifactsByKey.get(key);
      if (found) {
        artifact = found;
        break;
      }
    }
    const dispatchedAt = artifact?.dispatchedAt ?? null;
    const dispatchedBy = artifact?.dispatchedBy ?? null;
    return {
      orderNumber,
      source: artifact?.source ?? inferredSource,
      recipient: s.shipToName,
      shipToPostalCode: s.shipToPostalCode,
      carrierService: s.serviceCode,
      trackingNumber: s.trackingNumber,
      shipmentCost: s.shipmentCost,
      shipDate: s.shipDate,
      slackPermalink: artifact?.slackPermalink ?? null,
      state: dispatchedAt ? ("dispatched" as const) : ("open" as const),
      dispatchedAt,
      dispatchedBy,
    };
  });

  rows.sort(compareRows);

  const counts: DispatchBoardCounts = {
    total: rows.length,
    open: rows.filter((r) => r.state === "open").length,
    dispatched: rows.filter((r) => r.state === "dispatched").length,
  };

  return { rows, counts };
}

/**
 * Sort: open rows first (most actionable), then dispatched.
 * Within each group: shipDate DESC (most recent first).
 * Within same shipDate: trackingNumber ASC (stable).
 *
 * Defensive on null shipDate / null tracking — they sort to the end
 * of their group rather than throwing.
 */
function compareRows(a: DispatchBoardRow, b: DispatchBoardRow): number {
  // open before dispatched
  if (a.state !== b.state) return a.state === "open" ? -1 : 1;
  // shipDate DESC
  const ad = a.shipDate ?? "";
  const bd = b.shipDate ?? "";
  if (ad !== bd) {
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? 1 : -1;
  }
  // tracking ASC
  const at = a.trackingNumber ?? "";
  const bt = b.trackingNumber ?? "";
  if (at === bt) return 0;
  return at < bt ? -1 : 1;
}
