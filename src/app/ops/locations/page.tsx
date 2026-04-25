import type { Metadata } from "next";

import { LocationsView } from "./LocationsView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Locations review · USA Gummies Ops",
};

/**
 * /ops/locations — internal review queue for staged store records.
 *
 * Read-only. Drafts land here when an operator (or a future cron) POSTs
 * to /api/ops/locations/ingest. Promotion to the public locator at
 * /where-to-buy is a separate, manual step (PR appending to
 * src/data/retailers.ts).
 */
export default function OpsLocationsPage() {
  return <LocationsView />;
}
