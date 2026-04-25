/**
 * Pure reorder-intent helpers for the customer account UI.
 *
 * Today's cart is single-SKU only — `addToCart()` in `src/lib/cart.ts`
 * calls `normalizeSingleBagVariant()` which rejects every variant id
 * except the canonical single-bag (SKU 199284624702). Bundles + other
 * SKUs are handled differently and aren't reorderable through the
 * customer account flow.
 *
 * `intentFromOrder()` takes a historical order (as returned by
 * `getCustomerOrders()`) and produces:
 *
 *   {
 *     addable: [{ variantId, quantity, title }],
 *     skipped: [{ title, reason }],
 *     hasAnyAddable: boolean
 *   }
 *
 * Hard rules locked by tests:
 *   - NEVER reuses any historical price. The output carries
 *     `variantId + quantity + title`. Shopify cart determines the
 *     current price at checkout.
 *   - NEVER adds an unavailable item. A line is skipped when:
 *       * variant is null (Shopify couldn't resolve it — e.g. product
 *         deleted)
 *       * variant.availableForSale === false
 *       * variant.id is not the canonical single-bag (any other SKU)
 *   - Skipped items carry a stable `reason` code so the UI can render
 *     consistent copy.
 *   - Duplicate quantities are summed (an order with the same variant
 *     twice — rare but possible — collapses to one addable entry with
 *     summed quantity).
 *
 * No fetch, no I/O, no env reads. The UI passes the order in, gets
 * an intent out, then loops through `addable` and calls the existing
 * `addToCart()` server action one entry at a time.
 */

import { SINGLE_BAG_VARIANT_ID } from "@/lib/bundles/atomic";

import type { CustomerOrderLineItemShape, CustomerOrderShape } from "./display";

export type ReorderSkipReason =
  | "no_variant_resolved"
  | "variant_not_purchasable"
  | "different_product"
  | "out_of_stock";

export interface ReorderAddableItem {
  variantId: string;
  quantity: number;
  /** Display title from the historical order, for confirm copy. */
  title: string;
}

export interface ReorderSkippedItem {
  title: string;
  reason: ReorderSkipReason;
  /** Operator-friendly detail; never shown to customer raw. */
  detail?: string;
}

export interface ReorderIntent {
  addable: ReorderAddableItem[];
  skipped: ReorderSkippedItem[];
  hasAnyAddable: boolean;
}

const REASON_LABELS: Record<ReorderSkipReason, string> = {
  no_variant_resolved: "no longer in the catalog",
  variant_not_purchasable:
    "isn't reorderable through your account today",
  different_product: "isn't reorderable through your account today",
  out_of_stock: "is currently out of stock",
};

/** Customer-facing copy for a skipped line. Stable, no PII. */
export function copyForSkipReason(reason: ReorderSkipReason): string {
  return REASON_LABELS[reason];
}

/**
 * Convert a historical order into a current cart intent. Pure — no
 * Shopify call, no env read. Caller is responsible for actually
 * adding the addable items via the existing `addToCart` helper.
 */
export function intentFromOrder(order: CustomerOrderShape): ReorderIntent {
  const addableMap = new Map<string, ReorderAddableItem>();
  const skipped: ReorderSkippedItem[] = [];

  for (const line of order.lineItems ?? []) {
    const classification = classifyLine(line);
    if (classification.kind === "skip") {
      skipped.push({
        title: line.title,
        reason: classification.reason,
        detail: classification.detail,
      });
      continue;
    }
    // De-dup by variantId. Sum quantities so a multi-line same-variant
    // order produces one addable entry. Defensive — Shopify usually
    // collapses these — but we don't want to send two add-to-cart
    // calls for the same variant.
    const existing = addableMap.get(classification.variantId);
    if (existing) {
      addableMap.set(classification.variantId, {
        ...existing,
        quantity: existing.quantity + Math.max(0, line.quantity),
      });
    } else {
      addableMap.set(classification.variantId, {
        variantId: classification.variantId,
        quantity: Math.max(0, line.quantity),
        title: line.title,
      });
    }
  }

  // Drop zero-qty rows defensively.
  const addable = Array.from(addableMap.values()).filter(
    (item) => item.quantity > 0,
  );

  return {
    addable,
    skipped,
    hasAnyAddable: addable.length > 0,
  };
}

interface ClassifyResultAddable {
  kind: "addable";
  variantId: string;
}
interface ClassifyResultSkip {
  kind: "skip";
  reason: ReorderSkipReason;
  detail?: string;
}

function classifyLine(
  line: CustomerOrderLineItemShape,
): ClassifyResultAddable | ClassifyResultSkip {
  const variant = line.variant;
  if (!variant || !variant.id) {
    return {
      kind: "skip",
      reason: "no_variant_resolved",
      detail: `${line.title}: variant not present in Shopify response`,
    };
  }
  if (variant.id !== SINGLE_BAG_VARIANT_ID) {
    return {
      kind: "skip",
      reason: "different_product",
      detail: `${line.title}: variant ${variant.id} is not the canonical single-bag`,
    };
  }
  if (!variant.availableForSale) {
    return {
      kind: "skip",
      reason: "out_of_stock",
      detail: `${line.title}: availableForSale=false`,
    };
  }
  return { kind: "addable", variantId: variant.id };
}
