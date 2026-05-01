import { readAllChannelsLast7d } from "@/lib/ops/revenue-kpi-readers";
import { buildSalesCommandCenter } from "@/lib/ops/sales-command-center";
import {
  readAllAgingItems,
  readApPackets,
  readDay1Prospects,
  readFaireFollowUps,
  readFaireInvites,
  readLocationDrafts,
  readPendingApprovals,
  readSalesPipeline,
  readSalesTourPlaybook,
  readStaleBuyers,
  readWholesaleInquiries,
} from "@/lib/ops/sales-command-readers";

export async function buildSlackCommandCenterReport(now: Date) {
  const [
    faireInvites,
    faireFollowUps,
    pendingApprovals,
    apPackets,
    locationDrafts,
    aging,
    revenueChannels,
    wholesaleInquiries,
    day1Prospects,
    salesTour,
    salesPipeline,
    staleBuyers,
  ] = await Promise.all([
    readFaireInvites(),
    readFaireFollowUps(now),
    readPendingApprovals(),
    readApPackets(),
    readLocationDrafts(),
    readAllAgingItems(now),
    readAllChannelsLast7d(now),
    readWholesaleInquiries(),
    readDay1Prospects(),
    readSalesTourPlaybook(),
    readSalesPipeline(now),
    readStaleBuyers(now),
  ]);

  return buildSalesCommandCenter(
    {
      faireInvites,
      faireFollowUps,
      pendingApprovals,
      apPackets,
      locationDrafts,
      agingItems: aging.items,
      agingMissing: aging.missing,
      revenueChannels,
      wholesaleInquiries,
      day1Prospects,
      salesTour,
      salesPipeline,
      staleBuyers,
      dispatchNotWiredReason:
        "Dispatch summary is owned by /api/ops/sales; Slack card uses the compact sales read model.",
    },
    { now },
  );
}
