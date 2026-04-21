/**
 * Freight-Comp Accounting — USA Gummies (CF-09)
 *
 * BUILD #6 — automatic dual-JE for absorbed freight.
 *
 * Context: per `/contracts/distributor-pricing-commitments.md` §5, every
 * absorbed-freight shipment must book two entries:
 *
 *   - DEBIT  500050 Freight Out — Distributors:<Channel>   (expense)
 *   - CREDIT 499010 Promotional / Show Freight Comp        (contra-revenue)
 *
 * Without this, the "revenue" figure on a delivered-priced sale would
 * hide the freight cost inside COGS. CF-09 channel segmentation
 * surfaces it as a real promotional cost so P&L reflects the true
 * margin of the "delivered" promise.
 *
 * This module:
 *   1. Builds the dual-entry `QBOJournalEntryInput` from a label buy.
 *   2. Optionally auto-posts it as a Class B approval (Rene signs off).
 *   3. Exposes the dollar + class codes so agents can reference the
 *      same pair consistently.
 *
 * NOT called automatically by `createShippingLabel` — the fulfillment
 * route decides whether freight was absorbed (delivered pricing) or
 * billed to the customer (DTC / Option A with markup). Only absorbed
 * freight triggers the dual JE.
 */

import type { QBOJournalEntryInput, QBOJournalEntryLine } from "./qbo-client";

// ---------------------------------------------------------------------------
// Account + class registry — kept in sync with contracts/divisions.json
// ---------------------------------------------------------------------------

/** Debit account — freight expense, channel-qualified parent. */
export const ACCT_FREIGHT_OUT = "500050"; // Freight Out — Distributors
/** Credit account — contra-revenue, keeps the "delivered" promise visible. */
export const ACCT_FREIGHT_COMP = "499010"; // Promotional / Show Freight Comp

/**
 * Channel codes. Must match `/contracts/channels.json` so QBO classes
 * align with the channel registry. Agents that ship from a channel
 * not listed here should add it to channels.json FIRST — then extend
 * this map.
 */
export const FREIGHT_COMP_CHANNELS = {
  distributor: {
    code: "DIST",
    label: "Distributor (Option A/B, Sell-Sheet)",
    /** Examples: Inderbitzin, Glacier. Freight absorbed per sell-sheet v3. */
    examples: ["Inderbitzin", "Glacier"],
  },
  trade_show: {
    code: "SHOW",
    label: "Trade-Show Booth Special",
    /** Examples: Reunion 2026 Bryce Glamp. FREE shipping per booth promo. */
    examples: ["Bryce", "Reunion 2026"],
  },
  dtc_absorbed: {
    code: "DTC",
    label: "DTC Absorbed (Shopify free-ship promo)",
    /** Set only when a Shopify promo absorbs freight. Not the default. */
    examples: [],
  },
} as const;

export type FreightCompChannel = keyof typeof FREIGHT_COMP_CHANNELS;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildFreightCompJeParams {
  /** Dollar amount we paid to the carrier. Must match the label invoice. */
  freightCostDollars: number;
  /** CF-09 channel the shipment belongs to. */
  channel: FreightCompChannel;
  /** ShipStation shipment id (or tracking number) — goes in PrivateNote for reconciliation. */
  shipmentId: string | number;
  /** Tracking number(s) — joined with commas if multi-carton. */
  trackingNumber?: string;
  /** Customer reference — invoice number, Shopify order #, or PO. */
  customerRef?: string;
  /** Ship date — defaults to today. */
  txnDate?: string;
  /** Optional QBO account IDs (v) if your realm uses custom refs — default to names. */
  accountRefIds?: {
    freightOut?: string;
    freightComp?: string;
  };
}

/**
 * Build a paired-line QBO JournalEntry for an absorbed-freight label.
 * The caller POSTs this through `createQBOJournalEntry()` (usually
 * gated behind a Class B approval since Rene owns GL postings).
 */
export function buildFreightCompJournalEntry(
  params: BuildFreightCompJeParams,
): QBOJournalEntryInput {
  const amount = round2(params.freightCostDollars);
  if (!(amount > 0)) {
    throw new Error(
      `buildFreightCompJournalEntry: freightCostDollars must be > 0, got ${params.freightCostDollars}`,
    );
  }

  const channel = FREIGHT_COMP_CHANNELS[params.channel];
  const channelLabel = channel.label;

  const refIds = params.accountRefIds ?? {};

  const description =
    `Freight absorbed — ${channelLabel}` +
    (params.customerRef ? ` · ${params.customerRef}` : "") +
    (params.trackingNumber ? ` · tracking ${params.trackingNumber}` : "");

  const debit: QBOJournalEntryLine = {
    DetailType: "JournalEntryLineDetail",
    Amount: amount,
    Description: `[DEBIT] ${description}`,
    JournalEntryLineDetail: {
      PostingType: "Debit",
      AccountRef: {
        value: refIds.freightOut ?? ACCT_FREIGHT_OUT,
        name: `Freight Out — ${channelLabel}`,
      },
    },
  };

  const credit: QBOJournalEntryLine = {
    DetailType: "JournalEntryLineDetail",
    Amount: amount,
    Description: `[CREDIT] ${description}`,
    JournalEntryLineDetail: {
      PostingType: "Credit",
      AccountRef: {
        value: refIds.freightComp ?? ACCT_FREIGHT_COMP,
        name: `Promotional / Show Freight Comp`,
      },
    },
  };

  return {
    TxnDate: params.txnDate ?? new Date().toISOString().slice(0, 10),
    PrivateNote:
      `CF-09 absorbed-freight auto-entry. ` +
      `channel=${channel.code}, shipmentId=${params.shipmentId}` +
      (params.customerRef ? `, ref=${params.customerRef}` : "") +
      (params.trackingNumber ? `, tracking=${params.trackingNumber}` : "") +
      `. Per /contracts/distributor-pricing-commitments.md §5.`,
    Line: [debit, credit],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
