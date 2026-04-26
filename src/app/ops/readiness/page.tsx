import type { Metadata } from "next";

import { ReadinessView } from "./ReadinessView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Production Readiness · USA Gummies Ops",
};

/**
 * /ops/readiness — read-only dashboard.
 *
 * The server entry is a thin shell. The client view fetches:
 *   - GET /api/ops/readiness        → env fingerprint + checklist + probes list
 *   - probes from the operator's session against the listed read-only routes
 *
 * The page never mutates state (no labels bought, no email sent, no
 * QBO write, no approvals updated, no KV write).
 */
export default function ReadinessPage() {
  return <ReadinessView />;
}
