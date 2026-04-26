/**
 * Pure display helpers for the customer account UI.
 *
 * These helpers shape the raw `/api/member` response into operator-
 * neutral copy the page renders. They never read env, never call
 * fetch, never write side effects — easy to unit-test the contract:
 *
 *   - never invent data
 *   - empty orders → friendly empty state, not "$0 spent"
 *   - missing fulfillmentStatus → "Unfulfilled" not blank
 *   - currency falls back to USD when Shopify omits it
 */

export interface CustomerOrderLineItemShape {
  title: string;
  quantity: number;
  /** Null when Shopify can't resolve the variant (deleted product, etc.). */
  variant: {
    id: string;
    sku: string | null;
    availableForSale: boolean;
  } | null;
}

export interface CustomerOrderShape {
  id: string;
  orderNumber: number;
  processedAt: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  currentTotalPrice: { amount: string; currencyCode: string } | null;
  lineItems: CustomerOrderLineItemShape[];
}

export interface CustomerSummaryShape {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  orders: CustomerOrderShape[];
}

/** "Apr 24, 2026" — locale-stable formatting for the orders list. */
export function formatOrderDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Format an order total as "$24.99". Falls back to "—" on missing data. */
export function formatOrderTotal(
  price: CustomerOrderShape["currentTotalPrice"],
): string {
  if (!price || !price.amount) return "—";
  const amount = Number.parseFloat(price.amount);
  if (!Number.isFinite(amount)) return "—";
  const currency = price.currencyCode || "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/** Map raw Shopify financialStatus enum to a customer-friendly label. */
export function formatFinancialStatus(raw: string | null | undefined): string {
  switch ((raw ?? "").toUpperCase()) {
    case "PAID":
      return "Paid";
    case "PARTIALLY_PAID":
      return "Partially paid";
    case "REFUNDED":
      return "Refunded";
    case "PARTIALLY_REFUNDED":
      return "Partially refunded";
    case "VOIDED":
      return "Voided";
    case "PENDING":
      return "Pending";
    case "AUTHORIZED":
      return "Authorized";
    case "":
      return "—";
    default:
      // Show the raw value (lowercased + spaces) so unknown enums
      // surface honestly rather than collapsing to a generic label.
      return (raw ?? "").toString().toLowerCase().replace(/_/g, " ");
  }
}

export function formatFulfillmentStatus(
  raw: string | null | undefined,
): string {
  switch ((raw ?? "").toUpperCase()) {
    case "FULFILLED":
      return "Fulfilled";
    case "PARTIAL":
      return "Partially fulfilled";
    case "RESTOCKED":
      return "Restocked";
    case "UNFULFILLED":
    case "":
      return "Unfulfilled";
    default:
      return (raw ?? "").toString().toLowerCase().replace(/_/g, " ");
  }
}

/** Greeting line for the header. Always non-empty. */
export function greetingFor(customer: Pick<
  CustomerSummaryShape,
  "firstName" | "lastName" | "email"
>): string {
  const first = (customer.firstName ?? "").trim();
  const last = (customer.lastName ?? "").trim();
  if (first && last) return `Hi, ${first} ${last}.`;
  if (first) return `Hi, ${first}.`;
  if (customer.email) return `Hi, ${customer.email}.`;
  return "Hi.";
}

/**
 * Decide whether to even attempt the B2B status lookup.
 *
 * Phase 2 contract: only call /api/wholesale-status when we have a
 * verified email AND it isn't an obvious DTC-only consumer email like
 * a free-mail provider single-shopper. The /api/wholesale-status
 * route already returns `deals: []` for unknown contacts, so this is
 * defensive — keep the network noise down for the 99% of DTC customers
 * who never have a HubSpot deal.
 *
 * Heuristic: skip the lookup for the most common consumer mailbox
 * domains. False negatives are fine (a wholesale buyer using @gmail
 * just doesn't get their B2B panel auto-populated; they can still
 * use /wholesale/status to look up by email). False positives — a
 * non-wholesale customer triggering the lookup — are fine too; the
 * route returns 200 with deals=[] and the panel hides itself.
 */
const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "me.com",
  "live.com",
  "aol.com",
  "msn.com",
]);

export function shouldQueryB2BStatus(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain.includes(".")) return false;
  return !CONSUMER_DOMAINS.has(domain);
}
