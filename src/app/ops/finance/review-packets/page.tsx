import type { Metadata } from "next";

import { ReviewPacketsView } from "./ReviewPacketsView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Receipt Review Packets · USA Gummies Ops",
};

/**
 * /ops/finance/review-packets — Phase 13 aggregate dashboard.
 *
 * Read-only view of every receipt review packet (Phase 8 +) with
 * its current status (`draft` / `rene-approved` / `rejected`),
 * vendor + amount, eligibility, and creation time.
 *
 * Reuses the existing `/api/ops/docs/receipt-review-packets` list
 * route. No new write paths added by this page. Auth gating is
 * handled by `src/middleware.ts` — `/ops/*` redirects to login when
 * the session is missing.
 */
export default function ReceiptReviewPacketsPage() {
  return <ReviewPacketsView />;
}
