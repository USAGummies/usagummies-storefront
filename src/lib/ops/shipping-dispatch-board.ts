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
 * Filter spec for the dispatch board.
 *
 * All fields optional — empty means "no filter on this dimension."
 * AND semantics: a row must satisfy every active dimension to pass.
 * Defensive: empty / whitespace / unparseable inputs collapse to
 * "no filter" (keystroke errors never hide rows).
 */
export interface DispatchBoardFilterSpec {
  /** "all" | "open" | "dispatched". Default: undefined (no filter). */
  state?: "all" | "open" | "dispatched";
  /** "all" | "amazon" | "shopify" | "manual" | "faire". */
  source?: "all" | "amazon" | "shopify" | "manual" | "faire";
  /** ISO date YYYY-MM-DD. Inclusive lower bound on shipDate. */
  shipDateFrom?: string;
  /** ISO date YYYY-MM-DD. Inclusive upper bound on shipDate. */
  shipDateTo?: string;
  /** Case-insensitive substring against orderNumber / tracking / recipient. */
  search?: string;
}

const ALLOWED_SOURCES_FILTER: ReadonlyArray<DispatchBoardFilterSpec["source"]> =
  ["all", "amazon", "shopify", "manual", "faire"] as const;

/**
 * Apply a filter spec to a built `DispatchBoardView`. Returns a NEW
 * view with `rows` narrowed and `counts` recomputed on the filtered
 * set — so the dashboard's strip always sums to `rows.length`.
 *
 * Bit-identical client/server semantics. The route uses the same
 * helper before serializing JSON; locked by parity test.
 */
export function applyDispatchBoardFilters(
  view: DispatchBoardView,
  spec: DispatchBoardFilterSpec,
): DispatchBoardView {
  const stateFilter =
    spec.state && spec.state !== "all" ? spec.state : null;
  const sourceFilter =
    spec.source && spec.source !== "all" ? spec.source : null;
  const fromTrim = spec.shipDateFrom?.trim() ?? "";
  const toTrim = spec.shipDateTo?.trim() ?? "";
  const dateFrom = isIsoDate(fromTrim) ? fromTrim : null;
  const dateTo = isIsoDate(toTrim) ? toTrim : null;
  const searchTrim = spec.search?.trim().toLowerCase() ?? "";

  const filtered = view.rows.filter((r) => {
    if (stateFilter && r.state !== stateFilter) return false;
    if (sourceFilter && r.source !== sourceFilter) return false;
    if (dateFrom || dateTo) {
      if (!r.shipDate || !isIsoDate(r.shipDate)) return false;
      if (dateFrom && r.shipDate < dateFrom) return false;
      if (dateTo && r.shipDate > dateTo) return false;
    }
    if (searchTrim) {
      const haystack = [
        r.orderNumber,
        r.trackingNumber,
        r.recipient,
        r.shipToPostalCode,
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(searchTrim)) return false;
    }
    return true;
  });

  const counts: DispatchBoardCounts = {
    total: filtered.length,
    open: filtered.filter((r) => r.state === "open").length,
    dispatched: filtered.filter((r) => r.state === "dispatched").length,
  };

  return { rows: filtered, counts };
}

/** Returns true iff `spec` would narrow the view (any active dimension). */
export function dispatchBoardFilterIsActive(
  spec: DispatchBoardFilterSpec,
): boolean {
  if (spec.state && spec.state !== "all") return true;
  if (spec.source && spec.source !== "all") return true;
  if (spec.shipDateFrom?.trim() && isIsoDate(spec.shipDateFrom.trim()))
    return true;
  if (spec.shipDateTo?.trim() && isIsoDate(spec.shipDateTo.trim())) return true;
  if (spec.search?.trim()) return true;
  return false;
}

/**
 * Parse the canonical query string into a `DispatchBoardFilterSpec`.
 * Unknown / whitespace / unparseable values collapse to no filter.
 */
export function parseDispatchBoardFilterSpec(
  query: URLSearchParams,
): DispatchBoardFilterSpec {
  const spec: DispatchBoardFilterSpec = {};
  const stateRaw = query.get("state")?.trim();
  if (stateRaw === "open" || stateRaw === "dispatched" || stateRaw === "all") {
    spec.state = stateRaw;
  }
  const sourceRaw = query.get("source")?.trim();
  if (
    sourceRaw &&
    (ALLOWED_SOURCES_FILTER as readonly string[]).includes(sourceRaw)
  ) {
    spec.source = sourceRaw as DispatchBoardFilterSpec["source"];
  }
  const fromRaw = query.get("shipDateFrom")?.trim();
  if (fromRaw && isIsoDate(fromRaw)) spec.shipDateFrom = fromRaw;
  const toRaw = query.get("shipDateTo")?.trim();
  if (toRaw && isIsoDate(toRaw)) spec.shipDateTo = toRaw;
  const searchRaw = query.get("search")?.trim();
  if (searchRaw) spec.search = searchRaw;
  return spec;
}

/**
 * Serialize a spec to a query-string. Round-trips with
 * `parseDispatchBoardFilterSpec`. Defaults / no-filter values are
 * omitted so URLs stay short.
 */
export function dispatchBoardFilterSpecToQuery(
  spec: DispatchBoardFilterSpec,
): URLSearchParams {
  const q = new URLSearchParams();
  if (spec.state && spec.state !== "all") q.set("state", spec.state);
  if (spec.source && spec.source !== "all") q.set("source", spec.source);
  if (spec.shipDateFrom?.trim() && isIsoDate(spec.shipDateFrom.trim())) {
    q.set("shipDateFrom", spec.shipDateFrom.trim());
  }
  if (spec.shipDateTo?.trim() && isIsoDate(spec.shipDateTo.trim())) {
    q.set("shipDateTo", spec.shipDateTo.trim());
  }
  if (spec.search?.trim()) q.set("search", spec.search.trim());
  return q;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
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
