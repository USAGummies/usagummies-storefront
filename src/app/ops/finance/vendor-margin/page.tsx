import type { Metadata } from "next";

import { VendorMarginView } from "./VendorMarginView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Vendor Margin Ledger · USA Gummies Ops",
};

/**
 * /ops/finance/vendor-margin
 *
 * Read-only operator view over the canonical per-vendor margin ledger.
 * Auth gating is handled by the existing `/ops/*` middleware. The page
 * calls only GET /api/ops/finance/vendor-margin and never mutates QBO,
 * HubSpot, Shopify, pricing, invoices, or approvals.
 */
export default function VendorMarginPage() {
  return <VendorMarginView />;
}
