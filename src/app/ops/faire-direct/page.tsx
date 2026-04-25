import type { Metadata } from "next";

import { FaireDirectView } from "./FaireDirectView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Faire Direct invite queue · USA Gummies Ops",
};

/**
 * /ops/faire-direct — internal review queue for Faire Direct invite
 * candidates. Phase 1 = staging + review only. No emails are sent
 * from this surface; no Faire API call is made. Send-on-approve is
 * a future Phase 2 build, gated by Class B `faire-direct.invite`.
 */
export default function FaireDirectPage() {
  return <FaireDirectView />;
}
