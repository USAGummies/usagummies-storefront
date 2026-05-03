import type { Metadata } from "next";

import { buildChannelMarginsTable } from "@/lib/finance/channel-margins/builder";
import { ChannelMarginsView } from "./ChannelMarginsView.client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Channel Margins · USA Gummies Ops",
};

/**
 * Channel margin dashboard — closes audit finding "Missing #13".
 *
 * Per-channel per-bag economics so questions like Buc-ee's
 * "what's our floor at $X retail / Y oz?" can be answered against
 * the dashboard, not via a Slack thread.
 *
 * The page is a thin server component — pure inputs go through
 * `buildChannelMarginsTable()` (testable, deterministic) and the
 * client view renders the table + summary + the unavailable cells
 * with explicit `[needs QBO actual]` markers.
 */
export default function ChannelMarginsPage() {
  const table = buildChannelMarginsTable();
  return <ChannelMarginsView table={table} />;
}
