/**
 * Sample / Order Dispatch Specialist (S-08) — pure classifier + composer.
 *
 * Contract: /contracts/agents/sample-order-dispatch.md (v1.0 2026-04-20).
 *
 * One job (split into two pure functions here):
 *   1. `classifyDispatch()` — given a normalized order intent, returns
 *      the canonical origin + carrier + service preset. Pure. No I/O.
 *   2. `composeShipmentProposal()` — given the classification + the
 *      caller's context (Shopify/Amazon/Faire/HubSpot source), returns
 *      a Class B `shipment.create` approval payload for #ops-approvals.
 *
 * Hard rules (CLAUDE.md + contract §Role):
 *   - Orders → Ashford WA (Ben). Default origin.
 *   - Samples → East Coast (Drew). Only path: order is tagged `sample`,
 *     `tag:sample`, or `purpose:sample`, OR `origin:east-coast` is an
 *     explicit override.
 *   - Wrong-origin dispatch = Class D-adjacent refusal. Classifier
 *     returns `{ refuse: true, reason }` so callers know to halt.
 *
 * This module is intentionally pure so it's cheap to unit-test + safe
 * to call from any runtime path (webhook, Slack handler, on-demand).
 */

export type DispatchOriginCode = "ashford" | "east_coast";
export type DispatchChannel =
  | "shopify"
  | "amazon"
  | "faire"
  | "hubspot"
  | "manual";

/** Minimal shape — matches the superset of webhook payloads we accept. */
export interface OrderIntent {
  /** Upstream source system. */
  channel: DispatchChannel;
  /** Upstream identifier (Shopify order id, Amazon orderId, Faire order, etc). */
  sourceId: string;
  /** Upstream order number (#1016, OBE-123, etc). Preserved for traceability. */
  orderNumber?: string;
  /** Purchase value in USD (used for risk tiering; not authoritative). */
  valueUsd?: number;
  /**
   * Order tags from source system. Classifier scans for
   * `sample`, `tag:sample`, `purpose:sample`, `origin:east-coast`.
   * Case-insensitive substring match.
   */
  tags?: string[];
  /** Free-form note from upstream (Shopify note, Faire message, etc). */
  note?: string;
  /** Ship-to address. */
  shipTo: {
    name: string;
    company?: string;
    street1: string;
    street2?: string;
    city: string;
    state: string; // 2-letter US
    postalCode: string;
    country?: string; // default "US"
    residential?: boolean;
  };
  /** Packaging intent. Defaults to master_carton for wholesale, case for samples. */
  packagingType?: "case" | "master_carton";
  /** Number of cartons to ship. Defaults to 1 for samples. */
  cartons?: number;
  /** Total order weight in lbs. Used to pick USPS vs UPS for light/heavy split. */
  weightLbs?: number;
  /**
   * HubSpot metadata — when present, classifier checks `ar_hold` to
   * refuse dispatch per contract §Prohibited.
   */
  hubspot?: {
    dealId?: string;
    arHold?: boolean;
  };
}

export interface DispatchClassification {
  origin: DispatchOriginCode;
  originReason: string;
  carrierCode: "stamps_com" | "ups_walleted" | "fedex_walleted" | "globalpost";
  serviceCode: string;
  packagingType: "case" | "master_carton";
  cartons: number;
  /**
   * Soft warnings — not refusals. Caller surfaces these to the
   * operator during approval (e.g. unusual ZIP, high value, no tags).
   */
  warnings: string[];
  /** When true, caller must NOT create a label. `refuseReason` populated. */
  refuse: boolean;
  refuseReason?: string;
}

// ---------------------------------------------------------------------------
// Origin classifier
// ---------------------------------------------------------------------------

const SAMPLE_TAG_REGEX = /\b(sample|tag:sample|purpose:sample)\b/i;
const EAST_COAST_OVERRIDE_REGEX = /\borigin:east-coast\b/i;

/**
 * Classify the origin + carrier + service for a given order intent.
 * Pure function; safe to call anywhere.
 */
export function classifyDispatch(order: OrderIntent): DispatchClassification {
  const warnings: string[] = [];

  // 1. Hard refuse: ar_hold.
  if (order.hubspot?.arHold === true) {
    return {
      origin: "ashford",
      originReason: "ar_hold — refuse",
      carrierCode: "stamps_com",
      serviceCode: "usps_ground_advantage",
      packagingType: order.packagingType ?? "master_carton",
      cartons: order.cartons ?? 1,
      warnings,
      refuse: true,
      refuseReason: `HubSpot deal ${order.hubspot.dealId ?? "(no id)"} has ar_hold=true — refuse dispatch per /contracts/agents/sample-order-dispatch.md §Prohibited.`,
    };
  }

  // 2. Origin: scan tags + note for sample / override markers.
  const tagsJoined = (order.tags ?? []).join(" ").concat(" ", order.note ?? "");
  const isSample = SAMPLE_TAG_REGEX.test(tagsJoined);
  const isEastCoastOverride = EAST_COAST_OVERRIDE_REGEX.test(tagsJoined);
  let origin: DispatchOriginCode = "ashford";
  let originReason = "default — orders ship from Ashford (Ben)";
  if (isSample) {
    origin = "east_coast";
    originReason = "tagged as sample — ship from East Coast (Drew)";
  } else if (isEastCoastOverride) {
    origin = "east_coast";
    originReason = "explicit origin:east-coast override";
  }

  // 3. Hard refuse: wrong-origin detection. Caller says "order" but tags
  //    request East Coast, OR caller says "sample" but classifier puts
  //    at Ashford. The contract is zero-tolerance on wrong-origin.
  if (
    order.channel !== "manual" &&
    isEastCoastOverride &&
    !isSample &&
    (order.valueUsd ?? 0) > 100
  ) {
    warnings.push(
      "origin:east-coast override on a >$100 non-sample order — operator should confirm",
    );
  }

  // 4. Carrier + service selection.
  // Rules:
  //   - Pallet: not handled here (the hub short-circuits pallets elsewhere).
  //   - ≤ 3 lb total: USPS Ground Advantage (stamps_com). Covers sample
  //     packets + small DTC orders.
  //   - > 3 lb: UPS Ground (ups_walleted). Default for master cartons.
  //   - Alaska / Hawaii / PR (AK/HI/PR): USPS is always cheaper; force stamps_com.
  const packagingType =
    order.packagingType ??
    (isSample ? "case" : "master_carton");
  const cartons = Math.max(1, order.cartons ?? 1);
  // Rough per-carton weight: master 21.125 lb, case 6 lb. Override via order.weightLbs.
  const inferredPerCartonWeight = packagingType === "master_carton" ? 21.125 : 6;
  const totalWeightLbs =
    order.weightLbs ?? inferredPerCartonWeight * cartons;

  const state = order.shipTo.state.toUpperCase();
  const uspsForcedStates = new Set(["AK", "HI", "PR", "VI", "GU"]);
  const forceUsps = uspsForcedStates.has(state);

  let carrierCode: DispatchClassification["carrierCode"] = "ups_walleted";
  let serviceCode = "ups_ground";
  if (forceUsps) {
    carrierCode = "stamps_com";
    serviceCode = "usps_ground_advantage";
  } else if (totalWeightLbs <= 3 || isSample) {
    carrierCode = "stamps_com";
    serviceCode = "usps_ground_advantage";
  }

  // 5. Soft warnings that surface in the approval.
  if (!order.shipTo.street1 || order.shipTo.street1.trim().length < 3) {
    warnings.push("ship-to street1 is missing or too short — verify before label");
  }
  if (!/^\d{5}(-\d{4})?$/.test(order.shipTo.postalCode.trim())) {
    warnings.push(
      `ship-to postal code ${order.shipTo.postalCode} is not a 5/9-digit US ZIP`,
    );
  }
  if (order.valueUsd !== undefined && order.valueUsd > 500 && isSample) {
    warnings.push(
      `sample with order value $${order.valueUsd} — unusually high; confirm intent`,
    );
  }

  return {
    origin,
    originReason,
    carrierCode,
    serviceCode,
    packagingType,
    cartons,
    warnings,
    refuse: false,
  };
}

// ---------------------------------------------------------------------------
// Proposal composer
// ---------------------------------------------------------------------------

export interface ShipmentProposal {
  actionSlug: "shipment.create";
  approvalClass: "B";
  /** Ben for orders; Ben (Drew originates, Ben approves) for samples. */
  requiredApprovers: Array<"Ben">;
  summary: string;
  destination: OrderIntent["shipTo"];
  classification: DispatchClassification;
  evidence: {
    channel: DispatchChannel;
    sourceId: string;
    orderNumber?: string;
    valueUsd?: number;
    tagsScanned: string[];
    weightLbsTotal: number;
  };
  /** Slack-flavored markdown for posting to `#ops-approvals`. */
  renderedMarkdown: string;
}

/**
 * Compose a Class B `shipment.create` approval proposal from a
 * normalized order intent + classification. Caller posts the
 * renderedMarkdown to `#ops-approvals` and persists the structured
 * payload for the approval workflow.
 */
export function composeShipmentProposal(
  order: OrderIntent,
  classification: DispatchClassification,
): ShipmentProposal {
  const inferredPerCartonWeight =
    classification.packagingType === "master_carton" ? 21.125 : 6;
  const weightLbsTotal =
    order.weightLbs ?? inferredPerCartonWeight * classification.cartons;

  const originLabel =
    classification.origin === "ashford" ? "Ashford WA (Ben)" : "East Coast (Drew)";

  const lines = [
    `:package: *Shipment proposal — ${order.channel.toUpperCase()} ${order.orderNumber ?? order.sourceId}*`,
    `*Origin:* ${originLabel} _— ${classification.originReason}_`,
    `*Ship-to:* ${order.shipTo.name} · ${order.shipTo.city}, ${order.shipTo.state} ${order.shipTo.postalCode}`,
    `*Carrier:* \`${classification.carrierCode}\` / \`${classification.serviceCode}\``,
    `*Packaging:* ${classification.cartons} × ${classification.packagingType} (~${weightLbsTotal} lb total)`,
  ];
  if (order.valueUsd !== undefined) {
    lines.push(`*Order value:* $${order.valueUsd.toFixed(2)}`);
  }
  if (order.hubspot?.dealId) {
    lines.push(`*HubSpot deal:* \`${order.hubspot.dealId}\``);
  }
  if (classification.warnings.length > 0) {
    lines.push("");
    lines.push("*Warnings:*");
    for (const w of classification.warnings) {
      lines.push(`  • :warning: ${w}`);
    }
  }
  lines.push("");
  lines.push(
    "_Class B `shipment.create`. Approve to buy label via ShipStation. Source: /contracts/agents/sample-order-dispatch.md._",
  );

  return {
    actionSlug: "shipment.create",
    approvalClass: "B",
    requiredApprovers: ["Ben"],
    summary: `${order.channel}:${order.orderNumber ?? order.sourceId} → ${originLabel} via ${classification.carrierCode}`,
    destination: order.shipTo,
    classification,
    evidence: {
      channel: order.channel,
      sourceId: order.sourceId,
      orderNumber: order.orderNumber,
      valueUsd: order.valueUsd,
      tagsScanned: order.tags ?? [],
      weightLbsTotal,
    },
    renderedMarkdown: lines.join("\n"),
  };
}
